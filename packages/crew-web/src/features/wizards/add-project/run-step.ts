// Chạy từng bước wizard thêm project (S9): `setup.begin` (khóa bước) → làm việc → `setup.finish` ghi refs.
// Mọi lời gọi mang companyId của setup run, không lấy company đang chọn trên trang. Lỗi ở bước nào thì ghi bước đó
// `failed` (kèm refs đã tạo được), tạm dừng mọi agent đã tạo; "Chạy tiếp" chạy lại từ bước đầu chưa xong và dùng lại
// id trong refs. Environment và agent không bao giờ bị xóa ở đây.
import {
  type AddProjectInput,
  ApiError,
  type JobPayload,
  type JobResult,
  type MachineJob,
  type MachineJobStatus,
  type ProjectRoles,
  type SetupRun,
  type SetupStepId,
} from '@/api';
import {
  CREW_AGENT_PERMISSIONS,
  crewAgentCreateBody,
  type InstructionsApi,
  putInstructions,
  ROLE_MODELS,
  renderInstructions,
  roleOfSlot,
} from '@/lib/instructions';
import { ADD_PROJECT_STEPS, type AddProjectStepId, projectSlots, slotBranch, slotName } from './steps';
import { JobFailedError, JobTimeoutError, waitJob } from './wait-job';

type Dateish = string | Date;

interface EnvironmentRow {
  id: string;
  name: string;
  driver: string;
  status: string;
  config: Record<string, unknown>;
  metadata: Record<string, unknown> | null;
  createdAt?: Dateish;
}

interface AgentRow {
  id: string;
  name: string;
  status: string;
  defaultEnvironmentId?: string | null;
}

/** Phần của `api` (src/api) mà wizard thêm project gọi. `api` của web khớp kiểu này. */
export interface AddProjectApi extends InstructionsApi {
  setup: {
    begin(companyId: string, id: string, stepId: SetupStepId): Promise<SetupRun>;
    finish(
      companyId: string,
      id: string,
      stepId: SetupStepId,
      body: { status: 'done' | 'failed'; refs?: Record<string, string>; error?: string; projectId?: string },
    ): Promise<SetupRun>;
  };
  jobs: {
    create(body: {
      companyId: string;
      machineId: string;
      kind: JobPayload['kind'];
      payload: JobPayload;
      setupRunId?: string;
    }): Promise<MachineJob>;
    list(
      companyId: string,
      query?: { machineId?: string; status?: MachineJobStatus; setupRunId?: string; limit?: number },
    ): Promise<MachineJob[]>;
  };
  projects: {
    list(companyId: string): Promise<{ id: string; name: string; archivedAt?: Dateish | null; createdAt?: Dateish }[]>;
    create(companyId: string, body: Record<string, unknown>): Promise<{ id: string }>;
  };
  environments: {
    list(companyId: string): Promise<EnvironmentRow[]>;
    create(companyId: string, body: Record<string, unknown>): Promise<{ id: string }>;
  };
  agents: InstructionsApi['agents'] & {
    list(companyId: string): Promise<AgentRow[]>;
    create(companyId: string, body: Record<string, unknown>): Promise<{ id: string }>;
    pause(id: string, companyId?: string): Promise<unknown>;
    resume(id: string, companyId?: string): Promise<unknown>;
    /**
     * `PATCH /agents/:id/permissions`. Paperclip tự cấp `tasks:assign` cho mọi agent mới tạo; route này đặt lại để
     * chỉ Trợ Lý giữ quyền giao việc. Lớp `src/api` chưa có hàm này thì bỏ qua bước đặt quyền.
     */
    setPermissions?(id: string, body: Record<string, unknown>, companyId?: string): Promise<unknown>;
  };
  roles: { set(companyId: string, projectId: string, roles: ProjectRoles): Promise<unknown> };
  crew: { machines(companyId: string): Promise<unknown> };
}

export type Translate = (key: string, params?: Record<string, unknown>) => string;

export interface AddProjectContext {
  api: AddProjectApi;
  /** Dịch khóa namespace `wizards` thành câu lỗi lưu vào setup run. */
  t: Translate;
  signal?: AbortSignal;
  pollMs?: number;
  /** Bước bắt đầu chạy (trang hiện "Đang chạy"). */
  onStep?: (step: AddProjectStepId) => void;
  /** Run sau mỗi bước. */
  onRun?: (run: SetupRun) => void;
}

/** Thời hạn chờ app trên máy làm xong việc: kiểm folder nhanh (quá thì "Chờ app"), việc git lâu hơn. */
export const JOB_TIMEOUT_MS = { 'inspect-folder': 2 * 60_000, 'prepare-checkouts': 10 * 60_000, check: 10 * 60_000 };

/** Bước bị khóa: người khác (tab khác) đang chạy bước này. Không ghi gì, không pause gì. */
export class StepBusyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StepBusyError';
  }
}

/** Lỗi do wizard phát hiện: `key` là khóa dịch namespace wizards. */
export class StepError extends Error {
  readonly key: string;
  readonly params: Record<string, unknown>;

  constructor(key: string, params: Record<string, unknown> = {}) {
    super(key);
    this.name = 'StepError';
    this.key = key;
    this.params = params;
  }
}

const REF_MAX = 200;

/** Refs của mọi bước (kể cả bước lỗi còn giữ id đã tạo), theo thứ tự bước. */
export function runRefs(run: SetupRun): Record<string, string> {
  const refs: Record<string, string> = {};
  for (const step of ADD_PROJECT_STEPS) Object.assign(refs, run.steps[step]?.refs ?? {});
  return refs;
}

function inputOf(run: SetupRun): AddProjectInput {
  if (run.kind !== 'add-project') throw new StepError('errors.wrongKind');
  return run.input as AddProjectInput;
}

const isTime = (value: Dateish | undefined) => (value === undefined ? Number.NaN : new Date(value).getTime());

/** Câu lỗi lưu vào setup run. Lỗi server và lỗi máy giữ nguyên văn (plugin làm sạch lần nữa). */
export function stepErrorText(t: Translate, error: unknown): string {
  if (error instanceof StepError) return t(error.key, error.params);
  if (error instanceof JobTimeoutError)
    return t('errors.jobTimeout', { minutes: Math.round(error.timeoutMs / 60_000) });
  if (error instanceof JobFailedError) {
    const items = error.result?.kind === 'check' ? error.result.items.filter((i) => i.status === 'error') : [];
    if (items.length > 0) return t('errors.checkFailed', { items: items.map((i) => i.title).join('; ') });
    return t(`errors.job.${error.errorCode ?? 'app_error'}`, { text: error.errorText ?? '' });
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

type WizardJobPayload = Extract<JobPayload, { kind: 'inspect-folder' | 'prepare-checkouts' | 'check' }>;

/** Kết quả việc phải đúng loại việc đã xếp. */
function resultOf<K extends JobResult['kind']>(result: JobResult | null, kind: K): Extract<JobResult, { kind: K }> {
  if (result?.kind !== kind) throw new StepError('errors.jobResult', { kind });
  return result as Extract<JobResult, { kind: K }>;
}

/**
 * Xếp việc cho máy của run rồi chờ. Việc cùng loại của run còn đang chờ/đang làm thì chờ tiếp việc đó (Chạy tiếp sau
 * khi hết hạn chờ); `reuseDone` thì việc đã xong của run được dùng lại (kiểm folder, dựng checkout là việc lặp được).
 */
async function runJob(
  ctx: AddProjectContext,
  run: SetupRun,
  payload: WizardJobPayload,
  reuseDone: boolean,
): Promise<JobResult | null> {
  const { api } = ctx;
  const jobs = await api.jobs.list(run.companyId, { machineId: run.machineId, setupRunId: run.id, limit: 100 });
  const same = jobs.filter((j) => j.kind === payload.kind);
  let job =
    same.find((j) => j.status === 'queued' || j.status === 'claimed') ??
    (reuseDone ? same.find((j) => j.status === 'done') : undefined);
  job ??= await api.jobs.create({
    companyId: run.companyId,
    machineId: run.machineId,
    kind: payload.kind,
    payload,
    setupRunId: run.id,
  });
  if (job.status === 'done') return job.result;
  const timeoutMs = JOB_TIMEOUT_MS[payload.kind];
  return (await waitJob(api, job, { timeoutMs, signal: ctx.signal, intervalMs: ctx.pollMs })).result;
}

const required = (refs: Record<string, string>, key: string): string => {
  const value = refs[key];
  if (!value) throw new StepError('errors.missingRef', { ref: key });
  return value;
};

/** Environment SSH `in_place` mẫu của company (có secret SSH): ưu tiên bản có `crewLoadGate`, rồi bản mới nhất. */
function pickTemplate(envs: EnvironmentRow[]): EnvironmentRow | null {
  const ok = envs.filter((env) => {
    const ref = env.config.privateKeySecretRef as { secretId?: unknown } | undefined;
    return (
      env.status === 'active' &&
      env.driver === 'ssh' &&
      env.metadata?.workspaceRealizationMode === 'in_place' &&
      typeof ref?.secretId === 'string' &&
      typeof env.config.host === 'string' &&
      typeof env.config.username === 'string'
    );
  });
  const gate = (env: EnvironmentRow) => (env.metadata?.crewLoadGate ? 1 : 0);
  ok.sort((a, b) => gate(b) - gate(a) || (isTime(b.createdAt) || 0) - (isTime(a.createdAt) || 0));
  return ok[0] ?? null;
}

function environmentBody(template: EnvironmentRow, name: string, checkout: string, description: string) {
  const config = template.config;
  const secretId = (config.privateKeySecretRef as { secretId: string }).secretId;
  const gate = template.metadata?.crewLoadGate;
  return {
    name,
    description,
    driver: 'ssh',
    config: {
      host: config.host,
      ...(config.port === undefined ? {} : { port: config.port }),
      username: config.username,
      remoteWorkspacePath: checkout,
      privateKeySecretRef: { type: 'secret_ref', secretId, version: 'latest' },
      knownHosts: typeof config.knownHosts === 'string' ? config.knownHosts : null,
      strictHostKeyChecking: true,
    },
    metadata: { workspaceRealizationMode: 'in_place', ...(gate ? { crewLoadGate: gate } : {}) },
  };
}

/** Bản ghim Superpowers mà máy của run báo (`superpowers.pinDir`). */
async function pinDirOf(ctx: AddProjectContext, run: SetupRun): Promise<string> {
  const machines = await ctx.api.crew.machines(run.companyId);
  const machine = Array.isArray(machines)
    ? (machines as { machineId?: unknown; latest?: { superpowers?: { pinDir?: unknown } } }[]).find(
        (m) => m?.machineId === run.machineId,
      )
    : undefined;
  const pinDir = machine?.latest?.superpowers?.pinDir;
  if (typeof pinDir !== 'string' || pinDir === '') throw new StepError('errors.noPinDir');
  return pinDir;
}

type StepWork = (
  ctx: AddProjectContext,
  run: SetupRun,
  refs: Record<string, string>,
) => Promise<{ projectId?: string }>;

const STEPS: Record<AddProjectStepId, StepWork> = {
  async inspect(ctx, run, refs) {
    const input = inputOf(run);
    const result = resultOf(
      await runJob(ctx, run, { kind: 'inspect-folder', folder: input.folder }, true),
      'inspect-folder',
    );
    if (result.root.length <= REF_MAX) refs.root = result.root;
    if (result.branch && result.branch.length <= REF_MAX) refs.branch = result.branch;
    return {};
  },

  async project(ctx, run, refs) {
    const name = inputOf(run).name.trim();
    if (!refs.project) {
      // Response tạo project bị mất ở lần trước: project cùng tên tạo sau khi run bắt đầu là của run này.
      const lost = (await ctx.api.projects.list(run.companyId)).find(
        (p) => p.name === name && !p.archivedAt && isTime(p.createdAt) >= isTime(run.createdAt),
      );
      refs.project = lost?.id ?? (await ctx.api.projects.create(run.companyId, { name })).id;
    }
    return { projectId: refs.project };
  },

  async checkouts(ctx, run, refs) {
    const input = inputOf(run);
    // Máy đọc projectId từ setup run để thêm repo vào bản tin docs: bước project phải xong trước.
    if (!run.projectId) throw new StepError('errors.noProject');
    const all = runRefs(run);
    const slots = projectSlots(input.executors);
    const payload: WizardJobPayload = {
      kind: 'prepare-checkouts',
      projectKey: input.key,
      folder: all.root ?? input.folder,
      roles: slots.map((role) => ({ role, branch: slotBranch(input.key, role) })),
    };
    const result = resultOf(await runJob(ctx, run, payload, true), 'prepare-checkouts');
    for (const slot of slots) {
      const path = result.checkouts.find((c) => c.role === slot)?.path;
      if (!path) throw new StepError('errors.checkoutMissing', { role: slot });
      refs[`checkout_${slot}`] = path;
    }
    return {};
  },

  async environments(ctx, run, refs) {
    const input = inputOf(run);
    const all = { ...runRefs(run), ...refs };
    const envs = await ctx.api.environments.list(run.companyId);
    let template: EnvironmentRow | null = null;
    for (const slot of projectSlots(input.executors)) {
      const key = `environment_${slot}`;
      if (refs[key] ?? all[key]) {
        refs[key] = refs[key] ?? all[key];
        continue;
      }
      const checkout = required(all, `checkout_${slot}`);
      const name = slotName(input.key, slot);
      const lost = envs.find(
        (env) => env.name === name && env.status === 'active' && env.config.remoteWorkspacePath === checkout,
      );
      if (lost) {
        refs[key] = lost.id;
        continue;
      }
      template ??= pickTemplate(envs);
      if (!template) throw new StepError('errors.noTemplate');
      const description = ctx.t('addProject.environmentDescription', { role: slot, project: input.name.trim() });
      refs[key] = (
        await ctx.api.environments.create(run.companyId, environmentBody(template, name, checkout, description))
      ).id;
    }
    return {};
  },

  async agents(ctx, run, refs) {
    const input = inputOf(run);
    const { api } = ctx;
    const companyId = run.companyId;
    const all = { ...runRefs(run), ...refs };
    const slots = projectSlots(input.executors);
    const pinDir = await pinDirOf(ctx, run);
    const existing = await api.agents.list(companyId);

    for (const slot of slots) {
      const key = `agent_${slot}`;
      if (!refs[key] && all[key]) refs[key] = all[key];
      const environmentId = required(all, `environment_${slot}`);
      const name = slotName(input.key, slot);
      if (!refs[key]) {
        // Response tạo agent bị mất ở lần trước: nhận ra bằng tên và environment riêng của ô.
        const lost = existing.find(
          (a) => a.name === name && a.defaultEnvironmentId === environmentId && a.status !== 'terminated',
        );
        const role = roleOfSlot(slot);
        const body = { ...crewAgentCreateBody({ name, role, model: ROLE_MODELS[role], pinDir, environmentId }) };
        refs[key] = lost?.id ?? (await api.agents.create(companyId, body)).id;
      }
      await api.agents.setPermissions?.(
        refs[key],
        { ...CREW_AGENT_PERMISSIONS, canAssignTasks: slot === 'assistant' },
        companyId,
      );
    }

    const executorIds = slots.filter((s) => roleOfSlot(s) === 'executor').map((s) => refs[`agent_${s}`]);
    for (const slot of slots) {
      const agentId = refs[`agent_${slot}`];
      const role = roleOfSlot(slot);
      const content = renderInstructions(role, { agentId, ...(role === 'assistant' ? { executorIds } : {}) });
      const saved = await putInstructions(api, agentId, content, { companyId });
      if (!saved.ok) throw new StepError('errors.instructionsConflict', { name: slotName(input.key, slot) });
      refs[`instructions_${slot}`] = saved.hash;
    }
    return {};
  },

  async roles(ctx, run) {
    const input = inputOf(run);
    if (!run.projectId) throw new StepError('errors.noProject');
    const all = runRefs(run);
    const slots = projectSlots(input.executors);
    await ctx.api.roles.set(run.companyId, run.projectId, {
      assistantAgentId: required(all, 'agent_assistant'),
      executorAgentIds: slots.filter((s) => roleOfSlot(s) === 'executor').map((s) => required(all, `agent_${s}`)),
      reviewerAgentId: required(all, 'agent_reviewer'),
      integratorAgentId: required(all, 'agent_integrator'),
    });
    return {};
  },

  async check(ctx, run) {
    const input = inputOf(run);
    const result = resultOf(await runJob(ctx, run, { kind: 'check', projectKey: input.key }, false), 'check');
    const bad = result.items.filter((i) => i.status === 'error');
    if (bad.length > 0) throw new StepError('errors.checkFailed', { items: bad.map((i) => i.title).join('; ') });
    // Kiểm đạt: agent của run đang tạm dừng (do lỗi ở lần chạy trước) được chạy lại.
    const ids = agentIdsOf(runRefs(run));
    for (const agent of await ctx.api.agents.list(run.companyId)) {
      if (ids.has(agent.id) && agent.status === 'paused') await ctx.api.agents.resume(agent.id, run.companyId);
    }
    return {};
  },
};

const agentIdsOf = (refs: Record<string, string>) =>
  new Set(Object.entries(refs).flatMap(([k, v]) => (k.startsWith('agent_') ? [v] : [])));

/**
 * Sau lỗi: tạm dừng agent của run đang chạy được. Agent chờ duyệt thì để nguyên (pause sẽ bỏ qua bước duyệt), agent đã
 * dừng hẳn thì thôi. Không xóa gì.
 */
async function pauseOwnAgents(ctx: AddProjectContext, companyId: string, refs: Record<string, string>) {
  const ids = agentIdsOf(refs);
  if (ids.size === 0) return;
  let rows: AgentRow[];
  try {
    rows = await ctx.api.agents.list(companyId);
  } catch {
    rows = [...ids].map((id) => ({ id, name: '', status: 'unknown' }));
  }
  for (const agent of rows) {
    if (!ids.has(agent.id) || ['paused', 'terminated', 'pending_approval'].includes(agent.status)) continue;
    await ctx.api.agents.pause(agent.id, companyId).catch(() => undefined);
  }
}

const statusOf = (error: unknown) => (error instanceof ApiError ? error.status : undefined);

/** Chạy một bước. Bước đã `done` thì trả run nguyên vẹn. 409 khi begin → StepBusyError. */
export async function runAddProjectStep(
  ctx: AddProjectContext,
  run: SetupRun,
  stepId: AddProjectStepId,
): Promise<SetupRun> {
  if (run.steps[stepId]?.status === 'done') return run;
  const companyId = run.companyId;
  let current: SetupRun;
  try {
    current = await ctx.api.setup.begin(companyId, run.id, stepId);
  } catch (error) {
    if (statusOf(error) === 409) throw new StepBusyError((error as Error).message);
    throw error;
  }
  ctx.onStep?.(stepId);
  const refs: Record<string, string> = { ...(current.steps[stepId]?.refs ?? {}) };
  try {
    const extra = await STEPS[stepId](ctx, current, refs);
    return await ctx.api.setup.finish(companyId, run.id, stepId, {
      status: 'done',
      ...(Object.keys(refs).length > 0 ? { refs } : {}),
      ...extra,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    let failed: SetupRun | null = null;
    try {
      failed = await ctx.api.setup.finish(companyId, run.id, stepId, {
        status: 'failed',
        error: stepErrorText(ctx.t, error),
        ...(Object.keys(refs).length > 0 ? { refs } : {}),
      });
    } catch {
      // Không ghi được trạng thái lỗi (mất khóa, mạng): vẫn tạm dừng agent rồi báo lỗi gốc.
    }
    await pauseOwnAgents(ctx, companyId, { ...runRefs(current), ...refs });
    if (failed) return failed;
    throw error;
  }
}

/** Chạy từ bước đầu chưa xong tới hết, dừng ở bước lỗi. */
export async function runAddProject(ctx: AddProjectContext, run: SetupRun): Promise<SetupRun> {
  let current = run;
  for (const step of ADD_PROJECT_STEPS) {
    if (current.steps[step]?.status === 'done') continue;
    current = await runAddProjectStep(ctx, current, step);
    ctx.onRun?.(current);
    if (current.steps[step]?.status !== 'done') break;
  }
  return current;
}

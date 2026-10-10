// Gỡ project (S8.7, F10) như một setup run `remove-project`: pause agent → xóa dòng vai trò → archive environment riêng
// → gỡ checkout trên máy → archive project. Khung bước (khóa `lockToken`, refs, "Chạy tiếp" từ bước lỗi) dùng chung với
// wizard thêm project. Không bao giờ DELETE agent/project/environment, không terminate, không hủy issue đang mở; checkout
// còn việc chưa commit được máy giữ lại và báo. Project archive sau cùng: lỗi giữa chừng thì project vẫn hiện để chạy tiếp.
import type { CrewRoleSlot, ProjectRoles, RemoveProjectInput, SetupRun, SetupStepId } from '@/api';
import {
  type AddProjectApi,
  type AgentRow,
  type EnvironmentRow,
  executeStep,
  resultOf,
  runJob,
  StepError,
  type Translate,
} from '../add-project/run-step';
import { exclusiveEnvironments } from './exclusive-environments';

/** Thứ tự bước remove-project, cùng danh sách bước của plugin; bước cuối `project` làm run thành done. */
export const REMOVE_PROJECT_STEPS = [
  'pause-agents',
  'roles',
  'environments',
  'checkouts',
  'project',
] as const satisfies readonly SetupStepId[];
export type RemoveProjectStepId = (typeof REMOVE_PROJECT_STEPS)[number];

export const ROLE_SLOTS: readonly CrewRoleSlot[] = ['assistant', 'executor', 'executor-2', 'reviewer', 'integrator'];

/** Phần của `api` (src/api) mà lần gỡ gọi. `api` của web khớp kiểu này. */
export interface RemoveApi {
  setup: AddProjectApi['setup'];
  jobs: AddProjectApi['jobs'];
  agents: {
    list(companyId: string): Promise<AgentRow[]>;
    pause(id: string, companyId?: string): Promise<unknown>;
  };
  environments: {
    list(companyId: string): Promise<EnvironmentRow[]>;
    /** PATCH `{status:'archived'}`; không có hàm xóa. */
    archive(environmentId: string): Promise<unknown>;
  };
  roles: { get(companyId: string, projectId: string): Promise<ProjectRoles | null> };
}

export interface RemoveProjectApi extends RemoveApi {
  roles: RemoveApi['roles'] & { remove(companyId: string, projectId: string): Promise<unknown> };
  projects: {
    get(id: string, companyId?: string): Promise<{ id: string; archivedAt?: string | Date | null }>;
    /** PATCH `{archivedAt}`; không có hàm xóa. */
    archive(id: string, companyId?: string): Promise<unknown>;
  };
}

export interface RemoveContext<A> {
  api: A;
  /** Dịch khóa namespace `wizards` thành câu lỗi lưu vào setup run. */
  t: Translate;
  signal?: AbortSignal;
  pollMs?: number;
  onStep?: (step: SetupStepId) => void;
  onRun?: (run: SetupRun) => void;
}

export function projectInputOf(run: SetupRun): RemoveProjectInput {
  if (run.kind !== 'remove-project') throw new StepError('remove.errors.wrongKind');
  return run.input as RemoveProjectInput;
}

/** Agent tạm dừng được: chưa dừng, chưa terminated; agent chờ duyệt không chạy nên để nguyên (pause bỏ qua bước duyệt). */
export const pausable = (status: string) => !['paused', 'terminated', 'pending_approval'].includes(status);

export interface KeptCheckout {
  role: CrewRoleSlot;
  path: string;
  reason: string;
}

/**
 * Xếp việc `remove-checkouts` cho máy của run rồi chờ (việc của lần trước còn chờ hay đã xong thì dùng lại). Checkout
 * máy giữ lại (bẩn, đang dùng, không phải worktree, git lỗi) không làm bước lỗi: ghi `kept_<ô>` (lý do) và
 * `keptPath_<ô>` vào refs để trang hiện cảnh báo kèm lệnh tự gỡ.
 */
export async function removeCheckouts(
  ctx: RemoveContext<RemoveApi>,
  run: SetupRun,
  refs: Record<string, string>,
  payload: { projectId: string; roles: CrewRoleSlot[]; removeStatusRepo: boolean },
) {
  const result = resultOf(
    await runJob(ctx, run, { kind: 'remove-checkouts', ...payload, projectKey: run.projectKey }, true),
    'remove-checkouts',
  );
  const jobs = await ctx.api.jobs.list(run.companyId, { machineId: run.machineId, setupRunId: run.id, limit: 100 });
  const done = jobs.find((j) => j.kind === 'remove-checkouts' && j.status === 'done');
  if (done) refs.job = done.id;
  for (const kept of result.kept) {
    refs[`kept_${kept.role}`] = kept.reason;
    if (kept.path.length <= 200) refs[`keptPath_${kept.role}`] = kept.path;
  }
}

/** Checkout máy giữ lại ở bước gỡ checkout (`checkouts` hay `checkout`) của run. */
export function keptCheckouts(run: SetupRun): KeptCheckout[] {
  const refs = { ...(run.steps.checkouts?.refs ?? {}), ...(run.steps.checkout?.refs ?? {}) };
  return ROLE_SLOTS.flatMap((role) => {
    const reason = refs[`kept_${role}`];
    return reason ? [{ role, path: refs[`keptPath_${role}`] ?? '', reason }] : [];
  });
}

/** Agent trong vai trò, theo ô (đọc ở bước đầu; các bước sau dùng refs vì vai trò đã bị xóa). */
function scopeOf(run: SetupRun): { slot: CrewRoleSlot; agentId: string }[] {
  const refs = run.steps['pause-agents']?.refs ?? {};
  return ROLE_SLOTS.flatMap((slot) => (refs[`agent_${slot}`] ? [{ slot, agentId: refs[`agent_${slot}`] }] : []));
}

function slotAgents(roles: ProjectRoles): [CrewRoleSlot, string | undefined][] {
  return [
    ['assistant', roles.assistantAgentId],
    ['executor', roles.executorAgentIds[0]],
    ['executor-2', roles.executorAgentIds[1]],
    ['reviewer', roles.reviewerAgentId],
    ['integrator', roles.integratorAgentId],
  ];
}

type StepWork = (ctx: RemoveContext<RemoveProjectApi>, run: SetupRun, refs: Record<string, string>) => Promise<void>;

const STEPS: Record<RemoveProjectStepId, StepWork> = {
  async 'pause-agents'(ctx, run, refs) {
    const { projectId } = projectInputOf(run);
    const roles = await ctx.api.roles.get(run.companyId, projectId);
    if (roles) {
      for (const [slot, agentId] of slotAgents(roles)) if (agentId) refs[`agent_${slot}`] ??= agentId;
    }
    const agents = await ctx.api.agents.list(run.companyId);
    for (const slot of ROLE_SLOTS) {
      const agentId = refs[`agent_${slot}`];
      const agent = agentId ? agents.find((a) => a.id === agentId) : undefined;
      // Hủy run đang chạy của agent (route pause); ghi ngay để lần lỗi sau vẫn biết agent nào đã pause.
      if (!agent || !pausable(agent.status)) continue;
      await ctx.api.agents.pause(agent.id, run.companyId);
      refs[`paused_${slot}`] = agent.id;
    }
  },

  async roles(ctx, run) {
    const { projectId } = projectInputOf(run);
    if (await ctx.api.roles.get(run.companyId, projectId)) await ctx.api.roles.remove(run.companyId, projectId);
  },

  async environments(ctx, run, refs) {
    const scope = scopeOf(run);
    if (scope.length === 0) return;
    const [environments, agents] = await Promise.all([
      ctx.api.environments.list(run.companyId),
      ctx.api.agents.list(run.companyId),
    ]);
    const targets = exclusiveEnvironments({
      environments,
      agents,
      scope: scope.map((s) => s.agentId),
      projectKey: run.projectKey,
    });
    for (const { agentId, environmentId } of targets) {
      await ctx.api.environments.archive(environmentId);
      const slot = scope.find((s) => s.agentId === agentId)?.slot;
      if (slot) refs[`environment_${slot}`] = environmentId;
    }
  },

  async checkouts(ctx, run, refs) {
    // Mọi ô của khóa: ô không có checkout thì máy báo `absent`; checkout sót của agent cũ cũng được dọn.
    await removeCheckouts(ctx, run, refs, {
      projectId: projectInputOf(run).projectId,
      roles: [...ROLE_SLOTS],
      removeStatusRepo: true,
    });
  },

  async project(ctx, run) {
    const { projectId } = projectInputOf(run);
    // Response archive bị mất ở lần trước: project đã archive thì giữ mốc cũ.
    const project = await ctx.api.projects.get(projectId, run.companyId);
    if (!project.archivedAt) await ctx.api.projects.archive(projectId, run.companyId);
  },
};

/** Chạy một bước. Bước đã `done` thì trả run nguyên vẹn (không pause lại agent owner đã chạy lại tay). */
export function runRemoveProjectStep(
  ctx: RemoveContext<RemoveProjectApi>,
  run: SetupRun,
  stepId: RemoveProjectStepId,
): Promise<SetupRun> {
  return executeStep({
    api: ctx.api,
    t: ctx.t,
    run,
    stepId,
    onStep: () => ctx.onStep?.(stepId),
    work: async (current, refs) => {
      await STEPS[stepId](ctx, current, refs);
      return {};
    },
    // Lần gỡ không tạo gì nên lỗi không có gì để dọn hay tạm dừng thêm.
    onFail: async () => {},
  });
}

/** Chạy các bước theo `steps` từ bước đầu chưa xong, dừng ở bước lỗi. */
export async function runSteps<S extends SetupStepId>(
  ctx: { onRun?: (run: SetupRun) => void },
  run: SetupRun,
  steps: readonly S[],
  runStep: (run: SetupRun, step: S) => Promise<SetupRun>,
): Promise<SetupRun> {
  let current = run;
  for (const step of steps) {
    if (current.steps[step]?.status === 'done') continue;
    current = await runStep(current, step);
    ctx.onRun?.(current);
    if (current.steps[step]?.status !== 'done') break;
  }
  return current;
}

export function runRemoveProject(ctx: RemoveContext<RemoveProjectApi>, run: SetupRun): Promise<SetupRun> {
  return runSteps(ctx, run, REMOVE_PROJECT_STEPS, (current, step) => runRemoveProjectStep(ctx, current, step));
}

// Chạy từng bước wizard tạo agent (S13): tạo agent → ghim + AGENTS.md → environment → checkout trên máy → ghi vai trò →
// render lại AGENTS.md của Trợ Lý nếu danh sách executor đổi. Khung bước (khóa, refs, lỗi) dùng chung với thêm project.
// Mỗi bước kiểm trước rồi chỉ ghi phần chưa đạt, nên "Chạy tiếp" và chế độ sửa (agent do app tạo) dùng cùng code.
// Mọi lời gọi mang companyId của setup run. Lỗi thì tạm dừng agent do chính wizard tạo; agent có sẵn không bị đụng.
import type { AddAgentInput, CrewRoleSlot, ProjectRoles, SetupRun } from '@/api';
import {
  checkAdapter,
  checkEnvironment,
  checkPin,
  type ReadinessAgent,
  type ReadinessEnvironment,
} from '@/features/readiness';
import {
  assistantListsMatch,
  CREW_AGENT_PERMISSIONS,
  CREW_RUNTIME_CONFIG,
  crewAgentCreateBody,
  crewExtraArgsOf,
  crewRuntimeConfigOf,
  crewWrapperCommand,
  INSTRUCTIONS_PATH,
  isRuntimeSlot,
  putInstructions,
  RUNTIME_SLOT_KEYS,
  renderAssistantFor,
  renderInstructions,
  roleOfSlot,
  runtimeOfSlot,
  SUPERPOWERS_PIN_RE,
} from '@/lib/instructions';
import {
  type AddProjectApi,
  beginStep,
  environmentBody,
  executeStep,
  isTime,
  lockOf,
  pauseAgents,
  pickTemplate,
  pinDirOf,
  required,
  resultOf,
  runJob,
  StepError,
  type Translate,
} from '../add-project/run-step';
import { slotBranch, slotName } from '../add-project/steps';
import { ADD_AGENT_STEPS, type AddAgentStepId, slotCheckout } from './steps';

type AgentDetail = ReadinessAgent & { name: string };

/** Phần của `api` (src/api) mà wizard tạo agent gọi. `api` của web khớp kiểu này. */
export interface AddAgentApi {
  setup: AddProjectApi['setup'];
  jobs: AddProjectApi['jobs'];
  environments: AddProjectApi['environments'];
  projects: Pick<AddProjectApi['projects'], 'list'>;
  agents: AddProjectApi['agents'] & {
    get(id: string, companyId?: string): Promise<AgentDetail>;
    update(id: string, body: Record<string, unknown>, companyId?: string): Promise<unknown>;
  };
  roles: {
    get(companyId: string, projectId: string): Promise<ProjectRoles | null>;
    set(companyId: string, projectId: string, roles: ProjectRoles): Promise<unknown>;
  };
  crew: { machines(companyId: string): Promise<unknown> };
}

export interface AddAgentContext {
  api: AddAgentApi;
  /** Dịch khóa namespace `wizards` thành câu lỗi lưu vào setup run. */
  t: Translate;
  signal?: AbortSignal;
  pollMs?: number;
  /**
   * Giá trị người dùng nhập ở form (`folder`), agent cần sửa (`agent`) và `rewrite: 'true'` khi sửa vì AGENTS.md lệch
   * (A3), ghi vào refs của bước `agent` để lần chạy tiếp ở trình duyệt khác vẫn có. Refs đã lưu luôn thắng.
   */
  seed?: AddAgentSeed;
  onStep?: (step: AddAgentStepId) => void;
  onRun?: (run: SetupRun) => void;
}

export interface AddAgentSeed {
  folder?: string;
  agent?: string;
  rewrite?: string;
}

/** Refs bước `agent` lấy từ seed (chế độ sửa): id agent, folder, cờ ghi lại AGENTS.md. */
function seedRefs(seed: AddAgentSeed | undefined): Record<string, string> {
  return {
    ...(seed?.folder ? { folder: seed.folder } : {}),
    ...(seed?.rewrite === 'true' ? { rewrite: 'true' } : {}),
  };
}

export function agentInputOf(run: SetupRun): AddAgentInput {
  if (run.kind !== 'add-agent') throw new StepError('errors.wrongAgentKind');
  return run.input as AddAgentInput;
}

/** Refs của mọi bước add-agent (kể cả bước lỗi còn giữ id đã tạo), theo thứ tự bước. */
export function agentRunRefs(run: SetupRun): Record<string, string> {
  const refs: Record<string, string> = {};
  for (const step of ADD_AGENT_STEPS) Object.assign(refs, run.steps[step]?.refs ?? {});
  return refs;
}

/** Home của máy suy từ bản ghim Superpowers (`<home>/.crew/workflows/superpowers/<bản>`). */
function homeOf(pinDir: string): string {
  const home = SUPERPOWERS_PIN_RE.exec(pinDir)?.[1];
  if (!home) throw new StepError('errors.noPinDir');
  return home;
}

async function rolesOf(ctx: AddAgentContext, run: SetupRun): Promise<ProjectRoles> {
  const roles = await ctx.api.roles.get(run.companyId, agentInputOf(run).projectId);
  if (!roles) throw new StepError('errors.noRoles');
  return roles;
}

/** Vai trò mới khi đặt `agentId` vào `slot` (thay agent cũ của ô, executor-2 chưa có thì thêm). */
export function withSlot(roles: ProjectRoles, slot: CrewRoleSlot, agentId: string): ProjectRoles {
  if (isRuntimeSlot(slot)) return { ...roles, [RUNTIME_SLOT_KEYS[slot]]: agentId };
  const executors = [...roles.executorAgentIds];
  if (slot === 'executor') executors[0] = agentId;
  if (slot === 'executor-2') executors[executors.length >= 2 ? 1 : executors.length] = agentId;
  return {
    ...roles,
    assistantAgentId: slot === 'assistant' ? agentId : roles.assistantAgentId,
    executorAgentIds: executors,
    reviewerAgentId: slot === 'reviewer' ? agentId : roles.reviewerAgentId,
    integratorAgentId: slot === 'integrator' ? agentId : roles.integratorAgentId,
  };
}

const sameIds = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id, i) => id.toLowerCase() === b[i]?.toLowerCase());

const sameRoles = (a: ProjectRoles, b: ProjectRoles) =>
  a.assistantAgentId === b.assistantAgentId &&
  sameIds(a.executorAgentIds, b.executorAgentIds) &&
  a.reviewerAgentId === b.reviewerAgentId &&
  a.integratorAgentId === b.integratorAgentId &&
  Object.values(RUNTIME_SLOT_KEYS).every((key) => (a[key] ?? null) === (b[key] ?? null));

const statusOf = (error: unknown): number | undefined =>
  typeof error === 'object' && error !== null ? (error as { status?: number }).status : undefined;

/** AGENTS.md hiện tại của agent; chưa có file thì rỗng. */
async function currentInstructions(ctx: AddAgentContext, agentId: string, companyId: string): Promise<string> {
  try {
    return (await ctx.api.agents.instructionsFile(agentId, INSTRUCTIONS_PATH, companyId)).content;
  } catch (error) {
    if (statusOf(error) === 404) return '';
    throw error;
  }
}

/**
 * Render AGENTS.md cho Trợ Lý `agentId`: executor (kèm runtime) và reviewer Codex theo vai trò, agent BMAD giữ như file
 * Trợ Lý hiện tại. Trợ Lý mới vốn là executor thì bỏ khỏi danh sách executor.
 */
async function assistantContent(
  ctx: AddAgentContext,
  run: SetupRun,
  agentId: string,
  roles: ProjectRoles,
): Promise<{ content: string; current: string }> {
  const current = await currentInstructions(ctx, roles.assistantAgentId, run.companyId);
  const content = renderAssistantFor(
    { ...roles, assistantAgentId: agentId, executorAgentIds: roles.executorAgentIds.filter((id) => id !== agentId) },
    current,
  );
  return { content, current };
}

async function writeInstructions(ctx: AddAgentContext, run: SetupRun, agentId: string, content: string) {
  const saved = await putInstructions(ctx.api, agentId, content, { companyId: run.companyId });
  if (!saved.ok) throw new StepError('errors.instructionsConflict', { name: agentInputOf(run).name });
  return saved.hash;
}

/**
 * PATCH (merge) phần cấu hình chạy Crew của agent có sẵn ở chế độ sửa (A1), trừ command/extraArgs (bước ghim lo) và
 * model (giữ model đang dùng). Claude: `engine` + `env` rỗng; Codex: bỏ sandbox + CODEX_HOME; OpenCode: `env` rỗng.
 */
function adapterFix(slot: CrewRoleSlot, pinDir: string, projectKey: string): Record<string, unknown> {
  const {
    command: _command,
    extraArgs: _extraArgs,
    ...rest
  } = crewRuntimeConfigOf(slot, pinDir, projectKey) as Record<string, unknown>;
  if (runtimeOfSlot(slot) === 'codex_local') {
    const { modelReasoningEffort: _effort, ...codex } = rest;
    return codex;
  }
  return rest;
}

type StepWork = (ctx: AddAgentContext, run: SetupRun, refs: Record<string, string>) => Promise<void>;

const STEPS: Record<AddAgentStepId, StepWork> = {
  async agent(ctx, run, refs) {
    const input = agentInputOf(run);
    const { api } = ctx;
    const companyId = run.companyId;
    const saved = agentRunRefs(run);
    const seeded = seedRefs(ctx.seed);
    for (const key of ['folder', 'rewrite']) {
      const value = refs[key] ?? saved[key] ?? seeded[key];
      if (value) refs[key] = value;
    }
    const pinDir = await pinDirOf(api, run);
    let agentId = refs.agent ?? saved.agent ?? ctx.seed?.agent;

    if (!agentId) {
      const name = input.name.trim();
      const same = (await api.agents.list(companyId)).filter((a) => a.name === name && a.status !== 'terminated');
      // Response tạo agent bị mất ở lần trước: agent cùng tên tạo sau khi run bắt đầu là của run này.
      const lost = same.find((a) => isTime(a.createdAt) >= isTime(run.createdAt));
      if (!lost && same.length > 0) throw new StepError('errors.agentNameTaken', { name });
      agentId =
        lost?.id ??
        (
          await api.agents.create(companyId, {
            ...crewAgentCreateBody({ name, slot: input.slot, model: input.model, pinDir, projectKey: run.projectKey }),
          })
        ).id;
      refs.agent = agentId;
      refs.created = 'true';
    } else {
      refs.agent = agentId;
      // Agent có sẵn (chế độ sửa): chỉ PATCH (merge) phần cấu hình chạy chưa đạt, giữ model đang dùng.
      const agent = await api.agents.get(agentId, companyId);
      const expected = runtimeOfSlot(input.slot);
      if (agent.adapterType !== expected) {
        if (expected === 'claude_local') throw new StepError('errors.notClaudeLocal');
        throw new StepError('errors.wrongAdapter', { expected, actual: agent.adapterType });
      }
      if (!checkAdapter(agent, expected)) {
        const model = agent.adapterConfig.model;
        const runtime = agent.runtimeConfig ?? {};
        const heartbeat = runtime.heartbeat;
        await api.agents.update(
          agentId,
          {
            adapterConfig: {
              ...adapterFix(input.slot, pinDir, run.projectKey),
              ...(typeof model === 'string' && model !== '' ? {} : { model: input.model }),
            },
            runtimeConfig: {
              ...runtime,
              heartbeat: {
                ...(typeof heartbeat === 'object' && heartbeat !== null ? heartbeat : {}),
                ...CREW_RUNTIME_CONFIG.heartbeat,
              },
            },
          },
          companyId,
        );
      }
    }
    // Paperclip tự cấp quyền giao việc cho agent mới: đặt lại để chỉ Trợ Lý giữ.
    await api.agents.setPermissions?.(
      agentId,
      { ...CREW_AGENT_PERMISSIONS, canAssignTasks: input.slot === 'assistant' },
      companyId,
    );
  },

  async pin(ctx, run, refs) {
    const input = agentInputOf(run);
    const companyId = run.companyId;
    const agentId = required(agentRunRefs(run), 'agent');
    const pinDir = await pinDirOf(ctx.api, run);
    const agent = await ctx.api.agents.get(agentId, companyId);
    const runtime = runtimeOfSlot(input.slot);
    if (!checkPin(agent, { superpowers: { pinned: null, pinDir } }, runtime)) {
      await ctx.api.agents.update(
        agentId,
        {
          adapterConfig: {
            command: crewWrapperCommand(pinDir, runtime),
            extraArgs: crewExtraArgsOf(pinDir, runtime),
          },
        },
        companyId,
      );
    }
    const saved = agentRunRefs(run);
    // Agent có sẵn (chế độ sửa) đang có AGENTS.md mà không lệch (A3 đạt): giữ nguyên phần owner sửa tay.
    if (saved.created !== 'true' && saved.rewrite !== 'true') {
      if ((await currentInstructions(ctx, agentId, companyId)) !== '') return;
    }
    const role = roleOfSlot(input.slot);
    const content =
      role === 'assistant'
        ? (await assistantContent(ctx, run, agentId, await rolesOf(ctx, run))).content
        : renderInstructions(role, { agentId });
    refs.instructions = await writeInstructions(ctx, run, agentId, content);
  },

  async environment(ctx, run, refs) {
    const input = agentInputOf(run);
    const { api } = ctx;
    const companyId = run.companyId;
    const saved = agentRunRefs(run);
    const agentId = required(saved, 'agent');
    const checkout = slotCheckout(homeOf(await pinDirOf(api, run)), run.projectKey, input.slot);
    const agent = await api.agents.get(agentId, companyId);
    let environmentId = refs.environment ?? saved.environment;
    if (!environmentId) {
      const envs = await api.environments.list(companyId);
      const name = slotName(run.projectKey, input.slot);
      // Environment đang dùng đã đúng checkout thì giữ; rồi tới environment của ô (cùng tên, cùng checkout) — một
      // checkout chỉ cần một environment, kể cả khi thay agent của ô.
      const ok = (env: (typeof envs)[number]) => checkEnvironment(env as ReadinessEnvironment, checkout);
      const reuse =
        envs.find((env) => env.id === agent.defaultEnvironmentId && ok(env)) ??
        envs.find((env) => env.name === name && ok(env));
      if (reuse) {
        environmentId = reuse.id;
      } else {
        const template = pickTemplate(envs);
        if (!template) throw new StepError('errors.noTemplate');
        const description = ctx.t('addAgent.environmentDescription', { role: input.slot, project: run.projectKey });
        environmentId = (
          await api.environments.create(companyId, environmentBody(template, name, checkout, description))
        ).id;
      }
    }
    refs.environment = environmentId;
    refs.checkout = checkout;
    if (agent.defaultEnvironmentId !== environmentId) {
      await api.agents.update(agentId, { defaultEnvironmentId: environmentId }, companyId);
    }
  },

  async workspace(ctx, run, refs) {
    const input = agentInputOf(run);
    const saved = agentRunRefs(run);
    const folder = saved.folder;
    if (!folder) throw new StepError('errors.noFolder');
    const result = resultOf(
      await runJob(
        ctx,
        run,
        {
          kind: 'agent-workspace',
          projectKey: run.projectKey,
          folder,
          role: input.slot,
          branch: slotBranch(run.projectKey, input.slot),
        },
        true,
      ),
      'agent-workspace',
    );
    if (saved.checkout && result.path !== saved.checkout) {
      throw new StepError('errors.checkoutMismatch', { path: result.path, expected: saved.checkout });
    }
    refs.checkout = result.path;
  },

  async role(ctx, run, refs) {
    const input = agentInputOf(run);
    const agentId = required(agentRunRefs(run), 'agent');
    const roles = await rolesOf(ctx, run);
    // Trợ Lý bị thay: nhớ id trước khi ghi vai trò để lần chạy tiếp (vai trò đã lưu) vẫn bỏ được quyền giao việc.
    if (input.slot === 'assistant' && roles.assistantAgentId !== agentId) refs.replaced = roles.assistantAgentId;
    const next = withSlot(roles, input.slot, agentId);
    if (!sameRoles(roles, next)) await ctx.api.roles.set(run.companyId, input.projectId, next);
    if (refs.replaced) await dropAssignIfFree(ctx, run, refs.replaced);
  },

  async 'assistant-instructions'(ctx, run, refs) {
    const roles = await rolesOf(ctx, run);
    const assistantId = roles.assistantAgentId;
    // Chỉ ghi khi danh sách executor (kèm runtime) hay reviewer Codex trong AGENTS.md của Trợ Lý khác vai trò hiện tại.
    // Đọc từ file nên lần chạy tiếp sau khi vai trò đã lưu vẫn nhận ra.
    const { content, current } = await assistantContent(ctx, run, assistantId, roles);
    if (!assistantListsMatch(current, roles)) {
      refs.agent_assistant = assistantId;
      refs.instructions_assistant = await writeInstructions(ctx, run, assistantId, content);
    }
    // Xong: agent do wizard tạo mà đã bị tạm dừng ở lần lỗi trước thì chạy lại.
    const saved = agentRunRefs(run);
    if (saved.created === 'true' && saved.agent) {
      const agent = (await ctx.api.agents.list(run.companyId)).find((a) => a.id === saved.agent);
      if (agent?.status === 'paused') await ctx.api.agents.resume(agent.id, run.companyId);
    }
  },
};

/**
 * Trợ Lý cũ không còn là Trợ Lý của project nào (chưa lưu trữ) thì bỏ quyền giao việc. Project không đọc được vai trò
 * thì coi như còn giữ (không bỏ nhầm). Không xóa gì.
 */
async function dropAssignIfFree(ctx: AddAgentContext, run: SetupRun, agentId: string) {
  const projects = (await ctx.api.projects.list(run.companyId)).filter((p) => !p.archivedAt);
  for (const project of projects) {
    let roles: ProjectRoles | null;
    try {
      roles = await ctx.api.roles.get(run.companyId, project.id);
    } catch (error) {
      if (statusOf(error) === 404) continue;
      throw error;
    }
    if (roles?.assistantAgentId === agentId) return;
  }
  await ctx.api.agents.setPermissions?.(agentId, { ...CREW_AGENT_PERMISSIONS, canAssignTasks: false }, run.companyId);
}

/** Chạy một bước. Bước đã `done` thì trả run nguyên vẹn. 409 khi begin → StepBusyError. */
export function runAddAgentStep(ctx: AddAgentContext, run: SetupRun, stepId: AddAgentStepId): Promise<SetupRun> {
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
    onFail: async (current, refs) => {
      const all = { ...agentRunRefs(current), ...refs };
      // Chỉ tạm dừng agent wizard tạo ra; agent có sẵn (chế độ sửa) có thể đang chạy việc thật.
      if (all.created === 'true' && all.agent) await pauseAgents(ctx.api, run.companyId, new Set([all.agent]));
    },
  });
}

/** Chạy từ bước đầu chưa xong tới hết, dừng ở bước lỗi. */
export async function runAddAgent(ctx: AddAgentContext, run: SetupRun): Promise<SetupRun> {
  let current = run;
  for (const step of ADD_AGENT_STEPS) {
    if (current.steps[step]?.status === 'done') continue;
    current = await runAddAgentStep(ctx, current, step);
    ctx.onRun?.(current);
    if (current.steps[step]?.status !== 'done') break;
  }
  return current;
}

/**
 * Chế độ sửa (agent do app tạo, chưa có setup run): ghi các bước trước `step` là `done` mà không làm gì, bước `agent`
 * mang id agent và folder. Sửa từ chính bước `agent` thì không ghi trước; bước đó nhận id qua `ctx.seed.agent`.
 */
export async function prepareFixRun(
  ctx: AddAgentContext,
  run: SetupRun,
  target: { agentId: string; step: AddAgentStepId },
): Promise<SetupRun> {
  let current = run;
  for (const step of ADD_AGENT_STEPS.slice(0, ADD_AGENT_STEPS.indexOf(target.step))) {
    if (current.steps[step]?.status === 'done') continue;
    const begun = await beginStep(ctx.api, run, step);
    const refs = step === 'agent' ? { agent: target.agentId, ...seedRefs(ctx.seed) } : undefined;
    current = await ctx.api.setup.finish(run.companyId, run.id, step, {
      status: 'done',
      ...(refs ? { refs } : {}),
      ...lockOf(begun),
    });
  }
  return current;
}

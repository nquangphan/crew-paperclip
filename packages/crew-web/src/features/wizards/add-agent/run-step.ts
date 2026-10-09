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
  assistantListsOf,
  CREW_AGENT_PERMISSIONS,
  CREW_RUNTIME_CONFIG,
  crewAgentCreateBody,
  crewExtraArgs,
  crewWrapperCommand,
  INSTRUCTIONS_PATH,
  putInstructions,
  renderInstructions,
  roleOfSlot,
  SUPERPOWERS_PIN_RE,
} from '@/lib/instructions';
import {
  type AddProjectApi,
  environmentBody,
  executeStep,
  isTime,
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
   * Giá trị người dùng nhập ở form (`folder`) hoặc agent cần sửa (`agent`), ghi vào refs của bước `agent` để lần chạy
   * tiếp ở trình duyệt khác vẫn có. Refs đã lưu luôn thắng.
   */
  seed?: { folder?: string; agent?: string };
  onStep?: (step: AddAgentStepId) => void;
  onRun?: (run: SetupRun) => void;
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
  const executors = [...roles.executorAgentIds];
  if (slot === 'executor') executors[0] = agentId;
  if (slot === 'executor-2') executors[executors.length >= 2 ? 1 : executors.length] = agentId;
  return {
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
  a.integratorAgentId === b.integratorAgentId;

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

/** Render AGENTS.md cho Trợ Lý: executor theo vai trò, agent BMAD giữ như file Trợ Lý hiện tại. */
async function assistantContent(
  ctx: AddAgentContext,
  run: SetupRun,
  agentId: string,
  roles: ProjectRoles,
): Promise<{ content: string; current: string }> {
  const current = await currentInstructions(ctx, roles.assistantAgentId, run.companyId);
  const executorIds = roles.executorAgentIds.filter((id) => id !== agentId);
  const taken = new Set([agentId, ...executorIds].map((id) => id.toLowerCase()));
  const bmadIds = assistantListsOf(current).bmadIds.filter((id) => !taken.has(id.toLowerCase()));
  return { content: renderInstructions('assistant', { agentId, executorIds, bmadIds }), current };
}

async function writeInstructions(ctx: AddAgentContext, run: SetupRun, agentId: string, content: string) {
  const saved = await putInstructions(ctx.api, agentId, content, { companyId: run.companyId });
  if (!saved.ok) throw new StepError('errors.instructionsConflict', { name: agentInputOf(run).name });
  return saved.hash;
}

type StepWork = (ctx: AddAgentContext, run: SetupRun, refs: Record<string, string>) => Promise<void>;

const STEPS: Record<AddAgentStepId, StepWork> = {
  async agent(ctx, run, refs) {
    const input = agentInputOf(run);
    const { api } = ctx;
    const companyId = run.companyId;
    const saved = agentRunRefs(run);
    const folder = refs.folder ?? saved.folder ?? ctx.seed?.folder;
    if (folder) refs.folder = folder;
    const pinDir = await pinDirOf(api, run);
    let agentId = refs.agent ?? saved.agent ?? ctx.seed?.agent;

    if (!agentId) {
      const name = input.name.trim();
      const same = (await api.agents.list(companyId)).filter((a) => a.name === name && a.status !== 'terminated');
      // Response tạo agent bị mất ở lần trước: agent cùng tên tạo sau khi run bắt đầu là của run này.
      const lost = same.find((a) => isTime(a.createdAt) >= isTime(run.createdAt));
      if (!lost && same.length > 0) throw new StepError('errors.agentNameTaken', { name });
      const role = roleOfSlot(input.slot);
      agentId =
        lost?.id ??
        (await api.agents.create(companyId, { ...crewAgentCreateBody({ name, role, model: input.model, pinDir }) })).id;
      refs.agent = agentId;
      refs.created = 'true';
    } else {
      refs.agent = agentId;
      // Agent có sẵn (chế độ sửa): chỉ PATCH (merge) phần cấu hình chạy chưa đạt, giữ model đang dùng.
      const agent = await api.agents.get(agentId, companyId);
      if (agent.adapterType !== 'claude_local') throw new StepError('errors.notClaudeLocal');
      if (!checkAdapter(agent)) {
        const model = agent.adapterConfig.model;
        const runtime = agent.runtimeConfig ?? {};
        const heartbeat = runtime.heartbeat;
        await api.agents.update(
          agentId,
          {
            adapterConfig: {
              engine: 'cli',
              env: {},
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
    if (!checkPin(agent, { superpowers: { pinned: null, pinDir } })) {
      await ctx.api.agents.update(
        agentId,
        { adapterConfig: { command: crewWrapperCommand(pinDir), extraArgs: crewExtraArgs(pinDir) } },
        companyId,
      );
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

  async role(ctx, run) {
    const input = agentInputOf(run);
    const agentId = required(agentRunRefs(run), 'agent');
    const roles = await rolesOf(ctx, run);
    const next = withSlot(roles, input.slot, agentId);
    if (!sameRoles(roles, next)) await ctx.api.roles.set(run.companyId, input.projectId, next);
  },

  async 'assistant-instructions'(ctx, run, refs) {
    const roles = await rolesOf(ctx, run);
    const assistantId = roles.assistantAgentId;
    // Chỉ ghi khi danh sách executor trong AGENTS.md của Trợ Lý khác vai trò hiện tại (thêm/thay executor). Đọc từ file
    // nên lần chạy tiếp sau khi vai trò đã lưu vẫn nhận ra.
    const { content, current } = await assistantContent(ctx, run, assistantId, roles);
    if (!sameIds(assistantListsOf(current).executorIds, roles.executorAgentIds)) {
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
    await ctx.api.setup.begin(run.companyId, run.id, step);
    const refs =
      step === 'agent'
        ? { agent: target.agentId, ...(ctx.seed?.folder ? { folder: ctx.seed.folder } : {}) }
        : undefined;
    current = await ctx.api.setup.finish(run.companyId, run.id, step, { status: 'done', ...(refs ? { refs } : {}) });
  }
  return current;
}

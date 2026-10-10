// Gỡ agent (S11.9) như một setup run `remove-agent`: ghi vai trò mới bỏ agent + render lại AGENTS.md của Trợ Lý →
// pause → archive environment riêng → gỡ checkout của ô trên máy. Agent không giữ vai trò chỉ có pause và environment.
// Gỡ = pause (đảo ngược được, giữ key và lịch sử run), không bao giờ terminate hay DELETE.
import type { CrewRoleSlot, ProjectRoles, RemoveAgentInput, SetupRun, SetupStepId } from '@/api';
import {
  assistantListsOf,
  INSTRUCTIONS_PATH,
  type InstructionsApi,
  putInstructions,
  renderInstructions,
} from '@/lib/instructions';
import { executeStep, StepError } from '../add-project/run-step';
import { blockOf, rolesWithout, slotOfAgent } from './eligibility';
import { exclusiveEnvironments } from './exclusive-environments';
import {
  pausable,
  REMOVED_AGENT_PERMISSIONS,
  type RemoveApi,
  type RemoveContext,
  removeCheckouts,
  runSteps,
} from './remove-project';

/** Thứ tự bước remove-agent, cùng danh sách bước của plugin; bước cuối làm run thành done. */
export const REMOVE_AGENT_STEPS = [
  'roles',
  'pause-agent',
  'environment',
  'checkout',
] as const satisfies readonly SetupStepId[];
/** Agent không giữ vai trò: không có vai trò để ghi, không có checkout của ô. */
export const REMOVE_AGENT_STEPS_NO_ROLE = ['pause-agent', 'environment'] as const satisfies readonly SetupStepId[];
export type RemoveAgentStepId = (typeof REMOVE_AGENT_STEPS)[number];

export function agentRemoveInputOf(run: SetupRun): RemoveAgentInput {
  if (run.kind !== 'remove-agent') throw new StepError('remove.errors.wrongKind');
  return run.input as RemoveAgentInput;
}

export function removeAgentSteps(run: SetupRun): readonly RemoveAgentStepId[] {
  return agentRemoveInputOf(run).role ? REMOVE_AGENT_STEPS : REMOVE_AGENT_STEPS_NO_ROLE;
}

/** Khóa run cho agent không giữ vai trò (plugin bắt buộc): `agent-<8 hex đầu của id>`. */
export const agentRunKey = (agentId: string) => `agent-${agentId.toLowerCase().slice(0, 8)}`;

/** Phần của `api` (src/api) mà lần gỡ agent gọi. */
export interface RemoveAgentApi extends RemoveApi, InstructionsApi {
  agents: RemoveApi['agents'] & InstructionsApi['agents'];
  roles: RemoveApi['roles'] & { set(companyId: string, projectId: string, roles: ProjectRoles): Promise<unknown> };
}

const statusOf = (error: unknown): number | undefined =>
  typeof error === 'object' && error !== null ? (error as { status?: number }).status : undefined;

const sameIds = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id, i) => id.toLowerCase() === b[i]?.toLowerCase());

async function currentInstructions(api: InstructionsApi, agentId: string, companyId: string): Promise<string> {
  try {
    return (await api.agents.instructionsFile(agentId, INSTRUCTIONS_PATH, companyId)).content;
  } catch (error) {
    if (statusOf(error) === 404) return '';
    throw error;
  }
}

type StepWork = (ctx: RemoveContext<RemoveAgentApi>, run: SetupRun, refs: Record<string, string>) => Promise<void>;

const STEPS: Record<RemoveAgentStepId, StepWork> = {
  async roles(ctx, run, refs) {
    const input = agentRemoveInputOf(run);
    if (!input.projectId) return;
    let roles = await ctx.api.roles.get(run.companyId, input.projectId);
    if (!roles) return;
    const slot = slotOfAgent(roles, input.agentId);
    // Đã bỏ khỏi vai trò ở lần trước (lỗi ở AGENTS.md) thì không ghi lại.
    if (slot) {
      const reason = blockOf(roles, slot);
      if (reason) throw new StepError(`remove.errors.blocked.${reason}`, { name: input.agentName });
      roles = rolesWithout(roles, input.agentId);
      await ctx.api.roles.set(run.companyId, input.projectId, roles);
    }
    // Danh sách executor nằm trong AGENTS.md của Trợ Lý: đọc từ file nên lần chạy tiếp vẫn nhận ra chỗ chưa ghi.
    const assistantId = roles.assistantAgentId;
    const current = await currentInstructions(ctx.api, assistantId, run.companyId);
    const lists = assistantListsOf(current);
    if (sameIds(lists.executorIds, roles.executorAgentIds)) return;
    const taken = new Set([assistantId, ...roles.executorAgentIds].map((id) => id.toLowerCase()));
    const content = renderInstructions('assistant', {
      agentId: assistantId,
      executorIds: roles.executorAgentIds,
      bmadIds: lists.bmadIds.filter((id) => !taken.has(id.toLowerCase())),
    });
    const saved = await putInstructions(ctx.api, assistantId, content, { companyId: run.companyId });
    if (!saved.ok) {
      const assistant = (await ctx.api.agents.list(run.companyId)).find((a) => a.id === assistantId);
      throw new StepError('errors.instructionsConflict', { name: assistant?.name ?? assistantId });
    }
    refs.agent_assistant = assistantId;
    refs.instructions_assistant = saved.hash;
  },

  async 'pause-agent'(ctx, run, refs) {
    const { agentId } = agentRemoveInputOf(run);
    refs.agent = agentId;
    const agent = (await ctx.api.agents.list(run.companyId)).find((a) => a.id.toLowerCase() === agentId.toLowerCase());
    if (!agent) throw new StepError('remove.errors.agentMissing');
    if (agent.status === 'terminated') return;
    if (pausable(agent.status)) {
      await ctx.api.agents.pause(agent.id, run.companyId);
      refs.paused = 'true';
    }
    await ctx.api.agents.setPermissions(agent.id, { ...REMOVED_AGENT_PERMISSIONS }, run.companyId);
  },

  async environment(ctx, run, refs) {
    const input = agentRemoveInputOf(run);
    const [environments, agents] = await Promise.all([
      ctx.api.environments.list(run.companyId),
      ctx.api.agents.list(run.companyId),
    ]);
    const targets = exclusiveEnvironments({
      environments,
      agents,
      scope: [input.agentId],
      projectKey: input.projectId ? run.projectKey : null,
    });
    for (const { environmentId } of targets) {
      await ctx.api.environments.archive(environmentId);
      refs.environment = environmentId;
    }
  },

  async checkout(ctx, run, refs) {
    const input = agentRemoveInputOf(run);
    if (!input.projectId || !input.role) return;
    await removeCheckouts(ctx, run, refs, {
      projectId: input.projectId,
      roles: [input.role as CrewRoleSlot],
      removeStatusRepo: false,
    });
  },
};

export function runRemoveAgentStep(
  ctx: RemoveContext<RemoveAgentApi>,
  run: SetupRun,
  stepId: RemoveAgentStepId,
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
    onFail: async () => {},
  });
}

/** Chạy từ bước đầu chưa xong tới hết, dừng ở bước lỗi. */
export function runRemoveAgent(ctx: RemoveContext<RemoveAgentApi>, run: SetupRun): Promise<SetupRun> {
  return runSteps(ctx, run, removeAgentSteps(run), (current, step) => runRemoveAgentStep(ctx, current, step));
}

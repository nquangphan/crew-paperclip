// Ghi vai trò project rồi, nếu Trợ Lý hoặc tập executor đổi, render lại AGENTS.md của Trợ Lý (danh sách executor nằm
// trong file đó) và PUT có baseHash. Lỗi của POST roles ném nguyên văn để form hiện; PUT xung đột không ghi đè.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type Api, api, type ProjectRoles, queryKeys } from '@/api';
import { useCompany } from '@/app/hooks';
import { bmadIdsOf } from '@/features/readiness/assistant-instructions';
import { INSTRUCTIONS_PATH, putInstructions, renderInstructions } from '@/lib/instructions';

export { bmadIdsOf };
export type InstructionsOutcome = 'ok' | 'conflict' | 'unchanged';
export interface SaveRolesResult {
  roles: 'ok';
  instructions: InstructionsOutcome;
}

const statusOf = (error: unknown): number | undefined =>
  typeof error === 'object' && error !== null ? (error as { status?: number }).status : undefined;

const sameIds = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id, i) => id === b[i]);

/** Render lại AGENTS.md của Trợ Lý theo vai trò mới. Chạy lại được riêng khi lần đầu gặp xung đột. */
export async function syncAssistantInstructions(
  client: Api,
  companyId: string,
  roles: ProjectRoles,
): Promise<InstructionsOutcome> {
  const agentId = roles.assistantAgentId;
  let bmadIds: string[] = [];
  try {
    const current = await client.agents.instructionsFile(agentId, INSTRUCTIONS_PATH, companyId);
    bmadIds = bmadIdsOf(current.content);
  } catch (error) {
    if (statusOf(error) !== 404) throw error;
  }
  const executors = new Set(roles.executorAgentIds.map((id) => id.toLowerCase()));
  const content = renderInstructions('assistant', {
    agentId,
    executorIds: roles.executorAgentIds,
    bmadIds: bmadIds.filter((id) => !executors.has(id.toLowerCase())),
  });
  const res = await putInstructions(client, agentId, content, { companyId });
  if (!res.ok) return 'conflict';
  return res.changed ? 'ok' : 'unchanged';
}

/** Vai trò đã lưu nhưng bước cập nhật AGENTS.md của Trợ Lý lỗi: báo riêng để không nhầm với lỗi lưu vai trò. */
export class InstructionsStepError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'InstructionsStepError';
  }
}

export async function saveRoles(
  client: Api,
  companyId: string,
  projectId: string,
  next: ProjectRoles,
  previous: ProjectRoles | null,
): Promise<SaveRolesResult> {
  await client.roles.set(companyId, projectId, next);
  const changed =
    !previous ||
    previous.assistantAgentId !== next.assistantAgentId ||
    !sameIds(previous.executorAgentIds, next.executorAgentIds);
  if (!changed) return { roles: 'ok', instructions: 'unchanged' };
  try {
    return { roles: 'ok', instructions: await syncAssistantInstructions(client, companyId, next) };
  } catch (error) {
    throw new InstructionsStepError(error);
  }
}

export function useSaveRoles(projectId: string) {
  const { company } = useCompany();
  const queryClient = useQueryClient();
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.roles(projectId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.crew('readiness') });
    void queryClient.invalidateQueries({ queryKey: ['agent'] });
  };
  const save = useMutation({
    mutationFn: (vars: { roles: ProjectRoles; previous: ProjectRoles | null }) =>
      saveRoles(api, company.id, projectId, vars.roles, vars.previous),
    onSettled: refresh,
  });
  const retryInstructions = useMutation({
    mutationFn: (roles: ProjectRoles) => syncAssistantInstructions(api, company.id, roles),
    onSettled: refresh,
  });
  return { save, retryInstructions };
}

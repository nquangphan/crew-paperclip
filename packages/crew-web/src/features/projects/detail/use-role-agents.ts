// Danh sách agent cho form vai trò kèm trạng thái sẵn sàng.
// Agent đang giữ vai trò: lấy từ useProjectReadiness. Agent chưa giữ vai trò nào thì readiness của WZ-1 luôn thiếu A6,
// nên tính riêng bằng chính loadProjectReadiness: coi cả nhóm này là một project giả có vai trò, để mọi mục A1-A5 được
// kiểm đúng như agent đang giữ vai trò (cùng một nguồn sự thật, không chép logic).
import type { Agent } from '@paperclipai/shared';
import { useQuery } from '@tanstack/react-query';
import { api, type ProjectRoles } from '@/api';
import { useCompany } from '@/app/hooks';
import {
  type AgentReadiness,
  loadProjectReadiness,
  type ReadinessSource,
  useProjectReadiness,
} from '@/features/readiness';
import type { RoleAgent } from './roles-form';

const CANDIDATE_PROJECT = '__candidates__';

function candidateSource(candidates: Agent[]): ReadinessSource {
  const ids = candidates.map((a) => a.id);
  const first = ids[0] ?? '';
  const roles: ProjectRoles = {
    assistantAgentId: first,
    executorAgentIds: ids,
    reviewerAgentId: first,
    integratorAgentId: first,
  };
  return {
    ...api,
    agents: { ...api.agents, list: async () => candidates },
    projects: { list: async () => [{ id: CANDIDATE_PROJECT }] },
    roles: { get: async () => roles },
  };
}

export function useRoleAgents(
  projectId: string,
  agents: Agent[] | undefined,
): { options: RoleAgent[]; stateOf: (id: string) => AgentReadiness['state'] | undefined; isLoading: boolean } {
  const { company } = useCompany();
  const readiness = useProjectReadiness(company.id, api);
  const held = new Map<string, { state: AgentReadiness['state']; projectId: string }>();
  for (const project of readiness.data ?? []) {
    for (const a of project.agents) {
      const prev = held.get(a.agentId);
      if (!prev || project.projectId === projectId)
        held.set(a.agentId, { state: a.state, projectId: project.projectId });
    }
  }
  const candidates = readiness.data ? (agents ?? []).filter((a) => !held.has(a.id)) : [];
  const candidateIds = candidates.map((a) => a.id).join(',');
  const computed = useQuery({
    queryKey: ['projects', 'role-candidates', company.id, candidateIds],
    queryFn: async () => (await loadProjectReadiness(candidateSource(candidates), company.id))[0]?.agents ?? [],
    enabled: candidates.length > 0,
  });
  const candidateState = new Map((computed.data ?? []).map((a) => [a.agentId, a.state]));
  const stateOf = (id: string) => held.get(id)?.state ?? candidateState.get(id);
  const options: RoleAgent[] = (agents ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    state: stateOf(a.id) ?? 'not_ready',
    holdsElsewhere: held.has(a.id) && held.get(a.id)?.projectId !== projectId,
    adapterType: a.adapterType,
  }));
  return { options, stateOf, isLoading: readiness.isLoading || computed.isLoading };
}

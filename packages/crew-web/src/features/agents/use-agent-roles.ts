// Vai trò Crew mà từng agent đang giữ ở các project (đọc roles của mọi project chưa lưu trữ). Project chưa có dòng vai
// trò (vai trò file) không có mục ở đây.
import type { Project } from '@paperclipai/shared';
import { useQueries, useQuery } from '@tanstack/react-query';
import { ApiError, api, type ProjectRoles, queryKeys } from '@/api';
import { useCompany } from '@/app/hooks';
import { type CrewRoleSlot, roleOfSlot, slotAgents } from '@/lib/instructions';

export type HeldRole = 'assistant' | 'executor' | 'reviewer' | 'integrator';

export interface AgentHolding {
  projectId: string;
  projectName: string;
  /** Template của ô: executor Codex/OpenCode là executor, reviewer Codex là reviewer. */
  role: HeldRole;
  slot: CrewRoleSlot;
  roles: ProjectRoles;
}

export function holdingsOf(
  project: Pick<Project, 'id' | 'name'>,
  roles: ProjectRoles,
): { agentId: string; holding: AgentHolding }[] {
  return slotAgents(roles).map(([slot, agentId]) => ({
    agentId,
    holding: { projectId: project.id, projectName: project.name, role: roleOfSlot(slot), slot, roles },
  }));
}

export function useAgentHoldings(): { byAgent: Map<string, AgentHolding[]>; isLoading: boolean } {
  const { company } = useCompany();
  const projects = useQuery({
    queryKey: queryKeys.projects(company.id),
    queryFn: () => api.projects.list(company.id),
  });
  const active = (projects.data ?? []).filter((p) => !p.archivedAt);
  const rolesList = useQueries({
    queries: active.map((project) => ({
      queryKey: queryKeys.roles(project.id),
      queryFn: async (): Promise<ProjectRoles | null> => {
        try {
          return await api.roles.get(company.id, project.id);
        } catch (error) {
          if (error instanceof ApiError && error.status === 404) return null;
          throw error;
        }
      },
    })),
  });
  const byAgent = new Map<string, AgentHolding[]>();
  active.forEach((project, i) => {
    const roles = rolesList[i]?.data;
    if (!roles) return;
    for (const { agentId, holding } of holdingsOf(project, roles)) {
      byAgent.set(agentId, [...(byAgent.get(agentId) ?? []), holding]);
    }
  });
  return { byAgent, isLoading: projects.isLoading || rolesList.some((q) => q.isLoading) };
}

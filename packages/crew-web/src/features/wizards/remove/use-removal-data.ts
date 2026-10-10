// Dữ liệu nút Gỡ project / Gỡ agent đọc trước khi mở hộp xác nhận: setup run, vai trò, agent, environment, máy. Khóa
// project và máy suy từ lần thêm project; project do app tạo thì suy khóa từ checkout trong environment của agent vai trò.
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api, type CrewMachine, type ProjectRoles, queryKeys, type SetupRun } from '@/api';

const CHECKOUT_KEY_RE = /\/crew-agents\/([a-z][a-z0-9-]{1,30})\/[^/]+$/;

interface AgentLike {
  id: string;
  name: string;
  status: string;
  defaultEnvironmentId?: string | null;
}
interface EnvironmentLike {
  id: string;
  config: Record<string, unknown>;
}

export const roleAgentIds = (roles: ProjectRoles) => [
  roles.assistantAgentId,
  ...roles.executorAgentIds,
  roles.reviewerAgentId,
  roles.integratorAgentId,
];

/** Lần thêm project mới nhất đã tạo project này. */
export function projectRunOf(runs: readonly SetupRun[], projectId: string): SetupRun | undefined {
  return runs
    .filter((r) => r.kind === 'add-project' && r.projectId === projectId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}

/** Khóa project trên máy (tên thư mục trong ~/crew-agents); không suy được thì ''. */
export function projectKeyOf(
  projectId: string,
  data: {
    runs: readonly SetupRun[];
    roles: ProjectRoles | null | undefined;
    agents: readonly AgentLike[];
    environments: readonly EnvironmentLike[];
  },
): string {
  const run = projectRunOf(data.runs, projectId);
  if (run) return run.projectKey;
  if (!data.roles) return '';
  const ids = new Set(roleAgentIds(data.roles));
  for (const agent of data.agents) {
    if (!ids.has(agent.id)) continue;
    const path = data.environments.find((e) => e.id === agent.defaultEnvironmentId)?.config.remoteWorkspacePath;
    const match = typeof path === 'string' ? CHECKOUT_KEY_RE.exec(path) : null;
    if (match?.[1]) return match[1];
  }
  return '';
}

/** Checkout của khóa (và ô, nếu có) mà các máy báo: đường dẫn, cờ sạch, máy. */
export function checkoutsOf(
  machines: readonly CrewMachine[],
  key: string,
  slot?: string,
): { path: string; clean: boolean | null; machineId: string }[] {
  if (!key) return [];
  const suffix = slot ? `/crew-agents/${key}/${slot}` : null;
  const under = `/crew-agents/${key}/`;
  return machines.flatMap((m) =>
    (m.latest?.checkouts ?? [])
      .filter((c) => (suffix ? c.path.endsWith(suffix) : c.path.includes(under)))
      .map((c) => ({ path: c.path, clean: c.clean, machineId: m.machineId })),
  );
}

/** Máy nhận việc gỡ checkout: máy của lần thêm project, rồi máy đang có checkout của khóa, rồi máy duy nhất. */
export function machineOf(machines: readonly CrewMachine[], run: SetupRun | undefined, key: string): string {
  if (run && machines.some((m) => m.machineId === run.machineId)) return run.machineId;
  const holders = [...new Set(checkoutsOf(machines, key).map((c) => c.machineId))];
  if (holders.length === 1) return holders[0] as string;
  return machines.length === 1 ? (machines[0]?.machineId ?? '') : '';
}

/** Vai trò của mọi project chưa archive (null: project chưa có dòng vai trò). */
export function useAllRoles(companyId: string, enabled = true) {
  const projects = useQuery({
    queryKey: queryKeys.projects(companyId),
    queryFn: () => api.projects.list(companyId),
    enabled,
  });
  const active = useMemo(() => (projects.data ?? []).filter((p) => !p.archivedAt), [projects.data]);
  const roles = useQuery({
    queryKey: ['wizards', 'roles', companyId, active.map((p) => p.id)],
    enabled: enabled && projects.isSuccess,
    queryFn: async () => {
      const entries = await Promise.all(
        active.map(async (p) => {
          try {
            return [p.id, await api.roles.get(companyId, p.id)] as const;
          } catch (error) {
            if ((error as { status?: number }).status === 404) return [p.id, null] as const;
            throw error;
          }
        }),
      );
      return new Map<string, ProjectRoles | null>(entries);
    },
  });
  return { projects, roles };
}

/** Query chung của hai nút gỡ. */
export function useRemovalBase(companyId: string) {
  const setupRuns = useQuery({
    queryKey: queryKeys.crew('crew.setupRuns', { companyId }),
    queryFn: () => api.crew.setupRuns(companyId),
  });
  const agents = useQuery({ queryKey: queryKeys.agents(companyId), queryFn: () => api.agents.list(companyId) });
  const environments = useQuery({
    queryKey: queryKeys.environments(companyId),
    queryFn: () => api.environments.list(companyId),
  });
  const machines = useQuery({
    queryKey: queryKeys.crew('crew.machines', { companyId }),
    queryFn: () => api.crew.machines(companyId),
  });
  return { setupRuns, agents, environments, machines };
}

/** Số yêu cầu chưa xong và run đang chạy, đọc khi hộp xác nhận mở. */
export function useRemovalImpact(
  companyId: string,
  open: boolean,
  filter: { projectId: string } | { assigneeAgentId: string },
  agentIds: readonly string[],
) {
  const issues = useQuery({
    queryKey: ['wizards', 'remove-issues', companyId, filter],
    enabled: open,
    queryFn: () => api.issues.listCompact(companyId, filter),
  });
  const runs = useQuery({
    queryKey: ['wizards', 'remove-runs', companyId],
    enabled: open,
    queryFn: () => api.runs.live(companyId),
  });
  const ids = new Set(agentIds.map((id) => id.toLowerCase()));
  return {
    loading: issues.isLoading || runs.isLoading,
    error: issues.error ?? runs.error,
    openIssues: (issues.data ?? []).filter((i) => i.status !== 'done' && i.status !== 'cancelled').length,
    activeRuns: (runs.data ?? []).filter(
      (r) => ids.has(r.agentId.toLowerCase()) && (r.status === 'running' || r.status === 'queued'),
    ).length,
  };
}

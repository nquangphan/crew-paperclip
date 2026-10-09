// Ghép dữ liệu REST Paperclip và plugin crew.core rồi tính trạng thái sẵn sàng cho mọi project của một company.
import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import { INSTRUCTIONS_PATH, sha256Hex } from '@/lib/instructions';
import { matchesAssistantTemplate } from './assistant-instructions';
import {
  type AgentReadiness,
  computeAgentReadiness,
  computeProjectReadiness,
  type ProjectReadiness,
  type ReadinessAgent,
  type ReadinessEnvironment,
  type ReadinessProjectRoles,
  type ReadinessReport,
  type ReadinessSetupRun,
} from './compute';

type SetupRunRow = ReadinessSetupRun & { machineId?: string; updatedAt?: string };
type IssueRow = { id: string; parentId?: string | null; assigneeAgentId?: string | null };

/** Phần của `api` (src/api) mà readiness đọc; `api` của web khớp kiểu này. */
export interface ReadinessSource {
  agents: {
    list(companyId: string): Promise<ReadinessAgent[]>;
    instructionsFile(id: string, path?: string, companyId?: string): Promise<{ content: string; contentHash?: string }>;
  };
  environments: { list(companyId: string): Promise<ReadinessEnvironment[]> };
  projects: { list(companyId: string): Promise<{ id: string; archivedAt?: string | Date | null }[]> };
  issues: { list(companyId: string, filters?: { projectId?: string }): Promise<IssueRow[]> };
  roles: { get(companyId: string, projectId: string): Promise<ReadinessProjectRoles | null> };
  crew: {
    machines(companyId: string): Promise<unknown>;
    setupRuns(companyId: string): Promise<SetupRunRow[]>;
    roots(companyId: string): Promise<unknown>;
  };
}

type Machine = { machineId: string; latest: ReadinessReport };

const statusOf = (error: unknown): number | undefined =>
  typeof error === 'object' && error !== null ? (error as { status?: number }).status : undefined;

/** `crew.machines` đến từ plugin: dạng lạ thì bỏ, không làm vỡ trang. */
function machinesOf(data: unknown): Machine[] {
  if (!Array.isArray(data)) return [];
  return data.filter(
    (m): m is Machine =>
      typeof m === 'object' &&
      m !== null &&
      typeof m.machineId === 'string' &&
      typeof m.latest === 'object' &&
      m.latest !== null,
  );
}

function idsOf(data: unknown): Set<string> {
  if (!Array.isArray(data)) return new Set();
  return new Set(data.flatMap((r) => (typeof r?.id === 'string' ? [r.id] : [])));
}

const roleSlots = (roles: ReadinessProjectRoles): [string, string][] => [
  [roles.assistantAgentId, 'assistant'],
  ...roles.executorAgentIds.map((id, i): [string, string] => [id, i === 0 ? 'executor' : `executor-${i + 1}`]),
  [roles.reviewerAgentId, 'reviewer'],
  [roles.integratorAgentId, 'integrator'],
];

/** Setup run mới nhất có refs trỏ tới agent. */
function setupRunOf(runs: SetupRunRow[], agentId: string): SetupRunRow | null {
  const hits = runs.filter((run) =>
    Object.values(run.steps).some((step) => Object.values(step?.refs ?? {}).includes(agentId)),
  );
  hits.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
  return hits[0] ?? null;
}

/** Máy chạy agent: máy báo có checkout của agent, rồi máy của setup run, rồi máy duy nhất của company. */
function reportOf(machines: Machine[], checkout: unknown, run: SetupRunRow | null): ReadinessReport | null {
  const byCheckout = machines.find((m) => m.latest.checkouts?.some((c) => c?.path === checkout));
  if (byCheckout) return byCheckout.latest;
  const byRun = run?.machineId ? machines.find((m) => m.machineId === run.machineId) : undefined;
  if (byRun) return byRun.latest;
  return machines.length === 1 ? (machines[0]?.latest ?? null) : null;
}

export async function loadProjectReadiness(source: ReadinessSource, companyId: string): Promise<ProjectReadiness[]> {
  const [agents, environments, projects, machineData, setupRuns, rootData] = await Promise.all([
    source.agents.list(companyId),
    source.environments.list(companyId),
    source.projects.list(companyId),
    source.crew.machines(companyId),
    source.crew.setupRuns(companyId),
    source.crew.roots(companyId),
  ]);
  const machines = machinesOf(machineData);
  const rootIds = idsOf(rootData);
  const active = projects.filter((p) => !p.archivedAt);

  // Vai trò của từng project. Không có dòng vai trò (null hoặc 404) mà project có yêu cầu Crew thì coi là "vai trò
  // file" (CREW_POLICY_CONFIG, như project R1): web không đọc được file đó, nên agent của vai trò file là agent được giao
  // yêu cầu gốc Crew hoặc việc con của nó trong project.
  const perProject = await Promise.all(
    active.map(async (project) => {
      let roles: ReadinessProjectRoles | null = null;
      try {
        roles = await source.roles.get(companyId, project.id);
      } catch (error) {
        if (statusOf(error) !== 404) throw error;
      }
      if (roles) return { project, roles, fileRoles: false, slots: roleSlots(roles) };
      const issues = await source.issues.list(companyId, { projectId: project.id });
      const crewIssues = issues.filter((i) => rootIds.has(i.id) || (i.parentId != null && rootIds.has(i.parentId)));
      const fileAgents = [...new Set(crewIssues.flatMap((i) => (i.assigneeAgentId ? [i.assigneeAgentId] : [])))];
      return {
        project,
        roles: null,
        fileRoles: crewIssues.length > 0,
        slots: fileAgents.map((id): [string, string] => [id, 'file']),
      };
    }),
  );

  const roleOf = new Map<string, string>();
  for (const { slots } of perProject) for (const [id, slot] of slots) if (!roleOf.has(id)) roleOf.set(id, slot);

  const readiness = new Map<string, AgentReadiness>();
  await Promise.all(
    agents
      .filter((a) => roleOf.has(a.id))
      .map(async (agent) => {
        let instructionsHash: string | null = null;
        let instructionsRendered = false;
        try {
          const file = await source.agents.instructionsFile(agent.id, INSTRUCTIONS_PATH, companyId);
          instructionsHash = file.contentHash ?? (await sha256Hex(file.content));
          // Sửa vai trò render lại AGENTS.md của Trợ Lý nhưng hash trong setup run giữ nguyên: so với bản render kỳ vọng.
          const roles = perProject.find((p) => p.roles?.assistantAgentId === agent.id)?.roles;
          instructionsRendered =
            roles != null && matchesAssistantTemplate(file.content, agent.id, roles.executorAgentIds);
        } catch (error) {
          if (statusOf(error) !== 404) throw error;
        }
        const environment = environments.find((e) => e.id === agent.defaultEnvironmentId) ?? null;
        const setupRun = setupRunOf(setupRuns, agent.id);
        readiness.set(
          agent.id,
          computeAgentReadiness({
            agent,
            environment,
            report: reportOf(machines, environment?.config.remoteWorkspacePath, setupRun),
            roleOf: roleOf.get(agent.id) ?? null,
            setupRun,
            instructionsHash,
            instructionsRendered,
          }),
        );
      }),
  );

  return projects.map((project) => {
    const entry = perProject.find((p) => p.project.id === project.id);
    const agentsOf = (entry?.slots ?? []).flatMap(([id]) => {
      const r = readiness.get(id);
      return r ? [r] : [];
    });
    return computeProjectReadiness({
      project,
      roles: entry?.roles ?? null,
      fileRoles: entry?.fileRoles ?? false,
      agents: agentsOf,
    });
  });
}

/** `source` là `api` của web (src/api); truyền vào để hook dùng được cả ở test. */
export function useProjectReadiness(companyId: string, source: ReadinessSource): UseQueryResult<ProjectReadiness[]> {
  return useQuery({
    queryKey: ['crew', 'readiness', companyId],
    queryFn: () => loadProjectReadiness(source, companyId),
    enabled: companyId !== '',
  });
}

// Dọn rác của lượt E2E trong company Crew E2E: archive project rác và terminate agent của chúng. Không xóa cứng
// (agent/project có cost_events không xóa được). Hàm chọn là hàm thuần để test không cần mạng.
import type { Api } from './api';

export interface ProjectRow {
  id: string;
  name: string;
  archivedAt?: string | null;
}
export interface AgentRow {
  id: string;
  name: string;
  status: string;
}
export interface SetupRunRow {
  projectKey: string;
  projectId: string | null;
}

export interface JunkProject {
  project: ProjectRow;
  /** Khóa project dùng để nối agent (tên agent là `<khóa>-<vai trò>`). */
  keys: string[];
}

const JUNK_NAME_PREFIXES = ['E2E gỡ', 'PW-S', 'e2e-neg-', 'e2e-rm-'];
const OLD_BASE_NAME = /^E2E base \d+$/;
const KEY_IN_NAME = /\be2e-(?:rm|neg)-[a-z0-9]+\b/gi;

export interface JunkContext {
  /** Project nền hiện hành (id từ global-setup) và khóa của nó: không bao giờ bị chọn. */
  baseProjectId?: string | null;
  baseKey: string;
  runs: SetupRunRow[];
}

/** Chọn project rác theo tên; project nền hiện hành (theo id hoặc khóa setup run) luôn được giữ. */
export function selectJunkProjects(projects: ProjectRow[], ctx: JunkContext): JunkProject[] {
  const keysById = new Map<string, string[]>();
  for (const r of ctx.runs) {
    if (!r.projectId || !r.projectKey) continue;
    keysById.set(r.projectId, [...(keysById.get(r.projectId) ?? []), r.projectKey]);
  }
  const out: JunkProject[] = [];
  for (const project of projects) {
    if (project.id === ctx.baseProjectId) continue;
    const runKeys = keysById.get(project.id) ?? [];
    if (runKeys.includes(ctx.baseKey)) continue;
    const name = project.name ?? '';
    const junk = JUNK_NAME_PREFIXES.some((p) => name.startsWith(p)) || OLD_BASE_NAME.test(name);
    if (!junk) continue;
    const fromName = name.match(KEY_IN_NAME) ?? [];
    const keys = [...new Set([...runKeys, ...fromName.map((k) => k.toLowerCase())])].filter((k) => k !== ctx.baseKey);
    out.push({ project, keys });
  }
  return out;
}

/** Agent chưa terminated có tên `<khóa>-<vai trò>` của một trong các khóa. */
export function agentsToTerminate(agents: AgentRow[], keys: string[]): AgentRow[] {
  return agents.filter((a) => a.status !== 'terminated' && keys.some((k) => a.name.startsWith(`${k}-`)));
}

export interface SweepResult {
  archived: number;
  terminated: number;
  warnings: string[];
}

/** Dọn rác trong company E2E. Không ném: lỗi từng bước chỉ vào `warnings`. */
export async function sweepJunk(
  api: Api,
  companyId: string,
  base: { projectId?: string | null; key: string },
): Promise<SweepResult> {
  const result: SweepResult = { archived: 0, terminated: 0, warnings: [] };
  const warn = (what: string, e: unknown) =>
    result.warnings.push(`${what}: ${e instanceof Error ? e.message : String(e)}`);
  let junk: JunkProject[];
  let agents: AgentRow[];
  try {
    const [projects, runs] = await Promise.all([
      api.get<ProjectRow[]>(`/api/companies/${companyId}/projects?includeArchived=true`),
      api.crewData<SetupRunRow[]>('crew.setupRuns', companyId, {}),
    ]);
    agents = await api.get<AgentRow[]>(`/api/companies/${companyId}/agents`);
    junk = selectJunkProjects(projects, { baseProjectId: base.projectId, baseKey: base.key, runs });
  } catch (e) {
    warn('liệt kê project/agent rác', e);
    return result;
  }
  for (const { project, keys } of junk) {
    if (!project.archivedAt) {
      try {
        await api.patch(`/api/projects/${project.id}`, { archivedAt: new Date().toISOString() });
        result.archived++;
      } catch (e) {
        warn(`archive ${project.name}`, e);
      }
    }
    for (const agent of agentsToTerminate(agents, keys)) {
      try {
        await api.post(`/api/agents/${agent.id}/terminate`);
        result.terminated++;
      } catch (e) {
        warn(`terminate ${agent.name}`, e);
      }
    }
  }
  return result;
}

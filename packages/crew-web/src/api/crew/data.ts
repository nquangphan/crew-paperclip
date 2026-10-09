// Data plugin crew.core: POST /api/plugins/crew.core/data/<key> { companyId, params } → { data }.
// Kiểu trả của data R1 (roots, map, docsCheck, machines, docs.*) lấy từ export `shared/*` của plugin (qua ./types).
import { call } from '../endpoints';
import type {
  CrewCompany,
  CrewMachine,
  CrewMap,
  CrewRoot,
  DocsCheckResult,
  DocsPage,
  DocsProject,
  DocsTree,
  MachineJob,
  MachineJobStatus,
  SetupRun,
  SkillSyncState,
} from './types';

/** Khóa data UI Crew đọc và mã nút BA dùng nó. Khóa ngoài danh sách không gọi được. */
export const CREW_DATA_KEYS = {
  'crew.companies': ['S0.2'],
  'crew.roots': ['S4.3'],
  'crew.map': ['S6.1'],
  'crew.docsCheck': ['S6.1', 'S6.3'],
  'crew.machines': ['S2.3', 'S15.1'],
  'crew.docs.projects': ['S8.4', 'S16.1'],
  'crew.docs.tree': ['S8.4', 'S16.1'],
  'crew.docs.page': ['S8.4', 'S16.1'],
  'crew.docs.search': ['S16.2'],
  'crew.machineJobs': ['S15.2'],
  'crew.setupRuns': ['S9'],
  'crew.skillSync': ['S14.4'],
} as const;

export type CrewDataKey = keyof typeof CREW_DATA_KEYS;

/** Gọi một data key. `companyId` đi ở body (server kiểm quyền company), phần còn lại ở `params`. */
export async function crewData<T = unknown>(
  key: CrewDataKey,
  companyId: string | null,
  params: Record<string, unknown> = {},
): Promise<T> {
  const res: { data: T } = await call(
    'crew.data',
    { key },
    { body: { ...(companyId ? { companyId } : {}), params: { ...(companyId ? { companyId } : {}), ...params } } },
  );
  return res.data;
}

export const crewDataApi = {
  /**
   * Company có cấu hình Crew trong số `companyIds` (lấy từ GET /companies). Gọi từng company kèm companyId rồi
   * gộp: host plugin từ chối lời gọi không gắn company (INVOCATION_SCOPE_DENIED) trong 15 phút sau mỗi sự kiện
   * agent, nên không bao giờ gọi `crew.companies` thiếu companyId.
   */
  companies: async (companyIds: string[]): Promise<CrewCompany[]> => {
    const lists = await Promise.all(
      companyIds.map(async (id) =>
        (await crewData<CrewCompany[]>('crew.companies', id)).filter((company) => company.id === id),
      ),
    );
    return lists.flat();
  },
  roots: (companyId: string, params: { status?: string } = {}): Promise<CrewRoot[]> =>
    crewData<CrewRoot[]>('crew.roots', companyId, params),
  map: (companyId: string, issueId: string): Promise<CrewMap> => crewData<CrewMap>('crew.map', companyId, { issueId }),
  /** null: issue chưa có bằng chứng kiểm docs. */
  docsCheck: (companyId: string, issueId: string): Promise<DocsCheckResult | null> =>
    crewData<DocsCheckResult | null>('crew.docsCheck', companyId, { issueId }),
  machines: (companyId: string): Promise<CrewMachine[]> => crewData<CrewMachine[]>('crew.machines', companyId),
  docsProjects: (companyId: string): Promise<DocsProject[]> => crewData<DocsProject[]>('crew.docs.projects', companyId),
  docsTree: (companyId: string, projectId: string, snapshotId?: string): Promise<DocsTree | null> =>
    crewData<DocsTree | null>('crew.docs.tree', companyId, { projectId, snapshotId }),
  docsPage: (companyId: string, projectId: string, path: string, snapshotId?: string): Promise<DocsPage | null> =>
    crewData<DocsPage | null>('crew.docs.page', companyId, { projectId, path, snapshotId }),
  docsSearch: (companyId: string, projectId: string, q: string): Promise<{ path: string; title: string }[]> =>
    crewData<{ path: string; title: string }[]>('crew.docs.search', companyId, { projectId, q }),
  machineJobs: (
    companyId: string,
    params: { machineId?: string; setupRunId?: string; status?: MachineJobStatus } = {},
  ): Promise<MachineJob[]> => crewData<MachineJob[]>('crew.machineJobs', companyId, params),
  setupRuns: (
    companyId: string,
    params: { kind?: SetupRun['kind']; status?: SetupRun['status']; projectId?: string } = {},
  ): Promise<SetupRun[]> => crewData<SetupRun[]>('crew.setupRuns', companyId, params),
  skillSync: (companyId: string): Promise<SkillSyncState[]> => crewData<SkillSyncState[]>('crew.skillSync', companyId),
};

export const __endpoints = ['crew.data'];

// Chạy nhiều máy: router Crew của server (gắn cùng router góp ý). Đọc: mọi thành viên; ghi: chỉ owner.
import { call } from '../endpoints';
import type {
  IssueMachine,
  IssueMachineSummary,
  MachineCandidate,
  ProjectMachines,
  ProjectRepo,
  ProvisionOthersResult,
  ReleaseBlocker,
  ReleaseResult,
} from './types';

/** Số id tối đa mỗi request của route lô (server trả 400 nếu quá). */
const BATCH_LIMIT = 500;

export const machinePinsApi = {
  /** Máy đã ghép của company kèm số run, tải và trạng thái project trên máy (form tạo yêu cầu gốc). */
  candidates: async (companyId: string, projectId: string): Promise<MachineCandidate[]> => {
    const res: { items: MachineCandidate[] } = await call(
      'machinePin.candidates',
      { companyId },
      { query: { projectId } },
    );
    return res.items;
  },
  /** Máy của cả cây chứa yêu cầu này. */
  get: (companyId: string, issueId: string): Promise<IssueMachine> => call('machinePin.get', { companyId, issueId }),
  /**
   * Máy của cây chứa từng yêu cầu (danh sách, Bảng): một POST cho tới `BATCH_LIMIT` id, quá thì chia khúc. Id company
   * khác hay không có thì không có trong kết quả.
   */
  issueMachines: async (
    companyId: string,
    issueIds: readonly string[],
  ): Promise<Record<string, IssueMachineSummary | null>> => {
    const chunks: string[][] = [];
    for (let i = 0; i < issueIds.length; i += BATCH_LIMIT) chunks.push(issueIds.slice(i, i + BATCH_LIMIT));
    const pages = await Promise.all(
      chunks.map(
        (ids): Promise<{ items: Record<string, IssueMachineSummary | null> }> =>
          call('machinePin.batch', { companyId }, { body: { issueIds: ids } }),
      ),
    );
    return Object.assign({}, ...pages.map((p) => p.items));
  },
  /** Owner chọn máy cho yêu cầu gốc (cây chưa có run). */
  set: (companyId: string, issueId: string, machineId: string): Promise<IssueMachine> =>
    call('machinePin.set', { companyId, issueId }, { body: { machineId } }),
  projectMachines: (companyId: string, projectId: string): Promise<ProjectMachines> =>
    call('projectMachines.get', { companyId, projectId }),
  /** Xếp việc dựng project trên máy (owner). */
  addMachine: (companyId: string, projectId: string, machineId: string): Promise<{ status: 'provisioning' }> =>
    call('projectMachines.add', { companyId, projectId }, { body: { machineId } }),
  setRepo: (companyId: string, projectId: string, repo: ProjectRepo): Promise<ProjectRepo> =>
    call('projectMachines.setRepo', { companyId, projectId }, { body: repo }),
  /** Cây ghim máy của project còn run chờ/chạy (của `agentIds`, thiếu thì mọi agent). */
  blockers: async (companyId: string, projectId: string, agentIds?: string[]): Promise<ReleaseBlocker[]> => {
    const res: { blockers: ReleaseBlocker[] } = await call(
      'projectMachines.blockers',
      { companyId, projectId },
      agentIds && agentIds.length > 0 ? { query: { agentIds: agentIds.join(',') } } : {},
    );
    return res.blockers;
  },
  /** Archive environment `@máy` của agent trên máy khác và xếp gỡ checkout; 409 `crew_machine_busy` khi cây còn run. */
  release: (
    companyId: string,
    projectId: string,
    body: { agentIds: string[]; wholeProject: boolean; primaryMachineId: string | null },
  ): Promise<ReleaseResult> => call('projectMachines.release', { companyId, projectId }, { body }),
  /** Xếp `ensure-project` cho mọi máy đã ghép khác máy chính. */
  provisionOthers: (
    companyId: string,
    projectId: string,
    body: { exceptMachineId: string | null; includeReady: boolean; repo: { originUrl: string; branch: string } | null },
  ): Promise<ProvisionOthersResult> => call('projectMachines.provision', { companyId, projectId }, { body }),
};

export const __endpoints = [
  'machinePin.candidates',
  'machinePin.get',
  'machinePin.batch',
  'machinePin.set',
  'projectMachines.get',
  'projectMachines.add',
  'projectMachines.setRepo',
  'projectMachines.blockers',
  'projectMachines.release',
  'projectMachines.provision',
];

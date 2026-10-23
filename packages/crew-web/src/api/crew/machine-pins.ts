// Chạy nhiều máy: router Crew của server (gắn cùng router góp ý). Đọc: mọi thành viên; ghi: chỉ owner.
import { call } from '../endpoints';
import type { IssueMachine, MachineCandidate, ProjectMachines, ProjectRepo } from './types';

export const machinePinsApi = {
  /** Máy đã ghép của company kèm số run, tải và trạng thái project trên máy (form tạo yêu cầu gốc). */
  candidates: async (companyId: string, projectId: string): Promise<MachineCandidate[]> => {
    const res: { items: MachineCandidate[] } = await call('machinePin.candidates', { companyId }, { query: { projectId } });
    return res.items;
  },
  /** Máy của cả cây chứa yêu cầu này. */
  get: (companyId: string, issueId: string): Promise<IssueMachine> => call('machinePin.get', { companyId, issueId }),
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
};

export const __endpoints = [
  'machinePin.candidates',
  'machinePin.get',
  'machinePin.set',
  'projectMachines.get',
  'projectMachines.add',
  'projectMachines.setRepo',
];

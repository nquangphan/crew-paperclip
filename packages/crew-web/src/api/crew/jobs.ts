// Việc cần làm trên máy (I1): web tạo, xem, thử lại; app 2P Crew trên Mac nhận và báo kết quả.
import { call } from '../endpoints';
import type { JobPayload, MachineJob, MachineJobStatus } from './types';

export const jobsApi = {
  create: (body: {
    companyId: string;
    machineId: string;
    kind: JobPayload['kind'];
    payload: JobPayload;
    setupRunId?: string;
  }): Promise<MachineJob> => call('jobs.create', {}, { body }),
  list: (
    companyId: string,
    query: { machineId?: string; status?: MachineJobStatus; setupRunId?: string; limit?: number } = {},
  ): Promise<MachineJob[]> => call('jobs.list', {}, { query: { companyId, ...query } }),
  retry: (companyId: string, jobId: string): Promise<MachineJob> =>
    call('jobs.retry', { jobId }, { body: { companyId } }),
};

export const __endpoints = ['jobs.create', 'jobs.list', 'jobs.retry'];

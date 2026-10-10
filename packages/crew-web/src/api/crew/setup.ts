// Tiến độ wizard (I2). Mọi lời gọi truyền companyId của setup run, không lấy company đang chọn.
import { call } from '../endpoints';
import type {
  AddAgentInput,
  AddProjectInput,
  RemoveAgentInput,
  RemoveProjectInput,
  SetupRun,
  SetupStepId,
} from './types';

export const setupApi = {
  create: (body: {
    companyId: string;
    kind: SetupRun['kind'];
    projectKey: string;
    machineId: string;
    /**
     * Gỡ project/agent: id project nằm trong `input` (`{projectId, projectName}`, `{agentId, agentName, projectId,
     * role}`), không có `projectId` ở cấp trên cùng (plugin từ chối khóa lạ). Đã có lần gỡ dở cùng project/agent thì
     * plugin trả 409 kèm `setupRunId` của lần đó.
     */
    input: AddProjectInput | AddAgentInput | RemoveProjectInput | RemoveAgentInput;
  }): Promise<SetupRun> => call('setup.create', {}, { body }),
  get: (companyId: string, id: string): Promise<SetupRun> => call('setup.get', { id }, { query: { companyId } }),
  /** 409 khi bước khác đang chạy (khóa running_step). */
  begin: (companyId: string, id: string, stepId: SetupStepId): Promise<SetupRun & { lockToken?: string }> =>
    call('setup.begin', { id, stepId }, { body: { companyId } }),
  finish: (
    companyId: string,
    id: string,
    stepId: SetupStepId,
    body: {
      status: 'done' | 'failed';
      refs?: Record<string, string>;
      error?: string;
      projectId?: string;
      /** Lấy từ kết quả `begin`; token lệch (tab khác begin lại) thì plugin trả 409. */
      lockToken?: string;
    },
  ): Promise<SetupRun> => call('setup.finish', { id, stepId }, { body: { companyId, ...body } }),
  /** Bỏ lần thêm project dở (chưa có project). 409 khi đã xong/đã bỏ/đã tạo project/bước còn chạy. */
  abandon: (companyId: string, id: string): Promise<SetupRun> => call('setup.abandon', { id }, { body: { companyId } }),
};

export const __endpoints = ['setup.abandon', 'setup.begin', 'setup.create', 'setup.finish', 'setup.get'];

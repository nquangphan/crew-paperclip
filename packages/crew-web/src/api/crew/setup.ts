// Tiến độ wizard (I2). Mọi lời gọi truyền companyId của setup run, không lấy company đang chọn.
import { call } from '../endpoints';
import type { AddAgentInput, AddProjectInput, SetupRun, SetupStepId } from './types';

export const setupApi = {
  create: (body: {
    companyId: string;
    kind: SetupRun['kind'];
    projectKey: string;
    machineId: string;
    input: AddProjectInput | AddAgentInput;
  }): Promise<SetupRun> => call('setup.create', {}, { body }),
  get: (companyId: string, id: string): Promise<SetupRun> => call('setup.get', { id }, { query: { companyId } }),
  /** 409 khi bước khác đang chạy (khóa running_step). */
  begin: (companyId: string, id: string, stepId: SetupStepId): Promise<SetupRun> =>
    call('setup.begin', { id, stepId }, { body: { companyId } }),
  finish: (
    companyId: string,
    id: string,
    stepId: SetupStepId,
    body: { status: 'done' | 'failed'; refs?: Record<string, string>; error?: string; projectId?: string },
  ): Promise<SetupRun> => call('setup.finish', { id, stepId }, { body: { companyId, ...body } }),
};

export const __endpoints = ['setup.begin', 'setup.create', 'setup.finish', 'setup.get'];

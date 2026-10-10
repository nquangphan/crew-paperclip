// Environment SSH của agent (wizard bước 4, S13.3). Nguồn: server/src/routes/environments.ts:702,1014.
import type { Environment } from '@paperclipai/shared';
import { call } from '../endpoints';

// Gỡ environment = lưu trữ qua PATCH (S8.7, S11.9); UI Crew không gọi route xóa của server.
export const environmentsApi = {
  list: (companyId: string): Promise<Environment[]> => call('environments.list', { companyId }),
  create: (companyId: string, body: Record<string, unknown>): Promise<Environment> =>
    call('environments.create', { companyId }, { body }),
  archive: (environmentId: string): Promise<Environment> =>
    call('environments.update', { id: environmentId }, { body: { status: 'archived' } }),
};

export const __endpoints = ['environments.create', 'environments.list', 'environments.update'];

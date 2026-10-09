// Environment SSH của agent (wizard bước 4, S13.3). Nguồn: server/src/routes/environments.ts:702,1014.
import type { Environment } from '@paperclipai/shared';
import { call } from '../endpoints';

export const environmentsApi = {
  list: (companyId: string): Promise<Environment[]> => call('environments.list', { companyId }),
  create: (companyId: string, body: Record<string, unknown>): Promise<Environment> =>
    call('environments.create', { companyId }, { body }),
};

export const __endpoints = ['environments.create', 'environments.list'];

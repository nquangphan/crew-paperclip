// Nhãn company (S5.2: loại Nghiên cứu cần id nhãn `research`). Nguồn: server/src/routes/issues.ts GET /companies/:companyId/labels.
import type { IssueLabel } from '@paperclipai/shared';
import { call } from '../endpoints';

export const labelsApi = {
  list: (companyId: string): Promise<IssueLabel[]> => call('labels.list', { companyId }),
};

export const __endpoints = ['labels.list'];

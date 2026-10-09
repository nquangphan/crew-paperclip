// Tài liệu của issue (plan, spec agent ghi), chỉ đọc.
import type { IssueDocument } from '@paperclipai/shared';
import { call } from '../endpoints';

export const documentsApi = {
  list: (issueId: string): Promise<IssueDocument[]> => call('documents.list', { id: issueId }),
  get: (issueId: string, key: string): Promise<IssueDocument> => call('documents.get', { id: issueId, key }),
};

export const __endpoints = ['documents.get', 'documents.list'];

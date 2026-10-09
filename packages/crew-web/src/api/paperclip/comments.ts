import type { IssueComment } from '@paperclipai/shared';
import { call } from '../endpoints';

export const commentsApi = {
  list: (
    issueId: string,
    opts: { after?: string; order?: 'asc' | 'desc'; limit?: number } = {},
  ): Promise<IssueComment[]> => call('comments.list', { id: issueId }, { query: opts }),
  add: (issueId: string, body: string, attachmentIds?: string[]): Promise<IssueComment> =>
    call('comments.add', { id: issueId }, { body: { body, ...(attachmentIds?.length ? { attachmentIds } : {}) } }),
};

export const __endpoints = ['comments.add', 'comments.list'];

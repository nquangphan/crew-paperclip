import type { IssueComment } from '@paperclipai/shared';
import { call } from '../endpoints';

export const commentsApi = {
  list: (
    issueId: string,
    opts: { after?: string; order?: 'asc' | 'desc'; limit?: number } = {},
  ): Promise<IssueComment[]> => call('comments.list', { id: issueId }, { query: opts }),
  /** `clientRequestId` (uuid) làm lời gọi lặp lại an toàn: server trả lại bình luận cũ thay vì tạo bản trùng. */
  add: (issueId: string, body: string, attachmentIds?: string[], clientRequestId?: string): Promise<IssueComment> =>
    call(
      'comments.add',
      { id: issueId },
      {
        body: {
          body,
          ...(attachmentIds?.length ? { attachmentIds } : {}),
          ...(clientRequestId ? { clientRequestId } : {}),
        },
      },
    ),
};

export const __endpoints = ['comments.add', 'comments.list'];

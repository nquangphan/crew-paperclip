// Hộp thư: đánh dấu đã đọc/chưa đọc, lưu trữ (S3.3, S3.4, S6.16). Route chặn agent.
import { call } from '../endpoints';

export const inboxApi = {
  markRead: (issueId: string): Promise<{ id: string; lastReadAt: string }> =>
    call('issues.markRead', { id: issueId }, { body: {} }),
  markUnread: (issueId: string): Promise<{ id: string; removed: boolean }> =>
    call('issues.markUnread', { id: issueId }),
  archive: (issueId: string): Promise<{ id: string; archivedAt: string }> =>
    call('issues.archive', { id: issueId }, { body: {} }),
  unarchive: (issueId: string): Promise<unknown> => call('issues.unarchive', { id: issueId }),
};

export const __endpoints = ['issues.archive', 'issues.markRead', 'issues.markUnread', 'issues.unarchive'];

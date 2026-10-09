// File đính kèm issue/bình luận. Upload multipart, trường `file` (server/src/routes/issues.ts:18374).
import type { IssueAttachment } from '@paperclipai/shared';
import { call, endpointPath } from '../endpoints';

export const attachmentsApi = {
  list: (issueId: string): Promise<IssueAttachment[]> => call('attachments.list', { id: issueId }),
  upload: (
    companyId: string,
    issueId: string,
    file: File,
    issueCommentId?: string | null,
  ): Promise<IssueAttachment> => {
    const form = new FormData();
    form.append('file', file);
    if (issueCommentId) form.append('issueCommentId', issueCommentId);
    return call('attachments.upload', { companyId, issueId }, { form });
  },
  delete: (attachmentId: string): Promise<{ ok: true }> => call('attachments.delete', { attachmentId }),
  /** Link tải nội dung (dùng làm href, không gọi qua fetch). */
  contentUrl: (attachmentId: string): string => endpointPath('attachments.content', { attachmentId }),
};

export const __endpoints = ['attachments.delete', 'attachments.list', 'attachments.upload'];

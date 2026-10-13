// File đính kèm issue/bình luận. Upload multipart, trường `file` (server/src/routes/issues.ts:18374).
import type { IssueAttachment } from '@paperclipai/shared';
import { call, endpointPath } from '../endpoints';
import { httpText } from '../http';

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
  /** Link buộc tải về (server trả `Content-Disposition: attachment`). */
  downloadUrl: (attachmentId: string): string =>
    `${endpointPath('attachments.content', { attachmentId })}?download=true`,
  /** Nội dung file dạng chữ (markdown, code, HTML) để xem ngay trong trang. */
  text: (attachmentId: string, signal?: AbortSignal): Promise<string> =>
    httpText(endpointPath('attachments.content', { attachmentId }), { signal }),
  /**
   * Id file đính kèm nếu `href` là link nội dung file cùng origin (`/api/attachments/<id>/content`, kể cả dạng tuyệt
   * đối cùng origin); link khác trả null.
   */
  idFromHref: (href: string): string | null => {
    let url: URL;
    try {
      url = new URL(href, window.location.origin);
    } catch {
      return null;
    }
    if (url.origin !== window.location.origin) return null;
    const m = /^\/api\/attachments\/([^/]+)\/content\/?$/.exec(url.pathname);
    if (!m) return null;
    try {
      return decodeURIComponent(m[1]);
    } catch {
      return null;
    }
  },
};

export const __endpoints = ['attachments.delete', 'attachments.list', 'attachments.upload'];

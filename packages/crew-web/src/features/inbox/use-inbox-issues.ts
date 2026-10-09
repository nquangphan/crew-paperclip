import type { Issue } from '@paperclipai/shared';
import { useQuery } from '@tanstack/react-query';
import { api, queryKeys } from '@/api';

/** Số issue lấy cho Hộp thư (mới cập nhật nhất, bỏ mục đã lưu trữ). */
export const INBOX_LIMIT = 200;

/**
 * Issue của Hộp thư: GET /companies/:c/issues?inboxArchivedByUserId=me (server/src/services/issues.ts: lọc mục chưa
 * lưu trữ và gắn `isUnreadForMe`/`myLastTouchAt` cho người dùng này). Khóa nằm dưới `issues(companyId)` nên mọi
 * invalidate theo tiền tố đó làm mới luôn Hộp thư và thẻ "chờ bạn duyệt" của Tổng quan.
 */
export function useInboxIssues(companyId: string, enabled = true) {
  return useQuery<Issue[]>({
    queryKey: queryKeys.issues(companyId, { inbox: 'me', limit: INBOX_LIMIT }),
    queryFn: () => api.issues.list(companyId, { inboxArchivedByUserId: 'me', limit: INBOX_LIMIT }),
    enabled,
  });
}

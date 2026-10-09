import { useQuery } from '@tanstack/react-query';
import { api, queryKeys } from '@/api';
import { useInboxIssues } from './use-inbox-issues';

/**
 * Số trên badge "Hộp thư" của sidebar (S0.1, S3.3) = mục cần xử lý của GET /companies/:c/sidebar-badges cộng số issue
 * `isUnreadForMe` của Hộp thư. Route sidebar-badges của server không truyền `unreadTouchedIssues` cho
 * sidebarBadgeService nên `inbox` của nó không gồm issue chưa đọc. Đánh dấu đã đọc invalidate `sidebarBadges(c)` và
 * tiền tố `issues(c)` nên badge đổi theo. Trả null khi chưa có số liệu hoặc `enabled` tắt (không có trang Hộp thư).
 */
export function useInboxBadge(companyId: string, enabled: boolean): number | null {
  const badges = useQuery({
    queryKey: queryKeys.sidebarBadges(companyId),
    queryFn: () => api.sidebar.badges(companyId),
    enabled,
  });
  const issues = useInboxIssues(companyId, enabled);
  if (!badges.data) return null;
  const unread = (issues.data ?? []).filter((issue) => issue.isUnreadForMe === true).length;
  return badges.data.inbox + unread;
}

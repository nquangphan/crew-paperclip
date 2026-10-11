import { useQuery } from '@tanstack/react-query';
import { api, queryKeys } from '@/api';
import { useVisibleProjects } from '@/features/access';
import { useInboxIssues } from './use-inbox-issues';

/**
 * Số trên badge "Hộp thư" của sidebar (S0.1, S3.3) = mục cần xử lý của GET /companies/:c/sidebar-badges cộng số issue
 * `isUnreadForMe` của Hộp thư. Route sidebar-badges của server không truyền `unreadTouchedIssues` cho
 * sidebarBadgeService nên `inbox` của nó không gồm issue chưa đọc. Đánh dấu đã đọc invalidate `sidebarBadges(c)` và
 * tiền tố `issues(c)` nên badge đổi theo. Trả null khi chưa có số liệu hoặc `enabled` tắt (không có trang Hộp thư).
 * Người chỉ thấy một số project chỉ đếm issue chưa đọc đã lọc: số của sidebar-badges đếm cả project bị ẩn.
 */
export function useInboxBadge(companyId: string, enabled: boolean): number | null {
  const visible = useVisibleProjects();
  const badges = useQuery({
    queryKey: queryKeys.sidebarBadges(companyId),
    queryFn: () => api.sidebar.badges(companyId),
    enabled: enabled && visible.ready && !visible.restricted,
  });
  const issues = useInboxIssues(companyId, enabled);
  const unread = (issues.data ?? []).filter((issue) => issue.isUnreadForMe === true).length;
  if (visible.restricted) return enabled && issues.data ? unread : null;
  if (!badges.data) return null;
  return badges.data.inbox + unread;
}

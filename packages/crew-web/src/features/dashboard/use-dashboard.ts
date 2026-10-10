import { useQueries, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api, queryKeys } from '@/api';
import { useMe } from '@/app/hooks';
import { inboxTabs, useInboxIssues } from '@/features/inbox';

/** Số dòng trong danh sách hoạt động và yêu cầu gần đây (giống Paperclip gốc). */
export const RECENT_LIMIT = 10;
/** Số thẻ run của khối Agent. */
export const RUN_CARD_LIMIT = 4;
/** Số yêu cầu lấy để vẽ biểu đồ trạng thái và tra tên trong hoạt động. */
const ISSUE_LIMIT = 500;

/**
 * Dữ liệu Tổng quan (S2). Thẻ "chờ bạn duyệt" đếm đúng tab "Chờ tôi duyệt" của Hộp thư (cùng hàm `inboxTabs`),
 * nên hai nơi luôn cùng con số.
 */
export function useDashboard(companyId: string) {
  const me = useMe();
  const summary = useQuery({
    queryKey: queryKeys.dashboard(companyId),
    queryFn: () => api.dashboard.summary(companyId),
  });
  const inbox = useInboxIssues(companyId);
  const awaiting = useMemo(() => inboxTabs(inbox.data ?? [], me).awaiting_me.length, [inbox.data, me]);
  const issues = useQuery({
    queryKey: queryKeys.issues(companyId, { dashboard: true, limit: ISSUE_LIMIT }),
    queryFn: () => api.issues.list(companyId, { limit: ISSUE_LIMIT }),
  });
  const live = useQuery({
    queryKey: queryKeys.liveRuns(companyId),
    queryFn: () => api.runs.live(companyId, { minCount: RUN_CARD_LIMIT }),
  });
  const runs = useMemo(() => (live.data ?? []).slice(0, RUN_CARD_LIMIT), [live.data]);
  const agents = useQuery({ queryKey: queryKeys.agents(companyId), queryFn: () => api.agents.list(companyId) });
  const projects = useQuery({ queryKey: queryKeys.projects(companyId), queryFn: () => api.projects.list(companyId) });
  const activity = useQuery({
    queryKey: queryKeys.activity(companyId, { limit: RECENT_LIMIT }),
    queryFn: () => api.activity.list(companyId, { limit: RECENT_LIMIT }),
  });
  const machines = useQuery({
    queryKey: queryKeys.crew('crew.machines', { companyId }),
    queryFn: () => api.crew.machines(companyId),
  });
  const roots = useQuery({
    queryKey: queryKeys.crew('crew.roots', { companyId }),
    queryFn: () => api.crew.roots(companyId),
  });
  const recentRoots = useMemo(
    () => [...(roots.data ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, RECENT_LIMIT),
    [roots.data],
  );

  // Issue của các thẻ run mà danh sách chưa có (cũ hơn giới hạn) thì lấy riêng, giống ActiveAgentsPanel gốc.
  const known = useMemo(() => new Set((issues.data ?? []).map((i) => i.id)), [issues.data]);
  const missingIds = useMemo(
    () => [
      ...new Set(runs.map((r) => r.issueId).filter((id): id is string => Boolean(id) && !known.has(id as string))),
    ],
    [runs, known],
  );
  const extraIssues = useQueries({
    queries: issues.data
      ? missingIds.map((id) => ({
          queryKey: queryKeys.issue(id),
          queryFn: () => api.issues.get(id),
          staleTime: 30_000,
          retry: false,
        }))
      : [],
  });
  const issueById = useMemo(() => {
    const map = new Map((issues.data ?? []).map((i) => [i.id, i]));
    for (const q of extraIssues) if (q.data) map.set(q.data.id, q.data);
    return map;
  }, [issues.data, extraIssues]);

  return {
    summary,
    inbox,
    awaiting,
    issues,
    issueById,
    live,
    runs,
    agents,
    projects,
    activity,
    machines,
    roots,
    recentRoots,
  };
}

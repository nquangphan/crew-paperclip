import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api, queryKeys } from '@/api';
import { useMe } from '@/app/hooks';
import { inboxTabs, useInboxIssues } from '@/features/inbox';

/** Số run gần đây và yêu cầu gần đây hiện trên Tổng quan. */
export const RECENT_LIMIT = 6;

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
  const issues = useInboxIssues(companyId);
  const awaiting = useMemo(() => inboxTabs(issues.data ?? [], me).awaiting_me.length, [issues.data, me]);
  const runs = useQuery({
    queryKey: queryKeys.runs(companyId, { limit: RECENT_LIMIT }),
    queryFn: () => api.runs.list(companyId, { limit: RECENT_LIMIT }),
  });
  const live = useQuery({ queryKey: queryKeys.liveRuns(companyId), queryFn: () => api.runs.live(companyId) });
  const agents = useQuery({ queryKey: queryKeys.agents(companyId), queryFn: () => api.agents.list(companyId) });
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
  return { summary, issues, awaiting, runs, live, agents, machines, roots, recentRoots };
}

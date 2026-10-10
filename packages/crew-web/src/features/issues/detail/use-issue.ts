// Dữ liệu dùng chung của trang chi tiết yêu cầu: issue, tên agent, project, yêu cầu con, lịch sử, đã đọc.
import type { Issue } from '@paperclipai/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { api, queryKeys } from '@/api';

/** Chi tiết theo mã (TPS-2) hoặc uuid. */
export function useIssue(ref: string | undefined) {
  return useQuery({
    queryKey: queryKeys.issue(ref ?? ''),
    queryFn: () => api.issues.get(ref as string),
    enabled: Boolean(ref),
  });
}

/** Bảng id agent → tên (rỗng khi chưa tải xong; chỗ dùng tự có tên thay thế). */
export function useAgentNames(companyId: string): Record<string, string> {
  const { data } = useQuery({ queryKey: queryKeys.agents(companyId), queryFn: () => api.agents.list(companyId) });
  return Object.fromEntries((data ?? []).map((a) => [a.id, a.name]));
}

export function useProjectName(companyId: string, projectId: string | null): string | null {
  const { data } = useQuery({
    queryKey: queryKeys.projects(companyId),
    queryFn: () => api.projects.list(companyId),
    enabled: Boolean(projectId),
  });
  return data?.find((p) => p.id === projectId)?.name ?? null;
}

/** Lịch sử của yêu cầu, mới nhất trước (S6.18). Khối Lịch sử và badge "Đã ép Done" dùng chung một lần tải. */
export function useIssueActivity(issueId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.issueActivity(issueId ?? ''),
    queryFn: () => api.issues.activity(issueId as string),
    enabled: Boolean(issueId),
  });
}

export interface ChildSummary {
  id: string;
  identifier: string | null;
  title: string;
  status: string;
}

export function useChildIssues(companyId: string, parentId: string | undefined): ChildSummary[] {
  const filters = { parentId, limit: 200 };
  const { data } = useQuery({
    queryKey: queryKeys.issues(companyId, filters),
    queryFn: () => api.issues.listCompact(companyId, filters),
    enabled: Boolean(parentId),
  });
  return (data ?? []).map((i) => ({ id: i.id, identifier: i.identifier, title: i.title, status: i.status }));
}

/**
 * Đánh dấu đã đọc đúng một lần cho mỗi issue được mở (lỗi bỏ qua: không cản việc xem). Xong thì làm mới danh sách
 * issue (Hộp thư, cờ isUnreadForMe) và badge sidebar để số chưa đọc giảm theo.
 */
export function useMarkReadOnce(companyId: string, issueId: string | undefined): void {
  const qc = useQueryClient();
  const done = useRef<string | null>(null);
  useEffect(() => {
    if (!issueId || done.current === issueId) return;
    done.current = issueId;
    api.inbox
      .markRead(issueId)
      .then(() => {
        void qc.invalidateQueries({ queryKey: queryKeys.issues(companyId) });
        void qc.invalidateQueries({ queryKey: queryKeys.sidebarBadges(companyId) });
      })
      .catch(() => {});
  }, [companyId, issueId, qc]);
}

export type { Issue };

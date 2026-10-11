import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api, type ProjectAccess, queryKeys } from '@/api';
import { useCompany } from '@/app/hooks';

/**
 * Project người đang đăng nhập được xem. Owner thấy mọi project; thành viên khác (admin, operator, viewer, Phòng
 * Marketing) chỉ thấy project owner đã cấp ở trang Thành viên, và không thấy yêu cầu không thuộc project nào.
 *
 * Chỉ là lớp ẩn của UI Crew: API lõi của Paperclip vẫn trả đủ. Route góp ý của server mới là cổng thật cho việc gửi.
 */
export interface ProjectVisibility {
  /** Owner: thấy mọi project và mọi yêu cầu. */
  all: boolean;
  projectIds: ReadonlySet<string>;
}

/** Chưa biết quyền (đang tải, lỗi) thì không thấy gì: đóng khi lỗi. */
export const NO_PROJECTS: ProjectVisibility = { all: false, projectIds: new Set() };

export function toVisibility(data: ProjectAccess | undefined): ProjectVisibility {
  if (!data) return NO_PROJECTS;
  return { all: data.all === true, projectIds: new Set(data.projectIds ?? []) };
}

export function canSeeProject(v: ProjectVisibility, projectId: string | null | undefined): boolean {
  if (v.all) return true;
  return !!projectId && v.projectIds.has(projectId);
}

/** Yêu cầu thấy được khi project của nó thấy được; yêu cầu không có project chỉ owner thấy. */
export function canSeeIssue(v: ProjectVisibility, issue: { projectId?: string | null } | null | undefined): boolean {
  return !!issue && canSeeProject(v, issue.projectId);
}

export function filterProjects<T extends { id: string }>(v: ProjectVisibility, list: readonly T[]): T[] {
  return v.all ? [...list] : list.filter((p) => v.projectIds.has(p.id));
}

export function filterIssues<T extends { projectId?: string | null }>(v: ProjectVisibility, list: readonly T[]): T[] {
  return v.all ? [...list] : list.filter((i) => canSeeIssue(v, i));
}

export interface VisibleProjectsState extends ProjectVisibility {
  /** Đã tải xong quyền xem. */
  ready: boolean;
  /** Không phải owner (chỉ thấy project được cấp). Đang tải cũng tính là bị giới hạn. */
  restricted: boolean;
  loading: boolean;
  error: Error | null;
  retry: () => void;
  canSeeProject: (projectId: string | null | undefined) => boolean;
  canSeeIssue: (issue: { projectId?: string | null } | null | undefined) => boolean;
  /** Ổn định giữa các lần render khi quyền không đổi, nên dùng được làm `select` của useQuery. */
  filterProjects: <T extends { id: string }>(list: readonly T[]) => T[];
  filterIssues: <T extends { projectId?: string | null }>(list: readonly T[]) => T[];
}

/** Hook duy nhất lọc project và yêu cầu trong UI Crew. Chỉ dùng bên trong shell company. */
export function useVisibleProjects(): VisibleProjectsState {
  const { company } = useCompany();
  const query = useQuery({
    queryKey: queryKeys.projectAccess(company.id),
    queryFn: () => api.projectAccess.me(company.id),
    staleTime: 60_000,
  });
  const { data, isPending, error, refetch } = query;
  return useMemo(() => {
    const v = toVisibility(data);
    return {
      ...v,
      ready: data !== undefined,
      restricted: !v.all,
      loading: isPending,
      error: data ? null : error,
      retry: () => void refetch(),
      canSeeProject: (projectId) => canSeeProject(v, projectId),
      canSeeIssue: (issue) => canSeeIssue(v, issue),
      filterProjects: (list) => filterProjects(v, list),
      filterIssues: (list) => filterIssues(v, list),
    };
  }, [data, isPending, error, refetch]);
}

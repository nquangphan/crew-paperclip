// Dữ liệu trang Roadmap. Mọi danh sách lọc bằng `useVisibleProjects` (chỉ project được cấp; yêu cầu không project chỉ
// owner thấy), như các trang khác. Khóa cache trùng trang Yêu cầu và trang Docs nên dùng chung dữ liệu và sự kiện live.
// Tầng sâu hơn dùng dữ liệu tầng trên làm `placeholderData` để chuyển tầng không chờ mạng.
import type { CompactIssue } from '@paperclipai/shared';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { api, type IssueListFilters, type JevRequestMap, queryKeys } from '@/api';
import { useCompanyAccess, useVisibleProjects } from '@/features/access';
import { childrenIndex, descendantsOf, LIST_LIMIT, NO_PROJECT, projectRoots } from './roadmap-model';

/** Danh sách đã lọc quyền, kèm cờ "server có thể đã cắt" (đủ trần dòng). */
export interface IssueSlice {
  items: CompactIssue[];
  truncated: boolean;
}

export interface RoadmapDataParams {
  project: string | null;
  /** Mã yêu cầu trên URL (TPS-12). */
  request: string | null;
  /** Đang ở tầng project hoặc nhánh Docs: cần cây docs của project. */
  needDocs: boolean;
  /** Trang docs đang mở popup. */
  doc: string | null;
}

/** Bản đồ Jev dùng được: Jev bật và đúng dạng; còn lại là `undefined` (không huy hiệu). */
function usableJevMap(data: JevRequestMap): JevRequestMap | undefined {
  const isRecord = (v: unknown) => typeof v === 'object' && v !== null && !Array.isArray(v);
  if (!isRecord(data) || data.enabled !== true || !isRecord(data.byIssue) || !isRecord(data.shadowMismatch))
    return undefined;
  return data;
}

/** Chu kỳ làm tươi số liệu Jev trên bản đồ. */
const JEV_MAP_REFRESH_MS = 30_000;

export const companyFilters = (): IssueListFilters => ({ view: 'compact', limit: LIST_LIMIT });

export function useRoadmapData(companyId: string, p: RoadmapDataParams) {
  const visible = useVisibleProjects();
  const { filterIssues } = visible;
  const slice = useCallback(
    (list: CompactIssue[]): IssueSlice => ({ items: filterIssues(list), truncated: list.length >= LIST_LIMIT }),
    [filterIssues],
  );

  const projects = useQuery({
    queryKey: queryKeys.projects(companyId),
    queryFn: () => api.projects.list(companyId),
    select: visible.filterProjects,
    enabled: visible.ready,
  });

  const cf = companyFilters();
  const company = useQuery({
    queryKey: queryKeys.issues(companyId, cf),
    queryFn: () => api.issues.listCompact(companyId, cf),
    select: slice,
    enabled: visible.ready,
  });

  const realProject = p.project && p.project !== NO_PROJECT ? p.project : null;
  const pf: IssueListFilters = { view: 'compact', limit: LIST_LIMIT, projectId: realProject ?? '' };
  const project = useQuery({
    queryKey: queryKeys.issues(companyId, pf),
    queryFn: () => api.issues.listCompact(companyId, pf),
    select: slice,
    enabled: visible.ready && realProject !== null && visible.canSeeProject(realProject),
    placeholderData: () => company.data?.items.filter((i) => i.projectId === realProject),
  });

  const issuesOfProject = p.project === NO_PROJECT ? company.data?.items : project.data?.items;
  // Mã trên URL → yêu cầu, chỉ tìm trong yêu cầu gốc do người tạo của project (không lộ yêu cầu project khác).
  const roots = useMemo(
    () => (p.project && issuesOfProject ? projectRoots(p.project, issuesOfProject) : []),
    [p.project, issuesOfProject],
  );
  const wanted = p.request?.toLowerCase() ?? null;
  const request = wanted ? (roots.find((r) => r.identifier?.toLowerCase() === wanted) ?? null) : null;
  const requestId = request?.id ?? null;
  // Cạnh "chặn" cần `blockedBy`; danh sách compact chỉ trả trường này khi xin rõ.
  const sf: IssueListFilters = {
    view: 'compact',
    limit: LIST_LIMIT,
    descendantOf: requestId ?? '',
    includeBlockedBy: 'true',
  };
  const subtree = useQuery({
    queryKey: queryKeys.issues(companyId, sf),
    queryFn: () => api.issues.listCompact(companyId, sf),
    select: slice,
    enabled: visible.ready && requestId !== null,
    placeholderData: () =>
      requestId && issuesOfProject
        ? (descendantsOf(requestId, childrenIndex(issuesOfProject)) as CompactIssue[])
        : undefined,
  });

  const agents = useQuery({
    queryKey: queryKeys.agents(companyId),
    queryFn: () => api.agents.list(companyId),
    enabled: requestId !== null,
  });

  // Run và chi phí của cây yêu cầu; khóa `crew` nên được làm tươi cùng sự kiện issue như bản đồ Crew.
  const runs = useQuery({
    queryKey: queryKeys.crew('crew.runs', { companyId, issueId: requestId }),
    queryFn: () => api.crew.runs(companyId, requestId as string),
    enabled: visible.ready && requestId !== null,
  });

  // Huy hiệu Jev: chỉ owner, tải sau bản đồ (không chặn vẽ). Route bản đồ tự báo Jev bật hay tắt; tắt, lỗi hay sai dạng thì
  // không có huy hiệu, bản đồ vẫn như cũ. Chỉ làm tươi định kỳ khi Jev đang bật.
  const { isOwner } = useCompanyAccess();
  const jev = useQuery({
    queryKey: queryKeys.jev(companyId, 'map', requestId),
    queryFn: () => api.jev.requestMap(companyId, requestId as string),
    select: usableJevMap,
    enabled: isOwner && requestId !== null && subtree.data !== undefined,
    retry: false,
    refetchInterval: (query) => (query.state.data?.enabled === true ? JEV_MAP_REFRESH_MS : false),
  });

  const docsProjects = useQuery({
    queryKey: queryKeys.crew('crew.docs.projects', { companyId }),
    queryFn: () => api.crew.docsProjects(companyId),
    select: (list) => list.filter((d) => visible.canSeeProject(d.projectId)),
    enabled: visible.ready && p.needDocs && realProject !== null,
  });
  const hasDocs = !!realProject && !!docsProjects.data?.some((d) => d.projectId === realProject);
  const tree = useQuery({
    queryKey: queryKeys.crew('crew.docs.tree', { companyId, projectId: realProject }),
    queryFn: () => api.crew.docsTree(companyId, realProject as string),
    enabled: p.needDocs && hasDocs,
  });
  const page = useQuery({
    queryKey: queryKeys.crew('crew.docs.page', { companyId, projectId: realProject, path: p.doc }),
    queryFn: () => api.crew.docsPage(companyId, realProject as string, p.doc as string),
    enabled: hasDocs && p.doc !== null,
  });

  return {
    visible,
    projects,
    company,
    project,
    issuesOfProject,
    request,
    subtree,
    agents,
    runs,
    jev,
    docsProjects,
    hasDocs,
    tree,
    page,
  };
}

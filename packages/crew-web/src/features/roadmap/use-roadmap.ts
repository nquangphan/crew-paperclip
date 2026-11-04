// Dữ liệu trang Roadmap. Mọi yêu cầu và cây việc con đến từ MỘT lần tải `crew.roadmap` (số query cố định ở worker, không
// gọi theo từng yêu cầu); server Crew đã lọc theo project người xem được cấp, hook lọc thêm bằng `useVisibleProjects`
// cho chắc. Các tầng (công ty, project, yêu cầu) dựng từ cùng dữ liệu nên chuyển tầng không chờ mạng. Khóa nằm dưới
// tiền tố `crew` nên sự kiện live của issue làm tươi (`live-events.ts`). Run và tiền tải lười theo yêu cầu đang xem.
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api, queryKeys } from '@/api';
import { useVisibleProjects } from '@/features/access';
import { issuesFromRoadmap, NO_PROJECT, projectRoots, type RoadmapIssue } from './roadmap-model';

/** Danh sách đã lọc quyền, kèm cờ "server đã cắt" (vượt trần nút của `crew.roadmap`). */
export interface IssueSlice {
  items: RoadmapIssue[];
  truncated: boolean;
}

/** Một phần dữ liệu dựng từ lần tải chung, cùng trạng thái tải của lần tải đó. */
export interface RoadmapSlice<T> {
  data: T | undefined;
  isPending: boolean;
  isPlaceholderData: boolean;
  error: Error | null;
  refetch: () => Promise<unknown>;
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

export function useRoadmapData(companyId: string, p: RoadmapDataParams) {
  const visible = useVisibleProjects();
  const { filterIssues } = visible;

  const projects = useQuery({
    queryKey: queryKeys.projects(companyId),
    queryFn: () => api.projects.list(companyId),
    select: visible.filterProjects,
    enabled: visible.ready,
  });

  const roadmap = useQuery({
    queryKey: queryKeys.crew('crew.roadmap', { companyId }),
    queryFn: () => api.crew.roadmap(companyId),
    enabled: visible.ready,
  });
  const all = useMemo(() => {
    if (!roadmap.data) return undefined;
    return {
      issues: filterIssues(issuesFromRoadmap(roadmap.data)),
      rootOf: new Map(roadmap.data.nodes.map((n) => [n.id, n.rootId])),
      agents: [
        ...new Map(
          roadmap.data.nodes.flatMap((n) => (n.assignee ? [[n.assignee.id, n.assignee] as const] : [])),
        ).values(),
      ],
      truncated: roadmap.data.truncated,
    };
  }, [roadmap.data, filterIssues]);
  const slice = <T>(data: T | undefined): RoadmapSlice<T> => ({
    data,
    isPending: roadmap.isPending,
    isPlaceholderData: false,
    error: roadmap.error,
    refetch: roadmap.refetch,
  });

  const company = slice<IssueSlice>(all && { items: all.issues, truncated: all.truncated });

  const realProject = p.project && p.project !== NO_PROJECT ? p.project : null;
  const projectItems = useMemo(
    () =>
      all && realProject && visible.canSeeProject(realProject)
        ? all.issues.filter((i) => i.projectId === realProject)
        : undefined,
    [all, realProject, visible],
  );
  const project = slice<IssueSlice>(projectItems && all && { items: projectItems, truncated: all.truncated });

  const issuesOfProject = p.project === NO_PROJECT ? company.data?.items : project.data?.items;
  // Mã trên URL → yêu cầu, chỉ tìm trong yêu cầu gốc do người tạo của project (không lộ yêu cầu project khác).
  const roots = useMemo(
    () => (p.project && issuesOfProject ? projectRoots(p.project, issuesOfProject) : []),
    [p.project, issuesOfProject],
  );
  const wanted = p.request?.toLowerCase() ?? null;
  const request = wanted ? (roots.find((r) => r.identifier?.toLowerCase() === wanted) ?? null) : null;
  const requestId = request?.id ?? null;
  // Cây của yêu cầu: mọi nút có cùng gốc (worker ghi `rootId`), cạnh "chặn" đã nằm trong `blockedBy`.
  const subtreeItems = useMemo(
    () => (all && requestId ? all.issues.filter((i) => all.rootOf.get(i.id) === requestId) : undefined),
    [all, requestId],
  );
  const subtree = slice<IssueSlice>(subtreeItems && all && { items: subtreeItems, truncated: all.truncated });
  // Tên người làm có sẵn trong nút, không tải danh sách agent riêng.
  const agents = slice(all?.agents);

  // Run và chi phí của cây yêu cầu (tải lười theo yêu cầu đang xem); khóa `crew` được làm tươi cùng sự kiện issue.
  const runs = useQuery({
    queryKey: queryKeys.crew('crew.runs', { companyId, issueId: requestId }),
    queryFn: () => api.crew.runs(companyId, requestId as string),
    enabled: visible.ready && requestId !== null,
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
    docsProjects,
    hasDocs,
    tree,
    page,
  };
}

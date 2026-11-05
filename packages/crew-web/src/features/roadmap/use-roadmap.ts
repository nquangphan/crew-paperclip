// Dữ liệu trang Roadmap một trang. Mọi yêu cầu và cây việc con đến từ MỘT lần tải `crew.roadmap` (số query cố định ở
// worker, không gọi theo từng yêu cầu); server Crew đã lọc theo project người xem được cấp, hook lọc thêm bằng
// `useVisibleProjects` cho chắc. Khóa nằm dưới tiền tố `crew` nên sự kiện live của issue làm tươi (`live-events.ts`).
// Run và tiền tải lười theo yêu cầu đang lấy nét (`crew.runs`). Cây Docs của các project có docs tải song song (vài KB
// mỗi project, chỉ đường và tiêu đề) để đảo Docs có đủ kích thước ngay, bố cục không xê dịch khi tải xong; docs lỗi
// không chặn bản đồ.
import { useQueries, useQuery } from '@tanstack/react-query';
import { useMemo, useRef } from 'react';
import { api, queryKeys } from '@/api';
import { useVisibleProjects } from '@/features/access';
import type { ProjectDocs } from './roadmap-model';

export interface RoadmapDataParams {
  /** Giá trị `?focus=`: mã yêu cầu/việc con thì tải run của cả cây yêu cầu đó; `docs:`/`dir:` cho project của popup docs. */
  focus: string | null;
  /** Trang docs đang mở popup. */
  doc: string | null;
}

/** Project của chỗ lấy nét trong nhánh Docs (`docs:<id>`, `dir:<id>:<thư mục>`). */
export function docsProjectOf(focus: string | null): string | null {
  const m = focus ? /^(?:docs:([^:]+)|dir:([^:]+):)/.exec(focus) : null;
  return m ? (m[1] ?? m[2] ?? null) : null;
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

  const roadmapQuery = useQuery({
    queryKey: queryKeys.crew('crew.roadmap', { companyId }),
    queryFn: () => api.crew.roadmap(companyId),
    enabled: visible.ready,
  });
  const roadmap = useMemo(
    () => (roadmapQuery.data ? { ...roadmapQuery.data, nodes: filterIssues(roadmapQuery.data.nodes) } : undefined),
    [roadmapQuery.data, filterIssues],
  );

  // Run và chi phí của cây yêu cầu đang lấy nét; khóa `crew` được làm tươi cùng sự kiện issue.
  const wanted = p.focus?.toLowerCase() ?? null;
  const requestId = useMemo(
    () => (wanted ? (roadmap?.nodes.find((n) => n.identifier?.toLowerCase() === wanted)?.rootId ?? null) : null),
    [roadmap, wanted],
  );
  const runs = useQuery({
    queryKey: queryKeys.crew('crew.runs', { companyId, issueId: requestId }),
    queryFn: () => api.crew.runs(companyId, requestId as string),
    enabled: visible.ready && requestId !== null,
  });
  const docProject = docsProjectOf(p.focus);

  const docsProjects = useQuery({
    queryKey: queryKeys.crew('crew.docs.projects', { companyId }),
    queryFn: () => api.crew.docsProjects(companyId),
    select: (list) => list.filter((d) => visible.canSeeProject(d.projectId)),
    enabled: visible.ready,
  });
  const docProjectIds = useMemo(() => (docsProjects.data ?? []).map((d) => d.projectId), [docsProjects.data]);
  // Lần đầu chờ danh sách docs và các cây để bố cục dựng với đủ đảo Docs. Nhánh Docs không được chặn bản đồ chính: danh
  // sách docs lỗi (kể cả đang thử lại) thì dựng không có đảo Docs, cây lỗi (kể cả đang thử lại) là `null` ngay. Đã hiện
  // bản đồ rồi thì không chờ nữa: docs tải được về sau được bổ sung, cây còn đang tải là `'loading'` (nút Docs giữ chỗ).
  // `combine` trả kết quả ổn định (chia sẻ cấu trúc) nên chỉ đổi khi một cây đổi.
  const trees = useQueries({
    queries: docProjectIds.map((projectId) => ({
      queryKey: queryKeys.crew('crew.docs.tree', { companyId, projectId }),
      queryFn: () => api.crew.docsTree(companyId, projectId),
    })),
    combine: (results) => ({
      loading: results.map((q) => q.isPending && q.failureCount === 0),
      data: results.map((q) => q.data ?? null),
    }),
  });
  /** Company đã qua lần chờ docs đầu tiên (đổi company thì chờ lại). */
  const shown = useRef<string | null>(null);
  const docsListFailed = docsProjects.isError || docsProjects.failureCount > 0;
  const docsPending =
    shown.current !== companyId &&
    visible.ready &&
    !docsListFailed &&
    (docsProjects.isPending || trees.loading.includes(true));
  if (visible.ready && !docsPending) shown.current = companyId;
  /** undefined: còn đang tải lần đầu. */
  const docs = useMemo(() => {
    if (docsPending) return undefined;
    const out = new Map<string, ProjectDocs>();
    docProjectIds.forEach((projectId, i) => {
      const tree = trees.data[i];
      out.set(projectId, tree ? { pages: tree.pages } : trees.loading[i] ? 'loading' : null);
    });
    return out;
  }, [docProjectIds, trees.data, trees.loading, docsPending]);
  const docTree = docProject ? (trees.data[docProjectIds.indexOf(docProject)] ?? null) : null;

  const page = useQuery({
    queryKey: queryKeys.crew('crew.docs.page', { companyId, projectId: docProject, path: p.doc }),
    queryFn: () => api.crew.docsPage(companyId, docProject as string, p.doc as string),
    enabled: !!docProject && docProjectIds.includes(docProject) && p.doc !== null,
  });

  return { visible, projects, roadmapQuery, roadmap, requestId, runs, docsProjects, docs, docProject, docTree, page };
}

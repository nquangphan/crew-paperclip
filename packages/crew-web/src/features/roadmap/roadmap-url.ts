// Hợp đồng URL của trang Roadmap. Tầng đang xem nằm trên query để gửi link được và nút Back trình duyệt lùi tầng:
//   ?project=<projectId|none>            tầng project ("none": yêu cầu không thuộc project nào, chỉ owner)
//   &request=<mã TPS-12>                 tầng yêu cầu (cây việc con)
//   &docs=1[&folder=<đường thư mục>]     nhánh Docs của project (gốc bộ docs hoặc một thư mục)
//   &doc=<đường trang>                   popup đọc một trang docs (trên nhánh Docs)
//   &view=list                           dạng danh sách thay cho bản đồ
//   &issue=<mã>                          popup chi tiết yêu cầu dùng chung của shell (xem features/issues/popup)
import { ISSUE_PARAM } from '@/features/issues/popup/issue-href';

export interface LocationLike {
  pathname: string;
  search: string;
}

export type RoadmapView = 'map' | 'list';

export interface RoadmapParams {
  project: string | null;
  request: string | null;
  docs: boolean;
  folder: string | null;
  doc: string | null;
  view: RoadmapView;
}

/** Đích chuyển tầng (không gồm view, giữ nguyên khi đổi tầng). */
export interface RoadmapTarget {
  project?: string | null;
  request?: string | null;
  docs?: boolean;
  folder?: string | null;
}

const P = { project: 'project', request: 'request', docs: 'docs', folder: 'folder', doc: 'doc', view: 'view' } as const;

const clean = (v: string | null) => {
  const s = v?.trim();
  return s ? s : null;
};
/** Đường thư mục: bỏ `/` thừa ở đầu cuối, không nhận `..`. */
const cleanPath = (v: string | null) => {
  const s = clean(v)?.replace(/^\/+|\/+$/g, '') ?? null;
  return s && !s.split('/').includes('..') ? s : null;
};

export function parseRoadmapParams(search: string): RoadmapParams {
  const q = new URLSearchParams(search);
  const project = clean(q.get(P.project));
  const request = project ? clean(q.get(P.request)) : null;
  const docs = !!project && !request && q.get(P.docs) === '1';
  return {
    project,
    request,
    docs,
    folder: docs ? cleanPath(q.get(P.folder)) : null,
    doc: docs ? cleanPath(q.get(P.doc)) : null,
    view: q.get(P.view) === 'list' ? 'list' : 'map',
  };
}

const withSearch = (pathname: string, q: URLSearchParams) => {
  const s = q.toString();
  return s ? `${pathname}?${s}` : pathname;
};

/** Đường tới một tầng: giữ tham số khác (view), bỏ popup (`issue`, `doc`) vì chúng thuộc tầng cũ. */
export function roadmapHref(current: LocationLike, target: RoadmapTarget): string {
  const q = new URLSearchParams(current.search);
  for (const key of [P.project, P.request, P.docs, P.folder, P.doc, ISSUE_PARAM]) q.delete(key);
  if (target.project) {
    q.set(P.project, target.project);
    if (target.request) q.set(P.request, target.request);
    else if (target.docs) {
      q.set(P.docs, '1');
      if (target.folder) q.set(P.folder, target.folder);
    }
  }
  return withSearch(current.pathname, q);
}

/** Đổi dạng bản đồ/danh sách, giữ tầng. */
export function viewHref(current: LocationLike, view: RoadmapView): string {
  const q = new URLSearchParams(current.search);
  if (view === 'list') q.set(P.view, 'list');
  else q.delete(P.view);
  return withSearch(current.pathname, q);
}

/** Mở (hoặc đóng khi `path` null) popup đọc trang docs, giữ tầng. */
export function docHref(current: LocationLike, path: string | null): string {
  const q = new URLSearchParams(current.search);
  if (path) q.set(P.doc, path);
  else q.delete(P.doc);
  return withSearch(current.pathname, q);
}

/** Tầng cha của tầng đang xem; null ở tầng công ty. */
export function parentTarget(p: Pick<RoadmapParams, 'project' | 'request' | 'docs' | 'folder'>): RoadmapTarget | null {
  if (!p.project) return null;
  if (p.request) return { project: p.project };
  if (p.docs && p.folder) {
    const up = p.folder.split('/').slice(0, -1).join('/');
    return { project: p.project, docs: true, folder: up || null };
  }
  if (p.docs) return { project: p.project };
  return {};
}

/** Độ sâu tầng: công ty 0, project 1, yêu cầu hoặc gốc docs 2, mỗi cấp thư mục thêm 1. */
export function levelDepth(p: Pick<RoadmapParams, 'project' | 'request' | 'docs' | 'folder'>): number {
  if (!p.project) return 0;
  if (p.request) return 2;
  if (p.docs) return 2 + (p.folder ? p.folder.split('/').length : 0);
  return 1;
}

/** Khóa tầng (đổi khóa = đổi tầng, chạy chuyển động). */
export function levelKeyOf(p: Pick<RoadmapParams, 'project' | 'request' | 'docs' | 'folder'>): string {
  return [p.project ?? '', p.request ?? '', p.docs ? 'docs' : '', p.folder ?? ''].join('|');
}

// Hợp đồng URL của trang Roadmap một trang. Chỗ camera đang lấy nét nằm trên query để gửi link được; mỗi lần lấy nét
// đẩy một mục lịch sử nên Back trình duyệt bay về chỗ trước:
//   ?focus=<mã TPS-12>                 yêu cầu hoặc việc con
//   ?focus=project:<projectId|none>    cụm project ("none": yêu cầu không thuộc project nào, chỉ owner)
//   ?focus=docs:<projectId>            đảo Docs của project
//   ?focus=dir:<projectId>:<thư mục>   một thư mục docs
//   (không có focus)                   toàn cảnh
//   &doc=<đường trang>                 popup đọc một trang docs (project lấy từ focus)
//   &view=list                         dạng danh sách thay cho bản đồ
//   &issue=<mã>                        popup chi tiết yêu cầu dùng chung của shell (xem features/issues/popup)
// Link cũ (?project=, &request=, &docs=1, &folder=) tự đổi sang ?focus= (`legacyHref`).
import { ISSUE_PARAM } from '@/features/issues/popup/issue-href';

export interface LocationLike {
  pathname: string;
  search: string;
}

export type RoadmapView = 'map' | 'list';

export interface RoadmapParams {
  /** Chỗ đang lấy nét; null là toàn cảnh. */
  focus: string | null;
  doc: string | null;
  view: RoadmapView;
}

const P = { focus: 'focus', doc: 'doc', view: 'view' } as const;
/** Tham số của bản nhiều tầng cũ. */
const LEGACY = { project: 'project', request: 'request', docs: 'docs', folder: 'folder' } as const;

const clean = (v: string | null) => {
  const s = v?.trim();
  return s ? s : null;
};
/** Đường docs: bỏ `/` thừa ở đầu cuối, không nhận `..`. */
const cleanPath = (v: string | null) => {
  const s = clean(v)?.replace(/^\/+|\/+$/g, '') ?? null;
  return s && !s.split('/').includes('..') ? s : null;
};

export function parseRoadmapParams(search: string): RoadmapParams {
  const q = new URLSearchParams(search);
  return {
    focus: clean(q.get(P.focus)),
    doc: cleanPath(q.get(P.doc)),
    view: q.get(P.view) === 'list' ? 'list' : 'map',
  };
}

const withSearch = (pathname: string, q: URLSearchParams) => {
  const s = q.toString();
  return s ? `${pathname}?${s}` : pathname;
};

/** Đường tới một chỗ lấy nét (null: toàn cảnh): giữ view, bỏ popup (`issue`, `doc`) và tham số cũ. */
export function focusHref(current: LocationLike, focus: string | null): string {
  const q = new URLSearchParams(current.search);
  for (const key of [P.focus, P.doc, ISSUE_PARAM, ...Object.values(LEGACY)]) q.delete(key);
  if (focus) q.set(P.focus, focus);
  return withSearch(current.pathname, q);
}

/**
 * Link cũ của bản nhiều tầng → đường với `?focus=` (giữ view, popup issue, trang docs). null khi URL không có tham số
 * cũ. Trang thay URL (replace) nên Back không quay lại dạng cũ.
 */
export function legacyHref(current: LocationLike): string | null {
  const q = new URLSearchParams(current.search);
  const project = clean(q.get(LEGACY.project));
  const request = clean(q.get(LEGACY.request));
  const docs = q.get(LEGACY.docs) === '1';
  const folder = cleanPath(q.get(LEGACY.folder));
  if (!project && !request && !q.has(LEGACY.docs) && !q.has(LEGACY.folder)) return null;
  const doc = q.get(P.doc);
  for (const key of [...Object.values(LEGACY), P.doc]) q.delete(key);
  let focus: string | null = null;
  if (request) focus = request;
  else if (project && docs) focus = folder ? `dir:${project}:${folder}` : `docs:${project}`;
  else if (project) focus = `project:${project}`;
  if (focus && !q.has(P.focus)) q.set(P.focus, focus);
  if (doc && docs) q.set(P.doc, doc);
  return withSearch(current.pathname, q);
}

/** Đổi dạng bản đồ/danh sách, giữ chỗ lấy nét. */
export function viewHref(current: LocationLike, view: RoadmapView): string {
  const q = new URLSearchParams(current.search);
  if (view === 'list') q.set(P.view, 'list');
  else q.delete(P.view);
  return withSearch(current.pathname, q);
}

/** Mở (hoặc đóng khi `path` null) popup đọc trang docs, giữ chỗ lấy nét. */
export function docHref(current: LocationLike, path: string | null): string {
  const q = new URLSearchParams(current.search);
  if (path) q.set(P.doc, path);
  else q.delete(P.doc);
  return withSearch(current.pathname, q);
}

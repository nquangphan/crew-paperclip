// Ai thấy mục/trang nào. Chỉ là UI: viewer ẩn mục agent/run/chi phí/hoạt động cho gọn, còn quyền thật nằm ở server.
import type { NavId } from '@/app/routes-util';
import type { CompanyAccessState } from './use-company-access';

type Access = Pick<CompanyAccessState, 'isOwner' | 'isContributor' | 'readOnly' | 'loading'>;

/** Viewer đã xác định (không phải đang tải): mới ẩn bớt mục, để owner không thấy sidebar chớp. */
const isViewer = (a: Access) => a.readOnly && !a.loading;

/** Mục sidebar viewer không dùng được. */
const VIEWER_HIDDEN_NAV: ReadonlySet<NavId> = new Set(['inbox', 'agents', 'skills', 'machines']);

/** Đoạn đầu của route viewer không vào được (đưa về Tổng quan). */
const VIEWER_HIDDEN_SEGMENTS: ReadonlySet<string> = new Set([
  'inbox',
  'agents',
  'skills',
  'machines',
  'wizards',
  'runs',
  'costs',
  'activity',
]);
/** Route wizard nằm dưới `projects/`. */
const VIEWER_HIDDEN_PROJECT_SUBPATHS: ReadonlySet<string> = new Set(['new', 'remove']);

export function navItemVisible(id: NavId, a: Access): boolean {
  if (id === 'members') return a.isOwner;
  if (id === 'contributions') return a.isOwner || a.isContributor;
  if (id === 'newIssue') return !isViewer(a) || a.isContributor;
  if (isViewer(a) && VIEWER_HIDDEN_NAV.has(id)) return false;
  return true;
}

/** Khóa dịch của nhãn sidebar: owner thấy "Chờ duyệt", khách thấy "Góp ý của tôi". */
export function navLabelKey(id: NavId, a: Access): string {
  return id === 'contributions' && !a.isOwner ? 'nav.contributionsMine' : `nav.${id}`;
}

/** Route (đường tương đối dưới /:companyPrefix, tách theo `/`) mà mọi người vào được hay không. Chưa tải xong thì cho qua. */
export function routeAllowed(rel: readonly string[], a: Access): boolean {
  const [first = '', second = ''] = rel;
  if (first === 'members') return a.isOwner;
  if (first === 'contributions') return a.isOwner || a.isContributor;
  if (!isViewer(a)) return true;
  if (VIEWER_HIDDEN_SEGMENTS.has(first)) return false;
  return !(first === 'projects' && VIEWER_HIDDEN_PROJECT_SUBPATHS.has(second));
}

/** Route mà câu trả lời "được vào" phụ thuộc vai trò, nên phải đợi tải xong trước khi hiện hay chuyển hướng. */
export function routeNeedsAccess(rel: readonly string[]): boolean {
  const [first = '', second = ''] = rel;
  return (
    first === 'members' ||
    first === 'contributions' ||
    VIEWER_HIDDEN_SEGMENTS.has(first) ||
    (first === 'projects' && VIEWER_HIDDEN_PROJECT_SUBPATHS.has(second))
  );
}

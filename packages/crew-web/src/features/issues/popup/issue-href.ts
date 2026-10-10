// Hợp đồng URL của popup chi tiết yêu cầu. `?issue=<mã>` trên BẤT KỲ trang nào trong company mở popup chi tiết đó
// phía trên trang đang xem; bỏ tham số thì popup đóng, trang dưới giữ nguyên. Trang đầy đủ vẫn là
// `/<prefix>/issues/<mã>` (link trực tiếp, tab mới, nút "Mở toàn trang").

export const ISSUE_PARAM = 'issue';

export interface LocationLike {
  pathname: string;
  search: string;
}

const withSearch = (pathname: string, params: URLSearchParams) => {
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
};

/** Đường mở popup `identifier` trên trang đang xem: giữ đường và tham số khác, thay `issue`, gắn neo nếu có. */
export function issueHref(identifier: string, current: LocationLike, hash = ''): string {
  const params = new URLSearchParams(current.search);
  params.set(ISSUE_PARAM, identifier);
  return `${withSearch(current.pathname, params)}${hash}`;
}

/** Đường sau khi đóng popup: bỏ `issue` và neo, giữ tham số khác. */
export function closeIssueHref(current: LocationLike): string {
  const params = new URLSearchParams(current.search);
  params.delete(ISSUE_PARAM);
  return withSearch(current.pathname, params);
}

/** Mã yêu cầu đang mở popup, null nếu không có. */
export function popupIssueRef(search: string): string | null {
  return new URLSearchParams(search).get(ISSUE_PARAM) || null;
}

/** Trang chi tiết đầy đủ. */
export function issuePageHref(prefix: string, identifier: string, hash = ''): string {
  return `/${prefix}/issues/${identifier}${hash}`;
}

/** Tách mã và neo từ đường trang đầy đủ của company `prefix` (ví dụ href kết quả tìm kiếm); đường khác thì null. */
export function parseIssuePath(href: string, prefix: string): { identifier: string; hash: string } | null {
  const m = new RegExp(`^/${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/issues/([^/?#]+)(#.*)?$`).exec(href);
  return m ? { identifier: decodeURIComponent(m[1]), hash: m[2] ?? '' } : null;
}

/** Click để trình duyệt tự xử lý (mở tab mới/cửa sổ mới): có phím bổ trợ hoặc không phải chuột trái. */
export function isNewTabClick(e: {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  button: number;
}): boolean {
  return e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0;
}

/** Cách mở yêu cầu khác tùy chỗ đang đứng: trong popup (thay popup), trên trang đầy đủ, hay ngoài chi tiết. */
export type IssueNavMode = 'outside' | 'popup' | 'page';

export function issueNavMode(current: LocationLike, prefix: string): IssueNavMode {
  if (popupIssueRef(current.search)) return 'popup';
  return parseIssuePath(current.pathname, prefix) ? 'page' : 'outside';
}

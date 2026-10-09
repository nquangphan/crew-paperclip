// Tiện ích điều hướng dùng chung của shell: đường `next` an toàn, mục sidebar, mã issue.
import type { RouteObject } from 'react-router-dom';

const SAFE_BASE = 'http://crew.invalid';

const hasControlChar = (s: string) =>
  [...s].some((ch) => {
    const code = ch.charCodeAt(0);
    return code < 0x20 || code === 0x7f;
  });

/**
 * Chỉ nhận đường nội bộ bắt đầu bằng `/` để tránh chuyển hướng ra ngoài. Cấm dấu gạch ngược và ký tự điều khiển (trình
 * duyệt bỏ tab/xuống dòng nên `/\t/evil.com` thành `//evil.com`), rồi kiểm lại bằng URL: phải cùng origin.
 */
export function safeNext(next: string | null | undefined): string {
  if (!next?.startsWith('/') || next.startsWith('//') || next.includes('\\') || hasControlChar(next)) return '/';
  try {
    if (new URL(next, SAFE_BASE).origin !== SAFE_BASE) return '/';
  } catch {
    return '/';
  }
  return next;
}

/** Mã issue dạng `TPS-123`. */
export const ISSUE_REF_RE = /^([A-Za-z][A-Za-z0-9]*)-(\d+)$/;

export type NavId =
  | 'newIssue'
  | 'search'
  | 'dashboard'
  | 'inbox'
  | 'issues'
  | 'projects'
  | 'agents'
  | 'skills'
  | 'machines'
  | 'docs'
  | 'guide'
  | 'settings';

export interface NavItem {
  id: NavId;
  /** Route feature phải có thì mục mới hiện (không dựng link chết). */
  segment: string;
  /** Đường tương đối dưới /:companyPrefix/. */
  to: string;
}

/** Thứ tự sidebar theo BA S0.1. "Yêu cầu mới" mở dialog tạo ở trang Yêu cầu (`?new=1`). */
export const NAV_ITEMS: readonly NavItem[] = [
  { id: 'newIssue', segment: 'issues', to: 'issues?new=1' },
  { id: 'search', segment: 'search', to: 'search' },
  { id: 'dashboard', segment: 'dashboard', to: 'dashboard' },
  { id: 'inbox', segment: 'inbox', to: 'inbox' },
  { id: 'issues', segment: 'issues', to: 'issues' },
  { id: 'projects', segment: 'projects', to: 'projects' },
  { id: 'agents', segment: 'agents', to: 'agents' },
  { id: 'skills', segment: 'skills', to: 'skills' },
  { id: 'machines', segment: 'machines', to: 'machines' },
  { id: 'docs', segment: 'docs', to: 'docs' },
  { id: 'guide', segment: 'guide', to: 'guide' },
  { id: 'settings', segment: 'settings', to: 'settings' },
];

/** Đoạn đầu của mọi path route feature (để biết mục sidebar nào đã có trang). */
export function routeSegments(routes: readonly RouteObject[]): Set<string> {
  const out = new Set<string>();
  for (const r of routes) {
    const first = r.path?.replace(/^\//, '').split('/')[0];
    if (first) out.add(first);
  }
  return out;
}

export function companyPath(prefix: string, to: string): string {
  return `/${encodeURIComponent(prefix)}/${to.replace(/^\//, '')}`;
}

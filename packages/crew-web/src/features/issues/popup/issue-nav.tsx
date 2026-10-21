// crew: tự dựng
// Mở chi tiết yêu cầu: click thường mở popup trên trang đang xem (`?issue=`), Cmd/Ctrl/Shift/chuột giữa để trình
// duyệt mở trang đầy đủ ở tab mới. Trong popup, link sang yêu cầu khác thay popup tại chỗ; trên trang đầy đủ thì
// sang trang đầy đủ của yêu cầu kia.
import type { ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useCompany } from '@/app/hooks';
import { closeIssueHref, isNewTabClick, issueHref, issueNavMode, issuePageHref } from './issue-href';

/**
 * Trạng thái history của mục do popup đẩy vào. Mở yêu cầu khác trong popup (cha → con) đẩy thêm một mục, nên Back
 * quay về yêu cầu trước. `depth`: số mục popup đã đẩy liên tiếp tính tới mục này; `rootPushed`: mục đầu tiên cũng do
 * popup đẩy (mở từ trang), khi đó đóng popup lùi hết `depth` bước về trang dưới.
 */
export interface IssuePopupState {
  issuePopup: true;
  depth: number;
  rootPushed: boolean;
}

const popupState = (state: unknown): IssuePopupState | null => {
  if (typeof state !== 'object' || state === null) return null;
  const s = state as Partial<IssuePopupState>;
  if (s.issuePopup !== true) return null;
  // Mục do bản cũ đẩy (chỉ có `issuePopup`): một mục, mở từ trang.
  return { issuePopup: true, depth: s.depth ?? 1, rootPushed: s.rootPushed ?? true };
};

/** Popup đang mở có yêu cầu trước đó trong cùng popup để lùi về (đã mở cha rồi mới sang con). */
export function useIssuePopupCanGoBack(): boolean {
  const state = popupState(useLocation().state);
  return state !== null && (state.rootPushed ? state.depth > 1 : state.depth > 0);
}

/** `href` (trang đầy đủ, cho tab mới) và `open` (theo chế độ đang đứng) của một yêu cầu. */
export function useIssueOpener() {
  const { company } = useCompany();
  const location = useLocation();
  const mode = issueNavMode(location, company.issuePrefix);
  const navigate = useNavigate();
  return {
    href: (identifier: string, hash = '') => issuePageHref(company.issuePrefix, identifier, hash),
    open: (identifier: string, hash = '') => {
      if (mode === 'page') {
        navigate(issuePageHref(company.issuePrefix, identifier, hash));
      } else if (mode === 'popup') {
        // Đẩy mục mới (không ghi đè) để Back quay về yêu cầu đang xem.
        const previous = popupState(location.state);
        const state: IssuePopupState = {
          issuePopup: true,
          depth: (previous?.depth ?? 0) + 1,
          rootPushed: previous?.rootPushed ?? false,
        };
        navigate(issueHref(identifier, location, hash), { state, preventScrollReset: true });
      } else {
        const state: IssuePopupState = { issuePopup: true, depth: 1, rootPushed: true };
        navigate(issueHref(identifier, location, hash), { state, preventScrollReset: true });
      }
    },
  };
}

/**
 * Đóng popup: mở từ trang thì lùi hết các mục popup đã đẩy (Back cũng đóng được), còn popup mở bằng link trực tiếp thì
 * bỏ tham số.
 */
export function useCloseIssuePopup() {
  const location = useLocation();
  const navigate = useNavigate();
  return () => {
    const state = popupState(location.state);
    if (state?.rootPushed) navigate(-state.depth);
    else navigate(closeIssueHref(location), { replace: true, preventScrollReset: true });
  };
}

/** Link tới một yêu cầu: href là trang đầy đủ, click thường mở theo `useIssueOpener`. */
export function IssueLink({
  identifier,
  hash = '',
  children,
}: {
  identifier: string;
  hash?: string;
  children: ReactNode;
}) {
  const { href, open } = useIssueOpener();
  return (
    <Link
      to={href(identifier, hash)}
      onClick={(e) => {
        if (isNewTabClick(e)) return;
        e.preventDefault();
        open(identifier, hash);
      }}
    >
      {children}
    </Link>
  );
}

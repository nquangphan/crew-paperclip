// crew: tự dựng
// Mở chi tiết yêu cầu: click thường mở popup trên trang đang xem (`?issue=`), Cmd/Ctrl/Shift/chuột giữa để trình
// duyệt mở trang đầy đủ ở tab mới. Trong popup, link sang yêu cầu khác thay popup tại chỗ; trên trang đầy đủ thì
// sang trang đầy đủ của yêu cầu kia.
import type { ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useCompany } from '@/app/hooks';
import { closeIssueHref, isNewTabClick, issueHref, issueNavMode, issuePageHref } from './issue-href';

/** Trạng thái history của mục do popup đẩy vào: đóng popup thì lùi một bước thay vì ghi đè. */
export interface IssuePopupState {
  issuePopup: true;
}

const pushedByPopup = (state: unknown): boolean =>
  typeof state === 'object' && state !== null && (state as Partial<IssuePopupState>).issuePopup === true;

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
        navigate(issueHref(identifier, location, hash), {
          replace: true,
          state: location.state,
          preventScrollReset: true,
        });
      } else {
        const state: IssuePopupState = { issuePopup: true };
        navigate(issueHref(identifier, location, hash), { state, preventScrollReset: true });
      }
    },
  };
}

/** Đóng popup: lùi history nếu popup tự đẩy mục vào (Back cũng đóng được), còn link trực tiếp thì bỏ tham số. */
export function useCloseIssuePopup() {
  const location = useLocation();
  const navigate = useNavigate();
  return () => {
    if (pushedByPopup(location.state)) navigate(-1);
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

// crew: tự dựng
import { lazy, Suspense } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/** `?contribution=<id>` trên bất kỳ trang nào trong company mở popup mục góp ý phía trên trang đó. */
export const CONTRIBUTION_PARAM = 'contribution';

interface LocationLike {
  pathname: string;
  search: string;
}

const withSearch = (pathname: string, params: URLSearchParams) => {
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
};

/** Đường mở popup mục `id` trên trang đang xem (giữ tham số khác, bỏ popup issue đang mở nếu có). */
export function contributionHref(id: string, current: LocationLike): string {
  const params = new URLSearchParams(current.search);
  params.delete('issue');
  params.set(CONTRIBUTION_PARAM, id);
  return withSearch(current.pathname, params);
}

/** Đường sau khi đóng popup mục góp ý. */
export function closeContributionHref(current: LocationLike): string {
  const params = new URLSearchParams(current.search);
  params.delete(CONTRIBUTION_PARAM);
  return withSearch(current.pathname, params);
}

/** Id mục góp ý đang mở popup, null nếu không có. */
export function popupContributionId(search: string): string | null {
  return new URLSearchParams(search).get(CONTRIBUTION_PARAM) || null;
}

// Nạp lười: popup chỉ tải khi có `?contribution=`, không nằm trong chunk khởi đầu của shell.
const ContributionPopup = lazy(async () => ({ default: (await import('./contribution-popup')).ContributionPopup }));

/** Gắn một lần ở shell company, cạnh popup issue. Đóng thì bỏ tham số, trang dưới giữ nguyên. */
export function ContributionPopupHost() {
  const location = useLocation();
  const navigate = useNavigate();
  const id = popupContributionId(location.search);
  if (!id) return null;
  return (
    <Suspense fallback={null}>
      <ContributionPopup
        id={id}
        onClose={() => navigate(closeContributionHref(location), { replace: true, preventScrollReset: true })}
      />
    </Suspense>
  );
}

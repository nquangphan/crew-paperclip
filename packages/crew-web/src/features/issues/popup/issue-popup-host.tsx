// crew: tự dựng
import { lazy, Suspense } from 'react';
import { useLocation } from 'react-router-dom';
import { popupIssueRef } from './issue-href';
import { useCloseIssuePopup } from './issue-nav';

// Nạp lười: nội dung chi tiết chỉ tải khi có `?issue=`, không nằm trong chunk khởi đầu của shell.
const IssuePopup = lazy(async () => ({ default: (await import('./issue-popup')).IssuePopup }));

/**
 * Gắn một lần ở shell company: trang nào có `?issue=<mã>` thì hiện popup chi tiết yêu cầu phía trên trang đó.
 * Đóng (Esc, nút Đóng, bấm nền) thì bỏ tham số; Back của trình duyệt cũng đóng vì mở popup là một mục history.
 */
export function IssuePopupHost() {
  const location = useLocation();
  const close = useCloseIssuePopup();
  const ref = popupIssueRef(location.search);
  if (!ref) return null;
  return (
    <Suspense fallback={null}>
      <IssuePopup issueRef={ref} onClose={close} />
    </Suspense>
  );
}

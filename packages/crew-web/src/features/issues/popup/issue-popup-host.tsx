// crew: tự dựng
import { lazy, Suspense } from 'react';
import { useLocation } from 'react-router-dom';
import { StartWorkNotice } from '../detail/start-work';
import { popupIssueRef } from './issue-href';
import { useCloseIssuePopup } from './issue-nav';

// Nạp lười: nội dung chi tiết chỉ tải khi có `?issue=`, không nằm trong chunk khởi đầu của shell.
const IssuePopup = lazy(async () => ({ default: (await import('./issue-popup')).IssuePopup }));

/**
 * Gắn một lần ở shell company: trang nào có `?issue=<mã>` thì hiện popup chi tiết yêu cầu phía trên trang đó.
 * Đóng (Esc, nút Đóng, bấm nền) thì bỏ tham số; Back của trình duyệt cũng đóng vì mở popup là một mục history.
 * Khi không có popup, host hiện thông báo kết quả Bắt đầu làm của yêu cầu nháp ở góc màn hình.
 */
export function IssuePopupHost() {
  const location = useLocation();
  const close = useCloseIssuePopup();
  const ref = popupIssueRef(location.search);
  // Không có popup thì thông báo Bắt đầu làm nổi ở góc; có popup thì popup tự hiện bên trong (popup là modal).
  if (!ref) return <StartWorkNotice floating />;
  return (
    <Suspense fallback={null}>
      <IssuePopup issueRef={ref} onClose={close} />
    </Suspense>
  );
}

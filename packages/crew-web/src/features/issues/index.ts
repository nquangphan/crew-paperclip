// Điểm vào công khai của feature Yêu cầu. Chỉ chứa hàm nhẹ để không kéo trang vào bundle chính.

/** Đường (tương đối dưới /:companyPrefix) mở dialog Yêu cầu mới; sidebar dùng link này. */
export const NEW_REQUEST_PATH = 'issues?new=1';

/** Mở dialog Yêu cầu mới: điều hướng tới trang Yêu cầu với `?new=1`, trang tự mở dialog. */
export function openNewRequest(navigate: (to: string) => void, companyPrefix: string): void {
  navigate(`/${encodeURIComponent(companyPrefix)}/${NEW_REQUEST_PATH}`);
}

// Popup chi tiết `?issue=<mã>` trên mọi trang (hợp đồng ở ./popup/issue-href). Nội dung chi tiết nạp lười.
export {
  closeIssueHref,
  ISSUE_PARAM,
  isNewTabClick,
  issueHref,
  issueNavMode,
  issuePageHref,
  parseIssuePath,
  popupIssueRef,
} from './popup/issue-href';
export { IssueLink, useCloseIssuePopup, useIssueOpener } from './popup/issue-nav';
export { IssuePopupHost } from './popup/issue-popup-host';

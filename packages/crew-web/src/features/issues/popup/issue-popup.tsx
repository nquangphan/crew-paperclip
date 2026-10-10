// crew: tự dựng
import { IssuePopupFrame } from '@/ds';
import { useT } from '@/i18n';
import { IssueDetail } from '../detail/issue-detail';

/** Popup chi tiết yêu cầu phủ trang đang xem; nội dung là chính `IssueDetail` của trang đầy đủ. */
export function IssuePopup({ issueRef, onClose }: { issueRef: string; onClose: () => void }) {
  const { t } = useT('issues');
  return (
    <IssuePopupFrame
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={issueRef}
      description={t('detail.popupDescription', { code: issueRef })}
    >
      <IssueDetail issueRef={issueRef} variant="popup" onClose={onClose} />
    </IssuePopupFrame>
  );
}

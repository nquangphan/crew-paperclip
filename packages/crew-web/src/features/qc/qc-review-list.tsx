// crew: tự dựng
import { Card, CardContent, EmptyState, MutedText } from '@/ds';
import { useCompanyAccess } from '@/features/access';
import { IssueLink } from '@/features/issues/popup/issue-nav';
import { formatDateTime, useT } from '@/i18n';
import { QcBadge } from './qc-badge';
import { awaitingMe } from './qc-status';
import { useQcStates } from './use-qc';

/**
 * Mục "Cần tôi duyệt" của thành viên Phòng QC (trang Góp ý của tôi): yêu cầu do chính họ gửi, nay đã Xong và chờ họ kiểm
 * tra. Mở yêu cầu để Xác nhận đạt hoặc báo Chưa đạt. Người không thuộc Phòng QC không thấy mục này.
 */
export function QcReviewList() {
  const { t, lang } = useT('qc');
  const access = useCompanyAccess();
  const { items } = useQcStates();
  if (access.department !== 'qc' || !access.userId) return null;
  const mine = awaitingMe(items, access.userId);
  return (
    <section data-testid="qc-review-list" aria-label={t('review.title')} className="flex flex-col gap-2">
      <div className="flex flex-col">
        <strong>{t('review.title')}</strong>
        <MutedText>{t('review.description')}</MutedText>
      </div>
      {mine.length === 0 ? (
        <EmptyState title={t('review.empty')} />
      ) : (
        <ul className="flex flex-col gap-2">
          {mine.map((qc) => (
            <li key={qc.roundId}>
              <Card data-testid="qc-review-item">
                <CardContent className="flex flex-wrap items-center gap-2">
                  <QcBadge status={qc.reopenRequest ? 'qc_reopen' : 'qc_awaiting'} />
                  <IssueLink identifier={qc.identifier ?? qc.issueId}>
                    {qc.identifier ? `${qc.identifier} · ${qc.title}` : qc.title}
                  </IssueLink>
                  <MutedText>
                    <time dateTime={qc.startedAt}>{formatDateTime(qc.startedAt, lang)}</time>
                  </MutedText>
                  {qc.reopenRequest ? <MutedText>{t('review.reopenPending')}</MutedText> : null}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

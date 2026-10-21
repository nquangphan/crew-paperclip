// crew: tự dựng
// Khối "Phòng QC duyệt lại" trên trang chi tiết yêu cầu (S23): yêu cầu do Phòng QC gửi đã Xong thì giao lại cho người QC
// đã gửi. Người QC (hoặc owner) Xác nhận đạt; người QC báo Chưa đạt kèm lý do (chờ owner duyệt). Khi đang chờ owner, owner
// và người QC thấy lý do; owner duyệt/từ chối ngay tại đây như ở trang Chờ duyệt.
import type { Issue } from '@paperclipai/shared';
import { useId, useState } from 'react';
import type { QcIssueState } from '@/api';
import {
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ErrorState,
  Field,
  MarkdownView,
  MutedText,
  Textarea,
} from '@/ds';
import { useCompanyAccess } from '@/features/access';
import { ContributionActions } from '@/features/contributions/contribution-actions';
import { useAuthorNames, useContributions } from '@/features/contributions/use-contributions';
import { formatDateTime, useT } from '@/i18n';
import { QcBadge } from './qc-badge';
import { canRequestReopen, canVerify, qcDisplayStatus, qcErrorKey } from './qc-status';
import { useQcStates, useRequestReopen, useVerifyQc } from './use-qc';

/** Khối QC của một yêu cầu; không hiện gì khi yêu cầu không ở vòng QC. */
export function QcPanel({ issue }: { issue: Pick<Issue, 'id' | 'status'> }) {
  const { byIssue } = useQcStates();
  const qc = byIssue.get(issue.id);
  const status = qcDisplayStatus(issue, byIssue);
  if (!qc || !status) return null;
  return <QcPanelBody qc={qc} />;
}

function QcPanelBody({ qc }: { qc: QcIssueState }) {
  const { t, lang } = useT('qc');
  const access = useCompanyAccess();
  const authorName = useAuthorNames();
  const verify = useVerifyQc();
  const [reopenOpen, setReopenOpen] = useState(false);
  const status = qc.state === 'verified' ? 'qc_verified' : qc.reopenRequest ? 'qc_reopen' : 'qc_awaiting';
  const who = { userId: access.userId ?? '', isOwner: access.isOwner, isContributor: access.isContributor };
  const nameOf = (userId: string) =>
    userId === access.userId ? t('panel.you') : (authorName(userId) ?? t('panel.unknown'));
  const verifyErrorKey = verify.error ? qcErrorKey(verify.error) : null;

  return (
    <Card data-testid="qc-panel" data-qc={status}>
      <CardContent className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <strong>{t('panel.title')}</strong>
          <QcBadge status={status} />
        </div>
        <MutedText>{t('panel.qcUser', { name: nameOf(qc.qcUserId) })}</MutedText>
        {qc.state === 'verified' && qc.verifiedAt ? (
          <MutedText>
            {t('panel.verifiedBy', {
              name: nameOf(qc.verifiedByUserId ?? qc.qcUserId),
              at: formatDateTime(qc.verifiedAt, lang),
            })}
          </MutedText>
        ) : null}
        {status === 'qc_awaiting' ? <MutedText>{t('panel.awaitingHint')}</MutedText> : null}
        {qc.reopenRequest ? <ReopenRequest issueId={qc.issueId} requestId={qc.reopenRequest.id} /> : null}
        {canVerify(qc, who) || canRequestReopen(qc, who) ? (
          <div className="flex flex-wrap items-center gap-2">
            {canVerify(qc, who) ? (
              <Button type="button" size="sm" disabled={verify.isPending} onClick={() => verify.mutate(qc.issueId)}>
                {verify.isPending ? t('actions.verifying') : t('actions.verify')}
              </Button>
            ) : null}
            {canRequestReopen(qc, who) ? (
              <Button type="button" size="sm" variant="outline" onClick={() => setReopenOpen(true)}>
                {t('actions.reopen')}
              </Button>
            ) : null}
          </div>
        ) : null}
        {verify.error ? (
          <ErrorState
            title={t('actions.verifyFailed')}
            message={verifyErrorKey ? t(verifyErrorKey) : verify.error.message}
          />
        ) : null}
        <ReopenDialog issueId={qc.issueId} open={reopenOpen} onOpenChange={setReopenOpen} />
      </CardContent>
    </Card>
  );
}

/** Lý do "Chưa đạt" đang chờ owner: owner và người QC đã gửi đọc được; owner duyệt/từ chối ngay tại đây. */
function ReopenRequest({ issueId, requestId }: { issueId: string; requestId: string }) {
  const { t } = useT('qc');
  const { isOwner, isContributor } = useCompanyAccess();
  const list = useContributions({ kind: 'reopen', issueId }, { enabled: isOwner || isContributor });
  const request = list.data?.find((c) => c.id === requestId);
  return (
    <div data-testid="qc-reopen-request" className="flex flex-col gap-2">
      <MutedText>{t('panel.reopenHint')}</MutedText>
      {request?.body ? (
        <div className="flex flex-col gap-1">
          <MutedText>{t('panel.reopenReason')}</MutedText>
          <MarkdownView markdown={request.body} />
        </div>
      ) : null}
      {request ? <ContributionActions contribution={request} /> : null}
    </div>
  );
}

/** Hộp thoại "Chưa đạt": lý do bắt buộc (không chỉ khoảng trắng); gửi xong thì đóng, khối QC chuyển sang chờ owner. */
function ReopenDialog({
  issueId,
  open,
  onOpenChange,
}: {
  issueId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useT('qc');
  const reasonId = useId();
  const [reason, setReason] = useState('');
  const request = useRequestReopen();
  const ok = reason.trim().length > 0;
  const errorKey = request.error ? qcErrorKey(request.error) : null;
  const close = (next: boolean) => {
    if (!next) request.reset();
    onOpenChange(next);
  };
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('reopenDialog.title')}</DialogTitle>
          <DialogDescription>{t('reopenDialog.description')}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!ok || request.isPending) return;
            request.mutate(
              { issueId, reason: reason.trim() },
              {
                onSuccess: () => {
                  setReason('');
                  onOpenChange(false);
                },
              },
            );
          }}
        >
          <Field label={t('reopenDialog.reason')} htmlFor={reasonId}>
            <Textarea
              id={reasonId}
              value={reason}
              placeholder={t('reopenDialog.reasonPlaceholder')}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          {request.error ? (
            <ErrorState title={t('reopenDialog.failed')} message={errorKey ? t(errorKey) : request.error.message} />
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => close(false)}>
              {t('reopenDialog.cancel')}
            </Button>
            <Button type="submit" disabled={!ok || request.isPending}>
              {request.isPending ? t('reopenDialog.submitting') : t('reopenDialog.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

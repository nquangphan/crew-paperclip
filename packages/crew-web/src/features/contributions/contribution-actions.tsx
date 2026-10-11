// crew: tự dựng
import { useState } from 'react';
import type { Contribution } from '@/api';
import { Badge, Button, ErrorState } from '@/ds';
import { useCompanyAccess } from '@/features/access';
import { useT } from '@/i18n';
import { contributionErrorKey } from './approve-flow';
import { ApproveIssueDialog } from './approve-issue-dialog';
import { RejectConfirm } from './reject-confirm';
import { useApproveContribution, useRejectContribution } from './use-contributions';

/**
 * Nút của owner cho một mục góp ý: Duyệt / Từ chối khi chờ; "Đang duyệt dở" kèm Duyệt lại / Từ chối khi lần duyệt
 * trước đứt giữa chừng. Mục đã chốt (duyệt, từ chối) và người không phải owner: không có gì.
 * Yêu cầu mở dialog chọn project, loại, agent; bình luận duyệt một lần bấm.
 */
export function ContributionActions({ contribution: c }: { contribution: Contribution }) {
  const { isOwner } = useCompanyAccess();
  if (!isOwner || (c.status !== 'pending' && c.status !== 'approving')) return null;
  return <OwnerActions contribution={c} />;
}

function OwnerActions({ contribution: c }: { contribution: Contribution }) {
  const { t } = useT('contributions');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const approve = useApproveContribution();
  const reject = useRejectContribution();
  const busy = approve.isPending || reject.isPending;
  const halfway = c.status === 'approving';

  const onApprove = () => {
    reject.reset();
    if (c.kind === 'issue') setDialogOpen(true);
    else approve.mutate({ contribution: c, choices: null });
  };
  const onReject = () => {
    approve.reset();
    setConfirmOpen(false);
    reject.mutate(c);
  };

  const failure = approve.error
    ? { title: t('actions.approveFailed'), error: approve.error }
    : reject.error
      ? { title: t('actions.rejectFailed'), error: reject.error }
      : null;
  const failureKey = failure ? contributionErrorKey(failure.error) : null;

  return (
    <span data-testid="contribution-actions" className="flex flex-col gap-2">
      <span className="flex flex-wrap items-center gap-2">
        {halfway ? (
          <Badge variant="outline" title={t('actions.halfwayHint')} data-testid="contribution-halfway">
            {t('actions.halfway')}
          </Badge>
        ) : null}
        <Button type="button" size="xs" disabled={busy} onClick={onApprove}>
          {approve.isPending ? t('actions.approving') : halfway ? t('actions.retry') : t('actions.approve')}
        </Button>
        <Button type="button" size="xs" variant="outline" disabled={busy} onClick={() => setConfirmOpen(true)}>
          {reject.isPending ? t('actions.rejecting') : t('actions.reject')}
        </Button>
      </span>
      {failure ? (
        <ErrorState title={failure.title} message={failureKey ? t(failureKey) : failure.error.message} />
      ) : null}
      {c.kind === 'issue' ? (
        <ApproveIssueDialog contribution={c} open={dialogOpen} onOpenChange={setDialogOpen} />
      ) : null}
      <RejectConfirm contribution={c} open={confirmOpen} onOpenChange={setConfirmOpen} onConfirm={onReject} />
    </span>
  );
}

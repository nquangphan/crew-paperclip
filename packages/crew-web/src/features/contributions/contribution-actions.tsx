// crew: tự dựng
import { useState } from 'react';
import type { Contribution } from '@/api';
import { Badge, Button, ErrorState, MutedText } from '@/ds';
import { useCompanyAccess } from '@/features/access';
import { useT } from '@/i18n';
import { contributionErrorKey } from './approve-flow';
import { ApproveIssueDialog } from './approve-issue-dialog';
import { RejectConfirm } from './reject-confirm';
import { useApprovalInFlight, useApproveContribution, useRejectContribution } from './use-contributions';

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

/** Tên ngắn của mục để phân biệt nút giữa các dòng (trình đọc màn hình): tiêu đề, hoặc đầu bình luận. */
function itemLabel(c: Contribution): string {
  const text = (c.kind === 'issue' ? c.title : c.body)?.trim().replace(/\s+/g, ' ') ?? '';
  return text.length > 60 ? `${text.slice(0, 60)}…` : text;
}

function OwnerActions({ contribution: c }: { contribution: Contribution }) {
  const { t } = useT('contributions');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Một mutation duyệt dùng chung cho dòng và dialog; `inFlight` còn bắt cả lần duyệt chạy ở chỗ khác (popup, dialog
  // đã đóng), để không bao giờ từ chối được trong lúc bước đăng có thể đang tạo bản ghi cho agent.
  const approve = useApproveContribution(c.id);
  const inFlight = useApprovalInFlight(c.id);
  const reject = useRejectContribution();
  const busy = inFlight || approve.isPending || reject.isPending;
  const halfway = c.status === 'approving';
  const label = itemLabel(c);
  const approveText =
    inFlight || approve.isPending ? t('actions.approving') : halfway ? t('actions.retry') : t('actions.approve');
  const rejectText = reject.isPending ? t('actions.rejecting') : t('actions.reject');
  // Tên nút gồm chữ hiện trên nút rồi tới tên mục, để mỗi dòng có tên riêng mà vẫn khớp chữ người dùng thấy.
  const named = (action: string) => (label ? t('actions.withItem', { action, label }) : undefined);

  const onApprove = () => {
    if (busy) return;
    reject.reset();
    if (c.kind === 'issue') setDialogOpen(true);
    else approve.mutate({ contribution: c, choices: null });
  };
  const onReject = () => {
    setConfirmOpen(false);
    if (busy) return;
    approve.reset();
    reject.mutate(c);
  };

  // Lỗi duyệt hiện trong dialog khi dialog đang mở, không lặp lại ở dòng phía sau.
  const failure =
    approve.error && !dialogOpen
      ? { title: t('actions.approveFailed'), error: approve.error }
      : reject.error
        ? { title: t('actions.rejectFailed'), error: reject.error }
        : null;
  const failureKey = failure ? contributionErrorKey(failure.error) : null;

  return (
    <span data-testid="contribution-actions" className="flex flex-col gap-2">
      <span className="flex flex-wrap items-center gap-2">
        {halfway ? (
          <Badge variant="outline" data-testid="contribution-halfway">
            {t('actions.halfway')}
          </Badge>
        ) : null}
        <Button type="button" size="xs" disabled={busy} aria-label={named(approveText)} onClick={onApprove}>
          {approveText}
        </Button>
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={busy}
          aria-label={named(rejectText)}
          onClick={() => setConfirmOpen(true)}
        >
          {rejectText}
        </Button>
      </span>
      {halfway ? <MutedText>{t('actions.halfwayHint')}</MutedText> : null}
      {failure ? (
        <ErrorState title={failure.title} message={failureKey ? t(failureKey) : failure.error.message} />
      ) : null}
      {c.kind === 'issue' ? (
        <ApproveIssueDialog contribution={c} approve={approve} open={dialogOpen} onOpenChange={setDialogOpen} />
      ) : null}
      <RejectConfirm contribution={c} open={confirmOpen && !busy} onOpenChange={setConfirmOpen} onConfirm={onReject} />
    </span>
  );
}

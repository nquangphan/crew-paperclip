// crew: tự dựng
import type { Issue } from '@paperclipai/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, queryKeys } from '@/api';
import { useMe } from '@/app/hooks';
import { Button, ConfirmDialog, ErrorState } from '@/ds';
import { useT } from '@/i18n';
import {
  awaitingMyApproval,
  type GateActionId,
  gateAction,
  gateActionsFor,
  MIN_CHANGE_REASON,
  needsApprovalStage,
} from './gate-actions';
import { CommentDialog } from './gate-dialogs';

/** Làm mới mọi thứ một thao tác cổng làm đổi: issue (uuid và mã), danh sách, bình luận, run, data Crew. */
export function useRefreshAfterGate(issue: Issue) {
  const qc = useQueryClient();
  return () => {
    const keys = [
      queryKeys.issue(issue.id),
      queryKeys.issues(issue.companyId),
      queryKeys.comments(issue.id),
      queryKeys.issueRuns(issue.id),
      queryKeys.issueLiveRuns(issue.id),
      queryKeys.crew(),
    ];
    if (issue.identifier) keys.push(queryKeys.issue(issue.identifier));
    for (const queryKey of keys) void qc.invalidateQueries({ queryKey });
  };
}

const LABEL: Record<GateActionId, string> = {
  approve: 'gate.approve.button',
  request_changes: 'gate.requestChanges.button',
  cancel: 'gate.cancel.button',
  reopen: 'gate.reopen.button',
};

/**
 * Nút thao tác cổng cạnh tiêu đề (S6.7 Duyệt, S6.8 Yêu cầu sửa, S6.10 Hủy, S6.11 Mở lại). Nút hiện theo
 * `executionState` mới nhất (sự kiện trực tiếp invalidate issue). Duyệt và Yêu cầu sửa đọc lại issue ngay trước
 * khi gửi: owner không còn là người duyệt stage đang chờ thì không gửi (gửi `done` bằng quyền board lúc đó là vượt
 * cổng), báo trạng thái đã đổi và làm mới trang. Server từ chối thì hiện câu lỗi nguyên văn, không tự thử lại.
 */
export function ActionsSlot({ issue }: { issue: Issue }) {
  const { t } = useT('issues');
  const me = useMe();
  const refresh = useRefreshAfterGate(issue);
  const [open, setOpen] = useState<GateActionId | null>(null);
  const actions = gateActionsFor(issue, me);
  const gate = useMutation({
    mutationFn: async ({ id, comment }: { id: GateActionId; comment?: string }) => {
      const body = gateAction(id).body(comment);
      if (needsApprovalStage(id)) {
        const fresh = await api.issues.get(issue.id);
        if (!awaitingMyApproval(fresh, me)) {
          refresh();
          throw new Error(t('gate.stale'));
        }
      }
      return api.issues.update(issue.id, body);
    },
    onSuccess: () => {
      setOpen(null);
      refresh();
    },
  });
  const run = (id: GateActionId, comment?: string) => gate.mutate({ id, comment });
  const show = (id: GateActionId) => {
    gate.reset();
    setOpen(id);
  };
  const close = (next: boolean) => {
    if (!next) setOpen(null);
  };
  const inDialog = open === 'approve' || open === 'request_changes';

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {actions.map((a) => (
          <Button
            key={a.id}
            size="sm"
            variant={a.id === 'approve' ? 'default' : 'outline'}
            disabled={gate.isPending}
            onClick={() => show(a.id)}
          >
            {t(LABEL[a.id])}
          </Button>
        ))}
      </div>
      {gate.error && !inDialog ? <ErrorState title={t('gate.failed')} message={gate.error.message} /> : null}
      <CommentDialog
        open={open === 'approve'}
        onOpenChange={close}
        title={t('gate.approve.title')}
        description={t('gate.approve.body')}
        label={t('gate.approve.label')}
        hint={t('gate.approve.hint')}
        initial={t('gate.approve.default')}
        minLength={1}
        submitLabel={t('gate.approve.button')}
        pending={gate.isPending}
        error={open === 'approve' ? gate.error : null}
        failedTitle={t('gate.failed')}
        onSubmit={(comment) => run('approve', comment)}
      />
      <CommentDialog
        open={open === 'request_changes'}
        onOpenChange={close}
        title={t('gate.requestChanges.title')}
        description={t('gate.requestChanges.body')}
        label={t('gate.requestChanges.label')}
        hint={t('gate.requestChanges.hint', { min: MIN_CHANGE_REASON })}
        initial=""
        minLength={MIN_CHANGE_REASON}
        submitLabel={t('gate.requestChanges.submit')}
        pending={gate.isPending}
        error={open === 'request_changes' ? gate.error : null}
        failedTitle={t('gate.failed')}
        onSubmit={(comment) => run('request_changes', comment)}
      />
      <ConfirmDialog
        open={open === 'cancel'}
        onOpenChange={close}
        title={t('gate.cancel.title')}
        body={t('gate.cancel.body')}
        confirmLabel={t('gate.cancel.button')}
        destructive
        onConfirm={() => run('cancel')}
      />
      <ConfirmDialog
        open={open === 'reopen'}
        onOpenChange={close}
        title={t('gate.reopen.title')}
        body={t('gate.reopen.body')}
        confirmLabel={t('gate.reopen.button')}
        onConfirm={() => run('reopen')}
      />
    </div>
  );
}

// crew: tự dựng
import type { Contribution } from '@/api';
import { ConfirmDialog } from '@/ds';
import { useT } from '@/i18n';

interface RejectConfirmProps {
  contribution: Contribution;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

/** Hỏi lại trước khi từ chối: mục bị từ chối vẫn còn, mang nhãn Bị từ chối, agent không bao giờ thấy. */
export function RejectConfirm({ contribution, open, onOpenChange, onConfirm }: RejectConfirmProps) {
  const { t } = useT('contributions');
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('reject.title')}
      body={
        contribution.kind === 'issue'
          ? t('reject.bodyIssue', { title: contribution.title ?? '' })
          : t('reject.bodyComment')
      }
      confirmLabel={t('reject.confirm')}
      destructive
      onConfirm={onConfirm}
    />
  );
}

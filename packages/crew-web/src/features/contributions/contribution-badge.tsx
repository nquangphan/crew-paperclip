// crew: tự dựng
import type { ContributionStatus } from '@/api';
import { Badge } from '@/ds';
import { useT } from '@/i18n';

const VARIANT = {
  pending: 'outline',
  approving: 'outline',
  rejected: 'destructive',
  approved: 'secondary',
} as const satisfies Record<ContributionStatus, 'outline' | 'destructive' | 'secondary'>;

/** Nhãn trạng thái góp ý: Chờ duyệt (gồm đang duyệt dở), Bị từ chối, Đã duyệt. */
export function ContributionBadge({ status }: { status: ContributionStatus }) {
  const { t } = useT('contributions');
  return (
    <Badge variant={VARIANT[status]} data-status={status}>
      {t(`status.${status}`)}
    </Badge>
  );
}

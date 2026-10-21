// crew: tự dựng
import { StatusPill } from '@/ds';
import { useT } from '@/i18n';
import type { QcDisplayStatus } from './qc-status';

/** Nhãn trạng thái QC: Chờ QC duyệt, Chờ owner duyệt mở lại, QC verified (màu token `--status-task-icon-qc_*`). */
export function QcBadge({ status }: { status: QcDisplayStatus }) {
  const { t } = useT();
  return <StatusPill status={status} label={t(`status.${status}`)} data-testid="qc-badge" data-qc={status} />;
}

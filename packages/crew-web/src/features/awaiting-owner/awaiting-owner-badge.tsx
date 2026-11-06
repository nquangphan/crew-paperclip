// crew: tự dựng
import { StatusPill } from '@/ds';
import { useT } from '@/i18n';
import { AWAITING_OWNER } from './awaiting-owner';

/** Nhãn "Chờ owner trả lời" (màu token `--status-task-icon-awaiting_owner`), cạnh nhãn QC ở danh sách và thẻ Bảng. */
export function AwaitingOwnerBadge() {
  const { t } = useT();
  return (
    <StatusPill status={AWAITING_OWNER} label={t(`status.${AWAITING_OWNER}`)} data-testid="awaiting-owner-badge" />
  );
}

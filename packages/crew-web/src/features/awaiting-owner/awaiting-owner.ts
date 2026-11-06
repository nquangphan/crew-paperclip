// Trạng thái hiển thị "Chờ owner trả lời" (thuần, không gọi API). Issue chưa đóng có thẻ câu hỏi/xác nhận chờ owner (route
// Crew `…/awaiting-owner`) hiện trạng thái này thay cho trạng thái lõi (thường là Đang làm hay Đang bị chặn); trạng thái
// lõi không đổi vì `in_review`/`blocked` kích hoạt stage và người duyệt của execution policy. Chuỗi `awaiting_owner` dùng
// chung với StatusGlyph (biểu tượng, màu token `--status-task-icon-awaiting_owner`), nhãn `status.awaiting_owner` của
// namespace common và màu bản đồ `--roadmap-tone-awaiting_owner`.
import type { QcIssueState } from '@/api';
import { displayStatus } from '@/features/qc/qc-status';

export const AWAITING_OWNER = 'awaiting_owner';
export type AwaitingOwnerStatus = typeof AWAITING_OWNER;

const CLOSED = new Set(['done', 'cancelled']);

/** `awaiting_owner` khi issue chưa đóng và có thẻ chờ owner trả lời, ngược lại null. */
export function awaitingOwnerStatus(
  issue: { id: string; status: string },
  awaiting: ReadonlySet<string>,
): AwaitingOwnerStatus | null {
  return !CLOSED.has(issue.status) && awaiting.has(issue.id) ? AWAITING_OWNER : null;
}

/**
 * Trạng thái để vẽ (biểu tượng, nhãn, màu): chờ owner trả lời, trạng thái QC (chỉ khi Xong, nên không chồng nhau), hoặc
 * trạng thái lõi.
 */
export function issueDisplayStatus(
  issue: { id: string; status: string },
  qcStates: ReadonlyMap<string, QcIssueState>,
  awaiting: ReadonlySet<string>,
): string {
  return awaitingOwnerStatus(issue, awaiting) ?? displayStatus(issue, qcStates);
}

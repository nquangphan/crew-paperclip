// Trạng thái QC hiển thị của một yêu cầu (thuần, không gọi API). Yêu cầu do Phòng QC gửi, khi Xong (lõi vẫn `done`), hiện
// "Chờ QC duyệt", "Chờ owner duyệt mở lại" (QC báo chưa đạt, owner chưa quyết) hoặc "QC verified" thay cho "Hoàn thành".
// Các chuỗi `qc_*` dùng chung với StatusGlyph (biểu tượng, màu token `--status-task-icon-qc_*`), nhãn `status.qc_*` của
// namespace common và màu bản đồ `--roadmap-tone-qc_*`.
import type { QcIssueState } from '@/api';

export type QcDisplayStatus = 'qc_awaiting' | 'qc_reopen' | 'qc_verified';

/** Trạng thái QC của yêu cầu, hoặc null khi yêu cầu không ở vòng QC (chưa Xong, không do QC gửi). */
export function qcDisplayStatus(
  issue: { id: string; status: string },
  states: ReadonlyMap<string, QcIssueState>,
): QcDisplayStatus | null {
  if (issue.status !== 'done') return null;
  const qc = states.get(issue.id);
  if (!qc) return null;
  if (qc.state === 'verified') return 'qc_verified';
  return qc.reopenRequest ? 'qc_reopen' : 'qc_awaiting';
}

/** Trạng thái để vẽ (biểu tượng, nhãn, màu): trạng thái QC nếu có, ngược lại trạng thái lõi. */
export function displayStatus(
  issue: { id: string; status: string },
  states: ReadonlyMap<string, QcIssueState>,
): string {
  return qcDisplayStatus(issue, states) ?? issue.status;
}

/** Yêu cầu đang chờ chính người QC này duyệt (gồm cả mục đã báo chưa đạt, đang chờ owner), mới nhất trước. */
export function awaitingMe(items: readonly QcIssueState[], userId: string): QcIssueState[] {
  return items.filter((s) => s.state === 'awaiting' && s.qcUserId === userId);
}

/** Người này được Xác nhận đạt: owner, hoặc người QC được giao (khách góp ý còn dấu). */
export function canVerify(
  qc: QcIssueState,
  who: { userId: string; isOwner: boolean; isContributor: boolean },
): boolean {
  if (qc.state !== 'awaiting' || qc.reopenRequest) return false;
  return who.isOwner || (who.isContributor && qc.qcUserId === who.userId);
}

/** Chỉ người QC được giao báo "Chưa đạt"; owner muốn làm lại thì tự mở lại yêu cầu. */
export function canRequestReopen(qc: QcIssueState, who: { userId: string; isContributor: boolean }): boolean {
  return qc.state === 'awaiting' && !qc.reopenRequest && who.isContributor && qc.qcUserId === who.userId;
}

/** Mã lỗi của router QC có câu báo riêng (khóa i18n `errors.<mã>` của namespace qc). */
const KNOWN_CODES = new Set(['crew_qc_not_awaiting', 'crew_qc_reopen_pending', 'crew_qc_forbidden']);

export function qcErrorKey(error: unknown): string | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && KNOWN_CODES.has(code) ? `errors.${code}` : null;
}

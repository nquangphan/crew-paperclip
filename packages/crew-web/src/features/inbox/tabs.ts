// Chia issue của Hộp thư thành các tab (S3.1, S3.2). Hàm thuần, nhận dữ liệu GET /companies/:c/issues.
// "Chờ tôi duyệt" = owner phải làm gì đó: stage đang chờ có người tham gia là user này (dùng lại
// awaitingMyApproval cho stage approval, cùng điều kiện với nút Duyệt) hoặc có thẻ câu hỏi/xác nhận chờ trả lời.
import { awaitingMyApproval } from '@/features/issues/detail/crew/gate-actions';

export type InboxTabId = 'awaiting_me' | 'mine' | 'unread' | 'stuck' | 'all';
export const INBOX_TAB_IDS: readonly InboxTabId[] = ['awaiting_me', 'mine', 'unread', 'stuck', 'all'];

/** Phần của Issue mà Hộp thư đọc (JSON: ngày là chuỗi). */
export interface InboxIssue {
  id: string;
  status: string;
  assigneeUserId?: string | null;
  isUnreadForMe?: boolean;
  myLastTouchAt?: string | Date | null;
  executionState?: {
    status?: string | null;
    currentStageType?: string | null;
    currentParticipant?: { type?: string | null; userId?: string | null } | null;
  } | null;
  reviewAttention?: {
    state?: string;
    paths?: { kind: string; label?: string; responder?: string | null; since?: string | null; ref?: string | null }[];
    reason?: string | null;
  } | null;
  blockedInboxAttention?: {
    reason?: string;
    owner?: { type?: string | null } | null;
    interactionId?: string | null;
  } | null;
}

const CLOSED = new Set(['done', 'cancelled']);

/**
 * Thẻ tương tác đang chờ owner trả lời. Nguồn: server/src/services/issues.ts listIssueReviewAttentionMap
 * (path `interaction`, responder là tên agent nếu thẻ gửi cho agent, ngược lại "Board") và blockedInboxAttention
 * (reason pending_user_decision / pending_board_decision với chủ là user hoặc board).
 */
export function hasPendingUserInteraction(issue: InboxIssue): boolean {
  const onReview = issue.reviewAttention?.paths?.some(
    (path) => path.kind === 'interaction' && (!path.responder || path.responder === 'Board'),
  );
  if (onReview) return true;
  const blocked = issue.blockedInboxAttention;
  return (
    !!blocked &&
    (blocked.reason === 'pending_user_decision' || blocked.reason === 'pending_board_decision') &&
    (blocked.owner?.type === 'user' || blocked.owner?.type === 'board')
  );
}

function awaitingMe(issue: InboxIssue, me: { id: string }): boolean {
  if (CLOSED.has(issue.status)) return false;
  if (awaitingMyApproval(issue, me)) return true;
  const state = issue.executionState;
  const escalated =
    state?.status === 'pending' &&
    state.currentParticipant?.type === 'user' &&
    state.currentParticipant.userId === me.id;
  return escalated || hasPendingUserInteraction(issue);
}

export function inboxTabs<T extends InboxIssue>(issues: readonly T[], me: { id: string }): Record<InboxTabId, T[]> {
  return {
    awaiting_me: issues.filter((issue) => awaitingMe(issue, me)),
    mine: issues.filter((issue) => !!issue.myLastTouchAt || issue.assigneeUserId === me.id),
    unread: issues.filter((issue) => issue.isUnreadForMe === true),
    stuck: issues.filter((issue) => issue.status === 'blocked' || issue.reviewAttention?.state === 'stalled'),
    all: [...issues],
  };
}

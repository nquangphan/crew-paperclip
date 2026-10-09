// Thao tác cổng của owner trên một yêu cầu Crew. Body chốt theo code server:
// - server/src/services/issue-execution-policy.ts applyIssueExecutionStageTransition: người tham gia stage đang chờ
//   gửi status "done" kèm comment là duyệt stage (decision approved, chuyển stage sau); gửi status khác "in_review"
//   kèm comment là yêu cầu sửa (decision changes_requested, trả việc cho returnAssignee).
// - server/src/crew/issue-gate.ts: duyệt đúng participant là "approvedInThisWrite", không thành board_override.
// Body không bao giờ có executionPolicy, executionState hay assignee: đổi các khóa đó là vượt cổng.
import type { IssueUpdate } from '@/api';

export type GateActionId = 'approve' | 'request_changes' | 'cancel' | 'reopen';

export interface GateAction {
  id: GateActionId;
  /** Ném lỗi khi lời nhắn không đủ (duyệt cần lời nhắn, yêu cầu sửa cần lý do ≥ MIN_CHANGE_REASON ký tự). */
  body: (comment?: string) => IssueUpdate;
}

export const MIN_CHANGE_REASON = 5;

interface GateIssue {
  status: string;
  executionState?: {
    status?: string | null;
    currentStageType?: string | null;
    currentParticipant?: { type?: string | null; userId?: string | null } | null;
  } | null;
}

const CLOSED = new Set(['done', 'cancelled']);

/** Owner (user hiện tại) đang là người duyệt của stage approval đang chờ. */
export function awaitingMyApproval(issue: GateIssue, me: { id: string }): boolean {
  const state = issue.executionState;
  return (
    !!state &&
    state.status === 'pending' &&
    state.currentStageType === 'approval' &&
    state.currentParticipant?.type === 'user' &&
    state.currentParticipant.userId === me.id
  );
}

function requireText(comment: string | undefined, min: number): string {
  const text = (comment ?? '').trim();
  if (text.length < min) throw new Error(`comment_too_short:${min}`);
  return text;
}

const ACTIONS: Record<GateActionId, GateAction> = {
  approve: { id: 'approve', body: (comment) => ({ status: 'done', comment: requireText(comment, 1) }) },
  request_changes: {
    id: 'request_changes',
    body: (comment) => ({ status: 'in_progress', comment: requireText(comment, MIN_CHANGE_REASON) }),
  },
  cancel: { id: 'cancel', body: () => ({ status: 'cancelled' }) },
  reopen: { id: 'reopen', body: () => ({ status: 'todo' }) },
};

/** Thao tác cổng theo mã, không phụ thuộc trạng thái (người gọi tự kiểm quyền). */
export function gateAction(id: GateActionId): GateAction {
  return ACTIONS[id];
}

/** Duyệt và Yêu cầu sửa chỉ đúng khi owner còn là người duyệt stage đang chờ; gửi từ trạng thái cũ là vượt cổng. */
export function needsApprovalStage(id: GateActionId): boolean {
  return id === 'approve' || id === 'request_changes';
}

/** Thao tác cổng được phép theo trạng thái mới nhất của issue. */
export function gateActionsFor(issue: GateIssue, me: { id: string }): GateAction[] {
  if (CLOSED.has(issue.status)) return [ACTIONS.reopen];
  const ids: GateActionId[] = awaitingMyApproval(issue, me) ? ['approve', 'request_changes', 'cancel'] : ['cancel'];
  return ids.map((id) => ACTIONS[id]);
}

import { describe, expect, it } from 'vitest';
import { hasPendingUserInteraction, type InboxIssue, inboxTabs, isMyExecutionStage } from '@/features/inbox/tabs';

const ME = { id: 'u1' };

const issue = (over: Partial<InboxIssue> & { id: string }): InboxIssue => ({ status: 'in_review', ...over });

// Nguồn hình dữ liệu: GET /api/companies/:c/issues (Issue.executionState, reviewAttention, blockedInboxAttention,
// isUnreadForMe, myLastTouchAt) theo packages/shared/src/types/issue.ts và server/src/services/issues.ts (reviewAttention).
const approvalMine = issue({
  id: 'a',
  executionState: {
    status: 'pending',
    currentStageType: 'approval',
    currentParticipant: { type: 'user', userId: 'u1' },
  },
});
const approvalOther = issue({
  id: 'b',
  executionState: {
    status: 'pending',
    currentStageType: 'approval',
    currentParticipant: { type: 'user', userId: 'u2' },
  },
});
const reviewAgent = issue({
  id: 'c',
  executionState: { status: 'pending', currentStageType: 'review', currentParticipant: { type: 'agent' } },
});
const pendingQuestion = issue({
  id: 'd',
  reviewAttention: {
    state: 'covered',
    reason: null,
    paths: [{ kind: 'interaction', label: 'Pending ask user questions', responder: 'Board', since: null, ref: 'x' }],
  },
});
const questionForAgent = issue({
  id: 'e',
  reviewAttention: {
    state: 'covered',
    reason: null,
    paths: [{ kind: 'interaction', label: 'Pending x', responder: 'Executor Alpha', since: null, ref: 'y' }],
  },
});
const doneMine = issue({
  id: 'f',
  status: 'done',
  executionState: {
    status: 'pending',
    currentStageType: 'approval',
    currentParticipant: { type: 'user', userId: 'u1' },
  },
});

describe('inboxTabs.awaiting_me (S3.1)', () => {
  it('bắt issue có người duyệt hiện tại là user này', () => {
    const tabs = inboxTabs([approvalMine, approvalOther, reviewAgent], ME);
    expect(tabs.awaiting_me.map((i) => i.id)).toEqual(['a']);
  });

  it('bắt issue có thẻ câu hỏi chờ trả lời cho owner, bỏ thẻ dành cho agent', () => {
    const tabs = inboxTabs([pendingQuestion, questionForAgent], ME);
    expect(tabs.awaiting_me.map((i) => i.id)).toEqual(['d']);
  });

  it('bắt issue bị chặn chờ quyết định của người dùng', () => {
    const blocked = issue({
      id: 'g',
      status: 'blocked',
      blockedInboxAttention: { reason: 'pending_user_decision', owner: { type: 'user' }, interactionId: 'z' },
    });
    expect(inboxTabs([blocked], ME).awaiting_me.map((i) => i.id)).toEqual(['g']);
  });

  it('bỏ issue đã done hoặc cancelled dù còn executionState', () => {
    const cancelled = { ...doneMine, id: 'h', status: 'cancelled' };
    expect(inboxTabs([doneMine, cancelled], ME).awaiting_me).toEqual([]);
  });

  it('đã duyệt xong (state không còn pending) thì biến mất', () => {
    const decided = { ...approvalMine, executionState: { ...approvalMine.executionState, status: 'completed' } };
    expect(inboxTabs([decided], ME).awaiting_me).toEqual([]);
  });
});

// Danh sách thật: server trả executionState null (server/src/services/issues.ts, cột chọn của list), người duyệt của stage
// đang chờ chỉ có ở reviewAttention.paths kind "execution_participant" (ref = userId khi participant là user,
// server/src/services/recovery/issue-graph-liveness.ts classifyIssueReviewPaths).
const participantPath = (ref: string) => ({
  state: 'covered',
  reason: null,
  paths: [
    { kind: 'execution_participant', label: 'Execution review participant', responder: 'Owner', since: null, ref },
  ],
});

describe('inboxTabs.awaiting_me với dữ liệu danh sách (executionState null)', () => {
  it('bắt issue có participant stage đang chờ là user này qua reviewAttention', () => {
    const mine = issue({ id: 'l1', executionState: null, reviewAttention: participantPath('u1') });
    const other = issue({ id: 'l2', executionState: null, reviewAttention: participantPath('u2') });
    const agent = issue({ id: 'l3', executionState: null, reviewAttention: participantPath('agent-1') });
    expect(inboxTabs([mine, other, agent], ME).awaiting_me.map((i) => i.id)).toEqual(['l1']);
  });

  it('bỏ issue đã đóng dù còn path cũ', () => {
    const done = issue({ id: 'l4', status: 'done', executionState: null, reviewAttention: participantPath('u1') });
    expect(inboxTabs([done], ME).awaiting_me).toEqual([]);
  });

  it('isMyExecutionStage chỉ đúng khi path execution_participant trỏ tới user này', () => {
    expect(isMyExecutionStage(issue({ id: 'l5', reviewAttention: participantPath('u1') }), ME)).toBe(true);
    expect(isMyExecutionStage(issue({ id: 'l6', reviewAttention: participantPath('u2') }), ME)).toBe(false);
    expect(isMyExecutionStage(issue({ id: 'l7' }), ME)).toBe(false);
  });
});

describe('inboxTabs các tab còn lại (S3.2)', () => {
  it('chia Của tôi, Chưa đọc, Đang kẹt, Tất cả', () => {
    const mine = issue({ id: '1', status: 'todo', myLastTouchAt: '2026-10-10T01:00:00.000Z' });
    const assigned = issue({ id: '2', status: 'todo', assigneeUserId: 'u1' });
    const unread = issue({ id: '3', status: 'todo', isUnreadForMe: true });
    const blocked = issue({ id: '4', status: 'blocked' });
    const stalled = issue({ id: '5', reviewAttention: { state: 'stalled', paths: [], reason: 'x' } });
    const tabs = inboxTabs([mine, assigned, unread, blocked, stalled], ME);
    expect(tabs.mine.map((i) => i.id)).toEqual(['1', '2']);
    expect(tabs.unread.map((i) => i.id)).toEqual(['3']);
    expect(tabs.stuck.map((i) => i.id)).toEqual(['4', '5']);
    expect(tabs.all).toHaveLength(5);
  });
});

describe('hasPendingUserInteraction', () => {
  it('false khi không có dữ liệu chú ý', () => {
    expect(hasPendingUserInteraction(issue({ id: 'x' }))).toBe(false);
  });
});

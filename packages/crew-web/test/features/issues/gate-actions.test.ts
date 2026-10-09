import { describe, expect, it } from 'vitest';
import { gateActionsFor } from '@/features/issues/detail/crew/gate-actions';

// Hình issue theo GET /api/issues/:id; executionState theo server/src/services/issue-execution-policy.ts.
const me = { id: 'user-1' };
const atApproval = {
  status: 'in_review',
  executionState: {
    status: 'pending',
    currentStageType: 'approval',
    currentParticipant: { type: 'user', userId: 'user-1' },
  },
};
// biome-ignore lint/suspicious/noExplicitAny: issue rút gọn cho test thuần
const ids = (issue: any) => gateActionsFor(issue, me).map((a) => a.id);
// biome-ignore lint/suspicious/noExplicitAny: issue rút gọn cho test thuần
const action = (issue: any, id: string) => {
  const found = gateActionsFor(issue, me).find((a) => a.id === id);
  if (!found) throw new Error(`không có ${id}`);
  return found;
};

describe('gateActionsFor', () => {
  it('duyệt và yêu cầu sửa chỉ có khi user là người tham gia stage approval đang chờ', () => {
    expect(ids(atApproval)).toEqual(['approve', 'request_changes', 'cancel']);
    expect(
      ids({
        ...atApproval,
        executionState: {
          status: 'pending',
          currentStageType: 'review',
          currentParticipant: { type: 'agent', agentId: 'a' },
        },
      }),
    ).toEqual(['cancel']);
  });

  it('không hiện duyệt khi participant là user khác', () => {
    expect(
      ids({
        ...atApproval,
        executionState: { ...atApproval.executionState, currentParticipant: { type: 'user', userId: 'user-2' } },
      }),
    ).toEqual(['cancel']);
  });

  it('không hiện duyệt khi stage đã xong hoặc đang chờ sửa', () => {
    expect(
      ids({ ...atApproval, executionState: { ...atApproval.executionState, status: 'changes_requested' } }),
    ).toEqual(['cancel']);
    expect(ids({ ...atApproval, executionState: null })).toEqual(['cancel']);
  });

  it('user là participant của stage review (leo thang) không có nút duyệt', () => {
    expect(
      ids({ ...atApproval, executionState: { ...atApproval.executionState, currentStageType: 'review' } }),
    ).toEqual(['cancel']);
  });

  it('mở lại chỉ khi done/cancelled', () => {
    expect(ids({ status: 'done', executionState: null })).toEqual(['reopen']);
    expect(ids({ status: 'cancelled', executionState: null })).toEqual(['reopen']);
    expect(ids({ status: 'todo', executionState: null })).toEqual(['cancel']);
  });

  it('body đúng hình đã chốt với server', () => {
    expect(action(atApproval, 'approve').body('Đồng ý')).toEqual({ status: 'done', comment: 'Đồng ý' });
    expect(action(atApproval, 'request_changes').body('  sửa lại phần A  ')).toEqual({
      status: 'in_progress',
      comment: 'sửa lại phần A',
    });
    expect(action(atApproval, 'cancel').body()).toEqual({ status: 'cancelled' });
    expect(action({ status: 'done', executionState: null }, 'reopen').body()).toEqual({ status: 'todo' });
  });

  it('body không bao giờ có policy hay assignee', () => {
    for (const a of gateActionsFor(atApproval as never, me)) {
      const body = a.body('lý do đủ dài');
      expect(Object.keys(body)).toContain('status');
      for (const k of ['executionPolicy', 'executionState', 'assigneeAgentId', 'assigneeUserId']) {
        expect(body).not.toHaveProperty(k);
      }
    }
  });

  it('yêu cầu sửa bắt buộc lý do ≥ 5 ký tự', () => {
    expect(() => action(atApproval, 'request_changes').body('ok')).toThrow();
    expect(() => action(atApproval, 'request_changes').body('    abcd    ')).toThrow();
  });

  it('duyệt bắt buộc có lời nhắn (server từ chối duyệt không comment)', () => {
    expect(() => action(atApproval, 'approve').body('   ')).toThrow();
    expect(() => action(atApproval, 'approve').body()).toThrow();
  });
});

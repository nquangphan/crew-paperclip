import type { ActivityEvent } from '@paperclipai/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  buildHistory,
  describeViolation,
  forcedDoneActive,
  type HistoryCtx,
} from '@/features/issues/detail/history-format';
import { getI18n, initI18n } from '@/i18n';

let ctx: HistoryCtx;
beforeAll(async () => {
  await initI18n();
  ctx = {
    t: getI18n().getFixedT('vi', 'issues'),
    lang: 'vi',
    stageName: (id) => ({ s1: 'Reviewer', s2: 'Owner duyệt' })[id] ?? null,
  };
});

let seq = 0;
function ev(action: string, at: string, over: Partial<ActivityEvent> = {}): ActivityEvent {
  seq += 1;
  return {
    id: `e${seq}`,
    companyId: 'c1',
    actorType: 'user',
    actorId: 'u1',
    action,
    entityType: 'issue',
    entityId: 'i1',
    agentId: null,
    runId: null,
    details: null,
    createdAt: at as unknown as Date,
    ...over,
  };
}

describe('describeViolation', () => {
  it('dịch mã vi phạm sang câu, stage theo tên trong policy', () => {
    expect(describeViolation('stage_unapproved:s2', ctx)).toBe('thiếu duyệt stage Owner duyệt');
    expect(describeViolation('stage_unapproved:zz', ctx)).toBe('thiếu duyệt stage zz');
    expect(describeViolation('docs_missing', ctx)).toBe('thiếu kết quả kiểm docs');
    expect(describeViolation('docs_failed:2', ctx)).toBe('kiểm docs lỗi (mã 2)');
    expect(describeViolation('push_stale', ctx)).toBe('push cũ hơn lần owner duyệt');
    expect(describeViolation('weird_code', ctx)).toBe('weird_code');
  });
});

describe('buildHistory', () => {
  it('dịch action đã biết, giờ Asia/Ho_Chi_Minh, action lạ hiện mã gốc', () => {
    const rows = buildHistory(
      [
        ev('issue.something_new', '2026-10-10T02:00:00.000Z', { actorType: 'system', actorId: 'sys' }),
        ev('issue.updated', '2026-10-10T01:30:00.000Z', {
          details: { status: 'in_review', _previous: { status: 'in_progress' } },
        }),
        ev('issue.comment_added', '2026-10-10T01:10:00.000Z', { actorType: 'agent', actorId: 'a1', agentId: 'a1' }),
        ev('issue.created', '2026-10-09T17:05:00.000Z'),
      ],
      ctx,
    );
    expect(rows.map((r) => r.text)).toEqual([
      'issue.something_new',
      'Đổi trạng thái: Đang làm → Đang duyệt',
      'Bình luận',
      'Tạo yêu cầu',
    ]);
    expect(rows.map((r) => r.time)).toEqual([
      '10/10/2026 09:00',
      '10/10/2026 08:30',
      '10/10/2026 08:10',
      '10/10/2026 00:05',
    ]);
    expect(rows[2].actor).toEqual({ type: 'agent', id: 'a1' });
    expect(rows.every((r) => !r.forced)).toBe(true);
  });

  it('bỏ bản ghi đã đọc/lưu hộp thư của riêng người dùng', () => {
    const rows = buildHistory(
      [ev('issue.read_marked', '2026-10-10T01:00:00.000Z'), ev('issue.inbox_archived', '2026-10-10T01:00:00.000Z')],
      ctx,
    );
    expect(rows).toEqual([]);
  });

  it('gộp board_override + force_done cùng user cách nhau ≤ 5 giây thành một dòng có lý do và cổng bỏ qua', () => {
    const rows = buildHistory(
      [
        ev('crew.issue.force_done', '2026-10-10T03:00:03.000Z', {
          actorType: 'plugin',
          actorId: 'plugin-1',
          details: { reason: 'Owner tự kiểm trên máy', violations: [], actorUserId: 'u1' },
        }),
        ev('issue.updated', '2026-10-10T03:00:01.000Z', {
          details: { status: 'done', _previous: { status: 'in_review' } },
        }),
        ev('crew.policy.board_override', '2026-10-10T03:00:00.000Z', {
          details: { violations: ['stage_unapproved:s2', 'docs_missing'], toStatus: 'done' },
        }),
      ],
      ctx,
    );
    expect(rows).toHaveLength(2);
    const forced = rows[0];
    expect(forced.forced).toBe(true);
    expect(forced.text).toBe('Ép Done');
    expect(forced.reason).toBe('Owner tự kiểm trên máy');
    expect(forced.skipped).toEqual(['thiếu duyệt stage Owner duyệt', 'thiếu kết quả kiểm docs']);
    expect(forced.actor).toEqual({ type: 'user', id: 'u1' });
    expect(rows[1].text).toBe('Đổi trạng thái: Đang duyệt → Hoàn thành');
  });

  it('không gộp khi cách nhau quá 5 giây hoặc khác user', () => {
    const far = buildHistory(
      [
        ev('crew.issue.force_done', '2026-10-10T03:00:06.000Z', {
          actorType: 'plugin',
          details: { reason: 'Lý do đủ dài' },
        }),
        ev('crew.policy.board_override', '2026-10-10T03:00:00.000Z', { details: { violations: ['docs_missing'] } }),
      ],
      ctx,
    );
    expect(far.map((r) => r.text)).toEqual(['Ép Done', 'Owner đóng vượt cổng']);
    const otherUser = buildHistory(
      [
        ev('crew.issue.force_done', '2026-10-10T03:00:02.000Z', {
          actorType: 'plugin',
          details: { reason: 'Lý do đủ dài', actorUserId: 'u2' },
        }),
        ev('crew.policy.board_override', '2026-10-10T03:00:00.000Z', { details: { violations: ['docs_missing'] } }),
      ],
      ctx,
    );
    expect(otherUser).toHaveLength(2);
    expect(otherUser.every((r) => r.forced)).toBe(true);
    expect(otherUser[1].skipped).toEqual(['thiếu kết quả kiểm docs']);
  });
});

describe('forcedDoneActive', () => {
  const forced = ev('crew.issue.force_done', '2026-10-10T03:00:00.000Z', { details: { reason: 'Lý do đủ dài' } });
  it('đúng khi issue done và force_done mới nhất sau lần mở lại gần nhất', () => {
    const reopenedBefore = ev('crew.gate.cycle_reset', '2026-10-10T02:00:00.000Z', {
      details: { fromStatus: 'done', toStatus: 'todo' },
    });
    expect(forcedDoneActive([forced, reopenedBefore], 'done')).toBe(true);
  });
  it('sai khi đã mở lại sau lần ép', () => {
    const reopened = ev('issue.updated', '2026-10-10T04:00:00.000Z', {
      details: { status: 'todo', _previous: { status: 'done' } },
    });
    expect(forcedDoneActive([reopened, forced], 'done')).toBe(false);
  });
  it('sai khi issue không ở done hoặc chưa từng ép', () => {
    expect(forcedDoneActive([forced], 'todo')).toBe(false);
    expect(forcedDoneActive([], 'done')).toBe(false);
  });
});

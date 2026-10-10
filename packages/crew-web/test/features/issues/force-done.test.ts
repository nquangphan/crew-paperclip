import { describe, expect, it } from 'vitest';
import {
  cancelShownChildren,
  type ForceDoneDeps,
  forceDoneAvailable,
  MAX_FORCE_REASON,
  MIN_FORCE_REASON,
  openChildren,
  runForceDone,
  skippedGates,
  validReason,
} from '@/features/issues/detail/crew/force-done';
import { ISSUE } from './detail-fixtures';

describe('forceDoneAvailable', () => {
  it('đúng khi issue chưa đóng', () => {
    for (const status of ['backlog', 'todo', 'in_progress', 'in_review', 'blocked']) {
      expect(forceDoneAvailable({ status })).toBe(true);
    }
  });
  it('sai khi issue đã done hoặc cancelled', () => {
    expect(forceDoneAvailable({ status: 'done' })).toBe(false);
    expect(forceDoneAvailable({ status: 'cancelled' })).toBe(false);
  });
});

describe('skippedGates', () => {
  it('liệt kê stage chưa xong theo policy và completedStageIds, đánh dấu stage đang chờ và người giữ', () => {
    expect(skippedGates(ISSUE as never)).toEqual([
      { stageId: 's2', type: 'approval', index: 1, current: true, holder: { type: 'user', userId: 'u1' } },
    ]);
  });
  it('issue chưa vào stage: mọi stage của policy đều bị bỏ qua, không stage nào đang chờ', () => {
    const issue = { ...ISSUE, status: 'in_progress', executionState: null };
    expect(skippedGates(issue as never).map((g) => [g.stageId, g.current, g.holder])).toEqual([
      ['s1', false, null],
      ['s2', false, null],
    ]);
  });
  it('không có policy thì rỗng', () => {
    expect(skippedGates({ ...ISSUE, executionPolicy: null, executionState: null } as never)).toEqual([]);
  });
});

describe('validReason', () => {
  it('bỏ khoảng trắng hai đầu rồi kiểm 10–1000 ký tự', () => {
    expect(MIN_FORCE_REASON).toBe(10);
    expect(MAX_FORCE_REASON).toBe(1000);
    expect(validReason('   123456789   ')).toBe(false);
    expect(validReason('  1234567890 ')).toBe(true);
    expect(validReason('x'.repeat(1000))).toBe(true);
    expect(validReason('x'.repeat(1001))).toBe(false);
    expect(validReason('')).toBe(false);
    expect(validReason('Lý do có\u0000 ký tự điều khiển')).toBe(false);
    expect(validReason('Dòng một\ndòng hai đủ dài')).toBe(true);
  });
});

describe('openChildren', () => {
  it('chỉ giữ con chưa done/cancelled', () => {
    const kids = [
      { id: 'k1', status: 'todo' },
      { id: 'k2', status: 'done' },
      { id: 'k3', status: 'cancelled' },
      { id: 'k4', status: 'in_progress' },
    ];
    expect(openChildren(kids).map((k) => k.id)).toEqual(['k1', 'k4']);
  });
});

function fakeDeps(over: Partial<ForceDoneDeps> = {}) {
  const log: string[] = [];
  const deps: ForceDoneDeps = {
    getIssue: async () => {
      log.push('getIssue');
      return { status: 'in_review' };
    },
    listChildren: async () => {
      log.push('listChildren');
      return [
        { id: 'k1', status: 'todo' },
        { id: 'k2', status: 'done' },
      ];
    },
    cancelChild: async (id) => {
      log.push(`cancelChild:${id}`);
    },
    listActiveRuns: async () => {
      log.push('listActiveRuns');
      return [
        { id: 'r1', status: 'running' },
        { id: 'r2', status: 'succeeded' },
        { id: 'r3', status: 'queued' },
      ];
    },
    cancelRun: async (id) => {
      log.push(`cancelRun:${id}`);
    },
    forceDone: async (reason) => {
      log.push(`forceDone:${reason}`);
      return { issue: {} as never, violations: [], warnings: [] };
    },
    ...over,
  };
  return { deps, log };
}

describe('runForceDone', () => {
  it('gọi theo thứ tự: đọc lại issue → hủy run đang chạy → route → rồi mới hủy con chưa xong đã hiện', async () => {
    const { deps, log } = fakeDeps();
    const out = await runForceDone(deps, { reason: '  Owner tự kiểm xong  ', childIds: ['k1', 'k2'] });
    expect(out).toEqual({ kind: 'done', result: { issue: {}, violations: [], warnings: [] }, childFailures: [] });
    expect(log).toEqual([
      'getIssue',
      'listActiveRuns',
      'cancelRun:r1',
      'cancelRun:r3',
      'forceDone:Owner tự kiểm xong',
      'listChildren',
      'cancelChild:k1',
    ]);
  });

  it('chỉ hủy con owner đã thấy trong dialog: con mới tạo sau khi mở trang thì để nguyên', async () => {
    const { deps, log } = fakeDeps({
      listChildren: async () => {
        log.push('listChildren');
        return [
          { id: 'k1', status: 'todo' },
          { id: 'k9', status: 'todo' },
        ];
      },
    });
    await runForceDone(deps, { reason: 'Owner tự kiểm xong', childIds: ['k1'] });
    expect(log.filter((l) => l.startsWith('cancelChild'))).toEqual(['cancelChild:k1']);
  });

  it('không có con nào được chọn thì không đọc hay hủy con', async () => {
    const { deps, log } = fakeDeps();
    await runForceDone(deps, { reason: 'Owner tự kiểm xong', childIds: [] });
    expect(log).toEqual(['getIssue', 'listActiveRuns', 'cancelRun:r1', 'cancelRun:r3', 'forceDone:Owner tự kiểm xong']);
  });

  it('issue đã đóng khi đọc lại thì không gọi gì thêm', async () => {
    for (const status of ['done', 'cancelled']) {
      const { deps, log } = fakeDeps({
        getIssue: async () => {
          log.push('getIssue');
          return { status };
        },
      });
      const out = await runForceDone(deps, { reason: 'Owner tự kiểm xong', childIds: ['k1'] });
      expect(out).toEqual({ kind: 'stale', status });
      expect(log).toEqual(['getIssue']);
    }
  });

  it('lỗi trước khi ép (hủy run, route) thì dừng, không hủy con', async () => {
    const { deps, log } = fakeDeps({
      forceDone: async () => {
        log.push('forceDone');
        throw new Error('update_failed');
      },
    });
    await expect(runForceDone(deps, { reason: 'Owner tự kiểm xong', childIds: ['k1'] })).rejects.toThrow(
      'update_failed',
    );
    expect(log).toEqual(['getIssue', 'listActiveRuns', 'cancelRun:r1', 'cancelRun:r3', 'forceDone']);
  });

  it('hủy con lỗi sau khi đã ép thì không ném: vẫn hủy các con khác, trả danh sách con chưa hủy được', async () => {
    const { deps, log } = fakeDeps({
      listChildren: async () => [
        { id: 'k1', status: 'todo' },
        { id: 'k3', status: 'in_progress' },
      ],
      cancelChild: async (id) => {
        log.push(`cancelChild:${id}`);
        if (id === 'k1') throw new Error('Không hủy được con');
      },
    });
    const out = await runForceDone(deps, { reason: 'Owner tự kiểm xong', childIds: ['k1', 'k3'] });
    expect(out.kind === 'done' && out.childFailures).toEqual([{ id: 'k1', message: 'Không hủy được con' }]);
    expect(log.slice(-2)).toEqual(['cancelChild:k1', 'cancelChild:k3']);
  });

  it('lý do không hợp lệ thì ném lỗi, không gọi API', async () => {
    const { deps, log } = fakeDeps();
    await expect(runForceDone(deps, { reason: 'ngắn', childIds: ['k1'] })).rejects.toThrow('reason_invalid');
    expect(log).toEqual([]);
  });
});

describe('cancelShownChildren', () => {
  it('đọc lại danh sách con, bỏ con đã đóng, đọc danh sách con lỗi thì mọi id đều lỗi', async () => {
    const { deps, log } = fakeDeps();
    expect(await cancelShownChildren(deps, ['k1', 'k2'])).toEqual([]);
    expect(log).toEqual(['listChildren', 'cancelChild:k1']);
    const broken = fakeDeps({
      listChildren: async () => {
        throw new Error('mạng lỗi');
      },
    });
    expect(await cancelShownChildren(broken.deps, ['k1', 'k3'])).toEqual([
      { id: 'k1', message: 'mạng lỗi' },
      { id: 'k3', message: 'mạng lỗi' },
    ]);
  });
});

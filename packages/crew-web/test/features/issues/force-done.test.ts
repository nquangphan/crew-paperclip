import { describe, expect, it } from 'vitest';
import {
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
  it('gọi theo thứ tự: đọc lại issue → hủy con chưa xong → hủy run đang chạy → route', async () => {
    const { deps, log } = fakeDeps();
    const out = await runForceDone(deps, { reason: '  Owner tự kiểm xong  ', cancelChildren: true });
    expect(out.kind).toBe('done');
    expect(log).toEqual([
      'getIssue',
      'listChildren',
      'cancelChild:k1',
      'listActiveRuns',
      'cancelRun:r1',
      'cancelRun:r3',
      'forceDone:Owner tự kiểm xong',
    ]);
  });

  it('bỏ chọn hủy con thì không đọc hay hủy con', async () => {
    const { deps, log } = fakeDeps();
    await runForceDone(deps, { reason: 'Owner tự kiểm xong', cancelChildren: false });
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
      const out = await runForceDone(deps, { reason: 'Owner tự kiểm xong', cancelChildren: true });
      expect(out).toEqual({ kind: 'stale', status });
      expect(log).toEqual(['getIssue']);
    }
  });

  it('dừng ở lỗi đầu tiên, không gọi bước sau', async () => {
    const { deps, log } = fakeDeps({
      cancelChild: async (id) => {
        log.push(`cancelChild:${id}`);
        throw new Error('Không hủy được con');
      },
    });
    await expect(runForceDone(deps, { reason: 'Owner tự kiểm xong', cancelChildren: true })).rejects.toThrow(
      'Không hủy được con',
    );
    expect(log).toEqual(['getIssue', 'listChildren', 'cancelChild:k1']);
  });

  it('lý do không hợp lệ thì ném lỗi, không gọi API', async () => {
    const { deps, log } = fakeDeps();
    await expect(runForceDone(deps, { reason: 'ngắn', cancelChildren: true })).rejects.toThrow('reason_invalid');
    expect(log).toEqual([]);
  });
});

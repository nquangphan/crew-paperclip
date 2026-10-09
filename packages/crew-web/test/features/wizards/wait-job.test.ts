import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MachineJob } from '@/api';
import { JobFailedError, JobTimeoutError, waitJob } from '@/features/wizards/add-project/wait-job';

const job = (over: Partial<MachineJob> = {}): MachineJob => ({
  id: 'j1',
  companyId: 'c1',
  machineId: 'm1',
  kind: 'inspect-folder',
  payload: { kind: 'inspect-folder', folder: '/x' },
  status: 'queued',
  result: null,
  errorCode: null,
  errorText: null,
  attempts: 0,
  setupRunId: 'r1',
  createdAt: '2026-10-10T00:00:00Z',
  claimedAt: null,
  finishedAt: null,
  ...over,
});

/** Nguồn giả: lần gọi thứ i trả trạng thái thứ i (hết danh sách thì giữ trạng thái cuối). */
function source(statuses: Partial<MachineJob>[]) {
  let i = 0;
  const list = vi.fn(async (_companyId: string, _q?: unknown) => {
    const over = statuses[Math.min(i, statuses.length - 1)];
    i += 1;
    return [job({ id: 'other' }), job(over)];
  });
  return { jobs: { list }, list };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('waitJob', () => {
  it('done → trả job, poll 2 giây một lần, lọc theo setupRunId của job', async () => {
    const s = source([{ status: 'queued' }, { status: 'claimed' }, { status: 'done', result: null }]);
    const p = waitJob(s, job(), { timeoutMs: 60_000 });
    await vi.advanceTimersByTimeAsync(4_000);
    await expect(p).resolves.toMatchObject({ id: 'j1', status: 'done' });
    expect(s.list).toHaveBeenCalledTimes(3);
    expect(s.list.mock.calls[0]).toEqual(['c1', { machineId: 'm1', setupRunId: 'r1', limit: 100 }]);
  });

  it('failed → JobFailedError mang errorCode, errorText', async () => {
    const s = source([{ status: 'failed', errorCode: 'folder_not_git', errorText: 'Không phải repo git' }]);
    const err = await waitJob(s, job(), { timeoutMs: 60_000 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(JobFailedError);
    expect(err).toMatchObject({ errorCode: 'folder_not_git', errorText: 'Không phải repo git' });
  });

  it('cancelled cũng là thất bại', async () => {
    const s = source([{ status: 'cancelled' }]);
    await expect(waitJob(s, job(), { timeoutMs: 60_000 })).rejects.toBeInstanceOf(JobFailedError);
  });

  it('quá hạn → JobTimeoutError', async () => {
    const s = source([{ status: 'queued' }]);
    const p = waitJob(s, job(), { timeoutMs: 10_000 }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(12_000);
    expect(await p).toBeInstanceOf(JobTimeoutError);
  });

  it('signal.abort() → dừng poll', async () => {
    const s = source([{ status: 'queued' }]);
    const ctrl = new AbortController();
    const p = waitJob(s, job(), { timeoutMs: 60_000, signal: ctrl.signal }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(2_000);
    const calls = s.list.mock.calls.length;
    ctrl.abort();
    const err = await p;
    expect((err as Error).name).toBe('AbortError');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(s.list.mock.calls.length).toBe(calls);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/api';
import { judgeApprovalNote, judgeRequestType, recordOutcome, withHardTimeout } from '@/features/jev/judge-client';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('withHardTimeout', () => {
  it('quá hạn thì trả null và hủy tín hiệu, kể cả khi hàm bỏ qua tín hiệu', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const p = withHardTimeout((s) => {
      signal = s;
      return new Promise<string>(() => {});
    }, 1500);
    await vi.advanceTimersByTimeAsync(1499);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(await p).toBeNull();
    expect(signal?.aborted).toBe(true);
  });

  it('trả giá trị khi kịp hạn; lỗi ném ra hay reject đều thành null', async () => {
    expect(await withHardTimeout(async () => 'ok', 1500)).toBe('ok');
    expect(await withHardTimeout(() => Promise.reject(new Error('boom')), 1500)).toBeNull();
    expect(
      await withHardTimeout(() => {
        throw new Error('sync');
      }, 1500),
    ).toBeNull();
  });
});

describe('judgeApprovalNote', () => {
  const body = { issueId: 'i1', action: 'approve' as const, note: 'ok' };

  it('kết quả hợp lệ thì chuẩn hóa', async () => {
    vi.spyOn(api.jev, 'judgeApprovalNote').mockResolvedValue({
      ok: true,
      mode: 'on',
      label: 'request_changes',
      confidence: 0.9,
      mismatch: true,
      judgmentId: '4',
    });
    expect(await judgeApprovalNote('c1', body)).toMatchObject({ mode: 'on', mismatch: true, judgmentId: '4' });
  });

  it.each([
    ['ok:false', { ok: false, reason: 'off' }],
    ['sai dạng', { ok: 'yes' }],
  ])('%s: null', async (_n, reply) => {
    vi.spyOn(api.jev, 'judgeApprovalNote').mockResolvedValue(reply);
    expect(await judgeApprovalNote('c1', body)).toBeNull();
  });

  it('lỗi mạng: null, không ném', async () => {
    vi.spyOn(api.jev, 'judgeApprovalNote').mockRejectedValue(new Error('network'));
    expect(await judgeApprovalNote('c1', body)).toBeNull();
  });

  it('mặc định chờ tối đa 1500 ms', async () => {
    vi.useFakeTimers();
    vi.spyOn(api.jev, 'judgeApprovalNote').mockImplementation(() => new Promise(() => {}));
    const p = judgeApprovalNote('c1', body);
    await vi.advanceTimersByTimeAsync(1500);
    expect(await p).toBeNull();
  });
});

describe('judgeRequestType và recordOutcome', () => {
  it('request-type lỗi thì null', async () => {
    vi.spyOn(api.jev, 'judgeRequestType').mockRejectedValue(new Error('500'));
    expect(await judgeRequestType('c1', { title: 'a'.repeat(30), description: '' })).toBeNull();
  });

  it('recordOutcome bỏ qua khi không có judgmentId và nuốt lỗi', async () => {
    const spy = vi.spyOn(api.jev, 'judgmentOutcome').mockRejectedValue(new Error('x'));
    recordOutcome('c1', null, 'sent');
    expect(spy).not.toHaveBeenCalled();
    recordOutcome('c1', '7', 'sent');
    expect(spy).toHaveBeenCalledWith('c1', '7', 'sent');
    await Promise.resolve();
  });
});

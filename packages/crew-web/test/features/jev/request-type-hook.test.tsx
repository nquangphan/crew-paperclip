// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/api';
import {
  changedChars,
  changedMeaningfully,
  SUGGEST_MAX_CALLS,
  useRequestTypeSuggestion,
} from '@/features/jev/use-request-type-suggestion';

const ON = { ok: true, mode: 'on', label: 'research', confidence: 0.9, judgmentId: '7' };

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const settle = (ms = 900) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
const BASE = 'So sánh hai thư viện biểu đồ cho trang báo cáo';
const LONG = `${BASE}. ${'Mô tả thêm rất nhiều chữ để thay đổi đáng kể nội dung. '.repeat(2)}`;

describe('độ đổi của chữ', () => {
  it('đếm phần khác nhau giữa hai đoạn', () => {
    expect(changedChars('abc', 'abc')).toBe(0);
    expect(changedChars('hello world', 'hello brave world')).toBe(6);
    expect(changedMeaningfully(BASE, `${BASE}!`)).toBe(false);
    expect(changedMeaningfully(BASE, LONG)).toBe(true);
  });
});

describe('useRequestTypeSuggestion', () => {
  it('sửa vặt không hỏi lại; chữ đổi nhiều mới hỏi lại; tối đa 3 lần mỗi lần mở form', async () => {
    const spy = vi.spyOn(api.jev, 'judgeRequestType').mockResolvedValue(ON);
    const { rerender } = renderHook(({ t, d }) => useRequestTypeSuggestion('c1', t, d), {
      initialProps: { t: BASE, d: '' },
    });
    await settle();
    expect(spy).toHaveBeenCalledTimes(1);
    rerender({ t: `${BASE}!`, d: '' });
    await settle();
    expect(spy).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 6; i++) {
      rerender({ t: BASE, d: `${'x'.repeat(40 + i)} ${i} đoạn mô tả khác hẳn ${'y'.repeat(60 * (i + 1))}` });
      await settle();
    }
    expect(spy.mock.calls.length).toBe(SUGGEST_MAX_CALLS);
  });

  it('chữ đổi đáng kể thì hủy request đang bay và không hiện gợi ý cũ', async () => {
    const signals: AbortSignal[] = [];
    vi.spyOn(api.jev, 'judgeRequestType').mockImplementation((_c, _b, sig) => {
      if (sig) signals.push(sig);
      return new Promise(() => {});
    });
    const { rerender, result } = renderHook(({ d }) => useRequestTypeSuggestion('c1', BASE, d), {
      initialProps: { d: '' },
    });
    await settle();
    expect(signals).toHaveLength(1);
    rerender({ d: 'đã viết thêm một đoạn mô tả dài khác hẳn với lúc đầu để chữ đổi nhiều' });
    await settle(100);
    expect(signals[0].aborted).toBe(true);
    expect(result.current.suggestion).toBeNull();
  });

  it('chỉ gửi `current` khi owner đã chọn loại', async () => {
    const spy = vi.spyOn(api.jev, 'judgeRequestType').mockResolvedValue(ON);
    renderHook(() => useRequestTypeSuggestion('c1', BASE, ''));
    await settle();
    expect(spy.mock.calls[0][1]).toEqual({ title: BASE, description: '' });
    cleanup();
    spy.mockClear();
    renderHook(() => useRequestTypeSuggestion('c1', BASE, '', 'bug'));
    await settle();
    expect(spy.mock.calls[0][1]).toEqual({ title: BASE, description: '', current: 'bug' });
  });

  it('gợi ý biến mất khi chữ đổi nhiều sau đó; outcome chỉ ghi khi không còn request đang chờ', async () => {
    vi.spyOn(api.jev, 'judgeRequestType').mockResolvedValue(ON);
    const outcome = vi.spyOn(api.jev, 'judgmentOutcome').mockResolvedValue({ ok: true });
    const { rerender, result } = renderHook(({ d }) => useRequestTypeSuggestion('c1', BASE, d), {
      initialProps: { d: '' },
    });
    await settle();
    expect(result.current.suggestion).toBe('research');
    act(() => result.current.recordFinal('research'));
    expect(outcome).toHaveBeenCalledWith('c1', '7', 'research');
    rerender({ d: 'viết thêm rất nhiều chữ khác để nội dung đổi đáng kể so với lúc có gợi ý ban đầu' });
    expect(result.current.suggestion).toBeNull();
  });

  it('lỗi thì không gợi ý và không ghi outcome', async () => {
    vi.spyOn(api.jev, 'judgeRequestType').mockRejectedValue(new Error('500'));
    const outcome = vi.spyOn(api.jev, 'judgmentOutcome').mockResolvedValue({ ok: true });
    const { result } = renderHook(() => useRequestTypeSuggestion('c1', BASE, ''));
    await settle();
    expect(result.current.suggestion).toBeNull();
    act(() => result.current.recordFinal('code'));
    expect(outcome).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { installStaleChunkReload } from '@/lib/stale-chunk-reload';

function setup(stored: Record<string, string> = {}, opts: { setThrows?: boolean } = {}) {
  let listener: ((event: Event) => void) | null = null;
  const store = { ...stored };
  const target = {
    addEventListener: (_type: 'vite:preloadError', l: (event: Event) => void) => {
      listener = l;
    },
    location: { reload: vi.fn() },
    sessionStorage: {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        if (opts.setThrows) throw new Error('blocked');
        store[k] = v;
      },
    },
  };
  const fire = () => {
    const event = { preventDefault: vi.fn() } as unknown as Event;
    listener?.(event);
    return event;
  };
  return { target, fire, store };
}

describe('installStaleChunkReload', () => {
  it('chunk cũ mất sau deploy: chặn trang lỗi và tải lại một lần', () => {
    const { target, fire, store } = setup();
    installStaleChunkReload(target, () => 100_000);
    const event = fire();
    expect(event.preventDefault).toHaveBeenCalled();
    expect(target.location.reload).toHaveBeenCalledTimes(1);
    expect(store['crew.staleChunkReloadAt']).toBe('100000');
  });

  it('vừa tải lại chưa tới 30 giây mà vẫn lỗi: không tải lại nữa, để lỗi hiện ra', () => {
    const { target, fire } = setup({ 'crew.staleChunkReloadAt': '90000' });
    installStaleChunkReload(target, () => 100_000);
    const event = fire();
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(target.location.reload).not.toHaveBeenCalled();
  });

  it('không ghi được sessionStorage thì không tải lại (tránh vòng lặp)', () => {
    const { target, fire } = setup({}, { setThrows: true });
    installStaleChunkReload(target, () => 100_000);
    fire();
    expect(target.location.reload).not.toHaveBeenCalled();
  });
});

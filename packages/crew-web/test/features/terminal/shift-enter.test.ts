import { describe, expect, it, vi } from 'vitest';
import { shiftEnterHandler } from '@/features/terminal/xterm-options';

const key = (over: Partial<KeyboardEvent>) =>
  ({
    type: 'keydown',
    key: 'Enter',
    shiftKey: true,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    preventDefault: vi.fn(),
    ...over,
  }) as unknown as KeyboardEvent;

describe('shiftEnterHandler', () => {
  it('Shift+Enter gửi ESC+CR (xuống dòng trong Claude Code) và chặn xterm gửi CR', () => {
    const send = vi.fn();
    const ev = key({});
    expect(shiftEnterHandler(ev, send)).toBe(false);
    expect(send).toHaveBeenCalledWith('\x1b\r');
    expect(ev.preventDefault).toHaveBeenCalled();
  });

  it('keypress của Shift+Enter cũng chặn nhưng không gửi lần hai; keyup cho qua', () => {
    const send = vi.fn();
    expect(shiftEnterHandler(key({ type: 'keypress' }), send)).toBe(false);
    expect(shiftEnterHandler(key({ type: 'keyup' }), send)).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });

  it('Enter thường, Ctrl/Alt/Meta+Shift+Enter và phím khác cho xterm tự xử lý', () => {
    const send = vi.fn();
    for (const over of [{ shiftKey: false }, { ctrlKey: true }, { altKey: true }, { metaKey: true }, { key: 'a' }]) {
      expect(shiftEnterHandler(key(over), send), JSON.stringify(over)).toBe(true);
    }
    expect(send).not.toHaveBeenCalled();
  });

  it('đang gõ dở bằng bộ gõ (Telex/VNI) thì không chặn, để bộ gõ chốt chữ trước', () => {
    const send = vi.fn();
    const composing = key({ isComposing: true });
    expect(shiftEnterHandler(composing, send)).toBe(true);
    expect(shiftEnterHandler(key({ keyCode: 229 }), send)).toBe(true);
    expect(send).not.toHaveBeenCalled();
    expect(composing.preventDefault).not.toHaveBeenCalled();
  });
});

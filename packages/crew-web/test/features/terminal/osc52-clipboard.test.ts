// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeOnlyClipboard } from '@/features/terminal/osc52-clipboard';

describe('writeOnlyClipboard', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('chữ tmux chép (OSC 52, clipboard hệ thống) vào clipboard trình duyệt', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText, readText: vi.fn() } });
    await writeOnlyClipboard.writeText('c' as never, 'xin chào');
    expect(writeText).toHaveBeenCalledWith('xin chào');
  });

  it('tmux gửi vùng chọn rỗng (`]52;;…`): coi là clipboard hệ thống', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    await writeOnlyClipboard.writeText('' as never, 'từ tmux');
    expect(writeText).toHaveBeenCalledWith('từ tmux');
  });

  it('bỏ qua vùng chọn PRIMARY', async () => {
    const writeText = vi.fn();
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    await writeOnlyClipboard.writeText('p' as never, 'x');
    expect(writeText).not.toHaveBeenCalled();
  });

  it('không cho chương trình trên Mac đọc clipboard của trình duyệt', async () => {
    const readText = vi.fn().mockResolvedValue('bí mật');
    vi.stubGlobal('navigator', { clipboard: { readText, writeText: vi.fn() } });
    expect(await writeOnlyClipboard.readText('c' as never)).toBe('');
    expect(readText).not.toHaveBeenCalled();
  });

  it('trình duyệt từ chối ghi (mất focus, không HTTPS) thì không ném lỗi', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    await expect(writeOnlyClipboard.writeText('c' as never, 'x')).resolves.toBeUndefined();
  });
});

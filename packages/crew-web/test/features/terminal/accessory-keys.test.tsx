// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACCESSORY_KEYS, AccessoryKeys } from '@/features/terminal/accessory-keys';

afterEach(cleanup);

describe('AccessoryKeys', () => {
  it('có đủ phím phụ với đúng chuỗi gửi', () => {
    expect(ACCESSORY_KEYS.map((k) => [k.label, k.data])).toEqual([
      ['Esc', '\x1b'],
      ['Tab', '\t'],
      ['Shift+Tab', '\x1b[Z'],
      ['Enter', '\r'],
      ['↑', '\x1b[A'],
      ['↓', '\x1b[B'],
      ['→', '\x1b[C'],
      ['←', '\x1b[D'],
      ['Ctrl+C', '\x03'],
      ['Ctrl+D', '\x04'],
      ['Ctrl+L', '\x0c'],
      ['Ctrl+R', '\x12'],
    ]);
  });

  it('bấm Shift+Tab gửi \\x1b[Z', () => {
    const send = vi.fn();
    render(<AccessoryKeys send={send} />);
    fireEvent.click(screen.getByRole('button', { name: 'Shift+Tab' }));
    expect(send).toHaveBeenCalledWith('\x1b[Z');
  });
});

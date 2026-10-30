import { describe, expect, it } from 'vitest';
import {
  buildTerminalOptions,
  FONT_SCALES,
  nextFontScale,
  TERMINAL_FONT_FAMILY,
} from '@/features/terminal/xterm-options';

describe('buildTerminalOptions', () => {
  it('nền tối: thông số theo Orca, tương phản tối thiểu 3', () => {
    const o = buildTerminalOptions('dark', 1);
    expect(o).toMatchObject({
      fontSize: 14,
      fontWeight: '300',
      fontWeightBold: '500',
      cursorBlink: true,
      cursorStyle: 'block',
      cursorInactiveStyle: 'outline',
      scrollback: 5000,
      scrollSensitivity: 1.15,
      fastScrollSensitivity: 5,
      allowProposedApi: true,
      drawBoldTextInBrightColors: true,
      macOptionClickForcesSelection: true,
      vtExtensions: { kittyKeyboard: true },
      minimumContrastRatio: 3,
      fontFamily: TERMINAL_FONT_FAMILY,
    });
    expect(o.theme).toBeTypeOf('object');
  });

  it('nền sáng cỡ 1,5: chữ 21 và tương phản 4,5', () => {
    const o = buildTerminalOptions('light', 1.5);
    expect(o.fontSize).toBe(21);
    expect(o.minimumContrastRatio).toBe(4.5);
  });

  it('font stack đúng thứ tự', () => {
    expect(TERMINAL_FONT_FAMILY).toBe(
      '"SF Mono", Menlo, Monaco, "Cascadia Mono", Consolas, "DejaVu Sans Mono", "Liberation Mono", monospace',
    );
  });
});

describe('nextFontScale', () => {
  it('đi theo bậc 0,75–1,5 và dừng ở hai đầu', () => {
    expect(FONT_SCALES).toEqual([0.75, 1, 1.25, 1.5]);
    expect(nextFontScale(1, 1)).toBe(1.25);
    expect(nextFontScale(1, -1)).toBe(0.75);
    expect(nextFontScale(1.5, 1)).toBe(1.5);
    expect(nextFontScale(0.75, -1)).toBe(0.75);
  });
});

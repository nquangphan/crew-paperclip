// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  buildTerminalOptions,
  FONT_SCALES,
  nextFontScale,
  TERMINAL_FONT_FAMILY,
} from '@/features/terminal/xterm-options';

describe('buildTerminalOptions', () => {
  it('thông số theo Orca, chữ thường, tương phản tối thiểu 3', () => {
    const o = buildTerminalOptions(1);
    expect(o).toMatchObject({
      fontSize: 14,
      fontWeight: 'normal',
      fontWeightBold: '600',
      lineHeight: 1.15,
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
  });

  it('luôn nền tối với đủ 16 màu ANSI, không theo theme trang', () => {
    document.documentElement.classList.remove('dark');
    const theme = buildTerminalOptions(1).theme ?? {};
    expect(theme.background).toBe('#0d1117');
    expect(theme.foreground).toBe('#e6edf3');
    for (const key of ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'] as const) {
      expect(theme[key]).toMatch(/^#/);
      expect(theme[`bright${key[0].toUpperCase()}${key.slice(1)}` as keyof typeof theme]).toMatch(/^#/);
    }
  });

  it('cỡ 1,5: chữ 21', () => {
    expect(buildTerminalOptions(1.5).fontSize).toBe(21);
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

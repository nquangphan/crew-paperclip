// Tuỳ chọn xterm của trang terminal, theo số liệu của Orca (pane-terminal-options.ts) và token màu sáng/tối của crew-web.
import type { ITerminalOptions, ITheme } from '@xterm/xterm';

export type TerminalMode = 'light' | 'dark';

export const TERMINAL_FONT_FAMILY =
  '"SF Mono", Menlo, Monaco, "Cascadia Mono", Consolas, "DejaVu Sans Mono", "Liberation Mono", monospace';

/** Cỡ chữ gốc; nhân với bậc cỡ chữ người dùng chọn. */
const BASE_FONT_SIZE = 14;

/** Bậc cỡ chữ của nút A−/A+. */
export const FONT_SCALES = [0.75, 1, 1.25, 1.5] as const;

const FONT_SCALE_KEY = 'crew.terminal.fontScale';

/**
 * `vtExtensions` có từ xterm 6.1; bản 6.0 bỏ qua khoá lạ ở constructor nên khai sẵn để CLI bật được phím
 * Kitty (Shift+Enter…) khi nâng xterm.
 */
export type CrewTerminalOptions = ITerminalOptions & { vtExtensions?: { kittyKeyboard?: boolean } };

/** Đọc một CSS var của `src/ds/tokens.css` trên `<html>` (class `dark` quyết định bảng nào). */
function cssVar(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || undefined;
}

export function terminalTheme(): ITheme {
  return {
    background: cssVar('--background'),
    foreground: cssVar('--foreground'),
    cursor: cssVar('--foreground'),
    cursorAccent: cssVar('--background'),
    selectionBackground: cssVar('--ring'),
  };
}

/** Theme hiện tại của trang (class `dark` trên `<html>`, đặt ở index.html). */
export function currentMode(): TerminalMode {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

export function buildTerminalOptions(mode: TerminalMode, fontScale: number): CrewTerminalOptions {
  return {
    allowProposedApi: true,
    cursorBlink: true,
    cursorStyle: 'block',
    cursorInactiveStyle: 'outline',
    fontSize: fontSizeFor(fontScale),
    fontFamily: TERMINAL_FONT_FAMILY,
    fontWeight: '300',
    fontWeightBold: '500',
    scrollback: 5000,
    scrollSensitivity: 1.15,
    fastScrollSensitivity: 5,
    drawBoldTextInBrightColors: true,
    macOptionClickForcesSelection: true,
    // Nền sáng cần tương phản cao hơn để màu ANSI nhạt vẫn đọc được.
    minimumContrastRatio: mode === 'dark' ? 3 : 4.5,
    vtExtensions: { kittyKeyboard: true },
    theme: terminalTheme(),
  };
}

export function fontSizeFor(fontScale: number): number {
  return Math.round(BASE_FONT_SIZE * fontScale);
}

/** Bậc kế tiếp theo hướng `step` (+1 to hơn, −1 nhỏ hơn); ở hai đầu thì giữ nguyên. */
export function nextFontScale(current: number, step: 1 | -1): number {
  const i = FONT_SCALES.indexOf(current as (typeof FONT_SCALES)[number]);
  const at = i === -1 ? FONT_SCALES.indexOf(1) : i;
  return FONT_SCALES[Math.min(FONT_SCALES.length - 1, Math.max(0, at + step))];
}

export function readFontScale(): number {
  try {
    const v = Number(localStorage.getItem(FONT_SCALE_KEY));
    return (FONT_SCALES as readonly number[]).includes(v) ? v : 1;
  } catch {
    return 1;
  }
}

export function saveFontScale(scale: number): void {
  try {
    localStorage.setItem(FONT_SCALE_KEY, String(scale));
  } catch {
    // trình duyệt chặn lưu trữ: cỡ chữ chỉ giữ trong phiên này
  }
}

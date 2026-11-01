// Tuỳ chọn xterm của trang terminal, theo số liệu của Orca (pane-terminal-options.ts) và bảng màu tối `--terminal-*`.
import type { ITerminalOptions, ITheme } from '@xterm/xterm';

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

/** Đọc một CSS var của `src/ds/tokens.css` (bảng `--terminal-*` cố định, không đổi theo theme trang). */
function cssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

/**
 * Terminal luôn nền tối: màu ANSI của CLI viết cho nền tối, nền sáng làm chữ xám nhạt và màu vàng gần như mất.
 * Nền, chữ, vùng chọn lấy từ token `--terminal-*`; 16 màu ANSI theo bảng tối của GitHub.
 */
export function terminalTheme(): ITheme {
  const background = cssVar('--terminal-background', '#0d1117');
  const foreground = cssVar('--terminal-foreground', '#e6edf3');
  return {
    background,
    foreground,
    cursor: foreground,
    cursorAccent: background,
    selectionBackground: cssVar('--terminal-selection', 'rgba(56, 139, 253, 0.35)'),
    black: '#484f58',
    red: '#ff7b72',
    green: '#3fb950',
    yellow: '#d29922',
    blue: '#58a6ff',
    magenta: '#bc8cff',
    cyan: '#39c5cf',
    white: '#b1bac4',
    brightBlack: '#6e7681',
    brightRed: '#ffa198',
    brightGreen: '#56d364',
    brightYellow: '#e3b341',
    brightBlue: '#79c0ff',
    brightMagenta: '#d2a8ff',
    brightCyan: '#56d4dd',
    brightWhite: '#ffffff',
  };
}

export function buildTerminalOptions(fontScale: number): CrewTerminalOptions {
  return {
    allowProposedApi: true,
    cursorBlink: true,
    cursorStyle: 'block',
    cursorInactiveStyle: 'outline',
    fontSize: fontSizeFor(fontScale),
    fontFamily: TERMINAL_FONT_FAMILY,
    fontWeight: 'normal',
    fontWeightBold: '600',
    lineHeight: 1.15,
    scrollback: 5000,
    scrollSensitivity: 1.15,
    fastScrollSensitivity: 5,
    drawBoldTextInBrightColors: true,
    macOptionClickForcesSelection: true,
    // Chữ mờ (dim) của CLI vẫn phải đọc được trên nền tối.
    minimumContrastRatio: 3,
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

/**
 * Shift+Enter: xterm 6.0 gửi CR như Enter nên Claude Code gửi luôn tin nhắn. Gửi ESC+CR thay vào (Claude Code coi là
 * xuống dòng, không cần tmux bật extended-keys) và chặn xterm tự gửi. Gửi ở keydown; chặn cả keypress để xterm không
 * gửi thêm CR; keyup và phím khác cho qua. Đang gõ dở bằng bộ gõ (Telex/VNI: `isComposing` hoặc keyCode 229) thì cho
 * qua để bộ gõ chốt chữ trước, không thì chữ đó rơi xuống sau ESC+CR.
 */
export function shiftEnterHandler(ev: KeyboardEvent, send: (data: string) => void): boolean {
  if (ev.isComposing || ev.keyCode === 229) return true;
  if (ev.key !== 'Enter' || !ev.shiftKey || ev.ctrlKey || ev.altKey || ev.metaKey) return true;
  if (ev.type === 'keyup') return true;
  ev.preventDefault();
  if (ev.type === 'keydown') send('\x1b\r');
  return false;
}

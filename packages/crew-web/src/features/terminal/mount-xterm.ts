// Gắn xterm vào khung: addon fit, unicode11, web-links, search, clipboard (OSC 52, chỉ ghi); WebGL nạp sau cùng, mất context thì lùi về DOM renderer.
import '@xterm/xterm/css/xterm.css';
import { ClipboardAddon } from '@xterm/addon-clipboard';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { type ITerminalOptions, Terminal } from '@xterm/xterm';
import { writeOnlyClipboard } from './osc52-clipboard';
import { attachTouchScroll } from './touch-scroll';
import { shiftEnterHandler } from './xterm-options';

export interface TerminalSize {
  cols: number;
  rows: number;
}

export interface MountedXterm {
  term: Terminal;
  /** Khớp lưới với khung; null khi khung chưa có kích thước (đang ẩn). */
  fit(): TerminalSize | null;
  dispose(): void;
}

/**
 * `onResize` nhận cỡ lưới mới khi khung đổi kích thước. ResizeObserver chỉ hẹn một khung `requestAnimationFrame`;
 * cỡ khung phải giống nhau ở hai khung liên tiếp mới fit và báo, để kéo cửa sổ hay bàn phím điện thoại trồi lên
 * không bắn liên tục SIGWINCH làm TUI của agent vẽ lại liên hồi.
 */
export function mountXterm(
  el: HTMLElement,
  options: ITerminalOptions,
  onResize?: (size: TerminalSize) => void,
): MountedXterm {
  const term = new Terminal(options);
  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.loadAddon(new Unicode11Addon());
  term.unicode.activeVersion = '11';
  term.loadAddon(new WebLinksAddon());
  term.loadAddon(new SearchAddon());
  term.loadAddon(new ClipboardAddon(undefined, writeOnlyClipboard));
  term.open(el);
  const detachTouchScroll = attachTouchScroll(el, term);
  // Qua term.input để ESC+CR đi đường onData như phím gõ.
  term.attachCustomKeyEventHandler((ev) => shiftEnterHandler(ev, (data) => term.input(data, true)));
  try {
    const webgl = new WebglAddon();
    webgl.onContextLoss(() => webgl.dispose());
    term.loadAddon(webgl);
  } catch {
    // Trình duyệt không có WebGL2: giữ DOM renderer.
  }

  const fitGrid = (): TerminalSize | null => {
    const dims = fitAddon.proposeDimensions();
    if (!dims || !Number.isFinite(dims.cols) || !Number.isFinite(dims.rows) || dims.cols < 1 || dims.rows < 1) {
      return null;
    }
    fitAddon.fit();
    return { cols: term.cols, rows: term.rows };
  };

  let frame = 0;
  let pending: { width: number; height: number } | null = null;
  let reported: TerminalSize | null = null;
  const settle = () => {
    frame = 0;
    const box = { width: el.clientWidth, height: el.clientHeight };
    if (!pending || pending.width !== box.width || pending.height !== box.height) {
      pending = box;
      frame = requestAnimationFrame(settle);
      return;
    }
    pending = null;
    const size = fitGrid();
    if (!size || (reported && reported.cols === size.cols && reported.rows === size.rows)) return;
    reported = size;
    onResize?.(size);
  };
  const observer = new ResizeObserver(() => {
    if (!frame) frame = requestAnimationFrame(settle);
  });
  observer.observe(el);

  return {
    term,
    fit: () => {
      const size = fitGrid();
      if (size) reported = size;
      return size;
    },
    dispose: () => {
      observer.disconnect();
      detachTouchScroll();
      if (frame) cancelAnimationFrame(frame);
      term.dispose();
    },
  };
}

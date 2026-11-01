import type { Terminal } from '@xterm/xterm';

type ScrollableTerm = Pick<Terminal, 'rows' | 'scrollLines' | 'buffer'>;

/**
 * Vuốt dọc trên điện thoại thành cuộn terminal. Cử chỉ chạm sẵn có của xterm 6 không cuộn được trên điện thoại.
 *
 * - Màn hình phụ (tmux, TUI của agent): không có lịch sử ở phía xterm, nên mỗi nhịp vuốt phát một `WheelEvent` theo
 *   pixel lên lưới chữ (`.xterm-screen`). xterm đổi nó thành cuộn chuột gửi cho tmux (`mouse on`) hoặc phím mũi tên.
 *   Tọa độ kẹp vào trong lưới vì xterm bỏ qua cuộn ở ngoài lưới, mà ngón tay hay trượt ra mép khi vuốt.
 * - Màn hình thường: cộng dồn pixel, đủ một dòng thì `scrollLines`.
 *
 * Ngón tay đi lên (clientY giảm) là xem dòng mới hơn, như cuộn tự nhiên.
 */
export function attachTouchScroll(el: HTMLElement, term: ScrollableTerm): () => void {
  let lastY: number | null = null;
  let pending = 0;

  const onStart = (ev: TouchEvent) => {
    lastY = ev.touches.length === 1 ? ev.touches[0].clientY : null;
    pending = 0;
  };
  const onMove = (ev: TouchEvent) => {
    if (lastY === null || ev.touches.length !== 1) return;
    const touch = ev.touches[0];
    const deltaY = lastY - touch.clientY;
    lastY = touch.clientY;
    if (deltaY === 0) return;
    ev.preventDefault();
    const screen = el.querySelector('.xterm-screen') ?? el;
    const box = screen.getBoundingClientRect();
    if (term.buffer.active.type === 'alternate') {
      screen.dispatchEvent(
        new WheelEvent('wheel', {
          deltaY,
          deltaMode: 0,
          clientX: clamp(touch.clientX, box.left, box.right),
          clientY: clamp(touch.clientY, box.top, box.bottom),
          bubbles: true,
          cancelable: true,
        }),
      );
      return;
    }
    const cellHeight = box.height / term.rows;
    if (!(cellHeight > 0)) return;
    pending += deltaY;
    const lines = Math.trunc(pending / cellHeight);
    if (lines === 0) return;
    pending -= lines * cellHeight;
    term.scrollLines(lines);
  };
  const onEnd = () => {
    lastY = null;
  };

  el.addEventListener('touchstart', onStart, { passive: true });
  el.addEventListener('touchmove', onMove, { passive: false });
  el.addEventListener('touchend', onEnd);
  el.addEventListener('touchcancel', onEnd);
  return () => {
    el.removeEventListener('touchstart', onStart);
    el.removeEventListener('touchmove', onMove);
    el.removeEventListener('touchend', onEnd);
    el.removeEventListener('touchcancel', onEnd);
  };
}

/** Kẹp vào [min+1, max-1] để điểm nằm hẳn trong lưới; khung chưa có kích thước (jsdom) thì giữ nguyên. */
function clamp(value: number, min: number, max: number): number {
  return max - min > 2 ? Math.min(Math.max(value, min + 1), max - 1) : value;
}

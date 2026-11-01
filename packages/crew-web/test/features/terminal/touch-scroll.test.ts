// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachTouchScroll } from '@/features/terminal/touch-scroll';

function touch(el: HTMLElement, type: string, ys: number[]) {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'touches', { value: ys.map((clientY) => ({ clientX: 10, clientY, target: el })) });
  el.dispatchEvent(ev);
  return ev;
}

/** Lưới 20 dòng cao 400px: mỗi dòng 20px. */
function setup(type: 'normal' | 'alternate') {
  const el = document.createElement('div');
  const screen = document.createElement('div');
  screen.className = 'xterm-screen';
  screen.getBoundingClientRect = () => ({ left: 0, right: 300, top: 0, bottom: 400, height: 400 }) as DOMRect;
  el.append(screen);
  document.body.append(el);
  const wheels: WheelEvent[] = [];
  screen.addEventListener('wheel', (ev) => wheels.push(ev as WheelEvent));
  const term = { rows: 20, scrollLines: vi.fn(), buffer: { active: { type } } };
  const detach = attachTouchScroll(el, term as never);
  return { el, wheels, term, detach };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('attachTouchScroll', () => {
  it('màn hình phụ: vuốt lên phát wheel dương, vuốt xuống phát âm, tọa độ kẹp vào lưới, chặn trang cuộn theo', () => {
    const { el, wheels, term } = setup('alternate');
    touch(el, 'touchstart', [300]);
    const up = touch(el, 'touchmove', [260]);
    touch(el, 'touchmove', [500]);
    expect(wheels.map((w) => w.deltaY)).toEqual([40, -240]);
    expect(wheels[0].clientY).toBe(260);
    expect(wheels[1].clientY).toBe(399);
    expect(wheels[0].deltaMode).toBe(0);
    expect(up.defaultPrevented).toBe(true);
    expect(term.scrollLines).not.toHaveBeenCalled();
  });

  it('màn hình thường: cộng dồn pixel, đủ một dòng mới cuộn', () => {
    const { el, wheels, term } = setup('normal');
    touch(el, 'touchstart', [300]);
    touch(el, 'touchmove', [290]);
    expect(term.scrollLines).not.toHaveBeenCalled();
    touch(el, 'touchmove', [255]);
    expect(term.scrollLines).toHaveBeenLastCalledWith(2);
    touch(el, 'touchmove', [300]);
    expect(term.scrollLines).toHaveBeenLastCalledWith(-2);
    expect(wheels).toHaveLength(0);
  });

  it('hai ngón (phóng to) và sau touchend thì bỏ qua', () => {
    const { el, wheels } = setup('alternate');
    touch(el, 'touchstart', [300, 400]);
    touch(el, 'touchmove', [250, 450]);
    touch(el, 'touchstart', [300]);
    touch(el, 'touchend', []);
    touch(el, 'touchmove', [200]);
    expect(wheels).toHaveLength(0);
  });

  it('gỡ listener khi detach', () => {
    const { el, wheels, detach } = setup('alternate');
    detach();
    touch(el, 'touchstart', [300]);
    touch(el, 'touchmove', [200]);
    expect(wheels).toHaveLength(0);
  });
});

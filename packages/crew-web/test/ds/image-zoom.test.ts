import { describe, expect, it } from 'vitest';
import {
  clampPan,
  clampScale,
  FIT_VIEW,
  formatZoomPercent,
  MAX_SCALE,
  panBy,
  stepScale,
  wheelFactor,
  zoomAt,
} from '@/ds';

// Hộp 400x300, ảnh vừa khít: ở mức 2 ảnh rộng 800x600 nên mỗi trục kéo được tối đa 200 / 150.
const BOUNDS = { boxW: 400, boxH: 300, imgW: 400, imgH: 300 };

describe('clampScale', () => {
  it('giữ trong khoảng 1 tới 8', () => {
    expect(clampScale(0.2)).toBe(1);
    expect(clampScale(3)).toBe(3);
    expect(clampScale(99)).toBe(MAX_SCALE);
  });
  it('mức sát 1 thì dính về đúng 1, giá trị rác thì về 1', () => {
    expect(clampScale(1.0004)).toBe(1);
    expect(clampScale(Number.NaN)).toBe(1);
  });
});

describe('stepScale', () => {
  it('nhân hoặc chia 1.25 và dừng ở biên', () => {
    expect(stepScale(1, 1)).toBe(1.25);
    expect(stepScale(1.25, -1)).toBe(1);
    expect(stepScale(1, -1)).toBe(1);
    expect(stepScale(7, 1)).toBe(MAX_SCALE);
    expect(stepScale(MAX_SCALE, 1)).toBe(MAX_SCALE);
  });
});

describe('zoomAt', () => {
  it('giữ điểm dưới con trỏ đứng yên', () => {
    const anchor = { x: 100, y: 50 };
    const next = zoomAt(FIT_VIEW, 2, anchor, BOUNDS);
    expect(next.scale).toBe(2);
    // Điểm ảnh ban đầu nằm ở anchor (mức 1, chưa dịch) phải vẫn ở anchor sau khi phóng.
    expect(next.x + 2 * anchor.x).toBeCloseTo(anchor.x);
    expect(next.y + 2 * anchor.y).toBeCloseTo(anchor.y);
  });
  it('điểm sát mép bị kẹp để không lộ khoảng trống', () => {
    const next = zoomAt(FIT_VIEW, 2, { x: 200, y: 150 }, BOUNDS);
    expect(next.x).toBe(-200);
    expect(next.y).toBe(-150);
  });
  it('về mức 1 thì ảnh về giữa khung', () => {
    const zoomed = zoomAt(FIT_VIEW, 3, { x: 150, y: 100 }, BOUNDS);
    expect(zoomAt(zoomed, 1, { x: 0, y: 0 }, BOUNDS)).toEqual(FIT_VIEW);
  });
  it('không vượt mức tối đa', () => {
    expect(zoomAt(FIT_VIEW, 50, { x: 0, y: 0 }, BOUNDS).scale).toBe(MAX_SCALE);
  });
});

describe('panBy / clampPan', () => {
  it('mức 1 không kéo được', () => {
    expect(panBy(FIT_VIEW, 80, -40, BOUNDS)).toEqual(FIT_VIEW);
  });
  it('đang zoom thì kéo theo con trỏ nhưng không ra khỏi khung', () => {
    const view = { scale: 2, x: 0, y: 0 };
    expect(panBy(view, 50, -20, BOUNDS)).toEqual({ scale: 2, x: 50, y: -20 });
    expect(panBy(view, 999, -999, BOUNDS)).toEqual({ scale: 2, x: 200, y: -150 });
  });
  it('ảnh nhỏ hơn khung theo một trục thì trục đó giữ ở giữa', () => {
    const wide = { boxW: 400, boxH: 300, imgW: 400, imgH: 100 };
    expect(clampPan({ scale: 2, x: 500, y: 500 }, wide)).toEqual({ scale: 2, x: 200, y: 0 });
  });
});

describe('wheelFactor', () => {
  it('cuộn lên phóng, cuộn xuống thu', () => {
    expect(wheelFactor(-100, 0, false)).toBeGreaterThan(1);
    expect(wheelFactor(100, 0, false)).toBeLessThan(1);
  });
  it('chụm trackpad (ctrlKey) nhạy hơn cuộn thường, đơn vị dòng quy ra điểm ảnh', () => {
    expect(wheelFactor(-5, 0, true)).toBeGreaterThan(wheelFactor(-5, 0, false));
    expect(wheelFactor(-3, 1, false)).toBeGreaterThan(wheelFactor(-3, 0, false));
  });
});

describe('formatZoomPercent', () => {
  it('làm tròn theo phần trăm của mức vừa khung', () => {
    expect(formatZoomPercent(1)).toBe('100%');
    expect(formatZoomPercent(1.25)).toBe('125%');
    expect(formatZoomPercent(1.953125)).toBe('195%');
  });
});

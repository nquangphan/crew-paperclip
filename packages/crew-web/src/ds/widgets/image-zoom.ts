// crew: tự dựng
// Phần tính thuần của zoom ảnh trong hộp xem file: mức zoom, zoom quanh một điểm, giới hạn kéo. Mức 1 là "vừa khung".
// Phép biến đổi là `translate(x, y) scale(scale)` quanh tâm ảnh, nên điểm ảnh q (tính từ tâm) hiện ở x + scale * q.

interface ZoomView {
  scale: number;
  /** Độ dịch ảnh theo điểm ảnh (px) so với lúc ảnh nằm giữa khung. */
  x: number;
  y: number;
}

/** Điểm tính từ tâm khung (px), dương sang phải và xuống dưới. */
interface ZoomPoint {
  x: number;
  y: number;
}

interface ZoomBounds {
  /** Kích thước vùng chứa ảnh. */
  boxW: number;
  boxH: number;
  /** Kích thước ảnh ở mức vừa khung (chưa nhân mức zoom). */
  imgW: number;
  imgH: number;
}

const MIN_SCALE = 1;
const MAX_SCALE = 8;
const ZOOM_STEP = 1.25;
/** Mức phóng khi bấm đúp từ trạng thái vừa khung. */
const DOUBLE_CLICK_SCALE = 2.5;
const FIT_VIEW: ZoomView = { scale: MIN_SCALE, x: 0, y: 0 };

/** Giữ mức trong [1, 8]; mức sát 1 dính về đúng 1 để nút "vừa khung" và biên khóa không lệch vì số lẻ. */
function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return MIN_SCALE;
  if (scale < MIN_SCALE + 1e-3) return MIN_SCALE;
  return Math.min(scale, MAX_SCALE);
}

/** Một bước nút/phím: nhân hoặc chia 1.25. */
function stepScale(scale: number, dir: 1 | -1): number {
  return clampScale(dir > 0 ? scale * ZOOM_STEP : scale / ZOOM_STEP);
}

/** Hệ số nhân cho một sự kiện wheel; chụm trackpad (ctrlKey) báo delta nhỏ nên nhân nhạy hơn. */
function wheelFactor(deltaY: number, deltaMode: number, ctrlKey: boolean): number {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  return Math.exp(-px * (ctrlKey ? 0.01 : 0.002));
}

function clampAxis(offset: number, img: number, box: number, scale: number): number {
  const limit = Math.max(0, (img * scale - box) / 2);
  return Math.min(limit, Math.max(-limit, offset));
}

/** Không cho kéo ảnh ra khỏi khung: mỗi trục chỉ dịch tới khi mép ảnh chạm mép khung; ảnh nhỏ hơn khung thì ở giữa. */
function clampPan(view: ZoomView, bounds: ZoomBounds): ZoomView {
  return {
    scale: view.scale,
    // `+ 0` đổi -0 thành 0 để so sánh và hiển thị không lộ "-0".
    x: clampAxis(view.x, bounds.imgW, bounds.boxW, view.scale) + 0,
    y: clampAxis(view.y, bounds.imgH, bounds.boxH, view.scale) + 0,
  };
}

/** Đổi sang mức mới mà điểm ảnh đang nằm dưới `anchor` vẫn đứng yên trên màn hình. */
function zoomAt(view: ZoomView, nextScale: number, anchor: ZoomPoint, bounds: ZoomBounds): ZoomView {
  const scale = clampScale(nextScale);
  const ratio = scale / view.scale;
  return clampPan(
    { scale, x: anchor.x - (anchor.x - view.x) * ratio, y: anchor.y - (anchor.y - view.y) * ratio },
    bounds,
  );
}

function panBy(view: ZoomView, dx: number, dy: number, bounds: ZoomBounds): ZoomView {
  return clampPan({ scale: view.scale, x: view.x + dx, y: view.y + dy }, bounds);
}

function formatZoomPercent(scale: number): string {
  return `${Math.round(scale * 100)}%`;
}

export type { ZoomBounds, ZoomPoint, ZoomView };
export {
  clampPan,
  clampScale,
  DOUBLE_CLICK_SCALE,
  FIT_VIEW,
  formatZoomPercent,
  MAX_SCALE,
  MIN_SCALE,
  panBy,
  stepScale,
  wheelFactor,
  ZOOM_STEP,
  zoomAt,
};

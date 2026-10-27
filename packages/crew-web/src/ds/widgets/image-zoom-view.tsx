// crew: tự dựng
// Zoom ảnh trong hộp xem file: hook giữ mức zoom và độ dịch, vùng ảnh nhận cuộn chuột, chụm, kéo, bấm đúp; thanh nút
// Thu nhỏ / % / Phóng to nằm ở đầu hộp. Ảnh chỉ đổi `transform`, không đổi bố cục.
import { ZoomIn, ZoomOut } from 'lucide-react';
import {
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useT } from '@/i18n';
import { Button } from '../components/button';
import {
  DOUBLE_CLICK_SCALE,
  FIT_VIEW,
  formatZoomPercent,
  MAX_SCALE,
  MIN_SCALE,
  panBy,
  stepScale,
  wheelFactor,
  type ZoomBounds,
  type ZoomPoint,
  type ZoomView,
  zoomAt,
} from './image-zoom';

interface ZoomState {
  view: ZoomView;
  /** Có chuyển động ngắn (nút, phím, bấm đúp); cuộn, kéo và chụm bám tay nên không chuyển động. */
  smooth: boolean;
}

interface ImageZoom {
  scale: number;
  smooth: boolean;
  transform: string;
  canZoomIn: boolean;
  canZoomOut: boolean;
  stageRef: RefObject<HTMLDivElement | null>;
  imgRef: RefObject<HTMLImageElement | null>;
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
  /** Cuộn/chụm/kéo: nhân mức rồi dịch, không chuyển động. */
  gesture: (factor: number, anchor: ZoomPoint, dx?: number, dy?: number) => void;
  /** Bấm đúp: đang vừa khung thì phóng quanh điểm bấm, đang zoom thì về vừa khung. */
  toggleAt: (anchor: ZoomPoint) => void;
  /** Điểm trên màn hình quy về tọa độ tính từ tâm khung. */
  toAnchor: (clientX: number, clientY: number) => ZoomPoint;
}

const CENTER: ZoomPoint = { x: 0, y: 0 };

/** `resetKey` đổi (chuyển ảnh, đóng rồi mở lại) thì về vừa khung. */
function useImageZoom(resetKey: string | null): ImageZoom {
  const stageRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [state, setState] = useState<ZoomState>({ view: FIT_VIEW, smooth: false });
  // Gesture liên tiếp đến nhanh hơn lần render, nên đọc mức hiện tại từ ref cập nhật ngay khi ghi.
  const live = useRef(state);

  const commit = useCallback((view: ZoomView, smooth: boolean) => {
    live.current = { view, smooth };
    setState(live.current);
  }, []);

  useLayoutEffect(() => {
    // Phụ thuộc resetKey: đổi khóa là đặt lại.
    void resetKey;
    commit(FIT_VIEW, false);
  }, [resetKey, commit]);

  const bounds = useCallback((): ZoomBounds => {
    const stage = stageRef.current;
    const img = imgRef.current;
    return {
      boxW: stage?.clientWidth ?? 0,
      boxH: stage?.clientHeight ?? 0,
      imgW: img?.offsetWidth ?? 0,
      imgH: img?.offsetHeight ?? 0,
    };
  }, []);

  const zoomTo = useCallback(
    (scale: number, anchor: ZoomPoint, smooth: boolean) =>
      commit(zoomAt(live.current.view, scale, anchor, bounds()), smooth),
    [bounds, commit],
  );
  const zoomIn = useCallback(() => zoomTo(stepScale(live.current.view.scale, 1), CENTER, true), [zoomTo]);
  const zoomOut = useCallback(() => zoomTo(stepScale(live.current.view.scale, -1), CENTER, true), [zoomTo]);
  const fit = useCallback(() => commit(FIT_VIEW, true), [commit]);

  const gesture = useCallback(
    (factor: number, anchor: ZoomPoint, dx = 0, dy = 0) => {
      const b = bounds();
      const zoomed = zoomAt(live.current.view, live.current.view.scale * factor, anchor, b);
      commit(panBy(zoomed, dx, dy, b), false);
    },
    [bounds, commit],
  );

  const toggleAt = useCallback(
    (anchor: ZoomPoint) => {
      if (live.current.view.scale > MIN_SCALE) commit(FIT_VIEW, true);
      else zoomTo(DOUBLE_CLICK_SCALE, anchor, true);
    },
    [commit, zoomTo],
  );

  const toAnchor = useCallback((clientX: number, clientY: number): ZoomPoint => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return CENTER;
    return { x: clientX - rect.left - rect.width / 2, y: clientY - rect.top - rect.height / 2 };
  }, []);

  const { view, smooth } = state;
  return {
    scale: view.scale,
    smooth,
    transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
    canZoomIn: view.scale < MAX_SCALE,
    canZoomOut: view.scale > MIN_SCALE,
    stageRef,
    imgRef,
    zoomIn,
    zoomOut,
    fit,
    gesture,
    toggleAt,
    toAnchor,
  };
}

/** Thanh nút zoom ở đầu hộp: nhãn % là nút về vừa khung, ẩn trên màn hẹp cho gọn. */
function ImageZoomControls({ zoom }: { zoom: ImageZoom }) {
  const { t } = useT();
  return (
    <div data-testid="attachment-viewer-zoom" className="flex items-center">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t('attachment.viewer.zoomOut')}
        title={t('attachment.viewer.zoomOut')}
        disabled={!zoom.canZoomOut}
        onClick={zoom.zoomOut}
      >
        <ZoomOut aria-hidden />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        aria-label={t('attachment.viewer.zoomFit')}
        title={t('attachment.viewer.zoomFit')}
        onClick={zoom.fit}
        className="min-w-12 px-1 tabular-nums max-sm:hidden"
      >
        {formatZoomPercent(zoom.scale)}
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t('attachment.viewer.zoomIn')}
        title={t('attachment.viewer.zoomIn')}
        disabled={!zoom.canZoomIn}
        onClick={zoom.zoomIn}
      >
        <ZoomIn aria-hidden />
      </Button>
    </div>
  );
}

interface PointerPos {
  x: number;
  y: number;
}

/** Vùng ảnh có zoom: cuộn/chụm quanh con trỏ, kéo để di khi đã zoom, hai ngón chụm, bấm đúp. */
function ZoomableImage({ zoom, children }: { zoom: ImageZoom; children: ReactNode }) {
  const { stageRef, gesture, toAnchor, toggleAt } = zoom;
  const pointers = useRef(new Map<number, PointerPos>());
  const [dragging, setDragging] = useState(false);
  const zoomed = zoom.scale > MIN_SCALE;

  // Listener wheel phải non-passive thì mới chặn được trang cuộn; React gắn wheel passive nên gắn tay.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      gesture(wheelFactor(e.deltaY, e.deltaMode, e.ctrlKey), toAnchor(e.clientX, e.clientY));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [stageRef, gesture, toAnchor]);

  const spread = (a: PointerPos, b: PointerPos) => Math.hypot(a.x - b.x, a.y - b.y);
  const middle = (a: PointerPos, b: PointerPos) => toAnchor((a.x + b.x) / 2, (a.y + b.y) / 2);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Con trỏ đã nhả trước khi bắt được: bỏ qua, các sự kiện sau tự dọn.
    }
    if (zoomed || pointers.current.size > 1) setDragging(true);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const next = { x: e.clientX, y: e.clientY };
    const others = [...pointers.current.entries()].filter(([id]) => id !== e.pointerId).map(([, p]) => p);
    pointers.current.set(e.pointerId, next);
    if (others.length > 0) {
      const other = others[0];
      const before = spread(prev, other);
      const factor = before > 0 ? spread(next, other) / before : 1;
      const from = middle(prev, other);
      const to = middle(next, other);
      // Phóng quanh điểm giữa cũ rồi dịch theo độ lệch: điểm ảnh dưới hai ngón đi đúng theo ngón, không trôi theo (1 - hệ số).
      gesture(factor, from, to.x - from.x, to.y - from.y);
    } else if (zoomed) {
      gesture(1, CENTER, next.x - prev.x, next.y - prev.y);
    }
  };

  const onPointerEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) setDragging(false);
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: cử chỉ con trỏ chỉ là đường tắt; zoom đã có nút và phím + - 0 ở hộp.
    <div
      ref={stageRef}
      data-testid="attachment-viewer-stage"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onDoubleClick={(e) => toggleAt(toAnchor(e.clientX, e.clientY))}
      className={`flex h-full touch-none items-center justify-center overflow-hidden p-2 select-none md:p-4 ${
        dragging ? 'cursor-grabbing' : zoomed ? 'cursor-grab' : ''
      }`}
    >
      {children}
    </div>
  );
}

export type { ImageZoom };
export { ImageZoomControls, useImageZoom, ZoomableImage };

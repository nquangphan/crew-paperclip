// crew: tự dựng
// Phần nặng của bản đồ Roadmap (nạp lười): xyflow + chuyển động camera.
// Vào tầng: tầng mới dựng với tâm ở gốc, camera đặt tức thì ở tâm (phóng 2.4, trông y như nút vừa bấm) rồi thu ra vừa
// màn hình; nút con bay từ tâm ra. Lùi tầng: camera đặt ở nút vừa rời rồi thu ra, focus trả về nút đó. Bấm nút đi sâu:
// nút khác mờ đi, camera phóng vào nút (Promise) rồi mới báo trang đổi tầng. Hiệu ứng gắn theo `levelKey`, không theo cú
// bấm, nên deep link và nút Back trình duyệt cũng chạy.
// Dây nối cong mềm; dây "đang chạy" (`runningEdgeIds`) có vạch chạy và hạt sáng đi theo dây bằng CSS (stroke-dashoffset),
// không render lại React mỗi khung hình; prefers-reduced-motion thì bỏ lớp chạy, giữ màu.
import {
  Background,
  BackgroundVariant,
  Controls,
  type Edge,
  MarkerType,
  type Node,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '@/i18n';
import { cn } from '../../cn';
import type { RoadmapCanvasProps } from './roadmap-canvas';
import {
  cssEscape,
  EDGE_MARKER_COLOR,
  EDGE_TYPES,
  type EdgeData,
  motionMs,
  NODE_TYPES,
  type NodeData,
  useColorMode,
  useReducedMotion,
} from './roadmap-flow-parts';
import {
  layoutLevel,
  MAX_FIT_ZOOM,
  pairFocus,
  READABLE_ZOOM,
  readableView,
  roadmapNodeSize,
  runningEdgeIds,
} from './roadmap-layout';
import { RoadmapLegend } from './roadmap-legend';
import type { RoadmapNode } from './roadmap-types';

/** Độ phóng khi camera lao vào một nút. */
const DIVE_ZOOM = 2.4;
/** Chừa chỗ cho gợi ý (trên) và nút điều khiển (phải). */
const PADDING = { top: 52, right: 64, bottom: 24, left: 24 } as const;
/** Nút "Vừa màn hình": cho thấy cả tầng, kể cả khi phải thu nhỏ dưới mức đọc được. */
const FIT = {
  padding: {
    top: `${PADDING.top}px`,
    right: `${PADDING.right}px`,
    bottom: `${PADDING.bottom}px`,
    left: `${PADDING.left}px`,
  },
  maxZoom: MAX_FIT_ZOOM,
} as const;
/** Số khung hình chờ nút hiện ra (xyflow ẩn nút tới khi đo xong) trước khi đặt focus. */
const FOCUS_TRIES = 60;
/** Bấm nút loại này (không phải tâm) thì camera lao vào trước khi đổi tầng. */
const DIVES = new Set<RoadmapNode['kind']>(['project', 'request', 'docs', 'folder']);
/** Nhiều nút thì chỉ vẽ phần đang thấy. */
const VISIBLE_ONLY_ABOVE = 80;

function Flow({ level, levelKey, direction, focusId, onOpen, labels, size = 'page', legend }: RoadmapCanvasProps) {
  const { t } = useT();
  const rf = useReactFlow();
  const wrap = useRef<HTMLDivElement>(null);
  const colorMode = useColorMode(wrap);
  const [diving, setDiving] = useState<string | null>(null);
  const busy = useRef(false);
  const positions = useMemo(() => layoutLevel(level), [level]);
  const reducedMotion = useReducedMotion();
  const animate = direction === 'in' && !reducedMotion;
  const topDown = level.layout === 'top-down';
  const running = useMemo(() => runningEdgeIds(level), [level]);
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  const activate = useCallback(
    (node: RoadmapNode, center: boolean) => {
      if (busy.current) return;
      const p = positions[node.id];
      if (center || !DIVES.has(node.kind) || !p) {
        onOpenRef.current(node);
        return;
      }
      busy.current = true;
      setDiving(node.id);
      void rf
        .setCenter(p.x, p.y, { zoom: DIVE_ZOOM, duration: motionMs('--roadmap-zoom-in', 450) })
        .then(() => onOpenRef.current(node))
        .finally(() => {
          // Trang không đổi tầng (ví dụ lỗi): mở khóa sau một nhịp để không kẹt.
          window.setTimeout(() => {
            busy.current = false;
            setDiving(null);
          }, 1500);
        });
    },
    [positions, rf],
  );

  const all = useMemo(() => [level.center, ...level.nodes], [level]);
  const nodes = useMemo<Node<NodeData>[]>(
    () =>
      all.map((node, i) => {
        const p = positions[node.id] ?? { x: 0, y: 0 };
        const center = i === 0;
        return {
          id: node.id,
          type: 'roadmap',
          position: p,
          data: {
            node,
            center,
            dimmed: diving !== null && !center && node.id !== diving,
            enter: animate && !center ? { fromX: -p.x, fromY: -p.y, delay: Math.min(i * 18, 500) } : null,
            onActivate: activate,
          },
          draggable: false,
          selectable: false,
          focusable: false,
          connectable: false,
        };
      }),
    [all, positions, diving, animate, activate],
  );
  const edges = useMemo<Edge<EdgeData>[]>(
    () =>
      level.edges.map((edge, i) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: edge.kind,
        markerEnd: EDGE_MARKER_COLOR[edge.kind]
          ? { type: MarkerType.ArrowClosed, color: EDGE_MARKER_COLOR[edge.kind], width: 16, height: 16 }
          : undefined,
        data: {
          enterDelay: animate ? 250 + Math.min(i * 10, 400) : null,
          running: running.has(edge.id),
          flow: !reducedMotion,
          topDown,
        },
        focusable: false,
        selectable: false,
        // Cạnh chỉ để nhìn: quan hệ đã nằm trong nhãn nút và dạng danh sách.
        ariaRole: 'presentation',
        // domAttributes trải sau nhãn mặc định "Edge from …" (tiếng Anh) nên ghi đè được nó.
        domAttributes: { 'aria-hidden': true, 'aria-label': undefined, 'aria-roledescription': undefined },
      })),
    [level.edges, animate, running, reducedMotion, topDown],
  );

  // Vào tầng kèm nút chọn sẵn (bản đồ Crew: việc đang xem): canh cả tâm lẫn nút đó khi vừa, không thì canh vào nút.
  // Cây trên xuống không vừa khung: gốc nằm sát mép trên (cây mọc xuống), không phải giữa khung.
  const entryFocus = useCallback(
    (size: { width: number; height: number }) => {
      if (direction === 'in' && focusId && positions[focusId])
        return pairFocus(level, positions, size, PADDING, focusId);
      if (!topDown) return undefined;
      const rootH = roadmapNodeSize(level.center, true).h;
      const availH = Math.max(1, size.height - PADDING.top - PADDING.bottom);
      return { x: 0, y: -rootH / 2 - 16 + availH / (2 * READABLE_ZOOM) };
    },
    [direction, focusId, positions, level, topDown],
  );

  // Camera theo tầng: chỉ chạy khi đổi tầng, cập nhật trực tiếp (cùng tầng) không làm bản đồ nhảy.
  const shownKey = useRef<string | null>(null);
  useEffect(() => {
    if (shownKey.current === levelKey) return;
    shownKey.current = levelKey;
    busy.current = false;
    setDiving(null);
    const zoomOut = motionMs('--roadmap-zoom-out', 650);
    const anchor = direction === 'out' && focusId ? (positions[focusId] ?? { x: 0, y: 0 }) : { x: 0, y: 0 };
    // Lùi tầng: focus về nút vừa rời. Vào tầng có `focusId` (bản đồ Crew: việc đang xem): camera thu ra quanh nút đó.
    const focusTarget = focusId && positions[focusId] ? focusId : level.center.id;
    const run = async () => {
      if (direction !== 'none') await rf.setCenter(anchor.x, anchor.y, { zoom: DIVE_ZOOM, duration: 0 });
      // Thu ra tới độ phóng còn đọc được chữ, tâm ở nút đang focus; tầng lớn hơn khung thì kéo để xem phần còn lại.
      const box = wrap.current;
      const size = { width: box?.clientWidth ?? 0, height: box?.clientHeight ?? 0 };
      const preferred = focusTarget === level.center.id || direction === 'in' ? entryFocus(size) : undefined;
      const view = readableView(level, positions, size, PADDING, preferred ?? positions[focusTarget]);
      const fitted = rf.setCenter(view.x, view.y, { zoom: view.zoom, duration: direction === 'none' ? 0 : zoomOut });
      let tries = 0;
      const focus = () => {
        const el = wrap.current?.querySelector<HTMLElement>(`[data-roadmap-id="${cssEscape(focusTarget)}"]`);
        el?.focus({ preventScroll: true });
        if (document.activeElement !== el && ++tries < FOCUS_TRIES) window.requestAnimationFrame(focus);
      };
      window.requestAnimationFrame(focus);
      await fitted;
    };
    void run();
  }, [levelKey, direction, focusId, positions, level, rf, entryFocus]);

  // Cùng tầng mà tập nút đổi (dữ liệu live, nút Docs tải xong): vừa lại màn hình nhẹ nhàng để không nút nào khuất.
  const shape = useMemo(() => all.map((n) => n.id).join('|'), [all]);
  const shownShape = useRef<{ key: string; shape: string } | null>(null);
  useEffect(() => {
    const prev = shownShape.current;
    shownShape.current = { key: levelKey, shape };
    if (!prev || prev.key !== levelKey || prev.shape === shape || busy.current) return;
    const box = wrap.current;
    const size = { width: box?.clientWidth ?? 0, height: box?.clientHeight ?? 0 };
    const view = readableView(level, positions, size, PADDING, entryFocus(size));
    void rf.setCenter(view.x, view.y, { zoom: view.zoom, duration: motionMs('--roadmap-zoom-in', 300) });
    // Chạy lại khi dữ liệu đổi nhưng chỉ dời camera khi tập nút (shape) đổi trong cùng tầng.
  }, [levelKey, shape, level, positions, rf, entryFocus]);

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={wrap}
        data-slot="roadmap-canvas"
        data-level={levelKey}
        className={cn(
          'roadmap-canvas relative w-full overflow-hidden rounded-xl border',
          size === 'page' ? 'h-[calc(100dvh-17rem)] min-h-[24rem]' : 'h-[min(34rem,70dvh)] min-h-[20rem]',
        )}
      >
        <ReactFlow
          className="roadmap-flow"
          aria-label={labels.canvas}
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          nodeOrigin={[0.5, 0.5]}
          colorMode={colorMode}
          nodesDraggable={false}
          nodesConnectable={false}
          nodesFocusable={false}
          edgesFocusable={false}
          elementsSelectable={false}
          autoPanOnNodeFocus={false}
          zoomOnDoubleClick={false}
          onlyRenderVisibleElements={all.length > VISIBLE_ONLY_ABOVE}
          minZoom={0.1}
          maxZoom={3}
          proOptions={{ hideAttribution: true }}
          ariaLabelConfig={{
            'controls.ariaLabel': t('roadmap.controls.label'),
            'controls.zoomIn.ariaLabel': t('roadmap.controls.zoomIn'),
            'controls.zoomOut.ariaLabel': t('roadmap.controls.zoomOut'),
            'controls.fitView.ariaLabel': t('roadmap.controls.fit'),
          }}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} color="var(--roadmap-dot)" />
          <Controls
            showInteractive={false}
            position="bottom-right"
            fitViewOptions={{ ...FIT, duration: motionMs('--roadmap-zoom-in', 300) }}
          />
        </ReactFlow>
        {labels.hint ? (
          <p className="pointer-events-none absolute top-2.5 left-2.5 z-10 hidden max-w-[70%] truncate rounded-full border bg-(--roadmap-card) px-3 py-1 text-[11px] text-muted-foreground shadow-sm backdrop-blur-sm sm:block">
            {labels.hint}
          </p>
        ) : null}
      </div>
      {/* Chú giải nằm dưới khung bản đồ nên không bao giờ che nút. */}
      <RoadmapLegend edges={legend?.edges} current={legend?.current} />
    </div>
  );
}

function RoadmapFlow(props: RoadmapCanvasProps) {
  return (
    <ReactFlowProvider>
      <Flow {...props} />
    </ReactFlowProvider>
  );
}

export default RoadmapFlow;

// crew: tự dựng
// Phần nặng của bản đồ Roadmap (nạp lười): xyflow + chuyển động camera.
// Vào tầng: tầng mới dựng với tâm ở gốc, camera đặt tức thì ở tâm (phóng 2.4, trông y như nút vừa bấm) rồi thu ra vừa
// màn hình; nút con bay từ tâm ra. Lùi tầng: camera đặt ở nút vừa rời rồi thu ra, focus trả về nút đó. Bấm nút đi sâu:
// nút khác mờ đi, camera phóng vào nút (Promise) rồi mới báo trang đổi tầng. Hiệu ứng gắn theo `levelKey`, không theo cú
// bấm, nên deep link và nút Back trình duyệt cũng chạy.
import {
  Controls,
  type Edge,
  type EdgeProps,
  Handle,
  MarkerType,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useInternalNode,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { type CSSProperties, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '@/i18n';
import { cn } from '../../cn';
import type { RoadmapCanvasProps } from './roadmap-canvas';
import { layoutLevel, MAX_FIT_ZOOM, pairFocus, readableView } from './roadmap-layout';
import { RoadmapLegend } from './roadmap-legend';
import { RoadmapNodeButton } from './roadmap-node';
import type { RoadmapEdgeKind, RoadmapNode, RoadmapPoint } from './roadmap-types';

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

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

function motionMs(name: string, fallback: number): number {
  if (prefersReducedMotion()) return 0;
  const raw = typeof document === 'undefined' ? '' : getComputedStyle(document.documentElement).getPropertyValue(name);
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : fallback;
}

/** Theme hiện tại theo class `dark` của tổ tiên gần nhất (đổi theme thì cập nhật). */
function useColorMode(ref: RefObject<HTMLElement | null>): 'light' | 'dark' {
  const [mode, setMode] = useState<'light' | 'dark'>('light');
  useEffect(() => {
    const read = () => setMode(ref.current?.closest('.dark') ? 'dark' : 'light');
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'], subtree: false });
    return () => observer.disconnect();
  }, [ref]);
  return mode;
}

const cssEscape = (v: string) =>
  typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(v) : v.replace(/["\\]/g, '\\$&');

interface NodeData extends Record<string, unknown> {
  node: RoadmapNode;
  center: boolean;
  dimmed: boolean;
  enter: { fromX: number; fromY: number; delay: number } | null;
  onActivate: (node: RoadmapNode, center: boolean) => void;
}

/** Điểm nối ẩn ở giữa nút: cạnh tự tính đầu mút từ khung nút nên không cần vị trí thật. */
const HIDDEN_HANDLE: CSSProperties = { left: '50%', top: '50%', opacity: 0, pointerEvents: 'none' };

function FlowNode({ data }: NodeProps<Node<NodeData>>) {
  return (
    <>
      <Handle type="target" position={Position.Top} isConnectable={false} style={HIDDEN_HANDLE} />
      <RoadmapNodeButton
        node={data.node}
        center={data.center}
        dimmed={data.dimmed}
        enter={data.enter}
        onActivate={() => data.onActivate(data.node, data.center)}
      />
      <Handle type="source" position={Position.Bottom} isConnectable={false} style={HIDDEN_HANDLE} />
    </>
  );
}

interface EdgeData extends Record<string, unknown> {
  enterDelay: number | null;
}

/** Điểm trên viền khung (w×h, tâm c) nằm trên đoạn từ c tới `toward`. */
function clipToBox(c: RoadmapPoint, w: number, h: number, toward: RoadmapPoint): RoadmapPoint {
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (!dx && !dy) return c;
  const s = Math.min(dx ? w / 2 / Math.abs(dx) : Number.POSITIVE_INFINITY, dy ? h / 2 / Math.abs(dy) : Infinity);
  return s >= 1 ? c : { x: c.x + dx * s, y: c.y + dy * s };
}

interface NodeBox {
  /** Tâm khung nút (đơn vị bản đồ). */
  c: RoadmapPoint;
  w: number;
  h: number;
}

function useNodeBox(id: string): NodeBox | null {
  const internal = useInternalNode(id);
  if (!internal) return null;
  const w = internal.measured.width ?? 0;
  const h = internal.measured.height ?? 0;
  const p = internal.internals.positionAbsolute;
  return { c: { x: p.x + w / 2, y: p.y + h / 2 }, w, h };
}

/** Nét của từng loại cạnh (chú giải dùng cùng màu và kiểu nét). */
const EDGE_CLASS: Record<RoadmapEdgeKind, string> = {
  parent: 'stroke-muted-foreground/40!',
  blocks: 'stroke-primary! [stroke-dasharray:6_5]',
  repair: 'stroke-(--roadmap-edge-repair)! [stroke-dasharray:2_4]',
};
const EDGE_MARKER_COLOR: Partial<Record<RoadmapEdgeKind, string>> = {
  blocks: 'var(--primary)',
  repair: 'var(--roadmap-edge-repair)',
};
const isEdgeKind = (v: string | undefined): v is RoadmapEdgeKind => !!v && v in EDGE_CLASS;

/** Đường cong nhẹ giữa viền hai nút (`side` đổi phía cong để hai loại cạnh giữa cùng cặp nút không trùng nhau). */
function curve(a: NodeBox, b: NodeBox, side: 1 | -1) {
  const from = clipToBox(a.c, a.w + 8, a.h + 8, b.c);
  const to = clipToBox(b.c, b.w + 8, b.h + 8, a.c);
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;
  const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  const bend = side * Math.min(60, len * 0.15);
  const cx = mx - ((to.y - from.y) / len) * bend;
  const cy = my + ((to.x - from.x) / len) * bend;
  return `M ${from.x},${from.y} Q ${cx},${cy} ${to.x},${to.y}`;
}

/** Vòng tự quay về chính nút (việc đã qua vòng sửa): cung nhỏ ở góc trên phải của thẻ. */
function selfLoop(a: NodeBox) {
  const x = a.c.x + a.w / 2 - 24;
  const y = a.c.y - a.h / 2 - 4;
  return `M ${x},${y} C ${x - 6},${y - 40} ${x + 52},${y - 34} ${x + 28},${y - 2}`;
}

function FlowEdge({ id, source, target, markerEnd, data, type }: EdgeProps<Edge<EdgeData>>) {
  const a = useNodeBox(source);
  const b = useNodeBox(target);
  if (!a || !b) return null;
  const kind: RoadmapEdgeKind = isEdgeKind(type) ? type : 'parent';
  let d: string;
  if (kind === 'parent') d = `M ${a.c.x},${a.c.y} L ${b.c.x},${b.c.y}`;
  else if (source === target) d = selfLoop(a);
  // Cạnh chặn/vòng sửa: cong nhẹ để không trùng cạnh cha-con, mũi tên chạm viền nút đích.
  else d = curve(a, b, kind === 'blocks' ? 1 : -1);
  const style: CSSProperties & Record<string, string> = {};
  if (data?.enterDelay != null) style['--enter-delay'] = `${data.enterDelay}ms`;
  return (
    <path
      id={id}
      d={d}
      data-edge-kind={kind}
      aria-hidden
      fill="none"
      markerEnd={kind === 'parent' ? undefined : markerEnd}
      style={style}
      className={cn(
        'react-flow__edge-path stroke-2',
        EDGE_CLASS[kind],
        data?.enterDelay != null && 'roadmap-edge-enter',
      )}
    />
  );
}

const NODE_TYPES = { roadmap: FlowNode };
const EDGE_TYPES: Record<RoadmapEdgeKind, typeof FlowEdge> = { parent: FlowEdge, blocks: FlowEdge, repair: FlowEdge };

function Flow({ level, levelKey, direction, focusId, onOpen, labels, size = 'page', legend }: RoadmapCanvasProps) {
  const { t } = useT();
  const rf = useReactFlow();
  const wrap = useRef<HTMLDivElement>(null);
  const colorMode = useColorMode(wrap);
  const [diving, setDiving] = useState<string | null>(null);
  const busy = useRef(false);
  const positions = useMemo(() => layoutLevel(level), [level]);
  const animate = direction === 'in' && !prefersReducedMotion();
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
          ? { type: MarkerType.ArrowClosed, color: EDGE_MARKER_COLOR[edge.kind] }
          : undefined,
        data: { enterDelay: animate ? 250 + Math.min(i * 10, 400) : null },
        focusable: false,
        selectable: false,
        // Cạnh chỉ để nhìn: quan hệ đã nằm trong nhãn nút và dạng danh sách.
        ariaRole: 'presentation',
        // domAttributes trải sau nhãn mặc định "Edge from …" (tiếng Anh) nên ghi đè được nó.
        domAttributes: { 'aria-hidden': true, 'aria-label': undefined, 'aria-roledescription': undefined },
      })),
    [level.edges, animate],
  );

  // Vào tầng kèm nút chọn sẵn (bản đồ Crew: việc đang xem): canh cả tâm lẫn nút đó khi vừa, không thì canh vào nút.
  const entryFocus = useCallback(
    (size: { width: number; height: number }) =>
      direction === 'in' && focusId && positions[focusId]
        ? pairFocus(level, positions, size, PADDING, focusId)
        : undefined,
    [direction, focusId, positions, level],
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
      const view = readableView(level, positions, size, PADDING, entryFocus(size) ?? positions[focusTarget]);
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
          'relative w-full overflow-hidden rounded-lg border bg-background',
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
          <Controls
            showInteractive={false}
            position="bottom-right"
            fitViewOptions={{ ...FIT, duration: motionMs('--roadmap-zoom-in', 300) }}
          />
        </ReactFlow>
        {labels.hint ? (
          <p className="pointer-events-none absolute top-2 left-2 hidden max-w-[70%] truncate rounded-full border bg-card/95 px-3 py-1 text-xs text-muted-foreground shadow-sm sm:block">
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

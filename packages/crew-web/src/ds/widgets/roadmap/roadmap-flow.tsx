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

/** Theo dõi prefers-reduced-motion (đổi trong hệ thống thì cập nhật) để bỏ lớp chạy trên dây. */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);
  useEffect(() => {
    const mq = typeof window === 'undefined' ? undefined : window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return;
    const read = () => setReduced(mq.matches);
    read();
    mq.addEventListener?.('change', read);
    return () => mq.removeEventListener?.('change', read);
  }, []);
  return reduced;
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
  /** Một đầu (hoặc nhánh đích của cạnh cha-con) đang làm. */
  running: boolean;
  /** Vẽ lớp chạy (vạch + hạt sáng); tắt khi prefers-reduced-motion. */
  flow: boolean;
  /** Tầng vẽ cây trên xuống: dây cha-con đi từ đáy cha tới đỉnh con. */
  topDown: boolean;
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

/** Màu mũi tên theo loại cạnh (nét vẽ ở class `.roadmap-edge` trong tokens.css, chú giải dùng cùng màu và kiểu nét). */
const EDGE_MARKER_COLOR: Partial<Record<RoadmapEdgeKind, string>> = {
  blocks: 'var(--roadmap-edge-blocks)',
  repair: 'var(--roadmap-edge-repair)',
};
const EDGE_KINDS: readonly RoadmapEdgeKind[] = ['parent', 'blocks', 'repair'];
const isEdgeKind = (v: string | undefined): v is RoadmapEdgeKind => EDGE_KINDS.includes(v as RoadmapEdgeKind);

const pt = (p: RoadmapPoint) => `${Math.round(p.x * 10) / 10},${Math.round(p.y * 10) / 10}`;

/** Dây cha-con của cây trên xuống: từ giữa đáy thẻ cha tới giữa đỉnh thẻ con, cong chữ S theo chiều dọc. */
function verticalCurve(a: NodeBox, b: NodeBox) {
  const from = { x: a.c.x, y: a.c.y + a.h / 2 };
  const to = { x: b.c.x, y: b.c.y - b.h / 2 };
  const k = Math.max(24, Math.abs(to.y - from.y) / 2);
  return `M ${pt(from)} C ${pt({ x: from.x, y: from.y + k })} ${pt({ x: to.x, y: to.y - k })} ${pt(to)}`;
}

/**
 * Dây cha-con của bố cục tỏa tròn: ra từ cạnh thẻ quay về phía nút kia (trên/dưới hoặc trái/phải, theo trục lệch nhiều
 * hơn), cong chữ S mềm theo trục đó.
 */
function portCurve(a: NodeBox, b: NodeBox) {
  const dx = b.c.x - a.c.x;
  const dy = b.c.y - a.c.y;
  if (Math.abs(dy) * 1.2 >= Math.abs(dx)) {
    const s = Math.sign(dy) || 1;
    const from = { x: a.c.x, y: a.c.y + (s * a.h) / 2 };
    const to = { x: b.c.x, y: b.c.y - (s * b.h) / 2 };
    const k = (to.y - from.y) / 2;
    return `M ${pt(from)} C ${pt({ x: from.x, y: from.y + k })} ${pt({ x: to.x, y: to.y - k })} ${pt(to)}`;
  }
  const s = Math.sign(dx) || 1;
  const from = { x: a.c.x + (s * a.w) / 2, y: a.c.y };
  const to = { x: b.c.x - (s * b.w) / 2, y: b.c.y };
  const k = (to.x - from.x) / 2;
  return `M ${pt(from)} C ${pt({ x: from.x + k, y: from.y })} ${pt({ x: to.x - k, y: to.y })} ${pt(to)}`;
}

/**
 * Cạnh chặn/vòng sửa giữa hai thẻ cùng hàng của cây trên xuống: võng xuống dưới hàng (đáy thẻ này sang đáy thẻ kia) để
 * không cắt ngang thẻ ở giữa; vòng sửa võng sâu hơn để hai loại không trùng nhau.
 */
function underCurve(a: NodeBox, b: NodeBox, depth: number) {
  // Lệch đầu mút một phần tư bề ngang thẻ về phía nút kia: không đè dây cha-con đi ra từ giữa đáy thẻ.
  const dir = Math.sign(b.c.x - a.c.x) || 1;
  const from = { x: a.c.x + (dir * a.w) / 4, y: a.c.y + a.h / 2 };
  const to = { x: b.c.x - (dir * b.w) / 4, y: b.c.y + b.h / 2 };
  const y = Math.max(from.y, to.y) + depth;
  return `M ${pt(from)} C ${pt({ x: from.x, y })} ${pt({ x: to.x, y })} ${pt({ x: to.x, y: to.y + 6 })}`;
}

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

function edgePath(kind: RoadmapEdgeKind, a: NodeBox, b: NodeBox, self: boolean, topDown: boolean): string {
  if (self) return selfLoop(a);
  if (kind === 'parent') return topDown ? verticalCurve(a, b) : portCurve(a, b);
  // Cạnh chặn/vòng sửa: cong để không trùng cạnh cha-con, mũi tên chạm viền nút đích.
  if (topDown && Math.abs(a.c.y - b.c.y) < (a.h + b.h) / 4) return underCurve(a, b, kind === 'blocks' ? 44 : 68);
  return curve(a, b, kind === 'blocks' ? 1 : -1);
}

function FlowEdge({ id, source, target, markerEnd, data, type }: EdgeProps<Edge<EdgeData>>) {
  const a = useNodeBox(source);
  const b = useNodeBox(target);
  if (!a || !b) return null;
  const kind: RoadmapEdgeKind = isEdgeKind(type) ? type : 'parent';
  const d = edgePath(kind, a, b, source === target, !!data?.topDown);
  const running = !!data?.running;
  const style: CSSProperties & Record<string, string> = {};
  if (data?.enterDelay != null) style['--enter-delay'] = `${data.enterDelay}ms`;
  return (
    <g aria-hidden style={style} className={cn(data?.enterDelay != null && 'roadmap-edge-enter')}>
      <path
        id={id}
        d={d}
        data-edge-kind={kind}
        data-running={running || undefined}
        markerEnd={kind === 'parent' ? undefined : markerEnd}
        className="roadmap-edge"
      />
      {running && data?.flow ? (
        <>
          <path d={d} data-edge-flow="" className="roadmap-edge-flow" />
          <path d={d} pathLength={100} data-edge-flow="" className="roadmap-edge-spark" />
        </>
      ) : null}
    </g>
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
      <RoadmapLegend
        edges={legend?.edges}
        current={legend?.current}
        jev={Boolean(level.center.jev) || level.nodes.some((n) => n.jev)}
        jevComplexity={Boolean(level.center.jevComplexity) || level.nodes.some((n) => n.jevComplexity)}
      />
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

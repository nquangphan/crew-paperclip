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
import { layoutLevel, MAX_FIT_ZOOM, readableView } from './roadmap-layout';
import { RoadmapLegend } from './roadmap-legend';
import { RoadmapNodeButton } from './roadmap-node';
import type { RoadmapNode, RoadmapPoint } from './roadmap-types';

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

function useNodeBox(id: string) {
  const internal = useInternalNode(id);
  if (!internal) return null;
  const w = internal.measured.width ?? 0;
  const h = internal.measured.height ?? 0;
  const p = internal.internals.positionAbsolute;
  return { c: { x: p.x + w / 2, y: p.y + h / 2 }, w, h };
}

function FlowEdge({ id, source, target, markerEnd, data, type }: EdgeProps<Edge<EdgeData>>) {
  const a = useNodeBox(source);
  const b = useNodeBox(target);
  if (!a || !b) return null;
  const blocks = type === 'blocks';
  let d: string;
  if (blocks) {
    // Cạnh chặn: cong nhẹ để không trùng cạnh cha-con, mũi tên chạm viền nút đích.
    const from = clipToBox(a.c, a.w + 8, a.h + 8, b.c);
    const to = clipToBox(b.c, b.w + 8, b.h + 8, a.c);
    const mx = (from.x + to.x) / 2;
    const my = (from.y + to.y) / 2;
    const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
    const bend = Math.min(60, len * 0.15);
    const cx = mx - ((to.y - from.y) / len) * bend;
    const cy = my + ((to.x - from.x) / len) * bend;
    d = `M ${from.x},${from.y} Q ${cx},${cy} ${to.x},${to.y}`;
  } else {
    d = `M ${a.c.x},${a.c.y} L ${b.c.x},${b.c.y}`;
  }
  const style: CSSProperties & Record<string, string> = {};
  if (data?.enterDelay != null) style['--enter-delay'] = `${data.enterDelay}ms`;
  return (
    <path
      id={id}
      d={d}
      data-edge-kind={blocks ? 'blocks' : 'parent'}
      aria-hidden
      fill="none"
      markerEnd={blocks ? markerEnd : undefined}
      style={style}
      className={cn(
        'react-flow__edge-path stroke-2',
        blocks ? 'stroke-primary! [stroke-dasharray:6_5]' : 'stroke-muted-foreground/40!',
        data?.enterDelay != null && 'roadmap-edge-enter',
      )}
    />
  );
}

const NODE_TYPES = { roadmap: FlowNode };
const EDGE_TYPES = { parent: FlowEdge, blocks: FlowEdge };

function Flow({ level, levelKey, direction, focusId, onOpen, labels }: RoadmapCanvasProps) {
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
        markerEnd: edge.kind === 'blocks' ? { type: MarkerType.ArrowClosed, color: 'var(--primary)' } : undefined,
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

  // Camera theo tầng: chỉ chạy khi đổi tầng, cập nhật trực tiếp (cùng tầng) không làm bản đồ nhảy.
  const shownKey = useRef<string | null>(null);
  useEffect(() => {
    if (shownKey.current === levelKey) return;
    shownKey.current = levelKey;
    busy.current = false;
    setDiving(null);
    const zoomOut = motionMs('--roadmap-zoom-out', 650);
    const anchor = direction === 'out' && focusId ? (positions[focusId] ?? { x: 0, y: 0 }) : { x: 0, y: 0 };
    const focusTarget = direction === 'out' && focusId && positions[focusId] ? focusId : level.center.id;
    const run = async () => {
      if (direction !== 'none') await rf.setCenter(anchor.x, anchor.y, { zoom: DIVE_ZOOM, duration: 0 });
      // Thu ra tới độ phóng còn đọc được chữ, tâm ở nút đang focus; tầng lớn hơn khung thì kéo để xem phần còn lại.
      const box = wrap.current;
      const view = readableView(
        level,
        positions,
        { width: box?.clientWidth ?? 0, height: box?.clientHeight ?? 0 },
        PADDING,
        positions[focusTarget],
      );
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
  }, [levelKey, direction, focusId, positions, level, rf]);

  // Cùng tầng mà tập nút đổi (dữ liệu live, nút Docs tải xong): vừa lại màn hình nhẹ nhàng để không nút nào khuất.
  const shape = useMemo(() => all.map((n) => n.id).join('|'), [all]);
  const shownShape = useRef<{ key: string; shape: string } | null>(null);
  useEffect(() => {
    const prev = shownShape.current;
    shownShape.current = { key: levelKey, shape };
    if (!prev || prev.key !== levelKey || prev.shape === shape || busy.current) return;
    const box = wrap.current;
    const view = readableView(
      level,
      positions,
      { width: box?.clientWidth ?? 0, height: box?.clientHeight ?? 0 },
      PADDING,
    );
    void rf.setCenter(view.x, view.y, { zoom: view.zoom, duration: motionMs('--roadmap-zoom-in', 300) });
    // Chạy lại khi dữ liệu đổi nhưng chỉ dời camera khi tập nút (shape) đổi trong cùng tầng.
  }, [levelKey, shape, level, positions, rf]);

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={wrap}
        data-slot="roadmap-canvas"
        data-level={levelKey}
        className="relative h-[calc(100dvh-17rem)] min-h-[24rem] w-full overflow-hidden rounded-lg border bg-background"
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
      <RoadmapLegend />
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

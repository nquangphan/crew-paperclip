// crew: tự dựng
// Phần dùng chung của mọi bản đồ vẽ bằng xyflow (bản đồ Crew ở trang issue và Roadmap một trang): nút (thẻ), dây
// (cha-con, chặn, vòng sửa, lớp chạy), đường cong `edgePath`, theo dõi giảm chuyển động và theme. Hai canvas dùng đúng
// bộ này nên thẻ, đường nối và chuyển động giống hệt nhau.
import { type Edge, type EdgeProps, Handle, type Node, type NodeProps, Position, useInternalNode } from '@xyflow/react';
import { type CSSProperties, type RefObject, useEffect, useState } from 'react';
import { cn } from '../../cn';
import { RoadmapNodeButton } from './roadmap-node';
import type { RoadmapEdgeKind, RoadmapNode, RoadmapPoint } from './roadmap-types';

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/** Theo dõi prefers-reduced-motion (đổi trong hệ thống thì cập nhật) để bỏ lớp chạy trên dây. */
export function useReducedMotion(): boolean {
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

export function motionMs(name: string, fallback: number): number {
  if (prefersReducedMotion()) return 0;
  const raw = typeof document === 'undefined' ? '' : getComputedStyle(document.documentElement).getPropertyValue(name);
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : fallback;
}

/** Theme hiện tại theo class `dark` của tổ tiên gần nhất (đổi theme thì cập nhật). */
export function useColorMode(ref: RefObject<HTMLElement | null>): 'light' | 'dark' {
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

export const cssEscape = (v: string) =>
  typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(v) : v.replace(/["\\]/g, '\\$&');

export interface NodeData extends Record<string, unknown> {
  node: RoadmapNode;
  center: boolean;
  dimmed: boolean;
  /** Ngoài mục đang xem: mờ nhưng vẫn bấm được (Roadmap một trang). */
  faded?: boolean;
  enter: { fromX: number; fromY: number; delay: number } | null;
  onActivate: (node: RoadmapNode, center: boolean) => void;
}

/** Điểm nối ẩn ở giữa nút: cạnh tự tính đầu mút từ khung nút nên không cần vị trí thật. */
const HIDDEN_HANDLE: CSSProperties = { left: '50%', top: '50%', opacity: 0, pointerEvents: 'none' };

export function FlowNode({ data }: NodeProps<Node<NodeData>>) {
  return (
    <>
      <Handle type="target" position={Position.Top} isConnectable={false} style={HIDDEN_HANDLE} />
      <RoadmapNodeButton
        node={data.node}
        center={data.center}
        dimmed={data.dimmed}
        faded={data.faded}
        enter={data.enter}
        onActivate={() => data.onActivate(data.node, data.center)}
      />
      <Handle type="source" position={Position.Bottom} isConnectable={false} style={HIDDEN_HANDLE} />
    </>
  );
}

export interface EdgeData extends Record<string, unknown> {
  enterDelay: number | null;
  /** Một đầu (hoặc nhánh đích của cạnh cha-con) đang làm. */
  running: boolean;
  /** Vẽ lớp chạy (vạch + hạt sáng); tắt khi prefers-reduced-motion. */
  flow: boolean;
  /** Tầng vẽ cây trên xuống: dây cha-con đi từ đáy cha tới đỉnh con. */
  topDown: boolean;
  /** Hộp hai đầu đã biết (Roadmap một trang tính sẵn vị trí): không chờ xyflow đo nút, kể cả nút ngoài khung. */
  boxes?: { a: NodeBox; b: NodeBox };
  /** Ngoài mục đang xem: mờ. */
  faded?: boolean;
}

/** Điểm trên viền khung (w×h, tâm c) nằm trên đoạn từ c tới `toward`. */
function clipToBox(c: RoadmapPoint, w: number, h: number, toward: RoadmapPoint): RoadmapPoint {
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (!dx && !dy) return c;
  const s = Math.min(dx ? w / 2 / Math.abs(dx) : Number.POSITIVE_INFINITY, dy ? h / 2 / Math.abs(dy) : Infinity);
  return s >= 1 ? c : { x: c.x + dx * s, y: c.y + dy * s };
}

export interface NodeBox {
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
export const EDGE_MARKER_COLOR: Partial<Record<RoadmapEdgeKind, string>> = {
  blocks: 'var(--roadmap-edge-blocks)',
  repair: 'var(--roadmap-edge-repair)',
};
const EDGE_KINDS: readonly RoadmapEdgeKind[] = ['parent', 'blocks', 'repair'];
const isEdgeKind = (v: string | undefined): v is RoadmapEdgeKind => EDGE_KINDS.includes(v as RoadmapEdgeKind);

const pt = (p: RoadmapPoint) => `${Math.round(p.x * 10) / 10},${Math.round(p.y * 10) / 10}`;

/** Dây cha-con của cây trên xuống: từ giữa đáy thẻ cha tới giữa đỉnh thẻ con, cong chữ S theo chiều dọc. */
export function verticalCurve(a: NodeBox, b: NodeBox) {
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

export function edgePath(kind: RoadmapEdgeKind, a: NodeBox, b: NodeBox, self: boolean, topDown: boolean): string {
  if (self) return selfLoop(a);
  if (kind === 'parent') return topDown ? verticalCurve(a, b) : portCurve(a, b);
  // Cạnh chặn/vòng sửa: cong để không trùng cạnh cha-con, mũi tên chạm viền nút đích.
  if (topDown && Math.abs(a.c.y - b.c.y) < (a.h + b.h) / 4) return underCurve(a, b, kind === 'blocks' ? 44 : 68);
  return curve(a, b, kind === 'blocks' ? 1 : -1);
}

export function FlowEdge({ id, source, target, markerEnd, data, type }: EdgeProps<Edge<EdgeData>>) {
  const measuredA = useNodeBox(source);
  const measuredB = useNodeBox(target);
  const a = data?.boxes?.a ?? measuredA;
  const b = data?.boxes?.b ?? measuredB;
  if (!a || !b) return null;
  const kind: RoadmapEdgeKind = isEdgeKind(type) ? type : 'parent';
  const d = edgePath(kind, a, b, source === target, !!data?.topDown);
  const running = !!data?.running;
  const style: CSSProperties & Record<string, string> = {};
  if (data?.enterDelay != null) style['--enter-delay'] = `${data.enterDelay}ms`;
  return (
    <g
      aria-hidden
      style={style}
      className={cn(data?.enterDelay != null && 'roadmap-edge-enter', data?.faded && 'opacity-25')}
    >
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

export const NODE_TYPES = { roadmap: FlowNode };
export const EDGE_TYPES: Record<RoadmapEdgeKind, typeof FlowEdge> = {
  parent: FlowEdge,
  blocks: FlowEdge,
  repair: FlowEdge,
};

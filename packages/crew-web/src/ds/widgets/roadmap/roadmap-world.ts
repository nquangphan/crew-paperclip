// crew: tự dựng
// Bố cục thuần của Roadmap một trang: một "thế giới" chứa công ty → project → các "đảo" yêu cầu. Mỗi đảo là đúng một tầng
// cây trên xuống như bản đồ Crew ở trang issue (`topDownTree`, cùng kích thước thẻ `roadmapNodeSize`), nên thẻ và dây vẽ
// bằng cùng bộ của canvas Roadmap. Đảo xếp kệ dưới project của nó; project xếp một hàng; công ty ở trên giữa hàng.
// Bố cục mỗi đảo nhớ theo chữ ký (id, cha, kích thước): dữ liệu live đổi một đảo thì chỉ tính lại đảo đó, và vì cụm/kệ
// canh trái nên đảo đứng trước đảo đổi không dời chỗ (camera không nhảy).
// Kèm các hàm camera thuần: mức chi tiết theo độ phóng (có trễ), khung nhìn cho từng loại mục, ô màu, chọn ở mức xa.
import { roadmapNodeSize, runningEdgeIds, topDownTree, type ViewPadding } from './roadmap-layout';
import { roadmapToneVar } from './roadmap-node';
import type { RoadmapEdge, RoadmapLevel, RoadmapNode, RoadmapPoint } from './roadmap-types';

/** Hộp chữ nhật đơn vị bản đồ, (x, y) là góc trên trái. */
export interface WorldBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WorldClusterInput {
  /** Nút project (kind `project`). */
  node: RoadmapNode;
  /** Các đảo theo thứ tự đặt (Docs trước, rồi yêu cầu theo thứ tự tạo); mỗi đảo là một tầng cây trên xuống. */
  islands: readonly RoadmapLevel[];
}

export interface WorldInput {
  /** Nút công ty (kind `company`). */
  company: RoadmapNode;
  clusters: readonly WorldClusterInput[];
}

export interface WorldNode {
  node: RoadmapNode;
  /** Tâm nút. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Nút gốc của đảo (vẽ như nút tâm của bản đồ Crew). */
  center: boolean;
  /** Đảo chứa nút (id gốc đảo); null với công ty và project. */
  island: string | null;
  /** Cụm (id project) chứa nút; null với công ty. */
  cluster: string | null;
}

export interface WorldIsland {
  /** Id nút gốc của đảo. */
  id: string;
  cluster: string;
  level: RoadmapLevel;
  box: WorldBox;
}

export interface WorldCluster {
  id: string;
  node: RoadmapNode;
  /** Hộp của cả cụm (nút project và mọi đảo). */
  box: WorldBox;
  islands: string[];
}

export interface WorldEdge extends RoadmapEdge {
  island: string;
}

/** Dây trục: công ty → project, project → gốc đảo. */
export interface WorldTrunk {
  id: string;
  source: string;
  target: string;
  cluster: string;
  island: string | null;
}

export interface RoadmapWorld {
  company: WorldNode;
  clusters: WorldCluster[];
  islands: WorldIsland[];
  /** Mọi nút (công ty, project, nút trong đảo) theo id. */
  nodes: Map<string, WorldNode>;
  /** Cạnh trong đảo (cha-con, chặn, vòng sửa). */
  edges: WorldEdge[];
  trunks: WorldTrunk[];
  /** Cạnh "đang chạy" (`runningEdgeIds` của từng đảo). */
  running: Set<string>;
  bounds: WorldBox;
  /**
   * Trần phóng của nút tròn khi giữ cỡ tối thiểu trên màn hình (đơn vị: lần cỡ thật): nút project không lớn quá khoảng
   * cách giữa hai cụm kề nhau, nút công ty không đè lên hàng project. Nhiều project thì toàn cảnh nút nhỏ hơn, không chồng.
   */
  orbCap: { project: number; company: number };
}

interface IslandLayout {
  sig: string;
  /** Vị trí tâm nút so với góc trên trái của đảo. */
  positions: Record<string, RoadmapPoint>;
  w: number;
  h: number;
}
/** Bố cục đã tính của từng đảo, theo id gốc đảo. */
export type IslandCache = Map<string, IslandLayout>;
export const createIslandCache = (): IslandCache => new Map();

/** Khoảng cách (đơn vị bản đồ) giữa cụm, giữa đảo, và chỗ chừa cho nút project/nhãn nổi; theo mockup đã duyệt. */
const WORLD = {
  clusterGap: 640,
  islandGapX: 150,
  /** Khe dọc giữa hai kệ: đủ chỗ nhãn nổi của đảo bên dưới ở mức nhãn. */
  islandGapY: 330,
  /** Hàng project nằm ở y = rowY; kệ đầu bắt đầu dưới đó `plate`. */
  rowY: 2170,
  plate: 430,
  minShelf: 2300,
  minCluster: 400,
  margin: 200,
} as const;

const round = (v: number) => Math.round(v * 10) / 10;

function islandNodes(level: RoadmapLevel): RoadmapNode[] {
  return [level.center, ...level.nodes.filter((n) => n.kind !== 'more' && n.id !== level.center.id)];
}

function islandSignature(level: RoadmapLevel): string {
  return islandNodes(level)
    .map((n, i) => {
      const s = roadmapNodeSize(n, i === 0);
      return `${n.id}<${n.parentId ?? ''}:${s.w}x${s.h}`;
    })
    .join('|');
}

/** Bố cục một đảo (tâm nút so với góc trên trái của đảo); dùng lại bản đã nhớ nếu chữ ký không đổi. */
function layoutIsland(level: RoadmapLevel, cache?: IslandCache): IslandLayout {
  const sig = islandSignature(level);
  const known = cache?.get(level.center.id);
  if (known && known.sig === sig) return known;
  const rel: Record<string, RoadmapPoint> = { [level.center.id]: { x: 0, y: 0 }, ...topDownTree(level) };
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const nodes = islandNodes(level);
  nodes.forEach((n, i) => {
    const p = rel[n.id];
    if (!p) return;
    const s = roadmapNodeSize(n, i === 0);
    minX = Math.min(minX, p.x - s.w / 2);
    maxX = Math.max(maxX, p.x + s.w / 2);
    minY = Math.min(minY, p.y - s.h / 2);
    maxY = Math.max(maxY, p.y + s.h / 2);
  });
  const positions: Record<string, RoadmapPoint> = {};
  for (const n of nodes) {
    const p = rel[n.id];
    if (p) positions[n.id] = { x: round(p.x - minX), y: round(p.y - minY) };
  }
  const out = { sig, positions, w: round(maxX - minX), h: round(maxY - minY) };
  cache?.set(level.center.id, out);
  return out;
}

/** Dựng thế giới: vị trí mọi nút, hộp đảo/cụm, cạnh và dây trục. */
export function layoutWorld(input: WorldInput, cache?: IslandCache): RoadmapWorld {
  const nodes = new Map<string, WorldNode>();
  const clusters: WorldCluster[] = [];
  const islands: WorldIsland[] = [];
  const edges: WorldEdge[] = [];
  const trunks: WorldTrunk[] = [];
  const running = new Set<string>();
  const orbY = WORLD.rowY;
  const top = orbY - roadmapNodeSize({ id: '', kind: 'project', title: '' }, false).h;
  let cx = 0;
  const live = new Set<string>();

  for (const cluster of input.clusters) {
    const placed = cluster.islands.map((level) => ({ level, layout: layoutIsland(level, cache) }));
    for (const p of placed) live.add(p.level.center.id);
    const area = placed.reduce((a, p) => a + (p.layout.w + WORLD.islandGapX) * (p.layout.h + WORLD.islandGapY), 0);
    const maxW = Math.max(WORLD.minShelf, ...placed.map((p) => p.layout.w), Math.sqrt(area * 1.5));
    // Xếp kệ, canh trái: đảo đổi kích thước không làm dời đảo đứng trước nó.
    let x = 0;
    let y = orbY + WORLD.plate;
    let shelfH = 0;
    let width: number = WORLD.minCluster;
    const at: { x: number; y: number }[] = [];
    for (const p of placed) {
      if (x > 0 && x + p.layout.w > maxW) {
        y += shelfH + WORLD.islandGapY;
        x = 0;
        shelfH = 0;
      }
      at.push({ x: cx + x, y });
      width = Math.max(width, x + p.layout.w);
      x += p.layout.w + WORLD.islandGapX;
      shelfH = Math.max(shelfH, p.layout.h);
    }
    const bottom = placed.length ? y + shelfH : orbY + roadmapNodeSize(cluster.node, false).h / 2;
    const id = cluster.node.id;
    const size = roadmapNodeSize(cluster.node, false);
    nodes.set(id, {
      node: cluster.node,
      x: round(cx + width / 2),
      y: orbY,
      ...size,
      center: false,
      island: null,
      cluster: id,
    });
    trunks.push({ id: `trunk:company:${id}`, source: input.company.id, target: id, cluster: id, island: null });
    const ids: string[] = [];
    placed.forEach(({ level, layout }, i) => {
      const origin = at[i];
      const islandId = level.center.id;
      ids.push(islandId);
      islands.push({
        id: islandId,
        cluster: id,
        level,
        box: { x: round(origin.x), y: round(origin.y), w: layout.w, h: layout.h },
      });
      islandNodes(level).forEach((n, j) => {
        const p = layout.positions[n.id];
        if (!p) return;
        const s = roadmapNodeSize(n, j === 0);
        nodes.set(n.id, {
          node: n,
          x: round(origin.x + p.x),
          y: round(origin.y + p.y),
          ...s,
          center: j === 0,
          island: islandId,
          cluster: id,
        });
      });
      for (const e of level.edges) {
        if (layout.positions[e.source] && layout.positions[e.target]) edges.push({ ...e, island: islandId });
      }
      for (const e of runningEdgeIds(level)) running.add(e);
    });
    for (const islandId of ids) {
      trunks.push({ id: `trunk:${id}:${islandId}`, source: id, target: islandId, cluster: id, island: islandId });
    }
    clusters.push({
      id,
      node: cluster.node,
      box: { x: cx, y: top - 130, w: width, h: bottom - (top - 130) },
      islands: ids,
    });
    cx += width + WORLD.clusterGap;
  }
  // Trunk công ty → project trước, rồi project → đảo (thứ tự vẽ: trục chính dưới cùng).
  trunks.sort((a, b) => Number(a.island !== null) - Number(b.island !== null));
  if (cache) for (const key of [...cache.keys()]) if (!live.has(key)) cache.delete(key);

  const rowW = Math.max(0, cx - WORLD.clusterGap);
  // Bản đồ càng rộng thì toàn cảnh càng thu nhỏ (nút tròn giữ cỡ tối thiểu trên màn hình): đẩy công ty lên cao hơn để
  // nút công ty không đè hàng project. Chỉ công ty dời, cụm và đảo giữ chỗ.
  const lift = Math.max(0, rowW * 0.2 - (orbY - 62 - 130));
  const companySize = roadmapNodeSize(input.company, false);
  const company: WorldNode = {
    node: input.company,
    x: round(rowW / 2),
    y: round(-lift),
    ...companySize,
    center: false,
    island: null,
    cluster: null,
  };
  nodes.set(input.company.id, company);
  const x0 = Math.min(0, ...clusters.map((c) => c.box.x)) - WORLD.margin;
  const x1 = Math.max(rowW, ...clusters.map((c) => c.box.x + c.box.w)) + WORLD.margin;
  const y0 = company.y - companySize.h / 2 - WORLD.margin - 500;
  const y1 = Math.max(orbY, ...clusters.map((c) => c.box.y + c.box.h)) + WORLD.margin;
  const orbX = clusters.map((c) => (nodes.get(c.id) as WorldNode).x);
  let spacing = Number.POSITIVE_INFINITY;
  for (let i = 1; i < orbX.length; i++) spacing = Math.min(spacing, orbX[i] - orbX[i - 1]);
  const projectSize = roadmapNodeSize({ id: '', kind: 'project', title: '' }, false);
  const project = Math.max(1, Math.min(40, (spacing * 0.9) / projectSize.w));
  // Đáy nút project ở orbY + h/2, nút lớn lên phía trên; nút công ty (tâm ở company.y) chừa 10% khe.
  const rowTop = orbY + projectSize.h / 2 - projectSize.h * project;
  const companyCap = Math.max(1, Math.min(40, ((rowTop - company.y) * 2 * 0.9) / companySize.h));
  return {
    company,
    clusters,
    islands,
    nodes,
    edges,
    trunks,
    running,
    bounds: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 },
    orbCap: { project: round(project), company: round(companyCap) },
  };
}

// ---- Camera ---------------------------------------------------------------------------------------------------------

/** Mức chi tiết: 0 ô màu, 1 nhãn yêu cầu, 2 thẻ đầy đủ. */
export type WorldLod = 0 | 1 | 2;
/** Mốc độ phóng giữa các mức (16%, 55%) và độ trễ quanh mốc. */
export const WORLD_LOD_ZOOM = [0.16, 0.55] as const;
const LOD_SLACK = 0.02;

/** Mức chi tiết theo độ phóng; `prev` là mức đang hiện để mốc có trễ ±2% (dừng đúng mốc không nhấp nháy). */
export function worldLod(zoom: number, prev: WorldLod | null): WorldLod {
  const [a, b] = WORLD_LOD_ZOOM;
  if (prev === null) return zoom >= b ? 2 : zoom >= a ? 1 : 0;
  const up = (mark: number) => zoom >= mark + LOD_SLACK;
  const down = (mark: number) => zoom < mark - LOD_SLACK;
  if (prev === 0) return up(b) ? 2 : up(a) ? 1 : 0;
  if (prev === 2) return down(a) ? 0 : down(b) ? 1 : 2;
  return down(a) ? 0 : up(b) ? 2 : 1;
}

export interface CameraView {
  /** Tâm khung nhìn (đơn vị bản đồ) và độ phóng, cho `setCenter`. */
  x: number;
  y: number;
  zoom: number;
}

/**
 * Khung nhìn vừa hộp `box` trong vùng còn lại sau phần chừa, độ phóng kẹp trong [min, max]. Không vừa ở `min` và
 * `topAlign` thì canh mép trên hộp ngay dưới phần chừa trên (cây mọc xuống, kéo để xem tiếp).
 */
export function fitWorldBox(
  box: WorldBox,
  viewport: { width: number; height: number },
  padding: ViewPadding,
  { min, max, topAlign = false }: { min: number; max: number; topAlign?: boolean },
): CameraView {
  const aw = Math.max(1, viewport.width - padding.left - padding.right);
  const ah = Math.max(1, viewport.height - padding.top - padding.bottom);
  const fit = Math.min(aw / Math.max(1, box.w), ah / Math.max(1, box.h));
  const zoom = Math.max(min, Math.min(max, fit));
  const x = box.x + box.w / 2 + (padding.right - padding.left) / 2 / zoom;
  let y = box.y + box.h / 2 - (padding.top - padding.bottom) / 2 / zoom;
  if (fit < min && topAlign) y = box.y + (viewport.height / 2 - padding.top) / zoom;
  return { x, y, zoom };
}

/** Mục camera lấy nét: toàn cảnh, một cụm project, một đảo (yêu cầu, Docs), một nút (việc con, thư mục docs). */
export type WorldFocus =
  | { kind: 'overview' }
  | { kind: 'cluster'; id: string }
  | { kind: 'island'; id: string }
  | { kind: 'node'; id: string };

/** Màn hẹp: toàn cảnh không ép cả công ty vào bề ngang điện thoại, giữ độ phóng tối thiểu và vuốt ngang để xem. */
const NARROW = 640;
const NARROW_MIN_ZOOM = 0.04;

/** Khung nhìn đích khi lấy nét một mục; mục không có trong thế giới thì là toàn cảnh. */
export function worldFocusView(
  world: RoadmapWorld,
  focus: WorldFocus,
  viewport: { width: number; height: number },
  padding: ViewPadding,
): CameraView {
  if (focus.kind === 'cluster') {
    const c = world.clusters.find((x) => x.id === focus.id);
    if (c) return fitWorldBox(c.box, viewport, padding, { min: 0.22, max: 0.5, topAlign: true });
  } else if (focus.kind === 'island') {
    const i = world.islands.find((x) => x.id === focus.id);
    if (i) return fitWorldBox(i.box, viewport, padding, { min: 0.6, max: 1.1, topAlign: true });
  } else if (focus.kind === 'node') {
    const n = world.nodes.get(focus.id);
    // Chừa chỗ phía trên cho thẻ "đang xem" ở góc bản đồ.
    if (n) return { x: n.x, y: n.y + 40, zoom: 1.05 };
  }
  const b = world.bounds;
  const view = fitWorldBox({ x: b.x, y: b.y + 300, w: b.w, h: b.h - 300 }, viewport, padding, { min: 0.005, max: 1 });
  if (viewport.width < NARROW && view.zoom < NARROW_MIN_ZOOM) {
    return { x: world.company.x, y: view.y, zoom: NARROW_MIN_ZOOM };
  }
  return view;
}

/** Hộp khung nhìn (đơn vị bản đồ) từ transform của xyflow [tx, ty, zoom] và cỡ khung. */
export function viewBoxOf(transform: readonly [number, number, number], size: { width: number; height: number }) {
  const [tx, ty, k] = transform;
  return { x: -tx / k, y: -ty / k, w: size.width / k, h: size.height / k };
}

const hits = (a: WorldBox, b: WorldBox) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const boxOf = (n: WorldNode): WorldBox => ({ x: n.x - n.w / 2, y: n.y - n.h / 2, w: n.w, h: n.h });

/** Hộp nới thêm `f` lần bề rộng/cao mỗi phía (khung đệm). */
export function padBox(view: WorldBox, f: number): WorldBox {
  return { x: view.x - view.w * f, y: view.y - view.h * f, w: view.w * (1 + 2 * f), h: view.h * (1 + 2 * f) };
}

/** `inner` nằm trọn trong `outer`. */
export function containsBox(outer: WorldBox, inner: WorldBox): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

/**
 * Nút được vẽ thành thẻ DOM ở mức thẻ đầy đủ: nút trong đảo giao hộp `view` (khung nhìn đã nới đệm), gần tâm hộp trước,
 * tối đa `limit`; nút `keep` (đang xem) luôn có. Phần còn lại vẫn là ô màu.
 */
export function cardsInView(world: RoadmapWorld, view: WorldBox, limit: number, keep?: string | null): WorldNode[] {
  const near = new Set(world.islands.filter((i) => hits(i.box, view)).map((i) => i.id));
  const cx = view.x + view.w / 2;
  const cy = view.y + view.h / 2;
  const found: { n: WorldNode; d: number }[] = [];
  for (const n of world.nodes.values()) {
    if (!n.island || !near.has(n.island) || !hits(boxOf(n), view)) continue;
    found.push({ n, d: Math.hypot(n.x - cx, n.y - cy) });
  }
  const out = found
    .sort((a, b) => a.d - b.d)
    .slice(0, limit)
    .map((x) => x.n);
  const kept = keep ? world.nodes.get(keep) : undefined;
  if (kept?.island && !out.includes(kept)) out.push(kept);
  return out;
}

/** Nút trong đảo tại một điểm (bấm vào ô màu ở mức xa); null khi không trúng nút nào. */
export function nodeAtPoint(world: RoadmapWorld, p: RoadmapPoint): WorldNode | null {
  for (const n of world.nodes.values()) {
    if (n.island === null) continue;
    if (Math.abs(p.x - n.x) <= n.w / 2 && Math.abs(p.y - n.y) <= n.h / 2) return n;
  }
  return null;
}

/** Đảo cần nhãn nổi: giao khung nhìn, gần tâm khung trước, tối đa `limit`. */
export function platesInView(world: RoadmapWorld, view: WorldBox, limit: number): WorldIsland[] {
  const cx = view.x + view.w / 2;
  const cy = view.y + view.h / 2;
  return world.islands
    .filter((i) => hits(i.box, view))
    .map((i) => ({ i, d: Math.hypot(i.box.x + i.box.w / 2 - cx, i.box.y - cy) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, limit)
    .map((x) => x.i);
}

/** Dây đang chạy được vẽ lớp chạy: chỉ dây có một đầu trong khung, tối đa `limit`; còn lại vẽ màu tĩnh. */
export function runningInView(world: RoadmapWorld, view: WorldBox, limit: number): Set<string> {
  const out = new Set<string>();
  for (const e of world.edges) {
    if (out.size >= limit) break;
    if (!world.running.has(e.id)) continue;
    const a = world.nodes.get(e.source);
    const b = world.nodes.get(e.target);
    if ((a && hits(boxOf(a), view)) || (b && hits(boxOf(b), view))) out.add(e.id);
  }
  return out;
}

export interface BlockPath {
  /** Màu tô (biến CSS). */
  tone: string;
  /** Mọi ô cùng màu gộp một path. */
  d: string;
  /** Màu của việc đang làm (phát sáng). */
  running: boolean;
}

function blockTone(node: RoadmapNode): string {
  if (node.kind === 'request' || node.kind === 'ticket') return roadmapToneVar(node.status);
  if (node.kind === 'page') return 'var(--muted-foreground)';
  return 'var(--primary)';
}

/**
 * Ô màu của mức xa: mỗi nút trong đảo là một hình chữ nhật đúng vị trí và kích thước thẻ, gộp một `<path>` cho mỗi màu
 * (vài path cho cả nghìn việc, không phải một nút DOM mỗi việc). `except`: nút đang vẽ thành thẻ.
 */
export function blockPaths(world: RoadmapWorld, except?: ReadonlySet<string>): BlockPath[] {
  const byTone = new Map<string, { parts: string[]; running: boolean }>();
  for (const n of world.nodes.values()) {
    if (n.island === null || except?.has(n.node.id)) continue;
    const tone = blockTone(n.node);
    const entry = byTone.get(tone) ?? { parts: [], running: false };
    entry.parts.push(`M${round(n.x - n.w / 2)} ${round(n.y - n.h / 2)}h${n.w}v${n.h}h${-n.w}Z`);
    if (n.node.status === 'in_progress') entry.running = true;
    byTone.set(tone, entry);
  }
  return [...byTone.entries()].map(([tone, e]) => ({ tone, d: e.parts.join(''), running: e.running }));
}

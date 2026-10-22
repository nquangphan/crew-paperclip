// crew: tự dựng
// Bố cục thuần của bản đồ Roadmap: tâm ở gốc (0,0), nút con tỏa tròn. Không phụ thuộc thư viện vẽ.
import { runLines } from './roadmap-runs';
import type { RoadmapLevel, RoadmapNode, RoadmapPoint } from './roadmap-types';

/**
 * Đặt `n` điểm trên các vòng đồng tâm quanh gốc, vòng đầu bán kính `r0`, mỗi vòng sau xa thêm `gap`. Mỗi vòng chứa
 * nhiều nhất `⌊2πr / spacing⌋` điểm (vòng ngoài chứa nhiều hơn), vòng lẻ xoay nửa bước để nút không thẳng hàng.
 * Điểm đầu nằm ở đỉnh (12 giờ), đi theo chiều kim đồng hồ.
 */
export function rings(
  n: number,
  r0: number,
  gap: number,
  spacing: number,
  aspect: { x: number; y: number } = { x: 1, y: 1 },
): RoadmapPoint[] {
  const points: RoadmapPoint[] = [];
  for (let ring = 0; points.length < n; ring++) {
    const r = r0 + ring * gap;
    // Vòng elip (thẻ rộng hơn cao): sức chứa theo chu vi gần đúng của elip.
    const perimeter = 2 * Math.PI * r * Math.sqrt((aspect.x ** 2 + aspect.y ** 2) / 2);
    const cap = Math.max(1, Math.floor(perimeter / spacing));
    const take = Math.min(cap, n - points.length);
    const offset = ring % 2 ? Math.PI / take : 0;
    for (let i = 0; i < take; i++) {
      const a = -Math.PI / 2 + offset + (2 * Math.PI * i) / take;
      points.push({ x: round(aspect.x * r * Math.cos(a)), y: round(aspect.y * r * Math.sin(a)) });
    }
  }
  return points;
}

export interface TreeLayoutOptions {
  /** Bán kính tối thiểu của vòng con đầu tiên. */
  radius?: number;
  /** Khoảng cách giữa hai tầng sâu kế nhau. */
  ringGap?: number;
  /** Cung tối thiểu cho mỗi lá ở vòng đầu: cây nhiều lá thì vòng đầu nới ra. */
  leafArc?: number;
}

/**
 * Cây tỏa tròn: mỗi nút nhận một cung tỉ lệ với số lá của nó, đặt ở giữa cung, bán kính theo độ sâu. Con nằm trong cung
 * của cha. Nút không nối được về `rootId` (cha thiếu hoặc vòng cha-con hỏng) bị bỏ qua; vòng không làm treo.
 * Thứ tự anh em giữ theo thứ tự trong `nodes`.
 */
export function radialTree(
  rootId: string,
  nodes: readonly { id: string; parentId?: string | null }[],
  { radius = 280, ringGap = 230, leafArc = 120 }: TreeLayoutOptions = {},
): Record<string, RoadmapPoint> {
  const kids = new Map<string, string[]>();
  for (const node of nodes) {
    if (!node.parentId || node.id === rootId) continue;
    const list = kids.get(node.parentId) ?? [];
    list.push(node.id);
    kids.set(node.parentId, list);
  }
  // Cây thật (đi từ gốc, mỗi nút một lần) trước khi đếm lá, để vòng cha-con không đếm mãi.
  const tree = new Map<string, string[]>();
  const seen = new Set([rootId]);
  const queue = [rootId];
  while (queue.length) {
    const id = queue.shift() as string;
    const children = (kids.get(id) ?? []).filter((c) => !seen.has(c));
    for (const c of children) seen.add(c);
    tree.set(id, children);
    queue.push(...children);
  }
  const leafCount = new Map<string, number>();
  const leaves = (id: string): number => {
    const known = leafCount.get(id);
    if (known !== undefined) return known;
    const children = tree.get(id) ?? [];
    const count = children.length ? children.reduce((sum, c) => sum + leaves(c), 0) : 1;
    leafCount.set(id, count);
    return count;
  };
  const r1 = Math.max(radius, (leaves(rootId) * leafArc) / (2 * Math.PI));
  const out: Record<string, RoadmapPoint> = {};
  const place = (id: string, a0: number, a1: number, depth: number) => {
    const total = leaves(id);
    let a = a0;
    for (const child of tree.get(id) ?? []) {
      const span = ((a1 - a0) * leaves(child)) / total;
      const mid = a + span / 2;
      const r = r1 + (depth - 1) * ringGap;
      out[child] = { x: round(r * Math.cos(mid)), y: round(r * Math.sin(mid)) };
      place(child, a, a + span, depth + 1);
      a += span;
    }
  };
  place(rootId, -Math.PI / 2, (3 * Math.PI) / 2, 1);
  return out;
}

/** Thông số vòng theo loại tâm: quanh công ty là nút tròn, các tầng khác là thẻ rộng. */
const RING = {
  round: { r0: 300, gap: 200, spacing: 200, aspect: { x: 1, y: 1 } },
  // Thẻ rộng 180–200, cao 60–80: vòng dẹt theo chiều ngang để vừa màn hình rộng ở độ phóng đọc được.
  card: { r0: 300, gap: 200, spacing: 220, aspect: { x: 1.35, y: 0.75 } },
} as const;
/** Ít nút thì vòng đầu nhỏ lại để bản đồ không quá thưa (vẫn đủ chỗ cho nút). */
const FEW = 4;
const FEW_R0 = { round: 230, card: 280 } as const;

/** Vị trí tâm mỗi nút của một tầng (tâm tầng ở gốc). Nút "+N khác" ở tầng cây nằm ngay dưới tâm. */
export function layoutLevel(level: RoadmapLevel): Record<string, RoadmapPoint> {
  const out: Record<string, RoadmapPoint> = { [level.center.id]: { x: 0, y: 0 } };
  if (level.layout === 'top-down') {
    Object.assign(out, topDownTree(level));
    // Nút "+N khác" đứng cạnh phải gốc, cùng hàng: hàng con bên dưới đã kín.
    const root = roadmapNodeSize(level.center, true);
    for (const node of level.nodes) {
      if (node.kind === 'more') out[node.id] = { x: root.w / 2 + TOP_DOWN.gapX + NODE_SIZE.more.w / 2, y: 0 };
    }
    return out;
  }
  if (level.layout === 'spread-tree') {
    Object.assign(out, compactTree(level));
    for (const node of level.nodes) if (node.kind === 'more') out[node.id] = { x: 0, y: 150 };
    return out;
  }
  if (level.layout === 'tree') {
    Object.assign(out, radialTree(level.center.id, level.nodes));
    for (const node of level.nodes) if (node.kind === 'more') out[node.id] = { x: 0, y: 150 };
    return out;
  }
  const shape = level.center.kind === 'company' ? 'round' : 'card';
  const p = RING[shape];
  const r0 = level.nodes.length <= FEW ? FEW_R0[shape] : p.r0;
  const points = rings(level.nodes.length, r0, p.gap, p.spacing, p.aspect);
  level.nodes.forEach((node, i) => {
    out[node.id] = points[i];
  });
  return out;
}

const round = (v: number) => Math.round(v * 10) / 10;

/**
 * Kích thước (đơn vị bản đồ) của mặt nút theo loại. Thẻ yêu cầu/việc con/docs có kích thước cố định (`w-[…] h-[…]` trong
 * roadmap-node.tsx), nút tròn theo `size-*`; giữ hai nơi khớp nhau để bố cục không chồng thẻ.
 */
const NODE_SIZE: Record<RoadmapLevel['center']['kind'], { w: number; h: number }> = {
  company: { w: 160, h: 160 },
  project: { w: 136, h: 136 },
  request: { w: 236, h: 92 },
  ticket: { w: 240, h: 82 },
  docs: { w: 200, h: 64 },
  folder: { w: 200, h: 64 },
  page: { w: 200, h: 64 },
  more: { w: 120, h: 40 },
};
const CENTER_SIZE: Partial<Record<RoadmapLevel['center']['kind'], { w: number; h: number }>> = {
  project: { w: 160, h: 160 },
  request: { w: 268, h: 112 },
  folder: { w: 220, h: 68 },
  docs: { w: 220, h: 68 },
};

/** Chiều cao thêm của ô chi tiết (`detail`, dạng dòng lệnh) trên thẻ. */
const DETAIL_LINE = 30;

/** Chiều cao thêm của dòng cờ complexity của Jev (dòng `h-4` cộng khe `gap-1.5`). */
export const COMPLEXITY_LINE = 22;

/** Một dòng run trên thẻ (`leading-4`). */
export const RUN_LINE = 16;
/** Phần cố định của khối run: khe trên khối, vạch ngăn + đệm, dòng chân (tổng tiền · số run). */
export const RUN_BLOCK = 30;

/** Chiều cao thêm của khối run trên thẻ: 0 khi thẻ không có run, không thì phần cố định cộng mỗi dòng run. */
export function runsHeight(node: Pick<RoadmapNode, 'runs'>): number {
  return node.runs ? RUN_BLOCK + runLines(node.runs) * RUN_LINE : 0;
}

/** Kích thước gần đúng của một nút trên bản đồ (nút tâm to hơn, thẻ có dòng chi tiết hay dòng run cao hơn). */
export function roadmapNodeSize(node: RoadmapNode, center: boolean): { w: number; h: number } {
  const s = (center ? CENTER_SIZE[node.kind] : undefined) ?? NODE_SIZE[node.kind];
  return {
    w: s.w,
    h: s.h + (node.detail ? DETAIL_LINE : 0) + runsHeight(node) + (node.jevComplexity ? COMPLEXITY_LINE : 0),
  };
}

/** Khe tối thiểu giữa hai thẻ (đơn vị bản đồ) khi xếp cây gọn. */
const SPREAD_GAP = { x: 24, y: 20 } as const;
/**
 * Elip của cây gọn: bán trục vòng đầu (`x`, `y`) và độ nới thêm mỗi tầng sâu (`gx`, `gy`). Vòng đầu vừa đủ để thẻ
 * con (180×~90) không chạm thẻ tâm (232×~140); dẹt ngang như vòng thẻ của Roadmap vì thẻ rộng hơn cao.
 */
const COMPACT = { x: 232, y: 150, gx: 210, gy: 120 } as const;
/**
 * Mỗi bước nới elip tới khi không còn thẻ chồng nhau: dọc nhanh hơn ngang, vì cột chính của trang chi tiết hẹp
 * (bề ngang mới là thứ khiến phải kéo) còn chiều cao khung bản đồ thường dư.
 */
const SPREAD_STEP = { x: 0.03, y: 0.08 } as const;
const SPREAD_MAX_STEPS = 120;

function overlaps(level: RoadmapLevel, positions: Record<string, RoadmapPoint>): boolean {
  const boxes = [level.center, ...level.nodes].flatMap((node, i) => {
    const p = positions[node.id];
    return p ? [{ p, s: roadmapNodeSize(node, i === 0) }] : [];
  });
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      if (
        Math.abs(a.p.x - b.p.x) < (a.s.w + b.s.w) / 2 + SPREAD_GAP.x &&
        Math.abs(a.p.y - b.p.y) < (a.s.h + b.s.h) / 2 + SPREAD_GAP.y
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Cây gọn (bản đồ Crew ở trang chi tiết, khung nhỏ hơn trang Roadmap): cùng góc và thứ tự như `radialTree` (mỗi nhánh
 * một cung theo số lá), nhưng mỗi tầng nằm trên một elip dẹt ngang, bắt đầu nhỏ nhất có thể rồi nới dần tới khi không còn
 * hai thẻ chồng nhau. Gia đình vài việc con vừa khung ở độ phóng đọc được; cây rộng hoặc sâu tự giãn ra.
 */
export function compactTree(level: RoadmapLevel): Record<string, RoadmapPoint> {
  // radialTree với bán kính 1 và khoảng tầng 1: giữ góc, độ sâu = bán kính.
  const unit = radialTree(level.center.id, level.nodes, { radius: 1, ringGap: 1, leafArc: 0 });
  const polar = Object.entries(unit).map(([id, p]) => ({
    id,
    angle: Math.atan2(p.y, p.x),
    depth: Math.max(1, Math.round(Math.hypot(p.x, p.y))),
  }));
  const place = (step: number) => {
    const out: Record<string, RoadmapPoint> = { [level.center.id]: { x: 0, y: 0 } };
    for (const { id, angle, depth } of polar) {
      const rx = (1 + step * SPREAD_STEP.x) * (COMPACT.x + (depth - 1) * COMPACT.gx);
      const ry = (1 + step * SPREAD_STEP.y) * (COMPACT.y + (depth - 1) * COMPACT.gy);
      out[id] = { x: round(rx * Math.cos(angle)), y: round(ry * Math.sin(angle)) };
    }
    return out;
  };
  let out = place(0);
  for (let step = 1; step <= SPREAD_MAX_STEPS && overlaps(level, out); step++) out = place(step);
  delete out[level.center.id];
  return out;
}

/** Độ phóng nhỏ nhất khi tự canh: chữ trên thẻ (12–14px) vẫn đọc được. Thiếu chỗ thì người xem kéo để xem tiếp. */
export const READABLE_ZOOM = 1;
/** Độ phóng lớn nhất khi tự canh (tầng ít nút không bị phóng quá to). */
export const MAX_FIT_ZOOM = 1.2;

export interface ViewPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * Camera đích sau khi vào/lùi tầng: vừa cả tầng nếu vừa được ở độ phóng ≥ READABLE_ZOOM, không thì giữ READABLE_ZOOM và
 * đặt `focus` (nút trung tâm hoặc nút vừa rời) ở giữa vùng nhìn. Trả tâm (đơn vị bản đồ) và độ phóng cho `setCenter`.
 */
export function readableView(
  level: RoadmapLevel,
  positions: Record<string, RoadmapPoint>,
  viewport: { width: number; height: number },
  padding: ViewPadding,
  focus: RoadmapPoint = { x: 0, y: 0 },
): { x: number; y: number; zoom: number } {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const [i, node] of [level.center, ...level.nodes].entries()) {
    const p = positions[node.id];
    if (!p) continue;
    const s = roadmapNodeSize(node, i === 0);
    minX = Math.min(minX, p.x - s.w / 2);
    maxX = Math.max(maxX, p.x + s.w / 2);
    minY = Math.min(minY, p.y - s.h / 2);
    maxY = Math.max(maxY, p.y + s.h / 2);
  }
  if (!Number.isFinite(minX)) return { x: focus.x, y: focus.y, zoom: READABLE_ZOOM };
  const availW = Math.max(1, viewport.width - padding.left - padding.right);
  const availH = Math.max(1, viewport.height - padding.top - padding.bottom);
  const fit = Math.min(availW / (maxX - minX), availH / (maxY - minY));
  const fits = fit >= READABLE_ZOOM;
  const zoom = fits ? Math.min(fit, MAX_FIT_ZOOM) : READABLE_ZOOM;
  const target = fits ? { x: (minX + maxX) / 2, y: (minY + maxY) / 2 } : focus;
  // Vùng nhìn lệch theo phần chừa (gợi ý trên, nút điều khiển phải): dời tâm cho đích nằm giữa vùng còn lại.
  return {
    x: round(target.x - (padding.left - padding.right) / (2 * zoom)),
    y: round(target.y - (padding.top - padding.bottom) / (2 * zoom)),
    zoom,
  };
}

/**
 * Điểm canh camera khi vào tầng với một nút được chọn (bản đồ Crew: việc đang xem). Nếu thẻ tâm và thẻ được chọn cùng
 * vừa vùng nhìn ở READABLE_ZOOM thì canh giữa cả hai (thấy được yêu cầu lẫn việc đang xem), không thì canh vào thẻ chọn.
 */
export function pairFocus(
  level: RoadmapLevel,
  positions: Record<string, RoadmapPoint>,
  viewport: { width: number; height: number },
  padding: ViewPadding,
  focusId: string,
): RoadmapPoint {
  const node = level.nodes.find((n) => n.id === focusId);
  const p = positions[focusId];
  const c = positions[level.center.id] ?? { x: 0, y: 0 };
  if (!node || !p) return c;
  const a = roadmapNodeSize(level.center, true);
  const b = roadmapNodeSize(node, false);
  const minX = Math.min(c.x - a.w / 2, p.x - b.w / 2);
  const maxX = Math.max(c.x + a.w / 2, p.x + b.w / 2);
  const minY = Math.min(c.y - a.h / 2, p.y - b.h / 2);
  const maxY = Math.max(c.y + a.h / 2, p.y + b.h / 2);
  const availW = viewport.width - padding.left - padding.right;
  const availH = viewport.height - padding.top - padding.bottom;
  const fits = (maxX - minX) * READABLE_ZOOM <= availW && (maxY - minY) * READABLE_ZOOM <= availH;
  return fits ? { x: round((minX + maxX) / 2), y: round((minY + maxY) / 2) } : p;
}

/**
 * Khe của cây trên xuống: ngang giữa hai thẻ anh em (`gapX`), dọc giữa cha và hàng con (`gapY`, đủ cho dây cong), dọc
 * giữa hai hàng khi gói con lá thành lưới (`gapRow`). Cha có hơn `wrapAbove` con mà con nào cũng là lá thì con xếp
 * thành nhiều hàng, để cây rộng không kéo dài vô tận theo chiều ngang.
 */
const TOP_DOWN = { gapX: 28, gapY: 72, gapRow: 40, wrapAbove: 4, maxCols: 6 } as const;

interface TreeBlock {
  w: number;
  h: number;
  /** Đặt cả khối với góc trên trái ở (left, top). */
  place: (left: number, top: number) => void;
}

/**
 * Cây phân tầng trên xuống (tầng yêu cầu của Roadmap, bản đồ Crew): gốc ở (0,0), mỗi cây con là một khối chữ nhật rộng
 * bằng max(thẻ, tổng các khối con); cha nằm giữa phía trên khối con, con canh đỉnh thẳng hàng. Khối không giao nhau nên
 * thẻ không bao giờ chồng. Nút không nối được về gốc (cha thiếu, vòng cha-con) treo thẳng dưới gốc để không mất.
 * Thứ tự anh em giữ theo thứ tự trong `nodes`.
 */
export function topDownTree(level: RoadmapLevel): Record<string, RoadmapPoint> {
  const rootId = level.center.id;
  const nodes = level.nodes.filter((n) => n.kind !== 'more' && n.id !== rootId);
  const byId = new Map<string, RoadmapNode>([[rootId, level.center], ...nodes.map((n) => [n.id, n] as const)]);
  const kids = new Map<string, string[]>();
  for (const node of nodes) {
    const parent = node.parentId && byId.has(node.parentId) ? node.parentId : rootId;
    kids.set(parent, [...(kids.get(parent) ?? []), node.id]);
  }
  // Cây thật đi từ gốc (mỗi nút một lần); nút còn sót (vòng cha-con) gắn dưới gốc.
  const tree = new Map<string, string[]>();
  const seen = new Set([rootId]);
  const walk = (id: string) => {
    const children = (kids.get(id) ?? []).filter((c) => !seen.has(c));
    for (const c of children) seen.add(c);
    tree.set(id, children);
    for (const c of children) walk(c);
  };
  walk(rootId);
  const orphans = nodes.filter((n) => !seen.has(n.id)).map((n) => n.id);
  for (const id of orphans) seen.add(id);
  tree.set(rootId, [...(tree.get(rootId) ?? []), ...orphans]);
  for (const id of orphans) walk(id);

  const out: Record<string, RoadmapPoint> = {};
  const size = (id: string) => roadmapNodeSize(byId.get(id) as RoadmapNode, id === rootId);
  const isLeaf = (id: string) => !tree.get(id)?.length;

  const leafGrid = (children: string[]): TreeBlock => {
    const cols = Math.min(TOP_DOWN.maxCols, Math.max(TOP_DOWN.wrapAbove, Math.ceil(Math.sqrt(children.length * 2))));
    const rows = Math.ceil(children.length / cols);
    const cw = Math.max(...children.map((c) => size(c).w));
    const ch = Math.max(...children.map((c) => size(c).h));
    const w = cols * cw + (cols - 1) * TOP_DOWN.gapX;
    return {
      w,
      h: rows * ch + (rows - 1) * TOP_DOWN.gapRow,
      place: (left, top) => {
        children.forEach((c, i) => {
          const row = Math.floor(i / cols);
          const inRow = row === rows - 1 ? children.length - row * cols : cols;
          // Hàng cuối thiếu thẻ thì canh giữa.
          const shift = ((cols - inRow) * (cw + TOP_DOWN.gapX)) / 2;
          out[c] = {
            x: round(left + shift + (i % cols) * (cw + TOP_DOWN.gapX) + cw / 2),
            y: round(top + row * (ch + TOP_DOWN.gapRow) + size(c).h / 2),
          };
        });
      },
    };
  };

  const block = (id: string): TreeBlock => {
    const s = size(id);
    const children = tree.get(id) ?? [];
    if (!children.length) {
      return {
        w: s.w,
        h: s.h,
        place: (left, top) => (out[id] = { x: round(left + s.w / 2), y: round(top + s.h / 2) }),
      };
    }
    let row: TreeBlock;
    if (children.length > TOP_DOWN.wrapAbove && children.every(isLeaf)) row = leafGrid(children);
    else {
      const blocks = children.map(block);
      row = {
        w: blocks.reduce((sum, b) => sum + b.w, 0) + (blocks.length - 1) * TOP_DOWN.gapX,
        h: Math.max(...blocks.map((b) => b.h)),
        place: (left, top) => {
          let x = left;
          for (const b of blocks) {
            b.place(x, top);
            x += b.w + TOP_DOWN.gapX;
          }
        },
      };
    }
    const w = Math.max(s.w, row.w);
    return {
      w,
      h: s.h + TOP_DOWN.gapY + row.h,
      place: (left, top) => {
        out[id] = { x: round(left + w / 2), y: round(top + s.h / 2) };
        row.place(left + (w - row.w) / 2, top + s.h + TOP_DOWN.gapY);
      },
    };
  };

  const root = block(rootId);
  const s = size(rootId);
  root.place(-root.w / 2, -s.h / 2);
  delete out[rootId];
  return out;
}

/**
 * Cạnh "đang chạy" (có hiệu ứng dòng chảy): cạnh cha-con mà nhánh đích có việc đang làm (`in_progress`) — tức đường
 * từ gốc xuống tới mọi việc đang làm — và cạnh chặn/vòng sửa có một đầu đang làm. Cha đang làm không tự làm mọi dây
 * xuống con chạy theo, vì yêu cầu gốc luôn "đang làm" khi có việc con chạy.
 */
export function runningEdgeIds(level: RoadmapLevel): Set<string> {
  const active = new Set([level.center, ...level.nodes].filter((n) => n.status === 'in_progress').map((n) => n.id));
  const out = new Set<string>();
  if (!active.size) return out;
  const children = new Map<string, string[]>();
  for (const e of level.edges) {
    if (e.kind === 'parent') children.set(e.source, [...(children.get(e.source) ?? []), e.target]);
  }
  const memo = new Map<string, boolean>();
  const hasActive = (id: string, path: Set<string>): boolean => {
    const known = memo.get(id);
    if (known !== undefined) return known;
    if (path.has(id)) return false;
    path.add(id);
    const value = active.has(id) || (children.get(id) ?? []).some((c) => hasActive(c, path));
    path.delete(id);
    memo.set(id, value);
    return value;
  };
  for (const e of level.edges) {
    const running = e.kind === 'parent' ? hasActive(e.target, new Set()) : active.has(e.source) || active.has(e.target);
    if (running) out.add(e.id);
  }
  return out;
}

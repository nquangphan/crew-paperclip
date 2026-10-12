// crew: tự dựng
// Bố cục thuần của bản đồ Roadmap: tâm ở gốc (0,0), nút con tỏa tròn. Không phụ thuộc thư viện vẽ.
import type { RoadmapLevel, RoadmapPoint } from './roadmap-types';

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

/** Kích thước gần đúng (đơn vị bản đồ) của mặt nút theo loại, khớp class trong roadmap-node.tsx. */
const NODE_SIZE: Record<RoadmapLevel['center']['kind'], { w: number; h: number }> = {
  company: { w: 160, h: 160 },
  project: { w: 136, h: 136 },
  request: { w: 200, h: 80 },
  ticket: { w: 180, h: 72 },
  docs: { w: 180, h: 60 },
  folder: { w: 180, h: 60 },
  page: { w: 180, h: 60 },
  more: { w: 120, h: 40 },
};
const CENTER_SIZE: Partial<Record<RoadmapLevel['center']['kind'], { w: number; h: number }>> = {
  project: { w: 160, h: 160 },
  request: { w: 232, h: 120 },
  folder: { w: 200, h: 64 },
  docs: { w: 200, h: 64 },
};

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
    const s = (i === 0 ? CENTER_SIZE[node.kind] : undefined) ?? NODE_SIZE[node.kind];
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

// crew: tự dựng
// Bố cục thuần của bản đồ Roadmap: tâm ở gốc (0,0), nút con tỏa tròn. Không phụ thuộc thư viện vẽ.
import type { RoadmapLevel, RoadmapPoint } from './roadmap-types';

/**
 * Đặt `n` điểm trên các vòng đồng tâm quanh gốc, vòng đầu bán kính `r0`, mỗi vòng sau xa thêm `gap`. Mỗi vòng chứa
 * nhiều nhất `⌊2πr / spacing⌋` điểm (vòng ngoài chứa nhiều hơn), vòng lẻ xoay nửa bước để nút không thẳng hàng.
 * Điểm đầu nằm ở đỉnh (12 giờ), đi theo chiều kim đồng hồ.
 */
export function rings(n: number, r0: number, gap: number, spacing: number): RoadmapPoint[] {
  const points: RoadmapPoint[] = [];
  for (let ring = 0; points.length < n; ring++) {
    const r = r0 + ring * gap;
    const cap = Math.max(1, Math.floor((2 * Math.PI * r) / spacing));
    const take = Math.min(cap, n - points.length);
    const offset = ring % 2 ? Math.PI / take : 0;
    for (let i = 0; i < take; i++) {
      const a = -Math.PI / 2 + offset + (2 * Math.PI * i) / take;
      points.push({ x: round(r * Math.cos(a)), y: round(r * Math.sin(a)) });
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
  round: { r0: 300, gap: 200, spacing: 200 },
  card: { r0: 320, gap: 190, spacing: 250 },
} as const;
/** Ít nút thì vòng đầu nhỏ lại để bản đồ không quá thưa (vẫn đủ chỗ cho nút). */
const FEW = 4;
const FEW_R0 = { round: 230, card: 260 } as const;

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
  const points = rings(level.nodes.length, r0, p.gap, p.spacing);
  level.nodes.forEach((node, i) => {
    out[node.id] = points[i];
  });
  return out;
}

const round = (v: number) => Math.round(v * 10) / 10;

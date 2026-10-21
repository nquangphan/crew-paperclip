import { describe, expect, it } from 'vitest';
import {
  layoutLevel,
  READABLE_ZOOM,
  type RoadmapLevel,
  type RoadmapNode,
  radialTree,
  readableView,
  rings,
  roadmapNodeSize,
  runningEdgeIds,
} from '@/ds';

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const minPairDistance = (points: { x: number; y: number }[]) => {
  let min = Number.POSITIVE_INFINITY;
  for (let i = 0; i < points.length; i++)
    for (let j = i + 1; j < points.length; j++) {
      min = Math.min(min, dist(points[i], points[j]));
    }
  return min;
};
const angle = (p: { x: number; y: number }) => {
  const a = Math.atan2(p.y, p.x);
  return a < -Math.PI / 2 ? a + 2 * Math.PI : a;
};

describe('rings', () => {
  it('đủ n điểm, điểm đầu ở đỉnh, vòng ngoài chứa nhiều hơn', () => {
    const pts = rings(30, 300, 200, 200);
    expect(pts).toHaveLength(30);
    expect(pts[0].x).toBeCloseTo(0);
    expect(pts[0].y).toBeCloseTo(-300);
    const r = (p: { x: number; y: number }) => Math.round(Math.hypot(p.x, p.y));
    const inner = pts.filter((p) => r(p) === 300).length;
    const outer = pts.filter((p) => r(p) === 500).length;
    expect(outer).toBeGreaterThan(inner);
  });

  it.each([
    [10, 300, 200, 200],
    [60, 320, 250, 250],
    [150, 280, 230, 200],
  ])('rings(%i) không chồng nút: khoảng cách tối thiểu ≥ spacing·0.9', (n, r0, gap, spacing) => {
    expect(minPairDistance(rings(n, r0, gap, spacing))).toBeGreaterThanOrEqual(spacing * 0.9);
  });

  it('n = 0 trả rỗng', () => {
    expect(rings(0, 300, 200, 200)).toEqual([]);
  });
});

describe('radialTree', () => {
  const nodes = [
    { id: 'a', parentId: 'root' },
    { id: 'b', parentId: 'root' },
    { id: 'a1', parentId: 'a' },
    { id: 'a2', parentId: 'a' },
    { id: 'b1', parentId: 'b' },
  ];

  it('con xa tâm hơn cha và nằm trong cung của cha', () => {
    const pos = radialTree('root', nodes);
    expect(Object.keys(pos).sort()).toEqual(['a', 'a1', 'a2', 'b', 'b1']);
    const r = (id: string) => Math.hypot(pos[id].x, pos[id].y);
    expect(r('a1')).toBeGreaterThan(r('a'));
    // a có 2 lá trên tổng 3: cung [-90°, 150°); con a1, a2 nằm trong cung đó.
    const lo = -Math.PI / 2;
    const hi = -Math.PI / 2 + (2 * Math.PI * 2) / 3;
    for (const id of ['a', 'a1', 'a2']) {
      expect(angle(pos[id])).toBeGreaterThanOrEqual(lo);
      expect(angle(pos[id])).toBeLessThan(hi);
    }
    expect(angle(pos.b1)).toBeGreaterThanOrEqual(hi);
  });

  it('vòng cha-con hỏng không treo, nút không nối về gốc bị bỏ', () => {
    const pos = radialTree('root', [
      { id: 'x', parentId: 'y' },
      { id: 'y', parentId: 'x' },
      { id: 'a', parentId: 'root' },
      { id: 'root', parentId: 'a' },
    ]);
    expect(Object.keys(pos)).toEqual(['a']);
  });

  it('cây nhiều lá thì vòng đầu nới ra', () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ id: `n${i}`, parentId: 'root' }));
    const pos = radialTree('root', many);
    expect(Math.hypot(pos.n0.x, pos.n0.y)).toBeGreaterThan(1500);
    expect(minPairDistance(Object.values(pos))).toBeGreaterThanOrEqual(110);
  });
});

describe('layoutLevel', () => {
  const node = (id: string, kind: RoadmapLevel['center']['kind'], parentId?: string) => ({
    id,
    kind,
    title: id,
    parentId,
  });

  it('tâm ở gốc, nút vòng quanh tâm (ít nút thì vòng nhỏ hơn)', () => {
    const pos = layoutLevel({
      center: node('c', 'company'),
      nodes: [node('p1', 'project'), node('p2', 'project')],
      edges: [],
      overflow: 0,
      layout: 'rings',
    });
    expect(pos.c).toEqual({ x: 0, y: 0 });
    expect(Math.round(Math.hypot(pos.p1.x, pos.p1.y))).toBe(230);
  });

  it('tầng cây: nút "+N khác" ngay dưới tâm', () => {
    const pos = layoutLevel({
      center: node('r', 'request'),
      nodes: [node('t1', 'ticket', 'r'), { id: 'more', kind: 'more', title: '', extra: 3 }],
      edges: [],
      overflow: 3,
      layout: 'tree',
    });
    expect(pos.more).toEqual({ x: 0, y: 150 });
    expect(pos.t1).toBeDefined();
  });
});

describe('readableView', () => {
  const pad = { top: 0, right: 0, bottom: 0, left: 0 };
  const level = (n: number): RoadmapLevel => ({
    center: { id: 'p', kind: 'project', title: 'p' },
    nodes: Array.from({ length: n }, (_, i) => ({ id: `r${i}`, kind: 'request' as const, title: `r${i}` })),
    edges: [],
    overflow: 0,
    layout: 'rings',
  });

  it('tầng vừa khung thì canh giữa cả tầng, không phóng quá 1.2', () => {
    const l = level(2);
    const v = readableView(l, layoutLevel(l), { width: 2000, height: 2000 }, pad);
    expect(v.zoom).toBeCloseTo(1.2);
  });

  it('tầng lớn hơn khung: giữ độ phóng đọc được, tâm ở nút focus thay vì thu nhỏ', () => {
    const l = level(9);
    const pos = layoutLevel(l);
    const v = readableView(l, pos, { width: 800, height: 500 }, pad, pos.r3);
    expect(v.zoom).toBe(READABLE_ZOOM);
    expect(v).toMatchObject({ x: pos.r3.x, y: pos.r3.y });
  });

  it('phần chừa lệch thì dời tâm cho đích nằm giữa vùng còn lại', () => {
    const l = level(9);
    const v = readableView(l, layoutLevel(l), { width: 400, height: 400 }, { top: 40, right: 0, bottom: 0, left: 0 });
    expect(v).toMatchObject({ x: 0, y: -20, zoom: READABLE_ZOOM });
  });
});

describe('cây trên xuống (top-down)', () => {
  const ticket = (id: string, parentId: string, status = 'todo'): RoadmapNode => ({
    id,
    kind: 'ticket',
    title: id,
    parentId,
    status,
  });
  const tree = (nodes: RoadmapNode[]): RoadmapLevel => ({
    center: { id: 'r', kind: 'request', title: 'r', status: 'in_progress' },
    nodes,
    edges: nodes.map((n) => ({
      id: `${n.parentId}->${n.id}`,
      source: n.parentId as string,
      target: n.id,
      kind: 'parent',
    })),
    overflow: 0,
    layout: 'top-down',
  });
  const boxes = (level: RoadmapLevel) => {
    const pos = layoutLevel(level);
    return [level.center, ...level.nodes].map((n, i) => ({ n, p: pos[n.id], s: roadmapNodeSize(n, i === 0) }));
  };
  const overlaps = (level: RoadmapLevel) => {
    const all = boxes(level);
    const hits: string[] = [];
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const [a, b] = [all[i], all[j]];
        if (Math.abs(a.p.x - b.p.x) < (a.s.w + b.s.w) / 2 && Math.abs(a.p.y - b.p.y) < (a.s.h + b.s.h) / 2) {
          hits.push(`${a.n.id}/${b.n.id}`);
        }
      }
    }
    return hits;
  };
  /** Cây đều: `width` con mỗi nút, sâu `depth` tầng. */
  const uniform = (width: number, depth: number) => {
    const nodes: RoadmapNode[] = [];
    let parents = ['r'];
    for (let d = 0; d < depth; d++) {
      const next: string[] = [];
      for (const p of parents) {
        for (let i = 0; i < width; i++) {
          nodes.push(ticket(`${p}-${i}`, p));
          next.push(`${p}-${i}`);
        }
      }
      parents = next;
    }
    return tree(nodes);
  };

  it.each([
    ['3 con', 3, 1],
    ['3 nhánh × 3 tầng', 3, 3],
    ['2 nhánh × 5 tầng', 2, 5],
    ['24 con lá (xếp nhiều hàng)', 24, 1],
  ])('%s: cha luôn nằm trên con, không thẻ nào chồng nhau', (_name, width, depth) => {
    const level = uniform(width, depth);
    const all = boxes(level);
    const byId = new Map(all.map((b) => [b.n.id, b]));
    expect(byId.get('r')?.p).toEqual({ x: 0, y: 0 });
    for (const node of level.nodes) {
      const child = byId.get(node.id);
      const parent = byId.get(node.parentId as string);
      if (!child || !parent) throw new Error(`thiếu vị trí ${node.id}`);
      expect(child.p.y - child.s.h / 2).toBeGreaterThan(parent.p.y + parent.s.h / 2);
    }
    expect(overlaps(level)).toEqual([]);
  });

  it.each([
    ['3 nhánh × 2 tầng', 3, 2],
    ['24 con lá (xếp nhiều hàng)', 24, 1],
  ])('%s, thẻ cao thấp khác nhau theo số dòng run: không thẻ nào chồng nhau', (_name, width, depth) => {
    const level = uniform(width, depth);
    const run = (i: number) => ({
      id: `run-${i}`,
      status: 'succeeded',
      agentName: 'executor-1',
      model: 'claude-sonnet-5',
      startedAt: null,
      finishedAt: null,
      costUsd: 0.5,
    });
    level.nodes.forEach((node, i) => {
      const lines = i % 4;
      if (lines === 0) return;
      node.runs = {
        runs: Array.from({ length: lines }, (_, k) => run(k)),
        count: lines + (i % 3),
        total: { count: lines, costUsd: 1, subscription: true, tree: false },
      };
      if (i % 5 === 0) node.detail = 'Đang duyệt';
    });
    level.center.runs = { runs: [run(0)], count: 1, total: { count: 40, costUsd: 9, subscription: true, tree: true } };
    const heights = new Set(boxes(level).map((b) => b.s.h));
    expect(heights.size).toBeGreaterThan(2);
    expect(overlaps(level)).toEqual([]);
  });

  it('nhiều con lá thì gói thành lưới để cây không quá rộng', () => {
    const level = uniform(24, 1);
    const xs = boxes(level).map((b) => b.p.x);
    const width = Math.max(...xs) - Math.min(...xs);
    expect(width).toBeLessThan(6 * 260);
    expect(new Set(level.nodes.map((n) => layoutLevel(level)[n.id].y)).size).toBeGreaterThan(1);
  });

  it('nút có cha không nằm trên bản đồ vẫn được đặt (treo dưới gốc); nút "+N" cạnh phải gốc', () => {
    const level = tree([ticket('a', 'r'), ticket('b', 'missing')]);
    level.nodes.push({ id: 'more', kind: 'more', title: '', extra: 4 });
    const pos = layoutLevel(level);
    expect(pos.b.y).toBe(pos.a.y);
    expect(pos.more.y).toBe(0);
    expect(pos.more.x).toBeGreaterThan(roadmapNodeSize(level.center, true).w / 2);
    expect(overlaps(level)).toEqual([]);
  });
});

describe('runningEdgeIds', () => {
  const base = (status: Record<string, string>): RoadmapLevel => ({
    center: { id: 'r', kind: 'request', title: 'r', status: status.r ?? 'todo' },
    nodes: ['a', 'a1', 'b'].map((id) => ({
      id,
      kind: 'ticket' as const,
      title: id,
      parentId: id === 'a1' ? 'a' : 'r',
      status: status[id] ?? 'todo',
    })),
    edges: [
      { id: 'r->a', source: 'r', target: 'a', kind: 'parent' },
      { id: 'a->a1', source: 'a', target: 'a1', kind: 'parent' },
      { id: 'r->b', source: 'r', target: 'b', kind: 'parent' },
      { id: 'b=>a', source: 'b', target: 'a', kind: 'blocks' },
      { id: 'a1:fix', source: 'a1', target: 'a1', kind: 'repair' },
    ],
    overflow: 0,
    layout: 'top-down',
  });

  it('không việc nào đang làm thì không dây nào chạy', () => {
    expect([...runningEdgeIds(base({ r: 'done', b: 'blocked' }))]).toEqual([]);
  });

  it('cháu đang làm: cả đường từ gốc xuống tới nó chạy, cùng cạnh chặn/vòng sửa chạm nó', () => {
    const ids = runningEdgeIds(base({ r: 'in_progress', a1: 'in_progress' }));
    expect([...ids].sort()).toEqual(['a->a1', 'a1:fix', 'r->a']);
  });

  it('cạnh chặn chạy khi nút nguồn đang làm', () => {
    expect(runningEdgeIds(base({ b: 'in_progress' })).has('b=>a')).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { layoutLevel, READABLE_ZOOM, type RoadmapLevel, radialTree, readableView, rings } from '@/ds';

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

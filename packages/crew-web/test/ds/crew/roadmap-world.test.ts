import { describe, expect, it } from 'vitest';
import {
  blockPaths,
  cardsInView,
  containsBox,
  createIslandCache,
  fitWorldBox,
  layoutWorld,
  nodeAtPoint,
  padBox,
  platesInView,
  type RoadmapLevel,
  type RoadmapNode,
  roadmapNodeSize,
  runningInView,
  topDownTree,
  type WorldBox,
  type WorldInput,
  worldFocusView,
  worldLod,
} from '@/ds';

const PADDING = { top: 52, right: 64, bottom: 24, left: 24 };
const VIEWPORT = { width: 1200, height: 800 };

const ticket = (id: string, parentId: string, status = 'todo'): RoadmapNode => ({
  id,
  kind: 'ticket',
  title: `Việc ${id}`,
  identifier: id.toUpperCase(),
  status,
  parentId,
});
const request = (id: string, children: string[][] = [], status = 'todo'): RoadmapLevel => ({
  center: { id, kind: 'request', title: `Yêu cầu ${id}`, identifier: id.toUpperCase(), status },
  nodes: children.map(([cid, parent, s]) => ticket(cid, parent ?? id, s)),
  edges: children.map(([cid, parent]) => ({
    id: `parent:${parent ?? id}:${cid}`,
    source: parent ?? id,
    target: cid,
    kind: 'parent' as const,
  })),
  overflow: 0,
  layout: 'top-down',
});
const project = (id: string): RoadmapNode => ({ id, kind: 'project', title: id, total: 0, open: 0 });

function input(): WorldInput {
  return {
    company: { id: 'company', kind: 'company', title: '2P', total: 2, open: 3 },
    clusters: [
      {
        node: project('p1'),
        islands: [
          request('r1', [['t1'], ['t2'], ['t3', 't1', 'in_progress']], 'in_progress'),
          request('r2', [['t4']]),
          request('r3'),
        ],
      },
      { node: project('p2'), islands: [request('r4', [['t5'], ['t6']])] },
      { node: project('empty'), islands: [] },
    ],
  };
}

const overlaps = (a: WorldBox, b: WorldBox) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (inner: WorldBox, outer: WorldBox) =>
  inner.x >= outer.x - 0.5 &&
  inner.y >= outer.y - 0.5 &&
  inner.x + inner.w <= outer.x + outer.w + 0.5 &&
  inner.y + inner.h <= outer.y + outer.h + 0.5;

describe('layoutWorld', () => {
  it('công ty ở gốc, project một hàng dưới công ty theo thứ tự, đảo nằm dưới project của nó', () => {
    const world = layoutWorld(input());
    const [p1, p2, empty] = world.clusters;
    expect(world.clusters.map((c) => c.id)).toEqual(['p1', 'p2', 'empty']);
    const orb = (id: string) => world.nodes.get(id) as { x: number; y: number };
    expect(orb('p1').x).toBeLessThan(orb('p2').x);
    expect(orb('p2').x).toBeLessThan(orb('empty').x);
    expect(orb('p1').y).toBe(orb('p2').y);
    expect(orb('p1').y).toBeGreaterThan(0);
    for (const island of world.islands) {
      const cluster = world.clusters.find((c) => c.id === island.cluster) as (typeof world.clusters)[number];
      expect(inside(island.box, cluster.box)).toBe(true);
      expect(island.box.y).toBeGreaterThan(orb(cluster.id).y);
    }
    // Cụm không chồng nhau; project rỗng vẫn có chỗ.
    expect(overlaps(p1.box, p2.box)).toBe(false);
    expect(overlaps(p2.box, empty.box)).toBe(false);
    expect(empty.box.w).toBeGreaterThan(0);
    // Công ty ở trên, giữa hàng project (thế giới cân hai bên công ty).
    expect(world.company.y).toBeLessThan(orb('p1').y);
    expect(Math.abs(world.bounds.x + world.bounds.w / 2 - world.company.x)).toBeLessThan(1);
  });

  it('mỗi đảo xếp y như cây trên xuống của bản đồ Crew (topDownTree), thẻ không chồng nhau giữa các đảo', () => {
    const world = layoutWorld(input());
    const level = input().clusters[0].islands[0];
    const rel = topDownTree(level);
    const root = world.nodes.get('r1') as { x: number; y: number; center: boolean };
    expect(root.center).toBe(true);
    for (const id of ['t1', 't2', 't3']) {
      const n = world.nodes.get(id) as { x: number; y: number };
      expect(n.x - root.x).toBeCloseTo(rel[id].x);
      expect(n.y - root.y).toBeCloseTo(rel[id].y);
    }
    expect(world.nodes.get('t1')).toMatchObject(roadmapNodeSize(level.nodes[0], false));
    const boxes = world.islands.map((i) => i.box);
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) expect(overlaps(boxes[i], boxes[j])).toBe(false);
  });

  it('cạnh trong đảo giữ nguyên, thêm dây trục công ty → project → gốc đảo; dây đang chạy theo runningEdgeIds', () => {
    const world = layoutWorld(input());
    expect(world.edges.map((e) => e.id)).toContain('parent:t1:t3');
    expect(world.edges.find((e) => e.id === 'parent:t1:t3')?.island).toBe('r1');
    expect(world.trunks.map((t) => `${t.source}>${t.target}`)).toEqual([
      'company>p1',
      'company>p2',
      'company>empty',
      'p1>r1',
      'p1>r2',
      'p1>r3',
      'p2>r4',
    ]);
    expect([...world.running].sort()).toEqual(['parent:r1:t1', 'parent:t1:t3']);
  });

  it('nhớ bố cục từng đảo: dữ liệu mới mà đảo không đổi thì dùng lại, chỉ tính lại đảo đổi', () => {
    const cache = createIslandCache();
    const first = layoutWorld(input(), cache);
    const before = cache.get('r2');
    const next = input();
    // Đổi trạng thái (không đổi kích thước): đảo r1 dùng lại; thêm việc cho r2: chỉ r2 tính lại.
    const [r1, , r3] = next.clusters[0].islands;
    r1.nodes[0].status = 'done';
    next.clusters = [
      { ...next.clusters[0], islands: [r1, request('r2', [['t4'], ['t7']]), r3] },
      ...next.clusters.slice(1),
    ];
    const r1Before = cache.get('r1');
    const second = layoutWorld(next, cache);
    expect(cache.get('r1')).toBe(r1Before);
    expect(cache.get('r2')).not.toBe(before);
    expect(second.nodes.get('t7')).toBeDefined();
    // Đảo đứng trước đảo đổi không dời chỗ.
    expect(second.nodes.get('r1')).toMatchObject({ x: first.nodes.get('r1')?.x, y: first.nodes.get('r1')?.y });
  });

  it('nhiều đảo thì xếp nhiều kệ trong cụm (không kéo một hàng dài vô tận)', () => {
    const many: WorldInput = {
      company: { id: 'company', kind: 'company', title: 'x' },
      clusters: [
        {
          node: project('p'),
          islands: Array.from({ length: 30 }, (_, i) => request(`q${i}`, [[`q${i}a`], [`q${i}b`]])),
        },
      ],
    };
    const world = layoutWorld(many);
    const rows = new Set(world.islands.map((i) => Math.round(i.box.y)));
    expect(rows.size).toBeGreaterThan(2);
    expect(world.clusters[0].box.w).toBeLessThan(world.clusters[0].box.h * 3);
  });
});

describe('worldLod', () => {
  it('ô màu < 16%, nhãn 16–55%, thẻ ≥ 55%', () => {
    expect(worldLod(0.06, null)).toBe(0);
    expect(worldLod(0.3, null)).toBe(1);
    expect(worldLod(1, null)).toBe(2);
  });
  it('ngưỡng có trễ ±2% để không nhấp nháy quanh mốc', () => {
    expect(worldLod(0.17, 0)).toBe(0);
    expect(worldLod(0.19, 0)).toBe(1);
    expect(worldLod(0.54, 2)).toBe(2);
    expect(worldLod(0.52, 2)).toBe(1);
    expect(worldLod(0.15, 1)).toBe(1);
    expect(worldLod(0.13, 1)).toBe(0);
  });
});

describe('fitWorldBox', () => {
  const box = { x: 0, y: 0, w: 1000, h: 500 };
  it('vừa khung trong giới hạn độ phóng, tâm lệch theo phần chừa', () => {
    const v = fitWorldBox(box, VIEWPORT, PADDING, { min: 0.1, max: 2 });
    const k = Math.min((1200 - 88) / 1000, (800 - 76) / 500);
    expect(v.zoom).toBeCloseTo(k);
    expect(v.x).toBeCloseTo(500 + (64 - 24) / 2 / k);
    expect(v.y).toBeCloseTo(250 - (52 - 24) / 2 / k);
  });
  it('không vừa ở độ phóng tối thiểu: canh mép trên (topAlign)', () => {
    const tall = { x: 0, y: 100, w: 400, h: 5000 };
    const v = fitWorldBox(tall, VIEWPORT, PADDING, { min: 0.6, max: 1.1, topAlign: true });
    expect(v.zoom).toBe(0.6);
    // Mép trên của hộp nằm ngay dưới phần chừa trên.
    const screenTop = VIEWPORT.height / 2 + (tall.y - v.y) * v.zoom;
    expect(screenTop).toBeCloseTo(PADDING.top);
  });
});

describe('worldFocusView: điều hướng zoom', () => {
  const world = layoutWorld(input());
  it('toàn cảnh thấy mọi project (mức ô màu khi thế giới rộng)', () => {
    const v = worldFocusView(world, { kind: 'overview' }, VIEWPORT, PADDING);
    for (const c of world.clusters) {
      const sx = VIEWPORT.width / 2 + (c.box.x - v.x) * v.zoom;
      const ex = VIEWPORT.width / 2 + (c.box.x + c.box.w - v.x) * v.zoom;
      expect(sx).toBeGreaterThanOrEqual(0);
      expect(ex).toBeLessThanOrEqual(VIEWPORT.width);
    }
    expect(v.zoom).toBeLessThanOrEqual(1);
  });
  it('project: vừa cụm ở mức nhãn (22–50%)', () => {
    const v = worldFocusView(world, { kind: 'cluster', id: 'p1' }, VIEWPORT, PADDING);
    expect(v.zoom).toBeGreaterThanOrEqual(0.22);
    expect(v.zoom).toBeLessThanOrEqual(0.5);
    expect(worldLod(v.zoom, null)).toBe(1);
  });
  it('yêu cầu: vừa đảo ở mức thẻ đầy đủ', () => {
    const v = worldFocusView(world, { kind: 'island', id: 'r1' }, VIEWPORT, PADDING);
    expect(worldLod(v.zoom, null)).toBe(2);
    const island = world.islands.find((i) => i.id === 'r1') as { box: WorldBox };
    expect(v.x).toBeGreaterThan(island.box.x);
    expect(v.x).toBeLessThan(island.box.x + island.box.w);
  });
  it('việc con: canh vào thẻ ở 105%', () => {
    const t3 = world.nodes.get('t3') as { x: number; y: number };
    const v = worldFocusView(world, { kind: 'node', id: 't3' }, VIEWPORT, PADDING);
    expect(v.zoom).toBeCloseTo(1.05);
    expect(v.x).toBeCloseTo(t3.x);
    expect(Math.abs(v.y - t3.y)).toBeLessThan(80);
  });
  it('mục không có thì về toàn cảnh', () => {
    expect(worldFocusView(world, { kind: 'node', id: 'nope' }, VIEWPORT, PADDING)).toEqual(
      worldFocusView(world, { kind: 'overview' }, VIEWPORT, PADDING),
    );
  });
});

describe('ô màu, bấm ở mức xa, nhãn và dây chạy trong khung', () => {
  const world = layoutWorld(input());
  it('ô màu gom theo màu trạng thái: một path mỗi màu, mỗi việc một hình chữ nhật', () => {
    const paths = blockPaths(world);
    const tones = paths.map((p) => p.tone);
    expect(new Set(tones).size).toBe(tones.length);
    const rects = paths.reduce((n, p) => n + (p.d.match(/M/g)?.length ?? 0), 0);
    expect(rects).toBe(world.nodes.size - 1 - world.clusters.length);
    expect(paths.find((p) => p.tone.includes('in_progress'))?.running).toBe(true);
  });
  it('bấm vào ô của một việc ở mức xa tìm đúng việc đó', () => {
    const t2 = world.nodes.get('t2') as { x: number; y: number };
    expect(nodeAtPoint(world, { x: t2.x + 5, y: t2.y - 5 })?.node.id).toBe('t2');
    expect(nodeAtPoint(world, { x: -99999, y: -99999 })).toBeNull();
  });
  it('nhãn nổi chỉ của đảo trong khung, tối đa theo trần, gần tâm trước', () => {
    const r1 = world.islands.find((i) => i.id === 'r1') as { box: WorldBox };
    const view = { x: r1.box.x - 10, y: r1.box.y - 10, w: r1.box.w + 20, h: r1.box.h + 20 };
    expect(platesInView(world, view, 80).map((i) => i.id)).toEqual(['r1']);
    expect(platesInView(world, world.bounds, 2)).toHaveLength(2);
  });
  it('lớp chạy trên dây chỉ cho dây trong khung, có trần', () => {
    expect([...runningInView(world, world.bounds, 30)].sort()).toEqual(['parent:r1:t1', 'parent:t1:t3']);
    expect(runningInView(world, world.bounds, 1).size).toBe(1);
    expect(runningInView(world, { x: 1e6, y: 1e6, w: 10, h: 10 }, 30).size).toBe(0);
  });
});

describe('trần phóng nút tròn', () => {
  it('nút project không lớn quá khoảng cách giữa hai cụm; nút công ty không đè hàng project', () => {
    const world = layoutWorld(input());
    const xs = world.clusters.map((c) => (world.nodes.get(c.id) as { x: number }).x);
    const spacing = Math.min(...xs.slice(1).map((x, i) => x - xs[i]));
    expect(world.orbCap.project * 136).toBeLessThanOrEqual(spacing);
    expect(world.orbCap.project).toBeGreaterThanOrEqual(1);
    const p1 = world.nodes.get('p1') as { y: number; h: number };
    const rowTop = p1.y + p1.h / 2 - p1.h * world.orbCap.project;
    expect(world.company.y + (world.company.h * world.orbCap.company) / 2).toBeLessThanOrEqual(rowTop);
  });
});

describe('thẻ DOM ở mức thẻ đầy đủ', () => {
  const world = layoutWorld(input());
  it('chỉ thẻ trong khung + nửa khung đệm, tối đa theo trần, gần tâm trước; luôn giữ nút đang xem', () => {
    const r1 = world.islands.find((i) => i.id === 'r1') as { box: WorldBox };
    const view = { x: r1.box.x, y: r1.box.y, w: r1.box.w, h: r1.box.h };
    const ids = cardsInView(world, view, 120).map((n) => n.node.id);
    expect(ids).toEqual(expect.arrayContaining(['r1', 't1', 't2', 't3']));
    expect(ids).not.toContain('t5');
    expect(cardsInView(world, world.bounds, 2)).toHaveLength(2);
    expect(cardsInView(world, view, 2, 't5').map((n) => n.node.id)).toContain('t5');
  });
  it('khung đệm: nới nửa khung mỗi phía; hộp nằm trong hộp', () => {
    const v = { x: 0, y: 0, w: 100, h: 50 };
    expect(padBox(v, 0.5)).toEqual({ x: -50, y: -25, w: 200, h: 100 });
    expect(containsBox(padBox(v, 0.5), v)).toBe(true);
    expect(containsBox(v, padBox(v, 0.5))).toBe(false);
  });
  it('ô màu bỏ các nút đang vẽ thành thẻ (không chồng lên thẻ)', () => {
    const all = blockPaths(world).reduce((n, p) => n + (p.d.match(/M/g)?.length ?? 0), 0);
    const rest = blockPaths(world, new Set(['t1', 't2'])).reduce((n, p) => n + (p.d.match(/M/g)?.length ?? 0), 0);
    expect(rest).toBe(all - 2);
  });
});

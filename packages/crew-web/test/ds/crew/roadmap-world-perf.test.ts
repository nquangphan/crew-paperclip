// Bố cục thế giới với dữ liệu cỡ company thật (165 yêu cầu, ~800 việc): tính một lần, lần sau (dữ liệu live, cùng cây)
// dùng lại bố cục từng đảo đã nhớ. In số đo để ghi vào báo cáo hiệu năng.
import { describe, expect, it } from 'vitest';
import { createIslandCache, layoutWorld, type RoadmapLevel, type WorldInput } from '@/ds';

function bigInput(requests = 165, projects = 5): WorldInput {
  let seed = 7;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const clusters = Array.from({ length: projects }, (_, p) => ({
    node: { id: `p${p}`, kind: 'project' as const, title: `p${p}` },
    islands: [] as RoadmapLevel[],
  }));
  let n = 0;
  for (let r = 0; r < requests; r++) {
    const root = `r${r}`;
    const size = r === 3 ? 60 : r % 23 === 0 ? 20 : Math.floor(rnd() * 6);
    const ids: string[] = [root];
    const nodes = [];
    for (let k = 0; k < size; k++) {
      const id = `t${n++}`;
      const parentId = ids.length > 4 && rnd() < 0.3 ? ids[1 + Math.floor(rnd() * (ids.length - 1))] : root;
      nodes.push({ id, kind: 'ticket' as const, title: id, identifier: id, status: 'done', parentId });
      ids.push(id);
    }
    clusters[Math.floor(rnd() * projects)].islands.push({
      center: { id: root, kind: 'request', title: root, identifier: root, status: 'done' },
      nodes,
      edges: nodes.map((x) => ({ id: `e:${x.id}`, source: x.parentId, target: x.id, kind: 'parent' as const })),
      overflow: 0,
      layout: 'top-down',
    });
  }
  return { company: { id: 'company', kind: 'company', title: 'c' }, clusters };
}

describe('hiệu năng bố cục', () => {
  it('165 yêu cầu: dựng một lần, lần sau dùng lại bố cục đảo đã nhớ', () => {
    const input = bigInput();
    const cache = createIslandCache();
    const t0 = performance.now();
    const first = layoutWorld(input, cache);
    const t1 = performance.now();
    const entries = new Map(cache);
    const again = layoutWorld(bigInput(), cache);
    const t2 = performance.now();
    const nodes = first.nodes.size;
    console.log(
      `[roadmap-world] ${first.islands.length} đảo, ${nodes} nút: lần đầu ${(t1 - t0).toFixed(1)} ms, ` +
        `lần sau (nhớ đảo) ${(t2 - t1).toFixed(1)} ms`,
    );
    expect(nodes).toBeGreaterThan(600);
    for (const [id, entry] of entries) expect(cache.get(id)).toBe(entry);
    expect(again.nodes.get('t10')).toEqual(first.nodes.get('t10'));
    // Ngưỡng rộng (máy CI chậm): bố cục không được là nút thắt của khung hình đầu.
    expect(t1 - t0).toBeLessThan(500);
  });
});

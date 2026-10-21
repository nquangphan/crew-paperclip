import { beforeAll, describe, expect, it } from 'vitest';
import type { CrewMap as CrewMapData, CrewMapNode } from '@/api/crew/types';
import { layoutLevel, type RoadmapLevel, roadmapNodeSize } from '@/ds';
import { crewMapLevel } from '@/ds/widgets/crew/crew-map-level';
import { getI18n, initI18n } from '@/i18n';
import fixture from './__fixtures__/map.json';

const map = fixture as unknown as CrewMapData;
const t = ((key: string, opts?: Record<string, unknown>) => getI18n().t(key, opts)) as Parameters<
  typeof crewMapLevel
>[2];

beforeAll(async () => {
  await initI18n();
});

const issue = (id: string, parentId: string | null, over: Partial<CrewMapNode> = {}): CrewMapNode => ({
  id,
  identifier: `CRE-${id}`,
  title: `Việc ${id}`,
  status: 'todo',
  parentId,
  assignee: null,
  stage: null,
  reviewRounds: 0,
  maxReviewRounds: 3,
  kind: 'code',
  bundle: null,
  ...over,
});

function family(nodes: CrewMapNode[], edges: CrewMapData['edges'] = []): CrewMapData {
  const root = nodes[0];
  return { root, nodes, edges, diagnostics: [] };
}

/** Hai thẻ có chồng lên nhau không (kích thước như canvas dùng). */
function overlapping(level: RoadmapLevel) {
  const pos = layoutLevel(level);
  const all = [level.center, ...level.nodes];
  const hits: string[] = [];
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = roadmapNodeSize(all[i], i === 0);
      const b = roadmapNodeSize(all[j], j === 0);
      const pa = pos[all[i].id];
      const pb = pos[all[j].id];
      if (Math.abs(pa.x - pb.x) < (a.w + b.w) / 2 && Math.abs(pa.y - pb.y) < (a.h + b.h) / 2) {
        hits.push(`${all[i].id}/${all[j].id}`);
      }
    }
  }
  return hits;
}

describe('crewMapLevel', () => {
  it('gốc ở đỉnh (thẻ yêu cầu, đếm việc con xong), việc con là thẻ việc, thứ tự theo mã', () => {
    const { level } = crewMapLevel(map, 'i-b', t);
    expect(level.layout).toBe('top-down');
    expect(level.center).toMatchObject({ id: 'i-root', kind: 'request', identifier: 'CRE-36', total: 4, done: 1 });
    expect(level.nodes.map((n) => [n.id, n.kind, n.parentId])).toEqual([
      ['i-a', 'ticket', 'i-root'],
      ['i-b', 'ticket', 'i-root'],
      ['i-c', 'ticket', 'i-root'],
      ['i-fix', 'ticket', 'i-root'],
    ]);
    expect(level.nodes.find((n) => n.id === 'i-b')).toMatchObject({
      current: true,
      assignee: 'executor',
      detail: 'Reviewer',
    });
    expect(level.nodes.find((n) => n.id === 'i-c')?.current).toBe(false);
  });

  it('phụ thuộc thành cạnh "chặn", vòng sửa giữ nguyên, cạnh thiếu issue thành chẩn đoán', () => {
    const { level, diagnostics } = crewMapLevel(map, undefined, t);
    const edges = level.edges.map((e) => `${e.kind}:${e.source}>${e.target}`);
    expect(edges).toEqual([
      'parent:i-root>i-a',
      'parent:i-root>i-b',
      'parent:i-root>i-c',
      'parent:i-root>i-fix',
      'blocks:i-a>i-b',
      'repair:i-b>i-fix',
    ]);
    expect(diagnostics).toEqual(['Quan hệ Phải xong trước thiếu issue: i-b → i-ghost']);
    expect(new Set(level.edges.map((e) => e.id)).size).toBe(level.edges.length);
  });

  it('vòng sửa trên chính một việc giữ thành cạnh tự nối; cạnh trùng có id riêng', () => {
    const data = family(
      [issue('r', null), issue('a', 'r', { reviewRounds: 2 })],
      [
        { kind: 'repair', from: 'a', to: 'a', label: '2 vòng sửa' },
        { kind: 'repair', from: 'a', to: 'a' },
      ],
    );
    const { level } = crewMapLevel(data, undefined, t);
    const loops = level.edges.filter((e) => e.kind === 'repair');
    expect(loops.map((e) => [e.source, e.target])).toEqual([
      ['a', 'a'],
      ['a', 'a'],
    ]);
    expect(loops[0].id).not.toBe(loops[1].id);
    expect(level.nodes[0].detail).toBe('Vòng sửa 2/3 · Chưa có giai đoạn');
  });

  it('việc có cha ngoài bản đồ hoặc vòng cha-con vẫn được vẽ, treo dưới gốc', () => {
    const data = family([issue('r', null), issue('a', 'missing'), issue('b', 'c'), issue('c', 'b')]);
    const { level } = crewMapLevel(data, undefined, t);
    expect(level.nodes.map((n) => n.id)).toEqual(['a', 'b', 'c']);
    const parents = Object.fromEntries(level.nodes.map((n) => [n.id, n.parentId]));
    expect(parents.a).toBe('r');
    // Một trong hai nút của vòng được treo dưới gốc nên cả hai đều nối được về gốc.
    expect([parents.b, parents.c]).toContain('r');
    const pos = layoutLevel(level);
    for (const id of ['a', 'b', 'c']) expect(pos[id]).toBeDefined();
  });

  it('gốc là việc đang xem thì tô thẻ tâm', () => {
    const { level } = crewMapLevel(map, 'i-root', t);
    expect(level.center.current).toBe(true);
    expect(level.center.notes).toContain('Việc đang xem');
  });

  it('yêu cầu Viết tài liệu: việc code hiện là Viết tài liệu, việc sửa vẫn là Sửa', () => {
    const docsMap = family([issue('r', null), issue('a', 'r'), issue('f', 'r', { kind: 'fix' })]);
    const kindNote = (level: RoadmapLevel, id: string) =>
      [level.center, ...level.nodes].find((n) => n.id === id)?.notes?.[0];
    const docs = crewMapLevel(docsMap, undefined, t, { docs: true }).level;
    expect(kindNote(docs, 'r')).toBe('Viết tài liệu');
    expect(kindNote(docs, 'a')).toBe('Viết tài liệu');
    expect(kindNote(docs, 'f')).toBe('Sửa');
    const code = crewMapLevel(docsMap, undefined, t).level;
    expect(kindNote(code, 'a')).toBe('Lập trình');
  });
});

describe('bố cục cây trên xuống của bản đồ Crew', () => {
  it('gốc ở trên cùng, mỗi việc con nằm dưới cha, cha canh giữa hàng con, các con cùng hàng thẳng đỉnh', () => {
    const { level } = crewMapLevel(map, undefined, t);
    const pos = layoutLevel(level);
    const top = (id: string, center: boolean) =>
      pos[id].y -
      roadmapNodeSize(center ? level.center : (level.nodes.find((n) => n.id === id) as never), center).h / 2;
    for (const node of level.nodes) {
      const parent = node.parentId as string;
      const parentNode = parent === level.center.id ? level.center : level.nodes.find((n) => n.id === parent);
      const parentBottom = pos[parent].y + roadmapNodeSize(parentNode as never, parent === level.center.id).h / 2;
      expect(top(node.id, false)).toBeGreaterThan(parentBottom);
    }
    const kids = level.nodes.filter((n) => n.parentId === level.center.id);
    const xs = kids.map((n) => pos[n.id].x);
    expect(pos[level.center.id].x).toBeCloseTo((Math.min(...xs) + Math.max(...xs)) / 2);
    expect(new Set(kids.map((n) => top(n.id, false))).size).toBe(1);
    expect(overlapping(level)).toEqual([]);
  });

  it.each([
    ['rộng: 14 việc con', 14, 1],
    ['rộng: 24 việc con', 24, 1],
    ['sâu: 4 tầng, mỗi tầng 3 nhánh', 3, 4],
  ])('%s: không thẻ nào chồng lên nhau', (_name, width, depth) => {
    const nodes = [issue('r', null)];
    let parents = ['r'];
    for (let d = 0; d < depth; d++) {
      const next: string[] = [];
      for (const p of parents) {
        for (let i = 0; i < width; i++) {
          const id = `${p}-${i}`;
          nodes.push(
            issue(id, p, { stage: { currentStageId: 's', currentType: 'review', completed: [], position: 0 } }),
          );
          next.push(id);
        }
      }
      parents = next;
    }
    const { level } = crewMapLevel(family(nodes), undefined, t);
    expect(level.nodes).toHaveLength(nodes.length - 1);
    expect(overlapping(level)).toEqual([]);
  });
});

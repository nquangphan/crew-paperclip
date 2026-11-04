import type { CrewRoadmap, CrewRoadmapNode } from '@crew/paperclip-plugin/shared/map';
import { beforeAll, describe, expect, it } from 'vitest';
import { layoutWorld } from '@/ds';
import {
  buildWorldInput,
  focusOfNode,
  focusTrail,
  parentFocus,
  resolveFocus,
  type WorldDataInput,
  worldFocusOf,
  worldListItems,
} from '@/features/roadmap/roadmap-model';
import { getI18n, initI18n, setLanguage } from '@/i18n';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
});
const t = ((key: string, opts?: Record<string, unknown>) => getI18n().t(key, opts)) as WorldDataInput['t'];

const node = (id: string, n: number, over: Partial<CrewRoadmapNode> = {}): CrewRoadmapNode => ({
  id,
  identifier: `TPS-${n}`,
  title: `Việc ${id}`,
  status: 'todo',
  parentId: null,
  rootId: id,
  projectId: 'p1',
  createdByUserId: 'u1',
  createdAt: `2026-10-${String(10 + n).padStart(2, '0')}T00:00:00.000Z`,
  updatedAt: '2026-10-30T00:00:00.000Z',
  assignee: null,
  stage: null,
  reviewRounds: 0,
  maxReviewRounds: 5,
  kind: 'code',
  bundle: null,
  ...over,
});

const ROADMAP: CrewRoadmap = {
  requests: ['r2', 'r1', 'rB', 'loose'],
  nodes: [
    // r2 tạo sau r1 nhưng đứng trước trong danh sách worker: đảo vẫn xếp theo thứ tự tạo.
    node('r2', 5, { status: 'done' }),
    node('r1', 1, { status: 'in_progress' }),
    node('c1', 2, { parentId: 'r1', rootId: 'r1', status: 'done', assignee: { id: 'a1', name: 'executor-1' } }),
    node('c2', 3, { parentId: 'r1', rootId: 'r1', status: 'in_progress' }),
    node('c3', 4, { parentId: 'c2', rootId: 'r1' }),
    node('rB', 6, { projectId: 'p2' }),
    node('loose', 7, { projectId: null }),
  ],
  edges: [
    { kind: 'parent', from: 'r1', to: 'c1' },
    { kind: 'parent', from: 'r1', to: 'c2' },
    { kind: 'parent', from: 'c2', to: 'c3' },
    { kind: 'dependency', from: 'c1', to: 'c2' },
    { kind: 'repair', from: 'c2', to: 'c2' },
  ],
  diagnostics: [],
  truncated: false,
};

const PROJECTS = [
  { id: 'p2', name: 'Beta', color: null, archivedAt: null },
  { id: 'p1', name: 'Alpha', color: '#2b59c3', archivedAt: null },
  { id: 'old', name: 'Cũ', color: null, archivedAt: '2026-01-01' },
];

function data(over: Partial<WorldDataInput> = {}): WorldDataInput {
  return {
    companyName: '2P',
    projects: PROJECTS,
    roadmap: ROADMAP,
    includeNoProject: true,
    noProjectTitle: 'Chưa gắn project',
    docs: new Map([
      [
        'p1',
        {
          pages: [
            { path: 'README.md', title: 'Giới thiệu' },
            { path: 'docs/a.md', title: 'A' },
          ],
        },
      ],
    ]),
    t,
    ...over,
  };
}

describe('buildWorldInput', () => {
  it('project theo tên, bỏ project lưu trữ; "Chưa gắn project" cuối, chỉ cho owner', () => {
    const input = buildWorldInput(data());
    expect(input.clusters.map((c) => c.node.id)).toEqual(['p1', 'p2', 'none']);
    expect(buildWorldInput(data({ includeNoProject: false })).clusters.map((c) => c.node.id)).toEqual(['p1', 'p2']);
  });

  it('đếm trên nút công ty và project', () => {
    const input = buildWorldInput(data());
    expect(input.company).toMatchObject({ id: 'company', kind: 'company', title: '2P', total: 2, open: 3 });
    expect(input.clusters[0].node).toMatchObject({ kind: 'project', title: 'Alpha', total: 2, open: 1 });
  });

  it('Docs là đảo đầu của project, cây thư mục → trang; yêu cầu theo thứ tự tạo', () => {
    const [alpha] = buildWorldInput(data()).clusters;
    expect(alpha.islands.map((i) => i.center.id)).toEqual(['docs:p1', 'r1', 'r2']);
    const docs = alpha.islands[0];
    expect(docs.center).toMatchObject({ kind: 'docs', total: 2 });
    expect(docs.nodes.map((n) => [n.id, n.kind, n.parentId])).toEqual([
      ['dir:p1:docs', 'folder', 'docs:p1'],
      ['page:p1:docs/a.md', 'page', 'dir:p1:docs'],
      ['page:p1:README.md', 'page', 'docs:p1'],
    ]);
  });

  it('đảo yêu cầu dựng bằng crewMapLevel: thẻ như bản đồ Crew, cạnh chặn và vòng sửa từ worker', () => {
    const r1 = buildWorldInput(data()).clusters[0].islands[1];
    expect(r1.layout).toBe('top-down');
    expect(r1.center).toMatchObject({ id: 'r1', kind: 'request', total: 3, done: 1, detail: 'Chưa có giai đoạn' });
    expect(r1.nodes.find((n) => n.id === 'c1')).toMatchObject({ kind: 'ticket', assignee: 'executor-1' });
    expect(r1.nodes.find((n) => n.id === 'c3')?.parentId).toBe('c2');
    const kinds = r1.edges.map((e) => `${e.kind}:${e.source}>${e.target}`);
    expect(kinds).toEqual(expect.arrayContaining(['parent:c2>c3', 'blocks:c1>c2', 'repair:c2>c2']));
  });

  it('trạng thái hiển thị (QC) cho thẻ yêu cầu; run chỉ gắn vào đúng yêu cầu đang xem', () => {
    const runs = {
      byIssue: {},
      tree: { count: 2, costUsd: 1.5, subscription: false },
    };
    const input = buildWorldInput(
      data({ statusOf: (i) => (i.id === 'r2' ? 'qc_awaiting' : i.status), runs: { rootId: 'r1', data: runs } }),
    );
    const [, r1, r2] = input.clusters[0].islands;
    expect(r2.center.status).toBe('qc_awaiting');
    expect(r1.center.runs?.total).toMatchObject({ count: 2, tree: true });
    expect(r2.center.runs).toBeUndefined();
  });

  it('docs đang tải: một nút Docs mờ giữ chỗ; project không có docs: không có đảo Docs', () => {
    const loading = buildWorldInput(data({ docs: new Map([['p1', 'loading']]) })).clusters[0].islands[0];
    expect(loading.center).toMatchObject({ id: 'docs:p1', disabled: true });
    expect(loading.nodes).toEqual([]);
    expect(buildWorldInput(data({ docs: new Map() })).clusters[0].islands[0].center.id).toBe('r1');
  });
});

describe('focus: phân giải, cha, breadcrumb', () => {
  const world = layoutWorld(buildWorldInput(data()));

  it('mã việc (không phân biệt hoa thường), project, docs, thư mục; không có thì missing; trống là toàn cảnh', () => {
    expect(resolveFocus(world, null)).toEqual({ kind: 'overview' });
    expect(resolveFocus(world, 'tps-1')).toMatchObject({ kind: 'request', id: 'r1', cluster: 'p1' });
    expect(resolveFocus(world, 'TPS-4')).toMatchObject({ kind: 'ticket', id: 'c3', island: 'r1', cluster: 'p1' });
    expect(resolveFocus(world, 'project:p2')).toMatchObject({ kind: 'project', id: 'p2', cluster: 'p2' });
    expect(resolveFocus(world, 'project:none')).toMatchObject({ kind: 'project', id: 'none' });
    expect(resolveFocus(world, 'docs:p1')).toMatchObject({ kind: 'docs', id: 'docs:p1', projectId: 'p1' });
    expect(resolveFocus(world, 'dir:p1:docs')).toMatchObject({ kind: 'folder', id: 'dir:p1:docs', projectId: 'p1' });
    expect(resolveFocus(world, 'TPS-999')).toEqual({ kind: 'missing', focus: 'TPS-999' });
    expect(resolveFocus(world, 'project:old')).toEqual({ kind: 'missing', focus: 'project:old' });
  });

  it('focus của một nút (để đẩy vào URL)', () => {
    expect(focusOfNode(world, 'c3')).toBe('TPS-4');
    expect(focusOfNode(world, 'p1')).toBe('project:p1');
    expect(focusOfNode(world, 'docs:p1')).toBe('docs:p1');
    expect(focusOfNode(world, 'company')).toBeNull();
  });

  it('Esc / Ra ngoài: việc → yêu cầu → project → toàn cảnh; việc cấp 2 ra thẳng yêu cầu; thư mục → Docs', () => {
    expect(parentFocus(world, resolveFocus(world, 'TPS-4'))).toBe('TPS-1');
    expect(parentFocus(world, resolveFocus(world, 'TPS-1'))).toBe('project:p1');
    expect(parentFocus(world, resolveFocus(world, 'project:p1'))).toBeNull();
    expect(parentFocus(world, resolveFocus(world, 'dir:p1:docs'))).toBe('docs:p1');
    expect(parentFocus(world, resolveFocus(world, 'docs:p1'))).toBe('project:p1');
    expect(parentFocus(world, resolveFocus(world, null))).toBeUndefined();
  });

  it('camera: project → cụm, yêu cầu/Docs → đảo, việc/thư mục → nút', () => {
    expect(worldFocusOf(resolveFocus(world, 'project:p1'))).toEqual({ kind: 'cluster', id: 'p1' });
    expect(worldFocusOf(resolveFocus(world, 'TPS-1'))).toEqual({ kind: 'island', id: 'r1' });
    expect(worldFocusOf(resolveFocus(world, 'docs:p1'))).toEqual({ kind: 'island', id: 'docs:p1' });
    expect(worldFocusOf(resolveFocus(world, 'TPS-4'))).toEqual({ kind: 'node', id: 'c3' });
    expect(worldFocusOf(resolveFocus(world, 'nope'))).toEqual({ kind: 'overview' });
  });

  it('breadcrumb: công ty › project › yêu cầu › việc', () => {
    expect(focusTrail(world, resolveFocus(world, 'TPS-4'), t)).toEqual([
      { id: 'company', label: '2P', focus: null },
      { id: 'p1', label: 'Alpha', focus: 'project:p1' },
      { id: 'r1', label: 'TPS-1 Việc r1', focus: 'TPS-1' },
      { id: 'c3', label: 'TPS-4', focus: 'TPS-4' },
    ]);
    expect(focusTrail(world, resolveFocus(world, 'dir:p1:docs'), t).map((c) => c.label)).toEqual([
      '2P',
      'Alpha',
      'Docs',
      'docs',
    ]);
  });
});

describe('worldListItems: dạng danh sách đủ mọi mục', () => {
  it('project → đảo (Docs, yêu cầu) → việc con lồng nhau; tô mục đang xem', () => {
    const world = layoutWorld(buildWorldInput(data()));
    const items = worldListItems(world, 'c2');
    expect(items.map((i) => i.node.id)).toEqual(['p1', 'p2', 'none']);
    const r1 = items[0].children.find((i) => i.node.id === 'r1');
    expect(r1?.children.map((c) => c.node.id)).toEqual(['c1', 'c2']);
    const c2 = r1?.children[1];
    expect(c2?.node.current).toBe(true);
    expect(c2?.children.map((c) => c.node.id)).toEqual(['c3']);
  });
});

import { describe, expect, it } from 'vitest';
import {
  buildCompanyLevel,
  buildDocsLevel,
  buildProjectLevel,
  buildRequestLevel,
  docsNodeId,
  docsParentFolder,
  folderTrail,
  isHumanRoot,
  MORE_ID,
  NO_PROJECT,
  type RoadmapIssue,
  resolveDocsFolder,
  stableOrder,
} from '@/features/roadmap/roadmap-model';

let seq = 0;
const issue = (over: Partial<RoadmapIssue> & { id: string }): RoadmapIssue => ({
  identifier: `TPS-${++seq}`,
  title: `Việc ${over.id}`,
  status: 'todo',
  parentId: null,
  projectId: 'p1',
  createdByUserId: 'u1',
  createdAt: `2026-10-0${(seq % 9) + 1}T00:00:00.000Z`,
  assigneeAgentId: null,
  blockedBy: [],
  ...over,
});

const PROJECTS = [
  { id: 'p1', name: 'Crew', color: '#2b59c3' },
  { id: 'p2', name: 'Alpha', color: null },
  { id: 'p3', name: 'Cũ', archivedAt: '2026-10-01' },
];

describe('isHumanRoot', () => {
  it('chỉ gốc do người tạo', () => {
    expect(isHumanRoot(issue({ id: 'a' }))).toBe(true);
    expect(isHumanRoot(issue({ id: 'b', createdByUserId: null }))).toBe(false);
    expect(isHumanRoot(issue({ id: 'c', createdByUserId: '  ' }))).toBe(false);
    expect(isHumanRoot(issue({ id: 'd', parentId: 'a' }))).toBe(false);
  });
});

describe('buildCompanyLevel', () => {
  const issues = [
    issue({ id: 'r1' }),
    issue({ id: 'r2', status: 'done' }),
    issue({ id: 'agent', createdByUserId: null }),
    issue({ id: 'child', parentId: 'r1' }),
    issue({ id: 'r3', projectId: 'p2', status: 'in_progress' }),
    issue({ id: 'loose', projectId: null }),
  ];

  it('đếm yêu cầu gốc do người tạo và số đang mở; bỏ project lưu trữ; sắp theo tên', () => {
    const level = buildCompanyLevel({
      companyName: '2P',
      projects: PROJECTS,
      issues,
      includeNoProject: false,
      noProjectTitle: 'Chưa gắn project',
    });
    expect(level.center).toMatchObject({ id: 'company', kind: 'company', title: '2P', total: 2, open: 3 });
    expect(level.nodes.map((n) => n.id)).toEqual(['p2', 'p1']);
    expect(level.nodes.find((n) => n.id === 'p1')).toMatchObject({ total: 2, open: 1, color: '#2b59c3' });
    expect(level.edges).toHaveLength(2);
  });

  it('owner thấy thêm "Chưa gắn project" khi có gốc không project', () => {
    const level = buildCompanyLevel({
      companyName: '2P',
      projects: PROJECTS,
      issues,
      includeNoProject: true,
      noProjectTitle: 'Chưa gắn project',
    });
    expect(level.nodes.at(-1)).toMatchObject({ id: NO_PROJECT, title: 'Chưa gắn project', total: 1 });
  });

  it('vượt trần sinh nút "+N" với số đúng', () => {
    const many = Array.from({ length: 45 }, (_, i) => ({ id: `p${i}`, name: `P${String(i).padStart(2, '0')}` }));
    const level = buildCompanyLevel({
      companyName: '2P',
      projects: many,
      issues: [],
      includeNoProject: false,
      noProjectTitle: '',
    });
    expect(level.nodes).toHaveLength(41);
    expect(level.nodes.at(-1)).toMatchObject({ id: MORE_ID, kind: 'more', extra: 5 });
    expect(level.overflow).toBe(5);
    expect(level.edges.some((e) => e.target === MORE_ID)).toBe(false);
  });
});

describe('buildProjectLevel', () => {
  const issues = [
    issue({ id: 'r1', createdAt: '2026-10-01T00:00:00Z' }),
    issue({ id: 'c1', parentId: 'r1', status: 'done' }),
    issue({ id: 'c2', parentId: 'r1' }),
    issue({ id: 'g1', parentId: 'c2', status: 'done' }),
    issue({ id: 'rDone', status: 'done', createdAt: '2026-09-01T00:00:00Z' }),
    issue({ id: 'r2', createdAt: '2026-10-02T00:00:00Z' }),
    issue({ id: 'agentRoot', createdByUserId: null }),
    issue({ id: 'other', projectId: 'p2' }),
  ];

  it('yêu cầu gốc do người tạo, đang mở trước, tiến độ tính cả cháu', () => {
    const level = buildProjectLevel({ project: { id: 'p1', title: 'Crew', color: null }, issues });
    expect(level.nodes.map((n) => n.id)).toEqual(['r1', 'r2', 'rDone']);
    expect(level.nodes[0]).toMatchObject({ total: 3, done: 2 });
    expect(level.center).toMatchObject({ id: 'p1', total: 3, open: 2 });
  });

  it('thứ tự ổn định: thêm yêu cầu mới không đổi chỗ nút cũ', () => {
    const before = buildProjectLevel({ project: { id: 'p1', title: 'Crew' }, issues });
    const after = buildProjectLevel({
      project: { id: 'p1', title: 'Crew' },
      issues: [...issues, issue({ id: 'r9', createdAt: '2026-10-09T00:00:00Z' })],
    });
    expect(after.nodes.slice(0, 2).map((n) => n.id)).toEqual(before.nodes.slice(0, 2).map((n) => n.id));
  });

  it('nút Docs đứng đầu; chưa có bản docs hoặc đang tải thì không bấm được; không có nhánh docs thì không vẽ', () => {
    const withDocs = buildProjectLevel({ project: { id: 'p1', title: 'Crew' }, issues, docs: { pages: 7 } });
    expect(withDocs.nodes[0]).toMatchObject({ id: docsNodeId('p1'), kind: 'docs', total: 7, disabled: false });
    expect(withDocs.edges[0].target).toBe(docsNodeId('p1'));
    const none = buildProjectLevel({ project: { id: 'p1', title: 'Crew' }, issues, docs: null });
    expect(none.nodes[0]).toMatchObject({ kind: 'docs', disabled: true });
    expect(buildProjectLevel({ project: { id: 'p1', title: 'Crew' }, issues }).nodes[0].kind).toBe('request');
    // Đang tải: nút giữ chỗ (mờ, chưa có số trang) để bố cục không đổi khi tải xong.
    const loading = buildProjectLevel({ project: { id: 'p1', title: 'Crew' }, issues, docs: 'loading' });
    expect(loading.nodes[0]).toMatchObject({ kind: 'docs', disabled: true, total: undefined });
  });

  it('"Chưa gắn project" lấy gốc không có project', () => {
    const level = buildProjectLevel({
      project: { id: NO_PROJECT, title: 'Chưa gắn project' },
      issues: [issue({ id: 'x', projectId: null }), issue({ id: 'y' })],
    });
    expect(level.nodes.map((n) => n.id)).toEqual(['x']);
  });

  it('trần 60 yêu cầu', () => {
    const many = Array.from({ length: 65 }, (_, i) => issue({ id: `m${i}` }));
    const level = buildProjectLevel({ project: { id: 'p1', title: 'Crew' }, issues: many });
    expect(level.nodes).toHaveLength(61);
    expect(level.nodes.at(-1)).toMatchObject({ kind: 'more', extra: 5 });
  });
});

describe('buildRequestLevel', () => {
  const request = issue({ id: 'r', identifier: 'TPS-1' });
  const descendants = [
    issue({ id: 'a', parentId: 'r', assigneeAgentId: 'ag1' }),
    issue({ id: 'b', parentId: 'r', blockedBy: [{ id: 'a' }, { id: 'outside' }] }),
    issue({ id: 'a1', parentId: 'a', status: 'done' }),
  ];

  it('cây hậu duệ, cạnh cha-con và cạnh chặn chỉ khi hai đầu cùng trên bản đồ', () => {
    const level = buildRequestLevel({
      request,
      descendants,
      agentName: (id) => (id === 'ag1' ? 'Dev Agent' : undefined),
    });
    expect(level.layout).toBe('top-down');
    expect(level.center).toMatchObject({ id: 'r', kind: 'request', total: 3, done: 1 });
    expect(level.nodes.map((n) => n.id)).toEqual(['a', 'b', 'a1']);
    expect(level.nodes[0]).toMatchObject({ assignee: 'Dev Agent', children: 1, parentId: 'r' });
    expect(level.edges.filter((e) => e.kind === 'parent').map((e) => `${e.source}>${e.target}`)).toEqual([
      'r>a',
      'r>b',
      'a>a1',
    ]);
    expect(level.edges.filter((e) => e.kind === 'blocks')).toEqual([
      { id: 'a=>b', source: 'a', target: 'b', kind: 'blocks' },
    ]);
  });

  it('vòng cha-con hỏng không treo; issue không nối về yêu cầu bị bỏ', () => {
    const level = buildRequestLevel({
      request,
      descendants: [...descendants, issue({ id: 'x', parentId: 'y' }), issue({ id: 'y', parentId: 'x' })],
    });
    expect(level.nodes.map((n) => n.id)).toEqual(['a', 'b', 'a1']);
  });

  it('vượt trần giữ theo độ sâu, cha luôn có mặt, có nút "+N"', () => {
    const kids = Array.from({ length: 3 }, (_, i) => issue({ id: `k${i}`, parentId: 'r' }));
    const grand = Array.from({ length: 4 }, (_, i) => issue({ id: `g${i}`, parentId: 'k0' }));
    const level = buildRequestLevel({ request, descendants: [...grand, ...kids], cap: 5 });
    const ids = level.nodes.map((n) => n.id);
    expect(ids.slice(0, 3)).toEqual(['k0', 'k1', 'k2']);
    expect(ids).toContain(MORE_ID);
    expect(level.overflow).toBe(2);
  });
});

describe('buildDocsLevel', () => {
  const pages = [
    { path: 'README.md', title: 'Giới thiệu' },
    { path: 'docs/index.md', title: 'Mục lục' },
    { path: 'docs/flows/login.md', title: 'Đăng nhập' },
  ];

  it('gốc bộ docs: thư mục trước, rồi trang; đếm trang trong thư mục', () => {
    const level = buildDocsLevel({ projectId: 'p1', pages, folder: null });
    expect(level?.center).toMatchObject({ id: docsNodeId('p1'), kind: 'docs', total: 3 });
    expect(level?.nodes.map((n) => [n.kind, n.title, n.total])).toEqual([
      ['folder', 'docs', 2],
      ['page', 'Giới thiệu', undefined],
    ]);
  });

  it('vào thư mục; thư mục không có thì null', () => {
    const level = buildDocsLevel({ projectId: 'p1', pages, folder: 'docs' });
    expect(level?.center).toMatchObject({ kind: 'folder', title: 'docs' });
    expect(level?.nodes.map((n) => n.id)).toEqual(['dir:docs/flows', 'page:docs/index.md']);
    expect(buildDocsLevel({ projectId: 'p1', pages, folder: 'nope' })).toBeNull();
  });

  it('tầng chỉ có một thư mục và không trang thì tự đi xuống; lùi bỏ qua tầng tự đi xuống', () => {
    const nested = [
      { path: 'docs/guide/a.md', title: 'A' },
      { path: 'docs/guide/b/c.md', title: 'C' },
    ];
    expect(resolveDocsFolder(nested, null)).toBe('docs/guide');
    expect(resolveDocsFolder(nested, 'docs')).toBe('docs/guide');
    expect(resolveDocsFolder(nested, 'docs/guide/b')).toBe('docs/guide/b');
    expect(resolveDocsFolder(pages, null)).toBeNull();
    expect(resolveDocsFolder(pages, 'nope')).toBe('nope');
    expect(docsParentFolder(nested, 'docs/guide')).toBe('project');
    expect(docsParentFolder(nested, 'docs/guide/b')).toBe('docs/guide');
    expect(docsParentFolder(pages, 'docs/flows')).toBe('docs');
    expect(docsParentFolder(pages, 'docs')).toBeNull();
    expect(docsParentFolder(pages, null)).toBe('project');
  });

  it('folderTrail tách đường thư mục', () => {
    expect(folderTrail('a/b')).toEqual([
      { path: 'a', name: 'a' },
      { path: 'a/b', name: 'b' },
    ]);
    expect(folderTrail(null)).toEqual([]);
  });
});

describe('stableOrder', () => {
  it('mở trước, tạo sớm trước, rồi theo mã số', () => {
    const list = [
      issue({ id: '1', identifier: 'TPS-10', status: 'done', createdAt: '2026-01-01T00:00:00Z' }),
      issue({ id: '2', identifier: 'TPS-9', createdAt: '2026-01-02T00:00:00Z' }),
      issue({ id: '3', identifier: 'TPS-2', createdAt: '2026-01-02T00:00:00Z' }),
    ];
    expect([...list].sort(stableOrder).map((i) => i.identifier)).toEqual(['TPS-2', 'TPS-9', 'TPS-10']);
  });
});

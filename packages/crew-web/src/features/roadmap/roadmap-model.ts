// Mô hình thuần của trang Roadmap: từ danh sách issue/project/docs dựng một tầng bản đồ (tâm, nút con, cạnh).
// Tầng công ty → project (+ "Chưa gắn project" cho owner) → yêu cầu gốc do người tạo (+ nút Docs) → cây việc con;
// nhánh Docs: bộ docs → thư mục → trang. Không gọi API, không đọc URL; trang lo phần đó.
import { buildDocsTree, type DocsNode } from '@crew/paperclip-plugin/shared/docs-tree';
import type { MapRuns } from '@crew/paperclip-plugin/shared/map';
import { type RoadmapEdge, type RoadmapLevel, type RoadmapNode, roadmapRuns } from '@/ds';

/** Trần số nút vẽ mỗi tầng; vượt thì có nút "+N khác" mở dạng danh sách. */
export const CAPS = { projects: 40, requests: 60, tickets: 150, docs: 60 } as const;
/** Trần dòng mỗi lời gọi danh sách issue của server. */
export const LIST_LIMIT = 1000;

export const COMPANY_ID = 'company';
/** Id nút và giá trị `?project=` của nhóm yêu cầu không thuộc project nào (chỉ owner thấy). */
export const NO_PROJECT = 'none';
export const MORE_ID = 'more';
export const docsNodeId = (projectId: string) => `docs:${projectId}`;
export const folderNodeId = (path: string) => `dir:${path}`;
export const pageNodeId = (path: string) => `page:${path}`;
/** Đường dẫn docs của nút thư mục/trang. */
export const docsPathOf = (node: Pick<RoadmapNode, 'id'>): string => node.id.replace(/^(dir|page):/, '');

/** Phần issue mà bản đồ cần (khớp CompactIssue của server). */
export interface RoadmapIssue {
  id: string;
  identifier: string | null;
  title: string;
  status: string;
  parentId: string | null;
  projectId: string | null;
  createdByUserId: string | null;
  createdAt: string | Date;
  assigneeAgentId?: string | null;
  blockedBy?: readonly { id: string }[] | null;
}

export interface RoadmapProject {
  id: string;
  name: string;
  color?: string | null;
  archivedAt?: unknown;
}

const OPEN_EXCLUDED = new Set(['done', 'cancelled']);
export const isOpenStatus = (status: string) => !OPEN_EXCLUDED.has(status);

/** Yêu cầu gốc do người tạo: không có cha và có `createdByUserId`. Gốc do agent tạo (routine, CEO agent) bị bỏ. */
export const isHumanRoot = (issue: RoadmapIssue) => issue.parentId === null && !!issue.createdByUserId?.trim();

const time = (v: string | Date) => new Date(v).getTime() || 0;

/** Thứ tự ổn định (nút không nhảy chỗ khi có issue mới): đang mở trước, rồi tạo sớm trước, rồi theo mã. */
export function stableOrder(a: RoadmapIssue, b: RoadmapIssue): number {
  return (
    Number(isOpenStatus(b.status)) - Number(isOpenStatus(a.status)) ||
    time(a.createdAt) - time(b.createdAt) ||
    (a.identifier ?? a.id).localeCompare(b.identifier ?? b.id, 'vi', { numeric: true })
  );
}

/** Con trực tiếp theo id cha. */
export function childrenIndex(issues: readonly RoadmapIssue[]): Map<string, RoadmapIssue[]> {
  const out = new Map<string, RoadmapIssue[]>();
  for (const issue of issues) {
    if (!issue.parentId) continue;
    const list = out.get(issue.parentId) ?? [];
    list.push(issue);
    out.set(issue.parentId, list);
  }
  return out;
}

/** Mọi hậu duệ của `id` theo tầng (con trước cháu), mỗi issue một lần kể cả khi dữ liệu có vòng cha-con. */
export function descendantsOf(id: string, index: ReadonlyMap<string, RoadmapIssue[]>): RoadmapIssue[] {
  const seen = new Set([id]);
  const out: RoadmapIssue[] = [];
  let frontier = [id];
  while (frontier.length) {
    const next: string[] = [];
    for (const parent of frontier) {
      for (const child of index.get(parent) ?? []) {
        if (seen.has(child.id)) continue;
        seen.add(child.id);
        out.push(child);
        next.push(child.id);
      }
    }
    frontier = next;
  }
  return out;
}

/** Cắt danh sách theo trần; vượt thì thêm nút "+N khác" ở cuối. */
function capped(nodes: RoadmapNode[], cap: number): { nodes: RoadmapNode[]; overflow: number } {
  if (nodes.length <= cap) return { nodes, overflow: 0 };
  const extra = nodes.length - cap;
  return { nodes: [...nodes.slice(0, cap), { id: MORE_ID, kind: 'more', title: '', extra }], overflow: extra };
}

const star = (center: string, nodes: readonly RoadmapNode[]): RoadmapEdge[] =>
  nodes
    .filter((n) => n.kind !== 'more')
    .map((n) => ({ id: `${center}->${n.id}`, source: center, target: n.id, kind: 'parent' }));

export interface CompanyLevelInput {
  companyName: string;
  projects: readonly RoadmapProject[];
  /** Issue đã lọc theo quyền xem. */
  issues: readonly RoadmapIssue[];
  /** Owner: thêm nút "Chưa gắn project" khi có yêu cầu gốc không thuộc project nào. */
  includeNoProject: boolean;
  noProjectTitle: string;
  cap?: number;
}

/** Tầng công ty: công ty ở tâm, mỗi project (chưa lưu trữ) một nút với số yêu cầu gốc và số đang mở. */
export function buildCompanyLevel(input: CompanyLevelInput): RoadmapLevel {
  const roots = input.issues.filter(isHumanRoot);
  const projects = input.projects
    .filter((p) => !p.archivedAt)
    .sort((a, b) => a.name.localeCompare(b.name, 'vi', { numeric: true }));
  const stats = (projectId: string | null) => {
    const mine = roots.filter((r) => r.projectId === projectId);
    return { total: mine.length, open: mine.filter((r) => isOpenStatus(r.status)).length };
  };
  const nodes: RoadmapNode[] = projects.map((p) => ({
    id: p.id,
    kind: 'project',
    title: p.name,
    color: p.color ?? null,
    ...stats(p.id),
  }));
  const loose = stats(null);
  if (input.includeNoProject && loose.total > 0) {
    nodes.push({ id: NO_PROJECT, kind: 'project', title: input.noProjectTitle, color: null, ...loose });
  }
  const { nodes: shown, overflow } = capped(nodes, input.cap ?? CAPS.projects);
  const center: RoadmapNode = {
    id: COMPANY_ID,
    kind: 'company',
    title: input.companyName,
    total: projects.length,
    open: roots.filter((r) => isOpenStatus(r.status)).length,
  };
  return { center, nodes: shown, edges: star(COMPANY_ID, shown), overflow, layout: 'rings' };
}

/**
 * Docs của project: `undefined` = không có nhánh docs (nhóm "Chưa gắn project"), `'loading'` = đang tải (nút mờ, giữ
 * chỗ để bố cục không đổi khi tải xong), `null` = chưa có bản docs.
 */
export type ProjectDocs = { pages: number } | 'loading' | null | undefined;

export interface ProjectLevelInput {
  /** Nút project ở tầng công ty (tên, màu). */
  project: Pick<RoadmapNode, 'id' | 'title' | 'color'>;
  /** Issue của project (đã lọc theo quyền xem); với "Chưa gắn project" là các issue không có project. */
  issues: readonly RoadmapIssue[];
  docs?: ProjectDocs;
  cap?: number;
}

/** Yêu cầu gốc do người tạo của một project theo thứ tự ổn định. */
export function projectRoots(projectId: string, issues: readonly RoadmapIssue[]): RoadmapIssue[] {
  const want = projectId === NO_PROJECT ? null : projectId;
  return issues.filter((i) => isHumanRoot(i) && i.projectId === want).sort(stableOrder);
}

/** Tầng project: project ở tâm, nút Docs (nếu biết) đứng đầu, rồi các yêu cầu gốc với tiến độ việc con. */
export function buildProjectLevel(input: ProjectLevelInput): RoadmapLevel {
  const roots = projectRoots(input.project.id, input.issues);
  const index = childrenIndex(input.issues);
  const requests: RoadmapNode[] = roots.map((r) => {
    const all = descendantsOf(r.id, index);
    return {
      id: r.id,
      kind: 'request',
      title: r.title,
      identifier: r.identifier,
      status: r.status,
      total: all.length,
      done: all.filter((d) => d.status === 'done').length,
    };
  });
  const { nodes: shown, overflow } = capped(requests, input.cap ?? CAPS.requests);
  const nodes: RoadmapNode[] =
    input.docs === undefined
      ? shown
      : [
          {
            id: docsNodeId(input.project.id),
            kind: 'docs',
            title: 'Docs',
            total: typeof input.docs === 'object' && input.docs ? input.docs.pages : undefined,
            disabled: input.docs === null || input.docs === 'loading',
          },
          ...shown,
        ];
  const center: RoadmapNode = {
    id: input.project.id,
    kind: 'project',
    title: input.project.title,
    color: input.project.color ?? null,
    total: roots.length,
    open: roots.filter((r) => isOpenStatus(r.status)).length,
  };
  return { center, nodes, edges: star(center.id, nodes), overflow, layout: 'rings' };
}

export interface RequestLevelInput {
  request: RoadmapIssue;
  /** Hậu duệ của yêu cầu (đã lọc theo quyền xem). Issue không nối được về yêu cầu bị bỏ. */
  descendants: readonly RoadmapIssue[];
  agentName?: (agentId: string) => string | undefined;
  /** Run tóm tắt của cây yêu cầu (chưa tải thì thẻ không có khối run). */
  runs?: MapRuns;
  cap?: number;
}

/**
 * Tầng yêu cầu: yêu cầu ở đỉnh, mọi hậu duệ thành cây trên xuống (con, cháu…). Vượt trần thì giữ theo độ sâu tăng dần rồi thứ tự
 * ổn định, nên cha của một nút luôn được vẽ. Cạnh cha-con, và cạnh "chặn" khi cả hai đầu cùng nằm trên bản đồ.
 */
export function buildRequestLevel(input: RequestLevelInput): RoadmapLevel {
  const { request } = input;
  const index = childrenIndex(input.descendants.filter((d) => d.id !== request.id));
  for (const list of index.values()) list.sort(stableOrder);
  const all = descendantsOf(request.id, index);
  const cap = input.cap ?? CAPS.tickets;
  const kept = all.slice(0, cap);
  const ids = new Set([request.id, ...kept.map((k) => k.id)]);
  const runsOf = (id: string) => input.runs?.byIssue[id.toLowerCase()];
  const nodes: RoadmapNode[] = kept.map((t) => ({
    id: t.id,
    kind: 'ticket',
    title: t.title,
    identifier: t.identifier,
    status: t.status,
    parentId: t.parentId,
    children: index.get(t.id)?.length ?? 0,
    assignee: t.assigneeAgentId ? (input.agentName?.(t.assigneeAgentId) ?? null) : null,
    runs: roadmapRuns(runsOf(t.id)),
  }));
  const edges: RoadmapEdge[] = kept.map((t) => ({
    id: `${t.parentId}->${t.id}`,
    source: t.parentId as string,
    target: t.id,
    kind: 'parent',
  }));
  for (const t of kept) {
    for (const b of t.blockedBy ?? []) {
      if (ids.has(b.id) && b.id !== t.id) {
        edges.push({ id: `${b.id}=>${t.id}`, source: b.id, target: t.id, kind: 'blocks' });
      }
    }
  }
  const overflow = all.length - kept.length;
  if (overflow > 0) nodes.push({ id: MORE_ID, kind: 'more', title: '', extra: overflow });
  const center: RoadmapNode = {
    id: request.id,
    kind: 'request',
    title: request.title,
    identifier: request.identifier,
    status: request.status,
    total: all.length,
    done: all.filter((d) => d.status === 'done').length,
    runs: input.runs ? roadmapRuns(runsOf(request.id), input.runs.tree) : undefined,
  };
  return { center, nodes, edges, overflow, layout: 'top-down' };
}

/** Số trang trong một nhánh cây docs. */
const pageCount = (node: DocsNode): number =>
  node.type === 'page' ? 1 : node.children.reduce((sum, c) => sum + pageCount(c), 0);

function findFolder(nodes: readonly DocsNode[], path: string): DocsNode | null {
  for (const node of nodes) {
    if (node.type !== 'directory') continue;
    if (node.path === path) return node;
    if (path.startsWith(`${node.path}/`)) return findFolder(node.children, path);
  }
  return null;
}

/**
 * Thư mục thật sự hiện ra khi mở `folder` (null là gốc bộ docs): tầng nào chỉ có đúng một thư mục và không có trang thì
 * tự đi xuống thư mục đó, để bấm Docs là thấy ngay trang (ví dụ gốc chỉ có thư mục `docs`). Thư mục không có thì trả
 * nguyên `folder`.
 */
export function resolveDocsFolder(
  pages: readonly { path: string; title: string }[],
  folder: string | null,
): string | null {
  const tree = buildDocsTree([...pages]);
  let items = folder ? findFolder(tree, folder)?.children : tree;
  if (!items) return folder;
  let current = folder;
  while (items.length === 1 && items[0].type === 'directory') {
    current = items[0].path;
    items = items[0].children;
  }
  return current;
}

/**
 * Tầng cha của thư mục docs đang hiện (`effective` đã qua `resolveDocsFolder`): bỏ qua các tầng tự đi xuống (lùi tới
 * đó lại tự về chỗ cũ). `'project'` là lùi ra tầng project.
 */
export function docsParentFolder(
  pages: readonly { path: string; title: string }[],
  effective: string | null,
): string | null | 'project' {
  if (effective === null) return 'project';
  let parent: string | null = effective.split('/').slice(0, -1).join('/') || null;
  while (resolveDocsFolder(pages, parent) === effective) {
    if (parent === null) return 'project';
    parent = parent.split('/').slice(0, -1).join('/') || null;
  }
  return parent;
}

export interface DocsLevelInput {
  projectId: string;
  pages: readonly { path: string; title: string }[];
  /** Thư mục đang xem; null là gốc bộ docs. */
  folder: string | null;
  cap?: number;
}

/** Tầng docs: bộ docs (hoặc một thư mục) ở tâm, thư mục con và trang tỏa quanh. null khi thư mục không có. */
export function buildDocsLevel(input: DocsLevelInput): RoadmapLevel | null {
  const tree = buildDocsTree([...input.pages]);
  const folder = input.folder ? findFolder(tree, input.folder) : null;
  if (input.folder && !folder) return null;
  const items = folder ? folder.children : tree;
  const all: RoadmapNode[] = items.map((node) =>
    node.type === 'directory'
      ? { id: folderNodeId(node.path), kind: 'folder', title: node.name, total: pageCount(node) }
      : { id: pageNodeId(node.path), kind: 'page', title: node.title || node.name, subtitle: node.name },
  );
  const { nodes, overflow } = capped(all, input.cap ?? CAPS.docs);
  const center: RoadmapNode = folder
    ? { id: folderNodeId(folder.path), kind: 'folder', title: folder.name, total: pageCount(folder) }
    : { id: docsNodeId(input.projectId), kind: 'docs', title: 'Docs', total: input.pages.length };
  return { center, nodes, edges: star(center.id, nodes), overflow, layout: 'rings' };
}

/** Các thư mục tổ tiên của `folder` (gồm chính nó), để dựng breadcrumb: `a/b/c` → `a`, `a/b`, `a/b/c`. */
export function folderTrail(folder: string | null): { path: string; name: string }[] {
  if (!folder) return [];
  const parts = folder.split('/');
  return parts.map((name, i) => ({ path: parts.slice(0, i + 1).join('/'), name }));
}

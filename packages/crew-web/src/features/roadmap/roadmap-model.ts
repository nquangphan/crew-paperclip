// Mô hình thuần của trang Roadmap một trang: từ dữ liệu `crew.roadmap`, project và docs dựng đầu vào của thế giới
// (công ty → project → đảo Docs và đảo yêu cầu), rồi phân giải chỗ lấy nét trên URL (`?focus=`) thành mục trên thế giới.
// Mỗi đảo yêu cầu dựng bằng `crewMapLevel` như bản đồ Crew ở trang issue, nên thẻ (giai đoạn, người làm, vòng sửa, run)
// và cạnh (cha-con, chặn, vòng sửa) giống hệt. Không gọi API, không đọc URL; trang lo phần đó.
import { buildDocsTree, type DocsNode } from '@crew/paperclip-plugin/shared/docs-tree';
import type { CrewMap, CrewRoadmap, CrewRoadmapNode, MapRuns } from '@crew/paperclip-plugin/shared/map';
import {
  crewMapLevel,
  type RoadmapEdge,
  type RoadmapLevel,
  type RoadmapListItem,
  type RoadmapNode,
  type RoadmapWorld,
  type WorldFocus,
  type WorldInput,
} from '@/ds';
import type { useT } from '@/i18n';

type TFn = ReturnType<typeof useT>['t'];

export const COMPANY_ID = 'company';
/** Id cụm và focus `project:none` của nhóm yêu cầu không thuộc project nào (chỉ owner thấy). */
export const NO_PROJECT = 'none';
export const docsNodeId = (projectId: string) => `docs:${projectId}`;
export const folderNodeId = (projectId: string, path: string) => `dir:${projectId}:${path}`;
export const pageNodeId = (projectId: string, path: string) => `page:${projectId}:${path}`;
export const projectFocus = (projectId: string) => `project:${projectId}`;

export interface RoadmapProject {
  id: string;
  name: string;
  color?: string | null;
  archivedAt?: unknown;
}

const OPEN_EXCLUDED = new Set(['done', 'cancelled']);
export const isOpenStatus = (status: string) => !OPEN_EXCLUDED.has(status);

/** Yêu cầu gốc do người tạo: không có cha và có `createdByUserId`. Gốc do agent tạo (routine, CEO agent) bị bỏ. */
export const isHumanRoot = (node: Pick<CrewRoadmapNode, 'parentId' | 'createdByUserId'>) =>
  node.parentId === null && !!node.createdByUserId?.trim();

const time = (v: string | Date) => new Date(v).getTime() || 0;
/** Thứ tự đảo ổn định: tạo sớm trước, rồi theo mã (yêu cầu mới thêm vào cuối, không đẩy đảo cũ). */
const byCreated = (a: CrewRoadmapNode, b: CrewRoadmapNode) =>
  time(a.createdAt) - time(b.createdAt) ||
  (a.identifier ?? a.id).localeCompare(b.identifier ?? b.id, 'vi', { numeric: true });

/**
 * Docs của project: `{ pages }` = cây đã tải, `'loading'` = đang tải (nút Docs mờ giữ chỗ), `null` = có đăng ký docs nhưng
 * không tải được hoặc chưa có bản docs (nút Docs mờ). Project không có trong map: không có đảo Docs.
 */
export type ProjectDocs = { pages: readonly { path: string; title: string }[] } | 'loading' | null;

/** Trạng thái vẽ trên thẻ yêu cầu (vd. trạng thái QC của yêu cầu Phòng QC đã Xong). */
export type StatusOf = (issue: { id: string; status: string }) => string;

export interface WorldDataInput {
  companyName: string;
  /** Project người xem được cấp. */
  projects: readonly RoadmapProject[];
  /** Dữ liệu `crew.roadmap` đã lọc theo quyền xem. */
  roadmap: CrewRoadmap;
  /** Owner: thêm cụm "Chưa gắn project" khi có yêu cầu không thuộc project nào. */
  includeNoProject: boolean;
  noProjectTitle: string;
  docs?: ReadonlyMap<string, ProjectDocs>;
  /** Run của cây yêu cầu đang xem (tải lười theo yêu cầu đang lấy nét). */
  runs?: { rootId: string; data: MapRuns } | null;
  statusOf?: StatusOf;
  t: TFn;
}

/** Số trang trong một nhánh cây docs. */
const pageCount = (node: DocsNode): number =>
  node.type === 'page' ? 1 : node.children.reduce((sum, c) => sum + pageCount(c), 0);

/** Đảo Docs: bộ docs ở đỉnh, thư mục và trang xếp cây trên xuống. */
function docsIsland(projectId: string, docs: ProjectDocs): RoadmapLevel {
  const rootId = docsNodeId(projectId);
  const pages = docs && docs !== 'loading' ? docs.pages : null;
  const center: RoadmapNode = {
    id: rootId,
    kind: 'docs',
    title: 'Docs',
    total: pages ? pages.length : docs === null ? 0 : undefined,
    disabled: !pages,
  };
  const nodes: RoadmapNode[] = [];
  const edges: RoadmapEdge[] = [];
  const walk = (items: readonly DocsNode[], parentId: string) => {
    for (const item of items) {
      const id = item.type === 'directory' ? folderNodeId(projectId, item.path) : pageNodeId(projectId, item.path);
      nodes.push(
        item.type === 'directory'
          ? { id, kind: 'folder', title: item.name, total: pageCount(item), parentId }
          : { id, kind: 'page', title: item.title || item.name, subtitle: item.path, parentId },
      );
      edges.push({ id: `docs:${parentId}->${id}`, source: parentId, target: id, kind: 'parent' });
      if (item.type === 'directory') walk(item.children, id);
    }
  };
  if (pages) walk(buildDocsTree([...pages]), rootId);
  return { center, nodes, edges, overflow: 0, layout: 'top-down' };
}

/** Đảo yêu cầu: bản đồ Crew của yêu cầu (cùng hàm dựng với `CrewMap`). */
function requestIsland(
  root: CrewRoadmapNode,
  members: readonly CrewRoadmapNode[],
  edges: CrewRoadmap['edges'],
  input: WorldDataInput,
): RoadmapLevel {
  const map: CrewMap = {
    root,
    nodes: [...members],
    edges: [...edges],
    diagnostics: [],
    runs: input.runs?.rootId === root.id ? input.runs.data : undefined,
  };
  const { level } = crewMapLevel(map, undefined, input.t);
  const status = input.statusOf?.(root) ?? root.status;
  return status === level.center.status ? level : { ...level, center: { ...level.center, status } };
}

/** Dữ liệu trang → đầu vào của thế giới (`layoutWorld`). */
export function buildWorldInput(input: WorldDataInput): WorldInput {
  const nodes = input.roadmap.nodes;
  const roots = nodes.filter(isHumanRoot).sort(byCreated);
  const members = new Map<string, CrewRoadmapNode[]>();
  for (const n of nodes) members.set(n.rootId, [...(members.get(n.rootId) ?? []), n]);
  const rootOf = new Map(nodes.map((n) => [n.id, n.rootId]));
  const edgesOf = new Map<string, CrewRoadmap['edges']>();
  for (const e of input.roadmap.edges) {
    const root = rootOf.get(e.from);
    if (!root || root !== rootOf.get(e.to)) continue;
    edgesOf.set(root, [...(edgesOf.get(root) ?? []), e]);
  }

  const projects = input.projects
    .filter((p) => !p.archivedAt)
    .sort((a, b) => a.name.localeCompare(b.name, 'vi', { numeric: true }));
  const cluster = (id: string, title: string, color: string | null, projectId: string | null) => {
    const mine = roots.filter((r) => r.projectId === projectId);
    const docs = projectId ? input.docs?.get(projectId) : undefined;
    const islands: RoadmapLevel[] = [];
    if (projectId && input.docs?.has(projectId)) islands.push(docsIsland(projectId, docs ?? null));
    for (const r of mine) islands.push(requestIsland(r, members.get(r.id) ?? [r], edgesOf.get(r.id) ?? [], input));
    const node: RoadmapNode = {
      id,
      kind: 'project',
      title,
      color,
      total: mine.length,
      open: mine.filter((r) => isOpenStatus(r.status)).length,
    };
    return { node, islands };
  };
  const clusters = projects.map((p) => cluster(p.id, p.name, p.color ?? null, p.id));
  const visible = new Set(projects.map((p) => p.id));
  if (input.includeNoProject && roots.some((r) => r.projectId === null)) {
    clusters.push(cluster(NO_PROJECT, input.noProjectTitle, null, null));
  }
  const shown = roots.filter((r) => (r.projectId === null ? input.includeNoProject : visible.has(r.projectId)));
  return {
    company: {
      id: COMPANY_ID,
      kind: 'company',
      title: input.companyName,
      total: projects.length,
      open: shown.filter((r) => isOpenStatus(r.status)).length,
    },
    clusters,
  };
}

// ---- Chỗ lấy nét -----------------------------------------------------------------------------------------------------

/** Chỗ lấy nét đã phân giải trên thế giới. `cluster` là id cụm project chứa mục. */
export type FocusTarget =
  | { kind: 'overview' }
  | { kind: 'missing'; focus: string }
  | { kind: 'project'; id: string; cluster: string }
  | { kind: 'request'; id: string; cluster: string; identifier: string }
  | { kind: 'ticket'; id: string; cluster: string; island: string; identifier: string }
  | { kind: 'docs'; id: string; cluster: string; projectId: string }
  | { kind: 'folder'; id: string; cluster: string; island: string; projectId: string; path: string };

/** `?focus=` → mục trên thế giới; null là toàn cảnh, không tìm thấy (hoặc không được xem) là `missing`. */
export function resolveFocus(world: RoadmapWorld, focus: string | null): FocusTarget {
  if (!focus) return { kind: 'overview' };
  const missing = { kind: 'missing', focus } as const;
  if (focus.startsWith('project:')) {
    const id = focus.slice('project:'.length);
    return world.clusters.some((c) => c.id === id) ? { kind: 'project', id, cluster: id } : missing;
  }
  if (focus.startsWith('docs:') || focus.startsWith('dir:')) {
    const n = world.nodes.get(focus);
    if (!n?.island || !n.cluster) return missing;
    const projectId = n.island.slice('docs:'.length);
    if (n.node.kind === 'docs') return { kind: 'docs', id: focus, cluster: n.cluster, projectId };
    if (n.node.kind !== 'folder') return missing;
    const path = focus.slice(`dir:${projectId}:`.length);
    return { kind: 'folder', id: focus, cluster: n.cluster, island: n.island, projectId, path };
  }
  const wanted = focus.toLowerCase();
  for (const n of world.nodes.values()) {
    if (!n.island || !n.cluster || n.node.identifier?.toLowerCase() !== wanted) continue;
    const identifier = n.node.identifier;
    if (n.center) return { kind: 'request', id: n.node.id, cluster: n.cluster, identifier };
    return { kind: 'ticket', id: n.node.id, cluster: n.cluster, island: n.island, identifier };
  }
  return missing;
}

/** Giá trị `?focus=` để lấy nét một nút; null với nút công ty (toàn cảnh) và trang docs (mở popup đọc). */
export function focusOfNode(world: RoadmapWorld, id: string): string | null {
  const n = world.nodes.get(id);
  if (!n) return null;
  switch (n.node.kind) {
    case 'project':
      return projectFocus(n.node.id);
    case 'request':
    case 'ticket':
      return n.node.identifier ?? null;
    case 'docs':
    case 'folder':
      return n.node.id;
    default:
      return null;
  }
}

/**
 * Chỗ lấy nét của mức ngoài (Esc, nút Ra ngoài): việc → yêu cầu, yêu cầu/Docs → project, thư mục → Docs, project →
 * toàn cảnh (null). `undefined` khi đã ở toàn cảnh.
 */
export function parentFocus(world: RoadmapWorld, target: FocusTarget): string | null | undefined {
  switch (target.kind) {
    case 'ticket':
    case 'folder':
      return focusOfNode(world, target.island);
    case 'request':
    case 'docs':
      return projectFocus(target.cluster);
    case 'project':
    case 'missing':
      return null;
    default:
      return undefined;
  }
}

/** Mục camera lấy nét của một chỗ đã phân giải. */
export function worldFocusOf(target: FocusTarget): WorldFocus {
  switch (target.kind) {
    case 'project':
      return { kind: 'cluster', id: target.id };
    case 'request':
    case 'docs':
      return { kind: 'island', id: target.id };
    case 'ticket':
    case 'folder':
      return { kind: 'node', id: target.id };
    default:
      return { kind: 'overview' };
  }
}

export interface FocusCrumb {
  id: string;
  label: string;
  /** null: toàn cảnh. */
  focus: string | null;
}

/** Breadcrumb của chỗ đang xem: công ty › project › yêu cầu (hoặc Docs) › việc (hoặc thư mục). */
export function focusTrail(world: RoadmapWorld, target: FocusTarget, t: TFn): FocusCrumb[] {
  const out: FocusCrumb[] = [{ id: world.company.node.id, label: world.company.node.title, focus: null }];
  if (target.kind === 'overview' || target.kind === 'missing') return out;
  const cluster = world.nodes.get(target.cluster);
  if (cluster) out.push({ id: target.cluster, label: cluster.node.title, focus: projectFocus(target.cluster) });
  const crumb = (id: string): FocusCrumb | null => {
    const n = world.nodes.get(id)?.node;
    if (!n) return null;
    const label =
      n.kind === 'docs'
        ? t('roadmap.docs')
        : n.kind === 'request'
          ? `${n.identifier} ${n.title}`
          : n.kind === 'ticket'
            ? (n.identifier ?? n.title)
            : n.title;
    return { id, label, focus: focusOfNode(world, id) };
  };
  const ids =
    target.kind === 'ticket' || target.kind === 'folder'
      ? [target.island, target.id]
      : target.kind === 'project'
        ? []
        : [target.id];
  for (const id of ids) {
    const c = crumb(id);
    if (c) out.push(c);
  }
  return out;
}

/** Dạng danh sách: project → đảo (Docs, yêu cầu) → cây việc con/thư mục; mục `currentId` được tô. */
export function worldListItems(world: RoadmapWorld, currentId: string | null): RoadmapListItem[] {
  const mark = (node: RoadmapNode): RoadmapNode => (node.id === currentId ? { ...node, current: true } : node);
  const island = (level: RoadmapLevel): RoadmapListItem => {
    const byParent = new Map<string, RoadmapNode[]>();
    for (const n of level.nodes) {
      const parent = n.parentId ?? level.center.id;
      byParent.set(parent, [...(byParent.get(parent) ?? []), n]);
    }
    const build = (id: string): RoadmapListItem[] =>
      (byParent.get(id) ?? []).map((n) => ({ node: mark(n), children: build(n.id) }));
    return { node: mark(level.center), children: build(level.center.id) };
  };
  const islands = new Map(world.islands.map((i) => [i.id, i]));
  return world.clusters.map((c) => ({
    node: mark(c.node),
    children: c.islands.flatMap((id) => {
      const i = islands.get(id);
      return i ? [island(i.level)] : [];
    }),
  }));
}

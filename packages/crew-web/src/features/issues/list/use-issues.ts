// Dữ liệu và trạng thái bộ lọc của danh sách yêu cầu. Lọc, sắp xếp, nhóm, cột, chế độ Danh sách/Bảng và mật độ bảng
// nằm trong URL query, không ghi DB.
import type { CompactIssue } from '@paperclipai/shared';
import { useQuery } from '@tanstack/react-query';
import { api, type CrewRoot, type IssueListFilters, queryKeys } from '@/api';
import { KANBAN_COLUMN_DEFAULT_PAGE_SIZE, KANBAN_COLUMN_PAGE_SIZE_OPTIONS, type KanbanColumnPageSize } from '@/ds';
import { useVisibleProjects } from '@/features/access';
import { labelledKindOf } from '../new/kinds';
import { byUpdatedDesc } from './tree';

/** Cột phụ bên phải dòng theo thứ tự hiển thị. */
export const COLUMN_IDS = ['stage', 'progress', 'assignee', 'project', 'labels', 'id', 'updated'] as const;
export type ColumnId = (typeof COLUMN_IDS)[number];
/** Cột hiện sẵn; `?hide=` ẩn bớt cột mặc định, `?show=` bật thêm cột khác (Project). */
export const DEFAULT_COLUMNS: readonly ColumnId[] = ['stage', 'progress', 'assignee', 'labels', 'id', 'updated'];
export const SORT_KEYS = ['updated', 'created', 'title'] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export const GROUP_KEYS = ['none', 'status', 'assignee', 'project'] as const;
export type GroupKey = (typeof GROUP_KEYS)[number];
export const KIND_FILTERS = ['all', 'research', 'docs', 'plan', 'other'] as const;
export type KindFilter = (typeof KIND_FILTERS)[number];
export const VIEW_MODES = ['list', 'board'] as const;
export type ViewMode = (typeof VIEW_MODES)[number];
/** Mật độ thẻ: tự động gọn khi bảng quá nhiều thẻ, hoặc ép gọn/thoáng. */
export const BOARD_DENSITIES = ['auto', 'compact', 'comfortable'] as const;
export type BoardDensity = (typeof BOARD_DENSITIES)[number];
/** Cột lạnh (Backlog, Xong, Đã hủy) mở hay thu thành thanh dọc. */
export const BOARD_LANE_MODES = ['expanded', 'collapsed'] as const;
export type BoardLaneMode = (typeof BOARD_LANE_MODES)[number];
/** Thứ tự trạng thái của Paperclip (bộ lọc và nhóm theo trạng thái). */
export const STATUS_OPTIONS = ['in_progress', 'todo', 'backlog', 'in_review', 'blocked', 'done', 'cancelled'] as const;

export interface ListState {
  q: string;
  status: string;
  projectId: string;
  assigneeAgentId: string;
  kind: KindFilter;
  sort: SortKey;
  group: GroupKey;
  hidden: ColumnId[];
  shown: ColumnId[];
  view: ViewMode;
  density: BoardDensity;
  lanes: BoardLaneMode;
  pageSize: KanbanColumnPageSize;
}

/** Tên tham số URL của từng trường trạng thái. */
export const PARAM = {
  q: 'q',
  status: 'status',
  projectId: 'project',
  assigneeAgentId: 'assignee',
  kind: 'kind',
  sort: 'sort',
  group: 'group',
  hidden: 'hide',
  shown: 'show',
  view: 'view',
  density: 'density',
  lanes: 'lanes',
  pageSize: 'per',
} as const;

/** Giá trị mặc định riêng từng trường; trùng thì bỏ khóa khỏi URL. */
const DEFAULT_VALUE: Partial<Record<keyof typeof PARAM, string>> = {
  sort: 'updated',
  view: 'list',
  density: 'auto',
  lanes: 'expanded',
  pageSize: String(KANBAN_COLUMN_DEFAULT_PAGE_SIZE),
};

const oneOf = <T extends string>(options: readonly T[], value: string | null, fallback: T): T =>
  options.find((o) => o === value) ?? fallback;

export function parseListState(params: URLSearchParams): ListState {
  const status = params.get(PARAM.status) ?? '';
  return {
    q: params.get(PARAM.q) ?? '',
    status: (STATUS_OPTIONS as readonly string[]).includes(status) ? status : '',
    projectId: params.get(PARAM.projectId) ?? '',
    assigneeAgentId: params.get(PARAM.assigneeAgentId) ?? '',
    kind: oneOf(KIND_FILTERS, params.get(PARAM.kind), 'all'),
    sort: oneOf(SORT_KEYS, params.get(PARAM.sort), 'updated'),
    group: oneOf(GROUP_KEYS, params.get(PARAM.group), 'none'),
    hidden: columnList(params.get(PARAM.hidden)),
    shown: columnList(params.get(PARAM.shown)),
    view: oneOf(VIEW_MODES, params.get(PARAM.view), 'list'),
    density: oneOf(BOARD_DENSITIES, params.get(PARAM.density), 'auto'),
    lanes: oneOf(BOARD_LANE_MODES, params.get(PARAM.lanes), 'expanded'),
    pageSize:
      KANBAN_COLUMN_PAGE_SIZE_OPTIONS.find((n) => String(n) === params.get(PARAM.pageSize)) ??
      KANBAN_COLUMN_DEFAULT_PAGE_SIZE,
  };
}

const columnList = (value: string | null): ColumnId[] =>
  (value ?? '').split(',').filter((c): c is ColumnId => COLUMN_IDS.includes(c as ColumnId));

/** Cột đang hiện: mặc định, thêm `show`, bớt `hide`. */
export function isColumnVisible(state: Pick<ListState, 'hidden' | 'shown'>, id: ColumnId): boolean {
  if (state.hidden.includes(id)) return false;
  return DEFAULT_COLUMNS.includes(id) || state.shown.includes(id);
}

/** Patch URL để bật/tắt một cột: cột mặc định ghi vào `hide`, cột thêm ghi vào `show`. */
export function columnPatch(
  state: Pick<ListState, 'hidden' | 'shown'>,
  id: ColumnId,
  visible: boolean,
): { hidden: string | null; shown: string | null } {
  const isDefault = DEFAULT_COLUMNS.includes(id);
  const hidden = state.hidden.filter((c) => c !== id);
  const shown = state.shown.filter((c) => c !== id);
  if (!visible && isDefault) hidden.push(id);
  if (visible && !isDefault) shown.push(id);
  return { hidden: hidden.join(',') || null, shown: shown.join(',') || null };
}

/** Bản sao của params với `patch` áp vào; giá trị rỗng, mặc định hoặc null thì bỏ khóa khỏi URL. */
export function patchParams(params: URLSearchParams, patch: Partial<Record<keyof typeof PARAM, string | null>>) {
  const next = new URLSearchParams(params);
  for (const [field, value] of Object.entries(patch)) {
    const key = field as keyof typeof PARAM;
    const name = PARAM[key];
    const isDefault = !value || value === 'all' || value === 'none' || DEFAULT_VALUE[key] === value;
    if (isDefault) next.delete(name);
    else next.set(name, value);
  }
  return next;
}

/** Tham số gửi lên server; loại Code/Bug/Nghiên cứu lọc ở máy khách vì server không lọc theo tên nhãn. */
export function serverFilters(state: ListState): IssueListFilters {
  return {
    view: 'compact',
    limit: 1000,
    ...(state.status ? { status: state.status } : {}),
    ...(state.projectId ? { projectId: state.projectId } : {}),
    ...(state.assigneeAgentId ? { assigneeAgentId: state.assigneeAgentId } : {}),
    ...(state.q.trim() ? { q: state.q.trim() } : {}),
  };
}

/** Loại của dòng: policy research của `crew.roots` trước, rồi nhãn `research`/`docs`/`plan`; còn lại là Code / Bug. */
export function issueKindOf(issue: CompactIssue, rootsById: ReadonlyMap<string, CrewRoot>): Exclude<KindFilter, 'all'> {
  if (rootsById.get(issue.id)?.kind === 'research') return 'research';
  return labelledKindOf(issue.labels) ?? 'other';
}

export function matchesKind(issue: CompactIssue, kind: KindFilter, rootsById: ReadonlyMap<string, CrewRoot>): boolean {
  return kind === 'all' || issueKindOf(issue, rootsById) === kind;
}

export function sortCompare(sort: SortKey): (a: CompactIssue, b: CompactIssue) => number {
  if (sort === 'title') return (a, b) => a.title.localeCompare(b.title, 'vi');
  if (sort === 'created') return (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  return byUpdatedDesc;
}

/** Dữ liệu danh sách, đã lọc theo project người xem được cấp (yêu cầu, yêu cầu gốc Crew, project). */
export function useIssuesData(companyId: string, state: ListState) {
  const filters = serverFilters(state);
  const visible = useVisibleProjects();
  const issues = useQuery({
    queryKey: queryKeys.issues(companyId, filters),
    queryFn: () => api.issues.listCompact(companyId, filters),
    select: visible.filterIssues,
  });
  // Cột Crew là phần phụ: crew.roots lỗi thì danh sách vẫn hiện, chỉ thiếu cột giai đoạn.
  const roots = useQuery({
    queryKey: queryKeys.crew('crew.roots', { companyId }),
    queryFn: () => api.crew.roots(companyId),
    select: visible.filterIssues,
  });
  const projects = useQuery({
    queryKey: queryKeys.projects(companyId),
    queryFn: () => api.projects.list(companyId),
    select: visible.filterProjects,
  });
  const agents = useQuery({ queryKey: queryKeys.agents(companyId), queryFn: () => api.agents.list(companyId) });
  // Run đang chạy để gắn nhãn "Đang chạy"; lỗi (vd. vai trò không xem được run) thì chỉ thiếu nhãn.
  const liveRuns = useQuery({
    queryKey: [...queryKeys.liveRuns(companyId), 'issues-list'],
    queryFn: () => api.runs.live(companyId),
  });
  return { issues, roots, projects, agents, liveRuns };
}

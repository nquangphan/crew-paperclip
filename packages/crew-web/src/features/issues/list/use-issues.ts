// Dữ liệu và trạng thái bộ lọc của danh sách yêu cầu. Lọc, sắp xếp, nhóm, cột nằm trong URL query, không ghi DB.
import type { CompactIssue } from '@paperclipai/shared';
import { useQuery } from '@tanstack/react-query';
import { api, type CrewRoot, type IssueListFilters, queryKeys } from '@/api';
import { RESEARCH_LABEL_NAME } from '../new/kinds';
import { byUpdatedDesc } from './tree';

export const COLUMN_IDS = ['stage', 'progress', 'project', 'assignee'] as const;
export type ColumnId = (typeof COLUMN_IDS)[number];
export const SORT_KEYS = ['updated', 'created', 'title'] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export const GROUP_KEYS = ['none', 'status', 'project', 'assignee'] as const;
export type GroupKey = (typeof GROUP_KEYS)[number];
export const KIND_FILTERS = ['all', 'research', 'other'] as const;
export type KindFilter = (typeof KIND_FILTERS)[number];
export const STATUS_OPTIONS = ['backlog', 'todo', 'in_progress', 'in_review', 'blocked', 'done', 'cancelled'] as const;

export interface ListState {
  q: string;
  status: string;
  projectId: string;
  assigneeAgentId: string;
  kind: KindFilter;
  sort: SortKey;
  group: GroupKey;
  hidden: ColumnId[];
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
} as const;

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
    hidden: (params.get(PARAM.hidden) ?? '')
      .split(',')
      .filter((c): c is ColumnId => COLUMN_IDS.includes(c as ColumnId)),
  };
}

/** Bản sao của params với `patch` áp vào; giá trị rỗng, mặc định hoặc null thì bỏ khóa khỏi URL. */
export function patchParams(params: URLSearchParams, patch: Partial<Record<keyof typeof PARAM, string | null>>) {
  const next = new URLSearchParams(params);
  for (const [field, value] of Object.entries(patch)) {
    const name = PARAM[field as keyof typeof PARAM];
    const isDefault = !value || value === 'all' || (name === PARAM.sort && value === 'updated') || value === 'none';
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

export function isResearch(issue: CompactIssue, rootsById: ReadonlyMap<string, CrewRoot>): boolean {
  if (rootsById.get(issue.id)?.kind === 'research') return true;
  return (issue.labels ?? []).some((l) => l.name === RESEARCH_LABEL_NAME);
}

export function matchesKind(issue: CompactIssue, kind: KindFilter, rootsById: ReadonlyMap<string, CrewRoot>): boolean {
  if (kind === 'all') return true;
  return isResearch(issue, rootsById) === (kind === 'research');
}

export function sortCompare(sort: SortKey): (a: CompactIssue, b: CompactIssue) => number {
  if (sort === 'title') return (a, b) => a.title.localeCompare(b.title, 'vi');
  if (sort === 'created') return (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  return byUpdatedDesc;
}

export function useIssuesData(companyId: string, state: ListState) {
  const filters = serverFilters(state);
  const issues = useQuery({
    queryKey: queryKeys.issues(companyId, filters),
    queryFn: () => api.issues.listCompact(companyId, filters),
  });
  // Cột Crew là phần phụ: crew.roots lỗi thì danh sách vẫn hiện, chỉ thiếu cột giai đoạn.
  const roots = useQuery({
    queryKey: queryKeys.crew('crew.roots', { companyId }),
    queryFn: () => api.crew.roots(companyId),
  });
  const projects = useQuery({ queryKey: queryKeys.projects(companyId), queryFn: () => api.projects.list(companyId) });
  const agents = useQuery({ queryKey: queryKeys.agents(companyId), queryFn: () => api.agents.list(companyId) });
  return { issues, roots, projects, agents };
}

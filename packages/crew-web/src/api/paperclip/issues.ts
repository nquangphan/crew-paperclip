// Issue: danh sách, chi tiết, tạo, thao tác cổng, đổi tiêu đề. Body PATCH theo server/src/routes/issues.ts:12728.
import type { ActivityEvent, CompactIssue, Issue } from '@paperclipai/shared';
import { call } from '../endpoints';
import type { Query } from '../http';

/** Bộ lọc GET /companies/:c/issues (giống ui/src/api/issues.ts). */
export interface IssueListFilters {
  status?: string;
  projectId?: string;
  parentId?: string;
  assigneeAgentId?: string;
  assigneeUserId?: string;
  touchedByUserId?: string;
  unreadForUserId?: string;
  inboxArchivedByUserId?: string;
  labelId?: string;
  attention?: 'blocked';
  descendantOf?: string;
  q?: string;
  limit?: number;
  offset?: number;
  view?: 'compact';
  [key: string]: Query[string];
}

export type IssueUpdate = Record<string, unknown> & {
  status?: string;
  comment?: string;
  description?: string;
};

export const issuesApi = {
  list: (companyId: string, filters: IssueListFilters = {}): Promise<Issue[]> =>
    call('issues.list', { companyId }, { query: filters }),
  listCompact: (companyId: string, filters: IssueListFilters = {}): Promise<CompactIssue[]> =>
    call('issues.list', { companyId }, { query: { ...filters, view: 'compact' } }),
  /** `id` là uuid hoặc mã (TPS-12). */
  get: (id: string): Promise<Issue> => call('issues.get', { id }),
  create: (companyId: string, body: Record<string, unknown>): Promise<Issue> =>
    call('issues.create', { companyId }, { body }),
  update: (id: string, body: IssueUpdate): Promise<Issue> => call('issues.update', { id }, { body }),
  /** Lịch sử của issue, mới nhất trước (S6.18). `id` là uuid hoặc mã. */
  activity: (id: string): Promise<ActivityEvent[]> => call('issues.activity', { id }),
  setTitle: (id: string, title: string): Promise<{ id: string; title: string; changed: boolean }> =>
    call('issues.setTitle', { id }, { body: { title } }),
};

export const __endpoints = [
  'issues.activity',
  'issues.create',
  'issues.get',
  'issues.list',
  'issues.setTitle',
  'issues.update',
];

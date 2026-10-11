// @vitest-environment jsdom
import type { CompanySearchResult } from '@paperclipai/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { CompanyContext } from '@/app/hooks';
import {
  canSeeIssue,
  canSeeProject,
  filterIssues,
  filterProjects,
  NO_PROJECTS,
  toVisibility,
  useVisibleProjects,
} from '@/features/access';
import { visibleTaskCounts } from '@/features/dashboard/dashboard-logic';
import { resultVisible } from '@/features/search/search-page';
import { mockServer, projectAccessRoute } from '../../app/fetch-mock';

afterEach(cleanup);

const COMPANY = { id: 'c1', name: '2P', issuePrefix: 'TPS' };
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <CompanyContext.Provider value={{ company: COMPANY, companies: [COMPANY] }}>{children}</CompanyContext.Provider>
  </QueryClientProvider>
);

const OWNER = toVisibility({ all: true, projectIds: [] });
const ONLY_A = toVisibility({ all: false, projectIds: ['pa'] });
const ISSUES = [
  { id: 'i1', projectId: 'pa' },
  { id: 'i2', projectId: 'pb' },
  { id: 'i3', projectId: null },
];

describe('quyền xem project (hàm thuần)', () => {
  it('owner thấy mọi project và cả yêu cầu không có project', () => {
    expect(canSeeProject(OWNER, 'pb')).toBe(true);
    expect(canSeeIssue(OWNER, { projectId: null })).toBe(true);
    expect(filterIssues(OWNER, ISSUES).map((i) => i.id)).toEqual(['i1', 'i2', 'i3']);
  });

  it('người bị giới hạn chỉ thấy project được cấp; yêu cầu không có project bị ẩn', () => {
    expect(canSeeProject(ONLY_A, 'pa')).toBe(true);
    expect(canSeeProject(ONLY_A, 'pb')).toBe(false);
    expect(canSeeProject(ONLY_A, null)).toBe(false);
    expect(canSeeIssue(ONLY_A, null)).toBe(false);
    expect(filterIssues(ONLY_A, ISSUES).map((i) => i.id)).toEqual(['i1']);
    expect(filterProjects(ONLY_A, [{ id: 'pa' }, { id: 'pb' }])).toEqual([{ id: 'pa' }]);
  });

  it('chưa biết quyền thì không thấy gì', () => {
    expect(toVisibility(undefined)).toBe(NO_PROJECTS);
    expect(filterIssues(NO_PROJECTS, ISSUES)).toEqual([]);
  });

  it('thẻ Tổng quan đếm từ danh sách đã lọc', () => {
    expect(visibleTaskCounts(undefined)).toBeUndefined();
    expect(
      visibleTaskCounts([{ status: 'in_progress' }, { status: 'blocked' }, { status: 'done' }, { status: 'todo' }]),
    ).toEqual({ open: 3, inProgress: 1, blocked: 1 });
  });

  it('kết quả tìm kiếm theo project của yêu cầu, tài liệu, project; agent luôn thấy', () => {
    const r = (over: Partial<CompanySearchResult>) => ({ id: 'x', type: 'issue', ...over }) as CompanySearchResult;
    const v = { all: false, canSeeProject: (id: string | null | undefined) => canSeeProject(ONLY_A, id) };
    expect(resultVisible(r({ issue: { projectId: 'pa' } as CompanySearchResult['issue'] }), v)).toBe(true);
    expect(resultVisible(r({ issue: { projectId: 'pb' } as CompanySearchResult['issue'] }), v)).toBe(false);
    expect(resultVisible(r({ artifact: { projectId: null } as CompanySearchResult['artifact'] }), v)).toBe(false);
    expect(resultVisible(r({ type: 'project', id: 'pa' }), v)).toBe(true);
    expect(resultVisible(r({ type: 'project', id: 'pb' }), v)).toBe(false);
    expect(resultVisible(r({ type: 'agent' }), v)).toBe(true);
    expect(resultVisible(r({ type: 'project', id: 'pb' }), { ...v, all: true })).toBe(true);
  });
});

describe('useVisibleProjects', () => {
  it('đọc GET …/project-access/me và lọc theo danh sách được cấp', async () => {
    const server = mockServer(projectAccessRoute('c1', ['pa']));
    const { result } = renderHook(() => useVisibleProjects(), { wrapper });
    expect(result.current).toMatchObject({ ready: false, restricted: true });
    expect(result.current.filterIssues(ISSUES)).toEqual([]);
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.restricted).toBe(true);
    expect(result.current.filterIssues(ISSUES).map((i) => i.id)).toEqual(['i1']);
    expect(server.calls.map((c) => c.url)).toEqual(['/api/crew/companies/c1/project-access/me']);
  });

  it('owner: không bị giới hạn', async () => {
    mockServer({});
    const { result } = renderHook(() => useVisibleProjects(), { wrapper });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.restricted).toBe(false);
    expect(result.current.canSeeIssue({ projectId: null })).toBe(true);
  });

  it('lỗi tải thì không thấy project nào và báo lỗi', async () => {
    mockServer({ 'GET /api/crew/companies/c1/project-access/me': { status: 500, body: { error: 'hỏng' } } });
    const { result } = renderHook(() => useVisibleProjects(), { wrapper });
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.ready).toBe(false);
    expect(result.current.canSeeProject('pa')).toBe(false);
  });
});

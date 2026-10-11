// @vitest-environment jsdom
import { cleanup, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { IssuePage } from '@/features/issues/detail/issue-page';
import { initI18n, setLanguage } from '@/i18n';
import { accessRoute, mockServer } from '../../app/fetch-mock';
import { AGENTS, ISSUE, mount, PROJECTS } from '../issues/detail-fixtures';
import { data, ID, project, ROLES, renderPage } from '../projects/helpers';

vi.mock('@/features/readiness', async (orig) => ({
  ...(await orig<object>()),
  useProjectReadiness: () => ({ data: [], isLoading: false, error: null }),
}));

import { ProjectPage } from '@/features/projects/detail/project-page';
import { ProjectsPage } from '@/features/projects/list/projects-page';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});
afterEach(cleanup);

const roles = {
  owner: { userId: 'u1', membershipRole: 'owner', contributor: false, canApprove: true },
  contributor: { userId: 'u1', membershipRole: 'viewer', contributor: true, canApprove: false },
  viewer: { userId: 'u1', membershipRole: 'viewer', contributor: false, canApprove: false },
};

const RUNS = [{ runId: 'run-running-1234', status: 'running', agentId: 'a1', startedAt: '2026-10-10T01:00:00.000Z' }];
const ATTACHMENTS = [
  {
    id: 'att1',
    originalFilename: 'anh.png',
    byteSize: 2048,
    createdByUserId: 'u1',
    createdAt: '2026-10-10T01:00:00.000Z',
  },
];
const INTERACTION = {
  id: 'c9',
  companyId: 'c1',
  issueId: 'i1',
  status: 'pending',
  createdAt: '2026-10-10T01:00:00.000Z',
  kind: 'request_confirmation',
  payload: { version: 1, prompt: 'Cho phép xóa nhánh cũ?', allowDeclineReason: true },
};

function issueServer(role: keyof typeof roles) {
  return mockServer({
    ...accessRoute('c1', roles[role]),
    'GET /api/issues/TPS-2': { body: ISSUE },
    'GET /api/issues/i1/comments': { body: [] },
    'GET /api/issues/i1/attachments': { body: ATTACHMENTS },
    'GET /api/issues/i1/documents': { body: [] },
    'GET /api/issues/i1/runs': { body: RUNS },
    'GET /api/issues/i1/live-runs': { body: [] },
    'GET /api/issues/i1/interactions': { body: [INTERACTION] },
    'GET /api/issues/i1/activity': { body: [] },
    'POST /api/issues/i1/read': { body: { id: 'i1' } },
    'GET /api/companies/c1/agents': { body: AGENTS },
    'GET /api/companies/c1/projects': { body: PROJECTS },
    'GET /api/companies/c1/issues': { body: [] },
  } as Parameters<typeof mockServer>[0]);
}

const reads = (s: ReturnType<typeof mockServer>) =>
  s.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/read'));
const WRITE_CONTROLS = ['Sửa tiêu đề', 'Sửa mô tả', 'Ép Done', 'Duyệt', 'Yêu cầu sửa', 'Dừng run', 'Xóa anh.png'];

describe('trang yêu cầu ở chế độ chỉ đọc', () => {
  it('viewer: không có nút ghi, không có ô soạn, không đánh dấu đã đọc', async () => {
    const s = issueServer('viewer');
    mount(<IssuePage />);
    expect(await screen.findByRole('heading', { name: 'Sửa trang đăng nhập' })).toBeTruthy();
    await screen.findByText(/anh\.png/);
    await screen.findAllByTestId('issue-run');
    // chờ vai trò tải xong rồi mới kiểm, để không xanh nhờ trạng thái đang tải
    await waitFor(() => expect(s.calls.some((c) => c.url === '/api/crew/companies/c1/access')).toBe(true));
    await new Promise((r) => setTimeout(r, 30));
    for (const name of WRITE_CONTROLS)
      expect(screen.queryByRole('button', { name: new RegExp(name) }), name).toBeNull();
    expect(screen.queryByRole('button', { name: 'Gửi bình luận' })).toBeNull();
    expect(screen.queryByText('Cho phép xóa nhánh cũ?')).toBeNull();
    expect(reads(s)).toHaveLength(0);
  });

  it('khách góp ý: cũng không có nút ghi; vẫn có chỗ soạn để thay bằng composer góp ý', async () => {
    const s = issueServer('contributor');
    mount(<IssuePage />);
    expect(await screen.findByRole('button', { name: 'Gửi bình luận' })).toBeTruthy();
    for (const name of WRITE_CONTROLS)
      expect(screen.queryByRole('button', { name: new RegExp(name) }), name).toBeNull();
    expect(reads(s)).toHaveLength(0);
  });

  it('owner: đủ nút ghi và đánh dấu đã đọc một lần', async () => {
    const s = issueServer('owner');
    mount(<IssuePage />);
    expect(await screen.findByRole('button', { name: 'Sửa tiêu đề' })).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Sửa mô tả' })).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Ép Done' })).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Gửi bình luận' })).toBeTruthy();
    expect(await screen.findAllByRole('button', { name: 'Dừng run' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: /Xóa anh\.png/ })).toBeTruthy();
    await waitFor(() => expect(reads(s)).toHaveLength(1));
  });
});

const PROJECT_ROUTES = {
  'GET /api/companies/c-tps/projects': { body: [project()] },
  'GET /api/companies/c-tps/sidebar-preferences/me': { body: { orderedIds: [], updatedAt: null } },
  'GET /api/projects/alpha': { body: project() },
  'GET /api/companies/c-tps/agents': {
    body: [
      { id: ID.assistant, name: 'Trợ Lý', status: 'idle' },
      { id: ID.executor, name: 'Executor Một', status: 'idle' },
      { id: ID.reviewer, name: 'Reviewer Bot', status: 'idle' },
      { id: ID.integrator, name: 'Integrator', status: 'idle' },
    ],
  },
  'GET /api/companies/c-tps/issues': { body: [] },
  'GET /api/plugins/crew.core/api/projects/p1/roles': { body: { roles: ROLES } },
  ...data('crew.setupRuns', []),
};

describe('trang project ở chế độ chỉ đọc', () => {
  it('danh sách: viewer không có Thêm project và nút gắn sao; owner có', async () => {
    mockServer({ ...PROJECT_ROUTES, ...accessRoute('c-tps', roles.viewer) });
    renderPage(<ProjectsPage />, { route: 'projects', at: '/TPS/projects' });
    expect(await screen.findByRole('link', { name: 'Alpha' })).toBeTruthy();
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole('link', { name: 'Thêm project' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Gắn sao/ })).toBeNull();
    cleanup();
    mockServer({ ...PROJECT_ROUTES, ...accessRoute('c-tps', roles.owner) });
    renderPage(<ProjectsPage />, { route: 'projects', at: '/TPS/projects' });
    expect(await screen.findByRole('link', { name: 'Thêm project' })).toBeTruthy();
    expect(await screen.findByRole('button', { name: /Gắn sao/ })).toBeTruthy();
  });

  it('chi tiết: viewer không có Đổi tên, Gỡ project, Sửa vai trò, Thêm executor; owner có', async () => {
    mockServer({ ...PROJECT_ROUTES, ...accessRoute('c-tps', roles.viewer) });
    renderPage(<ProjectPage />, { route: 'projects/:projectRef', at: '/TPS/projects/alpha?tab=roles' });
    expect(await screen.findByText('Executor Một')).toBeTruthy();
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole('button', { name: 'Đổi tên' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Gỡ/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sửa vai trò' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Thêm executor' })).toBeNull();
    cleanup();
    mockServer({ ...PROJECT_ROUTES, ...accessRoute('c-tps', roles.owner) });
    renderPage(<ProjectPage />, { route: 'projects/:projectRef', at: '/TPS/projects/alpha?tab=roles' });
    expect(await screen.findByRole('button', { name: 'Đổi tên' })).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Sửa vai trò' })).toBeTruthy();
    expect(await screen.findByRole('link', { name: 'Thêm executor' })).toBeTruthy();
  });
});

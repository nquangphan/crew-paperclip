// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { initI18n, setLanguage } from '@/i18n';
import { mockServer } from '../../app/fetch-mock';
import { data, ID, project, ROLES, renderPage } from './helpers';

const readiness = vi.hoisted(() => ({ value: [] as unknown[], candidates: [] as unknown[] }));
vi.mock('@/features/readiness', async (orig) => ({
  ...(await orig<object>()),
  useProjectReadiness: () => ({ data: readiness.value, isLoading: false, error: null }),
  loadProjectReadiness: async () => [
    { projectId: '__candidates__', state: 'ready', failed: [], agents: readiness.candidates },
  ],
}));

import { ProjectPage } from '@/features/projects/detail/project-page';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});
afterEach(cleanup);

const agentsList = [
  { id: ID.assistant, name: 'Trợ Lý', status: 'idle' },
  { id: ID.executor, name: 'Executor Một', status: 'idle' },
  { id: ID.reviewer, name: 'Reviewer Bot', status: 'idle' },
  { id: ID.integrator, name: 'Integrator', status: 'idle' },
];

function server(extra: Record<string, unknown> = {}) {
  return mockServer({
    'GET /api/projects/alpha': { body: project() },
    'GET /api/companies/c-tps/agents': { body: agentsList },
    'GET /api/companies/c-tps/issues': {
      body: [{ id: 'i1', identifier: 'TPS-1', title: 'Làm việc A', status: 'todo', assigneeAgentId: ID.executor }],
    },
    'GET /api/plugins/crew.core/api/projects/p1/roles': { body: { roles: ROLES } },
    ...data('crew.setupRuns', []),
    ...data('crew.docs.projects', [{ projectId: 'p1', repo: 'alpha' }]),
    ...data('crew.docs.tree', {
      repo: 'alpha',
      commit: 'abc',
      auditState: 'ok',
      receivedAt: '2026-10-09T17:00:00Z',
      machineId: 'm1',
      dropped: [],
      pages: [{ path: 'docs/index.md', title: 'Chỉ mục', parentPath: null }],
    }),
    ...data('crew.docs.page', { path: 'docs/index.md', title: 'Chỉ mục', text: '# Xin chào docs', links: [] }),
    ...data('crew.docs.search', [{ path: 'docs/index.md', title: 'Chỉ mục' }]),
    ...(extra as Record<string, never>),
  });
}

const mount = (search = '') =>
  renderPage(<ProjectPage />, { route: 'projects/:projectRef', at: `/TPS/projects/alpha${search}` });

describe('ProjectPage', () => {
  it('tải project theo ref (urlKey) và hiện tên', async () => {
    readiness.value = [];
    const s = server();
    mount();
    expect(await screen.findByRole('heading', { name: 'Alpha' })).toBeTruthy();
    expect(s.calls.find((c) => c.url.startsWith('/api/projects/alpha'))?.url).toContain('companyId=c-tps');
  });

  it('tab Yêu cầu: lọc theo projectId, dòng có mã và link tới yêu cầu', async () => {
    readiness.value = [];
    const s = server();
    mount();
    const row = await screen.findByRole('link', { name: /Làm việc A/ });
    expect(row.getAttribute('href')).toBe('/TPS/issues/TPS-1');
    expect(s.calls.find((c) => c.url.includes('/issues'))?.url).toContain('projectId=p1');
  });

  it('tab Vai trò: "Thêm executor" tới wizard tạo agent với ô executor-2 của project', async () => {
    readiness.value = [];
    server();
    mount('?tab=roles');
    const link = await screen.findByRole('link', { name: 'Thêm executor' });
    expect(link.getAttribute('href')).toBe('/TPS/agents/new?project=p1&slot=executor-2');
  });

  it('tab Vai trò: ô runtime hiện tên agent đang giữ; ô trống có lối thêm bằng wizard', async () => {
    readiness.value = [];
    server({
      'GET /api/plugins/crew.core/api/projects/p1/roles': {
        body: {
          roles: {
            ...ROLES,
            codexExecutorAgentId: ID.spare,
            opencodeExecutorAgentId: null,
            codexReviewerAgentId: null,
          },
        },
      },
      'GET /api/companies/c-tps/agents': {
        body: [...agentsList, { id: ID.spare, name: 'Codex Một', status: 'idle', adapterType: 'codex_local' }],
      },
    });
    mount('?tab=roles');
    expect(await screen.findByText('Codex Một')).toBeTruthy();
    expect(screen.getByText('Executor Codex (tùy chọn)')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Thêm executor Codex' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Thêm executor OpenCode' }).getAttribute('href')).toBe(
      '/TPS/agents/new?project=p1&slot=executor-opencode',
    );
    expect(screen.getByRole('link', { name: 'Thêm reviewer Codex' }).getAttribute('href')).toBe(
      '/TPS/agents/new?project=p1&slot=reviewer-codex',
    );
  });

  it('tab Vai trò: hiện 4 vai trò kèm tên agent', async () => {
    readiness.value = [];
    server();
    mount('?tab=roles');
    expect(await screen.findByText('Executor Một')).toBeTruthy();
    expect(screen.getByText('Reviewer Bot')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sửa vai trò' })).toBeTruthy();
  });

  it('tab Vai trò: thêm Executor 2 → lưu, PUT AGENTS.md; xung đột thì báo và cho ghi lại', async () => {
    const holders = [ID.assistant, ID.executor, ID.reviewer, ID.integrator].map((agentId) => ({
      agentId,
      state: 'ready',
      failed: [],
    }));
    readiness.value = [{ projectId: 'p1', state: 'ready', failed: [], agents: holders }];
    readiness.candidates = [{ agentId: ID.executor2, state: 'ready', failed: [] }];
    let put = 0;
    const s = server({
      'GET /api/agents/a1111111-1111-4111-8111-111111111111/instructions-bundle/file': {
        body: { content: 'cũ', contentHash: 'h1' },
      },
      'PUT /api/agents/a1111111-1111-4111-8111-111111111111/instructions-bundle/file': () =>
        ++put === 1 ? { status: 409, body: { error: 'conflict' } } : { body: { contentHash: 'h2' } },
      'POST /api/plugins/crew.core/api/projects/p1/roles': (init?: RequestInit) => ({
        body: { roles: JSON.parse(String(init?.body)) },
      }),
      'GET /api/companies/c-tps/agents': {
        body: [...agentsList, { id: ID.executor2, name: 'Executor Hai', status: 'idle' }],
      },
    });
    mount('?tab=roles');
    fireEvent.click(await screen.findByRole('button', { name: 'Sửa vai trò' }));
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Executor 2 (tùy chọn)' }), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('option', { name: 'Executor Hai' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu vai trò' }));
    expect(await screen.findByText(/Có người vừa sửa hướng dẫn của Trợ Lý/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Tải lại và ghi lại' }));
    expect(await screen.findByText(/Đã cập nhật hướng dẫn của Trợ Lý/)).toBeTruthy();
    expect(s.calls.filter((c) => c.method === 'PUT' && c.url.includes('instructions-bundle'))).toHaveLength(2);
  });

  it('tab Vai trò: agent đã gỡ không có trong hộp chọn', async () => {
    const holders = [ID.assistant, ID.executor, ID.reviewer, ID.integrator].map((agentId) => ({
      agentId,
      state: 'ready',
      failed: [],
    }));
    readiness.value = [{ projectId: 'p1', state: 'ready', failed: [], agents: holders }];
    readiness.candidates = [
      { agentId: ID.executor2, state: 'ready', failed: [] },
      { agentId: ID.spare, state: 'ready', failed: [] },
    ];
    server({
      'GET /api/companies/c-tps/agents': {
        body: [
          ...agentsList,
          { id: ID.executor2, name: 'Executor Hai', status: 'idle' },
          { id: ID.spare, name: 'Agent Đã Gỡ', status: 'paused' },
        ],
      },
      ...data('crew.setupRuns', [
        {
          id: 'rm1',
          companyId: 'c-tps',
          kind: 'remove-agent',
          projectKey: 'agent-d6666666',
          projectId: null,
          machineId: 'm1',
          input: { agentId: ID.spare, agentName: 'Agent Đã Gỡ', projectId: null, role: null },
          steps: {},
          status: 'done',
          runningStep: null,
          createdAt: '2026-10-10T00:00:00.000Z',
          updatedAt: '2026-10-10T00:00:00.000Z',
        },
      ]),
    });
    mount('?tab=roles');
    fireEvent.click(await screen.findByRole('button', { name: 'Sửa vai trò' }));
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Executor 2 (tùy chọn)' }), { key: 'Enter' });
    expect(await screen.findByRole('option', { name: 'Executor Hai' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Agent Đã Gỡ' })).toBeNull();
  });

  it('tab Vai trò: project chưa có dòng vai trò → thông báo vai trò file', async () => {
    readiness.value = [];
    server({ 'GET /api/plugins/crew.core/api/projects/p1/roles': { body: { roles: null } } });
    mount('?tab=roles');
    expect(await screen.findByText(/dùng vai trò trong file cấu hình/)).toBeTruthy();
  });

  it('tab Sẵn sàng: liệt kê mục hỏng, nút Làm tiếp theo ResumeTarget', async () => {
    readiness.value = [
      {
        projectId: 'p1',
        state: 'not_ready',
        failed: [{ id: 'P2', detail: 'detail.P2', agentIds: [ID.executor] }],
        agents: [
          {
            agentId: ID.executor,
            state: 'not_ready',
            failed: [
              {
                id: 'A5',
                detail: 'detail.A5',
                resume: { wizard: 'add-agent', step: 'workspace', agentId: ID.executor },
              },
              { id: 'A7', detail: 'detail.A7', resume: { none: true } },
            ],
          },
        ],
      },
    ];
    server();
    mount('?tab=readiness');
    expect((await screen.findAllByText('Có agent trong vai trò chưa sẵn sàng')).length).toBeGreaterThan(0);
    const links = screen.getAllByRole('link', { name: 'Làm tiếp' });
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe(`/TPS/agents/new?fix=${ID.executor}&step=workspace`);
    expect(screen.getByText('Checkout của agent chưa có trên máy')).toBeTruthy();
  });

  it('tab Sẵn sàng: setup run add-project dở → projects/new?resume=', async () => {
    readiness.value = [
      {
        projectId: 'p1',
        state: 'not_ready',
        failed: [{ id: 'P2', detail: 'detail.P2' }],
        agents: [
          {
            agentId: ID.executor,
            state: 'not_ready',
            failed: [{ id: 'A1', detail: 'detail.A1', resume: { wizard: 'add-project', setupRunId: 'run-3' } }],
          },
        ],
      },
    ];
    server();
    mount('?tab=readiness');
    const link = await screen.findByRole('link', { name: 'Làm tiếp' });
    expect(link.getAttribute('href')).toBe('/TPS/projects/new?resume=run-3');
  });

  it('tab Docs: cây trang, mở trang hiện markdown, tìm kiếm', async () => {
    readiness.value = [];
    const s = server();
    mount('?tab=docs');
    fireEvent.click(await screen.findByRole('button', { name: 'Chỉ mục' }));
    expect(await screen.findByText('Xin chào docs')).toBeTruthy();
    const pageCall = s.calls.find((c) => c.url.endsWith('crew.docs.page'));
    expect((pageCall?.body as { params: { path: string } } | undefined)?.params.path).toBe('docs/index.md');
    fireEvent.change(screen.getByPlaceholderText('Tìm trong docs'), { target: { value: 'chỉ' } });
    await waitFor(() => expect(s.calls.some((c) => c.url.endsWith('crew.docs.search'))).toBe(true));
  });

  it('tab Docs: project chưa có docs đồng bộ → thông báo trống', async () => {
    readiness.value = [];
    server(data('crew.docs.projects', []));
    mount('?tab=docs');
    expect(await screen.findByText('Project này chưa có docs đồng bộ từ máy')).toBeTruthy();
  });

  it('nút Đổi tên mở hộp thoại', async () => {
    readiness.value = [];
    server();
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Đổi tên' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Tên project')).toBeTruthy();
  });

  it('S8.7: header có nút Gỡ project, không có nút xóa', async () => {
    readiness.value = [];
    server();
    mount();
    await screen.findByRole('heading', { name: 'Alpha' });
    expect(await screen.findByRole('button', { name: 'Gỡ project' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /xóa/i })).toBeNull();
    expect(screen.queryByText(/Project đã gỡ/)).toBeNull();
  });

  it('project đã gỡ (archivedAt) hiện banner kèm giờ Asia/Ho_Chi_Minh và không còn nút Gỡ project', async () => {
    readiness.value = [];
    server({
      'GET /api/projects/alpha': { body: project({ archivedAt: '2026-10-10T02:30:00Z' }) },
      'GET /api/companies/c-tps/environments': { body: [] },
      ...data('crew.machines', []),
      ...data('crew.setupRuns', [
        {
          id: 'run-rm',
          kind: 'remove-project',
          status: 'done',
          projectId: 'p1',
          input: { projectId: 'p1', projectName: 'Alpha' },
          steps: {},
          updatedAt: '2026-10-10T02:30:00Z',
        },
      ]),
    });
    mount();
    expect(await screen.findByText(/Project đã gỡ lúc 10\/10\/2026 09:30/)).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Gỡ project' })).toBeNull());
  });
});

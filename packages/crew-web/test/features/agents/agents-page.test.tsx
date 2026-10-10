// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { initI18n, setLanguage } from '@/i18n';
import { mockServer } from '../../app/fetch-mock';
import { agent, data, ID, project, ROLES, renderPage } from './helpers';

const readiness = vi.hoisted(() => ({ value: [] as unknown[] }));
vi.mock('@/features/readiness', async (orig) => ({
  ...(await orig<object>()),
  useProjectReadiness: () => ({ data: readiness.value, isLoading: false, error: null }),
}));

import { AgentsPage } from '@/features/agents/list/agents-page';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
});
afterEach(cleanup);

const AGENTS = [
  agent({ id: ID.assistant, name: 'Trợ Lý', urlKey: 'tro-ly', status: 'running' }),
  agent({ id: ID.executor, name: 'Executor Một', urlKey: 'executor-mot', status: 'paused' }),
  agent({ id: ID.reviewer, name: 'Reviewer Bot', urlKey: 'reviewer-bot', status: 'error' }),
  agent({ id: ID.spare, name: 'Agent Rảnh', urlKey: 'agent-ranh', status: 'idle' }),
];

function server(extra: Record<string, unknown> = {}) {
  return mockServer({
    'GET /api/companies/c-tps/agents': { body: AGENTS },
    'GET /api/companies/c-tps/projects': { body: [project()] },
    'GET /api/plugins/crew.core/api/projects/p1/roles': { body: { roles: ROLES } },
    ...(extra as Record<string, never>),
  });
}
const mount = () => renderPage(<AgentsPage />, { route: 'agents', at: '/TPS/agents' });
const rowOf = async (name: string) => (await screen.findByText(name)).closest('tr') as HTMLElement;

describe('AgentsPage', () => {
  it('S10.1: vai trò theo project, trạng thái chạy và ReadinessBadge', async () => {
    readiness.value = [
      {
        projectId: 'p1',
        state: 'not_ready',
        failed: [],
        agents: [
          { agentId: ID.assistant, state: 'ready', failed: [] },
          {
            agentId: ID.reviewer,
            state: 'not_ready',
            failed: [{ id: 'A3', detail: 'detail.A3', resume: { none: true } }],
          },
        ],
      },
    ];
    server();
    mount();
    const tro = await rowOf('Trợ Lý');
    expect(within(tro).getByText('Alpha · Trợ Lý')).toBeTruthy();
    expect(within(tro).getByText('Sẵn sàng')).toBeTruthy();
    expect(within(tro).getByText('Đang chạy')).toBeTruthy();
    const rev = await rowOf('Reviewer Bot');
    expect(within(rev).getByText('Alpha · Reviewer')).toBeTruthy();
    expect(within(rev).getByText('Chưa sẵn sàng')).toBeTruthy();
    const spare = await rowOf('Agent Rảnh');
    expect(within(spare).queryByText(/Alpha/)).toBeNull();
  });

  it('tên agent là link tới agents/<urlKey>', async () => {
    readiness.value = [];
    server();
    mount();
    const link = await screen.findByRole('link', { name: 'Executor Một' });
    expect(link.getAttribute('href')).toBe('/TPS/agents/executor-mot');
  });

  it('S10.2: lọc Đang chạy / Tạm dừng / Lỗi', async () => {
    readiness.value = [];
    server();
    mount();
    await screen.findByText('Trợ Lý');
    fireEvent.click(screen.getByRole('button', { name: 'Tạm dừng' }));
    expect(screen.queryByText('Trợ Lý')).toBeNull();
    expect(screen.getByText('Executor Một')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Lỗi' }));
    expect(screen.getByText('Reviewer Bot')).toBeTruthy();
    expect(screen.queryByText('Executor Một')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Đang chạy' }));
    expect(screen.getByText('Trợ Lý')).toBeTruthy();
    expect(screen.queryByText('Reviewer Bot')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Tất cả' }));
    expect(screen.getByText('Agent Rảnh')).toBeTruthy();
  });

  it('S10.3: Tạm dừng gọi POST /agents/:id/pause, Tiếp tục gọi /resume', async () => {
    readiness.value = [];
    const s = server({
      [`POST /api/agents/${ID.assistant}/pause`]: { body: agent({ id: ID.assistant, status: 'paused' }) },
      [`POST /api/agents/${ID.executor}/resume`]: { body: agent({ status: 'idle' }) },
    });
    mount();
    const tro = await rowOf('Trợ Lý');
    fireEvent.click(within(tro).getByRole('button', { name: 'Tạm dừng Trợ Lý' }));
    await waitFor(() => expect(s.calls.some((c) => c.url.includes(`/agents/${ID.assistant}/pause`))).toBe(true));
    const exec = await rowOf('Executor Một');
    fireEvent.click(within(exec).getByRole('button', { name: 'Tiếp tục Executor Một' }));
    await waitFor(() => expect(s.calls.some((c) => c.url.includes(`/agents/${ID.executor}/resume`))).toBe(true));
    const pause = s.calls.find((c) => c.url.includes('/pause'));
    expect(pause?.method).toBe('POST');
    expect(pause?.url).toContain('companyId=c-tps');
  });

  it('agent đã dừng hẳn không có nút Tạm dừng/Tiếp tục', async () => {
    readiness.value = [];
    server({
      'GET /api/companies/c-tps/agents': { body: [agent({ name: 'Đã Dừng', status: 'terminated' })] },
    });
    mount();
    const row = await rowOf('Đã Dừng');
    expect(within(row).queryByRole('button')).toBeNull();
  });

  it('S10.4: nút Tạo agent tới agents/new', async () => {
    readiness.value = [];
    server();
    const router = mount();
    fireEvent.click(await screen.findByRole('link', { name: 'Tạo agent' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/TPS/agents/new'));
  });

  it('agent chưa sẵn sàng có link Làm tiếp tới wizard sửa', async () => {
    readiness.value = [
      {
        projectId: 'p1',
        state: 'not_ready',
        failed: [],
        agents: [
          {
            agentId: ID.reviewer,
            state: 'not_ready',
            failed: [
              { id: 'A2', detail: 'detail.A2', resume: { wizard: 'add-agent', step: 'pin', agentId: ID.reviewer } },
            ],
          },
        ],
      },
    ];
    server();
    mount();
    const rev = await rowOf('Reviewer Bot');
    const link = within(rev).getByRole('link', { name: 'Làm tiếp' });
    expect(link.getAttribute('href')).toBe(`/TPS/agents/new?fix=${ID.reviewer}&step=pin`);
  });

  it('agent đã gỡ ẩn mặc định, bộ lọc Đã gỡ hiện riêng chúng', async () => {
    readiness.value = [];
    server({
      'GET /api/companies/c-tps/agents': {
        body: [
          agent({ id: ID.assistant, name: 'Trợ Lý', urlKey: 'tro-ly', status: 'running' }),
          agent({ id: ID.spare, name: 'Agent Cũ', urlKey: 'agent-cu', status: 'paused' }),
        ],
      },
      ...data('crew.setupRuns', [
        {
          id: 'run-rm',
          kind: 'remove-agent',
          status: 'done',
          input: { agentId: ID.spare, agentName: 'Agent Cũ', projectId: null, role: null },
          steps: {},
          updatedAt: '2026-10-10T02:30:00Z',
        },
      ]),
    });
    mount();
    await screen.findByText('Trợ Lý');
    await waitFor(() => expect(screen.queryByText('Agent Cũ')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Đã gỡ' }));
    expect(screen.getByText('Agent Cũ')).toBeTruthy();
    expect(screen.queryByText('Trợ Lý')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Tất cả' }));
    expect(screen.queryByText('Agent Cũ')).toBeNull();
  });
});

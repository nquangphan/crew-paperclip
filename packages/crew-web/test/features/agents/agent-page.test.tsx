// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { initI18n, setLanguage } from '@/i18n';
import { mockServer } from '../../app/fetch-mock';
import { agent, data, environment, ID, project, ROLES, renderPage } from './helpers';

const readiness = vi.hoisted(() => ({ value: [] as unknown[] }));
vi.mock('@/features/readiness', async (orig) => ({
  ...(await orig<object>()),
  useProjectReadiness: () => ({ data: readiness.value, isLoading: false, error: null }),
}));

import { AgentPage } from '@/features/agents/detail/agent-page';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
});
afterEach(cleanup);

const RUNS = [
  {
    id: 'run-new-0001',
    agentId: ID.executor,
    status: 'succeeded',
    startedAt: '2026-10-10T01:00:00Z',
    createdAt: '2026-10-10T01:00:00Z',
  },
  {
    id: 'run-old-0002',
    agentId: ID.executor,
    status: 'failed',
    startedAt: '2026-10-09T01:00:00Z',
    createdAt: '2026-10-09T01:00:00Z',
  },
];

function server(extra: Record<string, unknown> = {}) {
  return mockServer({
    'GET /api/agents/executor-mot': { body: agent() },
    'GET /api/companies/c-tps/projects': { body: [project()] },
    'GET /api/plugins/crew.core/api/projects/p1/roles': { body: { roles: ROLES } },
    'GET /api/companies/c-tps/heartbeat-runs': { body: RUNS },
    'GET /api/companies/c-tps/issues': {
      body: [
        { id: 'i1', identifier: 'TPS-1', title: 'Đang làm A', status: 'in_progress', assigneeAgentId: ID.executor },
        { id: 'i2', identifier: 'TPS-2', title: 'Đã xong B', status: 'done', assigneeAgentId: ID.executor },
      ],
    },
    'GET /api/companies/c-tps/environments': { body: [environment()] },
    'GET /api/companies/c-tps/agents': { body: [agent()] },
    ...data('crew.machines', []),
    ...(extra as Record<string, never>),
  });
}
const mount = (search = '') =>
  renderPage(<AgentPage />, { route: 'agents/:agentRef', at: `/TPS/agents/executor-mot${search}` });

describe('AgentPage', () => {
  it('S11.1: tổng quan có run gần nhất, issue đang làm, environment, vai trò ở project', async () => {
    readiness.value = [];
    server();
    mount();
    expect(await screen.findByRole('heading', { name: 'Executor Một' })).toBeTruthy();
    expect(await screen.findByText('Alpha · Executor')).toBeTruthy();
    expect(await screen.findByText('Đang làm A')).toBeTruthy();
    expect(screen.queryByText('Đã xong B')).toBeNull();
    expect(await screen.findByText('mac-mini · 192.168.1.5')).toBeTruthy();
    expect(await screen.findByText('Run run-new-')).toBeTruthy();
  });

  it('S11.8: chưa sẵn sàng liệt kê bước thiếu kèm Làm tiếp tới wizard sửa', async () => {
    readiness.value = [
      {
        projectId: 'p1',
        state: 'not_ready',
        failed: [],
        agents: [
          {
            agentId: ID.executor,
            state: 'not_ready',
            failed: [
              { id: 'A2', detail: 'detail.A2', resume: { wizard: 'add-agent', step: 'pin', agentId: ID.executor } },
              {
                id: 'A5',
                detail: 'detail.A5',
                resume: { wizard: 'add-agent', step: 'workspace', agentId: ID.executor },
              },
            ],
          },
        ],
      },
    ];
    server();
    mount();
    const links = await screen.findAllByRole('link', { name: 'Làm tiếp' });
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      `/TPS/agents/new?fix=${ID.executor}&step=pin`,
      `/TPS/agents/new?fix=${ID.executor}&step=workspace`,
    ]);
    expect(screen.getAllByText(/Chưa ghim Superpowers đúng bản của máy/).length).toBeGreaterThan(0);
  });

  it('agent sẵn sàng thì không có Làm tiếp', async () => {
    readiness.value = [
      { projectId: 'p1', state: 'ready', failed: [], agents: [{ agentId: ID.executor, state: 'ready', failed: [] }] },
    ];
    server();
    mount();
    await screen.findByRole('heading', { name: 'Executor Một' });
    expect(screen.queryByRole('link', { name: 'Làm tiếp' })).toBeNull();
  });

  it('S11.6: tab Run liệt kê run của agent', async () => {
    readiness.value = [];
    const s = server();
    mount('?tab=runs');
    expect(await screen.findByText('Run run-new-')).toBeTruthy();
    expect(screen.getByText('Run run-old-')).toBeTruthy();
    const call = s.calls.find((c) => c.url.includes('/heartbeat-runs'));
    expect(call?.url).toContain(`agentId=${ID.executor}`);
  });

  it('tab hợp lệ lấy từ ?tab=, tab lạ rơi về tổng quan; có đủ 5 tab', async () => {
    readiness.value = [];
    server();
    mount('?tab=hack');
    await screen.findByRole('heading', { name: 'Executor Một' });
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent);
    expect(tabs).toEqual(['Tổng quan', 'Hướng dẫn', 'Skills', 'Cấu hình chạy', 'Run']);
  });

  it('S11.9: có nút Gỡ agent, không có nút xóa, quyền hay API key', async () => {
    readiness.value = [];
    server();
    mount();
    await screen.findByRole('heading', { name: 'Executor Một' });
    expect(await screen.findByRole('button', { name: 'Gỡ agent' })).toBeTruthy();
    const names = screen.getAllByRole('button').map((b) => b.textContent ?? '');
    expect(names.join('|')).not.toMatch(/xóa|dừng hẳn|quyền|api key|permission/i);
  });

  it('Đổi tên mở dialog và PATCH name+icon', async () => {
    readiness.value = [];
    const s = server({ [`PATCH /api/agents/${ID.executor}`]: { body: agent({ name: 'Mới' }) } });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Đổi tên' }));
    fireEvent.change(screen.getByLabelText('Tên agent'), { target: { value: 'Mới' } });
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(s.calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(Object.keys(s.calls.find((c) => c.method === 'PATCH')?.body as object).sort()).toEqual(['icon', 'name']);
  });

  it('lỗi tải agent hiện ErrorState', async () => {
    readiness.value = [];
    server({ 'GET /api/agents/executor-mot': { status: 404, body: { error: 'Agent not found' } } });
    mount();
    expect(await screen.findByText('Agent not found')).toBeTruthy();
  });
});

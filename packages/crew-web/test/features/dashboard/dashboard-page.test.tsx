// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CompanyContext, MeContext } from '@/app/hooks';
import { routes } from '@/features/dashboard/routes';
import { initI18n, setLanguage } from '@/i18n';
import { mockServer } from '../../app/fetch-mock';
import machines from '../../ds/crew/__fixtures__/machines.json';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
  await import('@/features/dashboard/dashboard-page');
});
afterEach(cleanup);

const COMPANY = { id: 'c1', name: '2P', issuePrefix: 'TPS' };
const ME = { id: 'u1', name: 'Owner', email: 'owner@example.com', image: null };

// Nguồn: GET /api/companies/:c/dashboard (DashboardSummary), /issues, /heartbeat-runs, /live-runs, /agents;
// data crew.machines (loadCrewMachines) và crew.roots (loadCrewRoots) của plugin crew.core.
const SUMMARY = {
  companyId: 'c1',
  agents: { active: 4, running: 2, paused: 1, error: 1 },
  tasks: { open: 7, inProgress: 3, blocked: 2, done: 10 },
  costs: { monthSpendCents: 12345, monthBudgetCents: 50000, monthUtilizationPercent: 24 },
  pendingApprovals: 5,
  budgets: { activeIncidents: 1, pendingApprovals: 1, pausedAgents: 0, pausedProjects: 0 },
  runActivity: [],
};
const awaiting = (id: string, userId: string, status = 'in_review') => ({
  id,
  createdAt: '2026-10-10T01:00:00.000Z',
  updatedAt: '2026-10-10T01:00:00.000Z',
  companyId: 'c1',
  identifier: `TPS-${id}`,
  title: `Issue ${id}`,
  status,
  // Hình dữ liệu của danh sách thật: executionState luôn null, người duyệt nằm ở reviewAttention.
  executionState: null,
  reviewAttention: {
    state: 'covered',
    reason: null,
    paths: [
      {
        kind: 'execution_participant',
        label: 'Execution review participant',
        responder: 'x',
        since: null,
        ref: userId,
      },
    ],
  },
});
const ISSUES = [awaiting('1', 'u1'), awaiting('2', 'u1'), awaiting('3', 'u2'), awaiting('4', 'u1', 'done')];
const RUNS = [
  {
    id: 'run-aaaa-1111',
    agentId: 'a1',
    agentName: 'Executor Alpha',
    status: 'running',
    issueId: '1',
    startedAt: '2026-10-10T01:00:00.000Z',
    finishedAt: null,
    createdAt: '2026-10-10T01:00:00.000Z',
  },
  {
    id: 'run-bbbb-2222',
    agentId: 'a2',
    agentName: 'Reviewer Alpha',
    status: 'failed',
    issueId: null,
    startedAt: null,
    finishedAt: null,
    createdAt: '2026-10-10T00:00:00.000Z',
  },
];
const ACTIVITY = [
  {
    id: 'ev1',
    actorType: 'agent',
    actorId: 'a1',
    action: 'issue.updated',
    entityType: 'issue',
    entityId: '1',
    details: null,
    createdAt: '2026-10-10T01:30:00.000Z',
  },
  {
    id: 'ev2',
    actorType: 'user',
    actorId: 'u1',
    action: 'agent.paused',
    entityType: 'agent',
    entityId: 'a2',
    details: null,
    createdAt: '2026-10-10T01:00:00.000Z',
  },
];
const MACHINE = {
  machineId: 'm-mini',
  hostname: 'mac-mini',
  lastSeenAt: new Date().toISOString(),
  online: true,
  latest: machines.full,
  load24h: [],
};
const ROOTS = [
  {
    id: 'r1',
    identifier: 'TPS-10',
    title: 'Yêu cầu cũ',
    status: 'done',
    updatedAt: '2026-10-08T00:00:00.000Z',
    doneChildren: 2,
    totalChildren: 2,
    kind: 'code',
    stage: null,
  },
  {
    id: 'r2',
    identifier: 'TPS-11',
    title: 'Yêu cầu mới',
    status: 'in_review',
    updatedAt: '2026-10-10T00:00:00.000Z',
    doneChildren: 1,
    totalChildren: 3,
    kind: 'code',
    stage: null,
  },
];

function crewData(key: string, data: unknown) {
  return { [`POST /api/plugins/crew.core/data/${key}`]: { body: { data } } };
}

function server(extra: Record<string, never | object> = {}) {
  return mockServer({
    'GET /api/companies/c1/dashboard': { body: SUMMARY },
    'GET /api/companies/c1/issues': { body: ISSUES },
    'GET /api/companies/c1/live-runs': { body: RUNS },
    'GET /api/companies/c1/activity': { body: ACTIVITY },
    'GET /api/companies/c1/projects': { body: [] },
    'GET /api/companies/c1/agents': {
      body: [
        { id: 'a1', name: 'Executor Alpha' },
        { id: 'a2', name: 'Reviewer Alpha' },
      ],
    },
    ...crewData('crew.machines', [MACHINE]),
    ...crewData('crew.roots', ROOTS),
    ...extra,
  });
}

function mount() {
  const router = createMemoryRouter(
    [
      { path: '/:companyPrefix', children: routes },
      { path: '/:companyPrefix/*', element: <div>đích khác</div> },
    ],
    { initialEntries: ['/TPS/dashboard'] },
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CompanyContext.Provider value={{ company: COMPANY, companies: [COMPANY] }}>
        <MeContext.Provider value={ME}>
          <RouterProvider router={router} />
        </MeContext.Provider>
      </CompanyContext.Provider>
    </QueryClientProvider>,
  );
  return router;
}

const stat = (label: string) => {
  const card = screen.getAllByTestId('stat-card').find((c) => c.textContent?.includes(label)) as HTMLElement;
  return within(card).getByTestId('stat-value').textContent;
};
const card = (label: string) =>
  screen.getAllByTestId('stat-card').find((c) => c.textContent?.includes(label)) as HTMLElement;

describe('DashboardPage thẻ số (S2.1)', () => {
  it('4 thẻ: tổng agent bật (kèm chạy/tạm dừng/lỗi), đang làm, kẹt, chờ bạn duyệt theo quy tắc tab Hộp thư', async () => {
    server();
    mount();
    await screen.findByText('Yêu cầu mới');
    expect(screen.getAllByTestId('stat-card')).toHaveLength(4);
    expect(stat('Agent đang bật')).toBe('8');
    expect(card('Agent đang bật').textContent).toContain('2 đang chạy, 1 tạm dừng, 1 lỗi');
    expect(stat('Yêu cầu đang làm')).toBe('3');
    expect(card('Yêu cầu đang làm').textContent).toContain('7 đang mở');
    expect(stat('Yêu cầu bị kẹt')).toBe('2');
    // issue 1, 2 của u1; 3 của người khác; 4 đã done.
    await waitFor(() => expect(stat('Chờ bạn duyệt')).toBe('2'));
  });

  it('không có thẻ chi phí, ngân sách, nút điều khiển hàng loạt hay banner Connectors', async () => {
    server();
    mount();
    await screen.findByText('Yêu cầu mới');
    const text = document.body.textContent ?? '';
    for (const banned of [/chi phí/i, /ngân sách/i, /budget/i, /resume all/i, /tiếp tục tất cả/i, /connectors?/i]) {
      expect(text).not.toMatch(banned);
    }
    expect(screen.queryAllByRole('button', { name: /tất cả/i })).toHaveLength(0);
  });

  it('thẻ bấm được sang trang tương ứng', async () => {
    const router = mount();
    server();
    fireEvent.click(await screen.findByRole('link', { name: /Chờ bạn duyệt/ }));
    expect(router.state.location.pathname).toBe('/TPS/inbox');
  });
});

describe('DashboardPage khối Agent, biểu đồ, hoạt động, máy, yêu cầu (S2.2–S2.5)', () => {
  it('thẻ run của agent: tên, yêu cầu gắn kèm, link run', async () => {
    server();
    mount();
    const cards = await screen.findAllByTestId('agent-run-card');
    expect(cards).toHaveLength(2);
    expect(within(cards[0]).getByText('Executor Alpha')).toBeTruthy();
    expect(within(cards[0]).getByText('Issue 1')).toBeTruthy();
    expect(within(cards[0]).getAllByRole('link')[0].getAttribute('href')).toBe('/TPS/runs/run-aaaa-1111');
    expect(within(cards[1]).getByText('Không gắn yêu cầu nào')).toBeTruthy();
  });

  it('có ba biểu đồ 14 ngày', async () => {
    server();
    mount();
    await screen.findByText('Yêu cầu mới');
    for (const title of ['Run theo ngày', 'Yêu cầu theo trạng thái', 'Tỉ lệ thành công']) {
      expect(screen.getByText(title)).toBeTruthy();
    }
  });

  it('hoạt động gần đây: ai làm gì, đích; yêu cầu mở popup bằng ?issue=', async () => {
    server();
    const router = mount();
    const rows = await screen.findAllByTestId('activity-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Executor Alpha');
    expect(rows[0].textContent).toContain('đã cập nhật');
    expect(rows[0].textContent).toContain('Issue 1');
    expect(rows[1].textContent).toContain('Bạn');
    expect(rows[1].textContent).toContain('đã tạm dừng');
    expect(rows[0].getAttribute('href')).toBe('/TPS/issues/TPS-1');
    fireEvent.click(rows[0]);
    expect(router.state.location.pathname).toBe('/TPS/dashboard');
    expect(router.state.location.search).toBe('?issue=TPS-1');
  });

  it('widget Máy hiện máy từ crew.machines', async () => {
    server();
    mount();
    expect(await screen.findByText('mac-mini')).toBeTruthy();
    expect(screen.getByText('Trực tuyến')).toBeTruthy();
  });

  it('yêu cầu gần đây sắp theo cập nhật mới nhất; click mở popup, Cmd+click giữ link trang đầy đủ', async () => {
    server();
    const router = mount();
    const first = await screen.findByRole('link', { name: /Yêu cầu mới/ });
    const second = screen.getByRole('link', { name: /Yêu cầu cũ/ });
    expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(first.getAttribute('href')).toBe('/TPS/issues/TPS-11');
    fireEvent.click(first, { metaKey: true });
    expect(router.state.location.search).toBe('');
    fireEvent.click(first);
    expect(router.state.location.pathname).toBe('/TPS/dashboard');
    expect(router.state.location.search).toBe('?issue=TPS-11');
  });

  it('mỗi khối lỗi độc lập, hiện nguyên văn', async () => {
    server({
      'GET /api/companies/c1/live-runs': { status: 500, body: { error: 'bảng run hỏng' } },
      'GET /api/companies/c1/dashboard': { status: 500, body: { error: 'dashboard hỏng' } },
    });
    mount();
    expect(await screen.findByText(/bảng run hỏng/)).toBeTruthy();
    expect(await screen.findByText(/dashboard hỏng/)).toBeTruthy();
    expect(await screen.findByText('mac-mini')).toBeTruthy();
  });

  it('mọi agent tạm dừng thì có banner cảnh báo', async () => {
    server({ 'GET /api/companies/c1/agents': { body: [{ id: 'a1', name: 'A', status: 'paused' }] } });
    mount();
    expect(await screen.findByText('Mọi agent đều tạm dừng, sẽ không có gì chạy.')).toBeTruthy();
  });
});

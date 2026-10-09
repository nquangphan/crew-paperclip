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
    status: 'running',
    startedAt: '2026-10-10T01:00:00.000Z',
    createdAt: '2026-10-10T01:00:00.000Z',
  },
  { id: 'run-bbbb-2222', agentId: 'a2', status: 'failed', startedAt: null, createdAt: '2026-10-10T00:00:00.000Z' },
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
    'GET /api/companies/c1/heartbeat-runs': { body: RUNS },
    'GET /api/companies/c1/live-runs': { body: [RUNS[0]] },
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

describe('DashboardPage thẻ số (S2.1)', () => {
  it('lấy số từ /dashboard và đếm "chờ bạn duyệt" theo cùng quy tắc tab Hộp thư', async () => {
    server();
    mount();
    await screen.findByText(/Executor Alpha/);
    await screen.findByText('Yêu cầu mới');
    expect(stat('Agent đang chạy')).toBe('2');
    expect(stat('Agent tạm dừng')).toBe('1');
    expect(stat('Yêu cầu đang mở')).toBe('7');
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

describe('DashboardPage run, máy, yêu cầu (S2.2–S2.4)', () => {
  it('run gần đây có link Xem run tới trang run, kèm số run đang chạy', async () => {
    server();
    mount();
    const rows = await screen.findAllByTestId('recent-run');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText(/Executor Alpha/)).toBeTruthy();
    expect(within(rows[0]).getByRole('link', { name: 'Xem run' }).getAttribute('href')).toBe('/TPS/runs/run-aaaa-1111');
    expect(screen.getByText('1 đang chạy')).toBeTruthy();
  });

  it('widget Máy hiện máy từ crew.machines', async () => {
    server();
    mount();
    expect(await screen.findByText('mac-mini')).toBeTruthy();
    expect(screen.getByText('Trực tuyến')).toBeTruthy();
  });

  it('yêu cầu gần đây sắp theo cập nhật mới nhất và mở đúng issue', async () => {
    server();
    const router = mount();
    const first = await screen.findByRole('link', { name: /Yêu cầu mới/ });
    const second = screen.getByRole('link', { name: /Yêu cầu cũ/ });
    expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(first);
    expect(router.state.location.pathname).toBe('/TPS/issues/TPS-11');
  });

  it('mỗi khối lỗi độc lập, hiện nguyên văn', async () => {
    server({
      'GET /api/companies/c1/heartbeat-runs': { status: 500, body: { error: 'bảng run hỏng' } },
      'GET /api/companies/c1/dashboard': { status: 500, body: { error: 'dashboard hỏng' } },
    });
    mount();
    expect(await screen.findByText(/bảng run hỏng/)).toBeTruthy();
    expect(await screen.findByText(/dashboard hỏng/)).toBeTruthy();
    expect(await screen.findByText('mac-mini')).toBeTruthy();
  });
});

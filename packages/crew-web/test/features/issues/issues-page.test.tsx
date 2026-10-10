// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CompanyContext } from '@/app/hooks';
import { IssuesPage } from '@/features/issues/list/issues-page';
import { initI18n, setLanguage } from '@/i18n';
import { mockServer } from '../../app/fetch-mock';

vi.mock('@/features/readiness', () => ({
  useProjectReadiness: () => ({
    isLoading: false,
    data: [{ projectId: 'p1', state: 'ready', failed: [], agents: [] }],
  }),
}));

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});
afterEach(cleanup);

const COMPANY = { id: 'c1', name: '2P', issuePrefix: 'TPS' };

// Nguồn: GET /api/companies/:c/issues?view=compact (CompactIssue), data crew.roots, projects, agents.
const issue = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  identifier: `TPS-${id}`,
  title: `Yêu cầu ${id}`,
  status: 'todo',
  parentId: null,
  projectId: 'p1',
  assigneeAgentId: 'a1',
  updatedAt: '2026-10-10T01:00:00.000Z',
  createdAt: '2026-10-09T01:00:00.000Z',
  labels: [],
  ...over,
});

const ISSUES = [
  issue('1', { updatedAt: '2026-10-10T05:00:00.000Z', status: 'in_progress' }),
  issue('2', { parentId: '1', updatedAt: '2026-10-10T04:00:00.000Z', status: 'done' }),
  issue('3', { updatedAt: '2026-10-09T05:00:00.000Z', labels: [{ id: 'l1', name: 'research' }] }),
  issue('4', { parentId: 'vang-mat', updatedAt: '2026-10-08T05:00:00.000Z' }),
];
const ROOTS = [
  {
    id: '1',
    identifier: 'TPS-1',
    title: 'Yêu cầu 1',
    status: 'in_progress',
    updatedAt: '2026-10-10T05:00:00.000Z',
    doneChildren: 1,
    totalChildren: 2,
    kind: 'code',
    stage: { currentStageId: 's1', currentType: 'review', completed: [], position: 0 },
  },
];

function server(over: Record<string, unknown> = {}) {
  return mockServer({
    'GET /api/companies/c1/issues': { body: ISSUES },
    'POST /api/plugins/crew.core/data/crew.roots': { body: { data: ROOTS } },
    'GET /api/companies/c1/projects': { body: [{ id: 'p1', name: 'Alpha', archivedAt: null }] },
    'GET /api/companies/c1/agents': { body: [{ id: 'a1', name: 'Trợ Lý Alpha' }] },
    ...over,
  } as Parameters<typeof mockServer>[0]);
}

function Where() {
  const loc = useLocation();
  return <output data-testid="loc">{`${loc.pathname}${loc.search}`}</output>;
}

function mount(path = '/TPS/issues') {
  const router = createMemoryRouter(
    [
      {
        path: '/:companyPrefix/issues',
        element: (
          <CompanyContext.Provider value={{ company: COMPANY, companies: [COMPANY] }}>
            <IssuesPage />
            <Where />
          </CompanyContext.Provider>
        ),
      },
    ],
    { initialEntries: [path] },
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

const rows = () => screen.getAllByTestId('issue-row');
const idOf = (row: HTMLElement) => row.getAttribute('data-issue-id');
const loc = () => screen.getByTestId('loc').textContent;

describe('IssuesPage danh sách (S4.1)', () => {
  it('số dòng khớp API và con nằm ngay dưới đúng gốc', async () => {
    server();
    mount();
    await screen.findByText('Yêu cầu 1');
    expect(rows()).toHaveLength(ISSUES.length);
    expect(rows().map(idOf)).toEqual(['1', '2', '3', '4']);
    expect(rows()[1].getAttribute('data-depth')).toBe('1');
    expect(rows()[3].getAttribute('data-depth')).toBe('0');
  });

  it('thu và mở yêu cầu con', async () => {
    server();
    mount();
    await screen.findByText('Yêu cầu 1');
    fireEvent.click(screen.getByRole('button', { name: 'Thu yêu cầu con' }));
    expect(rows().map(idOf)).toEqual(['1', '3', '4']);
    fireEvent.click(screen.getByRole('button', { name: 'Mở yêu cầu con' }));
    expect(rows().map(idOf)).toEqual(['1', '2', '3', '4']);
  });

  it('dòng liên kết tới trang yêu cầu theo mã', async () => {
    server();
    mount();
    const link = await screen.findByRole('link', { name: 'Yêu cầu 1' });
    expect(link.getAttribute('href')).toBe('/TPS/issues/TPS-1');
  });
});

describe('IssuesPage cột Crew (S4.3)', () => {
  it('giai đoạn và x/y con xong lấy từ crew.roots theo id', async () => {
    server();
    mount();
    await screen.findByText('Yêu cầu 1');
    const root = rows()[0];
    await waitFor(() => expect(within(root).getByText('1/2 con xong')).toBeTruthy());
    expect(within(root).getByText('Reviewer')).toBeTruthy();
    expect(within(rows()[2]).queryByText(/con xong/)).toBeNull();
  });

  it('ẩn cột Giai đoạn Crew khi bỏ chọn và ghi vào URL', async () => {
    server();
    mount();
    await screen.findByText('Yêu cầu 1');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Giai đoạn Crew' }));
    expect(screen.queryByRole('columnheader', { name: 'Giai đoạn Crew' })).toBeNull();
    expect(loc()).toContain('hide=stage');
  });
});

describe('IssuesPage lọc, sắp xếp, nhóm (S4.2)', () => {
  it('bộ lọc trong URL được gửi lên API', async () => {
    const { calls } = server();
    mount('/TPS/issues?status=todo&project=p1&assignee=a1&q=tinh');
    await screen.findByText('Yêu cầu 1');
    const url = calls.find((c) => c.url.startsWith('/api/companies/c1/issues'))?.url ?? '';
    const q = new URLSearchParams(url.split('?')[1]);
    expect(q.get('status')).toBe('todo');
    expect(q.get('projectId')).toBe('p1');
    expect(q.get('assigneeAgentId')).toBe('a1');
    expect(q.get('q')).toBe('tinh');
    expect(q.get('view')).toBe('compact');
  });

  it('bộ lọc Người làm không có agent đã gỡ, trừ khi đang được chọn', async () => {
    const removed = {
      id: 'rm1',
      companyId: 'c1',
      kind: 'remove-agent',
      projectKey: 'agent-a2',
      projectId: null,
      machineId: 'm1',
      input: { agentId: 'a2', agentName: 'Agent Đã Gỡ', projectId: null, role: null },
      steps: {},
      status: 'done',
      runningStep: null,
      createdAt: '2026-10-10T00:00:00.000Z',
      updatedAt: '2026-10-10T00:00:00.000Z',
    };
    const over = {
      'GET /api/companies/c1/agents': {
        body: [
          { id: 'a1', name: 'Trợ Lý Alpha', status: 'idle' },
          { id: 'a2', name: 'Agent Đã Gỡ', status: 'paused' },
        ],
      },
      'POST /api/plugins/crew.core/data/crew.setupRuns': { body: { data: [removed] } },
    };
    const ready = async (path?: string) => {
      const s = server(over);
      mount(path);
      await screen.findByText('Yêu cầu 1');
      await waitFor(() => expect(s.calls.some((c) => c.url.endsWith('/crew.setupRuns'))).toBe(true));
      await new Promise((r) => setTimeout(r, 0));
    };
    const open = async () => {
      fireEvent.keyDown(screen.getByRole('combobox', { name: 'Người làm' }), { key: 'Enter' });
      await screen.findByRole('option', { name: 'Trợ Lý Alpha' });
    };
    await ready();
    await open();
    expect(screen.queryByRole('option', { name: 'Agent Đã Gỡ' })).toBeNull();
    cleanup();
    await ready('/TPS/issues?assignee=a2');
    await open();
    expect(screen.getByRole('option', { name: 'Agent Đã Gỡ' })).toBeTruthy();
  });

  it('chọn bộ lọc thì đổi URL, không ghi gì lên server', async () => {
    const { calls } = server();
    mount();
    await screen.findByText('Yêu cầu 1');
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Trạng thái' }), { key: 'Enter' });
    fireEvent.click(screen.getByRole('option', { name: 'Đang làm' }));
    await waitFor(() => expect(loc()).toContain('status=in_progress'));
    expect(calls.filter((c) => c.method !== 'GET' && !c.url.includes('/data/'))).toEqual([]);
  });

  it('lọc loại Nghiên cứu theo nhãn ở máy khách', async () => {
    server();
    mount('/TPS/issues?kind=research');
    await screen.findByText('Yêu cầu 3');
    expect(rows().map(idOf)).toEqual(['3']);
  });

  it('sắp xếp theo tiêu đề đảo thứ tự gốc, con vẫn nằm dưới cha', async () => {
    server({
      'GET /api/companies/c1/issues': {
        body: [
          issue('1', { title: 'Zeta' }),
          issue('2', { parentId: '1', title: 'Con' }),
          issue('3', { title: 'Alpha' }),
        ],
      },
    });
    mount('/TPS/issues?sort=title');
    await screen.findByText('Zeta');
    expect(rows().map(idOf)).toEqual(['3', '1', '2']);
  });

  it('nhóm theo trạng thái chia thành các nhóm có tiêu đề', async () => {
    server();
    mount('/TPS/issues?group=status');
    await screen.findByText('Yêu cầu 1');
    const headings = screen.getAllByTestId('group-heading').map((h) => h.textContent);
    expect(headings.some((h) => h?.includes('Đang làm'))).toBe(true);
    expect(headings.some((h) => h?.includes('Cần làm'))).toBe(true);
  });

  it('đặt lại bộ lọc xóa tham số khỏi URL', async () => {
    server();
    mount('/TPS/issues?status=todo&kind=research');
    await screen.findByText('Yêu cầu 3');
    fireEvent.click(screen.getByRole('button', { name: 'Xóa bộ lọc' }));
    await waitFor(() => expect(loc()).toBe('/TPS/issues'));
  });
});

describe('IssuesPage lỗi và trống', () => {
  it('lỗi server hiện nguyên văn', async () => {
    server({ 'GET /api/companies/c1/issues': { status: 500, body: { error: 'Cơ sở dữ liệu lỗi' } } });
    mount();
    expect(await screen.findByText('Cơ sở dữ liệu lỗi')).toBeTruthy();
  });

  it('danh sách rỗng', async () => {
    server({ 'GET /api/companies/c1/issues': { body: [] } });
    mount();
    expect(await screen.findByText('Chưa có yêu cầu nào')).toBeTruthy();
  });
});

describe('IssuesPage Yêu cầu mới (S4.4)', () => {
  it('nút mở dialog bằng ?new=1', async () => {
    server();
    mount();
    await screen.findByText('Yêu cầu 1');
    fireEvent.click(screen.getByRole('button', { name: 'Yêu cầu mới' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(loc()).toContain('new=1');
  });

  it('?new=1 từ sidebar tự mở dialog; đóng thì bỏ tham số', async () => {
    server();
    mount('/TPS/issues?new=1');
    expect(await screen.findByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Hủy' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(loc()).toBe('/TPS/issues');
  });
});

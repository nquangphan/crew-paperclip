// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CompanyContext } from '@/app/hooks';
import { IssuePage } from '@/features/issues/detail/issue-page';
import { IssuesPage } from '@/features/issues/list/issues-page';
import { initI18n, setLanguage } from '@/i18n';
import { accessRoute, mockServer } from '../../app/fetch-mock';
import { AGENTS, ISSUE, mount, PROJECTS } from '../issues/detail-fixtures';
import { DIRECTORY, OWNER_ACCESS, QC_LIST } from '../qc/fixtures';

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

const AWAITING = '/api/crew/companies/c1/awaiting-owner';
const COMPANY = { id: 'c1', name: '2P', issuePrefix: 'TPS' };
const card = (issueId: string) => ({
  issueId,
  interactionId: `card-${issueId}`,
  kind: 'ask_user_questions',
  createdAt: '2026-11-05T01:00:00.000Z',
});
const listIssue = (id: string, status: string) => ({
  id,
  identifier: `TPS-${id}`,
  title: `Yêu cầu ${id}`,
  status,
  parentId: null,
  projectId: 'p1',
  assigneeAgentId: 'a1',
  updatedAt: '2026-11-05T01:00:00.000Z',
  createdAt: '2026-11-04T01:00:00.000Z',
  labels: [],
});
// Trạng thái lõi: 1 đang làm, 2 bị chặn (cả hai có thẻ chờ owner), 3 đang làm không có thẻ, 4 đã xong còn sót thẻ.
const ISSUES = [
  listIssue('1', 'in_progress'),
  listIssue('2', 'blocked'),
  listIssue('3', 'in_progress'),
  listIssue('4', 'done'),
];

function renderList(path: string) {
  mockServer({
    ...accessRoute('c1', OWNER_ACCESS),
    'GET /api/companies/c1/issues': { body: ISSUES },
    'POST /api/plugins/crew.core/data/crew.roots': { body: { data: [] } },
    'GET /api/companies/c1/projects': { body: PROJECTS },
    'GET /api/companies/c1/agents': { body: AGENTS },
    [`GET ${QC_LIST}`]: { body: { items: [] } },
    [`GET ${AWAITING}`]: { body: { items: [card('1'), card('2'), card('4')] } },
  } as Parameters<typeof mockServer>[0]);
  const router = createMemoryRouter(
    [
      {
        path: '/:companyPrefix/issues',
        element: (
          <CompanyContext.Provider value={{ company: COMPANY, companies: [COMPANY] }}>
            <IssuesPage />
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
}

const hasBadge = (root: HTMLElement) => within(root).queryByTestId('awaiting-owner-badge') !== null;

describe('"Chờ owner trả lời" ở danh sách và Bảng', () => {
  it('danh sách: biểu tượng, nhãn trạng thái và nhãn chờ owner thay cho Đang làm/Đang bị chặn', async () => {
    renderList('/TPS/issues');
    await waitFor(() => expect(screen.getAllByTestId('awaiting-owner-badge')).toHaveLength(2));
    const rows = new Map(screen.getAllByTestId('issue-row').map((r) => [r.getAttribute('data-issue-id'), r]));
    const row = (id: string) => rows.get(id) as HTMLElement;
    const glyph = (id: string) => row(id).querySelector('[data-slot="status-glyph"]')?.getAttribute('data-status');
    expect(['1', '2', '3', '4'].map(glyph)).toEqual(['awaiting_owner', 'awaiting_owner', 'in_progress', 'done']);
    expect(['1', '2', '3', '4'].map((id) => hasBadge(row(id)))).toEqual([true, true, false, false]);
    expect(within(row('1')).getAllByText('Chờ owner trả lời').length).toBeGreaterThan(0);
  });

  it('bảng: thẻ ở nguyên cột trạng thái lõi, mang nhãn chờ owner', async () => {
    renderList('/TPS/issues?view=board');
    await waitFor(() => expect(screen.getAllByTestId('awaiting-owner-badge')).toHaveLength(2));
    const column = (status: string) =>
      screen.getAllByTestId('kanban-column').find((c) => c.getAttribute('data-status') === status) as HTMLElement;
    const ids = (status: string) =>
      within(column(status))
        .getAllByTestId('kanban-card')
        .map((c) => [c.getAttribute('data-issue-id'), hasBadge(c)]);
    expect(ids('in_progress')).toEqual([
      ['1', true],
      ['3', false],
    ]);
    expect(ids('blocked')).toEqual([['2', true]]);
  });
});

const QUESTION = {
  id: 'card-i1',
  companyId: 'c1',
  issueId: 'i1',
  status: 'pending',
  createdAt: '2026-11-05T01:00:00.000Z',
  kind: 'ask_user_questions',
  title: 'Trợ Lý cần hỏi thêm',
  payload: {
    version: 1,
    questions: [
      {
        id: 'db',
        prompt: 'Dùng cơ sở dữ liệu nào?',
        selectionMode: 'single',
        required: true,
        options: [
          { id: 'pg', label: 'Postgres' },
          { id: 'sqlite', label: 'SQLite' },
        ],
      },
    ],
  },
};

describe('"Chờ owner trả lời" ở chi tiết', () => {
  it('đầu trang và cột Thuộc tính hiện chờ owner; trả lời thẻ xong thì đọc lại và về Đang làm', async () => {
    let pending = true;
    const { calls } = mockServer({
      ...accessRoute('c1', OWNER_ACCESS),
      'GET /api/issues/TPS-2': { body: { ...ISSUE, status: 'in_progress', executionState: null } },
      'GET /api/issues/i1/comments': { body: [] },
      'GET /api/issues/i1/attachments': { body: [] },
      'GET /api/issues/i1/documents': { body: [] },
      'GET /api/issues/i1/runs': { body: [] },
      'GET /api/issues/i1/live-runs': { body: [] },
      'GET /api/issues/i1/interactions': () => ({ body: pending ? [QUESTION] : [{ ...QUESTION, status: 'answered' }] }),
      'POST /api/issues/i1/interactions/card-i1/respond': () => {
        pending = false;
        return { body: { ...QUESTION, status: 'answered' } };
      },
      'GET /api/companies/c1/agents': { body: AGENTS },
      'GET /api/companies/c1/projects': { body: PROJECTS },
      'GET /api/companies/c1/issues': { body: [] },
      'GET /api/companies/c1/user-directory': { body: DIRECTORY },
      [`GET ${QC_LIST}`]: { body: { items: [] } },
      [`GET ${AWAITING}`]: () => ({ body: { items: pending ? [card('i1')] : [] } }),
    } as Parameters<typeof mockServer>[0]);
    mount(<IssuePage />);
    const props = await screen.findByTestId('properties-panel');
    await waitFor(() => expect(within(props).getByText('Chờ owner trả lời')).toBeTruthy());
    expect(within(props).queryByText('Đang làm')).toBeNull();
    expect(document.querySelector('[data-slot="status-glyph"][data-status="awaiting_owner"]')).not.toBeNull();

    const before = calls.filter((c) => c.url === AWAITING).length;
    const cardEl = await screen.findByTestId('interaction-card');
    fireEvent.click(within(cardEl).getByRole('button', { name: 'Postgres' }));
    fireEvent.click(within(cardEl).getByRole('button', { name: 'Gửi trả lời' }));
    await waitFor(() => expect(calls.filter((c) => c.url === AWAITING).length).toBeGreaterThan(before));
    await waitFor(() => expect(within(props).queryByText('Chờ owner trả lời')).toBeNull());
    expect(document.querySelector('[data-slot="status-glyph"][data-status="awaiting_owner"]')).toBeNull();
  });
});

// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CompanyContext } from '@/app/hooks';
import { ContributionsPage } from '@/features/contributions/contributions-page';
import { IssuesPage } from '@/features/issues/list/issues-page';
import { initI18n, setLanguage } from '@/i18n';
import { accessRoute, mockServer } from '../../app/fetch-mock';
import { contribution } from '../contributions/fixtures';
import { DIRECTORY, MARKETING_ACCESS, OWNER_ACCESS, QC_ACCESS, QC_LIST, qcState } from './fixtures';

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
const issue = (id: string, status: string) => ({
  id,
  identifier: `TPS-${id}`,
  title: `Yêu cầu ${id}`,
  status,
  parentId: null,
  projectId: 'p1',
  assigneeAgentId: 'a1',
  updatedAt: '2026-10-21T01:00:00.000Z',
  createdAt: '2026-10-20T01:00:00.000Z',
  labels: [],
});
const ISSUES = [issue('1', 'done'), issue('2', 'done'), issue('3', 'done'), issue('4', 'done')];
const STATES = [
  qcState({ issueId: '1', identifier: 'TPS-1', title: 'Yêu cầu 1' }),
  qcState({
    issueId: '2',
    identifier: 'TPS-2',
    title: 'Yêu cầu 2',
    state: 'verified',
    verifiedAt: '2026-10-21T02:00:00.000Z',
  }),
  qcState({ issueId: '3', identifier: 'TPS-3', title: 'Yêu cầu 3', reopenRequest: { id: 'k9', status: 'pending' } }),
];

function render$(path: string, element: ReactElement, route: string) {
  const router = createMemoryRouter(
    [
      {
        path: route,
        element: (
          <CompanyContext.Provider value={{ company: COMPANY, companies: [COMPANY] }}>
            {element}
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

function issuesServer() {
  return mockServer({
    'GET /api/companies/c1/issues': { body: ISSUES },
    'POST /api/plugins/crew.core/data/crew.roots': { body: { data: [] } },
    'GET /api/companies/c1/projects': { body: [{ id: 'p1', name: 'Alpha', archivedAt: null }] },
    'GET /api/companies/c1/agents': { body: [{ id: 'a1', name: 'Trợ Lý Alpha' }] },
    [`GET ${QC_LIST}`]: { body: { items: STATES } },
  } as Parameters<typeof mockServer>[0]);
}

const qcOf = (root: HTMLElement) => within(root).queryByTestId('qc-badge')?.getAttribute('data-qc') ?? null;

describe('trạng thái QC ở danh sách và bảng Yêu cầu', () => {
  it('danh sách: biểu tượng và nhãn trạng thái theo QC, kèm nhãn QC; yêu cầu thường giữ Hoàn thành', async () => {
    issuesServer();
    render$('/TPS/issues', <IssuesPage />, '/:companyPrefix/issues');
    await waitFor(() => expect(screen.getAllByTestId('qc-badge').length).toBe(3));
    const rows = new Map(screen.getAllByTestId('issue-row').map((r) => [r.getAttribute('data-issue-id'), r]));
    const row = (id: string) => rows.get(id) as HTMLElement;
    expect(qcOf(row('1'))).toBe('qc_awaiting');
    expect(qcOf(row('2'))).toBe('qc_verified');
    expect(qcOf(row('3'))).toBe('qc_reopen');
    expect(qcOf(row('4'))).toBeNull();
    const glyph = (id: string) => row(id).querySelector('[data-slot="status-glyph"]')?.getAttribute('data-status');
    expect([glyph('1'), glyph('2'), glyph('3'), glyph('4')]).toEqual([
      'qc_awaiting',
      'qc_verified',
      'qc_reopen',
      'done',
    ]);
  });

  it('bảng: thẻ vẫn ở cột Hoàn thành (trạng thái lõi), mang nhãn QC', async () => {
    issuesServer();
    render$('/TPS/issues?view=board', <IssuesPage />, '/:companyPrefix/issues');
    await waitFor(() => expect(screen.getAllByTestId('qc-badge').length).toBe(3));
    const done = screen
      .getAllByTestId('kanban-column')
      .find((c) => c.getAttribute('data-status') === 'done') as HTMLElement;
    const cards = within(done).getAllByTestId('kanban-card');
    expect(cards.map((c) => c.getAttribute('data-issue-id')).sort()).toEqual(['1', '2', '3', '4']);
    const byId = new Map(cards.map((c) => [c.getAttribute('data-issue-id'), c]));
    const card = (id: string) => byId.get(id) as HTMLElement;
    expect([qcOf(card('1')), qcOf(card('2')), qcOf(card('3')), qcOf(card('4'))]).toEqual([
      'qc_awaiting',
      'qc_verified',
      'qc_reopen',
      null,
    ]);
    expect(within(card('1')).getByText('Chờ QC duyệt')).toBeTruthy();
  });
});

const LIST = '/api/crew/companies/c1/contributions';
function contributionsServer(access: Record<string, unknown>, pending: ReturnType<typeof contribution>[] = []) {
  return mockServer({
    ...accessRoute('c1', access),
    [`GET ${LIST}?status=pending`]: { body: { items: pending, nextBefore: null } },
    [`GET ${LIST}?status=rejected`]: { body: { items: [], nextBefore: null } },
    [`GET ${LIST}?status=approved`]: { body: { items: [], nextBefore: null } },
    [`GET ${LIST}/summary`]: { body: { pending: pending.length } },
    'GET /api/companies/c1/projects': { body: [{ id: 'p1', name: 'Alpha', archivedAt: null }] },
    'GET /api/companies/c1/user-directory': { body: DIRECTORY },
    [`GET ${QC_LIST}`]: {
      body: {
        items: [...STATES, qcState({ issueId: '5', identifier: 'TPS-5', title: 'Của người khác', qcUserId: 'u-x' })],
      },
    },
  } as Parameters<typeof mockServer>[0]);
}

describe('Cần tôi duyệt và hàng chờ của owner', () => {
  it('thành viên Phòng QC thấy yêu cầu của mình đang chờ duyệt (kể cả mục đang chờ owner mở lại)', async () => {
    contributionsServer(QC_ACCESS);
    render$('/TPS/contributions', <ContributionsPage />, '/:companyPrefix/contributions');
    const list = await screen.findByTestId('qc-review-list');
    await waitFor(() => expect(within(list).getAllByTestId('qc-review-item')).toHaveLength(2));
    expect(within(list).getByRole('link', { name: 'TPS-1 · Yêu cầu 1' })).toBeTruthy();
    expect(within(list).getByText('Đã báo chưa đạt, chờ owner')).toBeTruthy();
    expect(within(list).queryByText(/Của người khác/)).toBeNull();
    expect(within(list).queryByText(/Yêu cầu 2/)).toBeNull();
  });

  it('Phòng Marketing và owner không có mục Cần tôi duyệt', async () => {
    for (const access of [MARKETING_ACCESS, OWNER_ACCESS]) {
      contributionsServer(access);
      render$('/TPS/contributions', <ContributionsPage />, '/:companyPrefix/contributions');
      await screen.findByRole('heading', { level: 1 });
      await waitFor(() => expect(screen.queryByTestId('qc-review-list')).toBeNull());
      cleanup();
    }
  });

  it('owner thấy "QC yêu cầu mở lại" kèm lý do trong hàng Chờ duyệt, có Duyệt và Từ chối', async () => {
    const reopen = contribution({
      id: 'k9',
      kind: 'reopen',
      targetIssueId: '3',
      authorUserId: 'u-qc',
      authorDepartment: 'qc',
      body: 'Nút lưu không chạy trên Safari',
    });
    contributionsServer(OWNER_ACCESS, [reopen]);
    render$('/TPS/contributions', <ContributionsPage />, '/:companyPrefix/contributions');
    const row = await screen.findByTestId('contribution-row');
    expect(within(row).getByText('QC yêu cầu mở lại')).toBeTruthy();
    expect(within(row).getByText('Nút lưu không chạy trên Safari')).toBeTruthy();
    expect(await within(row).findByText(/Hà QC · Phòng QC/)).toBeTruthy();
    expect(within(row).getByRole('link', { name: 'Mở yêu cầu' })).toBeTruthy();
    expect(within(row).getByRole('button', { name: /^Duyệt/ })).toBeTruthy();
    expect(within(row).getByRole('button', { name: /^Từ chối/ })).toBeTruthy();
  });
});

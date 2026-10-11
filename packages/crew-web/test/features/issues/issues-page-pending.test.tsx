// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CompanyContext } from '@/app/hooks';
import { IssuesPage } from '@/features/issues/list/issues-page';
import { initI18n, setLanguage } from '@/i18n';
import { accessRoute, mockServer } from '../../app/fetch-mock';
import { contribution, DIRECTORY, GUEST_ACCESS } from '../contributions/fixtures';

vi.mock('@/features/readiness', () => ({
  useProjectReadiness: () => ({ isLoading: false, data: [] }),
}));

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
afterEach(cleanup);

const COMPANY = { id: 'c1', name: '2P', issuePrefix: 'TPS' };
const ISSUES = [
  {
    id: '1',
    identifier: 'TPS-1',
    title: 'Yêu cầu thật',
    status: 'todo',
    parentId: null,
    projectId: 'p1',
    assigneeAgentId: 'a1',
    updatedAt: '2026-10-10T01:00:00.000Z',
    createdAt: '2026-10-09T01:00:00.000Z',
    labels: [],
  },
];
const PENDING = [
  contribution({ id: 'k1', kind: 'issue', projectId: 'p1', targetIssueId: null, title: 'Cần banner', body: null }),
  contribution({
    id: 'k2',
    kind: 'issue',
    projectId: 'p1',
    targetIssueId: null,
    title: 'Sửa slogan',
    status: 'approving',
  }),
];

function server(access?: Record<string, unknown>, items = PENDING) {
  return mockServer({
    ...(access ? accessRoute('c1', access) : {}),
    'GET /api/companies/c1/issues': { body: ISSUES },
    'POST /api/plugins/crew.core/data/crew.roots': { body: { data: [] } },
    'GET /api/companies/c1/projects': { body: [{ id: 'p1', name: 'Alpha', archivedAt: null }] },
    'GET /api/companies/c1/agents': { body: [{ id: 'a1', name: 'Trợ Lý Alpha' }] },
    'GET /api/companies/c1/user-directory': { body: DIRECTORY },
    'GET /api/crew/companies/c1/contributions': { body: { items } },
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
}

const loc = () => screen.getByTestId('loc').textContent;

describe('nhóm Chờ duyệt ở danh sách yêu cầu (S20.3)', () => {
  it('owner: nhóm đầu trang với badge, tác giả, project và nút Duyệt/Từ chối; mục đứt giữa chừng có Duyệt lại', async () => {
    const { calls } = server();
    mount();
    const rows = await screen.findAllByTestId('pending-issue');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('Cần banner')).toBeTruthy();
    expect(within(rows[0]).getByText('Chờ duyệt')).toBeTruthy();
    expect(await within(rows[0]).findByText(/Lan Marketing/)).toBeTruthy();
    expect(within(rows[0]).getByText(/Alpha/)).toBeTruthy();
    expect(within(rows[0]).getByRole('button', { name: /^Duyệt: / })).toBeTruthy();
    expect(within(rows[0]).getByRole('button', { name: /^Từ chối: / })).toBeTruthy();
    expect(within(rows[1]).getByText('Đang duyệt dở')).toBeTruthy();
    expect(within(rows[1]).getByRole('button', { name: /^Duyệt lại: / })).toBeTruthy();
    expect(calls.some((c) => c.url.includes('/contributions?status=pending&kind=issue'))).toBe(true);
    // Yêu cầu thật vẫn có trong bảng.
    expect(screen.getByText('Yêu cầu thật')).toBeTruthy();
  });

  it('chip Chờ duyệt (n) bật thì chỉ hiện nhóm này, tắt thì bảng trở lại', async () => {
    server();
    mount();
    const chip = await screen.findByRole('button', { name: 'Chờ duyệt (2)' });
    fireEvent.click(chip);
    await waitFor(() => expect(loc()).toContain('pending=1'));
    expect(screen.queryByText('Yêu cầu thật')).toBeNull();
    expect(screen.getAllByTestId('pending-issue')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Chờ duyệt (2)' }));
    expect(await screen.findByText('Yêu cầu thật')).toBeTruthy();
  });

  it('bấm tiêu đề mở popup mục góp ý trên trang đang xem', async () => {
    server();
    mount();
    fireEvent.click(await screen.findByRole('link', { name: 'Cần banner' }));
    await waitFor(() => expect(loc()).toBe('/TPS/issues?contribution=k1'));
  });

  it('Duyệt yêu cầu mở dialog chọn agent nhận việc', async () => {
    server();
    mount();
    const [first] = await screen.findAllByTestId('pending-issue');
    fireEvent.click(within(first).getByRole('button', { name: /^Duyệt: / }));
    expect(await screen.findByRole('dialog', { name: 'Duyệt yêu cầu' })).toBeTruthy();
  });

  it('khách thấy mục của mình, không có nút', async () => {
    server(GUEST_ACCESS, [PENDING[0]]);
    mount();
    expect(await screen.findByTestId('pending-issue')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Duyệt: / })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Từ chối: / })).toBeNull();
  });

  it('không có mục chờ thì không có nhóm và chip; operator không gọi route góp ý', async () => {
    const { calls } = server({ userId: 'u3', membershipRole: 'operator', contributor: false, canApprove: false });
    mount();
    await screen.findByText('Yêu cầu thật');
    expect(screen.queryByTestId('pending-issue')).toBeNull();
    expect(screen.queryByTestId('pending-chip')).toBeNull();
    expect(calls.some((c) => c.url.includes('/contributions'))).toBe(false);
  });

  it('nút Yêu cầu mới: viewer thuần không có; khách góp ý và operator có', async () => {
    const cases: [Record<string, unknown>, boolean][] = [
      [{ userId: 'u3', membershipRole: 'viewer', contributor: false, canApprove: false }, false],
      [GUEST_ACCESS, true],
      [{ userId: 'u3', membershipRole: 'operator', contributor: false, canApprove: false }, true],
    ];
    for (const [access, visible] of cases) {
      const { calls } = server(access, []);
      mount();
      await screen.findByText('Yêu cầu thật');
      await waitFor(() => expect(calls.some((c) => c.url.endsWith('/access'))).toBe(true));
      if (visible) expect(await screen.findByRole('button', { name: 'Yêu cầu mới' })).toBeTruthy();
      else expect(screen.queryByRole('button', { name: 'Yêu cầu mới' })).toBeNull();
      cleanup();
    }
  });
});

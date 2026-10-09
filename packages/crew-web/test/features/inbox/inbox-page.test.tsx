// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CompanyContext, MeContext } from '@/app/hooks';
import { routes } from '@/features/inbox/routes';
import { initI18n, setLanguage } from '@/i18n';
import { mockServer } from '../../app/fetch-mock';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
  await import('@/features/inbox/inbox-page');
});
afterEach(cleanup);

const COMPANY = { id: 'c1', name: '2P', issuePrefix: 'TPS' };
const ME = { id: 'u1', name: 'Owner', email: 'owner@example.com', image: null };

// Nguồn: GET /api/companies/:c/issues?inboxArchivedByUserId=me (Issue + executionState, reviewAttention, isUnreadForMe).
const base = {
  companyId: 'c1',
  updatedAt: '2026-10-10T01:00:00.000Z',
  createdAt: '2026-10-09T01:00:00.000Z',
};
const AWAITING = {
  ...base,
  id: 'i1',
  identifier: 'TPS-1',
  title: 'Chờ owner duyệt',
  status: 'in_review',
  isUnreadForMe: true,
  // Danh sách thật trả executionState null; người duyệt stage đang chờ chỉ có ở reviewAttention.
  executionState: null,
  reviewAttention: {
    state: 'covered',
    reason: null,
    paths: [
      {
        kind: 'execution_participant',
        label: 'Execution review participant',
        responder: 'Owner',
        since: null,
        ref: 'u1',
      },
    ],
  },
};
const QUESTION = {
  ...base,
  id: 'i2',
  identifier: 'TPS-2',
  title: 'Trợ Lý hỏi owner',
  status: 'in_review',
  isUnreadForMe: false,
  reviewAttention: {
    state: 'covered',
    reason: null,
    paths: [{ kind: 'interaction', label: 'Pending ask user questions', responder: 'Board', since: null, ref: 'q' }],
  },
};
const PLAIN = {
  ...base,
  id: 'i3',
  identifier: 'TPS-3',
  title: 'Việc thường',
  status: 'in_progress',
  isUnreadForMe: true,
};
const BLOCKED = {
  ...base,
  id: 'i4',
  identifier: 'TPS-4',
  title: 'Việc bị chặn',
  status: 'blocked',
  isUnreadForMe: false,
};
const LIST = [AWAITING, QUESTION, PLAIN, BLOCKED];

function server(extra: Record<string, never | object> = {}) {
  return mockServer({ 'GET /api/companies/c1/issues': { body: LIST }, ...extra });
}

function mount(at = '/TPS/inbox') {
  const router = createMemoryRouter(
    [
      { path: '/:companyPrefix', children: routes },
      { path: '/:companyPrefix/*', element: <div>đích khác</div> },
    ],
    { initialEntries: [at] },
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CompanyContext.Provider value={{ company: COMPANY, companies: [COMPANY] }}>
        <MeContext.Provider value={ME}>
          <RouterProvider router={router} />
        </MeContext.Provider>
      </CompanyContext.Provider>
    </QueryClientProvider>,
  );
  return { router, client };
}

const rowTitles = () => screen.queryAllByTestId('inbox-row').map((r) => r.textContent ?? '');

describe('InboxPage tab (S3.1, S3.2)', () => {
  it('mở thẳng tab Chờ tôi duyệt: issue ở stage owner và issue có thẻ câu hỏi', async () => {
    const s = server();
    mount();
    await screen.findByText('Chờ owner duyệt');
    expect(rowTitles()).toHaveLength(2);
    expect(screen.getByText('Trợ Lý hỏi owner')).toBeTruthy();
    expect(screen.queryByText('Việc thường')).toBeNull();
    expect(screen.getByText('Chờ bạn duyệt')).toBeTruthy();
    expect(screen.getByText('Có câu hỏi chờ trả lời')).toBeTruthy();
    expect(s.calls[0].url).toContain('inboxArchivedByUserId=me');
  });

  it('chuyển tab Chưa đọc, Đang kẹt, Tất cả; số đếm trên nhãn tab', async () => {
    server();
    mount();
    await screen.findByText('Chờ owner duyệt');
    expect(screen.getByRole('button', { name: 'Chờ tôi duyệt (2)' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Chưa đọc (2)' }));
    expect(rowTitles().map((t) => t.includes('Việc thường') || t.includes('Chờ owner duyệt'))).toEqual([true, true]);
    fireEvent.click(screen.getByRole('button', { name: 'Đang kẹt (1)' }));
    expect(screen.getByText('Việc bị chặn')).toBeTruthy();
    expect(rowTitles()).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Tất cả (4)' }));
    expect(rowTitles()).toHaveLength(4);
  });

  it('duyệt xong thì biến khỏi tab (reviewAttention đổi sau khi tải lại)', async () => {
    let calls = 0;
    mockServer({
      'GET /api/companies/c1/issues': () => ({
        body: calls++ === 0 ? LIST : [{ ...AWAITING, reviewAttention: null, status: 'done' }, QUESTION],
      }),
    });
    const { client } = mount();
    await screen.findByText('Chờ owner duyệt');
    await client.invalidateQueries({ queryKey: ['issues', 'c1'] });
    await waitFor(() => expect(screen.queryByText('Chờ owner duyệt')).toBeNull());
    expect(screen.getByText('Trợ Lý hỏi owner')).toBeTruthy();
  });

  it('tab rỗng hiện câu riêng của tab', async () => {
    mockServer({ 'GET /api/companies/c1/issues': { body: [PLAIN] } });
    mount();
    expect(await screen.findByText('Không có gì chờ bạn duyệt')).toBeTruthy();
  });

  it('lỗi tải hiện nguyên văn', async () => {
    mockServer({ 'GET /api/companies/c1/issues': { status: 500, body: { error: 'truy vấn hỏng' } } });
    mount();
    expect(await screen.findByText(/truy vấn hỏng/)).toBeTruthy();
  });
});

describe('InboxPage tìm, lọc, nhóm (S3.5)', () => {
  it('tìm theo mã hoặc tiêu đề, lọc trạng thái', async () => {
    server();
    mount('/TPS/inbox?tab=all');
    await screen.findByText('Việc thường');
    fireEvent.change(screen.getByPlaceholderText('Tìm theo mã hoặc tiêu đề'), { target: { value: 'tps-4' } });
    expect(rowTitles()).toHaveLength(1);
    expect(screen.getByText('Việc bị chặn')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('Tìm theo mã hoặc tiêu đề'), { target: { value: 'không có' } });
    expect(screen.getByText('Không có mục khớp bộ lọc')).toBeTruthy();
  });
});

describe('InboxPage đọc và lưu trữ (S3.3, S3.4)', () => {
  it('đánh dấu đã đọc gọi POST /issues/:id/read rồi làm mới danh sách và badge sidebar', async () => {
    const s = server({ 'POST /api/issues/i1/read': { body: { id: 'i1', lastReadAt: 'x' } } });
    const { client } = mount();
    await screen.findByText('Chờ owner duyệt');
    const invalidated: unknown[] = [];
    const orig = client.invalidateQueries.bind(client);
    client.invalidateQueries = ((filters: { queryKey?: unknown }) => {
      invalidated.push(filters?.queryKey);
      return orig(filters as never);
    }) as typeof client.invalidateQueries;
    const row = screen
      .getAllByTestId('inbox-row')
      .find((r) => r.textContent?.includes('Chờ owner duyệt')) as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Đánh dấu đã đọc' }));
    await waitFor(() => expect(s.calls.some((c) => c.method === 'POST' && c.url === '/api/issues/i1/read')).toBe(true));
    await waitFor(() => expect(invalidated).toContainEqual(['sidebar-badges', 'c1']));
    expect(invalidated).toContainEqual(['issues', 'c1']);
  });

  it('đánh dấu chưa đọc gọi DELETE /issues/:id/read', async () => {
    const s = server({ 'DELETE /api/issues/i2/read': { body: { id: 'i2', removed: true } } });
    mount();
    await screen.findByText('Trợ Lý hỏi owner');
    const row = screen
      .getAllByTestId('inbox-row')
      .find((r) => r.textContent?.includes('Trợ Lý hỏi owner')) as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Đánh dấu chưa đọc' }));
    await waitFor(() =>
      expect(s.calls.some((c) => c.method === 'DELETE' && c.url === '/api/issues/i2/read')).toBe(true),
    );
  });

  it('tất cả đã đọc gọi read cho từng mục chưa đọc trong tab đang xem', async () => {
    const s = server({
      'POST /api/issues/i1/read': { body: {} },
      'POST /api/issues/i3/read': { body: {} },
    });
    mount('/TPS/inbox?tab=unread');
    await screen.findByText('Việc thường');
    fireEvent.click(screen.getByRole('button', { name: 'Đánh dấu tất cả đã đọc' }));
    await waitFor(() => expect(s.calls.filter((c) => c.method === 'POST')).toHaveLength(2));
    expect(
      s.calls
        .filter((c) => c.method === 'POST')
        .map((c) => c.url)
        .sort(),
    ).toEqual(['/api/issues/i1/read', '/api/issues/i3/read']);
  });

  it('lưu trữ gọi POST /issues/:id/inbox-archive, có Bỏ lưu trữ gọi DELETE', async () => {
    const s = server({
      'POST /api/issues/i1/inbox-archive': { body: { id: 'i1', archivedAt: 'x' } },
      'DELETE /api/issues/i1/inbox-archive': { body: {} },
    });
    mount();
    await screen.findByText('Chờ owner duyệt');
    const row = screen
      .getAllByTestId('inbox-row')
      .find((r) => r.textContent?.includes('Chờ owner duyệt')) as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Lưu trữ' }));
    expect(await screen.findByText('Đã lưu trữ TPS-1.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ lưu trữ' }));
    await waitFor(() =>
      expect(s.calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/inbox-archive'))).toBe(true),
    );
    await waitFor(() => expect(screen.queryByText('Đã lưu trữ TPS-1.')).toBeNull());
  });

  it('lỗi server khi đánh dấu hiện nguyên văn', async () => {
    server({ 'POST /api/issues/i1/read': { status: 403, body: { error: 'agent không được đánh dấu' } } });
    mount();
    await screen.findByText('Chờ owner duyệt');
    const row = screen
      .getAllByTestId('inbox-row')
      .find((r) => r.textContent?.includes('Chờ owner duyệt')) as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Đánh dấu đã đọc' }));
    expect(await screen.findByText(/agent không được đánh dấu/)).toBeTruthy();
  });

  it('bấm dòng mở issue theo mã', async () => {
    server();
    const { router } = mount();
    fireEvent.click(await screen.findByRole('link', { name: /Chờ owner duyệt/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/TPS/issues/TPS-1'));
  });
});

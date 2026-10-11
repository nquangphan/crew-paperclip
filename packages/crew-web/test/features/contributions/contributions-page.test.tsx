// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CompanyContext } from '@/app/hooks';
import { ContributionsPage } from '@/features/contributions/contributions-page';
import { initI18n, setLanguage } from '@/i18n';
import { accessRoute, mockServer } from '../../app/fetch-mock';
import { contribution, DIRECTORY, GUEST_ACCESS } from './fixtures';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
});
afterEach(cleanup);

const COMPANY = { id: 'c1', name: '2P', issuePrefix: 'TPS' };
const mount = () =>
  render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <CompanyContext.Provider value={{ company: COMPANY, companies: [COMPANY] }}>
          <ContributionsPage />
        </CompanyContext.Provider>
      </QueryClientProvider>
    </MemoryRouter>,
  );

const ITEMS = [
  contribution({
    id: 'k1',
    kind: 'issue',
    projectId: 'p1',
    title: 'Cần banner',
    body: 'Chi tiết',
    targetIssueId: null,
  }),
  contribution({ id: 'k2', status: 'approving', body: 'Đang duyệt dở' }),
  contribution({ id: 'k3', status: 'rejected', body: 'Bị loại' }),
  contribution({ id: 'k4', status: 'approved', body: 'Đã đăng', resultCommentId: 'cm9' }),
];

const LIST = '/api/crew/companies/c1/contributions';
const byStatus = (items: typeof ITEMS, pending = 2) => ({
  [`GET ${LIST}?status=pending`]: {
    body: { items: items.filter((c) => c.status === 'pending' || c.status === 'approving'), nextBefore: null },
  },
  [`GET ${LIST}?status=rejected`]: { body: { items: items.filter((c) => c.status === 'rejected'), nextBefore: null } },
  [`GET ${LIST}?status=approved`]: { body: { items: items.filter((c) => c.status === 'approved'), nextBefore: null } },
  [`GET ${LIST}/summary`]: { body: { pending } },
});

const base = {
  ...byStatus(ITEMS),
  'GET /api/companies/c1/projects': { body: [{ id: 'p1', name: 'Alpha', archivedAt: null }] },
  'GET /api/companies/c1/user-directory': { body: DIRECTORY },
};

describe('trang Góp ý của tôi', () => {
  it('chia ba tab theo trạng thái, đang duyệt dở tính là chờ', async () => {
    mockServer({ ...accessRoute('c1', GUEST_ACCESS), ...base });
    mount();
    expect(await screen.findByRole('heading', { name: 'Góp ý của tôi' })).toBeTruthy();
    expect(await screen.findByRole('tab', { name: 'Chờ duyệt (2)' })).toBeTruthy();
    expect(await screen.findByRole('tab', { name: 'Bị từ chối (1)' })).toBeTruthy();
    expect(await screen.findByRole('tab', { name: 'Đã duyệt (1)' })).toBeTruthy();
    expect(await screen.findByText('Cần banner')).toBeTruthy();
    expect(screen.getByText('Đang duyệt dở')).toBeTruthy();
    expect(screen.queryByText('Bị loại')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Duyệt/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Từ chối/ })).toBeNull();

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Bị từ chối (1)' }));
    expect(await screen.findByText('Bị loại')).toBeTruthy();
    expect(screen.getAllByText('Bị từ chối').length).toBeGreaterThan(0);

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Đã duyệt (1)' }));
    const link = await screen.findByRole('link', { name: 'Xem bình luận đã đăng' });
    expect(link.getAttribute('href')).toBe('/TPS/issues/i1#comment-cm9');
  });

  it('mỗi tab đọc riêng theo status; số tab Chờ duyệt lấy từ summary như badge sidebar', async () => {
    const { calls } = mockServer({ ...base, ...byStatus(ITEMS, 250) });
    mount();
    expect(await screen.findByRole('tab', { name: 'Chờ duyệt (250)' })).toBeTruthy();
    const lists = calls.filter((c) => c.url.startsWith(`${LIST}?`)).map((c) => c.url);
    expect(new Set(lists)).toEqual(
      new Set([`${LIST}?status=pending`, `${LIST}?status=rejected`, `${LIST}?status=approved`]),
    );
    expect(calls.some((c) => c.url === LIST)).toBe(false);
  });

  it('mục chờ cũ nằm ở trang sau: nút Tải thêm đọc tiếp bằng before', async () => {
    const OLD = contribution({ id: 'k-old', body: 'Bình luận chờ từ trước kỳ nghỉ' });
    const { calls } = mockServer({
      ...base,
      [`GET ${LIST}?status=pending`]: { body: { items: [ITEMS[0], ITEMS[1]], nextBefore: 'k2' } },
      [`GET ${LIST}?status=pending&before=k2`]: { body: { items: [OLD], nextBefore: null } },
      [`GET ${LIST}?status=rejected`]: { body: { items: [ITEMS[2]], nextBefore: 'k3' } },
      [`GET ${LIST}/summary`]: { body: { pending: 3 } },
    });
    mount();
    expect(await screen.findByRole('tab', { name: 'Chờ duyệt (3)' })).toBeTruthy();
    // Trang sau còn nữa thì số tab ghi "+".
    expect(await screen.findByRole('tab', { name: 'Bị từ chối (1+)' })).toBeTruthy();
    expect(screen.queryByText('Bình luận chờ từ trước kỳ nghỉ')).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Tải thêm' }));
    expect(await screen.findByText('Bình luận chờ từ trước kỳ nghỉ')).toBeTruthy();
    expect(calls.some((c) => c.url === `${LIST}?status=pending&before=k2`)).toBe(true);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Tải thêm' })).toBeNull());
  });

  it('owner thấy tên tác giả', async () => {
    mockServer(base);
    mount();
    expect(await screen.findByRole('heading', { name: 'Chờ duyệt' })).toBeTruthy();
    expect((await screen.findAllByText(/Lan Marketing/)).length).toBeGreaterThan(0);
  });

  it('báo lỗi khi không tải được', async () => {
    mockServer({
      ...accessRoute('c1', GUEST_ACCESS),
      ...base,
      [`GET ${LIST}?status=pending`]: { status: 500, body: { error: 'hỏng' } },
    });
    mount();
    expect(await screen.findByText('Không tải được danh sách góp ý')).toBeTruthy();
  });
});

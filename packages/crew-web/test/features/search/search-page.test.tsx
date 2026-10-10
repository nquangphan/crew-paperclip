// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CompanyContext } from '@/app/hooks';
import { routes } from '@/features/search/routes';
import { initI18n, setLanguage } from '@/i18n';
import { mockServer } from '../../app/fetch-mock';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
  // nạp sẵn trang lazy để ca đầu không chờ biên dịch
  await import('@/features/search/search-page');
});
afterEach(cleanup);

const COMPANY = { id: 'c1', name: '2P', issuePrefix: 'TPS' };

// Nguồn: GET /api/companies/:c/search (CompanySearchResponse, server/src/services/company-search.ts: href là
// /<PREFIX>/issues/<mã>[#neo]; bình luận và tài liệu trả về dưới dạng kết quả issue có snippets).
const issueResult = (over: Record<string, unknown>) => ({
  type: 'issue',
  score: 1,
  matchedFields: [],
  sourceLabel: null,
  snippet: null,
  snippets: [],
  updatedAt: '2026-10-10T01:00:00.000Z',
  previewImageUrl: null,
  ...over,
});
const RESPONSE = {
  query: 'đăng nhập',
  normalizedQuery: 'đăng nhập',
  scope: 'all',
  sort: 'relevance',
  limit: 30,
  offset: 0,
  hasMore: false,
  zeroResults: null,
  countsByType: {},
  filterOptionCounts: {},
  results: [
    issueResult({
      id: 'i2',
      title: 'TPS-2 Sửa trang đăng nhập',
      href: '/TPS/issues/TPS-2',
      issue: { id: 'i2', identifier: 'TPS-2', title: 'Sửa trang đăng nhập', status: 'in_progress' },
    }),
    issueResult({
      id: 'i3:c1',
      title: 'TPS-3 Làm form',
      href: '/TPS/issues/TPS-3#comment-c1',
      snippets: [{ field: 'comment', label: 'Bình luận', text: 'cần sửa đăng nhập', highlights: [] }],
      issue: { id: 'i3', identifier: 'TPS-3', title: 'Làm form', status: 'todo' },
    }),
    issueResult({
      id: 'i4:plan',
      title: 'TPS-4 Kế hoạch',
      href: 'https://evil.example/x',
      snippets: [{ field: 'document', label: 'Tài liệu plan', text: 'đăng nhập bằng email', highlights: [] }],
      issue: { id: 'i4', identifier: 'TPS-4', title: 'Kế hoạch', status: 'done' },
    }),
  ],
};

function mount(at: string) {
  const router = createMemoryRouter(
    [
      { path: '/:companyPrefix', children: routes },
      { path: '/:companyPrefix/*', element: <div>đích khác</div> },
    ],
    { initialEntries: [at] },
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CompanyContext.Provider value={{ company: COMPANY, companies: [COMPANY] }}>
        <RouterProvider router={router} />
      </CompanyContext.Provider>
    </QueryClientProvider>,
  );
  return router;
}

describe('SearchPage (S19)', () => {
  it('chưa gõ đủ ký tự thì không gọi server', async () => {
    const s = mockServer({});
    mount('/TPS/search');
    expect(await screen.findByText('Gõ ít nhất 2 ký tự để tìm.')).toBeTruthy();
    expect(s.calls).toHaveLength(0);
  });

  it('gọi search với q từ URL và hiện kết quả issue, bình luận, tài liệu', async () => {
    const s = mockServer({ 'GET /api/companies/c1/search': { body: RESPONSE } });
    mount('/TPS/search?q=đăng nhập');
    expect(await screen.findByText('TPS-2 Sửa trang đăng nhập')).toBeTruthy();
    expect(s.calls[0].url).toContain('q=%C4%91%C4%83ng+nh%E1%BA%ADp');
    expect(screen.getByText('Bình luận: cần sửa đăng nhập')).toBeTruthy();
    expect(screen.getByText('Tài liệu plan: đăng nhập bằng email')).toBeTruthy();
    expect(screen.getAllByTestId('search-result')).toHaveLength(3);
  });

  it('bấm kết quả mở popup đúng issue trên trang Tìm kiếm, giữ neo bình luận', async () => {
    mockServer({ 'GET /api/companies/c1/search': { body: RESPONSE } });
    const router = mount('/TPS/search?q=đăng nhập');
    const link = await screen.findByRole('link', { name: 'TPS-3 Làm form' });
    expect(link.getAttribute('href')).toBe('/TPS/issues/TPS-3#comment-c1');
    fireEvent.click(link);
    await waitFor(() => expect(new URLSearchParams(router.state.location.search).get('issue')).toBe('TPS-3'));
    expect(router.state.location.pathname).toBe('/TPS/search');
    expect(new URLSearchParams(router.state.location.search).get('q')).toBe('đăng nhập');
    expect(router.state.location.hash).toBe('#comment-c1');
  });

  it('href ngoài company bị thay bằng link tới issue theo mã', async () => {
    mockServer({ 'GET /api/companies/c1/search': { body: RESPONSE } });
    mount('/TPS/search?q=đăng nhập');
    const link = await screen.findByRole('link', { name: 'TPS-4 Kế hoạch' });
    expect(link.getAttribute('href')).toBe('/TPS/issues/TPS-4');
  });

  it('không có kết quả và lỗi server đều hiển thị', async () => {
    mockServer({ 'GET /api/companies/c1/search': { body: { ...RESPONSE, results: [] } } });
    mount('/TPS/search?q=zzz');
    expect(await screen.findByText('Không có kết quả cho "zzz"')).toBeTruthy();
    cleanup();
    mockServer({ 'GET /api/companies/c1/search': { status: 500, body: { error: 'chỉ mục hỏng' } } });
    mount('/TPS/search?q=abc');
    expect(await screen.findByText(/chỉ mục hỏng/)).toBeTruthy();
  });
});

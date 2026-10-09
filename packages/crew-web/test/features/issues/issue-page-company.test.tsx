// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { CompanyContext, MeContext } from '@/app/hooks';
import { IssuePage } from '@/features/issues/detail/issue-page';
import { initI18n, setLanguage } from '@/i18n';
import { mockServer } from '../../app/fetch-mock';
import { COMPANY, ISSUE, ME } from './detail-fixtures';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
});
afterEach(cleanup);

const OTHER = { id: 'c2', name: 'Crew', issuePrefix: 'CRE' };
const FOREIGN = { ...ISSUE, id: 'i5', companyId: 'c2', identifier: 'CRE-5' };

/** Shell TPS mở /TPS/issues/CRE-5; route /CRE/issues/:ref chỉ ghi lại nơi được chuyển tới. */
function mountAt(companies: (typeof COMPANY)[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [
      {
        path: '/TPS/issues/:ref',
        element: (
          <QueryClientProvider client={qc}>
            <CompanyContext.Provider value={{ company: COMPANY, companies }}>
              <MeContext.Provider value={ME}>
                <IssuePage />
              </MeContext.Provider>
            </CompanyContext.Provider>
          </QueryClientProvider>
        ),
      },
      { path: '/CRE/issues/:ref', element: <p>Đã sang CRE</p> },
    ],
    { initialEntries: ['/TPS/issues/CRE-5'] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

/** Ghi (đánh dấu đã đọc) hoặc hỏi yêu cầu con ở company sai. */
const unsafe = (s: ReturnType<typeof mockServer>) =>
  s.calls.filter((c) => c.method !== 'GET' || c.url.includes('/companies/c1/issues'));

describe('IssuePage khi mã yêu cầu thuộc company khác prefix trên URL', () => {
  it('chuyển sang đúng prefix của company chứa yêu cầu', async () => {
    const s = mockServer({ 'GET /api/issues/CRE-5': { body: FOREIGN } });
    const router = mountAt([COMPANY, OTHER]);
    expect(await screen.findByText('Đã sang CRE')).toBeTruthy();
    expect(router.state.location.pathname).toBe('/CRE/issues/CRE-5');
    expect(unsafe(s)).toHaveLength(0);
  });

  it('company chứa yêu cầu không có trong danh sách thì báo không tìm thấy, không có nút thao tác cổng', async () => {
    const s = mockServer({ 'GET /api/issues/CRE-5': { body: FOREIGN } });
    mountAt([COMPANY]);
    expect(await screen.findByText('Không tìm thấy trang')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Duyệt' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Hủy yêu cầu' })).toBeNull();
    expect(unsafe(s)).toHaveLength(0);
  });
});

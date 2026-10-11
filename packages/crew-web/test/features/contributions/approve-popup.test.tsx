// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CompanyContext, MeContext } from '@/app/hooks';
import {
  ContributionPopupHost,
  closeContributionHref,
  contributionHref,
  popupContributionId,
} from '@/features/contributions/contribution-popup-host';
import { initI18n, setLanguage } from '@/i18n';
import { accessRoute, mockServer } from '../../app/fetch-mock';
import { contribution, DIRECTORY, GUEST_ACCESS } from './fixtures';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
  Element.prototype.scrollIntoView ??= () => {};
});
afterEach(cleanup);

const COMPANY = { id: 'c1', name: '2P', issuePrefix: 'TPS' };
const ME = { id: 'u1', name: 'Owner', email: 'owner@example.com', image: null };
const ITEM = contribution({
  id: 'k1',
  kind: 'issue',
  projectId: 'p1',
  targetIssueId: null,
  title: 'Cần banner',
  body: 'Banner tháng 11',
});

function server(access?: Record<string, unknown>, item = ITEM) {
  return mockServer({
    ...(access ? accessRoute('c1', access) : {}),
    'GET /api/crew/companies/c1/contributions/k1': { body: item },
    'GET /api/companies/c1/projects': { body: [{ id: 'p1', name: 'Alpha', archivedAt: null }] },
    'GET /api/companies/c1/user-directory': { body: DIRECTORY },
  } as Parameters<typeof mockServer>[0]);
}

function Where() {
  const loc = useLocation();
  return <output data-testid="loc">{`${loc.pathname}${loc.search}`}</output>;
}

function mount(path: string) {
  const router = createMemoryRouter(
    [
      {
        path: '/:companyPrefix/*',
        element: (
          <CompanyContext.Provider value={{ company: COMPANY, companies: [COMPANY] }}>
            <MeContext.Provider value={ME}>
              <ContributionPopupHost />
              <Where />
            </MeContext.Provider>
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

describe('hợp đồng URL popup mục góp ý', () => {
  it('mở thì thay popup issue, đóng thì bỏ tham số và giữ tham số khác', () => {
    expect(contributionHref('k1', { pathname: '/TPS/issues', search: '?q=a&issue=TPS-2' })).toBe(
      '/TPS/issues?q=a&contribution=k1',
    );
    expect(closeContributionHref({ pathname: '/TPS/issues', search: '?q=a&contribution=k1' })).toBe('/TPS/issues?q=a');
    expect(popupContributionId('?contribution=k1')).toBe('k1');
    expect(popupContributionId('?q=a')).toBeNull();
  });
});

describe('popup mục góp ý (?contribution=)', () => {
  it('owner thấy tiêu đề, nội dung, người gửi, project, badge và nút Duyệt/Từ chối', async () => {
    server();
    mount('/TPS/issues?contribution=k1');
    const popup = await screen.findByTestId('contribution-popup');
    expect(await within(popup).findByText('Banner tháng 11')).toBeTruthy();
    expect(within(popup).getByRole('heading', { name: 'Cần banner' })).toBeTruthy();
    expect(await within(popup).findByText('Lan Marketing')).toBeTruthy();
    expect(await within(popup).findByText('Alpha')).toBeTruthy();
    expect(within(popup).getByText('Chờ duyệt')).toBeTruthy();
    expect(await within(popup).findByRole('button', { name: 'Duyệt: Cần banner' })).toBeTruthy();
    expect(within(popup).getByRole('button', { name: 'Từ chối: Cần banner' })).toBeTruthy();
  });

  it('admin/operator mở link ?contribution= thì không có popup và không gọi route góp ý (sẽ 403)', async () => {
    const { calls } = server({ userId: 'u3', membershipRole: 'operator', contributor: false, canApprove: false });
    mount('/TPS/issues?contribution=k1');
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/access'))).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByTestId('contribution-popup')).toBeNull();
    expect(calls.some((c) => c.url.includes('/contributions/'))).toBe(false);
  });

  it('khách (tác giả) xem được nhưng không có nút', async () => {
    server(GUEST_ACCESS);
    mount('/TPS/contributions?contribution=k1');
    const popup = await screen.findByTestId('contribution-popup');
    expect(await within(popup).findByText('Banner tháng 11')).toBeTruthy();
    expect(within(popup).queryByRole('button', { name: /^Duyệt/ })).toBeNull();
  });

  it('mục đã duyệt có link sang yêu cầu đã tạo (thay popup bằng popup issue)', async () => {
    server(undefined, { ...ITEM, status: 'approved', resultIssueId: 'i-new' });
    mount('/TPS/issues?contribution=k1');
    fireEvent.click(await screen.findByRole('link', { name: 'Mở yêu cầu đã tạo' }));
    await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/TPS/issues?issue=i-new'));
  });

  it('nút Đóng bỏ tham số contribution', async () => {
    server();
    mount('/TPS/issues?q=x&contribution=k1');
    fireEvent.click(await screen.findByRole('button', { name: 'Đóng' }));
    await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/TPS/issues?q=x'));
    expect(screen.queryByTestId('contribution-popup')).toBeNull();
  });
});

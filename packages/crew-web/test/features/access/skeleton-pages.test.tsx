// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CompanyContext } from '@/app/hooks';
import { ContributionsPage } from '@/features/contributions/contributions-page';
import { MembersPage } from '@/features/members/members-page';
import { initI18n, setLanguage } from '@/i18n';
import { accessRoute, mockServer } from '../../app/fetch-mock';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
});
afterEach(cleanup);

const COMPANY = { id: 'c1', name: '2P', issuePrefix: 'TPS' };
const mount = (element: React.ReactElement) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CompanyContext.Provider value={{ company: COMPANY, companies: [COMPANY] }}>{element}</CompanyContext.Provider>
    </QueryClientProvider>,
  );

describe('trang Góp ý', () => {
  it('owner thấy trang Chờ duyệt với trạng thái trống', async () => {
    mockServer({ 'GET /api/crew/companies/c1/contributions': { body: { items: [] } } });
    mount(<ContributionsPage />);
    expect(await screen.findByRole('heading', { name: 'Chờ duyệt' })).toBeTruthy();
    expect(await screen.findByText('Chưa có góp ý nào')).toBeTruthy();
  });

  it('khách thấy trang Góp ý của tôi', async () => {
    mockServer({
      ...accessRoute('c1', { userId: 'u2', membershipRole: 'viewer', contributor: true, canApprove: false }),
      'GET /api/crew/companies/c1/contributions': { body: { items: [] } },
    });
    mount(<ContributionsPage />);
    expect(await screen.findByRole('heading', { name: 'Góp ý của tôi' })).toBeTruthy();
    expect(await screen.findByText('Bạn chưa gửi góp ý nào')).toBeTruthy();
  });
});

describe('trang Thành viên', () => {
  it('có tiêu đề và trạng thái trống', async () => {
    mockServer({
      'GET /api/companies/c1/members': { body: { members: [] } },
      'GET /api/crew/companies/c1/contributors': { body: { items: [] } },
      'GET /api/companies/c1/invites': { body: { invites: [] } },
      'GET /api/companies/c1/join-requests': { body: [] },
    });
    mount(<MembersPage />);
    expect(await screen.findByRole('heading', { name: 'Thành viên' })).toBeTruthy();
    expect(await screen.findByText('Chưa có thành viên nào để hiện')).toBeTruthy();
  });
});

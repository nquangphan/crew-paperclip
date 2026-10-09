// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildAppRoutes, type FeatureModules } from '@/app/router';
import { initI18n, setLanguage } from '@/i18n';
import { COMPANY_TPS, mockServer, SESSION } from './fetch-mock';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
});
afterEach(cleanup);

const features: FeatureModules = {
  '../features/dashboard/routes.tsx': { routes: [{ path: 'dashboard', element: <p>trang tổng quan</p> }] },
  '../features/issues/routes.tsx': { routes: [{ path: 'issues', element: <p>trang yêu cầu</p> }] },
};

function server(session: unknown = SESSION) {
  return mockServer({
    'GET /api/auth/get-session': session ? { body: session } : { status: 401, body: {} },
    'GET /api/companies': { body: [COMPANY_TPS] },
    'POST /api/plugins/crew.core/data/crew.companies': { body: { data: [{ id: 'c-tps', name: '2P Solutions' }] } },
    'GET /api/companies/c-tps/sidebar-badges': { body: { inbox: 4, approvals: 0, failedRuns: 0, joinRequests: 0 } },
  });
}

function mount(path: string, featureModules = features) {
  const router = createMemoryRouter(buildAppRoutes({ featureModules }), { initialEntries: [path] });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

describe('router', () => {
  it('route lạ trong company hiện trang 404 có nút về Tổng quan', async () => {
    server();
    const router = mount('/TPS/khong-co-trang');
    expect(await screen.findByText('Không tìm thấy trang')).toBeTruthy();
    const back = screen.getByRole('link', { name: 'Về Tổng quan' });
    expect(back.getAttribute('href')).toBe('/TPS/dashboard');
    fireEvent.click(back);
    await waitFor(() => expect(router.state.location.pathname).toBe('/TPS/dashboard'));
    expect(await screen.findByText('trang tổng quan')).toBeTruthy();
  });

  it('/ chuyển tới tổng quan của company đầu tiên', async () => {
    server();
    const router = mount('/');
    await waitFor(() => expect(router.state.location.pathname).toBe('/TPS/dashboard'));
  });

  it('chưa đăng nhập thì về /login?next= đúng trang', async () => {
    server(null);
    const router = mount('/TPS/issues?status=todo');
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(router.state.location.search).toBe(`?next=${encodeURIComponent('/TPS/issues?status=todo')}`);
  });

  it('sidebar chỉ hiện mục của feature đã có route, badge Hộp thư từ sidebar-badges', async () => {
    server();
    mount('/TPS/dashboard');
    await screen.findByText('trang tổng quan');
    const nav = screen.getByRole('navigation');
    const links = [...nav.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(links).toEqual(['/TPS/issues?new=1', '/TPS/dashboard', '/TPS/issues']);
    expect(screen.queryByRole('link', { name: /Hộp thư/ })).toBeNull();
  });

  it('badge Hộp thư hiện số chưa đọc khi có trang Hộp thư', async () => {
    server();
    mount('/TPS/dashboard', {
      ...features,
      '../features/inbox/routes.tsx': { routes: [{ path: 'inbox', element: <p>hộp thư</p> }] },
    });
    const inbox = await screen.findByRole('link', { name: /Hộp thư/ });
    await waitFor(() => expect(inbox.textContent).toContain('4'));
  });
});

// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildAppRoutes } from '@/app/router';
import { initI18n, setLanguage } from '@/i18n';
import { COMPANY_CREA, COMPANY_TPS, mockServer, SESSION } from './fetch-mock';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
});
afterEach(cleanup);

const dashboardFeature = {
  '../features/dashboard/routes.tsx': { routes: [{ path: 'dashboard', element: <p>trang tổng quan</p> }] },
};

describe('company switcher', () => {
  it('chỉ liệt kê company có trong crew.companies; đổi company sang /<prefix>/dashboard', async () => {
    mockServer({
      'GET /api/auth/get-session': { body: SESSION },
      'GET /api/companies': {
        body: [COMPANY_TPS, COMPANY_CREA, { id: 'c-e2e', name: 'Crew E2E', issuePrefix: 'CE2E' }],
      },
      'POST /api/plugins/crew.core/data/crew.companies': {
        body: {
          data: [
            { id: 'c-tps', name: '2P Solutions' },
            { id: 'c-e2e', name: 'Crew E2E' },
          ],
        },
      },
      'GET /api/companies/c-tps/sidebar-badges': { body: { inbox: 3, approvals: 0, failedRuns: 0, joinRequests: 0 } },
      'GET /api/companies/c-e2e/sidebar-badges': { body: { inbox: 0, approvals: 0, failedRuns: 0, joinRequests: 0 } },
    });
    const router = createMemoryRouter(buildAppRoutes({ featureModules: dashboardFeature }), {
      initialEntries: ['/TPS/dashboard'],
    });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    const trigger = await screen.findByRole('button', { name: /Chọn company/ });
    expect(trigger.textContent).toContain('2P Solutions');
    fireEvent.keyDown(trigger, { key: 'Enter' });
    const items = await screen.findAllByRole('menuitemradio');
    expect(items.map((i) => i.textContent)).toEqual([
      expect.stringContaining('2P Solutions'),
      expect.stringContaining('Crew E2E'),
    ]);
    expect(screen.queryByText('Crew Spike Policy')).toBeNull();
    fireEvent.click(items[1]);
    await waitFor(() => expect(router.state.location.pathname).toBe('/CE2E/dashboard'));
  });

  it('company không có cấu hình Crew thì vào bằng URL cũng không được (404)', async () => {
    mockServer({
      'GET /api/auth/get-session': { body: SESSION },
      'GET /api/companies': { body: [COMPANY_TPS, COMPANY_CREA] },
      'POST /api/plugins/crew.core/data/crew.companies': { body: { data: [{ id: 'c-tps', name: '2P Solutions' }] } },
    });
    const router = createMemoryRouter(buildAppRoutes({ featureModules: dashboardFeature }), {
      initialEntries: ['/CREA/dashboard'],
    });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    expect(await screen.findByText('Không tìm thấy trang')).toBeTruthy();
    expect(screen.queryByText('trang tổng quan')).toBeNull();
  });
});

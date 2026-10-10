// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildAppRoutes } from '@/app/router';
import { initI18n, setLanguage } from '@/i18n';
import { COMPANY_TPS, mockServer, SESSION } from './fetch-mock';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
});
afterEach(cleanup);

const LONG_NAME = 'Crew Spike Admin Với Một Cái Tên Rất Dài';

describe('chân sidebar với tên hiển thị dài', () => {
  it('nút tài khoản co lại và cắt tên có title; nút ngôn ngữ không bị co hay đẩy ra ngoài', async () => {
    mockServer({
      'GET /api/auth/get-session': { body: { ...SESSION, user: { ...SESSION.user, name: LONG_NAME } } },
      'GET /api/companies': { body: [COMPANY_TPS] },
      'POST /api/plugins/crew.core/data/crew.companies': {
        body: { data: [{ id: 'c-tps', name: '2P Solutions' }] },
      },
      'GET /api/companies/c-tps/sidebar-badges': { body: { inbox: 0, approvals: 0, failedRuns: 0, joinRequests: 0 } },
    });
    const router = createMemoryRouter(
      buildAppRoutes({
        featureModules: { '../features/dashboard/routes.tsx': { routes: [{ path: 'dashboard', element: <p>x</p> }] } },
      }),
      { initialEntries: ['/TPS/dashboard'] },
    );
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    const account = await screen.findByRole('button', { name: 'Tài khoản' });
    const name = screen.getByText(LONG_NAME);
    expect(name.getAttribute('title')).toBe(LONG_NAME);
    expect(name.className).toContain('truncate');
    expect(account.className).toContain('w-full');
    const cell = account.parentElement as HTMLElement;
    expect(cell.className).toContain('min-w-0');
    expect(cell.className).toContain('flex-1');
    const lang = screen.getByRole('group', { name: 'Ngôn ngữ' });
    expect(lang.className).toContain('shrink-0');
  });
});

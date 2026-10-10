// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

const page = (path: string) => ({ path, element: <p>trang {path}</p> });
const features = {
  '../features/dashboard/routes.tsx': { routes: [page('dashboard')] },
  '../features/inbox/routes.tsx': { routes: [page('inbox')] },
  '../features/issues/routes.tsx': { routes: [page('issues')] },
  '../features/projects/routes.tsx': { routes: [page('projects'), page('projects/:ref')] },
  '../features/agents/routes.tsx': { routes: [page('agents')] },
  '../features/settings/routes.tsx': { routes: [page('settings')] },
};

const project = (id: string, name: string, extra = {}) => ({
  id,
  name,
  urlKey: name.toLowerCase(),
  archivedAt: null,
  color: null,
  ...extra,
});

function open() {
  mockServer({
    'GET /api/auth/get-session': { body: SESSION },
    'GET /api/companies': { body: [COMPANY_TPS] },
    'POST /api/plugins/crew.core/data/crew.companies': { body: { data: [{ id: 'c-tps', name: '2P Solutions' }] } },
    'GET /api/companies/c-tps/sidebar-badges': { body: { inbox: 2, approvals: 0, failedRuns: 0, joinRequests: 0 } },
    'GET /api/companies/c-tps/issues': { body: [{ id: 'i1', isUnreadForMe: true }] },
    'GET /api/companies/c-tps/projects': {
      body: [
        project('p1', 'Alpha'),
        project('p2', 'Beta'),
        project('p3', 'Cũ', { archivedAt: '2026-10-01T00:00:00Z' }),
      ],
    },
    'GET /api/companies/c-tps/sidebar-preferences/me': { body: { orderedIds: ['p3', 'p2'], updatedAt: null } },
  });
  const router = createMemoryRouter(buildAppRoutes({ featureModules: features }), {
    initialEntries: ['/TPS/dashboard'],
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

describe('sidebar chia nhóm như Paperclip', () => {
  it('nhóm đầu không tên, rồi Công việc, Tổ chức, Hệ thống; mục chưa có route thì ẩn', async () => {
    open();
    const nav = await screen.findByRole('navigation', { name: 'Điều hướng chính' });
    const groups = [...nav.querySelectorAll('[data-slot="sidebar-group"]')].map((g) => g.textContent);
    expect(groups).toEqual([
      expect.stringContaining('Công việc'),
      expect.stringContaining('Tổ chức'),
      expect.stringContaining('Hệ thống'),
    ]);
    const group = (name: string) =>
      within(screen.getByRole('button', { name }).closest('[data-slot="sidebar-group"]') as HTMLElement);
    expect(group('Công việc').getByRole('link', { name: 'Yêu cầu' })).toBeTruthy();
    expect(group('Công việc').queryByRole('link', { name: 'Docs' })).toBeNull();
    expect(group('Tổ chức').getByRole('link', { name: 'Agent' })).toBeTruthy();
    expect(group('Hệ thống').getByRole('link', { name: 'Cài đặt' })).toBeTruthy();
    expect(within(nav).getByRole('link', { name: 'Tổng quan' })).toBeTruthy();
    expect(within(nav).getByRole('link', { name: 'Yêu cầu mới' })).toBeTruthy();
  });

  it('badge Hộp thư giữ nguyên trong nhóm đầu', async () => {
    open();
    const link = await screen.findByRole('link', { name: /^Hộp thư/ });
    await waitFor(() => expect(link.textContent).toContain('3'));
  });

  it('project gắn sao nằm dưới Project theo thứ tự đã lưu, bỏ project đã lưu trữ', async () => {
    open();
    const beta = await screen.findByRole('link', { name: 'Beta' });
    expect(beta.getAttribute('href')).toBe('/TPS/projects/beta');
    expect(screen.queryByRole('link', { name: 'Alpha' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Cũ' })).toBeNull();
  });

  it('bấm tiêu đề nhóm thu gọn rồi mở lại', async () => {
    open();
    const toggle = await screen.findByRole('button', { name: 'Tổ chức' });
    expect(screen.getByRole('link', { name: 'Agent' })).toBeTruthy();
    fireEvent.click(toggle);
    expect(screen.queryByRole('link', { name: 'Agent' })).toBeNull();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(screen.getByRole('link', { name: 'Agent' })).toBeTruthy();
  });
});

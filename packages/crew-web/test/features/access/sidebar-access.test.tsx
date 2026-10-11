// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildAppRoutes } from '@/app/router';
import { initI18n, setLanguage } from '@/i18n';
import { accessRoute, COMPANY_TPS, mockServer, SESSION } from '../../app/fetch-mock';

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
  '../features/contributions/routes.tsx': { routes: [page('contributions')] },
  '../features/projects/routes.tsx': { routes: [page('projects'), page('projects/:ref')] },
  '../features/wizards/routes.tsx': { routes: [page('projects/new')] },
  '../features/agents/routes.tsx': { routes: [page('agents')] },
  '../features/machines/routes.tsx': { routes: [page('machines')] },
  '../features/members/routes.tsx': { routes: [page('members')] },
  '../features/settings/routes.tsx': { routes: [page('settings')] },
};

const roles = {
  owner: { userId: 'u1', membershipRole: 'owner', contributor: false, canApprove: true },
  contributor: { userId: 'u1', membershipRole: 'viewer', contributor: true, canApprove: false },
  viewer: { userId: 'u1', membershipRole: 'viewer', contributor: false, canApprove: false },
};

function open(role: keyof typeof roles, at = '/TPS/dashboard', pending = 3) {
  const server = mockServer({
    'GET /api/auth/get-session': { body: SESSION },
    'GET /api/companies': { body: [COMPANY_TPS] },
    'POST /api/plugins/crew.core/data/crew.companies': { body: { data: [{ id: 'c-tps', name: '2P Solutions' }] } },
    'GET /api/companies/c-tps/sidebar-badges': { body: { inbox: 0, approvals: 0, failedRuns: 0, joinRequests: 0 } },
    'GET /api/companies/c-tps/issues': { body: [] },
    'GET /api/companies/c-tps/projects': { body: [] },
    'GET /api/companies/c-tps/sidebar-preferences/me': { body: { orderedIds: [], updatedAt: null } },
    'GET /api/crew/companies/c-tps/contributions/summary': { body: { pending } },
    ...accessRoute('c-tps', roles[role]),
  });
  const router = createMemoryRouter(buildAppRoutes({ featureModules: features }), { initialEntries: [at] });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, server };
}

const nav = () => screen.findByRole('navigation', { name: 'Điều hướng chính' });
const names = (el: HTMLElement) => within(el).queryAllByRole('link');

describe('sidebar theo vai trò', () => {
  it('owner thấy Chờ duyệt kèm số mục chờ, Thành viên, Hộp thư, Agent, Máy', async () => {
    open('owner');
    const el = await nav();
    const pending = await within(el).findByRole('link', { name: /^Chờ duyệt/ });
    await waitFor(() => expect(pending.textContent).toContain('3'));
    expect(pending.getAttribute('href')).toBe('/TPS/contributions');
    for (const name of ['Thành viên', 'Hộp thư', 'Agent', 'Máy', 'Yêu cầu mới']) {
      expect(within(el).getByRole('link', { name: new RegExp(`^${name}`) }), name).toBeTruthy();
    }
  });

  it('khách góp ý thấy Góp ý của tôi, bỏ Hộp thư, Agent, Máy, Thành viên', async () => {
    open('contributor', '/TPS/dashboard', 2);
    const el = await nav();
    const mine = await within(el).findByRole('link', { name: /^Góp ý của tôi/ });
    await waitFor(() => expect(mine.textContent).toContain('2'));
    await waitFor(() => expect(within(el).queryByRole('link', { name: /^Hộp thư/ })).toBeNull());
    const labels = names(el).map((l) => l.textContent ?? '');
    for (const gone of ['Hộp thư', 'Agent', 'Máy', 'Thành viên', 'Chờ duyệt']) {
      expect(
        labels.some((l) => l.startsWith(gone)),
        gone,
      ).toBe(false);
    }
    for (const kept of ['Yêu cầu mới', 'Yêu cầu', 'Project', 'Tổng quan', 'Cài đặt']) {
      expect(
        labels.some((l) => l.startsWith(kept)),
        kept,
      ).toBe(true);
    }
  });

  it('viewer thuần không có Góp ý, Yêu cầu mới và các mục ẩn', async () => {
    open('viewer');
    const el = await nav();
    await waitFor(() => expect(within(el).queryByRole('link', { name: /^Hộp thư/ })).toBeNull());
    const labels = names(el).map((l) => l.textContent ?? '');
    for (const gone of ['Yêu cầu mới', 'Góp ý của tôi', 'Chờ duyệt', 'Thành viên', 'Agent']) {
      expect(
        labels.some((l) => l.startsWith(gone)),
        gone,
      ).toBe(false);
    }
  });
});

describe('route bị cấm chuyển về Tổng quan', () => {
  it.each(['inbox', 'agents', 'machines', 'projects/new', 'members'])('khách vào %s thì về Tổng quan', async (path) => {
    const { router } = open('contributor', `/TPS/${path}`);
    await waitFor(() => expect(router.state.location.pathname).toBe('/TPS/dashboard'));
    expect(await screen.findByText('trang dashboard')).toBeTruthy();
  });

  it('khách vẫn vào được Yêu cầu, Project và trang Góp ý', async () => {
    for (const path of ['issues', 'projects', 'contributions']) {
      const { router } = open('contributor', `/TPS/${path}`);
      expect(await screen.findByText(`trang ${path}`)).toBeTruthy();
      expect(router.state.location.pathname).toBe(`/TPS/${path}`);
      cleanup();
    }
  });

  it('owner vào được Thành viên và Hộp thư', async () => {
    open('owner', '/TPS/members');
    expect(await screen.findByText('trang members')).toBeTruthy();
    cleanup();
    const { router } = open('owner', '/TPS/inbox');
    expect(await screen.findByText('trang inbox')).toBeTruthy();
    expect(router.state.location.pathname).toBe('/TPS/inbox');
  });
});

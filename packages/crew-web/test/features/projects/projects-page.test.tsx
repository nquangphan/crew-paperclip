// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { initI18n, setLanguage } from '@/i18n';
import { mockServer } from '../../app/fetch-mock';
import { data, project, renderPage } from './helpers';

const readiness = vi.hoisted(() => ({ value: [] as unknown[] }));
vi.mock('@/features/readiness', async (orig) => ({
  ...(await orig<object>()),
  useProjectReadiness: () => ({ data: readiness.value, isLoading: false, error: null }),
}));

import { ProjectsPage } from '@/features/projects/list/projects-page';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
});
afterEach(cleanup);

const PROJECTS = [
  project({ id: 'p1', urlKey: 'alpha', name: 'Alpha' }),
  project({ id: 'p2', urlKey: 'beta', name: 'Beta' }),
  project({ id: 'p3', urlKey: 'cu', name: 'Đã lưu trữ', archivedAt: '2026-10-01T00:00:00Z' }),
];

function server(orderedIds: string[] = [], setupRuns: unknown[] = []) {
  return mockServer({
    'GET /api/companies/c-tps/projects': { body: PROJECTS },
    'GET /api/companies/c-tps/sidebar-preferences/me': { body: { orderedIds, updatedAt: null } },
    'PUT /api/companies/c-tps/sidebar-preferences/me': (init) => ({
      body: { orderedIds: JSON.parse(String(init?.body)).orderedIds, updatedAt: null },
    }),
    ...data('crew.setupRuns', setupRuns),
  });
}

const mount = () => renderPage(<ProjectsPage />, { route: 'projects', at: '/TPS/projects' });

describe('ProjectsPage', () => {
  it('mỗi project có ReadinessBadge, project lưu trữ không hiện', async () => {
    readiness.value = [
      { projectId: 'p1', state: 'ready', failed: [], agents: [] },
      { projectId: 'p2', state: 'not_ready', failed: [{ id: 'P1', detail: 'detail.P1' }], agents: [] },
    ];
    server();
    mount();
    const alpha = (await screen.findByText('Alpha')).closest('tr') as HTMLElement;
    const beta = screen.getByText('Beta').closest('tr') as HTMLElement;
    expect(within(alpha).getByText('Sẵn sàng')).toBeTruthy();
    expect(within(beta).getByText('Chưa sẵn sàng')).toBeTruthy();
    expect(screen.queryByText('Đã lưu trữ')).toBeNull();
  });

  it('project not_ready có setup run dở → Làm tiếp tới projects/new?resume=<id>', async () => {
    readiness.value = [
      { projectId: 'p2', state: 'not_ready', failed: [{ id: 'P2', detail: 'detail.P2' }], agents: [] },
    ];
    server([], [{ id: 'run-9', kind: 'add-project', status: 'failed', projectId: 'p2', steps: {} }]);
    mount();
    const link = await screen.findByRole('link', { name: 'Làm tiếp' });
    await waitFor(() => expect(link.getAttribute('href')).toBe('/TPS/projects/new?resume=run-9'));
  });

  it('project not_ready không có setup run dở → Làm tiếp tới tab Sẵn sàng', async () => {
    readiness.value = [
      { projectId: 'p2', state: 'not_ready', failed: [{ id: 'P1', detail: 'detail.P1' }], agents: [] },
    ];
    server();
    mount();
    const link = await screen.findByRole('link', { name: 'Làm tiếp' });
    expect(link.getAttribute('href')).toBe('/TPS/projects/beta?tab=readiness');
  });

  it('project ready không có nút Làm tiếp', async () => {
    readiness.value = [{ projectId: 'p1', state: 'ready', failed: [], agents: [] }];
    server();
    mount();
    await screen.findByText('Alpha');
    expect(screen.queryByRole('link', { name: 'Làm tiếp' })).toBeNull();
  });

  it('nút Thêm project tới projects/new', async () => {
    readiness.value = [];
    server();
    const router = mount();
    fireEvent.click(await screen.findByRole('link', { name: 'Thêm project' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/TPS/projects/new'));
  });

  it('gắn sao ghi sidebar-preferences, project có sao lên đầu', async () => {
    readiness.value = [];
    const s = server(['p2']);
    mount();
    await screen.findByText('Alpha');
    const names = () =>
      screen
        .getAllByRole('row')
        .slice(1)
        .map((r) => within(r).getAllByRole('link')[0].textContent);
    expect(names()).toEqual(['Beta', 'Alpha']);
    fireEvent.click(screen.getByRole('button', { name: 'Gắn sao Alpha' }));
    await waitFor(() => expect(s.calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(s.calls.find((c) => c.method === 'PUT')?.body).toEqual({ orderedIds: ['p2', 'p1'] });
    expect(await screen.findByRole('button', { name: 'Bỏ sao Alpha' })).toBeTruthy();
  });

  it('bỏ sao project đã có sao', async () => {
    readiness.value = [];
    const s = server(['p2']);
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Bỏ sao Beta' }));
    await waitFor(() => expect(s.calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(s.calls.find((c) => c.method === 'PUT')?.body).toEqual({ orderedIds: [] });
  });
});

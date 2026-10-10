// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { api } from '@/api';
import { CompanyContext } from '@/app/hooks';
import { AddProjectPage } from '@/features/wizards/add-project/add-project-page';
import { initI18n, setLanguage } from '@/i18n';
import { mockServer } from '../../app/fetch-mock';
import { COMPANY, data, renderPage } from '../projects/helpers';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
  // Radix Select cần các hàm này mà jsdom chưa có.
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});
afterEach(cleanup);

const PLUGIN = '/api/plugins/crew.core/api';
const MACHINES = [
  { machineId: 'm1', hostname: 'mac-mini', online: true, latest: { jobsAgent: { version: '1.0.0', lastPollAt: 'x' } } },
  { machineId: 'm2', hostname: 'mac-cu', online: true, latest: {} },
];
const INSPECTED = [
  {
    id: 'j1',
    kind: 'inspect-folder',
    status: 'done',
    machineId: 'm1',
    result: { kind: 'inspect-folder', root: '/Users/owner/code/landing', branch: 'main' },
  },
  { id: 'j2', kind: 'check', status: 'done', machineId: 'm1', result: { kind: 'check', items: [] } },
];

const RUN = {
  id: 'run-1',
  companyId: 'c-tps',
  kind: 'add-project',
  projectKey: 'demo',
  projectId: 'p-demo',
  machineId: 'm1',
  input: { name: 'Demo', key: 'demo', folder: '/Users/owner/code/demo', executors: 1 },
  steps: {
    inspect: { status: 'done', at: 'x', refs: { root: '/Users/owner/code/demo' } },
    project: { status: 'done', at: 'x', refs: { project: 'p-demo' } },
    checkouts: { status: 'failed', at: 'x', error: 'git worktree add thất bại' },
  },
  status: 'failed',
  runningStep: null,
  createdAt: 'x',
  updatedAt: 'x',
};

function server(extra: Record<string, unknown> = {}) {
  return mockServer({
    'GET /api/companies/c-tps/projects': { body: [{ id: 'p0', name: 'Landing', urlKey: 'landing' }] },
    'GET /api/companies/c-tps/environments': { body: [] },
    ...data('crew.machines', MACHINES),
    ...data('crew.machineJobs', INSPECTED),
    ...(extra as Record<string, { body: unknown }>),
  });
}

const mount = (at = '/TPS/projects/new') => renderPage(<AddProjectPage />, { route: 'projects/new', at });

async function chooseMachine(name: RegExp) {
  fireEvent.keyDown(await screen.findByRole('combobox', { name: 'Máy' }), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('option', { name }));
}

describe('AddProjectPage', () => {
  it('bước 1: chọn máy (máy chưa chạy app có nhãn), gợi ý folder đã kiểm, khóa, tên, số executor', async () => {
    server();
    mount();
    fireEvent.keyDown(await screen.findByRole('combobox', { name: 'Máy' }), { key: 'Enter' });
    expect(await screen.findByRole('option', { name: 'mac-mini' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'mac-cu · App chưa chạy' })).toBeTruthy();
    fireEvent.click(screen.getByRole('option', { name: 'mac-mini' }));

    const suggestion = await screen.findByRole('button', { name: '/Users/owner/code/landing' });
    fireEvent.click(suggestion);
    expect((screen.getByLabelText('Folder repo trên máy') as HTMLInputElement).value).toBe('/Users/owner/code/landing');
    expect(screen.getByLabelText('Khóa project')).toBeTruthy();
    expect(screen.getByLabelText('Tên project')).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Số executor' })).toBeTruthy();
  });

  it('khóa e2e-* ở company không phải Crew E2E bị từ chối, không tạo setup run', async () => {
    const { calls } = server();
    mount();
    await chooseMachine(/^mac-mini$/);
    fireEvent.change(screen.getByLabelText('Folder repo trên máy'), { target: { value: '/Users/owner/code/demo' } });
    fireEvent.change(screen.getByLabelText('Khóa project'), { target: { value: 'e2e-demo' } });
    fireEvent.change(screen.getByLabelText('Tên project'), { target: { value: 'Demo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu' }));
    expect(await screen.findByText('Khóa e2e-* chỉ dùng cho company Crew E2E')).toBeTruthy();
    expect(calls.some((c) => c.method === 'POST' && c.url.startsWith(`${PLUGIN}/setup-runs`))).toBe(false);
  });

  it('khóa của project đã gỡ bị chặn ngay bước 1, không tạo setup run', async () => {
    const { calls } = server({
      'GET /api/companies/c-tps/projects?includeArchived=true': {
        body: [{ id: 'p-old', name: 'Demo cũ', urlKey: 'demo-cu', archivedAt: '2026-10-10T03:00:00.000Z' }],
      },
      'GET /api/companies/c-tps/environments': { body: [{ id: 'env-1', name: 'demo-assistant', status: 'archived' }] },
    });
    mount();
    await chooseMachine(/^mac-mini$/);
    fireEvent.change(screen.getByLabelText('Folder repo trên máy'), { target: { value: '/Users/owner/code/demo' } });
    fireEvent.change(screen.getByLabelText('Khóa project'), { target: { value: 'demo' } });
    fireEvent.change(screen.getByLabelText('Tên project'), { target: { value: 'Demo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu' }));
    expect(await screen.findByText('Khóa này đã dùng cho project đã gỡ, chọn khóa khác')).toBeTruthy();
    // Project đã gỡ (archive) cũng chặn khóa.
    fireEvent.change(screen.getByLabelText('Khóa project'), { target: { value: 'demo-cu' } });
    fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu' }));
    await waitFor(() =>
      expect(screen.getAllByText('Khóa này đã dùng cho project đã gỡ, chọn khóa khác')).toHaveLength(1),
    );
    expect(calls.some((c) => c.url === '/api/companies/c-tps/projects?includeArchived=true')).toBe(true);
    expect(calls.some((c) => c.method === 'POST' && c.url.startsWith(`${PLUGIN}/setup-runs`))).toBe(false);
  });

  it('Bắt đầu tạo setup run theo company đang xem rồi chạy bước inspect', async () => {
    const { calls } = server({
      [`POST ${PLUGIN}/setup-runs`]: { status: 201, body: { ...RUN, projectId: null, steps: {}, status: 'running' } },
      [`GET ${PLUGIN}/setup-runs/run-1`]: { body: { ...RUN, projectId: null, steps: {}, status: 'running' } },
      [`POST ${PLUGIN}/setup-runs/run-1/steps/inspect/begin`]: {
        status: 409,
        body: { error: 'Bước inspect đang chạy' },
      },
    });
    const router = mount();
    await chooseMachine(/^mac-mini$/);
    fireEvent.change(screen.getByLabelText('Folder repo trên máy'), { target: { value: '/Users/owner/code/demo' } });
    fireEvent.change(screen.getByLabelText('Khóa project'), { target: { value: 'demo' } });
    fireEvent.change(screen.getByLabelText('Tên project'), { target: { value: 'Demo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu' }));

    await waitFor(() => expect(router.state.location.search).toBe('?resume=run-1'));
    const create = calls.find((c) => c.method === 'POST' && c.url === `${PLUGIN}/setup-runs`);
    expect(create?.body).toEqual({
      companyId: 'c-tps',
      kind: 'add-project',
      projectKey: 'demo',
      machineId: 'm1',
      input: { name: 'Demo', key: 'demo', folder: '/Users/owner/code/demo', executors: 1 },
    });
    // Bước đầu đang có người chạy (409) → báo, không gọi thêm.
    expect(await screen.findByText('Đang có người chạy bước này. Đợi một lát rồi bấm Chạy tiếp.')).toBeTruthy();
    expect(calls.some((c) => c.url.includes('/machine-jobs'))).toBe(false);
  });

  it('khóa đang có lần thêm dở → mở lại đúng lần đó', async () => {
    server({
      [`POST ${PLUGIN}/setup-runs`]: {
        status: 409,
        body: { error: 'Đang có lần thêm project dở cho khóa này', setupRunId: 'run-old' },
      },
    });
    mount();
    await chooseMachine(/^mac-mini$/);
    fireEvent.change(screen.getByLabelText('Folder repo trên máy'), { target: { value: '/Users/owner/code/demo' } });
    fireEvent.change(screen.getByLabelText('Khóa project'), { target: { value: 'demo' } });
    fireEvent.change(screen.getByLabelText('Tên project'), { target: { value: 'Demo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu' }));
    const link = await screen.findByRole('link', { name: 'Mở lần đang dở' });
    expect(link.getAttribute('href')).toBe('/TPS/projects/new?resume=run-old');
  });

  it('?resume= hiện đúng bước đã xong, bước lỗi kèm lỗi và nút Chạy tiếp', async () => {
    server({ [`GET ${PLUGIN}/setup-runs/run-1`]: { body: RUN } });
    mount('/TPS/projects/new?resume=run-1');
    const list = await screen.findByRole('list');
    const item = (title: string) => within(list).getByText(title).closest('li') as HTMLElement;
    await waitFor(() => expect(item('Kiểm folder repo').dataset.state).toBe('done'));
    expect(item('Tạo project').dataset.state).toBe('done');
    expect(item('Tạo checkout cho từng vai trò').dataset.state).toBe('failed');
    expect(item('Tạo environment SSH').dataset.state).toBe('pending');
    expect(item('Kiểm trên máy').dataset.state).toBe('pending');
    expect(screen.getByRole('alert').textContent).toContain('git worktree add thất bại');
    expect(screen.getByRole('button', { name: 'Chạy tiếp' })).toBeTruthy();
  });

  describe('Bỏ lần dở', () => {
    const setup = api.setup as { abandon?: unknown };
    afterEach(() => {
      delete setup.abandon;
    });
    const unborn = {
      ...RUN,
      projectId: null,
      steps: { inspect: { status: 'failed', at: 'x', error: 'Không phải repo git' } },
    };

    it('lần thêm lỗi chưa tạo project: bấm "Bỏ lần dở", xác nhận → bỏ đúng run của company rồi về form', async () => {
      server({ [`GET ${PLUGIN}/setup-runs/run-1`]: { body: unborn } });
      const abandon = vi.fn(async () => ({ ...unborn, status: 'abandoned' }));
      setup.abandon = abandon;
      const router = mount('/TPS/projects/new?resume=run-1');
      fireEvent.click(await screen.findByRole('button', { name: 'Bỏ lần dở' }));
      const dialog = await screen.findByRole('alertdialog');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Bỏ lần dở' }));
      await waitFor(() => expect(abandon).toHaveBeenCalledWith('c-tps', 'run-1'));
      await waitFor(() => expect(router.state.location.search).toBe(''));
      expect(router.state.location.pathname).toBe('/TPS/projects/new');
    });

    it('đã tạo project thì không có nút (project và agent đã có, phải chạy tiếp)', async () => {
      server({ [`GET ${PLUGIN}/setup-runs/run-1`]: { body: RUN } });
      setup.abandon = vi.fn();
      mount('/TPS/projects/new?resume=run-1');
      expect(await screen.findByRole('button', { name: 'Chạy tiếp' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Bỏ lần dở' })).toBeNull();
    });

    it('lần đã bỏ: báo đã bỏ, không có Chạy tiếp', async () => {
      server({ [`GET ${PLUGIN}/setup-runs/run-1`]: { body: { ...unborn, status: 'abandoned' } } });
      mount('/TPS/projects/new?resume=run-1');
      expect(await screen.findByText('Lần thêm project này đã bỏ. Thêm lại project từ đầu.')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Chạy tiếp' })).toBeNull();
      expect(screen.getByRole('link', { name: 'Thêm project' }).getAttribute('href')).toBe('/TPS/projects/new');
    });
  });

  it('link "Mở project" theo company của setup run, không theo company đang chọn', async () => {
    const other = { id: 'c-xyz', name: 'XYZ', issuePrefix: 'XYZ' };
    server({ [`GET ${PLUGIN}/setup-runs/run-1`]: { body: { ...RUN, companyId: 'c-xyz', status: 'done', steps: {} } } });
    const router = createMemoryRouter([{ path: '/:companyPrefix/projects/new', element: <AddProjectPage /> }], {
      initialEntries: ['/TPS/projects/new?resume=run-1'],
    });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <CompanyContext.Provider value={{ company: COMPANY, companies: [COMPANY, other] }}>
          <RouterProvider router={router} />
        </CompanyContext.Provider>
      </QueryClientProvider>,
    );
    expect((await screen.findByRole('link', { name: 'Mở project' })).getAttribute('href')).toBe('/XYZ/projects/p-demo');
  });
});

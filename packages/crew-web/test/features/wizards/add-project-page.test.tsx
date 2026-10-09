// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AddProjectPage } from '@/features/wizards/add-project/add-project-page';
import { initI18n, setLanguage } from '@/i18n';
import { mockServer } from '../../app/fetch-mock';
import { data, renderPage } from '../projects/helpers';

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
});

// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { MachinesPage } from '@/features/machines/machines-page';
import { initI18n, setLanguage } from '@/i18n';
import { mockServer } from '../../app/fetch-mock';
import { data, renderPage } from '../agents/helpers';
import { job, M2, machine, ROUTE } from './fixtures';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const ago = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString();
const mount = () => renderPage(<MachinesPage />, { route: 'machines', at: '/TPS/machines' });

describe('MachinesPage', () => {
  it('S15.1: hiện thẻ từng máy và tự làm mới sau 30 giây', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const s = mockServer({
      ...data('crew.machines', [machine(), machine({ machineId: M2, hostname: 'mac-studio' })]),
      ...data('crew.machineJobs', []),
    });
    mount();
    expect(await screen.findByText('mac-mini')).toBeTruthy();
    expect(screen.getByText('mac-studio')).toBeTruthy();
    const count = () => s.calls.filter((c) => c.url.endsWith('/crew.machines')).length;
    expect(count()).toBe(1);
    await vi.advanceTimersByTimeAsync(30_000);
    await waitFor(() => expect(count()).toBe(2));
  });

  it('chưa có máy nào báo tin thì báo trống', async () => {
    mockServer({ ...data('crew.machines', []), ...data('crew.machineJobs', []) });
    mount();
    expect(await screen.findByText('Chưa có máy nào báo tin')).toBeTruthy();
  });

  it('S15.2: hàng đợi chỉ liệt kê việc chờ, đang làm và lỗi; việc xong không hiện', async () => {
    mockServer({
      ...data('crew.machines', [machine()]),
      ...data('crew.machineJobs', [
        job({ id: 'j-queued', status: 'queued', createdAt: ago(5) }),
        job({
          id: 'j-claimed',
          status: 'claimed',
          kind: 'check',
          payload: { kind: 'check', projectKey: 'alpha' },
          createdAt: ago(20),
        }),
        job({
          id: 'j-failed',
          status: 'failed',
          errorText: 'Không tải được skill',
          errorCode: 'skill_fetch_failed',
          createdAt: ago(90),
        }),
        job({ id: 'j-done', status: 'done', createdAt: ago(300) }),
      ]),
    });
    mount();
    const queue = await screen.findByRole('region', { name: 'Hàng đợi việc trên máy' });
    expect(within(queue).getAllByRole('row')).toHaveLength(4); // tiêu đề + 3 việc
    expect(within(queue).getByText('Đang chờ')).toBeTruthy();
    expect(within(queue).getByText('Đang làm')).toBeTruthy();
    expect(within(queue).getByText('Lỗi')).toBeTruthy();
    expect(within(queue).getByText('Không tải được skill')).toBeTruthy();
  });

  it('việc lỗi có nút Thử lại gọi retry với companyId', async () => {
    const s = mockServer({
      ...data('crew.machines', [machine()]),
      ...data('crew.machineJobs', [job({ id: 'j-failed', status: 'failed', errorText: 'Lỗi mạng' })]),
      [`${ROUTE}/machine-jobs/j-failed/retry`]: { body: job({ id: 'j-failed', status: 'queued' }) },
    });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Thử lại' }));
    await waitFor(() => expect(s.calls.some((c) => c.url.endsWith('/machine-jobs/j-failed/retry'))).toBe(true));
    expect(s.calls.find((c) => c.url.endsWith('/retry'))?.body).toEqual({ companyId: 'c-tps' });
  });

  it('retry bị từ chối thì hiện lỗi nguyên văn của server', async () => {
    mockServer({
      ...data('crew.machines', [machine()]),
      ...data('crew.machineJobs', [job({ id: 'j-failed', status: 'failed', errorText: 'x' })]),
      [`${ROUTE}/machine-jobs/j-failed/retry`]: { status: 409, body: { error: 'Việc không ở trạng thái lỗi' } },
    });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('Việc không ở trạng thái lỗi')).toBeTruthy();
  });

  it('việc chờ quá 60 giây mà máy không có app nhận việc thì báo "Chờ app 2P Crew"', async () => {
    mockServer({
      ...data('crew.machines', [machine({ jobsAgent: false })]),
      ...data('crew.machineJobs', [job({ id: 'j-old', status: 'queued', createdAt: ago(120) })]),
    });
    mount();
    expect(await screen.findByText('Chờ app 2P Crew trên mac-mini')).toBeTruthy();
  });

  it('không báo khi việc mới dưới 60 giây hoặc máy có app nhận việc', async () => {
    mockServer({
      ...data('crew.machines', [machine({ jobsAgent: false }), machine({ machineId: M2, hostname: 'mac-studio' })]),
      ...data('crew.machineJobs', [
        job({ id: 'j-new', status: 'queued', createdAt: ago(10) }),
        job({ id: 'j-old2', status: 'queued', machineId: M2, createdAt: ago(600) }),
      ]),
    });
    mount();
    await screen.findByRole('region', { name: 'Hàng đợi việc trên máy' });
    expect(screen.queryByText(/Chờ app 2P Crew trên/)).toBeNull();
  });

  it('việc kiểm tra lỗi liệt kê các mục trong result', async () => {
    mockServer({
      ...data('crew.machines', [machine()]),
      ...data('crew.machineJobs', [
        job({
          id: 'j-check',
          kind: 'check',
          payload: { kind: 'check', projectKey: 'alpha' },
          status: 'failed',
          errorText: 'Có mục lỗi',
          result: { kind: 'check', items: [{ id: 'git', status: 'error', title: 'Git chưa cấu hình' }] },
        }),
      ]),
    });
    mount();
    expect(await screen.findByText('Git chưa cấu hình')).toBeTruthy();
  });

  it('lỗi tải danh sách máy hiện ErrorState', async () => {
    mockServer({
      'POST /api/plugins/crew.core/data/crew.machines': { status: 500, body: { error: 'hỏng' } },
      ...data('crew.machineJobs', []),
    });
    mount();
    expect(await screen.findByText('hỏng')).toBeTruthy();
  });
});

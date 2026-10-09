// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CliAuthPage } from '@/app/auth/cli-auth-page';
import { initI18n, setLanguage } from '@/i18n';
import { mockServer, SESSION } from './fetch-mock';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
});
afterEach(cleanup);

const challenge = (over: Record<string, unknown> = {}) => ({
  id: 'ch1',
  status: 'pending',
  command: 'paperclipai auth login',
  clientName: '2P Crew app',
  requestedAccess: 'board',
  requestedCompanyId: null,
  requestedCompanyName: null,
  approvedAt: null,
  cancelledAt: null,
  expiresAt: '2026-10-10T01:00:00Z',
  approvedByUser: null,
  requiresSignIn: false,
  canApprove: true,
  currentUserId: 'u1',
  ...over,
});

function mount(entry: string) {
  const router = createMemoryRouter(
    [
      { path: '/cli-auth/:id', element: <CliAuthPage /> },
      { path: '/login', element: <p>trang đăng nhập</p> },
    ],
    { initialEntries: [entry] },
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

describe('duyệt đăng nhập CLI', () => {
  it('bấm Cho phép gọi đúng POST …/approve kèm token và hiện "Đã cho phép"', async () => {
    let status = 'pending';
    const { calls } = mockServer({
      'GET /api/auth/get-session': { body: SESSION },
      'GET /api/cli-auth/challenges/ch1': () => ({ body: challenge({ status }) }),
      'POST /api/cli-auth/challenges/ch1/approve': () => {
        status = 'approved';
        return { body: { approved: true, status: 'approved' } };
      },
    });
    mount('/cli-auth/ch1?token=tok-1');
    expect(await screen.findByText('2P Crew app')).toBeTruthy();
    expect(screen.getByText('paperclipai auth login')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cho phép' }));
    expect(await screen.findByText('Đã cho phép')).toBeTruthy();
    const approve = calls.find((c) => c.method === 'POST');
    expect(approve?.url).toBe('/api/cli-auth/challenges/ch1/approve');
    expect(approve?.body).toEqual({ token: 'tok-1' });
    expect(calls.some((c) => c.url === '/api/cli-auth/challenges/ch1?token=tok-1')).toBe(true);
  });

  it('bấm Hủy gọi …/cancel', async () => {
    let status = 'pending';
    const { calls } = mockServer({
      'GET /api/auth/get-session': { body: SESSION },
      'GET /api/cli-auth/challenges/ch1': () => ({ body: challenge({ status }) }),
      'POST /api/cli-auth/challenges/ch1/cancel': () => {
        status = 'cancelled';
        return { body: { cancelled: true, status: 'cancelled' } };
      },
    });
    mount('/cli-auth/ch1?token=tok-1');
    fireEvent.click(await screen.findByRole('button', { name: 'Hủy' }));
    expect(await screen.findByText('Đã hủy yêu cầu đăng nhập')).toBeTruthy();
    expect(calls.find((c) => c.method === 'POST')?.url).toBe('/api/cli-auth/challenges/ch1/cancel');
  });

  it('chưa đăng nhập thì về /login?next=/cli-auth/:id giữ token', async () => {
    mockServer({
      'GET /api/auth/get-session': { status: 401, body: {} },
      'GET /api/cli-auth/challenges/ch1': { body: challenge({ requiresSignIn: true, canApprove: false }) },
    });
    const router = mount('/cli-auth/ch1?token=tok-1');
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(router.state.location.search).toBe(`?next=${encodeURIComponent('/cli-auth/ch1?token=tok-1')}`);
  });

  it('challenge hết hạn hiện trạng thái hết hạn, không có nút Cho phép', async () => {
    mockServer({
      'GET /api/auth/get-session': { body: SESSION },
      'GET /api/cli-auth/challenges/ch1': { body: challenge({ status: 'expired' }) },
    });
    mount('/cli-auth/ch1?token=tok-1');
    expect(await screen.findByText('Yêu cầu đăng nhập đã hết hạn')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cho phép' })).toBeNull();
  });

  it('thiếu token báo link không hợp lệ', async () => {
    mockServer({ 'GET /api/auth/get-session': { body: SESSION } });
    mount('/cli-auth/ch1');
    expect(await screen.findByText('Link duyệt đăng nhập không hợp lệ')).toBeTruthy();
  });
});

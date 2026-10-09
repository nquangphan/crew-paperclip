// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { LoginPage } from '@/app/auth/login-page';
import { initI18n, setLanguage } from '@/i18n';
import { mockServer, SESSION } from './fetch-mock';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
});
afterEach(cleanup);

function mount(entry: string) {
  const router = createMemoryRouter(
    [
      { path: '/login', element: <LoginPage /> },
      { path: '/', element: <p>trang chủ</p> },
      { path: '/TPS/issues', element: <p>trang yêu cầu</p> },
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

async function submit(email: string, password: string) {
  fireEvent.change(await screen.findByLabelText('Email'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));
}

describe('đăng nhập', () => {
  it('next=//evil.com thì về /', async () => {
    let signedIn = false;
    const { calls } = mockServer({
      'GET /api/auth/get-session': () => (signedIn ? { body: SESSION } : { status: 401, body: {} }),
      'POST /api/auth/sign-in/email': () => {
        signedIn = true;
        return { body: { token: 'x' } };
      },
    });
    const router = mount('/login?next=//evil.com');
    await submit('owner@example.com', 'pw');
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ email: 'owner@example.com', password: 'pw' });
  });

  it('thành công thì về đúng next nội bộ', async () => {
    let signedIn = false;
    mockServer({
      'GET /api/auth/get-session': () => (signedIn ? { body: SESSION } : { status: 401, body: {} }),
      'POST /api/auth/sign-in/email': () => {
        signedIn = true;
        return { body: {} };
      },
    });
    const router = mount(`/login?next=${encodeURIComponent('/TPS/issues')}`);
    await submit('owner@example.com', 'pw');
    await waitFor(() => expect(router.state.location.pathname).toBe('/TPS/issues'));
  });

  it('sai mật khẩu báo lỗi, ở lại trang; không có link đăng ký', async () => {
    mockServer({
      'GET /api/auth/get-session': { status: 401, body: {} },
      'POST /api/auth/sign-in/email': {
        status: 401,
        body: { code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email or password' },
      },
    });
    const router = mount('/login');
    await submit('owner@example.com', 'sai');
    expect(await screen.findByText('Sai email hoặc mật khẩu')).toBeTruthy();
    expect(router.state.location.pathname).toBe('/login');
    expect(screen.queryByText(/đăng ký|tạo tài khoản/i)).toBeNull();
  });

  it('đã đăng nhập mà vào /login thì đi thẳng tới next', async () => {
    mockServer({ 'GET /api/auth/get-session': { body: SESSION } });
    const router = mount(`/login?next=${encodeURIComponent('/TPS/issues')}`);
    await waitFor(() => expect(router.state.location.pathname).toBe('/TPS/issues'));
  });
});

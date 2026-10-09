// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CompanyContext, MeContext } from '@/app/hooks';
import { SettingsPage } from '@/features/settings/settings-page';
import { initI18n, setLanguage } from '@/i18n';
import { mockServer } from '../../app/fetch-mock';
import { COMPANY } from '../agents/helpers';

beforeAll(async () => {
  await initI18n();
});
afterEach(async () => {
  cleanup();
  await setLanguage('vi');
});

const ME: { id: string; name: string; email: string; image: string | null } = {
  id: 'u1',
  name: 'Owner',
  email: 'owner@example.com',
  image: null,
};
const HEALTH = {
  status: 'ok',
  version: '2026.1005.0',
  commit: '0123456789abcdef0123456789abcdef01234567',
  databaseBackup: {
    enabled: true,
    status: 'ok',
    latestBackup: { name: 'b.sql.gz', mtime: '2026-10-09T17:31:26Z', ageHours: 3 },
  },
};
const PROFILE = (over: Record<string, unknown> = {}) => ({
  id: 'u1',
  email: 'owner@example.com',
  name: 'Owner',
  image: null,
  ...over,
});

function mount(me = ME) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([{ path: '/', element: <SettingsPage /> }]);
  render(
    <QueryClientProvider client={client}>
      <CompanyContext.Provider value={{ company: COMPANY, companies: [COMPANY] }}>
        <MeContext.Provider value={me}>
          <RouterProvider router={router} />
        </MeContext.Provider>
      </CompanyContext.Provider>
    </QueryClientProvider>,
  );
}

describe('SettingsPage', () => {
  it('S18.1: lưu tên gửi PATCH /api/auth/profile chỉ có name', async () => {
    await setLanguage('vi');
    const s = mockServer({
      'GET /api/health': { body: HEALTH },
      'PATCH /api/auth/profile': { body: PROFILE({ name: 'Chủ nhà' }) },
    });
    mount();
    const name = screen.getByLabelText('Tên hiển thị') as HTMLInputElement;
    expect(name.value).toBe('Owner');
    fireEvent.change(name, { target: { value: 'Chủ nhà' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu hồ sơ' }));
    await waitFor(() => expect(s.calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(s.calls.find((c) => c.method === 'PATCH')?.body).toEqual({ name: 'Chủ nhà' });
    expect(await screen.findByText('Đã lưu hồ sơ')).toBeTruthy();
  });

  it('S18.1: ảnh đại diện upload rồi PATCH kèm image là đường dẫn asset', async () => {
    const s = mockServer({
      'GET /api/health': { body: HEALTH },
      'POST /api/companies/c-tps/assets/images': { body: { assetId: 'a1', contentPath: '/api/assets/a1/content' } },
      'PATCH /api/auth/profile': { body: PROFILE({ image: '/api/assets/a1/content' }) },
    });
    mount();
    const file = new File(['x'], 'me.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Ảnh đại diện'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu hồ sơ' }));
    await waitFor(() => expect(s.calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(s.calls.find((c) => c.method === 'PATCH')?.body).toEqual({ name: 'Owner', image: '/api/assets/a1/content' });
    const upload = s.calls.find((c) => c.url.endsWith('/assets/images'));
    expect(upload?.body).toBeInstanceOf(FormData);
    expect(upload?.body instanceof FormData ? upload.body.get('namespace') : null).toBe('profile');
  });

  it('gỡ ảnh gửi image null', async () => {
    const s = mockServer({ 'GET /api/health': { body: HEALTH }, 'PATCH /api/auth/profile': { body: PROFILE() } });
    mount({ ...ME, image: '/api/assets/a0/content' });
    fireEvent.click(screen.getByRole('button', { name: 'Gỡ ảnh đại diện' }));
    await waitFor(() => expect(s.calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(s.calls.find((c) => c.method === 'PATCH')?.body).toEqual({ name: 'Owner', image: null });
  });

  it('server từ chối thì hiện lỗi nguyên văn', async () => {
    mockServer({
      'GET /api/health': { body: HEALTH },
      'PATCH /api/auth/profile': { status: 400, body: { error: 'Invalid profile image URL' } },
    });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Lưu hồ sơ' }));
    expect(await screen.findByText('Invalid profile image URL')).toBeTruthy();
  });

  it('tên trống thì không lưu được', () => {
    mockServer({ 'GET /api/health': { body: HEALTH } });
    mount();
    fireEvent.change(screen.getByLabelText('Tên hiển thị'), { target: { value: '   ' } });
    expect((screen.getByRole('button', { name: 'Lưu hồ sơ' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('S18.2: đổi ngôn ngữ ghi localStorage và đổi chữ giao diện', async () => {
    mockServer({ 'GET /api/health': { body: HEALTH } });
    mount();
    expect(screen.getByRole('button', { name: 'Tiếng Việt' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Tiếng Anh' }));
    await waitFor(() => expect(localStorage.getItem('crew.lang')).toBe('en'));
    expect(await screen.findByLabelText('Display name')).toBeTruthy();
  });

  it('S18.3: thông tin hệ thống chỉ đọc từ /api/health', async () => {
    await setLanguage('vi');
    const s = mockServer({ 'GET /api/health': { body: HEALTH } });
    mount();
    const info = await screen.findByRole('region', { name: 'Thông tin hệ thống' });
    expect(await within(info).findByText('2026.1005.0')).toBeTruthy();
    expect(within(info).getByText('0123456789ab')).toBeTruthy();
    expect(within(info).getByText('10/10/2026 00:31')).toBeTruthy();
    expect(within(info).queryAllByRole('textbox')).toHaveLength(0);
    expect(within(info).queryAllByRole('button')).toHaveLength(0);
    expect(s.calls.filter((c) => c.method !== 'GET')).toHaveLength(0);
  });

  it('thiếu trường thì hiện "Không rõ", không vỡ trang', async () => {
    await setLanguage('vi');
    mockServer({ 'GET /api/health': { body: { status: 'ok' } } });
    mount();
    const info = await screen.findByRole('region', { name: 'Thông tin hệ thống' });
    await waitFor(() => expect(within(info).getAllByText('Không rõ').length).toBe(3));
  });
});

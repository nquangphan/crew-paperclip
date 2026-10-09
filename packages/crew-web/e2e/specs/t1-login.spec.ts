// Ca khói T1: đăng nhập bằng form (tài khoản tạm của stack ~/crew-r3-t1). Chỉ chạy ở --project=t1 (@t1-only).
// Trace chụp DOM (giá trị ô mật khẩu) và body request đăng nhập, nên file điền mật khẩu thật tắt trace.
import { email } from '../support/env';
import { expect, test } from '../support/fixtures';
import { login } from '../support/login';

test.use({ storageState: { cookies: [], origins: [] }, trace: 'off' });

test('T1 đăng nhập đúng vào trong company, không có link tạo tài khoản @t1 @t1-only', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('link', { name: /tạo tài khoản|sign up|đăng ký/i })).toHaveCount(0);
  await login(page);
  await expect(page).not.toHaveURL(/\/login/);
  const session = await page.request.get('/api/auth/get-session');
  expect((await session.json())?.user?.email).toBe(email());
});

test('T1 sai mật khẩu báo lỗi, không có phiên @t1 @t1-only', async ({ page }) => {
  await page.goto('/login');
  const form = page.locator('form');
  await form.locator('input[type="email"]').fill(email());
  await form.locator('input[type="password"]').fill('sai-mat-khau-e2e');
  await form.locator('button[type="submit"]').click();
  await expect(page.getByRole('alert')).toContainText('Sai email hoặc mật khẩu');
  await expect(page).toHaveURL(/\/login/);
  const session = await page.request.get('/api/auth/get-session');
  expect((await session.json().catch(() => null))?.user ?? null).toBeNull();
});

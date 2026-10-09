// PW-S0-6 đăng xuất. Đăng nhập lại bằng form (mật khẩu thật) trong phiên riêng, nên file tắt trace;
// phiên dùng chung của các ca khác không bị đụng. run-e2e.sh còn quét test-results.
import { expect, test } from '../support/fixtures';
import { login } from '../support/login';

test.use({ storageState: { cookies: [], origins: [] }, trace: 'off' });

test('PW-S0-6 menu tài khoản → Đăng xuất: phiên bị xóa, vào trang trong bị chuyển về đăng nhập @t1', async ({
  page,
  company,
}) => {
  await login(page);
  await page.goto(company.path('dashboard'));
  await page.getByRole('button', { name: 'Tài khoản' }).click();
  await page.getByRole('menuitem', { name: 'Đăng xuất' }).click();
  await expect(page).toHaveURL(/\/login/);
  const session = await page.request.get('/api/auth/get-session');
  expect((await session.json().catch(() => null))?.user ?? null).toBeNull();
  await page.goto(company.path('inbox'));
  await expect(page).toHaveURL(/\/login/);
});

// Đăng nhập bằng form /login (không nạp cookie qua tool). Mật khẩu điền bằng locator.evaluate để không thành
// tham số của action `fill`/`type` trong trace; run-e2e.sh kiểm test-results không chứa mật khẩu.
import { chmodSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { email, password, storageStatePath } from './env';

/** Gán giá trị cho input React (setter gốc + sự kiện input) mà không gọi fill. */
export async function fillSecret(input: Locator, value: string): Promise<void> {
  await input.evaluate((el, v) => {
    const proto = Object.getPrototypeOf(el) as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    setter?.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

export interface LoginOptions {
  /** Trang mong đợi sau đăng nhập (mặc định: rời /login). */
  expectPath?: RegExp;
  emailValue?: string;
  passwordValue?: string;
}

async function submitLoginForm(page: Page, opts: LoginOptions): Promise<void> {
  await page.goto('/login');
  const form = page.locator('form');
  await form.locator('input[type="email"]').fill(opts.emailValue ?? email());
  await fillSecret(form.locator('input[type="password"]'), opts.passwordValue ?? password());
  await form.locator('button[type="submit"]').click();
  await expect(page).not.toHaveURL(/\/login(\?|$)/, { timeout: 20_000 });
  if (opts.expectPath) await expect(page).toHaveURL(opts.expectPath, { timeout: 20_000 });
}

function insideTest(): boolean {
  try {
    test.info();
    return true;
  } catch {
    return false;
  }
}

/** Đăng nhập bằng form; trong ca thì gói vào một bước `box` (global-setup gọi ngoài ca). */
export async function login(page: Page, opts: LoginOptions = {}): Promise<void> {
  if (!insideTest()) return submitLoginForm(page, opts);
  await test.step('đăng nhập bằng form', () => submitLoginForm(page, opts), { box: true });
}

/** Đăng nhập bằng form rồi lưu storageState vào thư mục tạm 0700 của lượt chạy. */
export async function loginAndSaveState(page: Page): Promise<string> {
  await login(page);
  const file = storageStatePath();
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  chmodSync(path.dirname(file), 0o700);
  await page.context().storageState({ path: file });
  chmodSync(file, 0o600);
  return file;
}

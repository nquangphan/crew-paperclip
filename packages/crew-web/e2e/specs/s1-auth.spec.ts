// S1 đăng nhập và duyệt đăng nhập CLI. Cả file điền mật khẩu thật nên tắt trace (trace chụp DOM và body request);
// run-e2e.sh còn quét test-results. Sai mật khẩu chỉ một lần mỗi lượt: bucket rate-limit của Better Auth dùng chung,
// gặp 429 thì đợi khoảng 60 giây rồi chạy lại.
import { request } from '@playwright/test';
import { boardApi } from '../support/api';
import { baseUrl, email, storageStatePath } from '../support/env';
import { expect, test } from '../support/fixtures';
import { login } from '../support/login';

test.use({ storageState: { cookies: [], origins: [] }, trace: 'off' });

test('PW-S1-1 đăng nhập: sai báo lỗi, đúng vào Tổng quan, không có link tạo tài khoản @t1', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('link', { name: /tạo tài khoản|sign up|đăng ký/i })).toHaveCount(0);

  const form = page.locator('form');
  await form.locator('input[type="email"]').fill(email());
  await form.locator('input[type="password"]').fill('sai-mat-khau-e2e');
  await form.locator('button[type="submit"]').click();
  await expect(page.getByRole('alert')).toContainText('Sai email hoặc mật khẩu');
  await expect(page).toHaveURL(/\/login/);
  const none = await page.request.get('/api/auth/get-session');
  expect((await none.json().catch(() => null))?.user ?? null).toBeNull();

  await login(page);
  await expect(page).not.toHaveURL(/\/login/);
  await page.goto('/');
  await expect(page).toHaveURL(/\/[A-Za-z0-9]+\/dashboard$/);
  await expect(page.getByRole('heading', { name: 'Hoạt động gần đây' })).toBeVisible();
  const session = await page.request.get('/api/auth/get-session');
  expect((await session.json())?.user?.email).toBe(email());
});

interface Challenge {
  id: string;
  token: string;
  approvalPath: string;
}

async function createChallenge(): Promise<Challenge> {
  const anon = await request.newContext({
    baseURL: baseUrl(),
    extraHTTPHeaders: { Origin: new URL(baseUrl()).origin },
  });
  try {
    const res = await anon.post('/api/cli-auth/challenges', {
      data: { command: 'crew-e2e s1', clientName: 'crew-e2e' },
    });
    expect(res.status()).toBe(201);
    return (await res.json()) as Challenge;
  } finally {
    await anon.dispose();
  }
}

async function challengeStatus(c: Challenge): Promise<string> {
  const api = await boardApi();
  try {
    return (await api.get<{ status: string }>(`/api/cli-auth/challenges/${c.id}?token=${encodeURIComponent(c.token)}`))
      .status;
  } finally {
    await api.dispose();
  }
}

const activeKeyIds = async (): Promise<Set<string>> => {
  const api = await boardApi();
  try {
    return new Set((await api.get<{ id: string }[]>('/api/board-api-keys')).map((k) => k.id));
  } finally {
    await api.dispose();
  }
};

test('PW-S1-2 /cli-auth/:id: Cho phép → approved (thu hồi key vừa tạo), Hủy → cancelled @t1', async ({ browser }) => {
  // Dùng phiên của lượt chạy (không đăng nhập lại): Better Auth chỉ cho vài lần đăng nhập mỗi phút.
  const context = await browser.newContext({ baseURL: baseUrl(), locale: 'vi-VN', storageState: storageStatePath() });
  const page = await context.newPage();
  const before = await activeKeyIds();
  try {
    const allow = await createChallenge();
    await page.goto(allow.approvalPath);
    await page.getByRole('button', { name: 'Cho phép' }).click();
    await expect(page.getByText('Đã cho phép')).toBeVisible();
    expect(await challengeStatus(allow)).toBe('approved');

    const deny = await createChallenge();
    await page.goto(deny.approvalPath);
    await page.getByRole('button', { name: 'Hủy' }).click();
    await expect(page.getByText('Đã hủy yêu cầu đăng nhập')).toBeVisible();
    expect(await challengeStatus(deny)).toBe('cancelled');
  } finally {
    await context.close();
    // Duyệt tạo board key thật: thu hồi mọi key mới sinh trong ca.
    const api = await boardApi();
    try {
      const now = await api.get<{ id: string }[]>('/api/board-api-keys');
      for (const k of now.filter((k) => !before.has(k.id))) await api.delete(`/api/board-api-keys/${k.id}`);
      const left = (await api.get<{ id: string }[]>('/api/board-api-keys')).filter((k) => !before.has(k.id));
      expect(left).toEqual([]);
    } finally {
      await api.dispose();
    }
  }
});

// Ca khói T1 trên stack cục bộ (~/crew-r3-t1): duyệt đăng nhập CLI (trang /cli-auth/:id).
// Chỉ chạy ở --project=t1 (@t1-only): duyệt challenge tạo board key thật, nên trên prod chỉ ca của s1-auth làm việc đó.
import { request } from '@playwright/test';
import { boardApi } from '../support/api';
import { baseUrl } from '../support/env';
import { expect, test } from '../support/fixtures';

async function createChallenge() {
  const anon = await request.newContext({
    baseURL: baseUrl(),
    extraHTTPHeaders: { Origin: new URL(baseUrl()).origin },
  });
  try {
    const res = await anon.post('/api/cli-auth/challenges', {
      data: { command: 'crew-e2e smoke', clientName: 'crew-e2e' },
    });
    expect(res.status()).toBe(201);
    return (await res.json()) as { id: string; token: string; approvalPath: string };
  } finally {
    await anon.dispose();
  }
}

async function challengeStatus(id: string, token: string): Promise<string> {
  const api = await boardApi();
  try {
    const c = await api.get<{ status: string }>(`/api/cli-auth/challenges/${id}?token=${encodeURIComponent(token)}`);
    return c.status;
  } finally {
    await api.dispose();
  }
}

test('T1 duyệt đăng nhập CLI: Cho phép → approved @t1 @t1-only', async ({ page }) => {
  const c = await createChallenge();
  await page.goto(c.approvalPath);
  await page.getByRole('button', { name: 'Cho phép' }).click();
  await expect(page.getByText('Đã cho phép')).toBeVisible();
  expect(await challengeStatus(c.id, c.token)).toBe('approved');
});

test('T1 duyệt đăng nhập CLI: Hủy → cancelled @t1 @t1-only', async ({ page }) => {
  const c = await createChallenge();
  await page.goto(c.approvalPath);
  await page.getByRole('button', { name: 'Hủy' }).click();
  await expect(page.getByText('Đã hủy yêu cầu đăng nhập')).toBeVisible();
  expect(await challengeStatus(c.id, c.token)).toBe('cancelled');
});

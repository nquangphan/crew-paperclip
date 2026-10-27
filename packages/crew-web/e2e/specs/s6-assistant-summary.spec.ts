// Mục "Tổng kết của Trợ Lý": tách khỏi mô tả thành khối riêng ngay sau mô tả (có ảnh), mô tả không lặp lại nó; bình luận
// dài thu gọn với đáy mờ dần và nút Hiện đủ (còn N dòng) / Thu gọn. Đặt CREW_SHOTS_DIR để lưu ảnh PNG sáng và tối.
import path from 'node:path';
import type { Page } from '@playwright/test';
import { type Api, assertWriteAllowed } from '../support/api';
import { createIssue, uniqueToken } from '../support/data';
import { expect, test } from '../support/fixtures';

const IMG = path.resolve(import.meta.dirname, '../../src/features/guide/img/vi/roadmap.webp');

async function upload(api: Api, companyId: string, issueId: string) {
  const p = `/api/companies/${companyId}/issues/${issueId}/attachments`;
  await assertWriteAllowed(api.ctx, 'POST', p, {});
  const res = await api.ctx.post(p, {
    multipart: {
      file: { name: 'roadmap.webp', mimeType: 'image/webp', buffer: (await import('node:fs')).readFileSync(IMG) },
    },
  });
  expect(res.status(), await res.text()).toBeLessThan(300);
  return (await res.json()) as { id: string };
}

async function setTheme(page: Page, theme: 'light' | 'dark') {
  await page.evaluate((t) => localStorage.setItem('crew.theme', t), theme);
  await page.reload();
}

test('PW-S6-SUM tổng kết thành khối riêng sau mô tả; bình luận dài thu gọn, mở được @t1', async ({
  page,
  company,
  api,
}) => {
  const issue = await createIssue(api, company.id, { title: `PW-S6-SUM ${uniqueToken()}`, description: 'Mô tả gốc' });
  const att = await upload(api, company.id, issue.id);
  const description = [
    'Làm lại trang chủ theo mockup.',
    '',
    '## Tổng kết của Trợ Lý',
    '',
    '### Yêu cầu',
    'Làm lại trang chủ.',
    '',
    '### Kết quả',
    'Đã xong, ảnh nằm bên dưới.',
    '',
    '### Hình ảnh',
    `![roadmap](/api/attachments/${att.id}/content)`,
  ].join('\n');
  await api.patch(`/api/issues/${issue.id}`, { description });
  const long = Array.from({ length: 30 }, (_, i) => `Dòng báo cáo số ${i + 1}`).join('\n\n');
  await api.post(`/api/issues/${issue.id}/comments`, { body: long });

  await page.setViewportSize({ width: 1100, height: 1500 });
  await page.goto(company.path(`issues/${issue.identifier}`));
  const desc = page.getByTestId('issue-description');
  const summary = page.getByTestId('assistant-summary');
  await expect(summary).toContainText('Đã xong, ảnh nằm bên dưới.');
  await expect(desc).toContainText('Làm lại trang chủ theo mockup.');
  await expect(desc).not.toContainText('Đã xong, ảnh nằm bên dưới.');
  await expect(summary.locator('img')).toBeVisible();
  await expect
    .poll(() => summary.locator('img').evaluate((el: HTMLImageElement) => el.naturalWidth))
    .toBeGreaterThan(0);

  const toggle = page.getByRole('button', { name: /^Hiện đủ \(còn \d+ dòng\)$/ });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');

  const dir = process.env.CREW_SHOTS_DIR;
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme);
    await expect(summary.locator('img')).toBeVisible();
    await expect(toggle).toBeVisible();
    if (dir) {
      await page.screenshot({ path: path.join(dir, `chi-tiet-${theme}.png`), fullPage: true });
      await page
        .getByTestId('comment')
        .first()
        .screenshot({ path: path.join(dir, `comment-thu-gon-${theme}.png`) });
    }
  }
  await toggle.click();
  await expect(page.getByRole('button', { name: 'Thu gọn' })).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('comment').first().locator('[data-collapsed]')).toHaveCount(0);
});

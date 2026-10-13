// S6.6 file đính kèm mở bằng hộp xem trong trang, không mở tab mới: ảnh lớn có trước/sau (nút, phím mũi tên, bộ
// đếm), markdown render, HTML mockup trong iframe sandbox, file khác có nút Tải về; link file trong bình luận cũng mở
// hộp xem. Chạy ở trang đầy đủ, trong popup `?issue=` (hộp chồng hộp) và trên điện thoại (phủ kín màn hình).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { type Api, assertWriteAllowed } from '../support/api';
import { createIssue, uniqueToken } from '../support/data';
import { expect, test } from '../support/fixtures';

interface Uploaded {
  id: string;
  originalFilename: string;
}

const IMG_DIR = path.resolve(import.meta.dirname, '../../src/features/guide/img/vi');
const MOCKUP_HTML =
  '<!doctype html><html><body style="font-family:sans-serif"><h1 id="t">Mockup trang chủ</h1>' +
  '<script>var r;try{r=parent.document.cookie,r="leaked"}catch(e){r="blocked"}' +
  'document.getElementById("t").dataset.parent=r</script>' +
  '</body></html>';

/** Tải một file lên issue như composer (multipart, trường `file`). */
async function upload(api: Api, companyId: string, issueId: string, name: string, mimeType: string, buffer: Buffer) {
  const p = `/api/companies/${companyId}/issues/${issueId}/attachments`;
  await assertWriteAllowed(api.ctx, 'POST', p, {});
  const res = await api.ctx.post(p, { multipart: { file: { name, mimeType, buffer } } });
  expect(res.status(), await res.text()).toBeLessThan(300);
  return (await res.json()) as Uploaded;
}

/** Issue có 2 ảnh (danh sách mới nhất trước: agents.webp rồi roadmap.webp), 1 markdown, 1 HTML, 1 zip và một bình luận chứa link tới file markdown. */
async function issueWithFiles(api: Api, companyId: string, title: string) {
  const issue = await createIssue(api, companyId, { title });
  const img1 = await upload(
    api,
    companyId,
    issue.id,
    'roadmap.webp',
    'image/webp',
    readFileSync(`${IMG_DIR}/roadmap.webp`),
  );
  await upload(api, companyId, issue.id, 'agents.webp', 'image/webp', readFileSync(`${IMG_DIR}/agents.webp`));
  const md = await upload(
    api,
    companyId,
    issue.id,
    'ghi-chu.md',
    'text/markdown',
    Buffer.from('# Ghi chú thiết kế\n\n- Mục một\n- Mục **hai**\n'),
  );
  await upload(api, companyId, issue.id, 'mockup.html', 'text/html', Buffer.from(MOCKUP_HTML));
  await upload(api, companyId, issue.id, 'goi.zip', 'application/zip', Buffer.from('PK'));
  await api.post(`/api/issues/${issue.id}/comments`, {
    body: `Xem [bản ghi chú](/api/attachments/${md.id}/content) nhé.`,
  });
  return { issue, img1 };
}

const viewerOf = (page: Page) => page.getByTestId('attachment-viewer');

test('PW-S6-6a trang đầy đủ: ảnh có trước/sau, markdown, HTML sandbox, zip, link trong bình luận; không tab mới @t1', async ({
  page,
  context,
  company,
  api,
}) => {
  const { issue } = await issueWithFiles(api, company.id, `PW-S6-6a ${uniqueToken()}`);
  await page.goto(company.path(`issues/${issue.identifier}`));
  const url = page.url();
  const viewer = viewerOf(page);
  let opened = 0;
  context.on('page', () => {
    opened += 1;
  });

  await page.getByRole('img', { name: 'agents.webp' }).click();
  await expect(viewer).toBeVisible();
  await expect(viewer.getByRole('heading', { name: 'agents.webp' })).toBeVisible();
  await expect(viewer.getByTestId('attachment-viewer-counter')).toHaveText('1 / 2');
  const big = viewer.getByRole('img', { name: 'agents.webp' });
  await expect.poll(() => big.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
  await expect(viewer.getByRole('link', { name: 'Tải về' })).toHaveAttribute('href', /\?download=true$/);
  await expect(viewer.getByRole('link', { name: 'Mở tab mới' })).toHaveAttribute('target', '_blank');
  await page.keyboard.press('ArrowRight');
  await expect(viewer.getByTestId('attachment-viewer-counter')).toHaveText('2 / 2');
  await expect(viewer.getByRole('heading', { name: 'roadmap.webp' })).toBeVisible();
  await viewer.getByRole('button', { name: 'Ảnh trước' }).click();
  await expect(viewer.getByTestId('attachment-viewer-counter')).toHaveText('1 / 2');
  await page.keyboard.press('Escape');
  await expect(viewer).toHaveCount(0);

  await page.getByRole('link', { name: /ghi-chu\.md/ }).click();
  await expect(viewer.getByRole('heading', { name: 'Ghi chú thiết kế' })).toBeVisible();
  await viewer.getByRole('button', { name: 'Đóng' }).click();
  await expect(viewer).toHaveCount(0);

  // HTML chạy trong iframe sandbox không có allow-same-origin: script chạy được nhưng không chạm được trang cha.
  await page.getByRole('link', { name: /mockup\.html/ }).click();
  await expect(viewer.locator('iframe')).toHaveAttribute('sandbox', 'allow-scripts');
  const heading = viewer.frameLocator('iframe').getByRole('heading', { name: 'Mockup trang chủ' });
  await expect(heading).toBeVisible();
  await expect(heading).toHaveAttribute('data-parent', 'blocked');
  // Bấm ra ngoài hộp (lớp phủ) thì đóng.
  await page.mouse.click(4, 4);
  await expect(viewer).toHaveCount(0);

  await page.getByRole('link', { name: /goi\.zip/ }).click();
  await expect(viewer).toHaveAttribute('data-kind', 'other');
  await expect(viewer.getByText('application/zip')).toBeVisible();
  await expect(viewer.getByRole('link', { name: 'Tải về' }).first()).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('link', { name: 'bản ghi chú' }).click();
  await expect(viewer.getByRole('heading', { name: 'Ghi chú thiết kế' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(viewer).toHaveCount(0);

  expect(page.url()).toBe(url);
  expect(opened).toBe(0);
});

test('PW-S6-6b popup ?issue= (hộp chồng hộp) và điện thoại 390px phủ kín màn hình @t1', async ({
  page,
  company,
  api,
}) => {
  const { issue } = await issueWithFiles(api, company.id, `PW-S6-6b ${uniqueToken()}`);
  await page.goto(company.path(`issues?issue=${issue.identifier}`));
  const popup = page.getByTestId('issue-popup');
  const viewer = viewerOf(page);
  await expect(popup).toBeVisible();
  await popup.getByRole('img', { name: 'agents.webp' }).click();
  await expect(viewer).toBeVisible();
  await expect(viewer).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(viewer.getByTestId('attachment-viewer-counter')).toHaveText('2 / 2');
  // Esc chỉ đóng hộp xem, popup yêu cầu còn nguyên; Esc lần nữa mới đóng popup.
  await page.keyboard.press('Escape');
  await expect(viewer).toHaveCount(0);
  await expect(popup).toBeVisible();
  await popup.getByRole('link', { name: 'bản ghi chú' }).click();
  await expect(viewer.getByRole('heading', { name: 'Ghi chú thiết kế' })).toBeVisible();
  // Bấm ra ngoài hộp xem chỉ đóng hộp xem.
  await page.mouse.click(4, 4);
  await expect(viewer).toHaveCount(0);
  await expect(popup).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(popup).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(company.path(`issues/${issue.identifier}`));
  await page.getByRole('img', { name: 'roadmap.webp' }).click();
  await expect(viewer).toBeVisible();
  const box = await viewer.boundingBox();
  expect(box).toMatchObject({ x: 0, y: 0, width: 390, height: 844 });
  await expect(viewer.getByRole('button', { name: 'Đóng' })).toBeInViewport();
  await viewer.getByRole('button', { name: 'Đóng' }).click();
  await expect(viewer).toHaveCount(0);
});

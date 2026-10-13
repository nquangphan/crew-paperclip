// S6.4/S6.5 luồng bình luận: ảnh trong bình luận (file đính kèm, ảnh base64 JPEG hiện và bấm mở hộp xem; SVG base64 bị
// chặn, chỉ hiện alt kèm ghi chú), mới nhất ở trên cùng, ô soạn nằm trên luồng (không dính) ở trang đầy đủ, popup
// `?issue=` và điện thoại; bình luận vừa gửi hiện trên cùng.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
import { type Api, assertWriteAllowed } from '../support/api';
import { createIssue, uniqueToken } from '../support/data';
import { expect, test } from '../support/fixtures';

const IMG_DIR = path.resolve(import.meta.dirname, '../../src/features/guide/img/vi');
const SVG_DATA = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>').toString('base64')}`;

async function shot(page: Page, info: TestInfo, name: string, target?: ReturnType<Page['locator']>) {
  const file = info.outputPath(`${name}.png`);
  await (target ?? page).screenshot({ path: file });
  await info.attach(name, { path: file, contentType: 'image/png' });
}

/** Ảnh JPEG thật vẽ bằng canvas của trình duyệt (như ảnh mockup agent nhúng base64 vào bình luận). */
async function jpegDataUrl(page: Page): Promise<string> {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 480;
    canvas.height = 270;
    const g = canvas.getContext('2d');
    if (!g) throw new Error('không có canvas 2d');
    const grad = g.createLinearGradient(0, 0, 480, 270);
    grad.addColorStop(0, '#2563eb');
    grad.addColorStop(1, '#14b8a6');
    g.fillStyle = grad;
    g.fillRect(0, 0, 480, 270);
    g.fillStyle = '#ffffff';
    g.font = 'bold 32px sans-serif';
    g.fillText('Mockup trang chủ', 40, 140);
    return canvas.toDataURL('image/jpeg', 0.85);
  });
}

async function upload(api: Api, companyId: string, issueId: string) {
  const p = `/api/companies/${companyId}/issues/${issueId}/attachments`;
  await assertWriteAllowed(api.ctx, 'POST', p, {});
  const res = await api.ctx.post(p, {
    multipart: {
      file: { name: 'roadmap.webp', mimeType: 'image/webp', buffer: readFileSync(`${IMG_DIR}/roadmap.webp`) },
    },
  });
  expect(res.status(), await res.text()).toBeLessThan(300);
  return (await res.json()) as { id: string };
}

/** Issue có bốn bình luận, đăng lần lượt (cũ đến mới): chữ, ảnh đính kèm, ảnh base64 JPEG, ảnh SVG base64. */
async function issueWithImageComments(page: Page, api: Api, companyId: string, title: string) {
  const issue = await createIssue(api, companyId, { title });
  const att = await upload(api, companyId, issue.id);
  const jpeg = await jpegDataUrl(page);
  const bodies = [
    'Bình luận đầu tiên (cũ nhất).',
    `Ảnh đính kèm:\n\n![roadmap](/api/attachments/${att.id}/content)`,
    `Mockup nhúng base64:\n\n![mockup trang chủ](${jpeg})`,
    `Logo SVG nhúng:\n\n![logo svg](${SVG_DATA})`,
  ];
  for (const body of bodies) await api.post(`/api/issues/${issue.id}/comments`, { body });
  return issue;
}

/** Cuộn để ô soạn ở đầu khung nhìn: ảnh chụp thấy ô soạn và các bình luận mới nhất ngay dưới. */
const scrollToComposer = (dock: ReturnType<Page['locator']>) =>
  dock.evaluate((el) => el.scrollIntoView({ block: 'start' }));

const comments = (scope: Page | ReturnType<Page['locator']>) => scope.getByTestId('comment');

test('PW-S6-4a trang đầy đủ: ảnh đính kèm, ảnh base64 JPEG, SVG bị chặn; mới nhất trên cùng, ô soạn ở trên @t1', async ({
  page,
  company,
  api,
}, info) => {
  await page.goto(company.path('issues'));
  const issue = await issueWithImageComments(page, api, company.id, `PW-S6-4a ${uniqueToken()}`);
  await page.goto(company.path(`issues/${issue.identifier}`));

  const list = comments(page);
  await expect(list).toHaveCount(4);
  await expect(list.nth(0)).toContainText('Logo SVG nhúng');
  await expect(list.nth(1)).toContainText('Mockup nhúng base64');
  await expect(list.nth(2)).toContainText('Ảnh đính kèm');
  await expect(list.nth(3)).toContainText('Bình luận đầu tiên');

  // Ô soạn ở trên luồng, nằm yên trong dòng chảy.
  const dock = page.locator('[data-slot="composer-dock"]');
  await expect(dock).toHaveCSS('position', 'static');
  const dockBox = await dock.boundingBox();
  const firstBox = await list.nth(0).boundingBox();
  expect(dockBox && firstBox && dockBox.y + dockBox.height <= firstBox.y).toBe(true);

  // SVG base64 bị chặn: không có ảnh, hiện alt và ghi chú.
  await expect(list.nth(0).locator('img')).toHaveCount(0);
  await expect(list.nth(0).locator('[data-slot="markdown-image-note"]')).toContainText('logo svg');
  await expect(list.nth(0).locator('[data-slot="markdown-image-note"]')).toContainText('ảnh bị chặn');
  await shot(page, info, 'comment-svg-blocked', list.nth(0));

  // Ảnh base64 JPEG hiện thật, vừa cột; bấm mở hộp xem.
  const jpeg = list.nth(1).getByRole('img', { name: 'mockup trang chủ' });
  await expect.poll(() => jpeg.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(480);
  await shot(page, info, 'comment-data-jpeg', list.nth(1));
  // Bấm vào phần ảnh đang thấy (góc trên), như người dùng; Playwright không phải cuộn khung thu gọn.
  await list
    .nth(1)
    .getByRole('button', { name: 'mockup trang chủ' })
    .click({ position: { x: 20, y: 20 } });
  const viewer = page.getByTestId('attachment-viewer');
  await expect(viewer).toHaveAttribute('data-kind', 'image');
  await expect(viewer.getByRole('heading', { name: 'mockup trang chủ' })).toBeVisible();
  await expect(viewer.getByRole('link', { name: 'Mở tab mới' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(viewer).toHaveCount(0);
  // Đóng hộp xem trả focus về ảnh mà không cuộn khung thu gọn của bình luận (dòng đầu vẫn thấy).
  await expect(list.nth(1).getByRole('button', { name: 'mockup trang chủ' })).toBeFocused();
  expect(
    await list
      .nth(1)
      .locator('[data-collapsed]')
      .evaluate((el) => el.scrollTop),
  ).toBe(0);

  // Ảnh file đính kèm hiện thật, rộng không quá cột, cao có trần; bấm mở hộp xem đúng file.
  const att = list.nth(2).getByRole('img', { name: 'roadmap' });
  await expect.poll(() => att.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
  const attBox = await att.boundingBox();
  const colBox = await list.nth(2).boundingBox();
  expect(attBox && colBox && attBox.width <= colBox.width && attBox.height <= 384).toBe(true);
  await shot(page, info, 'comment-attachment-image', list.nth(2));
  await list.nth(2).getByRole('button', { name: 'roadmap' }).click();
  await expect(viewer.getByRole('heading', { name: 'roadmap.webp' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(viewer).toHaveCount(0);

  await scrollToComposer(dock);
  await shot(page, info, 'order-desktop');

  // Gửi bình luận mới: hiện trên cùng.
  await page.getByRole('textbox', { name: 'Viết bình luận' }).fill('Bình luận vừa gửi');
  await page.getByRole('button', { name: 'Gửi bình luận' }).click();
  await expect(list).toHaveCount(5);
  await expect(list.nth(0)).toContainText('Bình luận vừa gửi');
  await scrollToComposer(dock);
  await shot(page, info, 'order-desktop-after-send');
});

test('PW-S6-4b popup ?issue= và điện thoại: ô soạn trên luồng mới nhất trước, không dính đáy @t1', async ({
  page,
  company,
  api,
}, info) => {
  await page.goto(company.path('issues'));
  const issue = await issueWithImageComments(page, api, company.id, `PW-S6-4b ${uniqueToken()}`);

  await page.goto(company.path(`issues?issue=${issue.identifier}`));
  const popup = page.getByTestId('issue-popup');
  const list = comments(popup);
  await expect(list).toHaveCount(4);
  await expect(list.nth(0)).toContainText('Logo SVG nhúng');
  const dock = popup.locator('[data-slot="composer-dock"]');
  await expect(dock).toHaveCSS('position', 'static');
  const dockBox = await dock.boundingBox();
  const firstBox = await list.nth(0).boundingBox();
  expect(dockBox && firstBox && dockBox.y + dockBox.height <= firstBox.y).toBe(true);
  await scrollToComposer(dock);
  await shot(page, info, 'order-popup');
  await page.keyboard.press('Escape');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(company.path(`issues/${issue.identifier}`));
  const phoneList = comments(page);
  await expect(phoneList).toHaveCount(4);
  const phoneDock = page.locator('[data-slot="composer-dock"]');
  await expect(phoneDock).toHaveCSS('position', 'static');
  const pd = await phoneDock.boundingBox();
  const pf = await phoneList.nth(0).boundingBox();
  expect(pd && pf && pd.y + pd.height <= pf.y).toBe(true);
  // Ảnh không tràn bề ngang điện thoại.
  const jpeg = phoneList.nth(1).getByRole('img', { name: 'mockup trang chủ' });
  await expect.poll(() => jpeg.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(480);
  const jb = await jpeg.boundingBox();
  expect(jb && jb.x + jb.width <= 390).toBe(true);
  await scrollToComposer(phoneDock);
  await shot(page, info, 'order-phone');
});

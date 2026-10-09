// S0 khung chung: sidebar, chọn company, ngôn ngữ, command palette, cập nhật trực tiếp.
// PW-S0-6 (đăng xuất) ở s0-signout.spec.ts vì phải đăng nhập lại bằng mật khẩu thật.
import { createIssue, createUnreadIssue, inboxIssues, uniqueToken } from '../support/data';
import { isProd } from '../support/env';
import { expect, test } from '../support/fixtures';

const NAV = (page: import('@playwright/test').Page) => page.getByRole('navigation', { name: 'Điều hướng chính' });

// Mục sidebar có route trong bản hiện tại: [tên, đường dưới /<prefix>/].
const PAGES: [string, string][] = [
  ['Tìm kiếm', 'search'],
  ['Tổng quan', 'dashboard'],
  ['Hộp thư', 'inbox'],
  ['Yêu cầu', 'issues'],
  ['Project', 'projects'],
  ['Agent', 'agents'],
  ['Skills', 'skills'],
  ['Máy', 'machines'],
  ['Docs', 'docs'],
  ['Cài đặt', 'settings'],
];

test('PW-S0-1 mỗi link sidebar mở đúng route, không 404; badge Hộp thư khớp API @t1', async ({
  page,
  company,
  api,
}) => {
  test.setTimeout(240_000);
  await page.goto(company.path('dashboard'));
  const nav = NAV(page);
  await expect(nav).toBeVisible();
  for (const [name, to] of PAGES) {
    await (name === 'Hộp thư'
      ? nav.getByRole('link', { name: /^Hộp thư/ })
      : nav.getByRole('link', { name, exact: true })
    ).click();
    await expect(page, name).toHaveURL(new RegExp(`/${company.issuePrefix}/${to}(\\?.*)?$`));
    await expect(page.getByText('Không tìm thấy trang'), name).toHaveCount(0);
    await expect(page.getByRole('heading').first(), name).toBeVisible();
  }
  // "Hướng dẫn" chỉ có link khi trang đã có (S17); có thì phải mở được.
  const guide = nav.getByRole('link', { name: 'Hướng dẫn' });
  if ((await guide.count()) > 0) {
    await guide.click();
    await expect(page).toHaveURL(new RegExp(`/${company.issuePrefix}/guide`));
    await expect(page.getByText('Không tìm thấy trang')).toHaveCount(0);
  }
  // "Yêu cầu mới" mở dialog tạo yêu cầu.
  await nav.getByRole('link', { name: 'Yêu cầu mới' }).click();
  await expect(page.getByRole('dialog', { name: 'Yêu cầu mới' })).toBeVisible();
  await page.keyboard.press('Escape');

  // Badge: sau khi có một mục chưa đọc, số trên "Hộp thư" khớp số API (mục cần xử lý của server + issue chưa đọc).
  await createUnreadIssue(api, company.id, `PW-S0-1 chưa đọc ${uniqueToken()}`);
  await page.goto(company.path('dashboard'));
  const badges = await api.get<{ inbox: number }>(`/api/companies/${company.id}/sidebar-badges`);
  const unread = (await inboxIssues(api, company.id)).filter((i) => i.isUnreadForMe).length;
  const expected = badges.inbox + unread;
  expect(expected).toBeGreaterThan(0);
  await expect(nav.getByRole('link', { name: /^Hộp thư/ })).toContainText(String(expected));
});

test('PW-S0-2 chỉ company có cấu hình Crew nằm trong danh sách chọn @t1', async ({ page, company, api }) => {
  const all = await api.get<{ id: string; name: string; issuePrefix: string }[]>('/api/companies');
  // Gọi từng company kèm companyId: lời gọi không gắn company bị host từ chối sau mỗi sự kiện agent.
  const crew = (await Promise.all(all.map((c) => api.crewData<{ id: string }[]>('crew.companies', c.id)))).flat();
  const allowed = new Set(crew.map((c) => c.id));
  // Stack cục bộ: thêm một company không có cấu hình Crew để chứng minh nó bị lọc. Prod không được tạo company.
  if (!isProd() && !all.some((c) => c.name === 'E2E không Crew')) {
    await api.post('/api/companies', { name: 'E2E không Crew' });
  }
  const names = (await api.get<{ id: string; name: string }[]>('/api/companies')).filter((c) => allowed.has(c.id));
  const excluded = (await api.get<{ id: string; name: string }[]>('/api/companies')).filter((c) => !allowed.has(c.id));

  await page.goto(company.path('dashboard'));
  await page.getByRole('button', { name: 'Chọn company' }).click();
  const options = page.getByRole('menuitemradio');
  await expect(options).toHaveCount(names.length);
  for (const c of names) await expect(options.filter({ hasText: c.name }).first()).toBeVisible();
  for (const c of excluded) await expect(options.filter({ hasText: c.name })).toHaveCount(0);
  if (!isProd()) expect(excluded.length).toBeGreaterThan(0);
});

test('PW-S0-3 đổi sang EN: mọi chuỗi đổi theo, tải lại vẫn giữ, không còn chuỗi VI gắn cứng @t1', async ({
  page,
  company,
}) => {
  await page.goto(company.path('dashboard'));
  await page.getByRole('group', { name: 'Ngôn ngữ' }).getByRole('button', { name: 'Tiếng Anh' }).click();
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('crew.lang'))).toBe('en');

  // Quét từng trang: chữ có dấu tiếng Việt chỉ được nằm trong dữ liệu (dòng danh sách, tài liệu), không trong khung UI.
  const diacritics = /[ăâđêôơưáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/i;
  const routes = ['dashboard', 'inbox', 'issues', 'search', 'projects', 'agents', 'skills', 'machines', 'settings'];
  for (const to of routes) {
    await page.goto(company.path(to));
    await expect(page.getByRole('heading').first()).toBeVisible();
    await page.waitForLoadState('networkidle');
    const text = await page.evaluate(() => {
      // Bỏ phần dữ liệu (dòng danh sách, thẻ máy, link tới issue/run, tên tài khoản) rồi đọc chữ còn lại của khung UI.
      for (const el of document.querySelectorAll(
        'tbody, [data-testid], [data-slot="machine-card"], a[href*="/issues/"], a[href*="/runs/"], a[href*="/projects/"], a[href*="/agents/"], [data-slot="issue-row"]',
      )) {
        el.remove();
      }
      return document.body.innerText;
    });
    const hit = text.split('\n').find((line) => diacritics.test(line));
    expect(hit, `${to}: còn chuỗi tiếng Việt "${hit}"`).toBeUndefined();
  }
  // Trả về VI cho các ca sau.
  await page.getByRole('group', { name: 'Language' }).getByRole('button', { name: 'Vietnamese' }).click();
  await expect(page.getByRole('navigation', { name: 'Điều hướng chính' })).toBeVisible();
});

test('PW-S0-4 Ctrl/Cmd+K: gõ mã issue mở đúng issue @t1', async ({ page, company, api }) => {
  const issue = await createIssue(api, company.id, { title: `PW-S0-4 ${uniqueToken()}` });
  await page.goto(company.path('dashboard'));
  await expect(NAV(page)).toBeVisible();
  await page.keyboard.press('ControlOrMeta+k');
  const palette = page.getByRole('dialog');
  await expect(palette).toBeVisible();
  await palette.getByRole('combobox').fill(issue.identifier);
  await palette
    .getByRole('option', { name: new RegExp(issue.identifier) })
    .first()
    .click();
  await expect(page).toHaveURL(new RegExp(`/${company.issuePrefix}/issues/${issue.identifier}$`));
  await expect(page.getByText(issue.title).first()).toBeVisible();
});

test('PW-S0-5 đổi trạng thái issue qua API: trang đang mở cập nhật trong 5 giây @t1', async ({
  page,
  company,
  api,
}) => {
  // Hộp thư đọc danh sách không cache; trang Yêu cầu dùng danh sách compact mà server cache tới 7 giây.
  const issue = await createIssue(api, company.id, { title: `PW-S0-5 ${uniqueToken()}`, status: 'todo' });
  const socket = page.waitForEvent('websocket', (ws) => ws.url().includes('/events/ws'));
  await page.goto(company.path('inbox?tab=all'));
  await socket;
  await page.waitForTimeout(500);
  const row = page.getByTestId('inbox-row').filter({ hasText: issue.identifier });
  await expect(row).toContainText('Cần làm');
  await api.patch(`/api/issues/${issue.id}`, { status: 'backlog' });
  await expect(row).toContainText('Tồn đọng', { timeout: 5_000 });
});

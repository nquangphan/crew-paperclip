// S3 Hộp thư: tab, đánh dấu đã đọc/chưa đọc/tất cả, lưu trữ, tìm/lọc/nhóm.
// Dữ liệu: issue chưa đọc = issue có bình luận của agent giữ chỗ (data.ts); issue chờ duyệt = stage approval của board
// (chỉ dựng được ở project theo dõi của stack T1, nên ca cần nó tự bỏ qua khi company không có project đó).
import {
  awaitingApprovalIssues,
  createIssue,
  createOwnerStageIssue,
  createUnreadIssues,
  type IssueLite,
  inboxIssues,
  uniqueToken,
} from '../support/data';
import { expect, test } from '../support/fixtures';

const rowOf = (page: import('@playwright/test').Page, identifier: string) =>
  page.getByTestId('inbox-row').filter({ hasText: identifier });

const tabButton = (page: import('@playwright/test').Page, name: RegExp) =>
  page.getByRole('navigation', { name: 'Nhóm trong Hộp thư' }).getByRole('button', { name });

test('PW-S3-1 tab "Chờ tôi duyệt": issue ở stage owner có mặt, duyệt xong thì biến mất @t1', async ({
  page,
  company,
  api,
}) => {
  const issue = await createOwnerStageIssue(api, company.id, `PW-S3-1 ${uniqueToken()}`);
  test.skip(issue === null, 'Company không có project theo dõi để dựng issue ở stage owner');
  if (!issue) return;
  const plain = await createIssue(api, company.id, { title: `PW-S3-1 thường ${uniqueToken()}` });

  await page.goto(company.path('inbox'));
  const awaiting = tabButton(page, /^Chờ tôi duyệt/);
  await expect(awaiting).toHaveAttribute('aria-pressed', 'true');
  const row = rowOf(page, issue.identifier);
  await expect(row).toBeVisible();
  await expect(row).toContainText('Chờ bạn duyệt');
  await expect(rowOf(page, plain.identifier)).toHaveCount(0);

  // Số trong tab = số issue đang chờ board theo API.
  const expected = (await awaitingApprovalIssues(api, company.id)).length;
  await expect(awaiting).toHaveText(new RegExp(`\\(${expected}\\)`));

  // Board là participant của stage approval nên duyệt bằng chính tài khoản board (không phải ghi đè).
  await api.patch(`/api/issues/${issue.id}`, { status: 'done', comment: 'Duyệt ca PW-S3-1.' });
  await page.reload();
  await expect(rowOf(page, issue.identifier)).toHaveCount(0);
  const after = await api.get<IssueLite>(`/api/issues/${issue.id}`);
  expect(after.status).toBe('done');
});

test('PW-S3-2 các tab Của tôi / Chưa đọc / Đang kẹt / Tất cả lọc đúng theo API @t1', async ({ page, company, api }) => {
  test.setTimeout(240_000);
  const [unread] = await createUnreadIssues(api, company.id, [`PW-S3-2 chưa đọc ${uniqueToken()}`]);
  const stuck = await createIssue(api, company.id, { title: `PW-S3-2 kẹt ${uniqueToken()}`, status: 'blocked' });
  const plain = await createIssue(api, company.id, { title: `PW-S3-2 thường ${uniqueToken()}` });

  const list = await inboxIssues(api, company.id);
  const byId = new Map(list.map((i) => [i.id, i]));
  expect(byId.get(unread.id)?.isUnreadForMe).toBe(true);

  await page.goto(company.path('inbox'));
  // Tất cả: đủ mọi issue chưa lưu trữ.
  await tabButton(page, /^Tất cả/).click();
  await expect(tabButton(page, /^Tất cả/)).toHaveText(new RegExp(`\\(${list.length}\\)`));
  for (const i of [unread, stuck, plain]) await expect(rowOf(page, i.identifier)).toBeVisible();

  // Chưa đọc: đúng tập isUnreadForMe.
  await tabButton(page, /^Chưa đọc/).click();
  const unreadIds = list.filter((i) => i.isUnreadForMe).map((i) => i.identifier);
  await expect(page.getByTestId('inbox-row')).toHaveCount(unreadIds.length);
  await expect(rowOf(page, unread.identifier)).toBeVisible();
  await expect(rowOf(page, plain.identifier)).toHaveCount(0);

  // Đang kẹt: issue blocked có, issue thường không.
  await tabButton(page, /^Đang kẹt/).click();
  await expect(rowOf(page, stuck.identifier)).toBeVisible();
  await expect(rowOf(page, plain.identifier)).toHaveCount(0);

  // Của tôi: issue board tạo hoặc đã chạm.
  await tabButton(page, /^Của tôi/).click();
  await expect(rowOf(page, plain.identifier)).toBeVisible();
});

test('PW-S3-3 đánh dấu đã đọc / chưa đọc / tất cả đã đọc: API đổi, badge Hộp thư đổi theo @t1', async ({
  page,
  company,
  api,
}) => {
  test.setTimeout(240_000);
  const [a, b] = await createUnreadIssues(api, company.id, [
    `PW-S3-3 a ${uniqueToken()}`,
    `PW-S3-3 b ${uniqueToken()}`,
  ]);
  const isUnread = async (id: string) => (await api.get<IssueLite>(`/api/issues/${id}`)).isUnreadForMe === true;
  const inboxBadge = page.getByRole('navigation', { name: 'Điều hướng chính' }).getByRole('link', { name: /^Hộp thư/ });
  const badgeNumber = async () => Number(((await inboxBadge.innerText()).match(/\d+/) ?? ['0'])[0]);

  await page.goto(company.path('inbox'));
  await tabButton(page, /^Chưa đọc/).click();
  await expect(rowOf(page, a.identifier)).toHaveAttribute('data-unread', 'true');
  const before = await badgeNumber();

  // Đã đọc một mục.
  await rowOf(page, a.identifier).getByRole('button', { name: 'Đánh dấu đã đọc' }).click();
  await expect.poll(() => isUnread(a.id)).toBe(false);
  await expect.poll(badgeNumber, { message: 'badge Hộp thư phải giảm sau khi đánh dấu đã đọc' }).toBeLessThan(before);

  // Chưa đọc lại, bằng nút ở tab Tất cả.
  await tabButton(page, /^Tất cả/).click();
  await rowOf(page, a.identifier).getByRole('button', { name: 'Đánh dấu chưa đọc' }).click();
  await expect.poll(() => isUnread(a.id)).toBe(true);

  // Tất cả đã đọc: mọi mục chưa đọc của tab đang xem.
  await tabButton(page, /^Chưa đọc/).click();
  await page.getByRole('button', { name: 'Đánh dấu tất cả đã đọc' }).click();
  await expect.poll(() => isUnread(a.id)).toBe(false);
  await expect.poll(() => isUnread(b.id)).toBe(false);
  expect((await inboxIssues(api, company.id)).filter((i) => i.isUnreadForMe)).toEqual([]);
  await expect.poll(badgeNumber).toBe(0);
});

test('PW-S3-4 lưu trữ / bỏ lưu trữ: mục rời Hộp thư, issue vẫn còn @t1', async ({ page, company, api }) => {
  const issue = await createIssue(api, company.id, { title: `PW-S3-4 ${uniqueToken()}` });
  await page.goto(company.path('inbox'));
  await tabButton(page, /^Tất cả/).click();
  await rowOf(page, issue.identifier).getByRole('button', { name: 'Lưu trữ' }).click();
  await expect(rowOf(page, issue.identifier)).toHaveCount(0);
  await expect(page.getByText(`Đã lưu trữ ${issue.identifier}.`)).toBeVisible();

  // Issue không bị xóa; chỉ rời danh sách Hộp thư của board.
  const still = await api.get<IssueLite>(`/api/issues/${issue.id}`);
  expect(still.id).toBe(issue.id);
  expect((await inboxIssues(api, company.id)).some((i) => i.id === issue.id)).toBe(false);

  await page.getByRole('button', { name: 'Bỏ lưu trữ' }).click();
  await expect(rowOf(page, issue.identifier)).toBeVisible();
  expect((await inboxIssues(api, company.id)).some((i) => i.id === issue.id)).toBe(true);
});

test('PW-S3-5 tìm theo mã/tiêu đề, lọc trạng thái, nhóm theo trạng thái @t1', async ({ page, company, api }) => {
  const token = uniqueToken('s35');
  const todo = await createIssue(api, company.id, { title: `PW-S3-5 ${token} todo` });
  const blocked = await createIssue(api, company.id, { title: `PW-S3-5 ${token} blocked`, status: 'blocked' });
  await page.goto(company.path('inbox'));
  await tabButton(page, /^Tất cả/).click();

  await page.getByPlaceholder('Tìm theo mã hoặc tiêu đề').fill(token);
  await expect(page.getByTestId('inbox-row')).toHaveCount(2);
  await page.getByPlaceholder('Tìm theo mã hoặc tiêu đề').fill(todo.identifier);
  await expect(page.getByTestId('inbox-row')).toHaveCount(1);
  await expect(rowOf(page, todo.identifier)).toBeVisible();

  await page.getByPlaceholder('Tìm theo mã hoặc tiêu đề').fill(token);
  await page.getByRole('combobox', { name: 'Trạng thái' }).click();
  await page.getByRole('option', { name: 'Bị chặn' }).click();
  await expect(page.getByTestId('inbox-row')).toHaveCount(1);
  await expect(rowOf(page, blocked.identifier)).toBeVisible();

  await page.getByRole('combobox', { name: 'Trạng thái' }).click();
  await page.getByRole('option', { name: 'Mọi trạng thái' }).click();
  await page.getByRole('combobox', { name: 'Nhóm' }).click();
  await page.getByRole('option', { name: 'Theo trạng thái' }).click();
  const headings = page.getByTestId('group-heading');
  await expect(headings.filter({ hasText: 'Cần làm' })).toHaveCount(1);
  await expect(headings.filter({ hasText: 'Bị chặn' })).toHaveCount(1);
});

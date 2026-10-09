// Thao tác cổng khi trạng thái đã đổi ở nơi khác: owner mở hộp Duyệt, lúc đó stage bị đổi ở tab khác; bấm Duyệt thì
// trang báo trạng thái đã đổi và KHÔNG gửi PATCH nào (gửi `done` bằng quyền board lúc đó là vượt cổng).
import { createOwnerStageIssue, type IssueLite, uniqueToken } from '../support/data';
import { expect, test } from '../support/fixtures';

test('PW-S6-STALE đổi stage ở tab khác rồi bấm Duyệt: báo trạng thái đã đổi, không gửi PATCH @t1', async ({
  page,
  company,
  api,
}) => {
  const issue = await createOwnerStageIssue(api, company.id, `PW-S6-STALE ${uniqueToken()}`);
  test.skip(issue === null, 'Company không có project theo dõi để dựng issue ở stage owner');
  if (!issue) return;

  await page.goto(company.path(`issues/${issue.identifier}`));
  await page.getByRole('button', { name: 'Duyệt', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  // "Tab khác": yêu cầu sửa qua API làm stage rời owner (việc về người làm), trong khi hộp Duyệt vẫn mở.
  await api.patch(`/api/issues/${issue.id}`, { status: 'in_progress', comment: 'Đổi stage ở tab khác (ca e2e).' });
  const moved = await api.get<IssueLite>(`/api/issues/${issue.id}`);
  expect(moved.status).not.toBe('in_review');

  const patches: string[] = [];
  page.on('request', (req) => {
    if (req.method() !== 'GET' && new URL(req.url()).pathname.startsWith('/api/issues/')) patches.push(req.method());
  });
  await dialog.getByRole('button', { name: 'Duyệt', exact: true }).click();

  await expect(page.getByText('Trạng thái yêu cầu đã đổi', { exact: false })).toBeVisible();
  expect(patches).toEqual([]);
  const after = await api.get<IssueLite>(`/api/issues/${issue.id}`);
  expect(after.status).not.toBe('done');
});

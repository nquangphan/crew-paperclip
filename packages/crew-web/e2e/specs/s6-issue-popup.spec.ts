// S6 chi tiết yêu cầu dạng popup: `?issue=<mã>` trên trang đang xem mở popup chi tiết (bố cục IssueDetail của
// Paperclip, đủ khe Crew); đóng bằng Esc/nút Đóng/Back thì về đúng trang dưới; Cmd/Ctrl+click mở trang đầy đủ ở
// tab mới; "Mở toàn trang" sang trang đầy đủ.
import { createIssue, uniqueToken, waitInCompactList } from '../support/data';
import { expect, test } from '../support/fixtures';

test('PW-S6-POPUP-1 bấm dòng Yêu cầu mở popup trên trang, Esc và Back đều đóng, trang dưới giữ nguyên @t1', async ({
  page,
  company,
  api,
}) => {
  const issue = await createIssue(api, company.id, { title: `PW-S6-POPUP-1 ${uniqueToken()}` });
  await waitInCompactList(api, company.id, [issue.id]);
  await page.goto(company.path('issues'));
  const row = page.getByTestId('issue-row').filter({ has: page.getByText(issue.identifier, { exact: true }) });
  const link = row.getByRole('link', { name: issue.title });
  await expect(link).toHaveAttribute('href', `/${company.issuePrefix}/issues/${issue.identifier}`);

  await link.click();
  const popup = page.getByTestId('issue-popup');
  await expect(popup).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/${company.issuePrefix}/issues\\?issue=${issue.identifier}$`));
  await expect(popup.getByTestId('issue-detail-header')).toContainText(issue.title);
  await expect(popup.getByTestId('properties-panel')).toBeVisible();
  await expect(popup.getByRole('button', { name: 'Gửi bình luận' })).toBeVisible();
  await expect(page.getByTestId('issue-row').first()).toBeAttached();

  await page.keyboard.press('Escape');
  await expect(popup).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/${company.issuePrefix}/issues$`));

  await link.click();
  await expect(popup).toBeVisible();
  await page.goBack();
  await expect(popup).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/${company.issuePrefix}/issues$`));
});

test('PW-S6-POPUP-2 Cmd/Ctrl+click mở trang đầy đủ ở tab mới; link trực tiếp ?issue= và Mở toàn trang @t1', async ({
  page,
  context,
  company,
  api,
}) => {
  const issue = await createIssue(api, company.id, { title: `PW-S6-POPUP-2 ${uniqueToken()}` });
  await waitInCompactList(api, company.id, [issue.id]);
  await page.goto(company.path('issues'));
  const row = page.getByTestId('issue-row').filter({ has: page.getByText(issue.identifier, { exact: true }) });
  const [tab] = await Promise.all([
    context.waitForEvent('page'),
    row.getByRole('link', { name: issue.title }).click({ modifiers: ['ControlOrMeta'] }),
  ]);
  await expect(tab).toHaveURL(new RegExp(`/${company.issuePrefix}/issues/${issue.identifier}$`));
  await expect(tab.getByTestId('properties-panel')).toBeVisible();
  await expect(tab.getByTestId('issue-popup')).toHaveCount(0);
  await tab.close();
  await expect(page.getByTestId('issue-popup')).toHaveCount(0);

  await page.goto(company.path(`inbox?issue=${issue.identifier}`));
  const popup = page.getByTestId('issue-popup');
  await expect(popup).toBeVisible();
  await popup.getByRole('link', { name: 'Mở toàn trang' }).click();
  await expect(page).toHaveURL(new RegExp(`/${company.issuePrefix}/issues/${issue.identifier}$`));
  await expect(popup).toHaveCount(0);
  await expect(page.getByTestId('issue-detail-header')).toContainText(issue.title);
});

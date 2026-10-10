// S19 Tìm kiếm: GET /companies/:c/search → issue, bình luận, tài liệu; bấm kết quả mở popup đúng issue (`?issue=`)
// ngay trên trang Tìm kiếm, giữ neo bình luận/tài liệu.
import { createIssue, uniqueToken } from '../support/data';
import { expect, test } from '../support/fixtures';

interface SearchResponse {
  results: { id: string; type: string; href: string; issue?: { identifier: string } }[];
}

test('PW-S19-1 tìm theo tiêu đề, bình luận, tài liệu: kết quả khớp API và mở đúng issue @t1', async ({
  page,
  company,
  api,
}) => {
  const token = uniqueToken('zq');
  const issue = await createIssue(api, company.id, {
    title: `PW-S19 ${token}`,
    description: `Mô tả ${token}mota`,
  });
  await api.post(`/api/issues/${issue.id}/comments`, { body: `Bình luận ${token}cmt` });
  await api.put(`/api/issues/${issue.id}/documents/plan`, {
    title: 'Tài liệu thử',
    format: 'markdown',
    body: `Nội dung ${token}doc`,
  });

  const search = async (q: string) => {
    await page.goto(company.path(`search?q=${q}`));
    const fromApi = await api.get<SearchResponse>(`/api/companies/${company.id}/search?q=${q}&limit=30`);
    await expect(page.getByTestId('search-result')).toHaveCount(fromApi.results.length);
    return fromApi.results;
  };

  // Theo tiêu đề: mở đúng issue.
  const byTitle = await search(token);
  expect(byTitle.some((r) => r.issue?.identifier === issue.identifier)).toBe(true);
  await page
    .getByTestId('search-result')
    .getByRole('link', { name: new RegExp(issue.identifier) })
    .first()
    .click();
  await expect(page).toHaveURL(new RegExp(`/${company.issuePrefix}/search\\?.*issue=${issue.identifier}`));
  await expect(page.getByTestId('issue-popup').getByText(`PW-S19 ${token}`).first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('issue-popup')).toHaveCount(0);

  // Theo bình luận: kết quả có neo bình luận.
  const byComment = await search(`${token}cmt`);
  expect(byComment[0].href).toContain('#comment-');
  await page.getByTestId('search-result').getByRole('link').first().click();
  await expect(page).toHaveURL(new RegExp(`issue=${issue.identifier}#comment-`));
  await page.keyboard.press('Escape');

  // Theo tài liệu: kết quả có neo tài liệu.
  const byDoc = await search(`${token}doc`);
  expect(byDoc[0].href).toContain('#document-plan');
  await page.getByTestId('search-result').getByRole('link').first().click();
  await expect(page).toHaveURL(new RegExp(`issue=${issue.identifier}#document-plan`));
  await page.keyboard.press('Escape');

  // Không có kết quả: thông báo rõ.
  await page.goto(company.path(`search?q=khong-co-${token}`));
  await expect(page.getByText(`Không có kết quả cho "khong-co-${token}"`)).toBeVisible();
});

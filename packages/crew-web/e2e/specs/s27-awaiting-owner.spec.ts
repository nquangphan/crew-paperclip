// S27 "Chờ owner trả lời" trên danh sách yêu cầu: issue Đang làm có thẻ câu hỏi chờ người trả lời (danh sách lõi không
// báo vì issue không ở in_review) hiện biểu tượng và nhãn "Chờ owner trả lời"; trả lời thẻ xong thì về Đang làm. Ca dựng
// bằng REST: tạo issue Đang làm giao cho chính owner (Đang làm cần người nhận; giao người thì không đánh thức agent
// nào), tạo thẻ `ask_user_questions` bằng board (không gửi cho agent), trả lời bằng route lõi. Không có run nào chạy.
import type { Page } from '@playwright/test';
import { createIssue, meId, uniqueToken, waitInCompactList } from '../support/data';
import { expect, test } from '../support/fixtures';

const issueRow = (page: Page, id: string) => page.locator(`[data-testid="issue-row"][data-issue-id="${id}"]`);

test('PW-S27-1 danh sách: issue Đang làm có thẻ chờ owner hiện "Chờ owner trả lời", trả lời xong thì hết @t1', async ({
  page,
  company,
  api,
}) => {
  const working = { status: 'in_progress', assigneeUserId: await meId(api) };
  const issue = await createIssue(api, company.id, { title: `PW-S27-1 chờ owner ${uniqueToken()}`, ...working });
  const other = await createIssue(api, company.id, { title: `PW-S27-1 không thẻ ${uniqueToken()}`, ...working });
  const card = await api.post<{ id: string; status: string }>(`/api/issues/${issue.id}/interactions`, {
    kind: 'ask_user_questions',
    title: 'PW-S27-1 cần owner chốt',
    payload: {
      version: 1,
      questions: [
        {
          id: 'db',
          prompt: 'Dùng cơ sở dữ liệu nào?',
          selectionMode: 'single',
          options: [
            { id: 'pg', label: 'Postgres' },
            { id: 'sqlite', label: 'SQLite' },
          ],
        },
      ],
    },
  });
  expect(card.status).toBe('pending');
  await waitInCompactList(api, company.id, [issue.id, other.id]);

  await page.goto(company.path('issues'));
  const row = issueRow(page, issue.id);
  await expect(row.locator('[data-slot="status-glyph"]').first()).toHaveAttribute('data-status', 'awaiting_owner');
  await expect(row.getByTestId('awaiting-owner-badge')).toHaveText('Chờ owner trả lời');
  // Issue cùng trạng thái lõi mà không có thẻ chờ: giữ Đang làm.
  await expect(issueRow(page, other.id).locator('[data-slot="status-glyph"]').first()).toHaveAttribute(
    'data-status',
    'in_progress',
  );
  await expect(issueRow(page, other.id).getByTestId('awaiting-owner-badge')).toHaveCount(0);

  await api.post(`/api/issues/${issue.id}/interactions/${card.id}/respond`, {
    answers: [{ questionId: 'db', optionIds: ['pg'] }],
  });
  await page.reload();
  await expect(row.locator('[data-slot="status-glyph"]').first()).toHaveAttribute('data-status', 'in_progress');
  await expect(row.getByTestId('awaiting-owner-badge')).toHaveCount(0);
});

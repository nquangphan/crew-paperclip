// S26 Nhãn máy trên danh sách yêu cầu và Bảng (TPS-750): cây đã ghim máy hiện đúng tên máy ở hàng gốc, hàng con và
// thẻ Bảng; lọc theo máy chỉ còn cây đó. Ca dựng cây bằng REST (gốc + con), ghim bằng route ghim máy của owner
// (`PUT …/issues/:id/machine`, đúng đường UI Yêu cầu mới gọi) rồi kiểm UI. Cần ít nhất hai máy đã ghép trong company.
// Issue không có project nên route ghim không xếp việc dựng project lên máy; không có run nào chạy.
import type { Page } from '@playwright/test';
import type { Api } from '../support/api';
import { createIssue, uniqueToken, waitInCompactList } from '../support/data';
import { expect, test } from '../support/fixtures';

interface Machine {
  machineId: string;
  hostname: string;
}
interface Tree {
  root: { id: string; identifier: string };
  child: { id: string; identifier: string };
}

/** Cùng luật tên gọn của UI: hostname bỏ hậu tố miền. */
const shortName = (hostname: string) => hostname.split('.')[0] || hostname;

const issueRow = (page: Page, id: string) => page.locator(`[data-testid="issue-row"][data-issue-id="${id}"]`);
const rowMachine = (page: Page, id: string) =>
  issueRow(page, id).locator('[data-slot="task-row-trailing"] [data-slot="machine-label"]');
const card = (page: Page, id: string) => page.locator(`[data-testid="kanban-card"][data-issue-id="${id}"]`);
const cardMachine = (page: Page, id: string) => card(page, id).locator('[data-slot="kanban-card-machine"]');

/** Hai máy đã ghép, theo thứ tự ổn định; ít hơn hai thì ca tự bỏ qua. */
async function pairedMachines(api: Api, companyId: string): Promise<[Machine, Machine]> {
  const projects = await api.get<{ id: string; archivedAt?: string | null }[]>(`/api/companies/${companyId}/projects`);
  const projectId = process.env.CREW_E2E_BASE_PROJECT_ID || projects.find((p) => !p.archivedAt)?.id;
  test.skip(!projectId, 'Company e2e chưa có project để hỏi danh sách máy');
  const { items } = await api.get<{ items: Machine[] }>(
    `/api/crew/companies/${companyId}/machines?projectId=${projectId}`,
  );
  const sorted = [...items].sort((a, b) => a.machineId.localeCompare(b.machineId));
  test.skip(sorted.length < 2, 'Cần ít nhất hai máy đã ghép trong company e2e');
  return [sorted[0], sorted[1]];
}

async function pinnedTree(api: Api, companyId: string, label: string, machine: Machine): Promise<Tree> {
  const root = await createIssue(api, companyId, { title: `${label} gốc ${uniqueToken()}` });
  const child = await createIssue(api, companyId, { title: `${label} con ${uniqueToken()}`, parentId: root.id });
  await waitInCompactList(api, companyId, [root.id, child.id]);
  const pinned = await api.put<{ pin: { machineId: string } | null }>(
    `/api/crew/companies/${companyId}/issues/${root.id}/machine`,
    { machineId: machine.machineId },
  );
  expect(pinned.pin?.machineId).toBe(machine.machineId);
  return { root, child };
}

test('PW-S26-1 danh sách: hàng gốc và hàng con của cây đã ghim hiện đúng tên máy @t1', async ({
  page,
  company,
  api,
}) => {
  const [mini] = await pairedMachines(api, company.id);
  const tree = await pinnedTree(api, company.id, 'PW-S26-1', mini);
  const loose = await createIssue(api, company.id, { title: `PW-S26-1 chưa ghim ${uniqueToken()}` });
  await waitInCompactList(api, company.id, [loose.id]);

  await page.goto(company.path('issues'));
  await expect(issueRow(page, tree.root.id)).toHaveAttribute('data-depth', '0');
  await expect(issueRow(page, tree.child.id)).toHaveAttribute('data-depth', '1');
  // Gốc ghim, con kế thừa máy của gốc; tên là hostname bỏ hậu tố miền, không bao giờ là id thô.
  for (const id of [tree.root.id, tree.child.id]) {
    await expect(rowMachine(page, id)).toContainText(shortName(mini.hostname));
    await expect(rowMachine(page, id)).not.toContainText(mini.machineId);
  }
  await expect(rowMachine(page, loose.id)).toHaveAttribute('data-state', 'unpinned');
  await expect(rowMachine(page, loose.id)).toContainText('Chưa ghim');
});

test('PW-S26-2 Bảng: thẻ của cây đã ghim hiện đúng tên máy @t1', async ({ page, company, api }) => {
  const [, book] = await pairedMachines(api, company.id);
  const tree = await pinnedTree(api, company.id, 'PW-S26-2', book);
  const loose = await createIssue(api, company.id, { title: `PW-S26-2 chưa ghim ${uniqueToken()}` });
  await waitInCompactList(api, company.id, [loose.id]);

  await page.goto(`${company.path('issues')}?view=board`);
  for (const id of [tree.root.id, tree.child.id]) {
    await expect(card(page, id)).toBeVisible();
    await expect(cardMachine(page, id)).toContainText(shortName(book.hostname));
    await expect(cardMachine(page, id)).not.toContainText(book.machineId);
  }
  // Cây chưa ghim: thẻ không có dòng máy.
  await expect(card(page, loose.id)).toBeVisible();
  await expect(cardMachine(page, loose.id)).toHaveCount(0);
});

test('PW-S26-3 lọc theo máy (URL và popover Lọc) chỉ còn cây chạy trên máy đó @t1', async ({ page, company, api }) => {
  const [mini, book] = await pairedMachines(api, company.id);
  const onMini = await pinnedTree(api, company.id, 'PW-S26-3 mini', mini);
  const onBook = await pinnedTree(api, company.id, 'PW-S26-3 book', book);

  await page.goto(`${company.path('issues')}?machine=${mini.machineId}`);
  await expect(issueRow(page, onMini.root.id)).toBeVisible();
  await expect(issueRow(page, onMini.child.id)).toBeVisible();
  await expect(issueRow(page, onBook.root.id)).toHaveCount(0);
  await expect(issueRow(page, onBook.child.id)).toHaveCount(0);
  // Mọi hàng còn lại đều chạy trên máy được lọc.
  const labels = await page
    .locator('[data-testid="issue-row"] [data-slot="task-row-trailing"] [data-slot="machine-label"]')
    .allTextContents();
  expect(labels.length).toBeGreaterThanOrEqual(2);
  for (const text of labels) expect(text).toContain(shortName(mini.hostname));

  // Chọn máy còn lại trong popover Lọc: URL đổi, danh sách chuyển sang cây của máy đó.
  await page.getByRole('button', { name: /^Lọc/ }).click();
  // Tên exact theo luật trùng tên của UI: hai máy cùng tên gọn thì máy có `machineId` sau mang "#2".
  const bookName =
    shortName(book.hostname) === shortName(mini.hostname) && book.machineId > mini.machineId
      ? `${shortName(book.hostname)} #2`
      : shortName(book.hostname);
  await page.getByRole('checkbox', { name: bookName, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`machine=${book.machineId}`));
  await expect(issueRow(page, onBook.root.id)).toBeVisible();
  await expect(issueRow(page, onBook.child.id)).toBeVisible();
  await expect(issueRow(page, onMini.root.id)).toHaveCount(0);
});

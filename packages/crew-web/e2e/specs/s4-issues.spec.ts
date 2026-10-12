// S4 Danh sách yêu cầu (bố cục IssuesList Paperclip): lồng issue con, tìm, popover Lọc, menu Sắp xếp/Nhóm/Cột, cột
// Crew, nút "Yêu cầu mới".
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  archiveProject,
  createIssue,
  createProject,
  ensurePlaceholderAgent,
  researchLabelId,
  uniqueToken,
  waitInCompactList,
} from '../support/data';
import { expect, test } from '../support/fixtures';

const vi = JSON.parse(readFileSync(path.resolve(import.meta.dirname, '../../src/i18n/locales/vi.json'), 'utf8')) as {
  stage: Record<string, string>;
};

interface CompactIssue {
  id: string;
  identifier: string;
  parentId?: string | null;
}
interface Root {
  id: string;
  identifier: string;
  kind: string;
  stage: string | null;
  doneChildren: number;
  totalChildren: number;
}

const rows = (page: import('@playwright/test').Page) => page.getByTestId('issue-row');
const rowOf = (page: import('@playwright/test').Page, identifier: string) =>
  rows(page).filter({ has: page.getByText(identifier, { exact: true }) });

test('PW-S4-1 số dòng khớp API; issue con nằm dưới đúng gốc, mở/thu được @t1', async ({ page, company, api }) => {
  const parent = await createIssue(api, company.id, { title: `PW-S4-1 gốc ${uniqueToken()}` });
  const child = await createIssue(api, company.id, { title: `PW-S4-1 con ${uniqueToken()}`, parentId: parent.id });
  await waitInCompactList(api, company.id, [parent.id, child.id]);
  const listed = await api.get<CompactIssue[]>(`/api/companies/${company.id}/issues?view=compact&limit=1000`);

  await page.goto(company.path('issues'));
  await expect(rows(page)).toHaveCount(listed.length);
  const parentRow = rowOf(page, parent.identifier);
  const childRow = rowOf(page, child.identifier);
  await expect(parentRow).toHaveAttribute('data-depth', '0');
  await expect(childRow).toHaveAttribute('data-depth', '1');
  // Con nằm ngay dưới gốc của nó.
  const order = await rows(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-issue-id')));
  expect(order.indexOf(child.id)).toBe(order.indexOf(parent.id) + 1);

  await parentRow.getByRole('button', { name: 'Thu yêu cầu con' }).click();
  await expect(childRow).toHaveCount(0);
  await parentRow.getByRole('button', { name: 'Mở yêu cầu con' }).click();
  await expect(childRow).toBeVisible();
});

test('PW-S4-2 tìm, lọc (trạng thái, project, người làm, loại), sắp xếp, nhóm, cột @t1', async ({
  page,
  company,
  api,
}) => {
  const token = uniqueToken('s42');
  const project = await createProject(api, company.id, `PW-S4-2 ${token}`);
  try {
    const worker = await ensurePlaceholderAgent(api, company.id, 'crew-e2e-worker', { wake: false });
    const label = await researchLabelId(api, company.id);
    const a = await createIssue(api, company.id, {
      title: `PW-S4-2 ${token} bbb`,
      projectId: project.id,
      assigneeAgentId: worker.id,
      status: 'todo',
    });
    const b = await createIssue(api, company.id, {
      title: `PW-S4-2 ${token} aaa`,
      projectId: project.id,
      status: 'backlog',
    });
    const research = label
      ? await createIssue(api, company.id, {
          title: `PW-S4-2 ${token} nghiên cứu`,
          projectId: project.id,
          status: 'backlog',
          labelIds: [label],
        })
      : null;

    await waitInCompactList(api, company.id, [a.id, b.id, ...(research ? [research.id] : [])]);

    // Tìm theo từ khóa (ghi vào URL ?q=).
    await page.goto(company.path('issues'));
    await page.getByPlaceholder('Tìm yêu cầu').fill(token);
    await expect(page).toHaveURL(new RegExp(`q=${token}`));
    await expect(rows(page)).toHaveCount(research ? 3 : 2);

    // Bộ lọc (popover Lọc như Paperclip): mỗi mục chọn một giá trị, bấm lại thì bỏ.
    const filters = async () => {
      await page.getByRole('button', { name: /^Lọc/ }).click();
      return page.getByRole('dialog', { name: 'Bộ lọc' });
    };
    const closeFilters = () => page.keyboard.press('Escape');

    // Trạng thái.
    let panel = await filters();
    await panel.getByRole('checkbox', { name: 'Cần làm' }).click();
    await expect(rows(page)).toHaveCount(1);
    await expect(rowOf(page, a.identifier)).toBeVisible();
    await panel.getByRole('checkbox', { name: 'Cần làm' }).click();
    await expect(page).not.toHaveURL(/status=/);

    // Project.
    await panel.getByRole('checkbox', { name: project.name }).click();
    await expect(rows(page)).toHaveCount(research ? 3 : 2);

    // Người làm.
    await panel.getByRole('checkbox', { name: 'crew-e2e-worker' }).click();
    await expect(rows(page)).toHaveCount(1);
    await panel.getByRole('checkbox', { name: 'crew-e2e-worker' }).click();

    // Loại: Nghiên cứu / Code-Bug.
    if (research) {
      await panel.getByRole('checkbox', { name: 'Nghiên cứu' }).click();
      await expect(rows(page)).toHaveCount(1);
      await expect(rowOf(page, research.identifier)).toBeVisible();
      await panel.getByRole('checkbox', { name: 'Code / Bug' }).click();
      await expect(rowOf(page, research.identifier)).toHaveCount(0);
      await expect(rowOf(page, a.identifier)).toBeVisible();
      await panel.getByRole('checkbox', { name: 'Code / Bug' }).click();
    }
    await closeFilters();

    // Sắp xếp theo tiêu đề: aaa trước bbb.
    await page.getByRole('button', { name: 'Sắp xếp' }).click();
    await page.getByRole('menuitemradio', { name: 'Tiêu đề' }).click();
    await expect(page).toHaveURL(/sort=title/);
    const order = await rows(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-issue-id')));
    expect(order.indexOf(b.id)).toBeLessThan(order.indexOf(a.id));

    // Nhóm theo trạng thái: tiêu đề nhóm viết hoa, thu gọn được.
    await page.getByRole('button', { name: 'Nhóm' }).click();
    await page.getByRole('menuitemradio', { name: 'Trạng thái' }).click();
    await expect(page.getByTestId('group-heading').filter({ hasText: 'Cần làm' })).toHaveCount(1);
    await expect(page.getByTestId('group-heading').filter({ hasText: 'Nháp' })).toHaveCount(1);
    await page.getByRole('button', { name: 'Cần làm', exact: true }).click();
    await expect(rowOf(page, a.identifier)).toHaveCount(0);
    await page.getByRole('button', { name: 'Cần làm', exact: true }).click();
    await expect(rowOf(page, a.identifier)).toBeVisible();

    // Cột: ẩn "Người làm" (menu Cột), Đặt lại mặc định hiện lại.
    await expect(rowOf(page, a.identifier)).toContainText('crew-e2e-worker');
    await page.getByRole('button', { name: 'Cột' }).click();
    await page.getByRole('menuitemcheckbox', { name: /^Người làm/ }).click();
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/hide=assignee/);
    await expect(rowOf(page, a.identifier)).not.toContainText('crew-e2e-worker');

    // Xóa trong bảng Lọc bỏ mọi bộ lọc, giữ từ khóa; Đặt lại mặc định hiện lại cột.
    panel = await filters();
    await panel.getByRole('button', { name: 'Xóa' }).click();
    await closeFilters();
    await expect(page).not.toHaveURL(/project=/);
    await expect(page).toHaveURL(new RegExp(`q=${token}`));
    await page.getByRole('button', { name: 'Cột' }).click();
    await page.getByRole('menuitem', { name: 'Đặt lại mặc định' }).click();
    await expect(page).not.toHaveURL(/hide=/);
    await expect(rowOf(page, a.identifier)).toContainText('crew-e2e-worker');
  } finally {
    await archiveProject(api, project.id);
  }
});

test('PW-S4-3 cột "Giai đoạn Crew" và "x/y con xong" khớp crew.roots @t1', async ({ page, company, api }) => {
  const label = await researchLabelId(api, company.id);
  const root = await createIssue(api, company.id, {
    title: `PW-S4-3 gốc ${uniqueToken()}`,
    ...(label ? { labelIds: [label] } : {}),
  });
  await createIssue(api, company.id, { title: `PW-S4-3 con 1 ${uniqueToken()}`, parentId: root.id });
  await createIssue(api, company.id, { title: `PW-S4-3 con 2 ${uniqueToken()}`, parentId: root.id });
  await waitInCompactList(api, company.id, [root.id]);
  const roots = await api.crewData<Root[]>('crew.roots', company.id);
  const mine = roots.find((r) => r.id === root.id);
  expect(mine, 'crew.roots phải có issue gốc vừa tạo').toBeDefined();
  expect(mine?.totalChildren).toBe(2);

  await page.goto(company.path('issues'));
  const row = rowOf(page, root.identifier);
  await expect(row).toContainText(`${mine?.doneChildren}/${mine?.totalChildren} con xong`);
  // Ô giai đoạn là một trong các nhãn giai đoạn đã định nghĩa (không để trống với issue gốc).
  const labels = Object.values(vi.stage).filter((s) => !s.includes('{{'));
  const cells = await row.locator('[data-slot="task-row-cell"]').allInnerTexts();
  expect(
    cells.some((c) => labels.includes(c.trim())),
    `ô giai đoạn không khớp nhãn nào: ${cells.join(' | ')}`,
  ).toBe(true);
});

test('PW-S4-4 nút "Yêu cầu mới" mở dialog tạo yêu cầu @t1', async ({ page, company }) => {
  await page.goto(company.path('issues'));
  await page.getByRole('button', { name: 'Yêu cầu mới' }).click();
  await expect(page).toHaveURL(/new=1/);
  await expect(page.getByRole('dialog', { name: 'Yêu cầu mới' })).toBeVisible();
});

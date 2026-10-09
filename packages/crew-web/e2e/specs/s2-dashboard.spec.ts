// S2 Tổng quan: số liệu, run gần đây, widget Máy, yêu cầu gần đây. Mỗi ca so giao diện với GET API/plugin data.
import { awaitingApprovalIssues, createIssue, createOwnerStageIssue, uniqueToken } from '../support/data';
import { expect, test } from '../support/fixtures';

interface DashboardSummary {
  agents: { running: number; paused: number; active: number; error: number };
  tasks: { open: number; inProgress: number; blocked: number };
}
interface RunLite {
  id: string;
  status: string;
  createdAt: string;
}
interface Machine {
  machineId: string;
  lastSeenAt: string;
  latest: { hostname: string };
}
interface Root {
  id: string;
  identifier: string;
  title: string;
  updatedAt: string;
}

test('PW-S2-1 thẻ số khớp API: agent chạy/tạm dừng, yêu cầu mở/kẹt, chờ bạn duyệt @t1', async ({
  page,
  company,
  api,
}) => {
  await createIssue(api, company.id, { title: `PW-S2-1 ${uniqueToken()}`, status: 'blocked' });
  const owner = await createOwnerStageIssue(api, company.id, `PW-S2-1 chờ duyệt ${uniqueToken()}`);

  const summary = await api.get<DashboardSummary>(`/api/companies/${company.id}/dashboard`);
  const awaiting = (await awaitingApprovalIssues(api, company.id)).length;
  if (owner) expect(awaiting).toBeGreaterThan(0);

  await page.goto(company.path('dashboard'));
  const values = page.getByTestId('stat-value');
  await expect(values).toHaveCount(5);
  await expect(values.nth(0)).toHaveText(String(summary.agents.running));
  await expect(values.nth(1)).toHaveText(String(summary.agents.paused));
  await expect(values.nth(2)).toHaveText(String(summary.tasks.open));
  await expect(values.nth(3)).toHaveText(String(summary.tasks.blocked));
  await expect(values.nth(4)).toHaveText(String(awaiting));
  await expect(page.getByTestId('stat-card').nth(4)).toContainText('Chờ bạn duyệt');
  expect(summary.tasks.blocked).toBeGreaterThan(0);
});

test('PW-S2-2 run gần đây khớp API; "Xem run" mở trang run @t1', async ({ page, company, api }) => {
  const runs = await api.get<RunLite[]>(`/api/companies/${company.id}/heartbeat-runs?limit=6`);
  await page.goto(company.path('dashboard'));
  const rows = page.getByTestId('recent-run');
  if (runs.length === 0) {
    await expect(page.getByText('Chưa có run nào')).toBeVisible();
    return;
  }
  await expect(rows).toHaveCount(Math.min(6, runs.length));
  const links = await rows
    .getByRole('link', { name: 'Xem run' })
    .evaluateAll((els) => els.map((e) => e.getAttribute('href')));
  const ids = runs.slice(0, 6).map((r) => r.id);
  expect(links.map((h) => h?.split('/').pop()).sort()).toEqual([...ids].sort());
  await rows.first().getByRole('link', { name: 'Xem run' }).click();
  await expect(page).toHaveURL(new RegExp(`/${company.issuePrefix}/runs/[0-9a-f-]{36}$`));
  await expect(page.getByText('Không tìm thấy trang')).toHaveCount(0);
});

test('PW-S2-3 widget Máy khớp crew.machines @t1', async ({ page, company, api }) => {
  const machines = await api.crewData<Machine[]>('crew.machines', company.id);
  await page.goto(company.path('dashboard'));
  if (machines.length === 0) {
    await expect(page.getByText('Chưa có máy nào báo về')).toBeVisible();
    return;
  }
  const cards = page.locator('[data-slot="machine-card"]');
  await expect(cards).toHaveCount(machines.length);
  for (const m of machines) await expect(cards.filter({ hasText: m.latest.hostname }).first()).toBeVisible();
});

test('PW-S2-4 yêu cầu gần đây khớp crew.roots (6 mục cập nhật mới nhất) @t1', async ({ page, company, api }) => {
  const roots = await api.crewData<Root[]>('crew.roots', company.id);
  await page.goto(company.path('dashboard'));
  const recent = [...roots].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6);
  if (recent.length === 0) {
    await expect(page.getByText('Chưa có yêu cầu nào')).toBeVisible();
    return;
  }
  const card = page.locator('[data-slot="card"]').filter({ has: page.getByText('Yêu cầu gần đây', { exact: true }) });
  for (const r of recent) await expect(card.getByText(r.identifier, { exact: true }).first()).toBeVisible();
  await card
    .getByRole('link', { name: new RegExp(recent[0].identifier) })
    .first()
    .click();
  await expect(page).toHaveURL(new RegExp(`/issues/${recent[0].identifier}$`));
});

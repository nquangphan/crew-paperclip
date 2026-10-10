// S2 Tổng quan (bố cục Dashboard Paperclip): thẻ số, thẻ run của agent, widget Máy, yêu cầu gần đây, hoạt động gần đây. Mỗi ca so giao diện với GET API/plugin data.
import { awaitingApprovalIssues, createIssue, createOwnerStageIssue, uniqueToken } from '../support/data';
import { expect, test } from '../support/fixtures';

interface DashboardSummary {
  agents: { running: number; paused: number; active: number; error: number };
  tasks: { open: number; inProgress: number; blocked: number };
}
interface RunLite {
  id: string;
}
interface ActivityLite {
  id: string;
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
  await expect(values).toHaveCount(4);
  const enabled = summary.agents.active + summary.agents.running + summary.agents.paused + summary.agents.error;
  await expect(values.nth(0)).toHaveText(String(enabled));
  await expect(page.getByTestId('stat-card').nth(0)).toContainText(
    `${summary.agents.running} đang chạy, ${summary.agents.paused} tạm dừng, ${summary.agents.error} lỗi`,
  );
  await expect(values.nth(1)).toHaveText(String(summary.tasks.inProgress));
  await expect(values.nth(2)).toHaveText(String(summary.tasks.blocked));
  await expect(values.nth(3)).toHaveText(String(awaiting));
  await expect(page.getByTestId('stat-card').nth(3)).toContainText('Chờ bạn duyệt');
  expect(summary.tasks.blocked).toBeGreaterThan(0);
});

test('PW-S2-2 thẻ run của agent khớp live-runs; bấm mở trang run @t1', async ({ page, company, api }) => {
  const runs = await api.get<RunLite[]>(`/api/companies/${company.id}/live-runs?minCount=4`);
  await page.goto(company.path('dashboard'));
  const cards = page.getByTestId('agent-run-card');
  if (runs.length === 0) {
    await expect(page.getByText('Chưa có run nào gần đây.')).toBeVisible();
    return;
  }
  await expect(cards).toHaveCount(Math.min(4, runs.length));
  const hrefs = await cards.evaluateAll((els) =>
    els.map((e) => e.querySelector('a[href*="/runs/"]')?.getAttribute('href') ?? ''),
  );
  expect(hrefs.map((h) => h.split('/').pop()).sort()).toEqual(
    runs
      .slice(0, 4)
      .map((r) => r.id)
      .sort(),
  );
  await cards.first().locator('a[href*="/runs/"]').first().click();
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

test('PW-S2-4 yêu cầu gần đây khớp crew.roots (10 mục cập nhật mới nhất); bấm mở popup bằng ?issue= @t1', async ({
  page,
  company,
  api,
}) => {
  const roots = await api.crewData<Root[]>('crew.roots', company.id);
  await page.goto(company.path('dashboard'));
  const recent = [...roots].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 10);
  if (recent.length === 0) {
    await expect(page.getByText('Chưa có yêu cầu nào')).toBeVisible();
    return;
  }
  const list = page.getByTestId('recent-roots');
  for (const r of recent) await expect(list.getByText(r.identifier, { exact: true }).first()).toBeVisible();
  const first = list.getByRole('link', { name: new RegExp(recent[0].identifier) }).first();
  await expect(first).toHaveAttribute('href', `/${company.issuePrefix}/issues/${recent[0].identifier}`);
  await first.click();
  await expect(page).toHaveURL(new RegExp(`/dashboard\\?issue=${recent[0].identifier}$`));
});

test('PW-S2-5 hoạt động gần đây khớp GET activity (10 dòng mới nhất) @t1', async ({ page, company, api }) => {
  const events = await api.get<ActivityLite[]>(`/api/companies/${company.id}/activity?limit=10`);
  await page.goto(company.path('dashboard'));
  if (events.length === 0) {
    await expect(page.getByText('Chưa có hoạt động nào')).toBeVisible();
    return;
  }
  await expect(page.getByTestId('activity-row')).toHaveCount(Math.min(10, events.length));
});

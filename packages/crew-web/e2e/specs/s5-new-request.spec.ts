// S5 Dialog "Yêu cầu mới".
// Ca có @t1 chạy được ở stack cục bộ (không có project sẵn sàng, không có agent thật nên không run nào chạy).
// Ca không có @t1 cần project nền e2e-base (T2, stub): chỉ chạy trên prod company Crew E2E, đặt marker stub trong global-setup.
import type { Page } from '@playwright/test';
import type { Api } from '../support/api';
import { trackIssue } from '../support/cleanup';
import { archiveProject, createProject, uniqueToken } from '../support/data';
import { expect, test } from '../support/fixtures';

interface IssueFull {
  id: string;
  identifier: string;
  title: string;
  status: string;
  assigneeAgentId: string | null;
  executionPolicy: {
    stages: { type: string; participants: { type: string; agentId: string | null; userId: string | null }[] }[];
  } | null;
}
interface Roles {
  assistantAgentId: string;
  executorAgentIds: string[];
  reviewerAgentId: string;
  integratorAgentId: string;
}

const baseProjectId = () => process.env.CREW_E2E_BASE_PROJECT_ID ?? '';

async function openDialog(page: Page, path: string) {
  await page.goto(`${path}?new=1`);
  const dialog = page.getByRole('dialog', { name: 'Yêu cầu mới' });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function listIssues(api: Api, companyId: string, q: string) {
  return api.get<IssueFull[]>(`/api/companies/${companyId}/issues?q=${encodeURIComponent(q)}`);
}

test('PW-S5-1 project chưa sẵn sàng không có trong danh sách chọn @t1', async ({ page, company, api }) => {
  const project = await createProject(api, company.id, `PW-S5-1 chưa sẵn sàng ${uniqueToken()}`);
  try {
    const dialog = await openDialog(page, company.path('issues'));
    const select = dialog.getByRole('combobox', { name: 'Project' });
    const hint = dialog.getByText('Chưa có project nào sẵn sàng');
    await expect(select.or(hint)).toBeVisible();
    if (await select.isVisible()) {
      await select.click();
      await expect(page.getByRole('option', { name: project.name })).toHaveCount(0);
      await page.keyboard.press('Escape');
    } else {
      await expect(hint).toBeVisible();
    }
    // Không chọn được project nên không gửi được.
    await expect(dialog.getByRole('button', { name: 'Tạo', exact: true })).toBeDisabled();
  } finally {
    await archiveProject(api, project.id);
  }
});

test('PW-S5-2 loại Nghiên cứu → stage review + approval; Code → 4 stage', async ({ page, company, api }) => {
  test.skip(!baseProjectId(), 'Cần project nền e2e-base (T2)');
  const research = await submit(page, api, company, {
    kind: 'Nghiên cứu',
    title: `PW-S5-2 nghiên cứu ${uniqueToken()}`,
  });
  expect(research.executionPolicy?.stages.map((s) => s.type)).toEqual(['review', 'approval']);
  const code = await submit(page, api, company, { kind: 'Code', title: `PW-S5-2 code ${uniqueToken()}` });
  expect(code.executionPolicy?.stages.map((s) => s.type)).toEqual(['review', 'review', 'approval', 'review']);
});

test('PW-S5-3 file đính kèm: .png không cảnh báo, .zip cảnh báo trước khi gửi @t1', async ({ page, company }) => {
  const dialog = await openDialog(page, company.path('issues'));
  const input = dialog.locator('input[type="file"]');
  await input.setInputFiles({ name: 'anh.png', mimeType: 'image/png', buffer: Buffer.from('png') });
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expect(dialog.getByText('anh.png')).toBeVisible();

  await input.setInputFiles({ name: 'goi.zip', mimeType: 'application/zip', buffer: Buffer.from('PK') });
  const warn = dialog.getByRole('alert');
  await expect(warn).toContainText('Kiểm tra trước khi gửi');
  await expect(warn).toContainText('goi.zip');
  await expect(warn).toContainText('Agent sẽ không đọc được file');
  await warn.getByRole('button', { name: 'Gửi vẫn tiếp tục' }).click();
  await expect(dialog.getByText('goi.zip')).toBeVisible();
  // Bỏ chọn: nút × của từng file.
  await dialog.getByRole('button', { name: 'Bỏ goi.zip' }).click();
  await expect(dialog.getByText('goi.zip')).toHaveCount(0);
});

test('PW-S5-3 tải file lên và job attachments-audit để lại bình luận cảnh báo trong 1 phút', async ({
  page,
  company,
  api,
}) => {
  test.skip(!baseProjectId(), 'Cần project nền e2e-base (T2)');
  test.setTimeout(240_000);
  const title = `PW-S5-3 tải file ${uniqueToken()}`;
  const dialog = await openDialog(page, company.path('issues'));
  const project = await api.get<{ name: string }>(`/api/projects/${baseProjectId()}`);
  await dialog.getByRole('combobox', { name: 'Project' }).click();
  await page.getByRole('option', { name: project.name }).click();
  await dialog.getByLabel('Tiêu đề').fill(title);
  const input = dialog.locator('input[type="file"]');
  await input.setInputFiles({ name: 'anh.png', mimeType: 'image/png', buffer: Buffer.from('89504e470d0a1a0a', 'hex') });
  await input.setInputFiles({ name: 'goi.zip', mimeType: 'application/zip', buffer: Buffer.from('PK') });
  await dialog.getByRole('alert').getByRole('button', { name: 'Gửi vẫn tiếp tục' }).click();
  await dialog.getByRole('button', { name: 'Tạo', exact: true }).click();
  await expect(dialog).toBeHidden();

  const issue = (await listIssues(api, company.id, title))[0];
  expect(issue, 'issue vừa tạo').toBeDefined();
  trackIssue(issue.id);
  const attachments = await api.get<{ originalFilename: string }[]>(`/api/issues/${issue.id}/attachments`);
  expect(attachments.map((a) => a.originalFilename).sort()).toEqual(['anh.png', 'goi.zip']);
  await expect
    .poll(
      async () => {
        const comments = await api.get<{ body: string }[]>(`/api/issues/${issue.id}/comments`);
        return comments.some((c) => c.body.includes('goi.zip') && c.body.includes('không được agent đọc'));
      },
      { timeout: 120_000, intervals: [5_000] },
    )
    .toBe(true);
});

test('PW-S5-4 người nhận hiển thị cố định là Trợ Lý của project', async ({ page, company, api }) => {
  test.skip(!baseProjectId(), 'Cần project nền e2e-base (T2)');
  const roles = (
    await api.crewRoute<{ roles: Roles | null }>('GET', `/projects/${baseProjectId()}/roles?companyId=${company.id}`)
  ).roles;
  expect(roles).not.toBeNull();
  const assistant = await api.get<{ name: string }>(`/api/agents/${roles?.assistantAgentId}`);
  const project = await api.get<{ name: string }>(`/api/projects/${baseProjectId()}`);
  const dialog = await openDialog(page, company.path('issues'));
  await dialog.getByRole('combobox', { name: 'Project' }).click();
  await page.getByRole('option', { name: project.name }).click();
  await expect(dialog.getByText(assistant.name)).toBeVisible();
  await expect(dialog.getByText('Trợ Lý của project, không đổi được.')).toBeVisible();
  const issue = await submit(page, api, company, { title: `PW-S5-4 ${uniqueToken()}`, reuse: dialog });
  expect(issue.assigneeAgentId).toBe(roles?.assistantAgentId);
});

test('PW-S5-5 Tạo: 201, policy khớp vai trò, run của Trợ Lý xuất hiện ≤ 30 giây rồi thành công (stub)', async ({
  page,
  company,
  api,
}) => {
  test.skip(!baseProjectId(), 'Cần project nền e2e-base (T2)');
  const roles = (
    await api.crewRoute<{ roles: Roles }>('GET', `/projects/${baseProjectId()}/roles?companyId=${company.id}`)
  ).roles;
  const session = await api.get<{ user: { id: string } }>('/api/auth/get-session');
  const issue = await submit(page, api, company, { title: `PW-S5-5 ${uniqueToken()}` });
  expect(issue.status).toBe('todo');
  const stages = issue.executionPolicy?.stages ?? [];
  expect(stages.map((s) => s.type)).toEqual(['review', 'review', 'approval', 'review']);
  expect(stages[0].participants[0].agentId).toBe(roles.reviewerAgentId);
  expect(stages[1].participants[0].agentId).toBe(roles.integratorAgentId);
  expect(stages[2].participants[0].userId).toBe(session.user.id);
  expect(stages[3].participants[0].agentId).toBe(roles.integratorAgentId);

  const runs = async () =>
    api.get<{ status: string; contextSnapshot?: { issueId?: string } }[]>(
      `/api/companies/${company.id}/heartbeat-runs?agentId=${roles.assistantAgentId}`,
    );
  await expect
    .poll(async () => (await runs()).some((r) => r.contextSnapshot?.issueId === issue.id), { timeout: 30_000 })
    .toBe(true);
  await expect
    .poll(async () => (await runs()).find((r) => r.contextSnapshot?.issueId === issue.id)?.status, { timeout: 60_000 })
    .toBe('succeeded');
  await api.patch(`/api/issues/${issue.id}`, { status: 'cancelled' });
});

test('PW-S5-6 Lưu nháp: backlog, không có run mới', async ({ page, company, api }) => {
  test.skip(!baseProjectId(), 'Cần project nền e2e-base (T2)');
  const roles = (
    await api.crewRoute<{ roles: Roles }>('GET', `/projects/${baseProjectId()}/roles?companyId=${company.id}`)
  ).roles;
  const before = (
    await api.get<unknown[]>(`/api/companies/${company.id}/heartbeat-runs?agentId=${roles.assistantAgentId}`)
  ).length;
  const issue = await submit(page, api, company, { title: `PW-S5-6 ${uniqueToken()}`, draft: true });
  expect(issue.status).toBe('backlog');
  await expect(page.getByRole('status')).toContainText('chưa chạy');
  await page.waitForTimeout(8_000);
  const after = (
    await api.get<unknown[]>(`/api/companies/${company.id}/heartbeat-runs?agentId=${roles.assistantAgentId}`)
  ).length;
  expect(after).toBe(before);
});

test('PW-S5-7 Hủy / đóng dialog không tạo issue @t1', async ({ page, company, api }) => {
  const title = `PW-S5-7 ${uniqueToken()}`;
  const dialog = await openDialog(page, company.path('issues'));
  await dialog.getByLabel('Tiêu đề').fill(title);
  await dialog.getByRole('button', { name: 'Hủy' }).click();
  await expect(dialog).toBeHidden();
  await expect(page).not.toHaveURL(/new=1/);
  expect(await listIssues(api, company.id, title)).toEqual([]);

  // Đóng bằng Esc, mở lại thì form trống.
  const again = await openDialog(page, company.path('issues'));
  await again.getByLabel('Tiêu đề').fill(title);
  await page.keyboard.press('Escape');
  await expect(again).toBeHidden();
  const reopened = await openDialog(page, company.path('issues'));
  await expect(reopened.getByLabel('Tiêu đề')).toHaveValue('');
  expect(await listIssues(api, company.id, title)).toEqual([]);
});

/** Chọn project nền, điền tiêu đề, bấm Tạo (hoặc Lưu nháp); trả issue vừa tạo và ghi để cuối ca hủy. */
async function submit(
  page: Page,
  api: Api,
  company: { id: string; path(to?: string): string },
  opts: { kind?: 'Code' | 'Bug' | 'Nghiên cứu'; title: string; draft?: boolean; reuse?: ReturnType<Page['getByRole']> },
): Promise<IssueFull> {
  let dialog = opts.reuse;
  if (!dialog) {
    const project = await api.get<{ name: string }>(`/api/projects/${baseProjectId()}`);
    dialog = await openDialog(page, company.path('issues'));
    await dialog.getByRole('combobox', { name: 'Project' }).click();
    await page.getByRole('option', { name: project.name }).click();
    if (opts.kind && opts.kind !== 'Code') {
      await dialog.getByRole('combobox', { name: 'Loại' }).click();
      await page.getByRole('option', { name: opts.kind, exact: true }).click();
    }
  }
  await dialog.getByLabel('Tiêu đề').fill(opts.title);
  const created = page.waitForResponse(
    (r) => r.request().method() === 'POST' && /\/api\/companies\/[^/]+\/issues$/.test(r.url()),
  );
  await dialog.getByRole('button', { name: opts.draft ? 'Lưu nháp (chưa chạy)' : 'Tạo', exact: true }).click();
  const res = await created;
  expect(res.status()).toBe(201);
  const issue = (await res.json()) as IssueFull;
  trackIssue(issue.id);
  await expect(dialog).toBeHidden();
  return api.get<IssueFull>(`/api/issues/${issue.id}`);
}

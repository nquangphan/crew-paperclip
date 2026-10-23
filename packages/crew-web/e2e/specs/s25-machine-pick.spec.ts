// S25 Chạy nhiều máy: ô "Máy thực thi" ở form Yêu cầu mới (owner) và dòng "Máy" trên trang yêu cầu.
// Cần project nền e2e-base (T2, stub). Ca chỉ lưu nháp nên không có run nào chạy; ghim máy được kiểm qua route Crew.
// Ca chọn máy chỉ chạy khi project đã được dựng sẵn trên một máy đang online: không bao giờ xếp việc dựng thật lên máy.
import type { Page } from '@playwright/test';
import { trackIssue } from '../support/cleanup';
import { uniqueToken } from '../support/data';
import { expect, test } from '../support/fixtures';

const baseProjectId = () => process.env.CREW_E2E_BASE_PROJECT_ID ?? '';

interface MachineView {
  rootIssueId: string;
  locked: boolean;
  pin: { machineId: string; source: string } | null;
}
interface Candidate {
  machineId: string;
  hostname: string;
  online: boolean;
  status: 'ready' | 'provisioning' | 'failed' | null;
}

async function openDialog(page: Page, path: string) {
  await page.goto(`${path}?new=1`);
  const dialog = page.getByRole('dialog', { name: 'Yêu cầu mới' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('PW-S25-1 ô Máy thực thi mặc định Tự chọn; lưu nháp không ghim máy', async ({ page, company, api }) => {
  test.skip(!baseProjectId(), 'Cần project nền e2e-base (T2)');
  const project = await api.get<{ name: string }>(`/api/projects/${baseProjectId()}`);
  const dialog = await openDialog(page, company.path('issues'));
  await dialog.getByRole('combobox', { name: 'Project' }).click();
  await page.getByRole('option', { name: project.name }).click();
  await expect(dialog.getByRole('combobox', { name: 'Máy thực thi' })).toHaveText('Tự chọn');
  const title = `PW-S25-1 ${uniqueToken()}`;
  await dialog.getByLabel('Tiêu đề').fill(title);
  const created = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith(`/api/companies/${company.id}/issues`),
  );
  await dialog.getByRole('button', { name: 'Lưu nháp (chưa chạy)' }).click();
  const issue = (await (await created).json()) as { id: string; identifier: string };
  trackIssue(issue.id);
  const view = await api.get<MachineView>(`/api/crew/companies/${company.id}/issues/${issue.id}/machine`);
  expect(view).toMatchObject({ rootIssueId: issue.id, locked: false, pin: null });
  await page.goto(company.path(`issues/${issue.identifier}`));
  await expect(page.getByTestId('issue-machine')).toHaveText('Chưa chọn máy (tự chọn trước run đầu tiên)');
});

test('PW-S25-2 chọn máy đã ghép: yêu cầu nháp được ghim máy owner chọn', async ({ page, company, api }) => {
  test.skip(!baseProjectId(), 'Cần project nền e2e-base (T2)');
  const { items } = await api.get<{ items: Candidate[] }>(
    `/api/crew/companies/${company.id}/machines?projectId=${baseProjectId()}`,
  );
  const machine = items.find((c) => c.online && c.status === 'ready');
  test.skip(!machine, 'Project e2e chưa dựng xong trên máy nào đang online');
  const project = await api.get<{ name: string }>(`/api/projects/${baseProjectId()}`);
  const dialog = await openDialog(page, company.path('issues'));
  await dialog.getByRole('combobox', { name: 'Project' }).click();
  await page.getByRole('option', { name: project.name }).click();
  await dialog.getByRole('combobox', { name: 'Máy thực thi' }).click();
  await page.getByRole('option', { name: new RegExp(`^${machine?.hostname} ·`) }).click();
  await dialog.getByLabel('Tiêu đề').fill(`PW-S25-2 ${uniqueToken()}`);
  const pinned = page.waitForResponse((r) => r.request().method() === 'PUT' && r.url().includes('/machine'));
  await dialog.getByRole('button', { name: 'Lưu nháp (chưa chạy)' }).click();
  const view = (await (await pinned).json()) as MachineView;
  trackIssue(view.rootIssueId);
  expect(view.pin).toMatchObject({ machineId: machine?.machineId, source: 'owner' });
  const issue = await api.get<{ status: string }>(`/api/issues/${view.rootIssueId}`);
  expect(issue.status).toBe('backlog');
});

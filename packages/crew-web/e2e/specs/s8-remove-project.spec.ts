// Gỡ project (S8.7, flow F10): project dựng bằng wizard có một checkout bẩn. Gỡ xong: agent paused, environment riêng
// archived (không DELETE), vai trò trống, project archivedAt, checkout sạch mất, checkout bẩn còn, nhánh và folder gốc
// nguyên vẹn, status-repos.json không còn project. Cần máy thật có app 2P Crew nên chỉ chạy ở T2.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { tier } from '../support/env';
import { expect, test } from '../support/fixtures';
import {
  addProjectViaWizard,
  checkoutDir,
  checkoutRoles,
  E2E_REPO,
  parkProject,
  rolesOf,
  type WizardProject,
} from '../support/r3x-project';

interface AgentRow {
  id: string;
  name: string;
  status: string;
  defaultEnvironmentId?: string | null;
}
interface EnvRow {
  id: string;
  name: string;
  status: string;
}
interface JobRow {
  kind: string;
  status: string;
  payload: { projectKey?: string };
  result: { kept?: { role: string; reason: string }[]; removed?: { role: string }[] } | null;
}

test('PW-S8-7 PW-F10 Gỡ project có checkout bẩn: dọn phần sạch, giữ phần bẩn, không mất dữ liệu', async ({
  page,
  company,
  api,
}) => {
  test.skip(tier() === 't1', 'Cần máy thật có app 2P Crew và repo ~/crew-e2e/repo');
  test.setTimeout(900_000);
  let project: WizardProject | null = null;
  try {
    project = await addProjectViaWizard(page, api, company);
    const { key, name, projectId, roles } = project;
    const agentIds = [
      roles.assistantAgentId,
      ...roles.executorAgentIds,
      roles.reviewerAgentId,
      roles.integratorAgentId,
    ];

    // Checkout bẩn: tệp chưa commit ở executor đầu tiên.
    const dirtyFile = path.join(checkoutDir(key, 'executor'), 'dirty-e2e.txt');
    writeFileSync(dirtyFile, 'việc chưa commit của ca e2e\n');
    const rolesOnDisk = checkoutRoles(key);
    expect(rolesOnDisk).toContain('executor');

    const agentsBefore = await api.get<AgentRow[]>(`/api/companies/${company.id}/agents`);
    const ownEnvIds = new Set(
      agentsBefore.filter((a) => agentIds.includes(a.id)).map((a) => a.defaultEnvironmentId ?? ''),
    );
    const envsBefore = await api.get<EnvRow[]>(`/api/companies/${company.id}/environments`);
    const otherActive = envsBefore.filter((e) => !ownEnvIds.has(e.id) && e.status === 'active').map((e) => e.id);

    const deletes: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'DELETE' && req.url().includes('/environments')) deletes.push(req.url());
    });

    // Dialog đọc báo cáo máy gần nhất (khoảng 1 phút một lần): ngay sau wizard máy có thể chưa báo checkout, hay báo
    // trước khi tệp bẩn có. Mở lại dialog tới khi báo cáo mới có checkout bẩn.
    const dialog = page.getByRole('alertdialog');
    await expect(async () => {
      await page.goto(company.path(`projects/${projectId}`));
      await page.getByRole('button', { name: 'Gỡ project', exact: true }).click();
      await expect(dialog.getByText('có việc chưa commit, sẽ giữ lại', { exact: false })).toBeVisible({
        timeout: 5_000,
      });
    }).toPass({ intervals: [20_000], timeout: 240_000 });
    // Gõ sai tên: nút xác nhận tắt; gõ đúng tên thì bật.
    const confirm = dialog.getByRole('button', { name: 'Gỡ project', exact: true });
    await dialog.getByRole('textbox').fill(`${name} sai`);
    await expect(confirm).toBeDisabled();
    await dialog.getByRole('textbox').fill(name);
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(page.getByText('Đã gỡ project.')).toBeVisible({ timeout: 300_000 });

    // Agent trong vai trò đã paused.
    const agentsAfter = await api.get<AgentRow[]>(`/api/companies/${company.id}/agents`);
    for (const id of agentIds) expect(agentsAfter.find((a) => a.id === id)?.status, id).toBe('paused');
    // Environment riêng archived; environment khác vẫn active; không có lời gọi DELETE.
    const envsAfter = await api.get<EnvRow[]>(`/api/companies/${company.id}/environments`);
    for (const id of ownEnvIds) if (id) expect(envsAfter.find((e) => e.id === id)?.status, id).toBe('archived');
    for (const id of otherActive) expect(envsAfter.find((e) => e.id === id)?.status, id).toBe('active');
    expect(deletes).toEqual([]);
    // Vai trò trống, project lưu trữ.
    expect(await rolesOf(api, company.id, projectId)).toBeNull();
    const proj = await api.get<{ archivedAt?: string | null }>(`/api/projects/${projectId}`);
    expect(proj.archivedAt).toBeTruthy();

    // Trên Mac: checkout bẩn còn nguyên, các checkout sạch đã mất, kết quả kept: dirty.
    expect(existsSync(dirtyFile)).toBe(true);
    for (const role of rolesOnDisk.filter((r) => r !== 'executor')) {
      expect(existsSync(checkoutDir(key, role)), `checkout ${role} đã gỡ`).toBe(false);
    }
    const jobs = await api.crewData<JobRow[]>('crew.machineJobs', company.id, { kind: 'remove-checkouts' });
    const job = jobs.find((j) => j.payload.projectKey === key && j.status === 'done');
    expect(job?.result?.kept?.map((k) => `${k.role}:${k.reason}`)).toEqual(['executor:dirty']);
    // Nhánh crew/<key>/<vai trò> vẫn có trong repo gốc, folder gốc nguyên vẹn.
    const branches = execFileSync('git', ['-C', E2E_REPO, 'branch', '--list', `crew/${key}/*`], { encoding: 'utf8' });
    expect(branches).toContain(`crew/${key}/`);
    expect(existsSync(path.join(E2E_REPO, '.git'))).toBe(true);
    // status-repos.json không còn project.
    const reposFile = path.join(os.homedir(), '.crew', 'status-repos.json');
    if (existsSync(reposFile)) expect(readFileSync(reposFile, 'utf8')).not.toContain(projectId);

    // Danh sách project: bộ lọc Đã gỡ có project, banner ở trang project.
    await page.goto(company.path('projects'));
    await page.getByRole('button', { name: 'Đã gỡ', exact: true }).click();
    await expect(page.getByText(name)).toBeVisible();
    await page.goto(company.path(`projects/${projectId}`));
    await expect(page.getByText(/Project đã gỡ lúc/)).toBeVisible();
  } finally {
    if (project) await parkProject(api, project).catch(() => undefined);
  }
});

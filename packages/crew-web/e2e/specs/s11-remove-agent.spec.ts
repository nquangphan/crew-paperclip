// Gỡ agent (S11.9): executor thứ 2 của project dựng bằng wizard. Gỡ xong: còn một executor, AGENTS.md của Trợ Lý không
// còn id agent, agent paused, environment archived, checkout của vai đó mất. Reviewer: nút tắt kèm lý do.
// Cần máy thật có app 2P Crew nên chỉ chạy ở T2.
import { existsSync } from 'node:fs';
import type { Api } from '../support/api';
import { tier } from '../support/env';
import { expect, test } from '../support/fixtures';
import { addProjectViaWizard, checkoutDir, parkProject, rolesOf, type WizardProject } from '../support/r3x-project';

interface AgentRow {
  id: string;
  name: string;
  status: string;
  defaultEnvironmentId?: string | null;
}

async function assistantInstructions(api: Api, companyId: string, agentId: string): Promise<string> {
  const q = `path=AGENTS.md&companyId=${companyId}`;
  const file = await api.get<{ content?: string }>(`/api/agents/${agentId}/instructions-bundle/file?${q}`);
  return file.content ?? '';
}

test('PW-S11-9 Gỡ executor thứ 2: rời vai trò, AGENTS.md cập nhật, paused, environment archived, checkout mất', async ({
  page,
  company,
  api,
}) => {
  test.skip(tier() === 't1', 'Cần máy thật có app 2P Crew và repo ~/crew-e2e/repo');
  test.setTimeout(900_000);
  let project: WizardProject | null = null;
  try {
    project = await addProjectViaWizard(page, api, company);
    const { key, projectId, roles } = project;
    const target = roles.executorAgentIds[1];
    expect(target, 'project có 2 executor').toBeTruthy();
    const agentsBefore = await api.get<AgentRow[]>(`/api/companies/${company.id}/agents`);
    const agent = agentsBefore.find((a) => a.id === target);
    expect(agent).toBeTruthy();
    if (!agent) return;
    // AGENTS.md của Trợ Lý là instructions bundle trên Paperclip (danh sách executor theo id); AGENTS.md trong
    // checkout là file của repo, không phải của Trợ Lý.
    const assistantMd = () => assistantInstructions(api, company.id, roles.assistantAgentId);
    expect(await assistantMd()).toContain(target);

    // Reviewer: nút tắt kèm lý do và lối đổi vai trò.
    await page.goto(company.path(`agents/${roles.reviewerAgentId}`));
    await expect(page.getByRole('button', { name: 'Gỡ agent', exact: true })).toBeDisabled();
    await expect(page.getByText(/Agent đang là reviewer của .*: đổi vai trò trước hoặc gỡ cả project\./)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Đổi vai trò' })).toBeVisible();

    // Executor thứ 2: gỡ được.
    await page.goto(company.path(`agents/${target}`));
    await page.getByRole('button', { name: 'Gỡ agent', exact: true }).click();
    const dialog = page.getByRole('alertdialog');
    const confirm = dialog.getByRole('button', { name: 'Gỡ agent', exact: true });
    await dialog.getByRole('textbox').fill(`${agent.name} sai`);
    await expect(confirm).toBeDisabled();
    await dialog.getByRole('textbox').fill(agent.name);
    await confirm.click();
    await expect(page.getByText('Đã gỡ agent.')).toBeVisible({ timeout: 300_000 });

    const after = await rolesOf(api, company.id, projectId);
    expect(after?.executorAgentIds).toEqual([roles.executorAgentIds[0]]);
    const agentsAfter = await api.get<AgentRow[]>(`/api/companies/${company.id}/agents`);
    expect(agentsAfter.find((a) => a.id === target)?.status).toBe('paused');
    if (agent.defaultEnvironmentId) {
      const env = await api.get<{ status: string }>(`/api/environments/${agent.defaultEnvironmentId}`);
      expect(env.status).toBe('archived');
    }
    expect(existsSync(checkoutDir(key, 'executor-2'))).toBe(false);
    expect(existsSync(checkoutDir(key, 'executor'))).toBe(true);
    expect(await assistantMd()).not.toContain(target);

    // Danh sách agent: mặc định ẩn agent đã gỡ, bộ lọc Đã gỡ hiện lại.
    await page.goto(company.path('agents'));
    await expect(page.getByText(agent.name, { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Đã gỡ', exact: true }).click();
    await expect(page.getByText(agent.name, { exact: true })).toBeVisible();
  } finally {
    if (project) await parkProject(api, project).catch(() => undefined);
  }
});

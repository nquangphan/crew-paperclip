// Dựng và dọn project thử cho ca gỡ project/agent (chỉ T2: cần máy có app 2P Crew và repo ~/crew-e2e/repo).
// Project dựng bằng wizard Thêm project trên UI, khóa `e2e-rm-*` (stub chỉ bật cho khóa e2e-*).
import { existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Page } from '@playwright/test';
import type { Api } from './api';
import { uniqueToken } from './data';
import { agentsRoot } from './env';
import type { E2eCompany } from './fixtures';
import { expect } from './fixtures';

export const E2E_REPO = path.join(os.homedir(), 'crew-e2e', 'repo');

export interface CrewRoles {
  assistantAgentId: string;
  executorAgentIds: string[];
  reviewerAgentId: string;
  integratorAgentId: string;
}

export interface WizardProject {
  key: string;
  name: string;
  projectId: string;
  roles: CrewRoles;
}

export function newProjectKey(): string {
  return `e2e-rm-${uniqueToken('').slice(0, 7)}`;
}

/** Thư mục checkout của một vai trò trên Mac này. */
export const checkoutDir = (key: string, role: string): string => path.join(agentsRoot(), key, role);

export function checkoutRoles(key: string): string[] {
  const root = path.join(agentsRoot(), key);
  return existsSync(root) ? readdirSync(root).sort() : [];
}

export async function rolesOf(api: Api, companyId: string, projectId: string): Promise<CrewRoles | null> {
  const res = await api.raw('GET', `/api/plugins/crew.core/api/projects/${projectId}/roles?companyId=${companyId}`);
  if (res.status === 404) return null;
  if (res.status >= 400) throw new Error(`GET roles ${projectId}: ${res.status}`);
  const body = res.body as CrewRoles | { roles?: CrewRoles | null } | null;
  const roles = body && 'roles' in body ? body.roles : (body as CrewRoles | null);
  return roles?.assistantAgentId ? roles : null;
}

/** Thêm project bằng wizard (1 máy, folder ~/crew-e2e/repo, 2 executor) và chờ "Đã thêm project xong.". */
export async function addProjectViaWizard(page: Page, api: Api, company: E2eCompany): Promise<WizardProject> {
  const key = newProjectKey();
  const name = `E2E gỡ ${key}`;
  await page.goto(company.path('projects/new'));
  await page.getByLabel('Máy').click();
  await page.getByRole('option').first().click();
  await page.getByLabel('Folder repo trên máy').fill(E2E_REPO);
  await page.getByLabel('Khóa project').fill(key);
  await page.getByLabel('Tên project').fill(name);
  await page.getByLabel('Số executor').click();
  await page.getByRole('option', { name: '2', exact: true }).click();
  await page.getByRole('button', { name: 'Bắt đầu', exact: true }).click();
  await expect(page.getByText('Đã thêm project xong.')).toBeVisible({ timeout: 300_000 });

  const runs = await api.crewData<{ kind: string; projectKey: string; projectId: string | null; status: string }[]>(
    'crew.setupRuns',
    company.id,
    { kind: 'add-project', status: 'done' },
  );
  const projectId = runs.find((r) => r.projectKey === key)?.projectId;
  if (!projectId) throw new Error(`Không thấy setup run add-project done của ${key}`);
  const roles = await rolesOf(api, company.id, projectId);
  if (!roles) throw new Error(`Project ${key} chưa có vai trò sau wizard`);
  return { key, name, projectId, roles };
}

/**
 * Dọn project thử khi ca dừng giữa chừng: tạm dừng agent trong vai trò, lưu trữ project. Không xóa gì (agent và
 * project có lịch sử không xóa được); checkout trên máy gỡ bằng `git worktree remove` thủ công nếu cần.
 */
export async function parkProject(api: Api, p: WizardProject): Promise<void> {
  const ids = [
    p.roles.assistantAgentId,
    ...p.roles.executorAgentIds,
    p.roles.reviewerAgentId,
    p.roles.integratorAgentId,
  ];
  for (const id of ids) await api.raw('POST', `/api/agents/${id}/pause`, {});
  await api.raw('PATCH', `/api/projects/${p.projectId}`, { archivedAt: new Date().toISOString() });
}

// Ô vai trò runtime (executor Codex, executor OpenCode, reviewer Codex): roles API nhận agent đúng adapter cho từng ô
// và từ chối agent sai adapter; tab Vai trò hiện agent ô runtime, ô trống có lối thêm bằng wizard; wizard Tạo agent cho ô
// runtime chỉ liệt kê model của runtime đó, reviewer Codex có model cố định.
// Dựng project và agent bằng API board (không cần Mac: không chạy run, không dựng checkout), nên chỉ chạy ở T1 (stack
// cục bộ) để không để lại agent thử trên prod.
import { crewAgentCreateBody, crewModelsOf, defaultModelOf } from '../../src/lib/instructions/agent-config';
import type { Api } from '../support/api';
import { uniqueToken } from '../support/data';
import { expect, test } from '../support/fixtures';
import { loadModelSettings } from '../support/model-settings';

const PIN = '/Users/e2e/.crew/workflows/superpowers/1.0.0';

interface Created {
  projectId: string;
  agents: Record<
    'assistant' | 'executor' | 'reviewer' | 'integrator' | 'codex' | 'opencode',
    { id: string; name: string }
  >;
}

async function setupProject(api: Api, companyId: string): Promise<Created> {
  const token = uniqueToken('');
  const settings = await loadModelSettings(api);
  const project = await api.post<{ id: string }>(`/api/companies/${companyId}/projects`, {
    name: `E2E runtime ${token}`,
  });
  const make = async (name: string, body: ReturnType<typeof crewAgentCreateBody>) => {
    const agent = await api.post<{ id: string }>(`/api/companies/${companyId}/agents`, body);
    return { id: agent.id, name };
  };
  const claude = (role: 'assistant' | 'executor' | 'reviewer' | 'integrator') => {
    const name = `e2e-rt-${token}-${role}`;
    return make(
      name,
      crewAgentCreateBody({ name, role, model: defaultModelOf(role, settings), settings, pinDir: PIN }),
    );
  };
  const codexName = `e2e-rt-${token}-executor-codex`;
  const opencodeName = `e2e-rt-${token}-executor-opencode`;
  return {
    projectId: project.id,
    agents: {
      assistant: await claude('assistant'),
      executor: await claude('executor'),
      reviewer: await claude('reviewer'),
      integrator: await claude('integrator'),
      codex: await make(
        codexName,
        crewAgentCreateBody({
          name: codexName,
          slot: 'executor-codex',
          model: defaultModelOf('executor-codex', settings),
          settings,
          pinDir: PIN,
          projectKey: 'e2e-rt',
        }),
      ),
      opencode: await make(
        opencodeName,
        crewAgentCreateBody({
          name: opencodeName,
          slot: 'executor-opencode',
          model: defaultModelOf('executor-opencode', settings),
          settings,
          pinDir: PIN,
        }),
      ),
    },
  };
}

async function cleanup(api: Api, companyId: string, c: Created) {
  await api.raw('DELETE', `/api/plugins/crew.core/api/projects/${c.projectId}/roles?companyId=${companyId}`);
  for (const a of Object.values(c.agents)) await api.raw('POST', `/api/agents/${a.id}/pause`, {});
  await api.raw('PATCH', `/api/projects/${c.projectId}`, { archivedAt: new Date().toISOString() });
}

test('PW-R24-1 Ô runtime: roles nhận đúng adapter, tab Vai trò và wizard theo runtime @t1 @t1-only', async ({
  page,
  api,
  company,
}) => {
  const c = await setupProject(api, company.id);
  // Danh sách model hiển thị đã sắp theo id (natural sort), không theo thứ tự khóa jsonb server trả.
  const settings = await loadModelSettings(api);
  const reviewerCodex = settings.roles['reviewer-codex'];
  try {
    const base = {
      companyId: company.id,
      assistantAgentId: c.agents.assistant.id,
      executorAgentIds: [c.agents.executor.id],
      reviewerAgentId: c.agents.reviewer.id,
      integratorAgentId: c.agents.integrator.id,
    };
    const rolesPath = `/api/plugins/crew.core/api/projects/${c.projectId}/roles`;

    // Agent Codex ở ô OpenCode, agent OpenCode ở ô executor Claude: roles API từ chối.
    const wrongSlot = await api.raw('POST', rolesPath, { ...base, opencodeExecutorAgentId: c.agents.codex.id });
    expect(wrongSlot.status).toBe(400);
    expect(JSON.stringify(wrongSlot.body)).toContain('opencode_local');
    const claudeSlot = await api.raw('POST', rolesPath, {
      ...base,
      executorAgentIds: [c.agents.executor.id, c.agents.opencode.id],
    });
    expect(claudeSlot.status).toBe(400);

    await api.post(rolesPath, { ...base, codexExecutorAgentId: c.agents.codex.id });

    // Tab Vai trò: agent ô Codex hiện tên; ô OpenCode và reviewer Codex trống có lối thêm.
    await page.goto(company.path(`projects/${c.projectId}?tab=roles`));
    // Tên agent và huy hiệu sẵn sàng (hiện khi readiness tải xong) nằm chung một ô: so khớp một phần.
    await expect(page.getByRole('tabpanel').getByText(c.agents.codex.name)).toBeVisible();
    await expect(page.getByText('Executor Codex (tùy chọn)')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Thêm executor Codex' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Thêm reviewer Codex' })).toBeVisible();

    // Đặt thêm agent OpenCode vào ô của nó (agent thử chưa sẵn sàng nên hộp chọn trên form không có, đặt bằng API).
    await api.post(rolesPath, {
      ...base,
      codexExecutorAgentId: c.agents.codex.id,
      opencodeExecutorAgentId: c.agents.opencode.id,
    });
    const roles = await api.get<{ roles: Record<string, unknown> }>(`${rolesPath}?companyId=${company.id}`);
    expect(roles.roles).toMatchObject({
      codexExecutorAgentId: c.agents.codex.id,
      opencodeExecutorAgentId: c.agents.opencode.id,
      codexReviewerAgentId: null,
    });

    // Wizard Tạo agent từ lối "Thêm reviewer Codex": model cố định của bảng cài đặt.
    await page.reload();
    await expect(page.getByRole('tabpanel').getByText(c.agents.opencode.name)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Thêm executor OpenCode' })).toHaveCount(0);
    await page.getByRole('link', { name: 'Thêm reviewer Codex' }).click();
    await expect(page).toHaveURL(new RegExp(`agents/new\\?project=${c.projectId}&slot=reviewer-codex`));
    await expect(
      page.getByText(`Reviewer Codex chạy model cố định ${reviewerCodex.model}, effort ${reviewerCodex.effort}.`),
    ).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Model' })).toBeDisabled();
    await expect(page.getByRole('combobox', { name: 'Model' })).toContainText(reviewerCodex.model);

    // Ô executor OpenCode: chỉ model OpenCode Go.
    await page.goto(company.path(`agents/new?project=${c.projectId}&slot=executor-opencode`));
    await page.getByRole('combobox', { name: 'Model' }).click();
    await expect(page.getByRole('option')).toHaveText(crewModelsOf('opencode_local', settings));
    await page.keyboard.press('Escape');

    // Trang agent Codex: chọn model trong bảng Codex.
    await page.goto(company.path(`agents/${c.agents.codex.id}?tab=runtime`));
    await page.getByRole('combobox', { name: 'Model mặc định' }).click();
    await expect(page.getByRole('option')).toHaveText(crewModelsOf('codex_local', settings));
  } finally {
    await cleanup(api, company.id, c);
  }
});

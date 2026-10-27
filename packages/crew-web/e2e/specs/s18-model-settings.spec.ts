// S18.4 Cài đặt model (chỉ owner): bốn phần của trang /settings/models, mỗi phần kiểm tác dụng bằng GET API chứ không chỉ
// nhìn UI: (a) danh sách model, (b) bảng độ khó (thứ tự runtime, ô model), (c) model mặc định vai áp cho agent, (d) nâng
// hàng loạt. Thêm: lỗi validate hiện tại ô, xung đột revision (hai tab), key agent đọc được bảng, người không phải owner.
// Bảng là cài đặt chung toàn instance nên chỉ chạy ở T1 (stack cục bộ); cuối spec gửi PUT trả lại bản ban đầu để chạy lại
// được, vì catalog có trần 20 model.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import type { ModelSettings } from '../../src/api/crew/model-settings';
import { crewAgentCreateBody } from '../../src/lib/instructions/agent-config';
import { withAgentToken } from '../support/agent-token';
import { type Api, bearerApi, boardApi } from '../support/api';
import { ensurePlaceholderAgent, uniqueToken } from '../support/data';
import { companyId } from '../support/env';
import { type E2eCompany, expect, test } from '../support/fixtures';

test.describe.configure({ mode: 'serial' });

const PIN = '/Users/e2e/.crew/workflows/superpowers/1.0.0';
const ROUTE = '/api/crew/model-settings';

interface View {
  revision: number;
  settings: ModelSettings;
  canEdit: boolean;
}
interface AgentView {
  id: string;
  name: string;
  status: string;
  adapterConfig: { model?: string };
}
interface Dry {
  revision: number;
  applied: { agents: { agentId: string; name: string }[]; skipped: { agentId: string; reason: string }[] };
}
interface UpgradeDry {
  changes: {
    cells: unknown[];
    roles: unknown[];
    agents: { agentId: string }[];
    issues: unknown[];
    skipped: unknown[];
  };
}

const view = (api: Api) => api.get<View>(ROUTE);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** PUT bản `settings` lên đúng revision hiện hành. */
async function putSettings(api: Api, settings: ModelSettings): Promise<View> {
  const current = await view(api);
  await api.put(ROUTE, { baseRevision: current.revision, settings });
  return view(api);
}

const token = uniqueToken('');
let original: ModelSettings;
let createdProjects: string[] = [];
let createdAgents: string[] = [];

/** Project thử với bốn agent Claude đúng vai, gắn vào bảng vai của project (agent được tính là của company Crew). */
async function setupProject(
  api: Api,
  settings: ModelSettings,
  label: string,
  extra: { executorModels?: string[]; opencode?: { model: string } } = {},
) {
  const cid = companyId();
  const project = await api.post<{ id: string }>(`/api/companies/${cid}/projects`, {
    name: `E2E model ${label} ${token}`,
  });
  createdProjects.push(project.id);
  const make = async (body: ReturnType<typeof crewAgentCreateBody>) => {
    const agent = await api.post<{ id: string; name: string }>(`/api/companies/${cid}/agents`, body);
    createdAgents.push(agent.id);
    return { id: agent.id, name: agent.name };
  };
  const claude = (role: 'assistant' | 'executor' | 'reviewer' | 'integrator', model?: string, suffix = '') => {
    const name = `e2e-md-${token}-${label}-${role}${suffix}`;
    return make(crewAgentCreateBody({ name, role, model: model ?? settings.roles[role].model, settings, pinDir: PIN }));
  };
  const assistant = await claude('assistant');
  const executors = [];
  const models = extra.executorModels ?? [settings.roles.executor.model];
  for (const [i, model] of models.entries()) executors.push(await claude('executor', model, `-${i + 1}`));
  const reviewer = await claude('reviewer');
  const integrator = await claude('integrator');
  let opencode: { id: string; name: string } | null = null;
  if (extra.opencode) {
    const name = `e2e-md-${token}-${label}-oc`;
    opencode = await make(
      crewAgentCreateBody({
        name,
        slot: 'executor-opencode',
        model: extra.opencode.model,
        settings,
        pinDir: PIN,
      }),
    );
  }
  await api.post(`/api/plugins/crew.core/api/projects/${project.id}/roles`, {
    companyId: cid,
    assistantAgentId: assistant.id,
    executorAgentIds: executors.map((e) => e.id),
    reviewerAgentId: reviewer.id,
    integratorAgentId: integrator.id,
    ...(opencode ? { opencodeExecutorAgentId: opencode.id } : {}),
  });
  return { projectId: project.id, executors, opencode };
}

async function agentModel(api: Api, id: string): Promise<string | undefined> {
  return (await api.get<AgentView>(`/api/agents/${id}`)).adapterConfig.model;
}

/** Dọn dữ liệu thử: gỡ bảng vai, terminate agent (agent đã terminated không tính là đang dùng model), archive project. */
async function cleanup(api: Api) {
  const cid = companyId();
  for (const p of createdProjects) {
    await api.raw('DELETE', `/api/plugins/crew.core/api/projects/${p}/roles?companyId=${cid}`);
    await api.raw('PATCH', `/api/projects/${p}`, { archivedAt: new Date().toISOString() });
  }
  for (const a of createdAgents) await api.raw('POST', `/api/agents/${a}/terminate`, {});
  createdProjects = [];
  createdAgents = [];
}

test.beforeAll(async () => {
  const api = await boardApi();
  try {
    const current = await view(api);
    expect(current.canEdit, 'tài khoản board của stack phải là instance admin').toBe(true);
    original = clone(current.settings);
  } finally {
    await api.dispose();
  }
});

test.afterAll(async () => {
  const api = await boardApi();
  try {
    await cleanup(api);
    await putSettings(api, original);
  } finally {
    await api.dispose();
  }
});

const runtimeBlock = (page: Page, runtime: string) =>
  page.getByRole('region', { name: 'Danh sách model' }).locator(`[data-runtime="${runtime}"]`);
const saveButton = (page: Page) => page.getByRole('button', { name: 'Lưu', exact: true });

async function openPage(page: Page, company: E2eCompany) {
  await page.goto(company.path('settings/models'));
  await expect(page.getByRole('heading', { name: 'Cài đặt model' })).toBeVisible();
}

async function pickOption(page: Page, name: string, option: string) {
  await page.getByRole('combobox', { name, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

let modelA = '';

test('PW-S18-M1 (a) Danh sách model: lối vào ở Cài đặt, thêm model có cờ xem ảnh rồi lưu @t1 @t1-only', async ({
  page,
  api,
  company,
}) => {
  modelA = `e2e-a-${token}`;
  const before = await view(api);
  await page.goto(company.path('settings'));
  await page.getByRole('link', { name: 'Mở cài đặt model' }).click();
  await expect(page).toHaveURL(/\/settings\/models$/);
  await expect(page.getByRole('heading', { name: 'Cài đặt model' })).toBeVisible();
  for (const title of ['Danh sách model', 'Bảng độ khó', 'Model mặc định từng vai', 'Nâng model hàng loạt']) {
    await expect(page.getByRole('region', { name: title })).toBeVisible();
  }
  await expect(saveButton(page)).toBeDisabled();

  const block = runtimeBlock(page, 'opencode_local');
  await block.getByRole('textbox', { name: 'Id model mới của opencode_local' }).fill(modelA);
  await block.getByRole('checkbox', { name: 'Model mới của opencode_local xem được ảnh' }).click();
  await block.getByRole('button', { name: 'Thêm model' }).click();
  await expect(block.getByText(modelA)).toBeVisible();
  await saveButton(page).click();
  await expect(page.getByText(`Đã lưu bản r${before.revision + 1} và áp ngay`)).toBeVisible();

  const after = await view(api);
  expect(after.revision).toBe(before.revision + 1);
  expect(after.settings.catalog.opencode_local.models[modelA]).toEqual({ vision: true });
  await expect(saveButton(page)).toBeDisabled();
});

test('PW-S18-M2 (b) Bảng độ khó: đổi thứ tự runtime và ô model rồi lưu; ô large trỏ model không xem ảnh bị 422 tại ô @t1 @t1-only', async ({
  page,
  api,
  company,
}) => {
  const noVision = `e2e-nv-${token}`;
  const seed = clone((await view(api)).settings);
  seed.catalog.claude_local.models[noVision] = { vision: false };
  await putSettings(api, seed);
  const before = await view(api);

  await openPage(page, company);
  const small = before.settings.order.small;
  const at = small.indexOf('claude_local');
  const move = at > 0 ? 'Đưa claude_local lên trước ở mức small' : 'Đưa claude_local xuống sau ở mức small';
  await page.getByRole('button', { name: move }).click();
  await pickOption(page, 'Model của opencode_local ở mức small', modelA);
  await saveButton(page).click();
  await expect(page.getByText(`Đã lưu bản r${before.revision + 1} và áp ngay`)).toBeVisible();

  const saved = await view(api);
  const expectedOrder = [...small];
  const [moved] = expectedOrder.splice(at, 1);
  expectedOrder.splice(at > 0 ? at - 1 : at + 1, 0, moved as (typeof small)[number]);
  expect(saved.settings.order.small).toEqual(expectedOrder);
  expect(saved.settings.catalog.opencode_local.byComplexity.small?.model).toBe(modelA);

  // Ô large của Claude sang model không đọc được ảnh: server từ chối, ô báo lỗi, bản nháp giữ nguyên, revision không đổi.
  await pickOption(page, 'Model của claude_local ở mức large', noVision);
  await saveButton(page).click();
  await expect(page.getByText(/^1 lỗi/)).toBeVisible();
  const largeModel = page.getByRole('combobox', { name: 'Model của claude_local ở mức large', exact: true });
  await expect(largeModel).toHaveAttribute('aria-invalid', 'true');
  await expect(largeModel).toContainText(noVision);
  await expect(saveButton(page)).toBeEnabled();
  expect((await view(api)).revision).toBe(saved.revision);
  await page.getByRole('button', { name: 'Hoàn tác' }).click();
  await expect(largeModel).not.toContainText(noVision);
});

test('PW-S18-M3 (c) Model mặc định vai: hộp xác nhận ghi đúng số agent, agent đúng model cũ đổi, agent chỉnh tay giữ nguyên @t1 @t1-only', async ({
  page,
  api,
  company,
}) => {
  const settings = (await view(api)).settings;
  const claudeModels = Object.keys(settings.catalog.claude_local.models);
  const oldDefault = settings.roles.executor.model;
  const others = claudeModels.filter((m) => m !== oldDefault);
  const manualModel = others[0] as string;
  const newDefault = others[1] as string;
  const fx = await setupProject(api, settings, 'role', { executorModels: [oldDefault, manualModel] });
  const [followed, handEdited] = fx.executors as [{ id: string; name: string }, { id: string; name: string }];

  // Số agent mong đợi lấy từ chính dry-run của server.
  const next = clone(settings);
  next.roles.executor = { model: newDefault, effort: next.roles.executor.effort };
  const current = await view(api);
  const dry = await api.put<Dry>(ROUTE, { baseRevision: current.revision, settings: next, dryRun: true });
  expect(dry.applied.agents.map((a) => a.agentId)).toContain(followed.id);
  expect(dry.applied.agents.map((a) => a.agentId)).not.toContain(handEdited.id);
  expect(dry.applied.skipped).toContainEqual(expect.objectContaining({ agentId: handEdited.id, reason: 'manual' }));
  expect((await view(api)).revision).toBe(current.revision);

  await openPage(page, company);
  await pickOption(page, 'Model của vai executor', newDefault);
  await saveButton(page).click();
  const dialog = page.getByRole('alertdialog');
  await expect(
    dialog.getByText(
      `Lưu sẽ đổi model của ${dry.applied.agents.length} agent, giữ ${dry.applied.skipped.length} agent chỉnh tay hoặc bỏ qua.`,
    ),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Danh sách' }).first().click();
  await expect(dialog.getByText(followed.name)).toBeVisible();
  await dialog.getByRole('button', { name: 'Lưu và áp' }).click();
  await expect(page.getByText(`Đã lưu bản r${current.revision + 1} và áp ngay`)).toBeVisible();
  await expect(page.getByText(`Agent đã đổi model: ${dry.applied.agents.length}`)).toBeVisible();

  expect((await view(api)).settings.roles.executor.model).toBe(newDefault);
  expect(await agentModel(api, followed.id)).toBe(newDefault);
  expect(await agentModel(api, handEdited.id)).toBe(manualModel);
  await cleanup(api);
});

test('PW-S18-M4 (d) Nâng hàng loạt: số trong hộp thoại bằng số đổi thật, GET agent không còn model cũ @t1 @t1-only', async ({
  page,
  api,
  company,
}) => {
  const oldModel = `opencode-go/e2e-old-${token}`;
  const newModel = `opencode-go/e2e-new-${token}`;
  const seed = clone((await view(api)).settings);
  seed.catalog.opencode_local.models[oldModel] = { vision: false };
  await putSettings(api, seed);
  const fx = await setupProject(api, seed, 'up', { opencode: { model: oldModel } });
  const agentId = (fx.opencode as { id: string }).id;
  expect(await agentModel(api, agentId)).toBe(oldModel);

  const current = await view(api);
  const body = {
    baseRevision: current.revision,
    runtime: 'opencode_local',
    fromModel: oldModel,
    toModel: newModel,
    vision: false,
  };
  const dry = await api.post<UpgradeDry>(`${ROUTE}/upgrade`, { ...body, dryRun: true });
  const c = dry.changes;
  expect(c.agents.map((a) => a.agentId)).toContain(agentId);
  const total = 1 + c.cells.length + c.roles.length + c.agents.length + c.issues.length;

  await openPage(page, company);
  await page.getByRole('button', { name: 'Nâng model hàng loạt' }).click();
  const dialog = page.getByRole('dialog');
  await pickOption(page, 'Runtime', 'opencode_local');
  await pickOption(page, 'Model cũ', oldModel);
  await dialog.getByLabel('Model mới', { exact: true }).fill(newModel);
  await dialog.getByRole('button', { name: 'Xem trước' }).click();
  await expect(dialog.getByText(`Agent: ${c.agents.length}`, { exact: true })).toBeVisible();
  await expect(dialog.getByText(`Issue đang mở: ${c.issues.length}`)).toBeVisible();
  await expect(dialog.getByText(`Tổng: ${total} chỗ`)).toBeVisible();
  await dialog.getByRole('button', { name: `Nâng ${total} chỗ` }).click();
  await expect(page.getByText(`Đã nâng model, bản r${current.revision + 1}: ${total} chỗ`)).toBeVisible();
  await expect(page.getByText('Khác xem trước vì dữ liệu vừa đổi.')).toHaveCount(0);

  const after = await view(api);
  expect(after.revision).toBe(current.revision + 1);
  expect(after.settings.catalog.opencode_local.models[oldModel]).toBeUndefined();
  expect(after.settings.catalog.opencode_local.models[newModel]).toEqual({ vision: false });
  expect(await agentModel(api, agentId)).toBe(newModel);
  const live = (await api.get<AgentView[]>(`/api/companies/${companyId()}/agents`)).filter(
    (a) => a.status !== 'terminated',
  );
  expect(live.filter((a) => a.adapterConfig.model === oldModel)).toEqual([]);
  await cleanup(api);
});

test('PW-S18-M5 Xung đột revision: hai tab cùng sửa, tab lưu sau thấy banner Tải lại @t1 @t1-only', async ({
  page,
  api,
  company,
  context,
}) => {
  const before = await view(api);
  await openPage(page, company);
  const other = await context.newPage();
  try {
    await openPage(other, company);
    const first = runtimeBlock(other, 'codex_local');
    await first.getByRole('textbox', { name: 'Id model mới của codex_local' }).fill(`e2e-b-${token}`);
    await first.getByRole('button', { name: 'Thêm model' }).click();
    await saveButton(other).click();
    await expect(other.getByText(`Đã lưu bản r${before.revision + 1} và áp ngay`)).toBeVisible();
  } finally {
    await other.close();
  }
  const mine = runtimeBlock(page, 'codex_local');
  await mine.getByRole('textbox', { name: 'Id model mới của codex_local' }).fill(`e2e-c-${token}`);
  await mine.getByRole('button', { name: 'Thêm model' }).click();
  await saveButton(page).click();
  await expect(page.getByText(`Bảng vừa được lưu ở bản r${before.revision + 1}`)).toBeVisible();
  expect((await view(api)).revision).toBe(before.revision + 1);
  await page.getByRole('button', { name: 'Tải lại' }).click();
  await expect(page.getByText(`Bảng vừa được lưu ở bản r${before.revision + 1}`)).toHaveCount(0);
  await expect(page.getByText(new RegExp(`Bản r${before.revision + 1}, lưu lúc`))).toBeVisible();
  await expect(runtimeBlock(page, 'codex_local').getByText(`e2e-b-${token}`)).toBeVisible();
  await expect(runtimeBlock(page, 'codex_local').getByText(`e2e-c-${token}`)).toHaveCount(0);
});

test('PW-S18-M6 Key agent đọc được bảng mới nhất nhưng không sửa được @t1 @t1-only', async ({ api, company }) => {
  const agent = await ensurePlaceholderAgent(api, company.id, 'e2e-s18-reader', { wake: false });
  const current = await view(api);
  await withAgentToken(api, agent.id, async (key) => {
    const asAgent = await bearerApi(key);
    try {
      const read = await asAgent.get<View>(ROUTE);
      expect(read.revision).toBe(current.revision);
      expect(read.canEdit).toBe(false);
      expect(read.settings.order).toEqual(current.settings.order);
      const write = await asAgent.raw('PUT', ROUTE, { baseRevision: read.revision, settings: read.settings });
      expect(write.status).toBe(403);
    } finally {
      await asAgent.dispose();
    }
  });
});

test('PW-S18-M7 Người không phải owner: không có lối vào, mở thẳng URL thấy "Chỉ owner sửa được", PUT bị 403 @t1 @t1-only', async ({
  contributorPage,
  contributorApi,
  company,
}) => {
  await contributorPage.goto(company.path('settings'));
  await expect(contributorPage.getByRole('heading', { name: 'Cài đặt', exact: true })).toBeVisible();
  await expect(contributorPage.getByRole('link', { name: 'Mở cài đặt model' })).toHaveCount(0);
  await contributorPage.goto(company.path('settings/models'));
  await expect(contributorPage.getByText('Chỉ owner sửa được')).toBeVisible();
  const read = await contributorApi.get<View>(ROUTE);
  expect(read.canEdit).toBe(false);
  const write = await contributorApi.raw('PUT', ROUTE, { baseRevision: read.revision, settings: read.settings });
  expect(write.status).toBe(403);
});

// Ảnh minh họa cho tài liệu (không phải ca kiểm): chỉ chạy khi đặt CREW_S18_SHOTS=<thư mục lưu PNG>.
test('PW-S18-M8 Chụp ảnh trang Cài đặt model và hộp thoại nâng hàng loạt @t1 @t1-only', async ({ page, company }) => {
  const dir = process.env.CREW_S18_SHOTS;
  test.skip(!dir, 'Chỉ chụp khi có CREW_S18_SHOTS');
  mkdirSync(dir as string, { recursive: true });
  // Cuộn nằm trong vùng nội dung của shell nên ảnh chụp cả trang cần khung nhìn đủ cao để thấy bốn phần.
  await page.setViewportSize({ width: 1280, height: 3500 });
  await openPage(page, company);
  await expect(page.getByRole('region', { name: 'Model mặc định từng vai' })).toBeVisible();
  await page.screenshot({ path: path.join(dir as string, 'model-settings-page.png') });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('button', { name: 'Nâng model hàng loạt' }).click();
  const dialog = page.getByRole('dialog');
  await pickOption(page, 'Model cũ', 'claude-sonnet-5');
  await dialog.getByLabel('Model mới', { exact: true }).fill('claude-sonnet-5-5');
  await dialog.getByRole('button', { name: 'Xem trước' }).click();
  await expect(dialog.getByText(/^Tổng: \d+ chỗ$/)).toBeVisible();
  await page.screenshot({ path: path.join(dir as string, 'model-settings-upgrade-dialog.png') });
});

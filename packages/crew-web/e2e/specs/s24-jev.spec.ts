// Trang Jev (S24): owner lưu key (response và DOM chỉ có vân tay), chuyển sang Chặn thật (version tăng), và một máy giả
// được ghép kéo cấu hình / đẩy sự kiện bằng chữ ký HMAC rồi trang hiện đúng số và nhãn Nhầm ghi xuống API.
// Key trong ca là chuỗi giả `sk-or-test-…`, không bao giờ là key thật. Spec điền ô key nên tắt trace (trace chụp DOM).
// Cần secret webhook biết giá trị để ghép máy, nên ca tạo secret mới và trỏ config company sang nó (trả lại cuối ca).
// Chỉ chạy ở T1: server cục bộ gọi được route máy và ca không được chạm secret webhook của prod.
import { createHmac, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { type Page, type Route, request } from '@playwright/test';
import type { Api } from '../support/api';
import { trackIssue } from '../support/cleanup';
import {
  archiveProject,
  createIssue,
  createOwnerStageIssue,
  createProject,
  ensureLabel,
  type IssueLite,
  uniqueToken,
  waitInCompactList,
} from '../support/data';
import { baseUrl } from '../support/env';
import { expect, test } from '../support/fixtures';

test.use({ trace: 'off' });
test.describe.configure({ mode: 'serial' });

const PLUGIN = '/api/plugins/crew.core';
const FINGERPRINT = `SHA256:${'A'.repeat(43)}`;
const FAKE_KEY = `sk-or-test-${randomUUID().replaceAll('-', '')}`;

interface PluginConfig {
  companies?: Array<{ companyId: string; webhookSecretRef?: unknown } & Record<string, unknown>>;
  [key: string]: unknown;
}
interface JevSettings {
  enabled: boolean;
  gateMode: 'shadow' | 'enforce';
  model: string;
  threshold: number;
  timeoutMs: number;
  serverShadow: boolean;
  hasKey: boolean;
  keyFingerprint: string | null;
  version: number;
  machines: Array<{ machineId: string; appliedVersion: number | null; keyOk: boolean }>;
}
interface JevStats {
  gate: { calls: number; allow: number; deny: number };
}
interface GateEventPage {
  items: Array<{ command: string | null; ownerLabel: string | null; verdict: string }>;
}
interface PullResult {
  version: number;
  hasKey: boolean;
  keyFingerprint: string | null;
  apiKey?: string;
}

let previousConfig: PluginConfig | null = null;
let webhookSecret = '';
let webhookSecretId = '';
let keySecretId = '';
let previousSettings: JevSettings | null = null;

const jevPath = (companyId: string, to: string) => `/api/crew/companies/${companyId}/jev${to}`;

async function createSecret(api: Api, companyId: string, name: string, value: string): Promise<string> {
  const created = await api.post<{ id: string }>(`/api/companies/${companyId}/secrets`, { name, value });
  return created.id;
}

async function setConfig(api: Api, companyId: string, configJson: PluginConfig) {
  await api.post(`${PLUGIN}/config`, { companyId, configJson });
}

/** Gửi một lời gọi route máy ký bằng `key` (như app Mac), không mang phiên board; trả mã HTTP và body. */
async function signedPost(companyId: string, to: string, payload: Record<string, unknown>, key: string) {
  const raw = JSON.stringify({ version: 1, companyId, sentAt: new Date().toISOString(), ...payload });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = `sha256=${createHmac('sha256', key).update(timestamp).update('.').update(raw).digest('hex')}`;
  const ctx = await request.newContext({ baseURL: baseUrl(), storageState: { cookies: [], origins: [] } });
  try {
    const res = await ctx.fetch(jevPath(companyId, to), {
      method: 'POST',
      data: raw,
      headers: { 'content-type': 'application/json', 'x-crew-timestamp': timestamp, 'x-crew-signature': signature },
    });
    const text = await res.text();
    return { status: res.status(), body: text ? JSON.parse(text) : null };
  } finally {
    await ctx.dispose();
  }
}

test.beforeAll(async ({ api, company }) => {
  previousSettings = await api.get<JevSettings>(jevPath(company.id, '/settings'));
  const config = await api
    .get<{ configJson: PluginConfig } | null>(`${PLUGIN}/config?companyId=${company.id}`)
    .catch(() => null);
  previousConfig = config?.configJson ?? null;
  webhookSecret = randomUUID() + randomUUID();
  webhookSecretId = await createSecret(api, company.id, `e2e-jev-webhook-${uniqueToken('')}`, webhookSecret);
  const ref = { type: 'secret_ref', secretId: webhookSecretId, version: 'latest' };
  const others = (previousConfig?.companies ?? []).filter((c) => c.companyId !== company.id);
  const own = (previousConfig?.companies ?? []).find((c) => c.companyId === company.id) ?? { companyId: company.id };
  await setConfig(api, company.id, {
    ...(previousConfig ?? {}),
    companies: [...others, { ...own, webhookSecretRef: ref }],
  });
  keySecretId = await createSecret(api, company.id, `e2e-jev-key-${uniqueToken('')}`, 'e2e-not-a-real-private-key');
});

test.afterAll(async ({ api, company }) => {
  // Trả cấu hình Jev và config plugin về như cũ; key giả không được ở lại company.
  await api.raw('DELETE', jevPath(company.id, '/key'));
  if (previousSettings) {
    const { enabled, gateMode, serverShadow, model, threshold, timeoutMs } = previousSettings;
    await api.raw('PUT', jevPath(company.id, '/settings'), {
      enabled,
      gateMode,
      serverShadow,
      model,
      threshold,
      timeoutMs,
    });
  }
  if (previousConfig) await setConfig(api, company.id, previousConfig).catch(() => undefined);
  for (const id of [webhookSecretId, keySecretId]) if (id) await api.raw('DELETE', `/api/secrets/${id}`);
});

test('PW-S24-1 Lưu key: response và trang sau khi tải lại chỉ có vân tay, không có key @t1 @t1-only', async ({
  page,
  api,
  company,
}) => {
  await page.goto(company.path('jev'));
  const input = page.getByLabel('Key mới');
  await expect(input).toHaveAttribute('type', 'password');
  await expect(input).toHaveAttribute('autocomplete', 'off');
  await expect(input).toHaveValue('');

  await input.fill(FAKE_KEY);
  const saved = page.waitForResponse((r) => r.url().endsWith('/jev/key') && r.request().method() === 'PUT');
  await page.getByRole('button', { name: 'Lưu key', exact: true }).click();
  const res = await saved;
  expect(res.status()).toBe(200);
  const body = await res.text();
  expect(body).not.toContain(FAKE_KEY);
  const { keyFingerprint } = JSON.parse(body) as { keyFingerprint: string };
  expect(keyFingerprint).toMatch(/^[0-9a-f]{12}$/);

  await expect(input).toHaveValue('');
  await expect(page.getByText(`Đã có key · vân tay ${keyFingerprint}`)).toBeVisible();

  await page.reload();
  await expect(page.getByText(`Đã có key · vân tay ${keyFingerprint}`)).toBeVisible();
  await expect(page.getByLabel('Key mới')).toHaveValue('');
  expect(await page.content()).not.toContain(FAKE_KEY);

  const settings = await api.raw('GET', jevPath(company.id, '/settings'));
  expect(JSON.stringify(settings.body)).not.toContain(FAKE_KEY);
  expect((settings.body as JevSettings).keyFingerprint).toBe(keyFingerprint);
});

test('PW-S24-2 Đổi sang Chặn thật (có hỏi xác nhận): gateMode=enforce và version tăng @t1 @t1-only', async ({
  page,
  api,
  company,
}) => {
  await api.put(jevPath(company.id, '/settings'), {
    enabled: true,
    gateMode: 'shadow',
    model: 'typesafe/jev-1.14',
    threshold: 0.5,
    timeoutMs: 2500,
    serverShadow: false,
  });
  const before = await api.get<JevSettings>(jevPath(company.id, '/settings'));
  expect(before.gateMode).toBe('shadow');

  await page.goto(company.path('jev'));
  await page.getByRole('combobox', { name: 'Chế độ gate' }).click();
  await page.getByRole('option', { name: 'Chặn thật' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog.getByText(/lệnh bị Jev đánh deny sẽ bị chặn thật/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Chặn thật' }).click();
  await page.getByRole('button', { name: 'Lưu cấu hình' }).click();
  await expect(page.getByText(/Đã lưu cấu hình, phiên bản/)).toBeVisible();

  const after = await api.get<JevSettings>(jevPath(company.id, '/settings'));
  expect(after.gateMode).toBe('enforce');
  expect(after.version).toBeGreaterThan(before.version);
});

test('PW-S24-3 Máy giả kéo cấu hình và đẩy sự kiện ký HMAC: trang hiện số khớp, bấm Nhầm ghi nhãn @t1 @t1-only', async ({
  page,
  api,
  company,
}) => {
  // Key và cấu hình đã có từ hai ca trước nhưng đặt lại để ca đứng được một mình.
  await api.put(jevPath(company.id, '/key'), { apiKey: FAKE_KEY });
  await api.put(jevPath(company.id, '/settings'), {
    enabled: true,
    gateMode: 'enforce',
    model: 'typesafe/jev-1.14',
    threshold: 0.5,
    timeoutMs: 2500,
    serverShadow: false,
  });

  const hostname = `e2e-jev-${uniqueToken('')}`;
  const machineId = randomUUID();
  const env = await api.post<{ id: string }>(`/api/companies/${company.id}/environments`, {
    name: `e2e-jev-${hostname}`,
    description: 'Environment tạm của ca Jev',
    driver: 'ssh',
    config: {
      host: '100.64.0.11',
      port: 2222,
      username: 'e2e',
      remoteWorkspacePath: '/Users/e2e/crew-agents/e2e-jev',
      privateKeySecretRef: { type: 'secret_ref', secretId: keySecretId, version: 'latest' },
      knownHosts: '',
      strictHostKeyChecking: false,
    },
    metadata: { workspaceRealizationMode: 'in_place' },
  });
  const paired = await api.crewRoute<{ machineKey: string }>('POST', '/machines/pair', {
    companyId: company.id,
    machineId,
    hostname,
    environmentId: env.id,
    tailscaleIp: '100.64.0.11',
    port: 2222,
    hostKeyFingerprint: FINGERPRINT,
  });

  const statsBefore = await api.get<JevStats>(jevPath(company.id, '/stats?days=7'));

  // Lần kéo đầu: Mac chưa có key nên nhận apiKey đúng một lần.
  const first = await signedPost(
    company.id,
    '/machine/pull',
    { machineId, appliedVersion: null, keyFingerprint: null },
    paired.machineKey,
  );
  expect(first.status, JSON.stringify(first.body)).toBe(200);
  const firstPull = first.body as PullResult;
  expect(firstPull.apiKey).toBe(FAKE_KEY);
  // Lần hai: vân tay đã khớp nên không gửi lại key.
  const second = await signedPost(
    company.id,
    '/machine/pull',
    { machineId, appliedVersion: firstPull.version, keyFingerprint: firstPull.keyFingerprint },
    paired.machineKey,
  );
  expect(second.status).toBe(200);
  expect((second.body as PullResult).apiKey).toBeUndefined();
  expect(JSON.stringify(second.body)).not.toContain(FAKE_KEY);

  const command = `git push --force origin e2e-${uniqueToken('')}`;
  const row = (verdict: 'allow' | 'deny', text: string) => ({
    v: 1,
    eventId: randomUUID(),
    ts: new Date().toISOString(),
    companyId: company.id,
    runId: null,
    agentId: null,
    cwd: null,
    mode: 'enforce',
    category: verdict === 'deny' ? 'force_push' : null,
    blocking: true,
    verdict,
    applied: verdict,
    confidence: verdict === 'deny' ? 0.93 : 0.12,
    reason: null,
    errorCode: null,
    latencyMs: 180,
    model: 'typesafe/jev-1.14',
    command: text,
  });
  const sent = await signedPost(
    company.id,
    '/machine/events',
    { machineId, events: [row('allow', 'git status'), row('allow', 'ls -la'), row('deny', command)] },
    paired.machineKey,
  );
  expect(sent.status).toBe(200);
  expect(sent.body).toMatchObject({ accepted: 3, duplicates: 0 });

  const statsAfter = await api.get<JevStats>(jevPath(company.id, '/stats?days=7'));
  expect(statsAfter.gate.calls - statsBefore.gate.calls).toBe(3);
  expect(statsAfter.gate.deny - statsBefore.gate.deny).toBe(1);

  await page.goto(company.path('jev'));
  const totals = page.getByTestId('jev-totals');
  await expect(totals.getByRole('cell').nth(0)).toHaveText(String(statsAfter.gate.calls));
  await expect(totals.getByRole('cell').nth(1)).toHaveText(String(statsAfter.gate.allow));
  await expect(totals.getByRole('cell').nth(2)).toHaveText(String(statsAfter.gate.deny));

  // Bảng máy: máy giả đã nhận đúng version hiện tại.
  const settings = await api.get<JevSettings>(jevPath(company.id, '/settings'));
  const machineRow = page.getByRole('row').filter({ hasText: hostname });
  await expect(machineRow.getByText(`Đã nhận bản ${settings.version}`)).toBeVisible();

  const eventRow = page.getByTestId('jev-gate-event').filter({ hasText: command });
  await expect(eventRow).toBeVisible();
  await eventRow.getByRole('button', { name: 'Nhầm' }).click();
  await expect(eventRow.getByRole('button', { name: 'Nhầm' })).toHaveAttribute('aria-pressed', 'true');

  const list = await api.get<GateEventPage>(jevPath(company.id, '/gate-events?verdict=deny'));
  expect(list.items.find((e) => e.command === command)?.ownerLabel).toBe('wrong');

  // Dọn máy giả để lượt sau không thấy thẻ mồ côi: gỡ environment (archive); dòng sự kiện tự hết hạn sau 30 ngày.
  await api.raw('POST', `${PLUGIN}/api/machines/${machineId}/unpair`, { companyId: company.id });
  await api.raw('PATCH', `/api/environments/${env.id}`, { status: 'archived' });
});

test('PW-S24-4 Trang issue: dòng tóm tắt Jev đúng số, mở ra thấy ca deny, bấm Nhầm ghi nhãn @t1 @t1-only', async ({
  page,
  api,
  company,
}) => {
  // Run giả: agent process chạy `true`, đánh thức theo issue nên run mang `issueId` trong context.
  const agent = await api.post<{ id: string }>(`/api/companies/${company.id}/agents`, {
    name: `e2e-jev-runner-${uniqueToken('')}`,
    role: 'general',
    adapterType: 'process',
    adapterConfig: { command: 'true', args: [] },
    runtimeConfig: { heartbeat: { enabled: false, wakeOnDemand: true } },
  });
  try {
    const issue = await api.post<{ id: string; identifier: string }>(`/api/companies/${company.id}/issues`, {
      title: `E2E Jev issue ${uniqueToken('')}`,
    });
    trackIssue(issue.id);
    const run = await api.post<{ id: string }>(`/api/agents/${agent.id}/wakeup`, {
      source: 'on_demand',
      reason: 'e2e-jev',
      payload: { issueId: issue.id },
      contextSnapshot: { issueId: issue.id },
    });

    const machineId = randomUUID();
    const command = `git push --force origin e2e-${uniqueToken('')}`;
    const row = (verdict: 'allow' | 'deny' | 'escalate', text: string) => ({
      v: 1,
      eventId: randomUUID(),
      ts: new Date().toISOString(),
      companyId: company.id,
      runId: run.id,
      agentId: agent.id,
      cwd: null,
      mode: 'shadow',
      category: verdict === 'deny' ? 'force_push' : null,
      blocking: false,
      verdict,
      applied: 'allow',
      confidence: verdict === 'allow' ? 0.1 : 0.9,
      reason: verdict === 'escalate' ? 'unsure' : null,
      errorCode: null,
      latencyMs: 150,
      model: 'typesafe/jev-1.14',
      command: text,
    });
    const sent = await signedPost(
      company.id,
      '/machine/events',
      {
        machineId,
        events: [
          row('allow', 'git status'),
          row('allow', 'ls -la'),
          row('allow', 'pnpm test'),
          row('deny', command),
          row('escalate', 'rm -rf build'),
        ],
      },
      webhookSecret,
    );
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    expect(sent.body).toMatchObject({ accepted: 5 });

    const summary = await api.get<{ calls: number; deny: number; escalate: number; runs: number }>(
      jevPath(company.id, `/issues/${issue.id}/summary`),
    );
    expect(summary).toMatchObject({ calls: 5, deny: 1, escalate: 1, runs: 1 });

    await page.goto(company.path(`issues/${issue.identifier}`));
    const toggle = page.getByRole('button', { name: 'Jev: 5 lệnh · 1 chặn · 1 không chắc · 0 lỗi' });
    await expect(toggle).toBeVisible();
    await toggle.click();
    const eventRow = page.getByTestId('jev-gate-event').filter({ hasText: command });
    await expect(eventRow).toBeVisible();
    await expect(eventRow.getByText('Chỉ ghi log')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Xem tất cả ở trang Jev' })).toBeVisible();
    await eventRow.getByRole('button', { name: 'Nhầm' }).click();
    await expect(eventRow.getByRole('button', { name: 'Nhầm' })).toHaveAttribute('aria-pressed', 'true');

    const list = await api.get<GateEventPage>(jevPath(company.id, '/gate-events?verdict=deny'));
    expect(list.items.find((e) => e.command === command)?.ownerLabel).toBe('wrong');
  } finally {
    await api.raw('DELETE', `/api/agents/${agent.id}`);
  }
});

test('PW-S24-5 Bản đồ Roadmap: thẻ có lệnh Jev hiện huy hiệu đúng màu và số, người không phải owner không thấy @t1 @t1-only', async ({
  page,
  api,
  company,
}) => {
  await api.put(jevPath(company.id, '/settings'), {
    enabled: true,
    gateMode: 'enforce',
    model: 'typesafe/jev-1.14',
    threshold: 0.5,
    timeoutMs: 2500,
    serverShadow: false,
  });
  const token = uniqueToken('s24');
  const project = await createProject(api, company.id, `PW-S24 ${token}`);
  const agent = await api.post<{ id: string }>(`/api/companies/${company.id}/agents`, {
    name: `e2e-jev-map-${uniqueToken('')}`,
    role: 'general',
    adapterType: 'process',
    adapterConfig: { command: 'true', args: [] },
    runtimeConfig: { heartbeat: { enabled: false, wakeOnDemand: true } },
  });
  try {
    const root = await createIssue(api, company.id, { title: `PW-S24 yêu cầu ${token}`, projectId: project.id });
    const child = await createIssue(api, company.id, {
      title: `PW-S24 việc con ${token}`,
      projectId: project.id,
      parentId: root.id,
    });
    await waitInCompactList(api, company.id, [root.id, child.id]);
    const wake = (issueId: string) =>
      api.post<{ id: string }>(`/api/agents/${agent.id}/wakeup`, {
        source: 'on_demand',
        reason: 'e2e-jev-map',
        payload: { issueId },
        contextSnapshot: { issueId },
      });
    const [rootRun, childRun] = [await wake(root.id), await wake(child.id)];

    const row = (runId: string, verdict: 'allow' | 'deny', applied: 'allow' | 'deny') => ({
      v: 1,
      eventId: randomUUID(),
      ts: new Date().toISOString(),
      companyId: company.id,
      runId,
      agentId: agent.id,
      cwd: null,
      mode: 'enforce',
      category: verdict === 'deny' ? 'force_push' : null,
      blocking: true,
      verdict,
      applied,
      confidence: 0.9,
      reason: null,
      errorCode: null,
      latencyMs: 120,
      model: 'typesafe/jev-1.14',
      command: verdict === 'deny' ? 'git push --force origin e2e-map' : 'git status',
    });
    const sent = await signedPost(
      company.id,
      '/machine/events',
      {
        machineId: randomUUID(),
        events: [
          row(rootRun.id, 'deny', 'deny'),
          row(rootRun.id, 'allow', 'allow'),
          row(childRun.id, 'allow', 'allow'),
          row(childRun.id, 'allow', 'allow'),
          row(childRun.id, 'allow', 'allow'),
        ],
      },
      webhookSecret,
    );
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);

    const map = await api.get<{ byIssue: Record<string, { calls: number; appliedDeny: number }> }>(
      jevPath(company.id, `/requests/${root.id}/map`),
    );
    expect(map.byIssue[root.id]).toMatchObject({ calls: 2, appliedDeny: 1 });
    expect(map.byIssue[child.id]).toMatchObject({ calls: 3, appliedDeny: 0 });

    await page.goto(`${company.path('roadmap')}?project=${project.id}&request=${root.identifier}`);
    const badge = (id: string) => page.locator(`button[data-roadmap-id="${id}"] [data-slot="roadmap-jev"]`);
    await expect(badge(root.id)).toHaveAttribute('data-tone', 'blocked');
    await expect(badge(root.id)).toHaveText('1 chặn');
    await expect(badge(root.id)).toHaveAttribute('title', /Jev: 2 lệnh · 1 chặn thật/);
    await expect(badge(child.id)).toHaveAttribute('data-tone', 'quiet');
    await expect(badge(child.id)).toHaveText('3 lệnh');
    await expect(page.locator('[data-slot="roadmap-legend-jev"]')).toHaveCount(4);

    // Người không phải owner: UI không gọi API Jev và không vẽ huy hiệu (server cũng trả 403 cho họ).
    const jevRequests: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/crew/companies/') && r.url().includes('/jev/')) jevRequests.push(r.url());
    });
    await page.route(`**/api/crew/companies/${company.id}/access`, (route) =>
      route.fulfill({
        json: { userId: 'e2e-operator', membershipRole: 'operator', contributor: false, canApprove: false },
      }),
    );
    await page.reload();
    await expect(page.locator(`button[data-roadmap-id="${child.id}"]`)).toBeVisible();
    await expect(page.locator('[data-slot="roadmap-jev"]')).toHaveCount(0);
    expect(jevRequests).toEqual([]);
  } finally {
    await api.raw('DELETE', `/api/agents/${agent.id}`);
    await archiveProject(api, project.id);
  }
});

// ---------------------------------------------------------------------------------------------------------------
// Jev đợt 2: công tắc chung, bốn tính năng và cờ. Các route mới của server (judge, thống kê, ca lệch, hộp thư) được giả
// bằng page.route để ca không phụ thuộc server có đủ migration 0021 và key Jev thật; route cũ (settings, tóm tắt issue,
// bản đồ) chạy thật rồi được ghép thêm trường mới. Đặt CREW_E2E_SHOT_DIR để lưu ảnh chụp.
// ---------------------------------------------------------------------------------------------------------------

const SHOT_DIR = process.env.CREW_E2E_SHOT_DIR;

async function shot(page: Page, name: string, target?: { screenshot: Page['screenshot'] }) {
  if (!SHOT_DIR) return;
  mkdirSync(SHOT_DIR, { recursive: true });
  const file = path.join(SHOT_DIR, `${name}.png`);
  if (target) await target.screenshot({ path: file });
  else await page.screenshot({ path: file, fullPage: true });
}

const jevGlob = (companyId: string, to: string) => `**/api/crew/companies/${companyId}/jev${to}`;
const bodyOf = (route: Route) => JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>;
const NO_FEATURES = {
  complexity: 'shadow',
  approval_note: 'shadow',
  request_type: 'shadow',
  inbox_attention: 'shadow',
};

/** Giả settings: GET trả cấu hình thật ghép `enabled`/`features` đang giữ; PUT ghi nhận body và đổi trạng thái giả. */
async function mockSettings(page: Page, companyId: string, features: Record<string, string>) {
  const state = { enabled: true, features, puts: [] as Record<string, unknown>[] };
  await page.route(jevGlob(companyId, '/settings'), async (route) => {
    if (route.request().method() === 'PUT') {
      const body = bodyOf(route);
      state.puts.push(body);
      if (typeof body.enabled === 'boolean') state.enabled = body.enabled;
      if (body.features) state.features = { ...state.features, ...(body.features as Record<string, string>) };
    }
    const real = (await (await route.fetch({ method: 'GET' })).json()) as Record<string, unknown>;
    await route.fulfill({
      json: {
        ...real,
        enabled: state.enabled,
        features: state.features,
        version: Number(real.version) + state.puts.length,
      },
    });
  });
  return state;
}

const judged = (feature: string, over: Record<string, unknown>) => ({
  id: String(Math.floor(Math.random() * 1e6)),
  feature,
  issueId: null,
  mode: 'on',
  jevLabel: null,
  confidence: 0.86,
  escalated: false,
  errorCode: null,
  latencyMs: 420,
  baseline: null,
  mismatch: true,
  shown: true,
  ownerOutcome: null,
  inputExcerpt: null,
  createdAt: new Date().toISOString(),
  ...over,
});

test('PW-S24-6 Trang Jev: công tắc chung có xác nhận, đổi chế độ chỉ gửi khóa vừa đổi, thống kê và ca lệch @t1 @t1-only', async ({
  page,
  company,
}) => {
  const state = await mockSettings(page, company.id, { ...NO_FEATURES, approval_note: 'on', inbox_attention: 'off' });
  await page.route(jevGlob(company.id, '/judgments/stats*'), (route) =>
    route.fulfill({
      json: {
        days: 7,
        rows: [
          {
            feature: 'approval_note',
            mode: 'on',
            total: 12,
            mismatch: 3,
            escalated: 1,
            error: 2,
            shown: 3,
            p50Ms: 410,
            p95Ms: 980,
            outcomes: { sent: 2, changed: 1 },
          },
          {
            feature: 'complexity',
            mode: 'shadow',
            total: 31,
            mismatch: 4,
            escalated: 2,
            error: 0,
            shown: 0,
            p50Ms: 520,
            p95Ms: 1100,
            outcomes: {},
          },
        ],
      },
    }),
  );
  await page.route(jevGlob(company.id, '/judgments?*'), (route) =>
    route.fulfill({
      json: {
        items: [
          judged('complexity', {
            baseline: 'small',
            jevLabel: 'yes',
            inputExcerpt: 'Sửa bảng users, thêm cột role và migration',
          }),
          judged('complexity', {
            baseline: 'medium',
            jevLabel: 'yes',
            confidence: 0.74,
            inputExcerpt: 'Đổi hợp đồng API công khai /v1/orders',
          }),
        ],
        nextBefore: null,
      },
    }),
  );
  await page.goto(company.path('jev'));

  await expect(page.getByTestId('jev-master')).toHaveAttribute('data-enabled', 'true');
  await expect(page.getByRole('button', { name: 'Tắt toàn bộ Jev' })).toBeVisible();
  for (const id of ['complexity', 'approval_note', 'request_type', 'inbox_attention']) {
    await expect(page.getByTestId(`jev-feature-${id}`)).toBeVisible();
  }
  await expect(page.getByRole('combobox', { name: 'Chế độ của Hỏi lại lời nhắn Duyệt' })).toHaveText('Bật');
  await expect(page.getByRole('combobox', { name: 'Chế độ của Cần Đại Ca để ý' })).toHaveText('Tắt');
  await expect(page.getByTestId('jev-feature-stats-approval_note')).toContainText('12 lượt');
  await expect(page.getByTestId('jev-feature-stats-complexity')).toContainText('4 lệch');
  await expect(page.getByTestId('jev-mismatch-row')).toHaveCount(2);
  await shot(page, 'jev-page-desktop');

  // Đổi chế độ một tính năng: PUT mang đủ bốn khóa, chỉ khóa đó đổi.
  await page.getByRole('combobox', { name: 'Chế độ của Gợi ý loại yêu cầu' }).click();
  await page.getByRole('option', { name: 'Bật', exact: true }).click();
  await expect.poll(() => state.puts.length).toBe(1);
  expect(state.puts[0].features).toEqual({ request_type: 'on' });
  expect(state.puts[0].enabled).toBe(true);

  // Công tắc chung: hỏi xác nhận, rồi tắt toàn bộ.
  await page.getByRole('button', { name: 'Tắt toàn bộ Jev' }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toContainText('cổng chặn lệnh trên máy');
  await expect(confirm).toContainText('cả bốn tính năng');
  await shot(page, 'jev-master-confirm', confirm);
  expect(state.puts).toHaveLength(1);
  await confirm.getByRole('button', { name: 'Tắt toàn bộ Jev' }).click();
  await expect.poll(() => state.puts.length).toBe(2);
  expect(state.puts[1].enabled).toBe(false);
  expect(state.puts[1]).not.toHaveProperty('features');
  await expect(page.getByTestId('jev-master')).toHaveAttribute('data-enabled', 'false');
  await expect(page.getByRole('button', { name: 'Bật lại Jev' })).toBeVisible();

  // Màn hẹp.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByTestId('jev-master')).toBeVisible();
  await shot(page, 'jev-page-mobile');
});

test('PW-S24-7 Duyệt kèm lời nhắn lệch ý: Jev (chế độ on) hỏi lại một lần; Sửa lại giữ nguyên, Vẫn gửi mới duyệt @t1 @t1-only', async ({
  page,
  api,
  company,
}) => {
  const issue = await createOwnerStageIssue(api, company.id, `PW-S24-7 ${uniqueToken()}`);
  test.skip(issue === null, 'Company không có project theo dõi để dựng issue ở stage owner');
  if (!issue) return;
  const judgeBodies: Record<string, unknown>[] = [];
  const outcomes: Record<string, unknown>[] = [];
  await page.route(jevGlob(company.id, '/judge/approval-note'), (route) => {
    judgeBodies.push(bodyOf(route));
    return route.fulfill({
      json: { ok: true, mode: 'on', label: 'request_changes', confidence: 0.91, mismatch: true, judgmentId: '41' },
    });
  });
  await page.route(jevGlob(company.id, '/judgments/41/outcome'), (route) => {
    outcomes.push(bodyOf(route));
    return route.fulfill({ json: { ok: true } });
  });

  await page.goto(company.path(`issues/${issue.identifier}`));
  await page.getByRole('button', { name: 'Duyệt', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox').fill('Còn sai ở màn đăng nhập, cần sửa lại trước khi duyệt');
  await dialog.getByRole('button', { name: 'Duyệt', exact: true }).click();

  const confirm = page.getByTestId('jev-approval-confirm');
  await expect(confirm).toContainText('Lời nhắn có vẻ là: yêu cầu sửa. Vẫn duyệt?');
  expect(judgeBodies).toHaveLength(1);
  expect(judgeBodies[0]).toMatchObject({ issueId: issue.id, action: 'approve' });
  await shot(page, 'approval-confirm', confirm);
  // Chưa gửi gì: issue còn chờ duyệt.
  expect((await api.get<IssueLite>(`/api/issues/${issue.id}`)).status).toBe('in_review');

  await confirm.getByRole('button', { name: 'Sửa lại' }).click();
  await expect.poll(() => outcomes.length).toBe(1);
  expect(outcomes[0]).toEqual({ outcome: 'changed' });
  await expect(confirm).toBeHidden();
  await expect(dialog.getByRole('textbox')).toHaveValue('Còn sai ở màn đăng nhập, cần sửa lại trước khi duyệt');
  expect((await api.get<IssueLite>(`/api/issues/${issue.id}`)).status).toBe('in_review');

  await dialog.getByRole('button', { name: 'Duyệt', exact: true }).click();
  await confirm.getByRole('button', { name: 'Vẫn gửi' }).click();
  await expect.poll(async () => (await api.get<IssueLite>(`/api/issues/${issue.id}`)).status).toBe('done');
  expect(outcomes.at(-1)).toEqual({ outcome: 'sent' });
});

test('PW-S24-8 Jev chậm quá 1500 ms: duyệt đi thẳng như cũ, không hộp hỏi lại, không chờ Jev @t1 @t1-only', async ({
  page,
  api,
  company,
}) => {
  const issue = await createOwnerStageIssue(api, company.id, `PW-S24-8 ${uniqueToken()}`);
  test.skip(issue === null, 'Company không có project theo dõi để dựng issue ở stage owner');
  if (!issue) return;
  await page.route(jevGlob(company.id, '/judge/approval-note'), async (route) => {
    await new Promise((r) => setTimeout(r, 4000));
    await route
      .fulfill({
        json: { ok: true, mode: 'on', label: 'request_changes', confidence: 0.9, mismatch: true, judgmentId: '42' },
      })
      .catch(() => undefined);
  });

  await page.goto(company.path(`issues/${issue.identifier}`));
  await page.getByRole('button', { name: 'Duyệt', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox').fill('Ổn, cho push');
  const started = Date.now();
  await dialog.getByRole('button', { name: 'Duyệt', exact: true }).click();
  await expect
    .poll(async () => (await api.get<IssueLite>(`/api/issues/${issue.id}`)).status, { timeout: 3500 })
    .toBe('done');
  expect(Date.now() - started).toBeLessThan(3500);
  await expect(page.getByTestId('jev-approval-confirm')).toHaveCount(0);
});

test('PW-S24-9 Form Yêu cầu mới: chip "Jev gợi ý" hiện sau khi ngừng gõ, không tự đổi loại, bấm mới chọn; lỗi thì không hiện gì @t1 @t1-only', async ({
  page,
  api,
  company,
}) => {
  await ensureLabel(api, company.id, 'research', '#6366f1');
  const bodies: Record<string, unknown>[] = [];
  let reply: { status: number; json: unknown } = {
    status: 200,
    json: { ok: true, mode: 'on', label: 'research', confidence: 0.88, judgmentId: '51' },
  };
  await page.route(jevGlob(company.id, '/judge/request-type'), (route) => {
    bodies.push(bodyOf(route));
    return route.fulfill(reply);
  });
  const outcomes: Record<string, unknown>[] = [];
  await page.route(jevGlob(company.id, '/judgments/51/outcome'), (route) => {
    outcomes.push(bodyOf(route));
    return route.fulfill({ json: { ok: true } });
  });

  await page.goto(`${company.path('issues')}?new=1`);
  const dialog = page.getByRole('dialog', { name: 'Yêu cầu mới' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Tiêu đề').fill('So sánh hai thư viện biểu đồ cho trang báo cáo');
  // Chưa đủ 800 ms ổn định thì chưa gọi.
  expect(bodies).toHaveLength(0);
  const chip = dialog.getByTestId('jev-kind-chip');
  await expect(chip).toHaveText('Jev gợi ý: Nghiên cứu');
  expect(bodies).toHaveLength(1);
  expect(bodies[0]).toMatchObject({ title: 'So sánh hai thư viện biểu đồ cho trang báo cáo', current: 'code' });
  await expect(dialog.getByRole('combobox', { name: 'Loại' })).toHaveText('Code');
  await shot(page, 'request-type-chip', dialog);
  await chip.click();
  await expect(dialog.getByRole('combobox', { name: 'Loại' })).toHaveText('Nghiên cứu');
  await expect(chip).toHaveCount(0);

  // Jev lỗi (500): ô nhập đổi nội dung, không có chip, không có thông báo lỗi.
  reply = { status: 500, json: { error: 'Jev hỏng' } };
  await dialog.getByRole('combobox', { name: 'Loại' }).click();
  await page.getByRole('option', { name: 'Code', exact: true }).click();
  await dialog.getByLabel('Tiêu đề').fill('Thêm nút xuất báo cáo vào trang tổng quan của owner');
  await expect.poll(() => bodies.length).toBe(2);
  await page.waitForTimeout(300);
  await expect(dialog.getByTestId('jev-kind-chip')).toHaveCount(0);
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expect(dialog.getByRole('combobox', { name: 'Loại' })).toHaveText('Code');
});

test('PW-S24-10 Hộp thư: mục có lý do hiện huy hiệu "Cần Đại Ca để ý" với tooltip lý do @t1 @t1-only', async ({
  page,
  api,
  company,
}) => {
  const issue = await createOwnerStageIssue(api, company.id, `PW-S24-10 ${uniqueToken()}`);
  test.skip(issue === null, 'Company không có project theo dõi để dựng issue ở stage owner');
  if (!issue) return;
  const queries: string[] = [];
  await page.route(jevGlob(company.id, '/inbox-attention*'), (route) => {
    queries.push(route.request().url());
    return route.fulfill({
      json: {
        enabled: true,
        mode: 'on',
        items: [
          {
            issueId: issue.id,
            reasons: [
              { kind: 'owner_decision', text: 'Tổng kết có điểm cần owner quyết định.' },
              { kind: 'risky_paths', text: 'Tổng kết nhắc tới file nhạy cảm: migrations/0021_jev_features.sql.' },
            ],
          },
        ],
      },
    });
  });
  await page.goto(company.path('inbox'));
  const row = page.getByTestId('inbox-row').filter({ hasText: issue.title });
  await expect(row).toBeVisible();
  const badge = row.getByTestId('jev-attention');
  await expect(badge).toHaveText('Cần Đại Ca để ý');
  await expect(badge).toHaveAttribute('title', /điểm cần owner quyết định[\s\S]*migrations\/0021/);
  expect(queries.some((q) => q.includes(issue.id))).toBe(true);
  await shot(page, 'inbox-attention', row);
  await shot(page, 'inbox-attention-page');
});

test('PW-S24-11 Cờ complexity: trang issue và thẻ bản đồ hiện "Jev: nên là large" kèm lý do @t1 @t1-only', async ({
  page,
  api,
  company,
}) => {
  const token = uniqueToken('s24');
  const project = await createProject(api, company.id, `PW-S24 ${token}`);
  try {
    const root = await createIssue(api, company.id, { title: `PW-S24 yêu cầu ${token}`, projectId: project.id });
    const child = await createIssue(api, company.id, {
      title: `PW-S24 việc con ${token}`,
      projectId: project.id,
      parentId: root.id,
    });
    await waitInCompactList(api, company.id, [root.id, child.id]);
    const flag = {
      kind: 'jev',
      jevSaysLarge: true,
      declared: 'small',
      reason: 'Jev thấy việc này chạm bảo mật/phân quyền, migration CSDL hoặc hợp đồng API công khai.',
    };
    await page.route(jevGlob(company.id, `/requests/${root.id}/map`), async (route) => {
      const real = (await (await route.fetch()).json()) as Record<string, unknown>;
      await route.fulfill({ json: { ...real, enabled: true, complexityFlags: { [child.id]: flag } } });
    });
    await page.route(jevGlob(company.id, `/issues/${child.id}/summary`), async (route) => {
      const real = (await (await route.fetch()).json()) as Record<string, unknown>;
      await route.fulfill({ json: { ...real, enabled: true, complexityFlag: flag } });
    });

    await page.goto(`${company.path('roadmap')}?project=${project.id}&request=${root.identifier}`);
    const card = (id: string) => page.locator(`button[data-roadmap-id="${id}"]`);
    const mark = card(child.id).locator('[data-slot="roadmap-jev-complexity"]');
    await expect(mark).toHaveText('Jev: nên là large');
    await expect(mark).toHaveAttribute('title', /Trợ Lý xếp: small\. Jev thấy việc này chạm bảo mật/);
    await expect(card(root.id).locator('[data-slot="roadmap-jev-complexity"]')).toHaveCount(0);
    await expect(page.locator('[data-slot="roadmap-legend-complexity"]')).toHaveCount(1);
    await shot(page, 'roadmap-complexity-flag');

    await page.goto(company.path(`issues/${child.identifier}`));
    const block = page.getByTestId('jev-complexity-flag');
    await expect(block).toContainText('Jev: nên là large');
    await expect(block).toContainText('Trợ Lý xếp: small');
    await shot(page, 'issue-complexity-flag', block);
  } finally {
    await archiveProject(api, project.id);
  }
});

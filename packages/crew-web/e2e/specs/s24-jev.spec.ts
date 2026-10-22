// Trang Jev (S24): owner lưu key (response và DOM chỉ có vân tay), chuyển sang Chặn thật (version tăng), và một máy giả
// được ghép kéo cấu hình / đẩy sự kiện bằng chữ ký HMAC rồi trang hiện đúng số và nhãn Nhầm ghi xuống API.
// Key trong ca là chuỗi giả `sk-or-test-…`, không bao giờ là key thật. Spec điền ô key nên tắt trace (trace chụp DOM).
// Cần secret webhook biết giá trị để ghép máy, nên ca tạo secret mới và trỏ config company sang nó (trả lại cuối ca).
// Chỉ chạy ở T1: server cục bộ gọi được route máy và ca không được chạm secret webhook của prod.
import { createHmac, randomUUID } from 'node:crypto';
import { request } from '@playwright/test';
import type { Api } from '../support/api';
import { uniqueToken } from '../support/data';
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
  const webhookSecret = randomUUID() + randomUUID();
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

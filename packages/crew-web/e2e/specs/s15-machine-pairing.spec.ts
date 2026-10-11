// Ghép máy tự động (S15.4): máy giả được ghép bằng API (environment SSH tạo qua REST, key máy ra từ route ghép),
// gửi một bản tin ký bằng key máy để thẻ hiện ra; trên trang Máy owner thấy "Đã ghép", bấm Gỡ máy và xác nhận thì
// environment thành `archived`, thẻ chuyển "Đã gỡ" không còn nút, bản tin ký bằng key cũ bị từ chối. Ca thứ hai: máy
// gửi bản tin bằng secret company (chưa ghép) cũng có nút Gỡ máy; gỡ thì secret company bị từ chối và chỉ ghép lại có
// `allowRepair` mới đưa máy về.
// Cần secret webhook biết giá trị để ký, nên ca tạo secret mới và trỏ config company sang nó (trả lại config cũ cuối
// ca). Chỉ chạy ở T1: prod không được đổi secret webhook.
import { createHmac, randomUUID } from 'node:crypto';
import type { Api } from '../support/api';
import { uniqueToken } from '../support/data';
import { expect, test } from '../support/fixtures';

const FINGERPRINT = `SHA256:${'A'.repeat(43)}`;
const PLUGIN = '/api/plugins/crew.core';

interface PluginConfig {
  companies?: Array<{ companyId: string; webhookSecretRef?: unknown } & Record<string, unknown>>;
  [key: string]: unknown;
}
interface Pairing {
  pairedAt: string | null;
  revokedAt: string | null;
  environmentId: string | null;
  tailscaleIp: string | null;
}
interface MachineLite {
  machineId: string;
  hostname: string;
  pairing: Pairing | null;
}

let previousConfig: PluginConfig | null = null;
let webhookSecret = '';
let webhookSecretId = '';
let keySecretId = '';

async function createSecret(api: Api, companyId: string, name: string, value: string): Promise<string> {
  const created = await api.post<{ id: string }>(`/api/companies/${companyId}/secrets`, { name, value });
  return created.id;
}

async function setConfig(api: Api, companyId: string, configJson: PluginConfig) {
  await api.post(`${PLUGIN}/config`, { companyId, configJson });
}

/** Gửi bản tin trạng thái máy ký bằng `key`; trả mã HTTP của webhook. */
async function sendStatus(api: Api, companyId: string, machineId: string, hostname: string, key: string) {
  const now = new Date();
  const raw = JSON.stringify({
    version: 1,
    companyId,
    machineId,
    hostname,
    sentAt: now.toISOString(),
    load1: 0.4,
    cpuCount: 8,
    memFreePct: 60,
    tccPending: [],
    claude: { version: '2.1.294', loggedIn: true, plan: 'max' },
    superpowers: { pinned: '6.4.1', ownerInstalled: '6.4.1' },
    checks: [],
  });
  const timestamp = String(Math.floor(now.getTime() / 1000));
  const signature = `sha256=${createHmac('sha256', key).update(timestamp).update('.').update(raw).digest('hex')}`;
  const res = await api.ctx.fetch(`${PLUGIN}/webhooks/machine-status`, {
    method: 'POST',
    data: raw,
    headers: { 'content-type': 'application/json', 'x-crew-timestamp': timestamp, 'x-crew-signature': signature },
  });
  return res.status();
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ api, company }) => {
  const config = await api
    .get<{ configJson: PluginConfig } | null>(`${PLUGIN}/config?companyId=${company.id}`)
    .catch(() => null);
  previousConfig = config?.configJson ?? null;
  webhookSecret = randomUUID() + randomUUID();
  webhookSecretId = await createSecret(api, company.id, `e2e-pair-webhook-${uniqueToken('')}`, webhookSecret);
  const ref = { type: 'secret_ref', secretId: webhookSecretId, version: 'latest' };
  const others = (previousConfig?.companies ?? []).filter((c) => c.companyId !== company.id);
  const own = (previousConfig?.companies ?? []).find((c) => c.companyId === company.id) ?? { companyId: company.id };
  await setConfig(api, company.id, {
    ...(previousConfig ?? {}),
    companies: [...others, { ...own, webhookSecretRef: ref }],
  });
  keySecretId = await createSecret(api, company.id, `e2e-pair-key-${uniqueToken('')}`, 'e2e-not-a-real-private-key');
});

test.afterAll(async ({ api, company }) => {
  // Trả config cũ để ca khác dùng lại secret webhook ban đầu; secret tạm của ca chỉ còn là secret mồ côi.
  if (previousConfig) await setConfig(api, company.id, previousConfig).catch(() => undefined);
  for (const id of [webhookSecretId, keySecretId]) if (id) await api.raw('DELETE', `/api/secrets/${id}`);
});

test('PW-S15-PAIR Ghép máy: thẻ "Đã ghép", Gỡ máy archive environment, thẻ "Đã gỡ" @t1 @t1-only', async ({
  page,
  api,
  company,
}) => {
  const hostname = `e2e-mac-${uniqueToken('')}`;
  const machineId = randomUUID();

  const env = await api.post<{ id: string }>(`/api/companies/${company.id}/environments`, {
    name: `e2e-pair-${hostname}`,
    description: 'Environment tạm của ca ghép máy',
    driver: 'ssh',
    config: {
      host: '100.64.0.9',
      port: 2222,
      username: 'e2e',
      remoteWorkspacePath: '/Users/e2e/crew-agents/e2e-pair',
      privateKeySecretRef: { type: 'secret_ref', secretId: keySecretId, version: 'latest' },
      knownHosts: '',
      strictHostKeyChecking: false,
    },
    metadata: { workspaceRealizationMode: 'in_place' },
  });

  const pairBody = {
    companyId: company.id,
    machineId,
    hostname,
    environmentId: env.id,
    tailscaleIp: '100.64.0.9',
    port: 2222,
    hostKeyFingerprint: FINGERPRINT,
  };
  const paired = await api.crewRoute<{ machineKey: string; pairedAt: string }>('POST', '/machines/pair', pairBody);
  expect(paired.machineKey.length).toBeGreaterThan(20);
  expect(await sendStatus(api, company.id, machineId, hostname, paired.machineKey)).toBe(200);

  await page.goto(company.path('machines'));
  const card = page.locator('[data-slot="machine-card"]').filter({ hasText: hostname });
  await expect(card).toBeVisible();
  await expect(card.getByText(/^Đã ghép \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/)).toBeVisible();
  await expect(card.getByText(/^Đã gỡ/)).toHaveCount(0);

  await card.getByRole('button', { name: 'Gỡ máy' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog.getByText(/sẽ không nhận run mới và bản tin của nó bị từ chối/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Gỡ máy' }).click();

  await expect(card.getByText(/^Đã gỡ \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/)).toBeVisible();
  await expect(card.getByRole('button', { name: 'Gỡ máy' })).toHaveCount(0);
  await expect(card.getByText(/^Đã ghép/)).toHaveCount(0);

  const archived = await api.get<{ id: string; status: string }>(`/api/environments/${env.id}`);
  expect(archived.status).toBe('archived');
  const machines = await api.crewData<MachineLite[]>('crew.machines', company.id);
  const row = machines.find((m) => m.machineId === machineId);
  expect(row?.pairing?.revokedAt).toBeTruthy();
  expect(row?.pairing?.environmentId).toBe(env.id);

  // Key đã thu hồi: bản tin của máy bị từ chối.
  expect(await sendStatus(api, company.id, machineId, hostname, paired.machineKey)).toBeGreaterThanOrEqual(400);
  // Máy đã gỡ không tự ghép lại được: thiếu `allowRepair` (chỉ owner chủ động gửi) thì 409.
  const repair = await api.raw('POST', `${PLUGIN}/api/machines/pair`, pairBody);
  expect(repair.status).toBe(409);
  expect((repair.body as { code?: string }).code).toBe('machine_revoked');
  // Gỡ máy không có trong company (chưa từng gửi bản tin, chưa ghép) là 404, không phải thành công.
  const unknown = await api.raw('POST', `${PLUGIN}/api/machines/${randomUUID()}/unpair`, { companyId: company.id });
  expect(unknown.status).toBe(404);
});

test('PW-S15-PAIR Gỡ máy chưa ghép (dùng secret company): bản tin bị chặn, ghép lại cần allowRepair @t1 @t1-only', async ({
  page,
  api,
  company,
}) => {
  const hostname = `e2e-mini-${uniqueToken('')}`;
  const machineId = randomUUID();
  expect(await sendStatus(api, company.id, machineId, hostname, webhookSecret)).toBe(200);

  await page.goto(company.path('machines'));
  const card = page.locator('[data-slot="machine-card"]').filter({ hasText: hostname });
  await expect(card).toBeVisible();
  await expect(card.getByText(/^Đã (ghép|gỡ)/)).toHaveCount(0);

  await card.getByRole('button', { name: 'Gỡ máy' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog.getByText(/đang gửi bản tin bằng secret chung của company/)).toBeVisible();
  await expect(dialog.getByText(/bấm "Ghép lại"/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Gỡ máy' }).click();

  await expect(card.getByText(/^Đã gỡ \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/)).toBeVisible();
  await expect(card.getByRole('button', { name: 'Gỡ máy' })).toHaveCount(0);
  const machines = await api.crewData<MachineLite[]>('crew.machines', company.id);
  const row = machines.find((m) => m.machineId === machineId);
  expect(row?.pairing).toMatchObject({ pairedAt: null, environmentId: null, tailscaleIp: null });
  expect(row?.pairing?.revokedAt).toBeTruthy();

  // Secret company không còn được nhận cho máy này.
  expect(await sendStatus(api, company.id, machineId, hostname, webhookSecret)).toBeGreaterThanOrEqual(400);
  const pairBody = {
    companyId: company.id,
    machineId,
    hostname,
    environmentId: randomUUID(),
    tailscaleIp: '100.64.0.10',
    port: 2222,
    hostKeyFingerprint: FINGERPRINT,
  };
  const refused = await api.raw('POST', `${PLUGIN}/api/machines/pair`, pairBody);
  expect(refused.status).toBe(409);
  expect((refused.body as { code?: string }).code).toBe('machine_revoked');
  // "Ghép lại" từ app (owner chủ động) là ghép như thường: key máy mới được nhận, secret company thì không.
  const repaired = await api.crewRoute<{ machineKey: string }>('POST', '/machines/pair', {
    ...pairBody,
    allowRepair: true,
  });
  expect(await sendStatus(api, company.id, machineId, hostname, repaired.machineKey)).toBe(200);
  expect(await sendStatus(api, company.id, machineId, hostname, webhookSecret)).toBeGreaterThanOrEqual(400);
  await page.reload();
  await expect(card.getByText(/^Đã ghép \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/)).toBeVisible();
});

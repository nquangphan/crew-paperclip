// Wizard Tạo agent cho project thêm từ app Mac (không có lần thêm project): máy và folder repo tự điền theo agent vai
// trò đang có. Máy giả được ghép cặp bằng API (IP Tailscale = host SSH của environment agent) rồi gửi bản tin có checkout
// `~/crew-agents/<khóa>/<ô>`; ca đóng vai app Mac nhận việc `inspect-folder` của form và trả đúng lỗi worktree phụ mà app
// hiện tại trả. Không bấm Bắt đầu (T1 không có Mac thật). Chỉ chạy ở T1: tạo máy, project, agent thử.
import { createHmac, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { crewAgentCreateBody } from '../../src/lib/instructions/agent-config';
import type { Api } from '../support/api';
import { uniqueToken } from '../support/data';
import { expect, test } from '../support/fixtures';

const PLUGIN = '/api/plugins/crew.core';
const FINGERPRINT = `SHA256:${'A'.repeat(43)}`;
const HOME = '/Users/e2e';
const PIN = `${HOME}/.crew/workflows/superpowers/1.0.0`;
const ROLES = ['assistant', 'executor', 'reviewer', 'integrator'] as const;
/** Ảnh nghiệm thu: ngoài repo, thư mục plan của ticket. */
const SHOT_DIR = join(homedir(), 'Documents/projects/crew/plans/261012-2335-add-agent-autofill');

interface Job {
  id: string;
  kind: string;
  claimedAt: string | null;
  payload: { folder?: string };
}

/** Bản tin máy ký bằng key máy (route ghép trả), có checkout của project và bản ghim Superpowers. */
async function sendStatus(
  api: Api,
  companyId: string,
  machineId: string,
  hostname: string,
  key: string,
  paths: string[],
) {
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
    superpowers: { pinned: '1.0.0', ownerInstalled: '1.0.0', pinDir: PIN },
    checks: [],
    checkouts: paths.map((path) => ({ path, head: null, clean: true })),
  });
  const timestamp = String(Math.floor(now.getTime() / 1000));
  const signature = `sha256=${createHmac('sha256', key).update(timestamp).update('.').update(raw).digest('hex')}`;
  const res = await api.ctx.fetch(`${PLUGIN}/webhooks/machine-status`, {
    method: 'POST',
    data: raw,
    headers: { 'content-type': 'application/json', 'x-crew-timestamp': timestamp, 'x-crew-signature': signature },
  });
  expect(res.status()).toBe(200);
}

test('PW-S13-AUTOFILL Tạo agent: máy và folder repo tự điền từ agent vai trò, không phải nhập @t1 @t1-only', async ({
  page,
  api,
  company,
}) => {
  const token = uniqueToken('');
  const key = `e2e-af${token}`.slice(0, 31);
  const hostname = `e2e-macbook-${token}`;
  const machineId = randomUUID();
  const ip = `100.100.${Math.floor(Math.random() * 200) + 20}.${Math.floor(Math.random() * 200) + 20}`;
  const root = `${HOME}/Documents/projects/${key.replace(/-/g, '_')}`;
  const checkout = (role: string) => `${HOME}/crew-agents/${key}/${role}`;
  const secret = await api.post<{ id: string }>(`/api/companies/${company.id}/secrets`, {
    name: `e2e-af-key-${token}`,
    value: 'e2e-not-a-real-private-key',
  });
  const sshEnv = (name: string, path: string) =>
    api.post<{ id: string }>(`/api/companies/${company.id}/environments`, {
      name,
      driver: 'ssh',
      config: {
        host: ip,
        port: 2222,
        username: 'e2e',
        remoteWorkspacePath: path,
        privateKeySecretRef: { type: 'secret_ref', secretId: secret.id, version: 'latest' },
        knownHosts: `[${ip}]:2222 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIE2e`,
        strictHostKeyChecking: true,
      },
      metadata: { workspaceRealizationMode: 'in_place' },
    });

  const created: { project?: string; agents: string[]; envs: string[] } = { agents: [], envs: [] };
  try {
    // Máy ghép cặp: environment ghép cặp + IP Tailscale; bản tin báo 4 checkout của project.
    const pairEnv = await sshEnv(`e2e-af-pair-${token}`, HOME);
    created.envs.push(pairEnv.id);
    const paired = await api.crewRoute<{ machineKey: string }>('POST', '/machines/pair', {
      companyId: company.id,
      machineId,
      hostname,
      environmentId: pairEnv.id,
      tailscaleIp: ip,
      port: 2222,
      hostKeyFingerprint: FINGERPRINT,
    });
    await sendStatus(api, company.id, machineId, hostname, paired.machineKey, ROLES.map(checkout));

    // Project như project thêm từ app Mac: 4 agent vai trò, environment trỏ checkout trên máy, không có setup run.
    const project = await api.post<{ id: string }>(`/api/companies/${company.id}/projects`, { name: `E2E ${key}` });
    created.project = project.id;
    const ids: Record<string, string> = {};
    for (const role of ROLES) {
      const env = await sshEnv(`${key}-${role}`, checkout(role));
      created.envs.push(env.id);
      const name = `${key}-${role}`;
      const agent = await api.post<{ id: string }>(
        `/api/companies/${company.id}/agents`,
        crewAgentCreateBody({ name, role, model: 'claude-sonnet-5', pinDir: PIN, environmentId: env.id }),
      );
      created.agents.push(agent.id);
      ids[role] = agent.id;
    }
    await api.post(`${PLUGIN}/api/projects/${project.id}/roles`, {
      companyId: company.id,
      assistantAgentId: ids.assistant,
      executorAgentIds: [ids.executor],
      reviewerAgentId: ids.reviewer,
      integratorAgentId: ids.integrator,
    });

    await page.goto(company.path(`agents/new?project=${project.id}&slot=executor-2`));
    const folder = page.getByLabel('Folder repo trên máy');
    await expect(page.getByText(`Đang hỏi máy repo gốc của checkout ${checkout('assistant')}…`)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Bắt đầu' })).toBeDisabled();

    // Đóng vai app Mac: nhận việc form vừa xếp, trả lỗi worktree phụ như app hiện tại.
    let job: Job | null = null;
    await expect
      .poll(async () => {
        const claimed = await api.raw('POST', `${PLUGIN}/api/machine-jobs/claim`, { companyId: company.id, machineId });
        if (claimed.status === 200) job = claimed.body as Job;
        return job?.kind ?? null;
      })
      .toBe('inspect-folder');
    if (!job) throw new Error('không nhận được việc inspect-folder');
    const claimedJob: Job = job;
    expect(claimedJob.payload.folder).toBe(checkout('assistant'));
    await api.crewRoute('POST', `/machine-jobs/${claimedJob.id}/result`, {
      companyId: company.id,
      machineId,
      claimedAt: claimedJob.claimedAt,
      status: 'failed',
      errorCode: 'folder_not_git',
      errorText: `${checkout('assistant')} là worktree phụ của repo ${root}: chọn thư mục repo chính (worktree chính)`,
    });

    await expect(folder).toHaveValue(root);
    await expect(folder).toHaveAttribute('readonly', '');
    await expect(
      page.getByText(`Repo gốc của checkout ${checkout('assistant')} trên máy, không cần nhập.`),
    ).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Máy' })).toContainText(hostname);
    await expect(page.getByText('Máy đang chạy các agent của project.')).toBeVisible();
    await expect(page.getByLabel('Khóa project')).toHaveValue(key);
    await expect(page.getByLabel('Tên agent')).toHaveValue(`${key}-executor-2`);
    await expect(page.getByRole('button', { name: 'Bắt đầu' })).toBeEnabled();
    mkdirSync(SHOT_DIR, { recursive: true });
    await page.locator('form').screenshot({ path: join(SHOT_DIR, 'add-agent-autofill.png') });
  } finally {
    if (created.project) {
      await api.raw('DELETE', `${PLUGIN}/api/projects/${created.project}/roles?companyId=${company.id}`);
      await api.raw('PATCH', `/api/projects/${created.project}`, { archivedAt: new Date().toISOString() });
    }
    for (const id of created.agents) await api.raw('POST', `/api/agents/${id}/pause`, {});
    await api.raw('POST', `${PLUGIN}/api/machines/${machineId}/unpair`, { companyId: company.id });
    for (const id of created.envs) await api.raw('PATCH', `/api/environments/${id}`, { status: 'archived' });
  }
});

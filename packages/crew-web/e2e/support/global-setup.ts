// Chạy một lần trước lượt: đăng nhập bằng form, lưu storageState; ở T2 kiểm project nền `e2e-base` và bật stub cho
// các project có trong crew.setupRuns của company e2e. T3 chạy claude thật nên gỡ mọi marker còn sót (lượt T2 bị
// ngắt không chạy teardown) và dừng lượt nếu vẫn còn marker.
import { type Browser, chromium, type FullConfig } from '@playwright/test';
import { type Api, boardApi } from './api';
import { BASE_PROJECT_KEY, baseUrl, companyId, storageStatePath, tier } from './env';
import type { E2eCompany } from './fixtures';
import { loginAndSaveState } from './login';
import { addProjectViaWizard } from './r3x-project';
import { stub } from './stub';

interface SetupRunRow {
  id: string;
  kind: string;
  status: string;
  projectKey: string;
  projectId: string | null;
}

/** Project nền: setup run add-project khóa `e2e-base` đã `done` và project chưa archive. Trả projectId hoặc null. */
export async function findBaseProject(api: Api): Promise<string | null> {
  const runs = await api.crewData<SetupRunRow[]>('crew.setupRuns', companyId(), {
    kind: 'add-project',
    status: 'done',
  });
  // Mới nhất trước: project nền đã gỡ (archive) rồi dựng lại thì chỉ lấy bản còn sống.
  const candidates = runs.filter((r) => r.projectKey === BASE_PROJECT_KEY && r.projectId);
  for (const r of candidates) {
    const res = await api.raw('GET', `/api/projects/${r.projectId}`);
    if (res.status >= 400) continue;
    if (!(res.body as { archivedAt?: string | null } | null)?.archivedAt) return r.projectId;
  }
  return null;
}

/** Khóa project (dạng e2e-*) của mọi setup run trong company e2e. */
export async function companyProjectKeys(api: Api): Promise<string[]> {
  const runs = await api.crewData<SetupRunRow[]>('crew.setupRuns', companyId(), {});
  return [...new Set(runs.map((r) => r.projectKey).filter((k) => typeof k === 'string' && /^e2e-/.test(k)))].sort();
}

/** Dựng `e2e-base` (folder ~/crew-e2e/repo, 2 executor) bằng wizard Thêm project trên UI rồi chờ bước `check` xong. */
async function runAddProjectWizard(api: Api, browser: Browser): Promise<string> {
  const c = await api.get<{ id: string; name: string; issuePrefix: string }>(`/api/companies/${companyId()}`);
  const company: E2eCompany = { ...c, path: (to = '') => `/${c.issuePrefix}${to ? `/${to.replace(/^\//, '')}` : ''}` };
  const context = await browser.newContext({ baseURL: baseUrl(), storageState: storageStatePath() });
  try {
    const page = await context.newPage();
    const made = await addProjectViaWizard(page, api, company, { key: BASE_PROJECT_KEY, name: 'E2E base' });
    return made.projectId;
  } finally {
    await context.close();
  }
}

/** Đảm bảo có project nền còn sống (dựng lại bằng wizard khi đã gỡ), trả khóa project e2e-* của company. */
async function prepareT2(browser: Browser): Promise<string[]> {
  const api = await boardApi();
  try {
    const projectId = (await findBaseProject(api)) ?? (await runAddProjectWizard(api, browser));
    process.env.CREW_E2E_BASE_PROJECT_ID = projectId;
    return await companyProjectKeys(api);
  } finally {
    await api.dispose();
  }
}

export default async function globalSetup(_config: FullConfig): Promise<void> {
  const browser = await chromium.launch();
  let keys: string[] = [];
  try {
    const page = await browser.newPage({ baseURL: baseUrl() });
    await loginAndSaveState(page);
    if (tier() === 't2') keys = await prepareT2(browser);
  } finally {
    await browser.close();
  }
  if (tier() === 't3') {
    stub.offAll();
    const left = stub.stillOn();
    if (left.length) {
      throw new Error(`T3 chạy claude thật nhưng còn marker stub: ${left.map((c) => c.checkout).join(', ')}`);
    }
    console.log('global-setup: T3, 0 marker stub trước khi chạy');
    return;
  }
  if (tier() !== 't2') return;
  // Chỉ project của company e2e: project thật khóa `e2e-*` thêm từ app không bị bật stub.
  const onDisk = new Set(stub.projectKeys());
  for (const key of keys) if (onDisk.has(key)) stub.on(key, 5);
}

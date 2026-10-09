// Chạy một lần trước lượt: đăng nhập bằng form, lưu storageState; ở T2 kiểm project nền `e2e-base` và bật stub cho
// các project có trong crew.setupRuns của company e2e. T3 chạy claude thật nên gỡ mọi marker còn sót (lượt T2 bị
// ngắt không chạy teardown) và dừng lượt nếu vẫn còn marker.
import { chromium, type FullConfig } from '@playwright/test';
import { type Api, boardApi } from './api';
import { BASE_PROJECT_KEY, baseUrl, companyId, tier } from './env';
import { loginAndSaveState } from './login';
import { stub } from './stub';

interface SetupRunRow {
  id: string;
  kind: string;
  status: string;
  projectKey: string;
  projectId: string | null;
}

/** Project nền: setup run add-project khóa `e2e-base` đã `done`. Trả projectId hoặc null. */
export async function findBaseProject(api: Api): Promise<string | null> {
  const runs = await api.crewData<SetupRunRow[]>('crew.setupRuns', companyId(), {
    kind: 'add-project',
    status: 'done',
  });
  const done = runs.find((r) => r.projectKey === BASE_PROJECT_KEY && r.projectId);
  return done?.projectId ?? null;
}

/** Khóa project (dạng e2e-*) của mọi setup run trong company e2e. */
export async function companyProjectKeys(api: Api): Promise<string[]> {
  const runs = await api.crewData<SetupRunRow[]>('crew.setupRuns', companyId(), {});
  return [...new Set(runs.map((r) => r.projectKey).filter((k) => typeof k === 'string' && /^e2e-/.test(k)))].sort();
}

/**
 * Dựng `e2e-base` (folder ~/crew-e2e/repo, 2 executor) bằng wizard Thêm project trên UI rồi chờ bước `check` xong.
 * Bộ chọn phần tử phụ thuộc màn hình wizard; ca wizard (s9-add-project.spec.ts) nối hàm này khi màn hình có.
 */
async function runAddProjectWizard(): Promise<string> {
  throw new Error(
    `Chưa có project ${BASE_PROJECT_KEY} trong company e2e và harness chưa nối wizard Thêm project. ` +
      'Dựng project nền bằng wizard trên UI (khóa e2e-base, folder ~/crew-e2e/repo, 2 executor) rồi chạy lại.',
  );
}

export default async function globalSetup(_config: FullConfig): Promise<void> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ baseURL: baseUrl() });
    await loginAndSaveState(page);
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
  const api = await boardApi();
  let keys: string[];
  try {
    const projectId = (await findBaseProject(api)) ?? (await runAddProjectWizard());
    process.env.CREW_E2E_BASE_PROJECT_ID = projectId;
    keys = await companyProjectKeys(api);
  } finally {
    await api.dispose();
  }
  // Chỉ project của company e2e: project thật khóa `e2e-*` thêm từ app không bị bật stub.
  const onDisk = new Set(stub.projectKeys());
  for (const key of keys) if (onDisk.has(key)) stub.on(key, 5);
}

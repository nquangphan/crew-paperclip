// Chạy một lần trước lượt: đăng nhập bằng form, lưu storageState; ở T2 kiểm project nền `e2e-base` và bật stub cho
// mọi checkout e2e-* (T3 chạy claude thật nên không bật stub).
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
  if (tier() !== 't2') return;
  const api = await boardApi();
  try {
    const projectId = (await findBaseProject(api)) ?? (await runAddProjectWizard());
    process.env.CREW_E2E_BASE_PROJECT_ID = projectId;
  } finally {
    await api.dispose();
  }
  for (const key of stub.projectKeys()) stub.on(key, 5);
}

// Sau lượt: tắt stub cho mọi checkout e2e-* (để không còn marker nào khi xong), rồi archive project rác và terminate
// agent của chúng trong company e2e. Lỗi dọn chỉ ghi cảnh báo, không làm lượt fail.
import { boardApi } from './api';
import { BASE_PROJECT_KEY, companyId, tier } from './env';
import { sweepJunk } from './junk-projects';
import { stub } from './stub';

async function sweep(): Promise<void> {
  const api = await boardApi();
  try {
    const r = await sweepJunk(api, companyId(), {
      projectId: process.env.CREW_E2E_BASE_PROJECT_ID,
      key: BASE_PROJECT_KEY,
    });
    console.log(`global-teardown: archive ${r.archived} project, terminate ${r.terminated} agent rác`);
    for (const w of r.warnings) console.warn(`global-teardown: cảnh báo dọn rác: ${w}`);
  } finally {
    await api.dispose();
  }
}

export default async function globalTeardown(): Promise<void> {
  if (tier() !== 't1') stub.offAll();
  try {
    await sweep();
  } catch (e) {
    console.warn(`global-teardown: bỏ qua dọn rác: ${e instanceof Error ? e.message : String(e)}`);
  }
}

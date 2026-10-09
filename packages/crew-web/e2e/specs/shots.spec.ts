// Chụp ảnh cho trang Hướng dẫn. Chỉ chạy khi gọi rõ: CREW_E2E_SHOTS=1 run-e2e.sh --project=t2 --grep @shots.
import { test } from '../support/fixtures';
import { SHOT_PAGES, shoot } from '../support/shots';

test.skip(process.env.CREW_E2E_SHOTS !== '1', 'Chỉ chụp khi CREW_E2E_SHOTS=1');

for (const [name, to] of Object.entries(SHOT_PAGES)) {
  test(`chụp ${name} @shots`, async ({ page, company }) => {
    await page.goto(company.path(to));
    await shoot(page, name);
  });
}

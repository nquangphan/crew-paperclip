// S6.1 bản đồ yêu cầu Crew ở trang chi tiết ticket, vẽ như bản đồ Roadmap: yêu cầu gốc ở tâm, việc con tỏa quanh,
// việc đang xem được tô, chú giải có cạnh chặn và vòng sửa, bấm thẻ mở đúng issue. Ca chỉ đọc: dùng một yêu cầu Crew có
// sẵn trong company e2e (dựng yêu cầu Crew mới sẽ đánh thức agent thật); không có thì bỏ qua.
import type { CrewMap, CrewRoot } from '@crew/paperclip-plugin/shared/map';
import { expect, test } from '../support/fixtures';

test('PW-S6-MAP-1 bản đồ Crew ở chi tiết việc con: thẻ Roadmap, tô việc đang xem, chú giải, bấm thẻ mở issue @t1', async ({
  page,
  api,
  company,
}) => {
  const roots = await api.crewData<CrewRoot[]>('crew.roots', company.id);
  const root = roots.find((r) => r.totalChildren > 0);
  test.skip(!root, 'Company e2e chưa có yêu cầu Crew nào có việc con');
  if (!root) return;
  const map = await api.crewData<CrewMap>('crew.map', company.id, { issueId: root.id });
  const child = map.nodes.find((n) => n.id !== root.id) as CrewMap['nodes'][number];

  await page.goto(company.path(`issues/${child.identifier}`));
  await page.getByRole('button', { name: 'Mở map' }).click();
  const canvas = page.locator('[data-slot="crew-map"] [data-slot="roadmap-canvas"]');
  await expect(canvas).toBeVisible();
  // Màn rộng: ô soạn vẫn dính đáy khung cuộn.
  await expect(page.locator('[data-slot="composer-dock"]')).toHaveCSS('position', 'sticky');

  const cards = canvas.locator('button[data-roadmap-id]');
  await expect(cards).toHaveCount(map.nodes.length);
  const center = canvas.locator(`button[data-roadmap-id="${root.id}"]`);
  await expect(center).toHaveAttribute('data-center', 'true');
  await expect(center).toHaveAttribute('data-roadmap-kind', 'request');
  const current = canvas.locator(`button[data-roadmap-id="${child.id}"]`);
  await expect(current).toHaveAttribute('aria-current', 'true');
  // Camera canh vào việc đang xem ở độ phóng đọc được, và focus về thẻ đó.
  await expect(current).toBeInViewport();
  await expect(current).toBeFocused();
  await expect(current).toHaveAttribute('title', new RegExp(`^${child.identifier} · `));

  const legend = page.locator('[data-slot="crew-map"]').getByRole('region', { name: 'Chú thích' });
  for (const item of ['Cha → con', 'Chặn (phải xong trước)', 'Vòng sửa', 'Việc đang xem']) {
    await expect(legend.getByText(item, { exact: true })).toBeAttached();
  }

  await center.click();
  await expect(page).toHaveURL(new RegExp(`/${company.issuePrefix}/issues/${root.identifier}$`));
});

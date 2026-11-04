// Luồng ticket tổng code-bf trên crew-web (spec TPS-643 mục 11, tiêu chí 3, 5, 10, 12): dải 4 giai đoạn có "Review Bug
// Finding", khối Bug Finding (tiến độ lane + ba nhóm triage), màn duyệt "Duyệt và merge"; ticket policy `code` cũ giữ
// nút "Duyệt" và không gọi route Bug Finding.
import { expect, type Page, test } from '@playwright/test';
import { HEAD2, stubApi } from './stub';

const open = (page: Page) => page.goto('/TPS/issues/TPS-645');

test.describe('ticket tổng code-bf (root-bf)', () => {
  test('dải 4 giai đoạn, bước "Review Bug Finding" đang ở đây, tiến độ lane và ba nhóm triage', async ({ page }) => {
    const stub = await stubApi(page, { kind: 'code-bf', position: 1, bugFinding: 'running' });
    await open(page);

    const strip = page.getByRole('list', { name: 'Giai đoạn' });
    await expect(strip.getByRole('listitem')).toHaveCount(4);
    const items = strip.getByRole('listitem');
    await expect(items.nth(0)).toContainText('1. Gộp code + PR');
    await expect(items.nth(1)).toContainText('2. Review Bug Finding');
    await expect(items.nth(2)).toContainText('3. Owner duyệt');
    await expect(items.nth(3)).toContainText('4. Merge');
    await expect(items.nth(0)).toHaveAttribute('data-state', 'done');
    await expect(items.nth(1)).toHaveAttribute('aria-current', 'step');
    await expect(items.nth(1)).toContainText('Lượt 2 / tối đa 3');
    await expect(items.nth(2)).toHaveAttribute('data-state', 'waiting');

    const running = page.getByRole('region', { name: 'Bug Finding lượt 2' });
    const bar = running.getByRole('progressbar', { name: 'Tiến độ lane' });
    await expect(bar).toHaveAttribute('aria-valuenow', '4');
    await expect(bar).toHaveAttribute('aria-valuemax', '7');
    await expect(running.getByText('4/7 lane xong')).toBeVisible();
    await expect(page.getByText('Lô sửa tự động: 1 / tối đa 2')).toBeVisible();

    const first = page.getByRole('region', { name: 'Bug Finding lượt 1' });
    await expect(first.getByText('BLOCK')).toBeVisible();
    const fix = first.getByRole('table', { name: 'Trợ Lý tự sửa (2)' });
    await expect(fix).toContainText('Lọc ngày dùng giờ máy');
    await expect(fix).toContainText('TPS-651');
    await expect(first.getByRole('table', { name: 'Cần owner chốt (1)' })).toContainText('Có cần giới hạn 12 tháng?');
    await expect(first.getByRole('table', { name: 'Trợ Lý bỏ qua (1)' })).toContainText(
      'Có từ trước PR này, ngoài phạm vi yêu cầu.',
    );
    expect(stub.bugFindingCalls[0]).toBe('?companyId=c1');
    await page.screenshot({
      path: process.env.CREW_E2E_SHOT_DIR ? `${process.env.CREW_E2E_SHOT_DIR}/code-bf-running.png` : undefined,
    });
  });

  test('owner duyệt: nút "Duyệt và merge" mở màn duyệt có kết quả Bug Finding trên đúng commit và gửi done', async ({
    page,
  }) => {
    const stub = await stubApi(page, { kind: 'code-bf', position: 2, bugFinding: 'approved' });
    await open(page);

    await expect(page.getByRole('button', { name: 'Duyệt và merge' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Duyệt', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Duyệt và merge' }).click();

    const dialog = page.getByRole('dialog', { name: 'Duyệt và merge yêu cầu này?' });
    await expect(dialog).toContainText('integrator merge PR #87');
    const card = dialog.getByRole('region', { name: 'Bug Finding' });
    await expect(card.getByText('APPROVE')).toBeVisible();
    await expect(
      card.getByText(new RegExp(`lượt 2 trên ${HEAD2.slice(0, 12)} \\(đúng commit sẽ merge\\)`)),
    ).toBeVisible();
    await expect(card.getByText('FIX_VERIFIED')).toBeVisible();
    await expect(card.getByText('Trợ Lý sửa · TPS-651')).toBeVisible();
    await page.screenshot({
      path: process.env.CREW_E2E_SHOT_DIR ? `${process.env.CREW_E2E_SHOT_DIR}/code-bf-approve.png` : undefined,
    });

    await dialog.getByRole('button', { name: 'Duyệt và merge' }).click();
    await expect.poll(() => stub.writes.length).toBe(1);
    expect(stub.writes[0]?.method).toBe('PATCH');
    expect(stub.writes[0]?.body).toMatchObject({ status: 'done' });
  });
});

test.describe('ticket policy code cũ', () => {
  test('giữ nút "Duyệt", không có dải Bug Finding và không gọi route Bug Finding', async ({ page }) => {
    const stub = await stubApi(page, { kind: 'code', position: 2 });
    await open(page);

    await expect(page.getByRole('button', { name: 'Duyệt', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Duyệt và merge' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Duyệt', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: /Duyệt yêu cầu này/ });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('region', { name: 'Bug Finding' })).toHaveCount(0);
    await expect(page.getByText(/1\/2 con xong|2\/2 con xong/)).toBeVisible();
    await expect(page.getByRole('list', { name: 'Giai đoạn' })).toHaveCount(0);
    expect(stub.bugFindingCalls).toEqual([]);
    await page.screenshot({
      path: process.env.CREW_E2E_SHOT_DIR ? `${process.env.CREW_E2E_SHOT_DIR}/code-legacy-approve.png` : undefined,
    });
  });
});

// S6.20 Thêm việc con vào yêu cầu gốc Crew: nút trên trang chi tiết và popup, dialog như Yêu cầu mới (tiêu đề, mô tả,
// đính kèm), việc con chưa giao ai dưới gốc và một bình luận báo Trợ Lý trên gốc. Ca @t1 chạy ở stack cục bộ với agent
// giữ chỗ tắt wake, nên chỉ kiểm giao diện và dữ liệu; việc server gắn policy việc con và đánh thức Trợ Lý do test DB
// `server/src/__tests__/crew-board-child.db.test.ts` khóa.
import type { Page, TestInfo } from '@playwright/test';
import { trackIssue } from '../support/cleanup';
import { archiveProject, createProject, ensurePlaceholderAgent, type IssueLite, uniqueToken } from '../support/data';
import { expect, test } from '../support/fixtures';

type Stage = { type: string; participants: { type: string; agentId?: string | null }[] };
type Child = IssueLite & {
  assigneeAgentId: string | null;
  createdByUserId: string | null;
  description: string | null;
  executionPolicy: { stages: Stage[] } | null;
};

/** Ảnh kèm kết quả ca (thư mục test-results của ca). */
async function shot(page: Page, info: TestInfo, name: string) {
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await info.attach(name, { path, contentType: 'image/png' });
}

/** Yêu cầu gốc Crew do board tạo, giao agent giữ chỗ (không chạy) làm Trợ Lý. */
async function crewRoot(
  api: Parameters<typeof createProject>[0],
  companyId: string,
  projectId: string,
  status = 'todo',
) {
  const assistant = await ensurePlaceholderAgent(api, companyId, 'crew-e2e-worker', { wake: false });
  const root = await api.post<IssueLite & { executionPolicy: { stages: Stage[] } | null }>(
    `/api/companies/${companyId}/issues`,
    { title: `PW-S6-20 gốc ${uniqueToken()}`, projectId, assigneeAgentId: assistant.id, status },
  );
  trackIssue(root.id);
  // Gốc Crew: bốn stage (Reviewer, Integrator, Owner duyệt, Integrator).
  expect(root.executionPolicy?.stages.length).toBe(4);
  return root;
}

async function childrenOf(api: Parameters<typeof createProject>[0], companyId: string, rootId: string) {
  return api.get<Child[]>(`/api/companies/${companyId}/issues?parentId=${rootId}`);
}

test('PW-S6-20a desktop: Thêm việc con tạo con chưa giao ai dưới gốc, đính kèm vào con, bình luận báo Trợ Lý @t1', async ({
  page,
  company,
  api,
}, info) => {
  const project = await createProject(api, company.id, `PW-S6-20a ${uniqueToken()}`);
  try {
    const root = await crewRoot(api, company.id, project.id);
    await page.goto(company.path(`issues/${root.identifier}`));
    const button = page.getByRole('button', { name: 'Thêm việc con' });
    await expect(button).toBeVisible();
    await shot(page, info, 'add-child-button-desktop');

    await button.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(`Thêm việc con vào ${root.identifier}`)).toBeVisible();
    await expect(dialog.getByText('Trợ Lý giao cho executor, bạn không cần chọn.')).toBeVisible();
    const title = `PW-S6-20a con ${uniqueToken()}`;
    await dialog.getByLabel('Tiêu đề').fill(title);
    await dialog.getByLabel('Mô tả').fill('Thêm nút **Xuất Excel** ở trang báo cáo.\n\nTiêu chí nghiệm thu:\n- Có nút');
    await dialog.locator('input[type="file"]').setInputFiles({
      name: 'ghi-chu.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('ghi chú của owner'),
    });
    await expect(dialog.getByText('ghi-chu.txt')).toBeVisible();
    await shot(page, info, 'add-child-dialog-desktop');

    const created = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().endsWith(`/api/companies/${company.id}/issues`),
    );
    await dialog.getByRole('button', { name: 'Thêm việc con' }).click();
    const res = await created;
    expect(res.status()).toBe(201);
    const child = (await res.json()) as Child;
    trackIssue(child.id);
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('add-child-notice')).toContainText('Trợ Lý được báo');

    // Dữ liệu thật: con dưới gốc, chưa giao ai, policy việc con một stage Reviewer; file nằm ở con; gốc có bình luận.
    const [fresh] = (await childrenOf(api, company.id, root.id)).filter((c) => c.id === child.id);
    expect(fresh).toMatchObject({ parentId: root.id, status: 'todo', assigneeAgentId: null, title });
    const full = await api.get<Child>(`/api/issues/${child.id}`);
    expect(full.executionPolicy?.stages.map((s) => s.type)).toEqual(['review']);
    const attachments = await api.get<{ originalFilename?: string; filename?: string }[]>(
      `/api/issues/${child.id}/attachments`,
    );
    expect(attachments.map((a) => a.originalFilename ?? a.filename)).toContain('ghi-chu.txt');
    const comments = await api.get<{ body: string }[]>(`/api/issues/${root.id}/comments`);
    expect(comments.map((c) => c.body)).toContainEqual(expect.stringContaining(`Đã thêm việc con ${child.identifier}`));

    // Con hiện trong "Yêu cầu con" của gốc.
    const props = page.getByTestId('properties-panel');
    await expect(props.getByText(child.identifier)).toBeVisible();
    await shot(page, info, 'add-child-under-root-desktop');
  } finally {
    await archiveProject(api, project.id);
  }
});

test('PW-S6-20b nháp: nút hiện, dialog giải thích Bắt đầu làm trước, không có form @t1', async ({
  page,
  company,
  api,
}, info) => {
  const project = await createProject(api, company.id, `PW-S6-20b ${uniqueToken()}`);
  try {
    const root = await crewRoot(api, company.id, project.id, 'backlog');
    await page.goto(company.path(`issues/${root.identifier}`));
    await page.getByRole('button', { name: 'Thêm việc con' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Yêu cầu còn là nháp')).toBeVisible();
    await expect(dialog.getByLabel('Tiêu đề')).toHaveCount(0);
    await shot(page, info, 'add-child-draft');
    await dialog.getByRole('button', { name: 'Đóng' }).first().click();
    expect(await childrenOf(api, company.id, root.id)).toEqual([]);
  } finally {
    await archiveProject(api, project.id);
  }
});

test.describe('màn hẹp 390px', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('PW-S6-20c điện thoại: popup có nút, dialog cuộn được, thêm xong con hiện dưới gốc @t1', async ({
    page,
    company,
    api,
  }, info) => {
    const project = await createProject(api, company.id, `PW-S6-20c ${uniqueToken()}`);
    try {
      const root = await crewRoot(api, company.id, project.id);
      await page.goto(company.path(`issues?issue=${root.identifier}`));
      const popup = page.getByTestId('issue-popup');
      const button = popup.getByRole('button', { name: 'Thêm việc con' });
      await expect(button).toBeVisible();
      await button.scrollIntoViewIfNeeded();
      await shot(page, info, 'add-child-button-phone');
      await button.click();

      const dialog = page.getByRole('dialog', { name: `Thêm việc con vào ${root.identifier}` });
      await expect(dialog).toBeVisible();
      const title = `PW-S6-20c con ${uniqueToken()}`;
      await dialog.getByLabel('Tiêu đề').fill(title);
      await dialog
        .getByLabel('Mô tả')
        .fill(Array.from({ length: 30 }, (_, i) => `Dòng ${i + 1} của mô tả.`).join('\n'));
      // Dialog không tràn khỏi màn hình: cao tối đa bằng khung nhìn, nội dung cuộn trong dialog; không cuộn ngang.
      const box = await dialog.boundingBox();
      expect(box && box.y + box.height).toBeLessThanOrEqual(844 + 1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      const submit = dialog.getByRole('button', { name: 'Thêm việc con' });
      await submit.scrollIntoViewIfNeeded();
      await expect(submit).toBeInViewport();
      await shot(page, info, 'add-child-dialog-phone');

      await submit.click();
      await expect(dialog).toBeHidden();
      await expect(popup.getByTestId('add-child-notice')).toBeVisible();
      const child = (await childrenOf(api, company.id, root.id)).find((c) => c.title === title);
      if (!child) throw new Error(`không thấy việc con ${title} dưới ${root.identifier}`);
      trackIssue(child.id);
      const chip = popup.getByTestId('properties-panel').getByText(child.identifier);
      await chip.scrollIntoViewIfNeeded();
      await expect(chip).toBeVisible();
      await shot(page, info, 'add-child-under-root-phone');
    } finally {
      await archiveProject(api, project.id);
    }
  });
});

// S6.19 Bắt đầu làm yêu cầu nháp: nháp (`backlog`) rõ là nháp, nút "Bắt đầu làm" chuyển sang Cần làm và gọi Trợ Lý.
// Ca @t1 chạy ở stack cục bộ: agent giữ chỗ tắt wake (run agent giữ chỗ làm hỏng worker plugin của stack cục bộ), nên
// ca chỉ kiểm giao diện và trạng thái; việc server đánh thức assignee do test DB
// `server/src/__tests__/crew-draft-start-work.db.test.ts` khóa. Ca không @t1 cần project nền e2e-base (T2, stub) và
// kiểm run của Trợ Lý xuất hiện thật.
import type { Page, TestInfo } from '@playwright/test';
import { trackIssue } from '../support/cleanup';
import { archiveProject, createProject, ensurePlaceholderAgent, type IssueLite, uniqueToken } from '../support/data';
import { expect, test } from '../support/fixtures';

const baseProjectId = () => process.env.CREW_E2E_BASE_PROJECT_ID ?? '';

/** Ảnh kèm kết quả ca (thư mục test-results của ca), để xem nút trên desktop và điện thoại. */
async function shot(page: Page, info: TestInfo, name: string) {
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await info.attach(name, { path, contentType: 'image/png' });
}

test('PW-S6-19a nháp hiện rõ là nháp; Bắt đầu làm chuyển sang Cần làm, báo thành công, nút biến mất @t1', async ({
  page,
  company,
  api,
}, info) => {
  const project = await createProject(api, company.id, `PW-S6-19a ${uniqueToken()}`);
  try {
    const worker = await ensurePlaceholderAgent(api, company.id, 'crew-e2e-worker', { wake: false });
    const title = `PW-S6-19a ${uniqueToken()}`;
    const draft = await api.post<IssueLite & { executionPolicy: unknown }>(`/api/companies/${company.id}/issues`, {
      title,
      projectId: project.id,
      assigneeAgentId: worker.id,
      status: 'backlog',
    });
    trackIssue(draft.id);
    expect(draft.status).toBe('backlog');

    // Dòng của nháp ở trang Yêu cầu cũng có nút (desktop).
    await page.goto(company.path(`issues?q=${encodeURIComponent(title)}`));
    const row = page.getByTestId('issue-row').filter({ hasText: title });
    await expect(row.getByRole('button', { name: 'Bắt đầu làm' })).toBeVisible();
    await shot(page, info, 'draft-list');

    await page.goto(company.path(`issues/${draft.identifier}`));
    await expect(page.getByText('Yêu cầu nháp: agent chưa làm')).toBeVisible();
    const start = page.getByRole('button', { name: 'Bắt đầu làm' });
    await expect(start).toBeVisible();
    await shot(page, info, 'draft-desktop');

    const patched = page.waitForResponse(
      (r) => r.request().method() === 'PATCH' && r.url().endsWith(`/api/issues/${draft.id}`),
    );
    await start.click();
    const res = await patched;
    expect(res.status()).toBe(200);
    expect(res.request().postDataJSON()).toEqual({ status: 'todo' });
    await expect(page.getByTestId('start-work-notice')).toContainText(`Đã bắt đầu ${draft.identifier}`);
    await expect(page.getByRole('button', { name: 'Bắt đầu làm' })).toHaveCount(0);
    await expect(page.getByText('Yêu cầu nháp: agent chưa làm')).toHaveCount(0);
    expect((await api.get<IssueLite>(`/api/issues/${draft.id}`)).status).not.toBe('backlog');
  } finally {
    await archiveProject(api, project.id);
  }
});

test.describe('màn hẹp 390px', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('PW-S6-19b điện thoại: popup của nháp có nút Bắt đầu làm, bấm được @t1', async ({
    page,
    company,
    api,
  }, info) => {
    const project = await createProject(api, company.id, `PW-S6-19b ${uniqueToken()}`);
    try {
      const worker = await ensurePlaceholderAgent(api, company.id, 'crew-e2e-worker', { wake: false });
      const draft = await api.post<IssueLite>(`/api/companies/${company.id}/issues`, {
        title: `PW-S6-19b ${uniqueToken()}`,
        projectId: project.id,
        assigneeAgentId: worker.id,
        status: 'backlog',
      });
      trackIssue(draft.id);

      await page.goto(company.path(`issues?issue=${draft.identifier}`));
      const popup = page.getByTestId('issue-popup');
      await expect(popup.getByText('Yêu cầu nháp: agent chưa làm')).toBeVisible();
      const start = popup.getByRole('button', { name: 'Bắt đầu làm' });
      await expect(start).toBeInViewport();
      await shot(page, info, 'draft-phone');
      await start.click();
      await expect(popup.getByTestId('start-work-notice')).toContainText(`Đã bắt đầu ${draft.identifier}`);
      await expect(popup.getByRole('button', { name: 'Bắt đầu làm' })).toHaveCount(0);
    } finally {
      await archiveProject(api, project.id);
    }
  });
});

test('PW-S6-19c nháp của project nền: Bắt đầu làm thì run của Trợ Lý xuất hiện ≤ 30 giây (stub)', async ({
  page,
  company,
  api,
}) => {
  test.skip(!baseProjectId(), 'Cần project nền e2e-base (T2)');
  const roles = (
    await api.crewRoute<{ roles: { assistantAgentId: string } }>(
      'GET',
      `/projects/${baseProjectId()}/roles?companyId=${company.id}`,
    )
  ).roles;
  const draft = await api.post<IssueLite>(`/api/companies/${company.id}/issues`, {
    title: `PW-S6-19c ${uniqueToken()}`,
    projectId: baseProjectId(),
    assigneeAgentId: roles.assistantAgentId,
    status: 'backlog',
  });
  trackIssue(draft.id);
  const runs = async () =>
    (
      await api.get<{ status: string; createdAt: string; contextSnapshot?: { issueId?: string } }[]>(
        `/api/companies/${company.id}/heartbeat-runs?agentId=${roles.assistantAgentId}`,
      )
    ).filter((r) => r.contextSnapshot?.issueId === draft.id);
  expect(await runs()).toEqual([]);

  await page.goto(company.path(`issues/${draft.identifier}`));
  await page.getByRole('button', { name: 'Bắt đầu làm' }).click();
  await expect(page.getByTestId('start-work-notice')).toContainText(`Đã bắt đầu ${draft.identifier}`);
  await expect.poll(async () => (await runs()).length, { timeout: 30_000 }).toBeGreaterThan(0);
  await api.patch(`/api/issues/${draft.id}`, { status: 'cancelled' });
});

// S22 Roadmap: bản đồ công ty → project → yêu cầu do người tạo → cây việc con, nhánh Docs, và lọc theo quyền project.
// Dữ liệu ca dựng bằng API phiên owner (nên có `createdByUserId`). Việc gốc do agent tạo không dựng được vì policy Crew
// từ chối agent tạo issue gốc (`crew_agent_root_issue`); bộ lọc đó có unit test ở test/features/roadmap.
import type { Page } from '@playwright/test';
import { archiveProject, createIssue, createProject, uniqueToken, waitInCompactList } from '../support/data';
import { expect, test } from '../support/fixtures';
import { memberProjects, setMemberProjects } from '../support/project-access';

const node = (page: Page, id: string) => page.locator(`button[data-roadmap-id="${id}"]`);
const notFound = 'Không tìm thấy hoặc bạn không được xem';

test('PW-S22-1 owner đi từ công ty vào project, yêu cầu, việc con; popup, Esc, Back và dạng danh sách @t1', async ({
  page,
  api,
  company,
}) => {
  const token = uniqueToken('s22');
  const a = await createProject(api, company.id, `PW-S22 A ${token}`);
  try {
    const root = await createIssue(api, company.id, { title: `PW-S22 yêu cầu ${token}`, projectId: a.id });
    const first = await createIssue(api, company.id, {
      title: `PW-S22 việc 1 ${token}`,
      projectId: a.id,
      parentId: root.id,
    });
    const second = await createIssue(api, company.id, {
      title: `PW-S22 việc 2 ${token}`,
      projectId: a.id,
      parentId: root.id,
      blockedByIssueIds: [first.id],
    });
    await waitInCompactList(api, company.id, [root.id, first.id, second.id]);

    await page.goto(company.path('roadmap'));
    await expect(page.getByRole('heading', { name: 'Roadmap', exact: true })).toBeVisible();
    await expect(node(page, 'company')).toBeFocused();
    await expect(node(page, a.id)).toHaveAttribute('aria-label', `Project ${a.name}: 1 yêu cầu, 1 đang mở`);

    // Bấm project: camera phóng vào, URL đổi sang tầng project; chỉ yêu cầu gốc, không có việc con ở tầng này.
    await node(page, a.id).click();
    await expect(page).toHaveURL(new RegExp(`roadmap\\?project=${a.id}$`));
    await expect(node(page, root.id)).toBeVisible();
    await expect(node(page, first.id)).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Đường dẫn trang' })).toContainText(a.name);

    // Bấm yêu cầu: cây việc con với cạnh chặn.
    await node(page, root.id).click();
    await expect(page).toHaveURL(new RegExp(`request=${root.identifier}`));
    await expect(node(page, first.id)).toBeVisible();
    await expect(node(page, second.id)).toBeVisible();
    await expect(page.locator('path[data-edge-kind="blocks"]')).toHaveCount(1);

    // Việc con mở popup chi tiết có sẵn; Esc đóng popup, Esc nữa lùi về tầng project.
    await node(page, second.id).click();
    await expect(page).toHaveURL(new RegExp(`issue=${second.identifier}`));
    await expect(page.getByTestId('issue-popup')).toContainText(second.title);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('issue-popup')).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`request=${root.identifier}$`));
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(new RegExp(`roadmap\\?project=${a.id}$`));
    await expect(node(page, root.id)).toBeFocused();

    // Back trình duyệt trở lại tầng yêu cầu; breadcrumb về tầng công ty.
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`request=${root.identifier}$`));
    await expect(node(page, second.id)).toBeVisible();
    await page.getByRole('link', { name: company.name, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${company.path('roadmap')}$`));
    await expect(node(page, a.id)).toBeVisible();

    // Dạng danh sách cho cùng nội dung.
    await page.goto(company.path(`roadmap?project=${a.id}&request=${root.identifier}&view=list`));
    const list = page.getByRole('region', { name: 'Bản đồ dạng danh sách' });
    await expect(list.locator(`[data-roadmap-id="${first.id}"]`)).toBeVisible();
    await expect(list.locator(`[data-roadmap-id="${second.id}"]`)).toBeVisible();
    await list.locator(`[data-roadmap-id="${first.id}"]`).click();
    await expect(page.getByTestId('issue-popup')).toContainText(first.title);
  } finally {
    await archiveProject(api, a.id);
  }
});

test('PW-S22-2 thành viên bị giới hạn chỉ thấy project được cấp, deep link project khác ra thông báo chung @t1', async ({
  api,
  contributorPage: guest,
  contributorApi,
  company,
}) => {
  const token = uniqueToken('s22g');
  const a = await createProject(api, company.id, `PW-S22 A ${token}`);
  const b = await createProject(api, company.id, `PW-S22 B ${token}`);
  const { userId } = await contributorApi.get<{ userId: string }>(`/api/crew/companies/${company.id}/access`);
  const before = (await memberProjects(api, company.id, userId))?.projectIds ?? [];
  try {
    const issueA = await createIssue(api, company.id, { title: `PW-S22 việc A ${token}`, projectId: a.id });
    const issueB = await createIssue(api, company.id, { title: `PW-S22 việc B ${token}`, projectId: b.id });
    await waitInCompactList(api, company.id, [issueA.id, issueB.id]);
    await setMemberProjects(api, company.id, userId, [...new Set([...before, a.id])]);

    await guest.goto(company.path('roadmap'));
    await expect(node(guest, a.id)).toBeVisible();
    await expect(node(guest, b.id)).toHaveCount(0);
    await expect(node(guest, 'none')).toHaveCount(0);

    await guest.goto(company.path(`roadmap?project=${a.id}`));
    await expect(node(guest, issueA.id)).toBeVisible();

    await guest.goto(company.path(`roadmap?project=${b.id}`));
    await expect(guest.getByText(notFound)).toBeVisible();
    await expect(node(guest, issueB.id)).toHaveCount(0);
    await guest.goto(company.path(`roadmap?project=${a.id}&request=${issueB.identifier}`));
    await expect(guest.getByText(notFound)).toBeVisible();
  } finally {
    await setMemberProjects(api, company.id, userId, before);
    await archiveProject(api, a.id);
    await archiveProject(api, b.id);
  }
});

test('PW-S22-3 nhánh Docs: vào bộ docs, mở trang trong popup, link sang trang Docs @t1', async ({
  page,
  api,
  company,
}) => {
  // Bản docs chỉ có khi máy đã ghép gửi lên; ca chỉ đọc nên dùng project có docs của company e2e, không có thì của
  // company khác mà board xem được (ví dụ company mẫu ảnh hướng dẫn trên T1).
  const companies = await api.get<{ id: string; issuePrefix: string }[]>('/api/companies');
  const ordered = [company, ...companies.filter((c) => c.id !== company.id)];
  let found: { prefix: string; companyId: string; projectId: string } | null = null;
  for (const c of ordered) {
    const docsProjects = await api
      .crewData<{ projectId: string }[]>('crew.docs.projects', c.id)
      .catch(() => [] as { projectId: string }[]);
    if (!docsProjects.length) continue;
    const projects = await api.get<{ id: string; archivedAt?: string | null }[]>(`/api/companies/${c.id}/projects`);
    const live = new Set(projects.filter((p) => !p.archivedAt).map((p) => p.id));
    const hit = docsProjects.find((d) => live.has(d.projectId));
    if (hit) {
      found = { prefix: c.issuePrefix, companyId: c.id, projectId: hit.projectId };
      break;
    }
  }
  test.skip(!found, 'Chưa có project nào có bản docs');
  const { prefix, companyId, projectId } = found as NonNullable<typeof found>;
  const at = (to: string) => `/${prefix}/${to}`;
  const tree = await api.crewData<{ pages: { path: string; title: string }[] } | null>('crew.docs.tree', companyId, {
    projectId,
  });
  test.skip(!tree?.pages.length, 'Bản docs không có trang nào');
  const pages = tree?.pages ?? [];

  await page.goto(at(`roadmap?project=${projectId}`));
  const docs = node(page, `docs:${projectId}`);
  await expect(docs).toHaveAttribute('aria-label', `Docs: ${pages.length} trang`);
  await docs.click();
  await expect(page).toHaveURL(new RegExp(`project=${projectId}&docs=1$`));

  // Gốc chỉ có một thư mục (không trang) thì tự vào thư mục đó, breadcrumb vẫn ghi đường thư mục.
  const tops = new Set(pages.map((p) => (p.path.includes('/') ? `dir:${p.path.split('/')[0]}` : 'page')));
  const center = page.locator('button[data-roadmap-id][data-center]');
  if (tops.size === 1 && !tops.has('page')) {
    const only = [...tops][0];
    await expect(center).toHaveAttribute('data-roadmap-id', only);
    await expect(page.getByRole('navigation', { name: 'Đường dẫn trang' })).toContainText(only.slice(4));
  }

  // Đi tới trang đầu tiên: vào từng thư mục trên đường dẫn của nó (bỏ qua tầng đã tự vào) rồi bấm trang.
  const target = pages[0];
  const parts = target.path.split('/');
  for (let i = 1; i < parts.length; i++) {
    const folder = parts.slice(0, i).join('/');
    const current = (await center.getAttribute('data-roadmap-id')) ?? '';
    if (current.startsWith('dir:') && `${current.slice(4)}/`.startsWith(`${folder}/`)) continue;
    await node(page, `dir:${folder}`).click();
    await expect(page).toHaveURL(new RegExp(`folder=${encodeURIComponent(folder)}$`));
  }
  await node(page, `page:${target.path}`).click();
  await expect(page).toHaveURL(new RegExp(`doc=${encodeURIComponent(target.path)}`));
  const popup = page.getByTestId('roadmap-doc-popup');
  await expect(popup).toContainText(target.path);
  await expect(popup.getByRole('link', { name: 'Mở trong trang Docs' })).toHaveAttribute(
    'href',
    at(`docs?${new URLSearchParams({ project: projectId, path: target.path })}`),
  );
  await page.keyboard.press('Escape');
  await expect(popup).toHaveCount(0);
  await expect(page).not.toHaveURL(/doc=/);
  await expect(node(page, `page:${target.path}`)).toBeVisible();
});

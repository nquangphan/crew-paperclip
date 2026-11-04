// S22 Roadmap một trang: một bản đồ chứa công ty → project → yêu cầu do người tạo → cây việc con (và đảo Docs); bấm một
// mục thì camera zoom tới đó, không đổi trang. URL `?focus=` (Back lùi vị trí), link cũ `?project=`/`?request=` tự đổi.
// Dữ liệu ca dựng bằng API phiên owner (nên có `createdByUserId`). Việc gốc do agent tạo không dựng được vì policy Crew
// từ chối agent tạo issue gốc (`crew_agent_root_issue`); bộ lọc đó có unit test ở test/features/roadmap.
import type { Page } from '@playwright/test';
import { archiveProject, createIssue, createProject, uniqueToken, waitInCompactList } from '../support/data';
import { expect, test } from '../support/fixtures';
import { memberProjects, setMemberProjects } from '../support/project-access';

const canvas = (page: Page) => page.locator('[data-slot="roadmap-canvas"]');
const node = (page: Page, id: string) => canvas(page).locator(`button[data-roadmap-id="${id}"]`);
const notFound = 'Không tìm thấy hoặc bạn không được xem';
const focusOf = (page: Page) => new URL(page.url()).searchParams.get('focus');

// Mức xa vẽ mỗi ticket thành một ô màu (một đoạn `M…Z`) gộp theo màu trong vài <path>; đếm đoạn = đếm ticket đang vẽ.
async function cellCount(page: Page): Promise<number> {
  const ds = await canvas(page)
    .locator('path[data-block-tone]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('d') ?? ''));
  return ds.reduce((n, d) => n + (d.match(/M/g)?.length ?? 0), 0);
}

// Mục nằm trọn trong khung bản đồ (camera đã dừng): hộp của nút nằm trong hộp của canvas. Đợi vì camera chạy hoạt ảnh.
async function expectInViewport(page: Page, id: string) {
  await expect
    .poll(
      async () => {
        const [c, n] = await Promise.all([canvas(page).boundingBox(), node(page, id).boundingBox()]);
        if (!c || !n) return false;
        return (
          n.x >= c.x - 1 && n.y >= c.y - 1 && n.x + n.width <= c.x + c.width + 1 && n.y + n.height <= c.y + c.height + 1
        );
      },
      { message: `nút ${id} nằm trong khung nhìn`, timeout: 10_000 },
    )
    .toBe(true);
}

test('PW-S22-1 owner zoom từ toàn cảnh vào project, yêu cầu, việc con trên một trang; popup, Esc, Back, link cũ và dạng danh sách @t1', async ({
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

    // Toàn cảnh: một bản đồ, nút project có mặt; camera đặt xong.
    await page.goto(company.path('roadmap'));
    await expect(page.getByRole('heading', { name: 'Roadmap', exact: true })).toBeVisible();
    await expect(canvas(page)).toHaveAttribute('data-camera', 'placed');
    await expect(node(page, a.id)).toHaveAttribute('aria-label', `Project ${a.name}: 1 yêu cầu, 1 đang mở`);
    const url = page.url();

    // Bấm project: camera zoom tới cụm, vẫn cùng trang (chỉ đổi ?focus=).
    await node(page, a.id).click();
    await expect.poll(() => focusOf(page)).toBe(`project:${a.id}`);
    expect(new URL(page.url()).pathname).toBe(new URL(url).pathname);
    await expect(page.getByRole('navigation', { name: 'Đường dẫn trang' })).toContainText(a.name);

    // Bấm nhãn của yêu cầu (mức nhãn) rồi việc con: thẻ và dây như bản đồ Crew, có dây chặn.
    await canvas(page).locator(`button[data-plate="${root.id}"]`).click();
    await expect.poll(() => focusOf(page)).toBe(root.identifier);
    await expect(node(page, root.id)).toHaveAttribute('aria-current', 'true');
    await expect(node(page, second.id)).toBeVisible();
    await expect(canvas(page).locator('path[data-edge-kind="blocks"]')).toHaveCount(1);
    await node(page, second.id).click();
    await expect.poll(() => focusOf(page)).toBe(second.identifier);
    await expect(node(page, second.id)).toHaveAttribute('aria-current', 'true');

    // Bấm lại việc đang xem mở popup chi tiết có sẵn; Esc đóng popup, Esc nữa ra yêu cầu, rồi ra project.
    await node(page, second.id).click();
    await expect(page).toHaveURL(new RegExp(`issue=${second.identifier}`));
    await expect(page.getByTestId('issue-popup')).toContainText(second.title);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('issue-popup')).toHaveCount(0);
    await expect.poll(() => focusOf(page)).toBe(second.identifier);
    await page.keyboard.press('Escape');
    await expect.poll(() => focusOf(page)).toBe(root.identifier);

    // Back trình duyệt lùi về vị trí trước (việc con); nút Toàn cảnh về toàn cảnh.
    await page.goBack();
    await expect.poll(() => focusOf(page)).toBe(second.identifier);
    await expect(node(page, second.id)).toHaveAttribute('aria-current', 'true');
    await page.getByRole('button', { name: 'Toàn cảnh' }).first().click();
    await expect.poll(() => focusOf(page)).toBeNull();

    // Link cũ mở đúng chỗ.
    await page.goto(company.path(`roadmap?project=${a.id}&request=${root.identifier}`));
    await expect.poll(() => focusOf(page)).toBe(root.identifier);
    await expect(node(page, root.id)).toHaveAttribute('aria-current', 'true');

    // Dạng danh sách cho cùng nội dung.
    await page.goto(company.path(`roadmap?focus=${root.identifier}&view=list`));
    const list = page.getByRole('region', { name: 'Bản đồ dạng danh sách' });
    await expect(list.locator(`[data-roadmap-id="${first.id}"]`)).toBeVisible();
    await expect(list.locator(`[data-roadmap-id="${second.id}"]`)).toBeVisible();
    await list.locator(`[data-roadmap-id="${first.id}"]`).click();
    await expect(page.getByTestId('issue-popup')).toContainText(first.title);
  } finally {
    await archiveProject(api, a.id);
  }
});

test('PW-S22-4 toàn cảnh có mọi ticket của mọi project trên một bản đồ; zoom đưa mục vào khung nhìn, Back lùi, link cũ và ?issue= @t1', async ({
  page,
  api,
  company,
}) => {
  const token = uniqueToken('s22m');
  const a = await createProject(api, company.id, `PW-S22 A ${token}`);
  const b = await createProject(api, company.id, `PW-S22 B ${token}`);
  try {
    // Số ô trên toàn cảnh khi hai project còn trống; thêm 2 yêu cầu + 2 việc con thì đúng 4 ô mới xuất hiện.
    await page.goto(company.path('roadmap'));
    await expect(canvas(page)).toHaveAttribute('data-camera', 'placed');
    await expect(node(page, a.id)).toBeVisible();
    const before = await cellCount(page);

    const rootA = await createIssue(api, company.id, { title: `PW-S22 yêu cầu A ${token}`, projectId: a.id });
    const childA = await createIssue(api, company.id, {
      title: `PW-S22 việc A ${token}`,
      projectId: a.id,
      parentId: rootA.id,
    });
    const rootB = await createIssue(api, company.id, { title: `PW-S22 yêu cầu B ${token}`, projectId: b.id });
    const childB = await createIssue(api, company.id, {
      title: `PW-S22 việc B ${token}`,
      projectId: b.id,
      parentId: rootB.id,
    });
    await waitInCompactList(api, company.id, [rootA.id, childA.id, rootB.id, childB.id]);

    // Toàn cảnh: cả hai project và mọi ticket của chúng (yêu cầu + việc con) trên MỘT bản đồ, không chuyển trang.
    await page.goto(company.path('roadmap'));
    await expect(canvas(page)).toHaveAttribute('data-camera', 'placed');
    expect(focusOf(page)).toBeNull();
    await expect(node(page, a.id)).toHaveAttribute('aria-label', `Project ${a.name}: 1 yêu cầu, 1 đang mở`);
    await expect(node(page, b.id)).toHaveAttribute('aria-label', `Project ${b.name}: 1 yêu cầu, 1 đang mở`);
    await expect.poll(() => cellCount(page), { message: 'đủ 4 ô ticket mới trên toàn cảnh' }).toBe(before + 4);
    const overview = new URL(page.url()).pathname;

    // Bấm project A, yêu cầu A rồi việc con A: URL đổi, vẫn cùng trang, mục được zoom tới nằm trong khung nhìn.
    await node(page, a.id).click();
    await expect.poll(() => focusOf(page)).toBe(`project:${a.id}`);
    expect(new URL(page.url()).pathname).toBe(overview);
    await canvas(page).locator(`button[data-plate="${rootA.id}"]`).click();
    await expect.poll(() => focusOf(page)).toBe(rootA.identifier);
    expect(new URL(page.url()).pathname).toBe(overview);
    await expectInViewport(page, rootA.id);
    await expect(node(page, rootA.id)).toHaveAttribute('aria-current', 'true');

    await node(page, childA.id).click();
    await expect.poll(() => focusOf(page)).toBe(childA.identifier);
    expect(new URL(page.url()).pathname).toBe(overview);
    await expectInViewport(page, childA.id);

    // Back lùi từng bước: việc con → yêu cầu → project → toàn cảnh; mỗi bước camera đưa mục tương ứng vào khung nhìn.
    await page.goBack();
    await expect.poll(() => focusOf(page)).toBe(rootA.identifier);
    await expectInViewport(page, rootA.id);
    await page.goBack();
    await expect.poll(() => focusOf(page)).toBe(`project:${a.id}`);
    await page.goBack();
    await expect.poll(() => focusOf(page)).toBeNull();
    expect(new URL(page.url()).pathname).toBe(overview);

    // Project khác cũng zoom tới đúng chỗ; nút Toàn cảnh quay ra.
    await node(page, b.id).click();
    await expect.poll(() => focusOf(page)).toBe(`project:${b.id}`);
    await canvas(page).locator(`button[data-plate="${rootB.id}"]`).click();
    await expect.poll(() => focusOf(page)).toBe(rootB.identifier);
    await expectInViewport(page, rootB.id);
    await page.getByRole('button', { name: 'Toàn cảnh' }).first().click();
    await expect.poll(() => focusOf(page)).toBeNull();

    // Link cũ: chỉ ?project= mở cụm project; ?project=&request= mở yêu cầu.
    await page.goto(company.path(`roadmap?project=${b.id}`));
    await expect.poll(() => focusOf(page)).toBe(`project:${b.id}`);
    await expect(page.getByRole('navigation', { name: 'Đường dẫn trang' })).toContainText(b.name);
    await expectInViewport(page, b.id);
    await page.goto(company.path(`roadmap?project=${a.id}&request=${rootA.identifier}`));
    await expect.poll(() => focusOf(page)).toBe(rootA.identifier);
    await expectInViewport(page, rootA.id);

    // Popup ?issue= mở thẳng bằng link, không phụ thuộc chỗ lấy nét; Esc đóng.
    await page.goto(company.path(`roadmap?issue=${childB.identifier}`));
    await expect(page.getByTestId('issue-popup')).toContainText(childB.title);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('issue-popup')).toHaveCount(0);

    // Dạng danh sách ?view=list không cần focus: liệt kê cả hai project, bấm mục mở popup.
    await page.goto(company.path('roadmap?view=list'));
    const list = page.getByRole('region', { name: 'Bản đồ dạng danh sách' });
    await expect(list).toBeVisible();
    await expect(list.locator(`[data-roadmap-id="${a.id}"]`)).toBeVisible();
    await expect(list.locator(`[data-roadmap-id="${b.id}"]`)).toBeVisible();
  } finally {
    await archiveProject(api, a.id);
    await archiveProject(api, b.id);
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
    await expect(canvas(guest)).toHaveAttribute('data-camera', 'placed');
    await expect(node(guest, a.id)).toBeVisible();
    await expect(node(guest, b.id)).toHaveCount(0);
    await expect(node(guest, 'none')).toHaveCount(0);
    // Dữ liệu một lần tải của người bị giới hạn không chứa ticket project khác (cắt ở server, không chỉ ẩn ở giao diện).
    const payload = JSON.stringify(await contributorApi.crewData('crew.roadmap', company.id));
    expect(payload).toContain(issueA.id);
    expect(payload).not.toContain(issueB.id);
    expect(payload).not.toContain(issueB.identifier);

    await guest.goto(company.path(`roadmap?focus=${issueA.identifier}`));
    await expect(node(guest, issueA.id)).toHaveAttribute('aria-current', 'true');

    await guest.goto(company.path(`roadmap?focus=project:${b.id}`));
    await expect(guest.getByText(notFound)).toBeVisible();
    await guest.goto(company.path(`roadmap?focus=${issueB.identifier}`));
    await expect(guest.getByText(notFound)).toBeVisible();
    await expect(node(guest, issueB.id)).toHaveCount(0);
    // Link cũ tới project không được cấp cũng ra thông báo chung.
    await guest.goto(company.path(`roadmap?project=${b.id}`));
    await expect(guest.getByText(notFound)).toBeVisible();
  } finally {
    await setMemberProjects(api, company.id, userId, before);
    await archiveProject(api, a.id);
    await archiveProject(api, b.id);
  }
});

test('PW-S22-3 đảo Docs: lấy nét, mở trang trong popup, link sang trang Docs @t1', async ({ page, api, company }) => {
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

  // Đảo Docs: lấy nét bằng link, bấm trang (thẻ đầy đủ) mở popup đọc, Esc đóng popup, chỗ lấy nét giữ nguyên.
  await page.goto(at(`roadmap?focus=docs:${projectId}`));
  const docs = node(page, `docs:${projectId}`);
  await expect(docs).toHaveAttribute('aria-label', `Docs: ${pages.length} trang`);
  await expect(docs).toHaveAttribute('aria-current', 'true');
  const target = pages[0];
  const pageNode = node(page, `page:${projectId}:${target.path}`);
  await pageNode.scrollIntoViewIfNeeded();
  await pageNode.click();
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
  await expect.poll(() => focusOf(page)).toBe(`docs:${projectId}`);
});

// S21 Quyền xem project theo thành viên: owner chọn project mỗi người được xem ở trang Thành viên; người không phải
// owner chỉ thấy project được cấp (mặc định không thấy gì). Ca dùng hai project thử mới tạo (chưa ai được cấp), cấp
// project A cho tài khoản Phòng Marketing, kiểm khách chỉ thấy A, rồi gỡ. Quyền có sẵn của khách giữ nguyên.
import { archiveProject, createIssue, createProject, uniqueToken } from '../support/data';
import { contributorEmail } from '../support/env';
import { expect, test } from '../support/fixtures';
import { memberProjects } from '../support/project-access';

test('PW-S21-1 owner cấp project A cho Phòng Marketing: khách chỉ thấy A, gỡ thì mất @t1', async ({
  page,
  api,
  contributorPage: guest,
  contributorApi,
  company,
}) => {
  const token = uniqueToken('s21');
  const a = await createProject(api, company.id, `PW-S21 A ${token}`);
  const b = await createProject(api, company.id, `PW-S21 B ${token}`);
  try {
    const issueA = await createIssue(api, company.id, { title: `PW-S21 việc A ${token}`, projectId: a.id });
    const issueB = await createIssue(api, company.id, { title: `PW-S21 việc B ${token}`, projectId: b.id });
    const { userId } = await contributorApi.get<{ userId: string }>(`/api/crew/companies/${company.id}/access`);
    const granted = async () => (await memberProjects(api, company.id, userId))?.projectIds ?? [];
    const before = await granted();
    expect(before).not.toContain(a.id);

    // Owner mở ô "Project được xem" của khách và chọn A.
    const choose = async (check: boolean) => {
      await page.goto(company.path('members'));
      const row = page.getByTestId('member-row').filter({ hasText: contributorEmail() });
      await row.getByTestId('project-access-trigger').click();
      const editor = page.getByTestId('project-access-editor');
      const box = editor.getByRole('checkbox', { name: a.name });
      if (check) await box.check();
      else await box.uncheck();
      await editor.getByRole('button', { name: 'Lưu', exact: true }).click();
      await expect(editor).toBeHidden();
    };
    await choose(true);
    await expect.poll(granted).toContain(a.id);
    expect(await granted()).not.toContain(b.id);

    // Khách: danh sách project chỉ có A; trang project B báo không có quyền; danh sách yêu cầu chỉ có việc A.
    await guest.goto(company.path('projects'));
    await expect(guest.getByRole('link', { name: a.name })).toBeVisible();
    await expect(guest.getByRole('link', { name: b.name })).toHaveCount(0);
    await guest.goto(company.path(`projects/${b.id}`));
    await expect(guest.getByText('Bạn không có quyền xem project này')).toBeVisible();
    await guest.goto(company.path(`issues?q=${encodeURIComponent(token)}`));
    await expect(guest.getByText(issueA.title)).toBeVisible();
    await expect(guest.getByText(issueB.title)).toHaveCount(0);

    // Server chặn góp ý vào project chưa được cấp.
    const denied = await contributorApi.raw('POST', `/api/crew/companies/${company.id}/contributions`, {
      kind: 'issue',
      projectId: b.id,
      title: `PW-S21 không được ${token}`,
    });
    expect(denied.status).toBe(403);
    expect((denied.body as { code?: string }).code).toBe('crew_project_not_visible');

    // Gỡ A: khách không còn thấy A; quyền cũ giữ nguyên.
    await choose(false);
    await expect.poll(granted).not.toContain(a.id);
    expect((await granted()).sort()).toEqual([...before].sort());
    await guest.goto(company.path('projects'));
    await expect(guest.getByRole('heading', { name: 'Project', exact: true })).toBeVisible();
    await expect(guest.getByRole('link', { name: a.name })).toHaveCount(0);
  } finally {
    await archiveProject(api, a.id);
    await archiveProject(api, b.id);
  }
});

// Chọn sẵn project lúc mời: lời mời mang `defaultsPayload.crew.projectIds`, bảng lời mời hiện project đã chọn. Phần
// duyệt rồi tự cấp project cần đăng ký tài khoản mới nên chỉ có ở test unit; ca thu hồi lời mời vừa tạo khi xong.
test('PW-S21-2 mời Phòng Marketing kèm project chọn sẵn: lời mời lưu đúng project @t1', async ({
  page,
  api,
  company,
}) => {
  interface Invite {
    id: string;
    state: string;
    defaultsPayload: { crew?: { role?: string; projectIds?: string[] } } | null;
  }
  const token = uniqueToken('s21-invite');
  const a = await createProject(api, company.id, `PW-S21 mời A ${token}`);
  const b = await createProject(api, company.id, `PW-S21 mời B ${token}`);
  const findInvite = async () => {
    const { invites } = await api.get<{ invites: Invite[] }>(`/api/companies/${company.id}/invites?limit=100&offset=0`);
    return invites.find((i) => i.state === 'active' && i.defaultsPayload?.crew?.projectIds?.includes(a.id)) ?? null;
  };
  let inviteId: string | null = null;
  try {
    await page.goto(company.path('members'));
    await page.getByRole('button', { name: 'Mời Phòng Marketing', exact: true }).click();
    const editor = page.getByTestId('invite-projects-editor');
    await editor.getByRole('checkbox', { name: a.name }).check();
    await editor.getByRole('button', { name: 'Tạo link', exact: true }).click();
    await expect(page.getByLabel('Link mời')).toHaveValue(/\/paperclip\/invite\//);

    await expect.poll(async () => (await findInvite())?.id ?? null).not.toBeNull();
    const invite = await findInvite();
    inviteId = invite?.id ?? null;
    expect(invite?.defaultsPayload?.crew).toEqual({ role: 'contributor', projectIds: [a.id] });
    expect(invite?.defaultsPayload?.crew?.projectIds).not.toContain(b.id);
    await expect(page.getByTestId('invite-projects').filter({ hasText: a.name })).toHaveCount(1);
  } finally {
    if (inviteId) await api.post(`/api/invites/${inviteId}/revoke`, {});
    await archiveProject(api, a.id);
    await archiveProject(api, b.id);
  }
});

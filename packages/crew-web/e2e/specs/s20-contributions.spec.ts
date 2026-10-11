// S20 Phòng Marketing (khách góp ý): viewer ở lõi có dấu khách của Crew. Khách xem mọi thứ, gửi yêu cầu và bình luận
// vào bảng chờ; agent không thấy gì cho tới khi owner bấm Duyệt (đăng qua route stock như board đăng) hoặc Từ chối
// (mục giữ nhãn Bị từ chối, agent không bao giờ thấy). Hai phiên: board (owner, `page`) và khách (`contributorPage`).
// Các ca dùng chung dữ liệu theo thứ tự nên chạy nối tiếp. Mục góp ý ở trạng thái cuối được để lại (nhỏ, có nhãn).
import type { Page } from '@playwright/test';
import { withAgentToken } from '../support/agent-token';
import { type Api, bearerApi, boardApi } from '../support/api';
import { trackIssue } from '../support/cleanup';
import { createIssue, ensurePlaceholderAgent, type IssueLite, meId, uniqueToken } from '../support/data';
import { companyId } from '../support/env';
import { type E2eCompany, expect, test } from '../support/fixtures';

test.describe.configure({ mode: 'serial' });

interface Contribution {
  id: string;
  kind: 'issue' | 'comment';
  status: 'pending' | 'approving' | 'approved' | 'rejected';
  title: string | null;
  body: string | null;
  projectId: string | null;
  targetIssueId: string | null;
  resultIssueId: string | null;
  resultCommentId: string | null;
}
interface CommentLite {
  id: string;
  body: string;
  authorUserId?: string | null;
}

const route = (path = '') => `/api/crew/companies/${companyId()}/contributions${path}`;
// Dấu dùng cho nội dung góp ý; issue đích mang dấu `token` khác để "agent không thấy dấu" không thấy nhầm issue đích.
const token = uniqueToken('s20');
const marker = uniqueToken('cm');
const requestTitle = `PW-S20 yêu cầu góp ý ${marker}`;
const requestTitle2 = `PW-S20 yêu cầu bị từ chối ${marker}`;
const commentText = `PW-S20 bình luận góp ý ${marker}`;

let project: { id: string; name: string };
let agent: { id: string; name: string };
let target: IssueLite;

/** Project nhận góp ý: project nền ở T2, project thử của stack T1. */
async function pickProject(api: Api, cid: string): Promise<{ id: string; name: string }> {
  const all = (
    await api.get<{ id: string; name: string; archivedAt?: string | null }[]>(`/api/companies/${cid}/projects`)
  ).filter((p) => !p.archivedAt);
  const wanted = process.env.CREW_E2E_BASE_PROJECT_ID;
  const found = (wanted ? all.find((p) => p.id === wanted) : all.find((p) => p.name === 'E2E T1 project')) ?? all[0];
  if (!found) throw new Error('Company e2e không có project nào để nhận góp ý');
  return found;
}

async function listContributions(api: Api, query = ''): Promise<Contribution[]> {
  return (await api.get<{ items: Contribution[] }>(route(query))).items;
}

/** Mục góp ý theo tiêu đề hoặc nội dung (mỗi lượt chạy một dấu duy nhất). */
async function findContribution(api: Api, needle: string): Promise<Contribution | undefined> {
  return (await listContributions(api)).find((c) => (c.title ?? c.body ?? '').includes(needle));
}

/** Gọi API bằng key agent tạm: trả chuỗi JSON của các phản hồi để kiểm "agent không thấy dấu". */
async function agentView(api: Api, paths: string[]): Promise<string> {
  return withAgentToken(api, agent.id, async (key) => {
    const asAgent = await bearerApi(key);
    try {
      const parts: string[] = [];
      for (const p of paths) {
        const res = await asAgent.raw('GET', p);
        parts.push(JSON.stringify(res.body));
      }
      return parts.join('\n');
    } finally {
      await asAgent.dispose();
    }
  });
}

const agentPaths = (cid: string, q: string, issueId: string) => [
  `/api/companies/${cid}/issues?q=${encodeURIComponent(q)}`,
  `/api/companies/${cid}/issues`,
  `/api/issues/${issueId}`,
  `/api/issues/${issueId}/comments`,
  `/api/issues/${issueId}/heartbeat-context`,
  `/api/companies/${cid}/activity`,
];

async function runCount(api: Api, cid: string): Promise<number> {
  return (await api.get<unknown[]>(`/api/companies/${cid}/heartbeat-runs?agentId=${agent.id}&limit=100`)).length;
}

async function openIssue(page: Page, company: E2eCompany, identifier: string) {
  await page.goto(company.path(`issues/${identifier}`));
  await expect(page.getByTestId('issue-detail-header')).toBeVisible();
}

test.beforeAll(async () => {
  const api = await boardApi();
  try {
    const cid = companyId();
    project = await pickProject(api, cid);
    agent = await ensurePlaceholderAgent(api, cid, 'crew-e2e-worker', { wake: false });
    // Issue có người nhận để kiểm "không đánh thức": agent giữ chỗ không bật wakeOnDemand nên không sinh run.
    target = await createIssue(api, cid, {
      title: `PW-S20 issue nhận bình luận ${token}`,
      projectId: project.id,
      assigneeAgentId: agent.id,
    });
  } finally {
    await api.dispose();
  }
});

test('PW-S20-1 khách gửi yêu cầu: hiện Chờ duyệt cho khách và owner, không có ở lõi, agent không thấy @t1', async ({
  contributorPage: page,
  contributorApi,
  api,
  company,
}) => {
  await page.goto(company.path('issues?new=1'));
  const dialog = page.getByRole('dialog', { name: 'Gửi yêu cầu (chờ duyệt)' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('combobox', { name: 'Project' }).click();
  await page.getByRole('option', { name: project.name, exact: true }).click();
  await dialog.getByLabel('Tiêu đề').fill(requestTitle);
  await dialog.getByLabel('Mô tả').fill('Nội dung do Phòng Marketing gửi.');
  await dialog.getByRole('button', { name: 'Gửi để owner duyệt' }).click();
  await expect(dialog.getByText('Đã gửi, chờ owner duyệt')).toBeVisible();
  await dialog.getByRole('button', { name: 'Đóng' }).first().click();

  // Khách thấy mục của mình với nhãn Chờ duyệt.
  await page.goto(company.path('contributions'));
  const row = page.getByTestId('contribution-row').filter({ hasText: requestTitle });
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute('data-status', 'pending');
  await expect(row.getByText('Chờ duyệt', { exact: true })).toBeVisible();
  // Khách không có nút Duyệt hay Từ chối.
  await expect(row.getByRole('button')).toHaveCount(0);

  // Bảng chờ có đúng một dòng pending, cả hai phía cùng thấy.
  const mine = await findContribution(contributorApi, requestTitle);
  expect(mine?.status).toBe('pending');
  expect(mine?.kind).toBe('issue');
  expect(mine?.projectId).toBe(project.id);
  expect((await findContribution(api, requestTitle))?.id).toBe(mine?.id);

  // Chưa có issue thật nào mang tiêu đề đó.
  expect(await api.get<unknown[]>(`/api/companies/${company.id}/issues?q=${encodeURIComponent(marker)}`)).toEqual(
    expect.not.arrayContaining([expect.objectContaining({ title: requestTitle })]),
  );
  const seen = await agentView(api, agentPaths(company.id, marker, target.id));
  expect(seen).not.toContain(marker);
});

test('PW-S20-2 khách bình luận góp ý: bình luận chờ, agent không thấy và không bị đánh thức @t1', async ({
  contributorPage: page,
  contributorApi,
  api,
  company,
}) => {
  const runsBefore = await runCount(api, company.id);
  await openIssue(page, company, target.identifier);
  // Khách dùng ô viết góp ý, không phải ô bình luận stock.
  await expect(page.getByRole('button', { name: 'Gửi bình luận' })).toHaveCount(0);
  await page.getByLabel('Viết góp ý').fill(commentText);
  await page.getByRole('button', { name: 'Gửi để owner duyệt' }).click();

  const pending = page.getByTestId('pending-comment').filter({ hasText: commentText });
  await expect(pending).toBeVisible();
  await expect(pending).toHaveAttribute('data-status', 'pending');
  await expect(pending.getByText('Chờ duyệt', { exact: true })).toBeVisible();

  const item = await findContribution(contributorApi, commentText);
  expect(item?.kind).toBe('comment');
  expect(item?.targetIssueId).toBe(target.id);
  expect(item?.status).toBe('pending');

  const seen = await agentView(api, agentPaths(company.id, marker, target.id));
  expect(seen).not.toContain(marker);
  const comments = await api.get<CommentLite[]>(`/api/issues/${target.id}/comments`);
  expect(JSON.stringify(comments)).not.toContain(commentText);
  // Không có run mới cho người nhận trong lúc chờ.
  await page.waitForTimeout(5_000);
  expect(await runCount(api, company.id)).toBe(runsBefore);
});

test('PW-S20-3 owner thấy badge sidebar, thẻ dashboard, trang Chờ duyệt, chip trong danh sách issue và bình luận chờ trong popup @t1', async ({
  page,
  api,
  company,
}) => {
  const summary = await api.get<{ pending: number }>(route('/summary'));
  expect(summary.pending).toBeGreaterThanOrEqual(2);

  await page.goto(company.path('dashboard'));
  const nav = page.getByRole('navigation', { name: 'Điều hướng chính' });
  const link = nav.getByRole('link', { name: /Chờ duyệt/ });
  await expect(link).toBeVisible();
  await expect(link).toContainText(/\d/);
  await expect(page.getByText('Góp ý chờ duyệt', { exact: true }).first()).toBeVisible();

  // Trang Chờ duyệt: tab Chờ duyệt có cả yêu cầu lẫn bình luận, kèm nút của owner.
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/${company.issuePrefix}/contributions$`));
  const issueRow = page.getByTestId('contribution-row').filter({ hasText: requestTitle });
  await expect(issueRow).toBeVisible();
  await expect(issueRow.getByRole('button', { name: /^Duyệt/ })).toBeEnabled();
  await expect(issueRow.getByRole('button', { name: /^Từ chối/ })).toBeEnabled();
  await expect(page.getByTestId('contribution-row').filter({ hasText: commentText })).toBeVisible();

  // Danh sách issue: nhóm Chờ duyệt và chip lọc.
  await page.goto(company.path('issues'));
  const chip = page.getByTestId('pending-chip');
  await expect(chip).toContainText(/Chờ duyệt \(\d+\)/);
  await chip.click();
  await expect(page.getByTestId('pending-issue').filter({ hasText: requestTitle })).toBeVisible();

  // Popup issue: bình luận chờ nằm trong luồng bình luận.
  await page.goto(company.path(`issues?issue=${target.identifier}`));
  const popup = page.getByTestId('issue-popup');
  await expect(popup).toBeVisible();
  await expect(popup.getByTestId('pending-comment').filter({ hasText: commentText })).toBeVisible();
});

test('PW-S20-4 owner duyệt bình luận: thành bình luận thật của owner, chip Góp ý của, agent thấy @t1', async ({
  page,
  api,
  company,
}) => {
  const item = await findContribution(api, commentText);
  expect(item?.status).toBe('pending');
  await openIssue(page, company, target.identifier);
  const pending = page.getByTestId('pending-comment').filter({ hasText: commentText });
  await expect(pending).toBeVisible();
  await pending.getByRole('button', { name: /^Duyệt/ }).click();

  // Bình luận chờ biến mất, bình luận thật có chip "Góp ý của <tên>".
  await expect(page.getByTestId('pending-comment').filter({ hasText: commentText })).toHaveCount(0);
  const chip = page.getByTestId('contribution-chip');
  await expect(chip).toBeVisible();
  await expect(chip).toContainText('Góp ý của');
  await expect(page.getByText(commentText).first()).toBeVisible();

  const owner = await meId(api);
  const comments = await api.get<CommentLite[]>(`/api/issues/${target.id}/comments`);
  const real = comments.filter((c) => c.body === commentText);
  expect(real).toHaveLength(1);
  expect(real[0]?.authorUserId).toBe(owner);

  const done = await findContribution(api, commentText);
  expect(done?.status).toBe('approved');
  expect(done?.resultCommentId).toBe(real[0]?.id);
  // Agent giờ đọc được bình luận như board viết.
  const seen = await agentView(api, [`/api/issues/${target.id}/comments`]);
  expect(seen).toContain(commentText);
});

test('PW-S20-5 owner duyệt yêu cầu với Lưu nháp: tạo issue thật, Từ chối khóa trong lúc đang duyệt @t1', async ({
  page,
  api,
  company,
}) => {
  const item = await findContribution(api, requestTitle);
  expect(item?.status).toBe('pending');
  const runsBefore = await runCount(api, company.id);

  // Giữ request tạo issue lại để quan sát trạng thái "đang duyệt".
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = false;
  await page.route(`**/api/companies/${company.id}/issues`, async (r) => {
    if (r.request().method() !== 'POST') return r.continue();
    held = true;
    await gate;
    return r.continue();
  });

  await page.goto(company.path('contributions'));
  const row = page.getByTestId('contribution-row').filter({ hasText: requestTitle });
  await row.getByRole('button', { name: /^Duyệt/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Duyệt yêu cầu' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(requestTitle)).toBeVisible();
  await dialog.getByRole('combobox', { name: 'Agent nhận việc' }).click();
  await page.getByRole('option', { name: agent.name, exact: true }).click();
  await dialog.getByLabel('Lưu nháp (chưa đánh thức agent)').check();
  await dialog.getByRole('button', { name: 'Duyệt', exact: true }).click();

  // Đang duyệt: nút Từ chối của dòng bị khóa, dialog không đóng bằng Esc.
  await expect.poll(() => held).toBe(true);
  await expect(dialog.getByRole('button', { name: 'Đang duyệt' })).toBeDisabled();
  await expect(row.locator('button', { hasText: /Từ chối|Đang từ chối/ })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  release();
  await expect(dialog).toHaveCount(0);

  const issues = await api.get<(IssueLite & { assigneeAgentId: string | null; createdByUserId?: string | null })[]>(
    `/api/companies/${company.id}/issues?q=${encodeURIComponent(marker)}`,
  );
  const created = issues.filter((i) => i.title === requestTitle);
  expect(created).toHaveLength(1);
  const issue = created[0];
  if (!issue) throw new Error('Không có issue sau khi duyệt');
  trackIssue(issue.id);
  expect(issue.status).toBe('backlog');
  expect(issue.projectId).toBe(project.id);
  expect(issue.assigneeAgentId).toBe(agent.id);
  expect(issue.createdByUserId).toBe(await meId(api));

  const done = await findContribution(api, requestTitle);
  expect(done?.status).toBe('approved');
  expect(done?.resultIssueId).toBe(issue.id);
  // Nháp không đánh thức người nhận.
  await page.waitForTimeout(3_000);
  expect(await runCount(api, company.id)).toBe(runsBefore);

  // Mục sang tab Đã duyệt, có link tới issue vừa tạo.
  await page.reload();
  await page.getByRole('tab', { name: /^Đã duyệt/ }).click();
  const approved = page.getByTestId('contribution-row').filter({ hasText: requestTitle });
  await expect(approved).toHaveAttribute('data-status', 'approved');
  await expect(approved.getByRole('link', { name: 'Mở yêu cầu đã tạo' })).toBeVisible();
  await expect(approved.getByRole('button')).toHaveCount(0);
});

test('PW-S20-6 owner từ chối: khách thấy Bị từ chối, agent không thấy, khách không có đường ghi @t1', async ({
  page,
  contributorPage: guest,
  contributorApi,
  api,
  company,
}) => {
  const made = await contributorApi.post<Contribution>(route(), {
    kind: 'issue',
    projectId: project.id,
    title: requestTitle2,
  });
  expect(made.status).toBe('pending');

  await page.goto(company.path('contributions'));
  const row = page.getByTestId('contribution-row').filter({ hasText: requestTitle2 });
  await row.getByRole('button', { name: /^Từ chối/ }).click();
  const confirm = page.getByRole('alertdialog').or(page.getByRole('dialog', { name: 'Từ chối mục góp ý?' }));
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Từ chối', exact: true }).click();
  await expect(row).toHaveCount(0);
  await page.getByRole('tab', { name: /^Bị từ chối/ }).click();
  await expect(page.getByTestId('contribution-row').filter({ hasText: requestTitle2 })).toHaveAttribute(
    'data-status',
    'rejected',
  );

  expect((await findContribution(api, requestTitle2))?.status).toBe('rejected');
  // Agent không bao giờ thấy, và lõi không có issue nào mang tiêu đề đó.
  const seen = await agentView(api, agentPaths(company.id, requestTitle2, target.id));
  expect(seen).not.toContain(requestTitle2);
  const core = await api.get<{ title: string }[]>(
    `/api/companies/${company.id}/issues?q=${encodeURIComponent(requestTitle2)}`,
  );
  expect(core.filter((i) => i.title === requestTitle2)).toHaveLength(0);

  // Khách thấy nhãn Bị từ chối, không có nút nào trên dòng.
  await guest.goto(company.path('contributions'));
  await guest.getByRole('tab', { name: /^Bị từ chối/ }).click();
  const mine = guest.getByTestId('contribution-row').filter({ hasText: requestTitle2 });
  await expect(mine).toBeVisible();
  await expect(mine).toHaveAttribute('data-status', 'rejected');
  await expect(mine.getByText('Bị từ chối', { exact: true })).toBeVisible();
  await expect(mine.getByRole('button')).toHaveCount(0);

  // Khách không có mục agent/run/chi phí trên sidebar và không vào được các trang đó.
  const nav = guest.getByRole('navigation', { name: 'Điều hướng chính' });
  await expect(nav.getByRole('link', { name: 'Góp ý của tôi' })).toBeVisible();
  for (const hidden of ['Agent', 'Skills', 'Máy', 'Hộp thư', 'Thành viên']) {
    await expect(nav.getByRole('link', { name: hidden, exact: true })).toHaveCount(0);
  }
  for (const rel of ['agents', 'costs', 'runs', 'inbox', 'members']) {
    await guest.goto(company.path(rel));
    await expect(guest).not.toHaveURL(new RegExp(`/${company.issuePrefix}/${rel}(/|$)`));
  }

  // Trang issue của khách: không có nút ghi của stock.
  await openIssue(guest, company, target.identifier);
  for (const write of ['Gửi bình luận', 'Ép Done', 'Hủy yêu cầu']) {
    await expect(guest.getByRole('button', { name: write })).toHaveCount(0);
  }
  await expect(guest.getByRole('button', { name: 'Gửi để owner duyệt' })).toBeVisible();

  // Lõi từ chối mọi lệnh ghi của khách (viewer).
  const write = await contributorApi.raw('POST', `/api/issues/${target.id}/comments`, { body: `trực tiếp ${token}` });
  expect(write.status).toBe(403);
  const direct = await contributorApi.raw('POST', `/api/companies/${company.id}/issues`, {
    title: `trực tiếp ${token}`,
  });
  expect(direct.status).toBe(403);
  // Khách không tự duyệt được.
  const self = await contributorApi.raw('POST', route(`/${made.id}/approve`));
  expect(self.status).toBe(403);
});

test('PW-S20-7 owner mời khách và bật, gỡ dấu Phòng Marketing ở trang Thành viên @t1', async ({
  page,
  api,
  contributorApi,
  company,
}) => {
  await page.goto(company.path('members'));
  await expect(page.getByRole('heading', { name: 'Thành viên', exact: true })).toBeVisible();

  const contributorInvites = async () =>
    (
      await api.get<{ invites: { id: string; defaultsPayload?: { crew?: { role?: string } } | null }[] }>(
        `/api/companies/${company.id}/invites`,
      )
    ).invites.filter((i) => i.defaultsPayload?.crew?.role === 'contributor');
  const invitesBefore = (await contributorInvites()).length;
  // Tạo lời mời: link dạng /paperclip/invite/<token>, lời mời mang dấu khách trong defaultsPayload.
  await page.getByRole('button', { name: 'Mời Phòng Marketing', exact: true }).click();
  const link = page.getByLabel('Link mời');
  await expect(link).toBeVisible();
  const url = await link.inputValue();
  expect(url).toMatch(/\/paperclip\/invite\/[A-Za-z0-9_-]+$/);
  const inviteToken = url.split('/').pop() ?? '';
  expect((await contributorInvites()).length).toBe(invitesBefore + 1);

  // Thu hồi lời mời vừa tạo (dọn).
  const inviteRows = page.getByTestId('invite-row');
  const before = await inviteRows.count();
  expect(before).toBeGreaterThan(0);
  await inviteRows.first().getByRole('button', { name: 'Thu hồi' }).click();
  await page
    .getByRole('alertdialog')
    .or(page.getByRole('dialog', { name: 'Thu hồi lời mời?' }))
    .getByRole('button', { name: 'Thu hồi' })
    .click();
  await expect(inviteRows).toHaveCount(before - 1);
  await expect(page.getByLabel('Link mời')).toHaveCount(0);
  expect(inviteToken.length).toBeGreaterThan(8);

  // Gỡ rồi bật lại dấu cho khách: quyền thật đổi theo (GET /access của chính khách).
  const guestAccess = () =>
    contributorApi.get<{ membershipRole: string; contributor: boolean }>(`/api/crew/companies/${company.id}/access`);
  expect(await guestAccess()).toMatchObject({ membershipRole: 'viewer', contributor: true });
  const member = page
    .getByTestId('member-row')
    .filter({ has: page.getByText(process.env.CREW_E2E_CONTRIBUTOR_EMAIL ?? '', { exact: true }) });
  try {
    await expect(member).toHaveAttribute('data-role', 'contributor');
    await member.getByRole('button', { name: 'Gỡ Phòng Marketing' }).click();
    await expect(member).toHaveAttribute('data-role', 'viewer');
    expect((await guestAccess()).contributor).toBe(false);
    // Viewer thuần không tạo được góp ý.
    const denied = await contributorApi.raw('POST', route(), {
      kind: 'issue',
      projectId: project.id,
      title: `bị chặn ${token}`,
    });
    expect(denied.status).toBe(403);
  } finally {
    if ((await member.getAttribute('data-role')) === 'viewer') {
      await member.getByRole('button', { name: 'Đặt Phòng Marketing' }).click();
      await expect(member).toHaveAttribute('data-role', 'contributor');
    }
  }
  expect((await guestAccess()).contributor).toBe(true);
});

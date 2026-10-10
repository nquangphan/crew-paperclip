// Ép Done (S6.17) và Lịch sử issue (S6.18): ba trạng thái xuất phát đều thành `done` mà không thành Duyệt, không
// mở workflow, không sinh run của reviewer; việc con/cha; ca âm bằng token agent và lý do không hợp lệ.
import type { Page } from '@playwright/test';
import { agentToken } from '../support/agent-token';
import { bearerApi } from '../support/api';
import { type IssueLite, uniqueToken } from '../support/data';
import { db } from '../support/db';
import { tier } from '../support/env';
import { expect, test } from '../support/fixtures';
import {
  actionsOf,
  agentRuns,
  createChild,
  createGateIssue,
  type GateKind,
  gateAgents,
  issueActivity,
  issueComments,
} from '../support/r3x';

const REASON = 'Đóng tay vì người duyệt đã nghỉ việc (ca e2e).';
const ROUTE = (issueId: string) => `/issues/${issueId}/force-done`;

async function forceDoneOnUi(page: Page, reason: string, opts: { cancelChildren?: boolean } = {}) {
  await page.getByRole('button', { name: 'Ép Done', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  if (opts.cancelChildren === false) await dialog.getByRole('checkbox').uncheck();
  await dialog.getByLabel('Lý do').fill(reason);
  await dialog.getByRole('button', { name: 'Ép Done', exact: true }).click();
  await expect(dialog).toBeHidden();
}

const GATE_CASES: { kind: GateKind; title: string; gateText: RegExp | null }[] = [
  { kind: 'agent-review', title: 'PW-S6-17a Ép Done khi chờ stage review của agent', gateText: /Stage 1: .*đang chờ/ },
  {
    kind: 'owner-approval',
    title: 'PW-S6-17b Ép Done khi chờ stage approval của chính owner',
    gateText: /Stage 1: .*đang chờ/,
  },
  { kind: 'no-stage', title: 'PW-S6-17c Ép Done khi in_progress chưa vào stage', gateText: null },
];

for (const c of GATE_CASES) {
  test(`${c.title}: thành done, không Duyệt, không run mới @t1`, async ({ page, company, api }) => {
    const issue = await createGateIssue(api, company.id, c.kind, `PW-S6-17 ${c.kind} ${uniqueToken()}`);
    test.skip(issue === null, 'Company không có project theo dõi hoặc project nền để dựng issue');
    if (!issue) return;
    const { reviewerId } = await gateAgents(api, company.id);
    const runsBefore = (await agentRuns(api, company.id, reviewerId)).map((r) => r.id);
    const before = await api.get<IssueLite>(`/api/issues/${issue.id}`);
    expect(before.status).toBe(c.kind === 'no-stage' ? 'in_progress' : 'in_review');

    await page.goto(company.path(`issues/${issue.identifier}`));
    await page.getByRole('button', { name: 'Ép Done', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    if (c.gateText) await expect(dialog.getByText(c.gateText)).toBeVisible();
    else {
      // T1 (project theo dõi) không có stage nào; T2 (project Crew) luôn có workflow 4 stage nên liệt kê các cổng.
      await expect(
        dialog
          .getByText('Yêu cầu không có stage nào đang chờ theo workflow.')
          .or(dialog.getByText(/Stage \d+: /).first()),
      ).toBeVisible();
    }
    // Lý do 9 ký tự: nút gửi tắt.
    await dialog.getByLabel('Lý do').fill('123456789');
    await expect(dialog.getByRole('button', { name: 'Ép Done', exact: true })).toBeDisabled();
    await dialog.getByLabel('Lý do').fill(REASON);
    await dialog.getByRole('button', { name: 'Ép Done', exact: true }).click();
    await expect(dialog).toBeHidden();

    // Tác dụng thật.
    await expect.poll(async () => (await api.get<IssueLite>(`/api/issues/${issue.id}`)).status).toBe('done');
    const after = await api.get<IssueLite>(`/api/issues/${issue.id}`);
    expect(after.executionState ?? null).toBeNull();

    const rows = await issueActivity(api, issue.id);
    // T1 (project theo dõi, không workflow): in_progress chưa vào stage thì không vi phạm gì. T2 (project Crew, workflow
    // 4 stage): ép Done bỏ qua các stage chưa duyệt nên luôn có một board_override liệt kê stage_unapproved.
    const overrides = actionsOf(rows, 'crew.policy.board_override');
    expect(overrides).toHaveLength(c.kind === 'no-stage' && tier() === 't1' ? 0 : 1);
    if (c.kind === 'no-stage' && tier() !== 't1') {
      expect(JSON.stringify(overrides[0]?.details ?? {})).toContain('stage_unapproved:');
    }
    const forced = actionsOf(rows, 'crew.issue.force_done');
    expect(forced).toHaveLength(1);
    expect(forced[0]?.details?.reason).toBe(REASON);
    // Ép không phải Duyệt: không có quyết định stage nào được ghi.
    expect(rows.filter((r) => /execution_decision|stage_approved|review_approved/.test(r.action))).toEqual([]);

    const comments = await issueComments(api, issue.id);
    const mine = comments.find((m) => m.body.startsWith('**Ép Done**') && m.body.includes(REASON));
    expect(mine, 'bình luận "Ép Done — …"').toBeTruthy();
    expect(mine?.authorType).toBe('user');

    if (tier() !== 't1') {
      const decisions = await db.query('select count(*) as n from issue_execution_decisions where issue_id = $1', [
        issue.id,
      ]);
      expect(decisions[0]?.n, 'Ép Done không tạo quyết định stage').toBe('0');
    }

    const runsAfter = await agentRuns(api, company.id, reviewerId);
    expect(runsAfter.filter((r) => !runsBefore.includes(r.id))).toEqual([]);

    // Lịch sử hiện dòng gộp có lý do.
    await expect(page.getByRole('heading', { name: 'Lịch sử' })).toBeVisible();
    await expect(page.getByText(`Lý do: ${REASON}`)).toBeVisible();
    await expect(page.getByText('Đã ép Done').first()).toBeVisible();
    // Xong rồi nút Ép Done không còn.
    await expect(page.getByRole('button', { name: 'Ép Done', exact: true })).toHaveCount(0);
  });
}

test('PW-S6-18 Lịch sử không hiện bản ghi riêng từng người và gộp một lần ép thành một dòng @t1', async ({
  page,
  company,
  api,
}) => {
  const issue = await createGateIssue(api, company.id, 'owner-approval', `PW-S6-18 ${uniqueToken()}`);
  test.skip(issue === null, 'Company không có project theo dõi hoặc project nền để dựng issue');
  if (!issue) return;
  await page.goto(company.path(`issues/${issue.identifier}`));
  await forceDoneOnUi(page, REASON);
  await expect(page.getByText(`Lý do: ${REASON}`)).toHaveCount(1);
  await expect(page.getByText(/Cổng bỏ qua:/)).toBeVisible();
  for (const hidden of ['read_marked', 'inbox_archived']) {
    await expect(page.getByText(hidden, { exact: false })).toHaveCount(0);
  }
});

test('PW-S6-17d Ép Done việc con cuối: báo cho yêu cầu cha, không cảnh báo thất bại @t1', async ({
  page,
  company,
  api,
}) => {
  const parent = await createGateIssue(api, company.id, 'no-stage', `PW-S6-17d cha ${uniqueToken()}`);
  test.skip(parent === null, 'Company không có project theo dõi hoặc project nền để dựng issue');
  if (!parent) return;
  const { workerId } = await gateAgents(api, company.id);
  const child = await createChild(api, company.id, parent.id, `PW-S6-17d con ${uniqueToken()}`, workerId);
  const reviewerRunsBefore = (await agentRuns(api, company.id, workerId)).length;

  await page.goto(company.path(`issues/${child.identifier}`));
  await forceDoneOnUi(page, REASON);
  await expect.poll(async () => (await api.get<IssueLite>(`/api/issues/${child.id}`)).status).toBe('done');
  await expect(page.getByText('Đã ép Done nhưng còn việc phụ chưa làm được')).toHaveCount(0);

  const parentNow = await api.get<IssueLite>(`/api/issues/${parent.id}`);
  expect(parentNow.status, 'cha không bị đóng theo').toBe('in_progress');
  // Chỉ T2 đọc được bảng đánh thức; ở T1 người làm giữ chỗ không tự đánh thức nên không có run.
  // Cha giao agent giữ chỗ (wakeOnDemand=false) thì stock ghi yêu cầu bị bỏ qua với reason khác, nên nhận cả
  // lời đánh thức do plugin gửi (payload.mutation) và khóa idempotency `force-done:<con>`.
  if (tier() !== 't1') {
    const wakeups = await db.query(
      `select reason from agent_wakeup_requests
        where (payload->>'issueId' = $1 and (reason = 'issue_children_completed' or payload->>'mutation' = 'plugin_wakeup'))
           or idempotency_key like $2`,
      [parent.id, `force-done:${child.id}%`],
    );
    expect(wakeups.length).toBeGreaterThan(0);
  } else {
    expect((await agentRuns(api, company.id, workerId)).length).toBe(reviewerRunsBefore);
  }
});

test('PW-S6-17e Ép Done việc gốc còn con mở với "Hủy luôn": các con thành cancelled @t1', async ({
  page,
  company,
  api,
}) => {
  const root = await createGateIssue(api, company.id, 'no-stage', `PW-S6-17e gốc ${uniqueToken()}`);
  test.skip(root === null, 'Company không có project theo dõi hoặc project nền để dựng issue');
  if (!root) return;
  const { workerId } = await gateAgents(api, company.id);
  const kids = [
    await createChild(api, company.id, root.id, `PW-S6-17e con 1 ${uniqueToken()}`, workerId),
    await createChild(api, company.id, root.id, `PW-S6-17e con 2 ${uniqueToken()}`, workerId),
  ];

  await page.goto(company.path(`issues/${root.identifier}`));
  await page.getByRole('button', { name: 'Ép Done', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('checkbox', { name: 'Hủy luôn 2 việc con chưa xong' })).toBeChecked();
  await expect(dialog.getByText('Chỉ hủy các việc con liệt kê ở đây.', { exact: false })).toBeVisible();
  await expect(dialog.getByText('Hủy các con còn lại')).toHaveCount(0);
  await dialog.getByLabel('Lý do').fill(REASON);
  await dialog.getByRole('button', { name: 'Ép Done', exact: true }).click();
  await expect(dialog).toBeHidden();

  await expect.poll(async () => (await api.get<IssueLite>(`/api/issues/${root.id}`)).status).toBe('done');
  // Hủy con chạy sau khi cha xong, nên chờ thay vì đọc ngay.
  for (const k of kids) {
    await expect.poll(async () => (await api.get<IssueLite>(`/api/issues/${k.id}`)).status).toBe('cancelled');
  }
  for (const k of kids) {
    const runs = (await api.get<{ status: string }[]>(`/api/issues/${k.id}/runs`)).filter((r) =>
      ['running', 'queued'].includes(r.status),
    );
    expect(runs).toEqual([]);
  }
});

test('PW-S6-17f Ép Done việc gốc, bỏ "Hủy luôn": các con giữ nguyên @t1', async ({ page, company, api }) => {
  const root = await createGateIssue(api, company.id, 'no-stage', `PW-S6-17f gốc ${uniqueToken()}`);
  test.skip(root === null, 'Company không có project theo dõi hoặc project nền để dựng issue');
  if (!root) return;
  const { workerId } = await gateAgents(api, company.id);
  const kid = await createChild(api, company.id, root.id, `PW-S6-17f con ${uniqueToken()}`, workerId);

  await page.goto(company.path(`issues/${root.identifier}`));
  await forceDoneOnUi(page, REASON, { cancelChildren: false });
  await expect.poll(async () => (await api.get<IssueLite>(`/api/issues/${root.id}`)).status).toBe('done');
  expect((await api.get<IssueLite>(`/api/issues/${kid.id}`)).status).toBe('in_progress');
});

test('PW-S6-17g Ca âm Ép Done: token agent 403, lý do 9 ký tự 400 và DB không đổi, issue đã done 409 @t1', async ({
  company,
  api,
}) => {
  const issue = await createGateIssue(api, company.id, 'owner-approval', `PW-S6-17g ${uniqueToken()}`);
  test.skip(issue === null, 'Company không có project theo dõi hoặc project nền để dựng issue');
  if (!issue) return;
  const { workerId } = await gateAgents(api, company.id);
  const snapshot = async () => ({
    issue: await api.get<IssueLite>(`/api/issues/${issue.id}`),
    activity: (await issueActivity(api, issue.id)).length,
    comments: (await issueComments(api, issue.id)).length,
  });
  const before = await snapshot();

  // Token agent: route chỉ dành cho board.
  const key = await agentToken(api, workerId);
  try {
    const asAgent = await bearerApi(key.token);
    try {
      const denied = await asAgent.raw('POST', `/api/plugins/crew.core/api/issues/${issue.id}/force-done`, {
        companyId: company.id,
        reason: REASON,
      });
      expect(denied.status).toBe(403);
    } finally {
      await asAgent.dispose();
    }
  } finally {
    await key.revoke();
  }

  // Lý do 9 ký tự (sau trim): 400, không đổi gì.
  const short = await api.raw('POST', `/api/plugins/crew.core/api/issues/${issue.id}/force-done`, {
    companyId: company.id,
    reason: '  123456789  ',
  });
  expect(short.status).toBe(400);
  expect(short.body).toMatchObject({ error: 'reason_invalid' });
  const unchanged = await snapshot();
  expect(unchanged.issue.status).toBe(before.issue.status);
  expect(unchanged.issue.executionState).toEqual(before.issue.executionState);
  expect(unchanged.activity).toBe(before.activity);
  expect(unchanged.comments).toBe(before.comments);

  // Trường lạ trong body bị từ chối.
  const extra = await api.raw('POST', `/api/plugins/crew.core/api/issues/${issue.id}/force-done`, {
    companyId: company.id,
    reason: REASON,
    cancelChildren: true,
  });
  expect(extra.status).toBe(400);

  // Ép thật một lần, lần hai trên issue đã done: 409.
  const ok = await api.raw('POST', `/api/plugins/crew.core/api/issues/${issue.id}/force-done`, {
    companyId: company.id,
    reason: REASON,
  });
  expect(ok.status).toBe(200);
  const again = await api.raw('POST', `/api/plugins/crew.core/api/issues/${issue.id}/force-done`, {
    companyId: company.id,
    reason: REASON,
  });
  expect(again.status).toBe(409);
  expect(again.body).toMatchObject({ error: 'issue_terminal', status: 'done' });
  expect(ROUTE(issue.id)).toContain(issue.id);
});

test('PW-S6-7R Duyệt thường vẫn không có board_override (hồi quy sau khi thêm Ép Done) @t1', async ({
  page,
  company,
  api,
}) => {
  const issue = await createGateIssue(api, company.id, 'owner-approval', `PW-S6-7R ${uniqueToken()}`);
  test.skip(issue === null, 'Company không có project theo dõi hoặc project nền để dựng issue');
  if (!issue) return;
  await page.goto(company.path(`issues/${issue.identifier}`));
  await page.getByRole('button', { name: 'Duyệt', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox').fill('Duyệt trong ca e2e hồi quy, đủ dài.');
  await dialog.getByRole('button', { name: 'Duyệt', exact: true }).click();
  await expect.poll(async () => (await api.get<IssueLite>(`/api/issues/${issue.id}`)).status).toBe('done');
  const rows = await issueActivity(api, issue.id);
  expect(actionsOf(rows, 'crew.policy.board_override')).toEqual([]);
  expect(actionsOf(rows, 'crew.issue.force_done')).toEqual([]);
});

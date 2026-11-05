// Ticket tổng root-bf với project origin GitLab (TPS-722): ba trường hợp origin (GitLab đã khai báo host, GitHub, lạ) và
// payload `bug-finding-review` sinh từ URL MR GitLab. Quyết định policy chạy bằng CHÍNH hàm của server
// (`originProvider`, `decideCreatePolicy`, `buildCrewPolicy`) và nhận dạng của plugin (`crewPolicyKind`, `latestCrewPr`,
// `validateJobPayload`); policy đó được đưa vào web dev (`/api/*` giả, stub.ts) để kiểm UI hiển thị đúng.
import { expect, type Page, test } from '@playwright/test';
import { decideCreatePolicy, originProvider } from '../../../../server/src/crew/issue-create-policy';
import { buildCrewPolicy, parseCrewPolicyConfig } from '../../../../server/src/crew/issue-policy';
import { latestCrewPr } from '../../../crew-plugin/src/bug-finding/enqueue';
import { parsePrUrl, validateJobPayload } from '../../../crew-plugin/src/jobs/validate';
import { crewPolicyKind } from '../../../crew-plugin/src/shared/policy';
import { ME, type Policy, stubApi } from './stub';

const COMPANY_ID = '10000000-0000-4000-8000-000000000001';
const REVIEWER = '20000000-0000-4000-8000-000000000001';
const INTEGRATOR = '20000000-0000-4000-8000-000000000002';
const GITLAB_HOST = 'gitlab.qasoftsolution.com';
const GITLAB_ORIGIN = `git@${GITLAB_HOST}:nail/business-app.git`;
const MR_URL = `https://${GITLAB_HOST}/nail/business-app/-/merge_requests/42`;
const PR_URL = 'https://github.com/nquangphan/crew/pull/87';
const HEAD = 'a71d02c9e5f1a71d02c9e5f1a71d02c9e5f1a71d';

const parsed = parseCrewPolicyConfig(
  JSON.stringify({
    companies: {
      [COMPANY_ID]: {
        reviewerAgentId: REVIEWER,
        integratorAgentId: INTEGRATOR,
        ownerUserId: ME.id,
        bugFinding: { enabled: true, gitlabHosts: [GITLAB_HOST] },
      },
    },
  }),
  COMPANY_ID,
);
if (parsed.kind !== 'ok') throw new Error(`cấu hình mẫu không hợp lệ: ${JSON.stringify(parsed)}`);
const config = parsed;

/** Board tạo ticket tổng code: server chọn template theo origin của project, rồi dựng policy ghim. */
function createTicket(originUrl: string | null, gitlabHosts: readonly string[] = config.bugFinding.gitlabHosts) {
  const provider = originProvider(originUrl, gitlabHosts);
  const decision = decideCreatePolicy({
    data: { createdByUserId: ME.id },
    roles: config.roles,
    ownerUserId: config.ownerUserId,
    bugFindingEnabled: config.bugFinding.enabled,
    originProvider: provider,
  });
  if (decision.kind !== 'set' || (decision.template !== 'root' && decision.template !== 'root-bf')) {
    throw new Error(`quyết định không ngờ: ${JSON.stringify(decision)}`);
  }
  const policy = buildCrewPolicy(decision.template, config.roles, decision.ownerUserId);
  return { provider, template: decision.template, policy, kind: crewPolicyKind(policy) };
}

/** Thứ tự bước của policy: `[loại stage, agent hoặc user]`. */
const pipeline = (policy: {
  stages: readonly { type: string; participants: readonly { agentId?: string | null; userId?: string | null }[] }[];
}) => policy.stages.map((s) => [s.type, s.participants[0]?.agentId ?? s.participants[0]?.userId]);
const BF_PIPELINE = [
  ['review', INTEGRATOR],
  ['review', REVIEWER],
  ['approval', ME.id],
  ['review', INTEGRATOR],
];
const ROOT_PIPELINE = [
  ['review', REVIEWER],
  ['review', INTEGRATOR],
  ['approval', ME.id],
  ['review', INTEGRATOR],
];

const open = (page: Page) => page.goto('/TPS/issues/TPS-645');
const shot = (page: Page, name: string) =>
  page.screenshot({ path: process.env.CREW_E2E_SHOT_DIR ? `${process.env.CREW_E2E_SHOT_DIR}/${name}.png` : undefined });

test.describe('origin GitLab đã khai báo host (gitlab.qasoftsolution.com)', () => {
  test('tạo ticket code nhận policy root-bf (4 stage) và plugin nhận ra code-bf', () => {
    for (const origin of [
      GITLAB_ORIGIN,
      `ssh://git@${GITLAB_HOST}:2222/nail/business-app.git`,
      `https://${GITLAB_HOST.toUpperCase()}/nail/business-app.git`,
      'https://gitlab.com/team/app.git',
    ]) {
      const ticket = createTicket(origin);
      expect(ticket.provider, origin).toBe('gitlab');
      expect(ticket.template, origin).toBe('root-bf');
      expect(ticket.kind, origin).toBe('code-bf');
      expect(ticket.policy.stages, origin).toHaveLength(4);
      expect(pipeline(ticket.policy), origin).toEqual(BF_PIPELINE);
    }
  });

  test('web: dải 4 giai đoạn, link MR GitLab đúng URL và số MR, màn duyệt nói đúng MR sẽ merge', async ({ page }) => {
    const ticket = createTicket(GITLAB_ORIGIN);
    const stub = await stubApi(page, {
      kind: 'code-bf',
      position: 1,
      bugFinding: 'running',
      policy: ticket.policy as unknown as Policy,
      prUrl: MR_URL,
    });
    await open(page);

    const strip = page.getByRole('list', { name: 'Giai đoạn' });
    await expect(strip.getByRole('listitem')).toHaveCount(4);
    await expect(strip.getByRole('listitem').nth(1)).toContainText('2. Review Bug Finding');
    await expect(strip.getByRole('listitem').nth(1)).toHaveAttribute('aria-current', 'step');

    const first = page.getByRole('region', { name: 'Bug Finding lượt 1' });
    const link = first.getByRole('link', { name: 'PR #42' });
    await expect(link).toHaveAttribute('href', MR_URL);
    await expect(first.getByRole('link', { name: MR_URL })).toHaveCount(0);
    expect(stub.bugFindingCalls[0]).toBe('?companyId=c1');
    await shot(page, 'gitlab-origin-running');
  });

  test('web: owner duyệt có "Duyệt và merge" và nêu MR #42, gửi done', async ({ page }) => {
    const ticket = createTicket(GITLAB_ORIGIN);
    const stub = await stubApi(page, {
      kind: 'code-bf',
      position: 2,
      bugFinding: 'approved',
      policy: ticket.policy as unknown as Policy,
      prUrl: MR_URL,
    });
    await open(page);

    await expect(page.getByRole('button', { name: 'Duyệt', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Duyệt và merge' }).click();
    const dialog = page.getByRole('dialog', { name: 'Duyệt và merge yêu cầu này?' });
    await expect(dialog).toContainText('integrator merge PR #42');
    await expect(dialog.getByRole('region', { name: 'Bug Finding' }).getByText('APPROVE')).toBeVisible();
    await shot(page, 'gitlab-origin-approve');
    await dialog.getByRole('button', { name: 'Duyệt và merge' }).click();
    await expect.poll(() => stub.writes.length).toBe(1);
    expect(stub.writes[0]?.body).toMatchObject({ status: 'done' });
  });
});

test.describe('origin GitHub (không hồi quy)', () => {
  test('vẫn root-bf như cũ, cùng 4 stage với project GitLab', () => {
    for (const origin of [
      'https://github.com/nquangphan/kidy_school.git',
      'git@github.com:nquangphan/kidy_school.git',
      'ssh://git@github.com:22/o/r.git',
    ]) {
      const ticket = createTicket(origin);
      expect(ticket.provider, origin).toBe('github');
      expect(ticket.template, origin).toBe('root-bf');
      expect(ticket.kind, origin).toBe('code-bf');
      expect(pipeline(ticket.policy), origin).toEqual(BF_PIPELINE);
    }
    // Company không khai báo host GitLab nào: GitHub vẫn root-bf.
    expect(createTicket('git@github.com:o/r.git', []).template).toBe('root-bf');
  });

  test('web: PR GitHub vẫn hiển thị "PR #87" trỏ đúng URL, màn duyệt nêu PR #87', async ({ page }) => {
    const ticket = createTicket('git@github.com:nquangphan/crew.git');
    await stubApi(page, {
      kind: 'code-bf',
      position: 2,
      bugFinding: 'approved',
      policy: ticket.policy as unknown as Policy,
      prUrl: PR_URL,
    });
    await open(page);

    await expect(
      page.getByRole('region', { name: 'Bug Finding lượt 1' }).getByRole('link', { name: 'PR #87' }),
    ).toHaveAttribute('href', PR_URL);
    await page.getByRole('button', { name: 'Duyệt và merge' }).click();
    await expect(page.getByRole('dialog', { name: 'Duyệt và merge yêu cầu này?' })).toContainText(
      'integrator merge PR #87',
    );
    await shot(page, 'github-origin-approve');
  });
});

test.describe('origin lạ hoặc host GitLab chưa khai báo', () => {
  const UNKNOWN: [string, string | null][] = [
    ['host GitLab tự host chưa khai báo', 'git@gitlab.corp.vn:o/r.git'],
    ['host lạ', 'https://git.corp.vn/o/r.git'],
    ['host giống github.com', 'https://github.com.evil.vn/o/r.git'],
    ['host giống gitlab.com', 'https://gitlab.com.evil.vn/o/r.git'],
    ['đường dẫn máy', '/Volumes/CORSAIR/Projects/r'],
    ['rỗng', ''],
    ['chưa có origin', null],
  ];

  test('nhận root như cũ (reviewer → integrator → owner → integrator), không phải root-bf', () => {
    for (const [name, origin] of UNKNOWN) {
      const ticket = createTicket(origin);
      expect(ticket.provider, name).toBeNull();
      expect(ticket.template, name).toBe('root');
      expect(ticket.kind, name).toBe('code');
      expect(pipeline(ticket.policy), name).toEqual(ROOT_PIPELINE);
    }
  });

  test('host đã khai báo nhưng company chưa khai báo gì (gitlabHosts rỗng) cũng nhận root', () => {
    const ticket = createTicket(GITLAB_ORIGIN, []);
    expect(ticket.template).toBe('root');
    expect(ticket.kind).toBe('code');
  });

  test('web: policy root giữ nút "Duyệt", không có dải Bug Finding và không gọi route Bug Finding', async ({
    page,
  }) => {
    const ticket = createTicket('git@gitlab.corp.vn:o/r.git');
    const stub = await stubApi(page, { kind: 'code', position: 2, policy: ticket.policy as unknown as Policy });
    await open(page);

    await expect(page.getByRole('button', { name: 'Duyệt', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Duyệt và merge' })).toHaveCount(0);
    await expect(page.getByRole('list', { name: 'Giai đoạn' })).toHaveCount(0);
    expect(stub.bugFindingCalls).toEqual([]);
    await shot(page, 'unknown-origin-approve');
  });
});

test.describe('payload bug-finding-review từ URL MR GitLab', () => {
  const INTEGRATOR_ID = INTEGRATOR;
  const crewPr = (pr: string) => [
    {
      authorAgentId: INTEGRATOR_ID,
      body: `crew-pr sha=${HEAD} pr=${pr}\nĐã mở.`,
      createdAt: '2026-11-05T01:00:00.000Z',
    },
  ];
  const payload = (over: Record<string, unknown> = {}) => ({
    requestId: '30000000-0000-4000-8000-000000000001',
    issueId: '30000000-0000-4000-8000-000000000002',
    identifier: 'TPS-645',
    run: 1,
    projectId: '30000000-0000-4000-8000-000000000003',
    projectKey: 'business-app',
    repoPath: '/Users/dev/crew-agents/business-app/repo',
    provider: 'gitlab',
    prNumber: 42,
    prUrl: MR_URL,
    headSha: HEAD,
    baseBranch: 'main',
    ...over,
  });

  test('crew-pr với URL MR GitLab → provider gitlab, prNumber = iid, payload hợp lệ', () => {
    const pr = latestCrewPr(crewPr(MR_URL), INTEGRATOR_ID);
    expect(pr).toEqual({ sha: HEAD, prUrl: MR_URL, prNumber: 42, provider: 'gitlab' });
    if (!pr) throw new Error('thiếu crew-pr');
    expect(
      validateJobPayload(
        'bug-finding-review',
        payload({ provider: pr.provider, prNumber: pr.prNumber, prUrl: pr.prUrl }),
      ),
    ).toMatchObject({
      kind: 'bug-finding-review',
      provider: 'gitlab',
      prNumber: 42,
      prUrl: MR_URL,
      baseBranch: 'main',
    });
  });

  test('URL MR có nhóm con, cổng, gitlab.com: số MR đúng', () => {
    for (const [url, number] of [
      [`https://${GITLAB_HOST}/nail/mobile/business-app/-/merge_requests/7`, 7],
      [`https://${GITLAB_HOST}:8443/nail/business-app/-/merge_requests/1203`, 1203],
      ['https://gitlab.com/team/app/-/merge_requests/9', 9],
    ] as const) {
      expect(parsePrUrl(url), url).toEqual({ provider: 'gitlab', number });
      expect(latestCrewPr(crewPr(url), INTEGRATOR_ID), url).toMatchObject({ provider: 'gitlab', prNumber: number });
    }
  });

  test('PR GitHub vẫn sinh payload provider github (không hồi quy)', () => {
    const pr = latestCrewPr(crewPr(PR_URL), INTEGRATOR_ID);
    expect(pr).toEqual({ sha: HEAD, prUrl: PR_URL, prNumber: 87, provider: 'github' });
    if (!pr) throw new Error('thiếu crew-pr');
    expect(
      validateJobPayload('bug-finding-review', payload({ provider: 'github', prNumber: 87, prUrl: PR_URL })),
    ).toMatchObject({
      provider: 'github',
      prNumber: 87,
    });
  });

  test('payload sai bị từ chối: prNumber lệch URL, provider lệch URL, URL lạ, comment không phải integrator', () => {
    expect(validateJobPayload('bug-finding-review', payload({ prNumber: 41 }))).toBe('prUrl không khớp prNumber');
    expect(validateJobPayload('bug-finding-review', payload({ provider: 'github' }))).toBe('prUrl không khớp provider');
    expect(
      validateJobPayload('bug-finding-review', payload({ prUrl: `https://${GITLAB_HOST}/nail/-/merge_requests/42` })),
    ).toBe('prUrl không hợp lệ');
    expect(validateJobPayload('bug-finding-review', payload({ provider: 'bitbucket' }))).toBe(
      'provider chỉ nhận github hoặc gitlab',
    );
    expect(latestCrewPr(crewPr('https://github.com/o/r/-/merge_requests/3'), INTEGRATOR_ID)).toBeNull();
    expect(latestCrewPr(crewPr(MR_URL), REVIEWER)).toBeNull();
  });
});

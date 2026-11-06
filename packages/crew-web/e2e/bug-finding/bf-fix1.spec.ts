// Lô sửa Bug Finding bf-fix-1 của TPS-722 (F-01, F-02, F-06), bổ sung cho gitlab-origin.spec.ts và root-bf.spec.ts:
// - F-01: ticket root-bf mà `crew-pr`/`crew-merge` có URL MR khác host với origin của project không qua được stage gộp/merge
//   (quyết định chạy bằng CHÍNH `evaluateIssueGate` và `buildCrewPolicy` của server).
// - F-02: `bugFinding.gitlabHosts` có phần tử sai dạng vẫn giữ policy: ticket mới vẫn nhận root-bf theo host hợp lệ còn lại.
// - F-06: web hiển thị đúng số MR (iid) cho URL MR GitLab có nhóm con, cổng hay đoạn đường dẫn giống `/pull/<số>/`.
import { expect, type Page, test } from '@playwright/test';
import { decideCreatePolicy, originProvider } from '../../../../server/src/crew/issue-create-policy';
import { evaluateIssueGate, type IssueGateFacts } from '../../../../server/src/crew/issue-gate';
import { buildCrewPolicy, parseCrewPolicyConfig } from '../../../../server/src/crew/issue-policy';
import { crewPolicyKind } from '../../../crew-plugin/src/shared/policy';
import { ME, type Policy, stubApi } from './stub';

const COMPANY_ID = '10000000-0000-4000-8000-000000000001';
const REVIEWER = '20000000-0000-4000-8000-000000000001';
const INTEGRATOR = '20000000-0000-4000-8000-000000000002';
const GITLAB_HOST = 'gitlab.qasoftsolution.com';
const GITLAB_ORIGIN = `git@${GITLAB_HOST}:nail/business-app.git`;
const roles = { reviewerAgentId: REVIEWER, integratorAgentId: INTEGRATOR };
const SHA_BASE = 'a'.repeat(40);
const SHA_HEAD = 'b'.repeat(40);

const configText = (bugFinding: unknown) =>
  JSON.stringify({
    companies: {
      [COMPANY_ID]: { reviewerAgentId: REVIEWER, integratorAgentId: INTEGRATOR, ownerUserId: ME.id, bugFinding },
    },
  });

/** Board tạo ticket tổng code với project origin `originUrl`, cấu hình Crew là `bugFinding`. */
function createTicket(originUrl: string, bugFinding: unknown) {
  const config = parseCrewPolicyConfig(configText(bugFinding), COMPANY_ID);
  if (config.kind !== 'ok') return { config, ticket: null };
  const decision = decideCreatePolicy({
    data: { createdByUserId: ME.id },
    roles: config.roles,
    ownerUserId: config.ownerUserId,
    bugFindingEnabled: config.bugFinding.enabled,
    originProvider: originProvider(originUrl, config.bugFinding.gitlabHosts),
  });
  if (decision.kind !== 'set' || (decision.template !== 'root' && decision.template !== 'root-bf')) {
    throw new Error(`quyết định không ngờ: ${JSON.stringify(decision)}`);
  }
  const policy = buildCrewPolicy(decision.template, config.roles, decision.ownerUserId);
  return { config, ticket: { template: decision.template, policy, kind: crewPolicyKind(policy) } };
}

// ---------------------------------------------------------------------------------------------------------------------
// F-01
// ---------------------------------------------------------------------------------------------------------------------
const rootBf = buildCrewPolicy('root-bf', roles, ME.id);
const [bfMerge, bfBridge, bfOwner, bfLand] = rootBf.stages.map((s) => s.id) as [string, string, string, string];
const executorPrincipal = { type: 'agent', agentId: '33333333-3333-4333-8333-333333333333', userId: null };
const integratorP = { type: 'agent', agentId: INTEGRATOR, userId: null };
const reviewerP = { type: 'agent', agentId: REVIEWER, userId: null };
const T0 = new Date('2026-10-07T09:00:00Z');
const T0_5 = new Date('2026-10-07T09:30:00Z');
const T1 = new Date('2026-10-07T10:00:00Z');
const T2 = new Date('2026-10-07T11:00:00Z');
const T3 = new Date('2026-10-07T12:00:00Z');

function pending(
  stageId: string,
  participant: object,
  completedStageIds: string[] = [],
  lastDecisionOutcome: string | null = null,
) {
  const index = rootBf.stages.findIndex((s) => s.id === stageId);
  return {
    status: 'pending',
    currentStageId: stageId,
    currentStageIndex: index,
    currentStageType: rootBf.stages[index]?.type ?? null,
    currentParticipant: participant,
    returnAssignee: executorPrincipal,
    reviewRequest: null,
    completedStageIds,
    lastDecisionId: null,
    lastDecisionOutcome,
    changesRequestedCount: 0,
  };
}
const completedState = (ids: string[]) => ({
  ...pending(bfLand, integratorP, ids, 'approved'),
  status: 'completed',
  currentStageId: null,
  currentStageIndex: null,
  currentStageType: null,
  currentParticipant: null,
});

const GATE_FACTS: IssueGateFacts = {
  locked: {
    status: 'in_review',
    executionPolicy: rootBf,
    executionState: null,
    assigneeAgentId: INTEGRATOR,
    assigneeUserId: null,
  },
  patch: {},
  actor: { kind: 'agent', agentId: INTEGRATOR },
  roles,
  approvals: [],
  cycleStartedAt: null,
  lastChangesRequestedAt: null,
  docsEvidence: null,
  pushEvidence: null,
};
const facts = (over: Partial<IssueGateFacts>): IssueGateFacts => ({ ...GATE_FACTS, ...over });

const docsAt = (createdAt: Date) => ({
  evidence: { commit: SHA_HEAD, base: SHA_BASE, head: SHA_HEAD, exit: 0 as const },
  createdAt,
});
const MR = `https://${GITLAB_HOST}/nail/business-app/-/merge_requests/42`;
const OTHER_MR = `https://${GITLAB_HOST}/nail/business-app/-/merge_requests/43`;
const EVIL_MR = 'https://evil.example/nail/business-app/-/merge_requests/42';
const GITHUB_PR = 'https://github.com/acme/app/pull/87';
const origin = { originUrl: GITLAB_ORIGIN, gitlabHosts: [GITLAB_HOST] };

test.describe('F-01: URL MR host khác origin của project không qua được ticket root-bf', () => {
  /** Stage 0 (gộp + PR): integrator chuyển sang stage cầu nối Bug Finding. */
  const mergeStage = (pr: string, projectOrigin: IssueGateFacts['projectOrigin']) =>
    evaluateIssueGate(
      facts({
        locked: {
          status: 'in_review',
          executionPolicy: rootBf,
          executionState: pending(bfMerge, integratorP),
          assigneeAgentId: INTEGRATOR,
          assigneeUserId: null,
        },
        patch: { status: 'in_review', executionState: pending(bfBridge, reviewerP, [bfMerge], 'approved') },
        docsEvidence: docsAt(T1),
        prEvidence: { sha: SHA_HEAD, pr, createdAt: T2 },
        projectOrigin,
      }),
    );

  test('stage gộp: crew-pr đúng host origin qua được', () => {
    expect(mergeStage(MR, origin)).toEqual({ kind: 'allow', notes: [] });
  });

  test('stage gộp: crew-pr host lạ, PR GitHub của project GitLab, host GitLab chưa khai báo bị chặn (pr_origin_mismatch)', () => {
    for (const [name, pr, projectOrigin] of [
      ['host lạ', EVIL_MR, origin],
      ['PR GitHub trên project GitLab', GITHUB_PR, origin],
      ['host GitLab chưa khai báo trong gitlabHosts', MR, { ...origin, gitlabHosts: [] }],
      ['origin chưa biết', MR, undefined],
    ] as const) {
      const verdict = mergeStage(pr, projectOrigin);
      expect(verdict, name).toMatchObject({
        kind: 'block',
        code: 'crew_gate_blocked',
        violations: ['pr_origin_mismatch'],
      });
    }
  });

  test('stage gộp: origin GitHub vẫn nhận PR GitHub, nhưng URL MR GitLab thì bị chặn (không hồi quy GitHub)', () => {
    const github = { originUrl: 'git@github.com:acme/app.git', gitlabHosts: [GITLAB_HOST] };
    expect(mergeStage(GITHUB_PR, github)).toEqual({ kind: 'allow', notes: [] });
    expect(mergeStage(MR, github)).toMatchObject({ violations: ['pr_origin_mismatch'] });
  });

  /** Stage 3 (merge): integrator báo xong sau khi owner duyệt. */
  const landStage = (merge: string, pr: string, projectOrigin: IssueGateFacts['projectOrigin'] = origin) =>
    evaluateIssueGate(
      facts({
        locked: {
          status: 'in_review',
          executionPolicy: rootBf,
          executionState: pending(bfLand, integratorP, [bfMerge, bfBridge, bfOwner]),
          assigneeAgentId: INTEGRATOR,
          assigneeUserId: null,
        },
        patch: { status: 'done', executionState: completedState([bfMerge, bfBridge, bfOwner, bfLand]) },
        approvals: [
          { stageId: bfMerge, actorAgentId: INTEGRATOR, actorUserId: null, createdAt: T0 },
          { stageId: bfBridge, actorAgentId: REVIEWER, actorUserId: null, createdAt: T0 },
          { stageId: bfOwner, actorAgentId: null, actorUserId: ME.id, createdAt: T2 },
        ],
        docsEvidence: docsAt(T0),
        prEvidence: { sha: SHA_HEAD, pr, createdAt: T0_5 },
        pushEvidence: { sha: SHA_HEAD, branch: 'crew/req/TPS-1', pr: merge, merge: 'd'.repeat(40), createdAt: T3 },
        bugFindingRuns: [{ headSha: SHA_HEAD, state: 'succeeded' }],
        projectOrigin,
      }),
    );

  test('stage merge: crew-merge đúng URL của crew-pr và đúng host origin qua được', () => {
    expect(landStage(MR, MR)).toEqual({ kind: 'allow', notes: [] });
  });

  test('stage merge: crew-merge host lạ (push_origin_mismatch) hay URL khác crew-pr (merge_pr_mismatch) bị chặn', () => {
    expect(landStage(OTHER_MR, MR)).toMatchObject({ kind: 'block', violations: ['merge_pr_mismatch'] });
    expect(landStage(EVIL_MR, MR)).toMatchObject({
      kind: 'block',
      violations: ['push_origin_mismatch', 'merge_pr_mismatch'],
    });
    // Host GitLab chưa khai báo: cả crew-pr lẫn crew-merge đều không thuộc origin.
    expect(landStage(MR, MR, { ...origin, gitlabHosts: [] })).toMatchObject({
      violations: ['pr_origin_mismatch', 'push_origin_mismatch'],
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// F-02
// ---------------------------------------------------------------------------------------------------------------------
test.describe('F-02: gitlabHosts có phần tử sai dạng vẫn giữ policy cho ticket mới', () => {
  const BAD_HOSTS = [
    'https://gitlab.bad.example/x',
    'host.example:8443',
    'gitlab.corp.vn/path',
    '',
    42,
    null,
    { host: 'x' },
  ];

  test('cấu hình vẫn hợp lệ, chỉ giữ host hợp lệ (chữ thường), ticket mới nhận root-bf cho host đó', () => {
    const { config, ticket } = createTicket(GITLAB_ORIGIN, {
      enabled: true,
      gitlabHosts: [...BAD_HOSTS, GITLAB_HOST.toUpperCase()],
    });
    expect(config.kind).toBe('ok');
    if (config.kind !== 'ok') return;
    expect(config.bugFinding).toEqual({ enabled: true, gitlabHosts: [GITLAB_HOST] });
    expect(ticket?.template).toBe('root-bf');
    expect(ticket?.kind).toBe('code-bf');
    expect(ticket?.policy.stages).toHaveLength(4);
  });

  test('host sai dạng không được coi là GitLab: origin ở host đó nhận root như cũ, policy Crew không mất', () => {
    const { config, ticket } = createTicket('git@gitlab.bad.example:o/r.git', {
      enabled: true,
      gitlabHosts: ['https://gitlab.bad.example/x', GITLAB_HOST],
    });
    expect(config.kind).toBe('ok');
    expect(ticket?.template).toBe('root');
    expect(ticket?.kind).toBe('code');
    expect(ticket?.policy.stages).toHaveLength(4);
  });

  test('gitlabHosts không phải mảng, hay mọi phần tử sai: cấu hình vẫn ok, GitHub vẫn root-bf', () => {
    for (const hosts of ['gitlab.qasoftsolution.com', { a: 1 }, 7, BAD_HOSTS]) {
      const { config, ticket } = createTicket('git@github.com:o/r.git', { enabled: true, gitlabHosts: hosts });
      expect(config.kind, JSON.stringify(hosts)).toBe('ok');
      expect(config.kind === 'ok' ? config.bugFinding.gitlabHosts : null, JSON.stringify(hosts)).toEqual([]);
      expect(ticket?.template, JSON.stringify(hosts)).toBe('root-bf');
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// F-06
// ---------------------------------------------------------------------------------------------------------------------
const open = (page: Page) => page.goto('/TPS/issues/TPS-645');
const shot = (page: Page, name: string) =>
  page.screenshot({ path: process.env.CREW_E2E_SHOT_DIR ? `${process.env.CREW_E2E_SHOT_DIR}/${name}.png` : undefined });

test.describe('F-06: web hiển thị đúng số MR cho URL MR GitLab', () => {
  const CASES: [string, string, string][] = [
    ['nhóm con', `https://${GITLAB_HOST}/nail/mobile/business-app/-/merge_requests/7`, '7'],
    ['cổng riêng', `https://${GITLAB_HOST}:8443/nail/business-app/-/merge_requests/1203`, '1203'],
    // Đoạn đường dẫn giống `/pull/<số>/`: số MR vẫn là iid sau `/-/merge_requests/`, không phải số trong đường dẫn.
    ['đường dẫn giống /pull/<số>/', `https://${GITLAB_HOST}/team/pull/123/-/merge_requests/9`, '9'],
  ];

  for (const [name, url, number] of CASES) {
    test(`${name}: link "PR #${number}" trỏ đúng URL, màn duyệt nêu MR #${number}`, async ({ page }) => {
      const { ticket } = createTicket(GITLAB_ORIGIN, { enabled: true, gitlabHosts: [GITLAB_HOST] });
      if (!ticket) throw new Error('thiếu ticket');
      await stubApi(page, {
        kind: 'code-bf',
        position: 2,
        bugFinding: 'approved',
        policy: ticket.policy as unknown as Policy,
        prUrl: url,
      });
      await open(page);

      const first = page.getByRole('region', { name: 'Bug Finding lượt 1' });
      await expect(first.getByRole('link', { name: `PR #${number}`, exact: true })).toHaveAttribute('href', url);
      await page.getByRole('button', { name: 'Duyệt và merge' }).click();
      const dialog = page.getByRole('dialog', { name: 'Duyệt và merge yêu cầu này?' });
      await expect(dialog).toContainText(`integrator merge PR #${number}`);
      await shot(page, `bf-fix1-f06-${number}`);
    });
  }
});

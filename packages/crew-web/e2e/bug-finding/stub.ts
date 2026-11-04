// Giả `/api/*` cho luồng ticket tổng root-bf: dữ liệu theo hợp đồng thật (issue, map `crew.map`, route
// `…/issues/:id/bug-finding`), request ghi (PATCH) được ghi lại để ca kiểm. Route nào chưa giả trả 404 `no mock`.
import type { Page, Route } from '@playwright/test';

export const COMPANY = { id: 'c1', name: '2P Solutions', issuePrefix: 'TPS' };
export const ME = { id: 'u1', name: 'Owner', email: 'owner@example.com', image: null };
export const HEAD1 = `a71d02c9e5f1${'0'.repeat(28)}`;
export const HEAD2 = `3f9c1e07a2b4${'0'.repeat(28)}`;
const PLUGIN = '/api/plugins/crew.core';

type Principal = { id: string; type: 'agent' | 'user'; agentId?: string; userId?: string };
const agent = (id: string, agentId: string): Principal => ({ id, type: 'agent', agentId });
const user = (id: string, userId: string): Principal => ({ id, type: 'user', userId });
const stage = (id: string, type: 'review' | 'approval', who: Principal) => ({
  id,
  type,
  approvalsNeeded: 1,
  participants: [who],
});

/** Policy ghim: `code-bf` = integrator → reviewer cầu nối → owner → integrator; `code` = reviewer → integrator → owner → integrator. */
export const POLICIES = {
  'code-bf': {
    mode: 'normal',
    commentRequired: true,
    maxReviewRounds: 5,
    stages: [
      stage('s1', 'review', agent('p1', 'a-integrator')),
      stage('s2', 'review', agent('p2', 'a-reviewer')),
      stage('s3', 'approval', user('p3', ME.id)),
      stage('s4', 'review', agent('p4', 'a-integrator')),
    ],
  },
  code: {
    mode: 'normal',
    commentRequired: true,
    maxReviewRounds: 5,
    stages: [
      stage('s1', 'review', agent('p1', 'a-reviewer')),
      stage('s2', 'review', agent('p2', 'a-integrator')),
      stage('s3', 'approval', user('p3', ME.id)),
      stage('s4', 'review', agent('p4', 'a-integrator')),
    ],
  },
} as const;

export type Kind = keyof typeof POLICIES;
/** Vị trí stage hiện tại: 1 = review (Bug Finding với code-bf), 2 = owner duyệt. */
export type Position = 1 | 2;

function executionState(kind: Kind, position: Position) {
  const stages = POLICIES[kind].stages;
  const current = stages[position];
  const participant = current.participants[0];
  return {
    status: 'pending',
    currentStageId: current.id,
    currentStageIndex: position,
    currentStageType: current.type,
    currentParticipant:
      participant.type === 'user'
        ? { type: 'user', userId: participant.userId }
        : { type: 'agent', agentId: participant.agentId },
    returnAssignee: null,
    reviewRequest: null,
    completedStageIds: stages.slice(0, position).map((s) => s.id),
    lastDecisionId: null,
    lastDecisionOutcome: null,
    changesRequestedCount: 0,
  };
}

export function rootIssue(kind: Kind, position: Position) {
  return {
    id: 'i-root',
    companyId: COMPANY.id,
    projectId: 'p1',
    parentId: null,
    ancestors: [],
    identifier: 'TPS-645',
    title: 'Làm theo kế hoạch: gom app Bug Finding',
    description: 'Ticket tổng.',
    status: 'in_review',
    assigneeAgentId: null,
    assigneeUserId: position === 2 ? ME.id : null,
    labels: [],
    blockedBy: [],
    executionPolicy: POLICIES[kind],
    executionState: executionState(kind, position),
    createdAt: '2026-11-04T01:00:00.000Z',
    updatedAt: '2026-11-04T05:00:00.000Z',
    startedAt: '2026-11-04T02:00:00.000Z',
    completedAt: null,
  };
}

function node(id: string, identifier: string, title: string, status: string, over: object = {}) {
  return {
    id,
    identifier,
    title,
    status,
    parentId: id === 'i-root' ? null : 'i-root',
    assignee: null,
    stage: null,
    reviewRounds: 0,
    maxReviewRounds: 5,
    kind: 'code',
    bundle: null,
    ...over,
  };
}

export function crewMap(kind: Kind, position: Position) {
  const stages = POLICIES[kind].stages;
  const root = node('i-root', 'TPS-645', 'Làm theo kế hoạch: gom app Bug Finding', 'in_review', {
    kind,
    stage: {
      currentStageId: stages[position].id,
      currentType: stages[position].type,
      completed: stages.slice(0, position).map((s) => s.id),
      position,
    },
  });
  const done = { currentStageId: null, currentType: null, completed: ['s1'], position: null };
  const nodes = [
    root,
    node('i-a', 'TPS-651', 'Sửa lọc ngày dùng giờ máy', 'done', { stage: done }),
    node('i-b', 'TPS-652', 'Bổ sung test ngày cuối tháng', 'done', { stage: done }),
  ];
  return {
    root,
    nodes,
    edges: [
      { kind: 'parent', from: 'i-root', to: 'i-a' },
      { kind: 'parent', from: 'i-root', to: 'i-b' },
    ],
    diagnostics: [],
  };
}

function finding(id: string, severity: string, title: string, over: object = {}) {
  return {
    id,
    rule: null,
    title,
    severity,
    certainty: 'Confirmed',
    status: 'OPEN',
    action: 'CODE_FIX',
    mr_relation: 'introduced',
    location: 'src/date-filter.ts:57',
    fix: null,
    accept: null,
    question: null,
    ...over,
  };
}

function run(over: object) {
  return {
    id: 'r1',
    companyId: COMPANY.id,
    issueId: 'i-root',
    approvalRound: 0,
    run: 1,
    requestId: 'q1',
    machineJobId: null,
    machineId: 'm1',
    headSha: HEAD1,
    prUrl: 'https://github.com/nquangphan/crew/pull/87',
    state: 'succeeded',
    verdict: 'BLOCK',
    lanesDone: 7,
    lanesTotal: 7,
    findings: [],
    feedbackText: null,
    reportDocumentKey: 'bug-finding-round-0-run-1',
    costUsd: 1.84,
    error: null,
    createdAt: '2026-11-04T01:00:00.000Z',
    startedAt: '2026-11-04T01:01:00.000Z',
    finishedAt: '2026-11-04T01:35:00.000Z',
    triage: null,
    ...over,
  };
}

/** Lượt 1 xong (BLOCK, 4 finding, Trợ Lý phân ba nhóm), lượt 2 đang chạy 4/7 lane trên head mới. */
export function bugFindingView(state: 'running' | 'approved') {
  const first = run({
    findings: [
      finding('F-01', 'HIGH', 'Lọc ngày dùng giờ máy'),
      finding('F-02', 'MEDIUM', 'Thiếu test ngày cuối tháng', { action: 'TEST_FIX' }),
      finding('F-04', 'LOW', 'Không giới hạn khoảng ngày', {
        certainty: 'Needs-Clarification',
        question: 'Có cần giới hạn 12 tháng?',
      }),
      finding('F-05', 'LOW', 'Tên biến viết tắt', { mr_relation: 'pre_existing' }),
    ],
    triage: {
      run: 1,
      batch: 1,
      fix: ['F-01', 'F-02'],
      ask: ['F-04'],
      dismiss: ['F-05'],
      createdAt: '2026-11-04T01:40:00.000Z',
      reasons: { 'F-05': 'Có từ trước PR này, ngoài phạm vi yêu cầu.' },
      fixIssues: {
        'F-01': [{ id: 'i-a', identifier: 'TPS-651', status: 'done' }],
        'F-02': [{ id: 'i-b', identifier: 'TPS-652', status: 'done' }],
      },
    },
  });
  const second =
    state === 'running'
      ? run({
          id: 'r2',
          run: 2,
          requestId: 'q2',
          headSha: HEAD2,
          state: 'running',
          verdict: null,
          lanesDone: 4,
          lanesTotal: 7,
          findings: null,
          reportDocumentKey: null,
          costUsd: null,
          createdAt: '2026-11-04T03:00:00.000Z',
          finishedAt: null,
        })
      : run({
          id: 'r2',
          run: 2,
          requestId: 'q2',
          headSha: HEAD2,
          verdict: 'APPROVE',
          costUsd: 0.96,
          createdAt: '2026-11-04T03:00:00.000Z',
          finishedAt: '2026-11-04T03:30:00.000Z',
          findings: [finding('F-01', 'HIGH', 'Lọc ngày dùng giờ máy', { status: 'FIX_VERIFIED' })],
        });
  return { runs: [second, first], batchesUsed: 1, maxBatches: 2, currentHead: HEAD2, approvalRound: 0 };
}

export interface StubOptions {
  kind: Kind;
  position: Position;
  /** Không có: ticket policy cũ, route Bug Finding không được gọi. */
  bugFinding?: 'running' | 'approved';
}

export interface Stub {
  /** Mọi request ghi (không phải GET) tới `/api/issues/*`. */
  writes: { method: string; path: string; body: unknown }[];
  /** Mọi lần gọi route `…/bug-finding`. */
  bugFindingCalls: string[];
}

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, json: body });

/** Giả toàn bộ `/api/*` cho trang ticket tổng TPS-645. */
export async function stubApi(page: Page, options: StubOptions): Promise<Stub> {
  const stub: Stub = { writes: [], bugFindingCalls: [] };
  const issue = rootIssue(options.kind, options.position);
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      const path = url.pathname;
      const method = req.method();
      if (path === '/api/auth/get-session') {
        return json(route, { session: { id: 's1', userId: ME.id }, user: ME, sentryDsn: null });
      }
      if (path === '/api/companies') return json(route, [COMPANY]);
      if (path === `${PLUGIN}/data/crew.companies`)
        return json(route, { data: [{ id: COMPANY.id, name: COMPANY.name }] });
      if (path === `${PLUGIN}/data/crew.map`) return json(route, { data: crewMap(options.kind, options.position) });
      if (path === `${PLUGIN}/data/crew.runtimeDecisions`) return json(route, { data: [] });
      if (path === `${PLUGIN}/data/crew.docsCheck`) return json(route, { data: null });
      if (path === `${PLUGIN}/api/issues/i-root/bug-finding`) {
        stub.bugFindingCalls.push(url.search);
        return options.bugFinding
          ? json(route, bugFindingView(options.bugFinding))
          : json(route, { error: 'not_bug_finding' }, 404);
      }
      if (path === '/api/issues/TPS-645' || path === '/api/issues/i-root') {
        if (method === 'PATCH') {
          stub.writes.push({ method, path, body: req.postDataJSON() });
          return json(route, { ...issue, status: 'done' });
        }
        return json(route, issue);
      }
      if (path === `/api/crew/companies/${COMPANY.id}/access`) {
        return json(route, { userId: ME.id, membershipRole: 'owner', contributor: false, canApprove: true });
      }
      if (path === `/api/crew/companies/${COMPANY.id}/project-access/me`)
        return json(route, { all: true, projectIds: [] });
      // Danh sách phụ của issue (bình luận, đính kèm, run, tài liệu, thẻ hỏi...) và của company: rỗng.
      if (method === 'GET' && /^\/api\/issues\/[^/]+\/[a-z-]+$/.test(path)) return json(route, []);
      if (method === 'GET' && /^\/api\/companies\/[^/]+\/(agents|projects|labels|issues)$/.test(path))
        return json(route, []);
      return json(route, { error: `no mock ${method} ${path}` }, 404);
    },
  );
  return stub;
}

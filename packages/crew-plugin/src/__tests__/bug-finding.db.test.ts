import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Issue, PluginApiRequestInput, PluginContext, PluginEvent } from "@paperclipai/plugin-sdk";
import { pluginManifestV1Schema } from "../../../shared/src/validators/plugin.js";
import { handleBugFindingApi } from "../bug-finding/api.js";
import { enqueueBugFinding, handleIssueUpdated } from "../bug-finding/enqueue.js";
import { runBugFindingWatchdog } from "../bug-finding/watchdog.js";
import manifest from "../manifest.js";
import { type PluginHost, startPluginHost } from "./plugin-host-db.js";

const companyId = "10000000-0000-4000-8000-000000000001";
const projectId = "20000000-0000-4000-8000-000000000001";
const id = (prefix: number, n: number) => `${prefix}0000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const [assistant, reviewer, integrator, outsider] = [1, 2, 3, 4].map((n) => id(4, n));
const [mini, other] = [1, 2].map((n) => id(5, n));
const OWNER = "owner-user";
const HEAD = "b".repeat(40);
const NEXT_HEAD = "c".repeat(40);
const PR = "https://github.com/nquangphan/my-crew/pull/87";
const stages = [
  { id: "s-merge", type: "review", participants: [{ id: "p1", type: "agent", agentId: integrator }] },
  { id: "s-bridge", type: "review", participants: [{ id: "p2", type: "agent", agentId: reviewer }] },
  { id: "s-owner", type: "approval", participants: [{ id: "p3", type: "user", userId: OWNER }] },
  { id: "s-push", type: "review", participants: [{ id: "p4", type: "agent", agentId: integrator }] },
];
const rootBf = { mode: "normal", commentRequired: true, maxReviewRounds: 5, stages };
const atBridge = {
  status: "pending", currentStageId: "s-bridge", currentStageIndex: 1, currentStageType: "review",
  currentParticipant: { type: "agent", agentId: reviewer, userId: null },
  returnAssignee: { type: "agent", agentId: assistant, userId: null }, reviewRequest: null, completedStageIds: ["s-merge"],
  lastDecisionId: null, lastDecisionOutcome: null,
};

let host: PluginHost;
let ctx: PluginContext;
const issues = new Map<string, Issue>();
const comments = new Map<string, { authorAgentId: string | null; body: string; createdAt: Date }[]>();
const interactions = new Map<string, unknown[]>();
type Call = { kind: string; args: unknown[] };
let calls: Call[] = [];
const of = (kind: string) => calls.filter((call) => call.kind === kind).map((call) => call.args);
const issueId = (n: number) => id(3, n);

function addIssue(n: number, fields: Partial<Issue> = {}): string {
  const issue = issueId(n);
  issues.set(issue, {
    id: issue, companyId, projectId, identifier: `TPS-${640 + n}`, status: "in_review", parentId: null,
    assigneeAgentId: reviewer, executionPolicy: rootBf, executionState: atBridge, ...fields,
  } as unknown as Issue);
  comments.set(issue, [{ authorAgentId: integrator, body: `crew-pr sha=${HEAD} pr=${PR}`, createdAt: new Date(Date.now() - 60_000) }]);
  return issue;
}
const updated = (issue: string): PluginEvent => ({
  eventId: `e-${issue}-${calls.length}`, eventType: "issue.updated", occurredAt: new Date().toISOString(), entityId: issue,
  entityType: "issue", companyId, payload: {},
});
const runs = (issue: string) => host.sql.unsafe(
  `SELECT run, state, head_sha, machine_id::text AS machine_id, machine_job_id::text AS machine_job_id, request_id::text AS request_id,
     verdict, findings, report_document_key, error, feedback_text, approval_round
   FROM ${host.ns}.crew_bug_finding_runs WHERE issue_id = $1 ORDER BY run`, [issue]);
const jobs = () => host.sql.unsafe(`SELECT id::text AS id, machine_id::text AS machine_id, kind, payload, status
  FROM ${host.ns}.crew_machine_jobs ORDER BY created_at`);
const api = (routeKey: string, init: Partial<PluginApiRequestInput>) =>
  handleBugFindingApi(ctx, {
    routeKey, method: "POST", path: "/", params: {}, query: {}, body: {}, headers: {}, companyId,
    actor: { actorType: "user", actorId: "board-user", userId: "board-user" }, ...init,
  });
const asAgent = (agentId: string) => ({ actorType: "agent" as const, actorId: agentId, agentId });
const result = (requestId: string, fields: Record<string, unknown> = {}) => api("bug-finding.results", {
  body: { companyId, machineId: mini, requestId, state: "succeeded", headSha: HEAD, verdict: "BLOCK", lanesDone: 6, lanesTotal: 6,
    costUsd: 1.25, findings: [finding("F-01", "OPEN"), finding("F-02", "FIX_VERIFIED")], reportMarkdown: "# Báo cáo\n\nF-01 mở.",
    ...fields },
});
function finding(findingId: string, status: string) {
  return {
    id: findingId, rule: "R-1", title: "Thiếu kiểm quyền", severity: "HIGH", certainty: "Confirmed", status, action: "CODE_FIX",
    mr_relation: "introduced", location: "src/a.ts:10", fix: "Kiểm actor", accept: "403 khi không phải board", question: null,
    extra: "bỏ đi",
  };
}

beforeAll(async () => {
  host = await startPluginHost("crew-bug-finding-");
  const { sql, ns } = host;
  ctx = {
    ...host.ctx,
    issues: {
      get: async (issue: string, company: string) => {
        const found = issues.get(issue);
        return found && found.companyId === company ? structuredClone(found) : null;
      },
      listComments: async (issue: string) => (comments.get(issue) ?? []).map((c, n) => ({ id: `c-${n}`, issueId: issue, ...c })),
      createComment: async (...args: unknown[]) => { calls.push({ kind: "comment", args }); return { id: "c-new" }; },
      requestWakeup: async (...args: unknown[]) => { calls.push({ kind: "wake", args }); return { queued: true, runId: null }; },
      documents: {
        upsert: async (...args: unknown[]) => { calls.push({ kind: "document", args }); return { id: id(9, of("document").length) }; },
      },
      listInteractions: async (issue: string) => interactions.get(issue) ?? [],
    },
  } as unknown as PluginContext;
  await sql`INSERT INTO companies (id,name,issue_prefix) VALUES (${companyId},'Crew','TPS')`;
  await sql`INSERT INTO projects (id,company_id,name) VALUES (${projectId},${companyId},'my-crew')`;
  await sql.unsafe(`INSERT INTO ${ns}.crew_setup_runs (company_id,kind,project_key,project_id,machine_id,input,status,created_by_user_id)
    VALUES ($1,'add-project','my-crew',$2,$3,'{}'::jsonb,'done','owner')`, [companyId, projectId, mini]);
  await sql.unsafe(`INSERT INTO ${ns}.project_repos (company_id,project_id,origin_url,branch,updated_by_user_id)
    VALUES ($1,$2,'git@github.com:nquangphan/my-crew.git','main','owner')`, [companyId, projectId]);
  const report = (capabilities: string[]) => JSON.stringify({ jobsAgent: { version: "0.9.0", lastPollAt: new Date().toISOString(), capabilities } });
  await sql.unsafe(`INSERT INTO ${ns}.machine_latest (company_id,machine_id,hostname,received_at,sent_at,report)
    VALUES ($1,$2,'mac-mini',now(),now(),$3::text::jsonb), ($1,$4,'macbook',now(),now(),$5::text::jsonb)`,
  [companyId, mini, report(["bug-finding-review"]), other, report([])]);
}, 120_000);
afterAll(async () => { await host?.cleanup(); });
beforeEach(async () => {
  for (const table of ["crew_bug_finding_runs", "crew_bug_finding_rounds", "crew_machine_jobs", "project_machines", "issue_machine_pins"]) {
    await host.sql.unsafe(`DELETE FROM ${host.ns}.${table}`);
  }
  await host.sql.unsafe(`INSERT INTO ${host.ns}.project_machines (company_id,project_id,machine_id,repo_path,status,updated_at)
    VALUES ($1,$2,$3,'/Users/o/crew-agents/my-crew/repo','ready',now()), ($1,$2,$4,'/Users/m/crew-agents/my-crew/repo','ready',now() - interval '1 day')`,
  [companyId, projectId, mini, other]);
  issues.clear();
  comments.clear();
  interactions.clear();
  calls = [];
});

describe("khai báo", () => {
  it("route, job hết giờ và capability ghi document, đọc thẻ hỏi (đều có sẵn ở host upstream)", () => {
    const parsed = pluginManifestV1Schema.parse(manifest);
    expect(parsed.apiRoutes).toEqual(expect.arrayContaining([
      expect.objectContaining({ routeKey: "bug-finding.request", method: "POST", path: "/bug-finding/request", auth: "agent" }),
      expect.objectContaining({ routeKey: "bug-finding.results", method: "POST", path: "/bug-finding/results", auth: "board" }),
      expect.objectContaining({ routeKey: "bug-finding.get", method: "GET", path: "/issues/:issueId/bug-finding", auth: "board-or-agent" }),
      expect.objectContaining({ routeKey: "bug-finding.skip", method: "POST", path: "/bug-finding/skip", auth: "agent" }),
    ]));
    expect(parsed.jobs).toContainEqual(expect.objectContaining({ jobKey: "bug-finding-watchdog", schedule: "* * * * *" }));
    expect(parsed.capabilities).toEqual(expect.arrayContaining(["issue.documents.write", "issue.interactions.read"]));
  });
});

describe("xếp lượt khi ticket tổng vào stage cầu nối", () => {
  it("xếp đúng một việc bug-finding-review và một lượt requested; vào lại cùng head thì không xếp thêm", async () => {
    const issue = addIssue(1);
    comments.get(issue)!.push({ authorAgentId: assistant, body: "Trợ Lý: xong lô.\n\n```crew-bf-feedback\nF-04: owner chọn không sửa\n```", createdAt: new Date() });
    await handleIssueUpdated(ctx, updated(issue));
    await handleIssueUpdated(ctx, updated(issue));

    const [run] = await runs(issue);
    expect(await runs(issue)).toHaveLength(1);
    expect(run).toMatchObject({ run: 1, state: "requested", head_sha: HEAD, machine_id: mini, approval_round: 0 });
    const queued = await jobs();
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ id: run!.machine_job_id, machine_id: mini, kind: "bug-finding-review", status: "queued" });
    // Lượt đầu không có lượt trước: không mang phản hồi của Trợ Lý.
    expect(queued[0]!.payload).toEqual({
      kind: "bug-finding-review", requestId: run!.request_id, issueId: issue, identifier: "TPS-641", run: 1, projectId,
      projectKey: "my-crew", repoPath: "/Users/o/crew-agents/my-crew/repo", provider: "github", prNumber: 87, prUrl: PR,
      headSha: HEAD, baseBranch: "main",
    });
  });

  it("crew-pr là URL MR GitLab: payload provider gitlab, prNumber là số MR", async () => {
    const issue = addIssue(30);
    const mr = "https://gitlab.qasoftsolution.com/nail/business-app/-/merge_requests/42";
    comments.set(issue, [{ authorAgentId: integrator, body: `crew-pr sha=${HEAD} pr=${mr}`, createdAt: new Date() }]);
    await handleIssueUpdated(ctx, updated(issue));

    const [run] = await runs(issue);
    expect(run).toMatchObject({ run: 1, state: "requested", head_sha: HEAD, machine_id: mini, error: null });
    const [job] = await jobs();
    expect(job).toMatchObject({ id: run!.machine_job_id, kind: "bug-finding-review", status: "queued" });
    expect(job!.payload).toMatchObject({ provider: "gitlab", prNumber: 42, prUrl: mr, headSha: HEAD });
  });

  it("không xếp khi issue không ở stage cầu nối, không phải root-bf hay chưa có crew-pr", async () => {
    const merge = addIssue(2, { executionState: { ...atBridge, currentStageId: "s-merge", currentStageIndex: 0 } as never });
    const code = addIssue(3, { executionPolicy: { ...rootBf, stages: [stages[1], stages[0], stages[2], stages[0]] } as never });
    const noPr = addIssue(4);
    comments.set(noPr, []);
    for (const issue of [merge, code, noPr]) await handleIssueUpdated(ctx, updated(issue));
    expect(await jobs()).toHaveLength(0);
  });

  it("máy ghim chưa có app hỗ trợ: không xếp việc, lượt failed với lý do", async () => {
    const issue = addIssue(5);
    await host.sql.unsafe(`INSERT INTO ${host.ns}.issue_machine_pins (company_id,root_issue_id,machine_id,source) VALUES ($1,$2,$3,'owner')`,
      [companyId, issue, other]);
    await handleIssueUpdated(ctx, updated(issue));
    expect(await jobs()).toHaveLength(0);
    expect(await runs(issue)).toMatchObject([{ run: 1, state: "failed", machine_id: other, error: "Mac chưa cập nhật 2P Crew có Bug Finding" }]);
  });

  it("vòng đã có 3 lượt: không xếp lượt thứ tư", async () => {
    const issue = addIssue(6);
    for (const [run, head] of [[1, "1"], [2, "2"], [3, "3"]] as const) {
      await host.sql.unsafe(`INSERT INTO ${host.ns}.crew_bug_finding_runs (company_id,issue_id,approval_round,run,request_id,head_sha,pr_url,state)
        VALUES ($1,$2,0,$3,gen_random_uuid(),$4,$5,'succeeded')`, [companyId, issue, run, head.repeat(40), PR]);
    }
    expect(await enqueueBugFinding(ctx, issues.get(issue)!)).toMatchObject({ run: null, reason: "runs_exhausted" });
    expect(await runs(issue)).toHaveLength(3);
    expect(await jobs()).toHaveLength(0);
  });

  it("owner yêu cầu sửa (bảng crew_bug_finding_rounds do server ghi) → vòng mới, đếm lượt lại từ 1", async () => {
    const issue = addIssue(18);
    for (const [run, head] of [[1, "1"], [2, "2"], [3, "3"]] as const) {
      await host.sql.unsafe(`INSERT INTO ${host.ns}.crew_bug_finding_runs (company_id,issue_id,approval_round,run,request_id,head_sha,pr_url,state)
        VALUES ($1,$2,0,$3,gen_random_uuid(),$4,$5,'succeeded')`, [companyId, issue, run, head.repeat(40), PR]);
    }
    await host.sql.unsafe(`INSERT INTO ${host.ns}.crew_bug_finding_rounds (company_id,issue_id,round) VALUES ($1,$2,1)`, [companyId, issue]);
    expect(await enqueueBugFinding(ctx, issues.get(issue)!)).toMatchObject({ run: { run: 1, approvalRound: 1, headSha: HEAD } });
    const response = await api("bug-finding.get", { method: "GET", params: { issueId: issue }, actor: asAgent(reviewer) });
    expect(response).toMatchObject({ status: 200, body: { approvalRound: 1, batchesUsed: 0 } });
  });

  it("lượt chạy lại sau lô sửa mang khối crew-bf-feedback mới nhất của Trợ Lý", async () => {
    const issue = addIssue(7);
    await host.sql.unsafe(`INSERT INTO ${host.ns}.crew_bug_finding_runs (company_id,issue_id,approval_round,run,request_id,head_sha,pr_url,state,created_at)
      VALUES ($1,$2,0,1,gen_random_uuid(),$3,$4,'succeeded',now() - interval '1 hour')`, [companyId, issue, HEAD, PR]);
    comments.get(issue)!.push(
      { authorAgentId: assistant, body: "```crew-bf-feedback\nF-09: cũ\n```", createdAt: new Date(Date.now() - 2 * 3_600_000) },
      { authorAgentId: outsider, body: "```crew-bf-feedback\nF-01: giả\n```", createdAt: new Date() },
      { authorAgentId: assistant, body: "Trợ Lý: xong lô bf-fix-1.\n\n```crew-bf-feedback\nF-04: owner chọn không sửa\nF-05: LOW, có sẵn từ trước\n```", createdAt: new Date() },
      { authorAgentId: integrator, body: `crew-pr sha=${NEXT_HEAD} pr=${PR}`, createdAt: new Date() },
    );
    expect(await enqueueBugFinding(ctx, issues.get(issue)!)).toMatchObject({ run: { run: 2, headSha: NEXT_HEAD, state: "requested" } });
    const [, second] = await runs(issue);
    expect(second!.feedback_text).toBe("F-04: owner chọn không sửa\nF-05: LOW, có sẵn từ trước");
    expect((await jobs())[0]!.payload).toMatchObject({ run: 2, headSha: NEXT_HEAD, reviewerInputText: second!.feedback_text });
  });
});

describe("route", () => {
  it("request: chỉ reviewer của stage cầu nối, idempotent theo issue + vòng + head", async () => {
    const issue = addIssue(8);
    expect(await api("bug-finding.request", { actor: asAgent(outsider), body: { issueId: issue } })).toMatchObject({ status: 403 });
    const first = await api("bug-finding.request", { actor: asAgent(reviewer), body: { issueId: issue } });
    const again = await api("bug-finding.request", { actor: asAgent(reviewer), body: { issueId: issue } });
    expect(first).toMatchObject({ status: 201, body: { run: { run: 1, state: "requested", headSha: HEAD } } });
    expect(again).toMatchObject({ status: 200, body: { run: { requestId: (first.body as { run: { requestId: string } }).run.requestId } } });
    expect(await jobs()).toHaveLength(1);
    expect(await api("bug-finding.request", { actor: asAgent(reviewer), body: { issueId: id(3, 99) } })).toMatchObject({ status: 404 });
  });

  it("results: máy khác máy được giao 403, head khác 422 head_mismatch, request_id lạ 404", async () => {
    const issue = addIssue(9);
    await handleIssueUpdated(ctx, updated(issue));
    const [run] = await runs(issue);
    expect(await result(run!.request_id, { machineId: other })).toMatchObject({ status: 403 });
    expect(await result(run!.request_id, { headSha: NEXT_HEAD })).toMatchObject({ status: 422, body: { error: "head_mismatch" } });
    expect(await result(id(7, 99))).toMatchObject({ status: 404 });
    expect((await runs(issue))[0]).toMatchObject({ state: "requested" });
    expect(of("wake")).toHaveLength(0);
  });

  it("results: tiến độ running rồi succeeded hợp lệ → lưu, ghi báo cáo .md thành document của issue, comment hệ thống và đánh thức reviewer", async () => {
    const issue = addIssue(10);
    await handleIssueUpdated(ctx, updated(issue));
    const [run] = await runs(issue);
    expect(await result(run!.request_id, { state: "running", verdict: undefined, findings: undefined, reportMarkdown: undefined, lanesDone: 2 }))
      .toMatchObject({ status: 200, body: { run: { state: "running", lanesDone: 2, lanesTotal: 6 } } });
    expect(of("wake")).toHaveLength(0);

    expect(await result(run!.request_id)).toMatchObject({ status: 200, body: { run: { state: "succeeded", verdict: "BLOCK" } } });
    const [saved] = await runs(issue);
    expect(saved).toMatchObject({ state: "succeeded", verdict: "BLOCK", report_document_key: "bug-finding-round-0-run-1" });
    expect(saved!.findings).toHaveLength(2);
    expect(Object.keys((saved!.findings as Record<string, unknown>[])[0]!).sort()).toEqual(
      ["accept", "action", "certainty", "fix", "id", "location", "mr_relation", "question", "rule", "severity", "status", "title"]);
    expect(of("document")).toEqual([[{
      issueId: issue, companyId, key: "bug-finding-round-0-run-1", title: "Bug Finding TPS-650 lượt 1 (BLOCK)", format: "markdown",
      body: "# Báo cáo\n\nF-01 mở.", changeSummary: `Bug Finding lượt 1, head ${HEAD.slice(0, 12)}`,
    }]]);
    expect((of("comment")[0] as [string, string])[1].split("\n", 1)[0])
      .toBe(`crew-bugfinding run=1 sha=${HEAD} verdict=BLOCK open=1 state=succeeded`);
    expect(of("wake")).toEqual([[issue, companyId, expect.objectContaining({ reason: "crew_bug_finding_result" })]]);
    // Kết quả cuối đã lưu: gửi lại không ghi đè.
    expect(await result(run!.request_id)).toMatchObject({ status: 409 });
  });

  it("GET: mọi lượt kèm kế hoạch của Trợ Lý, số lô sửa trong vòng, tối đa 2 lô, head hiện tại", async () => {
    const issue = addIssue(11);
    for (const [run, head, state] of [[1, HEAD, "succeeded"], [2, NEXT_HEAD, "failed"], [3, NEXT_HEAD, "requested"]] as const) {
      await host.sql.unsafe(`INSERT INTO ${host.ns}.crew_bug_finding_runs (company_id,issue_id,approval_round,run,request_id,head_sha,pr_url,state,created_at)
        VALUES ($1,$2,0,$3,gen_random_uuid(),$4,$5,$6,now() - make_interval(mins => 10 - $3))`, [companyId, issue, run, head, PR, state]);
    }
    // Kế hoạch của Trợ Lý (returnAssignee) cho lượt 1, viết sau lượt 1 và trước lượt 2; bản của agent khác bị bỏ qua.
    const triage = "crew-bf-triage run=1 batch=bf-fix-1 fix=F-01 ask=F-02 dismiss=-";
    comments.get(issue)!.push(
      { authorAgentId: assistant, body: triage, createdAt: new Date(Date.now() - 8.5 * 60_000) },
      { authorAgentId: outsider, body: "crew-bf-triage run=1 batch=bf-fix-9 fix=F-09 ask=- dismiss=-", createdAt: new Date(Date.now() - 8.2 * 60_000) },
    );
    const response = await api("bug-finding.get", { method: "GET", params: { issueId: issue }, actor: asAgent(reviewer) });
    expect(response).toMatchObject({ status: 200, body: { batchesUsed: 1, maxBatches: 2, currentHead: HEAD, approvalRound: 0 } });
    const body = response.body as { runs: { run: number; triage: unknown }[] };
    expect(body.runs.map((r) => r.run)).toEqual([3, 2, 1]);
    expect(body.runs.map((r) => r.triage)).toEqual([null, null, expect.objectContaining({ batch: 1, fix: ["F-01"], ask: ["F-02"], fixIssues: {} })]);
    expect(await api("bug-finding.get", { method: "GET", params: { issueId: id(3, 98) } })).toMatchObject({ status: 404 });
  });

  it("skip: chỉ khi owner đã chấp nhận thẻ xác nhận, đổi lượt hỏng của head hiện tại thành skipped", async () => {
    const issue = addIssue(12);
    await host.sql.unsafe(`INSERT INTO ${host.ns}.crew_bug_finding_runs (company_id,issue_id,approval_round,run,request_id,head_sha,pr_url,state,error,finished_at)
      VALUES ($1,$2,0,1,gen_random_uuid(),$3,$4,'timeout','hết giờ',now() - interval '5 minutes'),
             ($1,$2,0,2,gen_random_uuid(),$3,$4,'failed','lỗi',now() - interval '2 minutes')`, [companyId, issue, HEAD, PR]);
    const card = (status: string, resolvedByUserId: string | null) => ({
      id: "i-1", issueId: issue, kind: "request_confirmation", idempotencyKey: `crew-bf-skip:${issue}:0`, status,
      resolvedByUserId, resolvedAt: new Date().toISOString(),
    });
    interactions.set(issue, [card("pending", null)]);
    expect(await api("bug-finding.skip", { actor: asAgent(reviewer), body: { issueId: issue } })).toMatchObject({ status: 409 });
    interactions.set(issue, [card("accepted", "stranger")]);
    expect(await api("bug-finding.skip", { actor: asAgent(reviewer), body: { issueId: issue } })).toMatchObject({ status: 409 });
    interactions.set(issue, [card("accepted", OWNER)]);
    expect(await api("bug-finding.skip", { actor: asAgent(outsider), body: { issueId: issue } })).toMatchObject({ status: 403 });
    expect(await api("bug-finding.skip", { actor: asAgent(reviewer), body: { issueId: issue } }))
      .toMatchObject({ status: 200, body: { run: { run: 2, state: "skipped" } } });
    expect((await runs(issue)).map((r) => r.state)).toEqual(["timeout", "skipped"]);
  });
});

describe("hết giờ", () => {
  it("requested 31 phút không máy nhận và running 8 giờ 1 phút → timeout, hủy việc chờ, đánh thức reviewer", async () => {
    const waiting = addIssue(13);
    const running = addIssue(14);
    const fresh = addIssue(15);
    for (const issue of [waiting, running, fresh]) await handleIssueUpdated(ctx, updated(issue));
    const [w] = await runs(waiting);
    const [r] = await runs(running);
    await host.sql.unsafe(`UPDATE ${host.ns}.crew_bug_finding_runs SET created_at = now() - interval '31 minutes' WHERE request_id = $1`, [w!.request_id]);
    await host.sql.unsafe(`UPDATE ${host.ns}.crew_machine_jobs SET status = 'done', result = '{"kind":"bug-finding-review","accepted":true}'::jsonb
      WHERE id = $1`, [r!.machine_job_id]);
    await host.sql.unsafe(`UPDATE ${host.ns}.crew_bug_finding_runs SET state = 'running', started_at = now() - interval '8 hours',
      created_at = now() - interval '8 hours 1 minute' WHERE request_id = $1`, [r!.request_id]);

    expect(await runBugFindingWatchdog(ctx, new Date())).toMatchObject({ timedOut: 2 });
    expect((await runs(waiting))[0]).toMatchObject({ state: "timeout" });
    expect((await runs(running))[0]).toMatchObject({ state: "timeout" });
    expect((await runs(fresh))[0]).toMatchObject({ state: "requested" });
    const byId = new Map((await jobs()).map((job) => [job.id, job.status]));
    expect(byId.get(w!.machine_job_id)).toBe("cancelled");
    expect(of("wake").map(([issue, , options]) => [issue, (options as { reason: string }).reason]).sort())
      .toEqual([[running, "crew_bug_finding_result"], [waiting, "crew_bug_finding_result"]].sort());
    expect(of("comment").map(([, body]) => (body as string).split("\n", 1)[0]))
      .toEqual(expect.arrayContaining([`crew-bugfinding run=1 sha=${HEAD} verdict=none open=0 state=timeout`]));
    // Chạy lại không đánh thức lần nữa.
    expect(await runBugFindingWatchdog(ctx, new Date())).toMatchObject({ timedOut: 0 });
  });

  it("việc máy hỏng (app báo bug_finding_missing) → lượt failed, đánh thức reviewer; việc nhận xong → queued", async () => {
    const broken = addIssue(16);
    const accepted = addIssue(17);
    for (const issue of [broken, accepted]) await handleIssueUpdated(ctx, updated(issue));
    const [b] = await runs(broken);
    const [a] = await runs(accepted);
    await host.sql.unsafe(`UPDATE ${host.ns}.crew_machine_jobs SET status = 'failed', error_code = 'bug_finding_missing',
      error_text = 'Không thấy Bug Finding.app' WHERE id = $1`, [b!.machine_job_id]);
    await host.sql.unsafe(`UPDATE ${host.ns}.crew_machine_jobs SET status = 'done' WHERE id = $1`, [a!.machine_job_id]);
    await runBugFindingWatchdog(ctx, new Date());
    expect((await runs(broken))[0]).toMatchObject({ state: "failed", error: "bug_finding_missing: Không thấy Bug Finding.app" });
    expect((await runs(accepted))[0]).toMatchObject({ state: "queued" });
    expect(of("wake").map(([issue]) => issue)).toEqual([broken]);
  });
});

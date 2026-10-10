import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Issue, PluginContext, PluginEvent } from "@paperclipai/plugin-sdk";
import { pluginManifestV1Schema } from "../../../shared/src/validators/plugin.js";
import manifest from "../manifest.js";
import { upsertProjectRoles } from "../roles/data.js";
import { applyFallback, handleRunFailed, registerRuntimeFallback, runRuntimeFallbackJob } from "../runtimes/fallback.js";
import { type PluginHost, startPluginHost } from "./plugin-host-db.js";

const companyId = "10000000-0000-4000-8000-000000000001";
const projectId = "20000000-0000-4000-8000-000000000001";
const looseProject = "20000000-0000-4000-8000-000000000002";
const mini = "50000000-0000-4000-8000-000000000001";
const env = "80000000-0000-4000-8000-000000000001";
const id = (prefix: number, n: number) => `${prefix}0000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const [assistant, executor, codexExec, opencodeExec, reviewer, codexReviewer, integrator, outsider] = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => id(4, n));
const issueId = (n: number) => id(3, n);
const runId = (n: number) => id(6, n);

let host: PluginHost;
let ctx: PluginContext;
const issues = new Map<string, Issue>();
const attachments = new Map<string, { contentType: string }[]>();
type Call = { kind: string; args: unknown[] };
let calls: Call[] = [];
let failUpdate: Error | null = null;
const of = (kind: string) => calls.filter((call) => call.kind === kind).map((call) => call.args);

const reviewStage = (...ids: string[]) => ({ id: "s-review", type: "review", participants: ids.map((a) => ({ id: `p-${a}`, type: "agent", agentId: a })) });
const childPolicy = (...ids: string[]) => ({ mode: "normal", maxReviewRounds: 5, stages: [reviewStage(...ids)] });
const marker = (complexity: string, runtime: string, model: string, effort: string) =>
  `Việc\n\ncrew-model complexity=${complexity} model=${model} effort=${effort} runtime=${runtime} reason=thử\n`;
const MEDIUM_CODEX = marker("medium", "codex_local", "gpt-6-sol", "high");
const pendingState = (participant: string) => ({
  status: "pending", currentStageId: "s-review", currentStageIndex: 0, currentStageType: "review",
  currentParticipant: { type: "agent", agentId: participant, userId: null },
  returnAssignee: { type: "agent", agentId: executor, userId: null }, reviewRequest: null, completedStageIds: [],
  lastDecisionId: null, lastDecisionOutcome: null, changesRequestedCount: 1,
});

function addIssue(n: number, fields: Partial<Issue>): string {
  const issue = issueId(n);
  issues.set(issue, { id: issue, companyId, projectId, status: "in_progress", description: MEDIUM_CODEX, assigneeAgentId: codexExec,
    executionPolicy: childPolicy(reviewer), executionState: null, ...fields } as Issue);
  return issue;
}
async function addRun(n: number, agentId: string, status = "failed", errorFamily: string | null = null): Promise<string> {
  const run = runId(n);
  await host.sql`INSERT INTO heartbeat_runs (id,company_id,agent_id,status,result_json)
    VALUES (${run},${companyId},${agentId},${status},${errorFamily ? host.sql.json({ errorFamily }) : null})`;
  return run;
}
const failed = (run: string, agentId: string, issue: string, errorCode: string | null, error: string | null = null): PluginEvent => ({
  eventId: `e-${run}`, eventType: "agent.run.failed", occurredAt: new Date().toISOString(), entityId: run, entityType: "heartbeat_run",
  companyId, payload: { runId: run, agentId, status: "failed", error, errorCode, issueId: issue },
});
const decisions = (issue: string) => host.sql.unsafe(
  `SELECT role, kind, run_id::text AS run_id, from_agent_id::text AS from_agent_id, to_agent_id::text AS to_agent_id, from_runtime,
     to_runtime, model, complexity, trigger, reason, machine_id::text AS machine_id
   FROM ${host.ns}.crew_runtime_decisions WHERE issue_id = $1 ORDER BY id`, [issue]);
async function setSwitch(runtime: string, enabled: boolean): Promise<void> {
  await host.sql.unsafe(`INSERT INTO ${host.ns}.crew_runtime_switches (company_id,machine_id,runtime,enabled,updated_by_user_id)
    VALUES ($1,$2,$3,$4,'owner') ON CONFLICT (company_id,machine_id,runtime) DO UPDATE SET enabled = EXCLUDED.enabled`,
  [companyId, mini, runtime, enabled]);
}
async function addWait(run: string, issue: string, agentId: string, runtime: string, secondsAgo: number): Promise<void> {
  await host.sql.unsafe(`INSERT INTO ${host.ns}.crew_runtime_waits (run_id,company_id,issue_id,agent_id,machine_id,runtime,first_seen_at)
    VALUES ($1,$2,$3,$4,$5,$6,now() - make_interval(secs => $7))`, [run, companyId, issue, agentId, mini, runtime, secondsAgo]);
}
const handledAt = async (run: string) =>
  (await host.sql.unsafe(`SELECT handled_at FROM ${host.ns}.crew_runtime_waits WHERE run_id = $1`, [run]))[0]?.handled_at ?? null;

beforeAll(async () => {
  host = await startPluginHost("crew-runtime-fallback-");
  const { sql, ns } = host;
  ctx = {
    ...host.ctx,
    config: { get: async () => ({ companies: [{ companyId }], opencodeInPlacePatch: true }) },
    companies: { list: async () => { throw new Error("job không được liệt kê mọi company"); } },
    issues: {
      get: async (issue: string, company: string) => {
        calls.push({ kind: "get", args: [issue, company] });
        const found = issues.get(issue);
        return found && found.companyId === company ? structuredClone(found) : null;
      },
      update: async (...args: unknown[]) => {
        calls.push({ kind: "update", args });
        if (failUpdate) throw failUpdate;
        const [issue, patch] = args as [string, Record<string, unknown>];
        issues.set(issue, { ...issues.get(issue)!, ...patch } as Issue);
        return issues.get(issue);
      },
      createComment: async (...args: unknown[]) => { calls.push({ kind: "comment", args }); return {}; },
      requestWakeup: async (...args: unknown[]) => { calls.push({ kind: "wake", args }); return { queued: true, runId: null }; },
      listAttachments: async (issue: string) => attachments.get(issue) ?? [],
    },
  } as unknown as PluginContext;
  await sql`INSERT INTO companies (id,name,issue_prefix) VALUES (${companyId},'Crew','CRE')`;
  await sql`INSERT INTO projects (id,company_id,name) VALUES (${projectId},${companyId},'Repo A'),(${looseProject},${companyId},'Không Crew')`;
  await sql`INSERT INTO environments (id,name,driver,config) VALUES (${env},'repo-a','ssh',${sql.json({ remoteWorkspacePath: "/Users/o/crew-agents/repo-a/x" })})`;
  for (const [agentId, name, adapter] of [[assistant, "Trợ Lý", "claude_local"], [executor, "repo-a-executor", "claude_local"],
    [codexExec, "repo-a-codex", "codex_local"], [opencodeExec, "repo-a-opencode", "opencode_local"], [reviewer, "Reviewer", "claude_local"],
    [codexReviewer, "Reviewer Codex", "codex_local"], [integrator, "Integrator", "claude_local"], [outsider, "Ngoài", "codex_local"]] as const) {
    await sql`INSERT INTO agents (id,company_id,name,adapter_type,default_environment_id) VALUES (${agentId},${companyId},${name},${adapter},${env})`;
  }
  await upsertProjectRoles(host.ctx, companyId, projectId, {
    assistantAgentId: assistant, executorAgentIds: [executor], reviewerAgentId: reviewer, integratorAgentId: integrator,
    codexExecutorAgentId: codexExec, opencodeExecutorAgentId: opencodeExec, codexReviewerAgentId: codexReviewer,
  }, "owner");
  await sql.unsafe(`INSERT INTO ${ns}.crew_companies (company_id, name) VALUES ($1, 'Crew')`, [companyId]);
  // Một máy: mọi agent có environment chạy trên máy này.
  await sql.unsafe(`INSERT INTO ${ns}.machine_latest (company_id,machine_id,hostname,received_at,sent_at,report)
    VALUES ($1,$2,'mac-mini',now(),now(),'{}'::jsonb)`, [companyId, mini]);
}, 120_000);
afterAll(async () => { await host?.cleanup(); });
beforeEach(async () => {
  for (const table of ["crew_runtime_decisions", "crew_runtime_switches", "crew_runtime_waits"]) await host.sql.unsafe(`DELETE FROM ${host.ns}.${table}`);
  await host.sql`DELETE FROM heartbeat_runs`;
  await setSwitch("codex_local", true);
  issues.clear();
  attachments.clear();
  calls = [];
  failUpdate = null;
  host.logs.length = 0;
});

describe("khai báo", () => {
  it("job runtime-fallback mỗi phút, không thêm capability; đăng ký sự kiện agent.run.failed và job", () => {
    const parsed = pluginManifestV1Schema.parse(manifest);
    expect(parsed.jobs).toContainEqual({ jobKey: "runtime-fallback", displayName: "Chuyển runtime",
      description: "Chuyển run đang chờ vì runtime tắt sang runtime khác cùng máy", schedule: "* * * * *" });
    expect(parsed.capabilities).toHaveLength(28);
    const events: string[] = [];
    const jobs: string[] = [];
    registerRuntimeFallback({ ...ctx, events: { on: (name: string) => { events.push(name); } }, jobs: { register: (key: string) => { jobs.push(key); } } } as unknown as PluginContext);
    expect(events).toEqual(["agent.run.failed"]);
    expect(jobs).toEqual(["runtime-fallback"]);
  });
});

describe("executor", () => {
  it("hết quota (errorFamily đọc từ heartbeat_runs): ghi một quyết định, đổi assignee + override, comment, đánh thức một lần; gửi lại thì không làm gì", async () => {
    const issue = addIssue(1, {});
    const run = await addRun(1, codexExec, "failed", "provider_quota");
    expect(await handleRunFailed(ctx, failed(run, codexExec, issue, null))).toBe("applied");
    expect(await decisions(issue)).toEqual([{ role: "executor", kind: "fallback", run_id: run, from_agent_id: codexExec, to_agent_id: executor,
      from_runtime: "codex_local", to_runtime: "claude_local", model: "claude-sonnet-5", complexity: "medium", trigger: "quota",
      reason: "hết quota", machine_id: mini }]);
    expect(of("update")).toEqual([[issue, { assigneeAgentId: executor, assigneeAdapterOverrides: { adapterConfig: { model: "claude-sonnet-5", effort: "high" } } }, companyId]]);
    expect(of("comment")).toEqual([[issue, "Crew: chuyển từ codex_local (repo-a-codex) sang claude_local (repo-a-executor), model claude-sonnet-5. "
      + "Lý do: hết quota. Nhánh và commit của run trước được giữ.", companyId]]);
    expect(of("wake")).toEqual([[issue, companyId, { reason: "crew_runtime_fallback", idempotencyKey: `crew_runtime_fallback:${run}` }]]);
    calls = [];
    issues.set(issue, { ...issues.get(issue)!, assigneeAgentId: codexExec } as Issue);
    expect(await handleRunFailed(ctx, failed(run, codexExec, issue, null))).toBe("duplicate");
    expect(of("update")).toEqual([]);
    expect(of("comment")).toEqual([]);
    expect(of("wake")).toEqual([]);
    expect(await decisions(issue)).toHaveLength(1);
  });

  it("đích OpenCode chỉ có model; đích Codex dùng modelReasoningEffort", async () => {
    const small = addIssue(2, { description: marker("small", "claude_local", "claude-sonnet-5", "medium"), assigneeAgentId: executor });
    await setSwitch("opencode_local", true);
    expect(await applyFallback(ctx, { companyId, issueId: small, runId: await addRun(2, executor), agentId: executor, trigger: "auth" })).toBe("applied");
    expect(of("update").at(-1)?.[1]).toEqual({ assigneeAgentId: opencodeExec, assigneeAdapterOverrides: { adapterConfig: { model: "opencode-go/kimi-k3" } } });
    const medium = addIssue(3, { description: marker("medium", "claude_local", "claude-sonnet-5", "high"), assigneeAgentId: executor });
    expect(await applyFallback(ctx, { companyId, issueId: medium, runId: await addRun(3, executor), agentId: executor, trigger: "unavailable" })).toBe("applied");
    expect(of("update").at(-1)?.[1]).toEqual({ assigneeAgentId: codexExec, assigneeAdapterOverrides: { adapterConfig: { model: "gpt-6-sol", modelReasoningEffort: "high" } } });
  });

  it("lỗi khác (timeout, crew-workflow blocked) và agent ngoài ba runtime: không làm gì", async () => {
    const issue = addIssue(4, {});
    expect(await handleRunFailed(ctx, failed(await addRun(4, codexExec), codexExec, issue, "timeout"))).toBe("skipped");
    expect(await handleRunFailed(ctx, failed(await addRun(5, codexExec), codexExec, issue, "process_exit", "crew-workflow blocked: x"))).toBe("skipped");
    await host.sql`UPDATE agents SET adapter_type = 'process' WHERE id = ${outsider}`;
    expect(await handleRunFailed(ctx, failed(await addRun(6, outsider, "failed", "provider_quota"), outsider, issue, null))).toBeNull();
    await host.sql`UPDATE agents SET adapter_type = 'codex_local' WHERE id = ${outsider}`;
    expect(calls.filter((call) => call.kind !== "get")).toEqual([]);
    expect(await decisions(issue)).toEqual([]);
  });

  it("dừng khi issue không thuộc project Crew, không có policy Crew, đã xong, đã giao agent khác, agent không phải executor", async () => {
    const cases = [
      addIssue(5, { projectId: looseProject }),
      addIssue(6, { executionPolicy: null }),
      addIssue(7, { status: "done" }),
      addIssue(8, { assigneeAgentId: executor }),
    ];
    for (const [i, issue] of cases.entries()) {
      expect(await applyFallback(ctx, { companyId, issueId: issue, runId: await addRun(10 + i, codexExec), agentId: codexExec, trigger: "quota" })).toBe("skipped");
    }
    const foreign = addIssue(9, { assigneeAgentId: outsider });
    expect(await applyFallback(ctx, { companyId, issueId: foreign, runId: await addRun(20, outsider), agentId: outsider, trigger: "quota" })).toBe("skipped");
    expect(calls.filter((call) => call.kind !== "get")).toEqual([]);
  });

  it("large: từ chối, comment, không block (chờ Claude); gửi lại không comment thêm", async () => {
    const issue = addIssue(10, { description: marker("large", "claude_local", "claude-opus-5", "high"), assigneeAgentId: executor });
    const run = await addRun(30, executor);
    expect(await handleRunFailed(ctx, failed(run, executor, issue, "claude_auth_required"))).toBe("refused");
    expect(await decisions(issue)).toEqual([expect.objectContaining({ kind: "fallback_refused", trigger: "auth", reason: "mức large chỉ chạy Claude", to_agent_id: null })]);
    expect(of("comment")).toEqual([[issue, `Crew: không chuyển runtime cho run \`${run}\`: mức large chỉ chạy Claude. Crew chờ Claude chạy lại.`, companyId]]);
    expect(of("update")).toEqual([]);
    expect(await handleRunFailed(ctx, failed(run, executor, issue, "claude_auth_required"))).toBe("duplicate");
    expect(of("comment")).toHaveLength(1);
  });

  it("đã chuyển 2 lần: từ chối và block; runtime đã thử bị bỏ khi đếm", async () => {
    const issue = addIssue(11, {});
    for (const [n, from, to] of [[40, "opencode_local", "claude_local"], [41, "claude_local", "codex_local"]] as const) {
      await host.sql.unsafe(`INSERT INTO ${host.ns}.crew_runtime_decisions (company_id,issue_id,role,kind,run_id,from_runtime,to_runtime,reason)
        VALUES ($1,$2,'executor','fallback',$3,$4,$5,'cũ')`, [companyId, issue, runId(n), from, to]);
    }
    const run = await addRun(42, codexExec);
    expect(await applyFallback(ctx, { companyId, issueId: issue, runId: run, agentId: codexExec, trigger: "quota" })).toBe("refused");
    expect(of("comment")).toEqual([[issue, `Crew: không chuyển runtime cho run \`${run}\`: đã chuyển 2 lần.`, companyId]]);
    expect(of("update")).toEqual([[issue, { status: "blocked" }, companyId]]);
  });

  it("issue có ảnh và không còn model đọc ảnh: từ chối", async () => {
    const issue = addIssue(12, { description: marker("small", "claude_local", "claude-sonnet-5", "medium"), assigneeAgentId: executor });
    attachments.set(issue, [{ contentType: "image/png" }]);
    await setSwitch("opencode_local", true);
    await setSwitch("codex_local", false);
    const run = await addRun(43, executor);
    expect(await applyFallback(ctx, { companyId, issueId: issue, runId: run, agentId: executor, trigger: "quota" })).toBe("refused");
    expect(await decisions(issue)).toEqual([expect.objectContaining({ reason: "issue có ảnh, không còn model đọc được ảnh" })]);
  });

  it("H2 từ chối lệnh đổi assignee: quyết định thành fallback_refused, comment từ chối, block", async () => {
    const issue = addIssue(13, {});
    const run = await addRun(44, codexExec);
    failUpdate = new Error("Crew: override sai");
    expect(await applyFallback(ctx, { companyId, issueId: issue, runId: run, agentId: codexExec, trigger: "quota" })).toBe("refused");
    expect(await decisions(issue)).toEqual([expect.objectContaining({ kind: "fallback_refused", reason: "Crew không đổi được assignee (Crew: override sai)" })]);
    expect(of("comment")).toEqual([[issue, `Crew: không chuyển runtime cho run \`${run}\`: Crew không đổi được assignee (Crew: override sai).`, companyId]]);
    expect(of("wake")).toEqual([]);
  });
});

describe("job runtime-fallback (run bị công tắc giữ)", () => {
  it("chỉ xử lý dòng quá 60 giây, run còn queued, công tắc vẫn tắt; đặt handled_at; chạy lại không làm gì", async () => {
    const issue = addIssue(20, { description: marker("small", "opencode_local", "opencode-go/kimi-k3", "default"), assigneeAgentId: opencodeExec, status: "todo" });
    const held = await addRun(50, opencodeExec, "queued");
    await addWait(held, issue, opencodeExec, "opencode_local", 120);
    const fresh = await addRun(51, opencodeExec, "queued");
    await addWait(fresh, issue, opencodeExec, "opencode_local", 10);
    const started = await addRun(52, opencodeExec, "running");
    await addWait(started, issue, opencodeExec, "opencode_local", 120);
    expect(await runRuntimeFallbackJob(ctx, new Date())).toEqual({ handled: 2, applied: 1 });
    expect(await decisions(issue)).toEqual([expect.objectContaining({ kind: "fallback", run_id: held, trigger: "switch_off", to_agent_id: executor,
      to_runtime: "claude_local", model: "claude-sonnet-5", reason: "runtime đang tắt trên máy" })]);
    expect(of("wake")).toHaveLength(1);
    expect(await handledAt(held)).not.toBeNull();
    expect(await handledAt(started)).not.toBeNull();
    expect(await handledAt(fresh)).toBeNull();
    calls = [];
    expect(await runRuntimeFallbackJob(ctx, new Date())).toEqual({ handled: 0, applied: 0 });
    expect(calls).toEqual([]);
  });

  it("công tắc đã bật lại: đặt handled_at, không chuyển", async () => {
    const issue = addIssue(21, { assigneeAgentId: codexExec, status: "todo" });
    const held = await addRun(53, codexExec, "queued");
    await addWait(held, issue, codexExec, "codex_local", 120);
    expect(await runRuntimeFallbackJob(ctx, new Date())).toEqual({ handled: 1, applied: 0 });
    expect(await decisions(issue)).toEqual([]);
    expect(await handledAt(held)).not.toBeNull();
  });

  it("không có đích: một comment chờ có tên máy, fallback_refused có run_id, không block", async () => {
    const issue = addIssue(22, { assigneeAgentId: codexExec, status: "todo" });
    await setSwitch("codex_local", false);
    await setSwitch("claude_local", false);
    const held = await addRun(54, codexExec, "queued");
    await addWait(held, issue, codexExec, "codex_local", 120);
    expect(await runRuntimeFallbackJob(ctx, new Date())).toEqual({ handled: 1, applied: 0 });
    expect(await decisions(issue)).toEqual([expect.objectContaining({ kind: "fallback_refused", run_id: held, trigger: "switch_off" })]);
    expect(of("comment")).toEqual([[issue, `Crew: không chuyển runtime cho run \`${held}\`: không còn runtime nào bật, đã đăng nhập và đủ quota trên máy này. `
      + "Runtime codex_local đang tắt trên máy mac-mini; run chờ tới khi owner bật lại.", companyId]]);
    expect(of("update")).toEqual([]);
    await host.sql.unsafe(`UPDATE ${host.ns}.crew_runtime_waits SET handled_at = NULL`);
    await runRuntimeFallbackJob(ctx, new Date());
    expect(of("comment")).toHaveLength(1);
  });
});

describe("reviewer Codex → reviewer Claude", () => {
  const inReview = (n: number, stage: string[], participant = codexReviewer) => addIssue(n, {
    status: "in_review", assigneeAgentId: participant, description: marker("medium", "claude_local", "claude-sonnet-5", "high"),
    executionPolicy: childPolicy(...stage) as never, executionState: pendingState(participant) as never,
  });

  it("run reviewer Codex lỗi (kể cả lỗi khác): chỉ đổi currentParticipant + assignee, không policy, không actor; comment; đánh thức", async () => {
    const issue = inReview(30, [codexReviewer, reviewer]);
    const run = await addRun(60, codexReviewer);
    expect(await handleRunFailed(ctx, failed(run, codexReviewer, issue, "timeout"))).toBe("applied");
    const update = of("update");
    expect(update).toEqual([[issue, { executionState: { ...pendingState(codexReviewer), currentParticipant: { type: "agent", agentId: reviewer, userId: null } },
      assigneeAgentId: reviewer }, companyId]]);
    expect(update[0]).toHaveLength(3);
    expect(await decisions(issue)).toEqual([{ role: "reviewer", kind: "fallback", run_id: run, from_agent_id: codexReviewer, to_agent_id: reviewer,
      from_runtime: "codex_local", to_runtime: "claude_local", model: null, complexity: null, trigger: "other", reason: "run lỗi", machine_id: mini }]);
    expect(of("comment")).toEqual([[issue, "Crew: chuyển reviewer từ codex_local (Reviewer Codex) sang claude_local (Reviewer). Lý do: run lỗi. Số vòng review giữ nguyên.", companyId]]);
    expect(of("wake")).toEqual([[issue, companyId, { reason: "crew_runtime_reviewer_fallback", idempotencyKey: `crew_runtime_reviewer_fallback:${run}` }]]);
    expect(await handleRunFailed(ctx, failed(run, codexReviewer, issue, "timeout"))).toBe("skipped");
  });

  it("công tắc Codex tắt: job chuyển run reviewer bị giữ sang reviewer Claude", async () => {
    const issue = inReview(31, [codexReviewer, reviewer]);
    await setSwitch("codex_local", false);
    const held = await addRun(61, codexReviewer, "queued");
    await addWait(held, issue, codexReviewer, "codex_local", 120);
    expect(await runRuntimeFallbackJob(ctx, new Date())).toEqual({ handled: 1, applied: 1 });
    expect(await decisions(issue)).toEqual([expect.objectContaining({ role: "reviewer", kind: "fallback", trigger: "switch_off", reason: "runtime đang tắt trên máy" })]);
  });

  it("issue cũ chỉ có reviewer Codex trong stage: fallback_refused, comment; quota thì block, công tắc tắt thì giữ", async () => {
    const issue = inReview(32, [codexReviewer]);
    const run = await addRun(62, codexReviewer, "failed", "provider_quota");
    expect(await handleRunFailed(ctx, failed(run, codexReviewer, issue, null))).toBe("refused");
    expect(await decisions(issue)).toEqual([expect.objectContaining({ role: "reviewer", kind: "fallback_refused", trigger: "quota",
      reason: "hết quota; reviewer Claude không có trong stage review của issue" })]);
    const comment = 'Crew: reviewer Codex không chạy được (hết quota); owner bật lại Codex hoặc dùng "Ép Done"/sửa reviewer trên web.';
    expect(of("comment")).toEqual([[issue, comment, companyId]]);
    expect(of("update")).toEqual([[issue, { status: "blocked" }, companyId]]);

    calls = [];
    const held = inReview(33, [codexReviewer]);
    expect(await applyFallback(ctx, { companyId, issueId: held, runId: await addRun(63, codexReviewer, "queued"), agentId: codexReviewer, trigger: "switch_off" })).toBe("refused");
    expect(of("update")).toEqual([]);
  });

  it("H2 từ chối: quyết định thành fallback_refused; lượt review không còn chờ Codex thì dừng", async () => {
    const issue = inReview(34, [codexReviewer, reviewer]);
    failUpdate = new Error("crew_policy_locked");
    const run = await addRun(64, codexReviewer);
    expect(await applyFallback(ctx, { companyId, issueId: issue, runId: run, agentId: codexReviewer, trigger: "auth" })).toBe("refused");
    expect(await decisions(issue)).toEqual([expect.objectContaining({ kind: "fallback_refused",
      reason: "chưa đăng nhập hoặc thiếu key; Crew không đổi được reviewer (crew_policy_locked)" })]);
    failUpdate = null;
    const moved = inReview(35, [codexReviewer, reviewer]);
    issues.set(moved, { ...issues.get(moved)!, status: "in_progress" } as Issue);
    expect(await applyFallback(ctx, { companyId, issueId: moved, runId: await addRun(65, codexReviewer), agentId: codexReviewer, trigger: "quota" })).toBe("skipped");
  });
});

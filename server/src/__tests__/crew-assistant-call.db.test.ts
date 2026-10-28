import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { and, asc, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  activityLog,
  agents,
  agentWakeupRequests,
  authUsers,
  companies,
  companyMemberships,
  createDb,
  heartbeatRuns,
  issueComments,
  issues,
  projects,
} from "@paperclipai/db";
import { CREW_POLICY_CONFIG_ENV } from "../crew/issue-policy.js";
import { applyCrewMachineTables } from "./helpers/crew-machine-tables.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

// Owner gọi Trợ Lý bằng tag: route Crew đánh thức Trợ Lý qua `heartbeat.wakeup` thật (admission, hàng đợi, drain).
// Adapter được mock để không run nào chạy CLI hay SSH thật; mock ghi lại context của từng run.
const execute = vi.hoisted(() => vi.fn());
vi.mock("../adapters/index.js", async () => {
  const actual = await vi.importActual<typeof import("../adapters/index.js")>("../adapters/index.js");
  return { ...actual, getServerAdapter: vi.fn(() => ({ supportsLocalAgentJwt: false, execute })) };
});

const { errorHandler } = await import("../middleware/index.js");
const { crewContributionRoutes } = await import("../crew/contribution-routes.js");
const { heartbeatService } = await import("../services/heartbeat.js");
const { normalizeIssueExecutionPolicy } = await import("../services/issue-execution-policy.js");

const support = await getEmbeddedPostgresTestSupport();
const suite = support.supported ? describe.sequential : describe.skip;
if (!support.supported) {
  console.warn(`Bỏ qua test gọi Trợ Lý bằng tag: ${support.reason ?? "môi trường không hỗ trợ"}`);
}

async function waitFor(condition: () => boolean | Promise<boolean>, timeoutMs = 20_000, intervalMs = 50) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("Hết giờ chờ điều kiện");
}

const ok = { exitCode: 0, signal: null, timedOut: false, errorMessage: null, summary: "Xong.", provider: "test", model: "test-model" };
type ExecuteInput = { runId: string; agent: { id: string }; context: Record<string, unknown> };

suite("Crew: owner gọi Trợ Lý bằng tag trong bình luận", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let ns = "";
  const dir = mkdtempSync(path.join(tmpdir(), "crew-assistant-call-"));
  const configFile = path.join(dir, "crew-policy.json");
  const previousConfig = process.env[CREW_POLICY_CONFIG_ENV];
  const OWNER = "call-owner";
  const VIEWER = "call-viewer";
  const configured = new Map<string, { reviewer: string; integrator: string }>();

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("crew-assistant-call-");
    db = createDb(tempDb.connectionString);
    ns = await applyCrewMachineTables(db);
    process.env[CREW_POLICY_CONFIG_ENV] = configFile;
    await db.insert(authUsers).values([OWNER, VIEWER].map((id) => ({
      id, name: id, email: `${id}@example.test`, createdAt: new Date(), updatedAt: new Date(),
    })));
  }, 120_000);

  afterEach(async () => {
    await heartbeatService(db).drainActiveRunExecutions();
    execute.mockReset();
  });

  afterAll(async () => {
    await heartbeatService(db).drainActiveRunExecutions();
    if (previousConfig === undefined) delete process.env[CREW_POLICY_CONFIG_ENV];
    else process.env[CREW_POLICY_CONFIG_ENV] = previousConfig;
    await db?.$client?.end?.({ timeout: 0 });
    await tempDb?.cleanup();
    rmSync(dir, { recursive: true, force: true });
  });

  /**
   * Company Crew một project: Trợ Lý, executor, reviewer, integrator (agent local, không environment SSH); gốc ở stage
   * integrator (`in_review`, giao integrator) như TPS-508. `withRoles: false` thì project không có dòng vai trò.
   */
  async function seed(opts: { withRoles?: boolean; status?: string } = {}) {
    const companyId = randomUUID();
    const projectId = randomUUID();
    const ids = { assistant: randomUUID(), executor: randomUUID(), reviewer: randomUUID(), integrator: randomUUID() };
    const issueId = randomUUID();
    const prefix = `A${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
    await db.insert(companies).values({
      id: companyId, name: "Gọi Trợ Lý", issuePrefix: prefix, requireBoardApprovalForNewAgents: false,
      defaultResponsibleUserId: OWNER,
    });
    await db.insert(companyMemberships).values([
      { companyId, principalType: "user", principalId: OWNER, status: "active", membershipRole: "owner" },
      { companyId, principalType: "user", principalId: VIEWER, status: "active", membershipRole: "viewer" },
    ]);
    await db.insert(projects).values({ id: projectId, companyId, name: "kidy-school" });
    await db.insert(agents).values(Object.entries(ids).map(([name, id]) => ({
      id, companyId, name, role: "engineer", status: "idle", adapterType: "claude_local", adapterConfig: {}, permissions: {},
      runtimeConfig: { heartbeat: { enabled: false, wakeOnDemand: true, maxConcurrentRuns: 1 } },
    })));
    if (opts.withRoles !== false) {
      await db.execute(sql.raw(`INSERT INTO ${ns}.crew_project_roles (company_id, project_id, assistant_agent_id,
          executor_agent_ids, reviewer_agent_id, integrator_agent_id, updated_by_user_id)
        VALUES ('${companyId}', '${projectId}', '${ids.assistant}', ARRAY['${ids.executor}']::uuid[], '${ids.reviewer}',
          '${ids.integrator}', '${OWNER}')`));
    }
    // File cấu hình viết lại mỗi lần seed, giữ cả các company trước.
    configured.set(companyId, { reviewer: ids.reviewer, integrator: ids.integrator });
    writeFileSync(configFile, JSON.stringify({
      companies: Object.fromEntries([...configured].map(([id, r]) => [id, {
        reviewerAgentId: r.reviewer, integratorAgentId: r.integrator, ownerUserId: OWNER,
      }])),
    }));
    await db.insert(issues).values({
      id: issueId, companyId, projectId, title: "[kidy-school] Icon và bài đăng", status: opts.status ?? "in_review",
      priority: "medium", responsibleUserId: OWNER, assigneeAgentId: ids.integrator, issueNumber: 1,
      identifier: `${prefix}-1`, createdByUserId: OWNER,
      executionPolicy: normalizeIssueExecutionPolicy({
        stages: [
          { type: "review", participants: [{ type: "agent", agentId: ids.reviewer }] },
          { type: "review", participants: [{ type: "agent", agentId: ids.integrator }] },
        ],
      }),
    });
    return { companyId, projectId, issueId, ...ids };
  }
  type Seeded = Awaited<ReturnType<typeof seed>>;

  async function comment(seeded: Seeded, body: string, authorUserId = OWNER) {
    const [row] = await db.insert(issueComments).values({
      companyId: seeded.companyId, issueId: seeded.issueId, authorUserId, authorType: "user", body,
    }).returning();
    return row!.id;
  }
  const tag = (seeded: Seeded, text = "cho UIUX làm lại icon") => `[@Trợ Lý](agent://${seeded.assistant}) ${text}`;

  function app(seeded: Seeded, userId = OWNER) {
    const server = express();
    server.use(express.json());
    server.use((req, _res, next) => {
      req.actor = {
        type: "board", userId, source: "session", isInstanceAdmin: false, companyIds: [seeded.companyId],
        memberships: [{ companyId: seeded.companyId, membershipRole: userId === OWNER ? "owner" : "viewer", status: "active" }],
      } as typeof req.actor;
      next();
    });
    server.use("/api", crewContributionRoutes(db));
    server.use(errorHandler);
    return server;
  }
  const call = (seeded: Seeded, commentId: string, userId = OWNER) =>
    request(app(seeded, userId)).post(`/api/crew/companies/${seeded.companyId}/issues/${seeded.issueId}/assistant-call`)
      .send({ commentId });
  const codeOf = (body: { code?: string; details?: { code?: string } }) => body.details?.code ?? body.code;

  const runsFor = (agentId: string) =>
    db.select().from(heartbeatRuns).where(eq(heartbeatRuns.agentId, agentId)).orderBy(asc(heartbeatRuns.createdAt));
  const readRun = (runId: string) =>
    db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, runId)).then((rows) => rows[0] ?? null);
  const wakesFor = (agentId: string) =>
    db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.agentId, agentId));
  const issueRow = async (id: string) => (await db.select().from(issues).where(eq(issues.id, id)))[0]!;

  /** Một tick scheduler: thử claim lại run `queued` (H1 quyết định giữ hay cho chạy). */
  const tick = () => heartbeatService(db).resumeQueuedRuns();

  /** Run của `agentId` trên issue, chạy tới khi `release()` được gọi (adapter mock chặn ở giữa). */
  function blockingExecute(seeded: Seeded, blockedAgentId: string) {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const state = { started: false, contexts: [] as { agentId: string; context: Record<string, unknown> }[] };
    execute.mockImplementation(async (input: ExecuteInput) => {
      state.contexts.push({ agentId: input.agent.id, context: input.context });
      if (input.agent.id === blockedAgentId) {
        state.started = true;
        await held;
      }
      return ok;
    });
    return { state, release: () => release() };
  }
  const contextsOf = (state: { contexts: { agentId: string; context: Record<string, unknown> }[] }, agentId: string) =>
    state.contexts.filter((c) => c.agentId === agentId).map((c) => c.context);

  async function wakeOnIssue(seeded: Seeded, agentId: string) {
    const run = await heartbeatService(db).wakeup(agentId, {
      source: "assignment", triggerDetail: "system", reason: "execution_review_requested",
      payload: { issueId: seeded.issueId },
      contextSnapshot: { issueId: seeded.issueId, taskId: seeded.issueId, wakeReason: "execution_review_requested" },
      requestedByActorType: "user", requestedByActorId: OWNER,
    });
    expect(run).not.toBeNull();
    return run!;
  }

  it("không có run nào giữ issue: Trợ Lý có run ngay, đọc được bình luận; status và assignee của gốc không đổi", async () => {
    const seeded = await seed();
    const { state } = blockingExecute(seeded, "none");
    const commentId = await comment(seeded, tag(seeded));
    const res = await call(seeded, commentId);
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect(res.body).toMatchObject({ status: "queued" });
    expect(typeof res.body.runId).toBe("string");

    await waitFor(() => contextsOf(state, seeded.assistant).length > 0);
    // Không có issueId (lõi sẽ hủy run của agent không phải assignee); taskId cho PAPERCLIP_TASK_ID.
    const context = contextsOf(state, seeded.assistant)[0]!;
    expect(context).toMatchObject({
      taskId: seeded.issueId, wakeReason: "crew_assistant_called", wakeCommentId: commentId, source: "crew.assistant_call",
      crewAssistantCall: { issueId: seeded.issueId, commentId },
    });
    expect(context.issueId).toBeUndefined();
    await waitFor(async () => (await readRun(res.body.runId))?.status === "succeeded");
    const root = await issueRow(seeded.issueId);
    expect(root).toMatchObject({ status: "in_review", assigneeAgentId: seeded.integrator, assigneeUserId: null });

    const [log] = await db.select().from(activityLog).where(and(
      eq(activityLog.entityId, seeded.issueId), eq(activityLog.action, "crew.assistant_called"),
    ));
    expect(log).toMatchObject({ actorType: "user", actorId: OWNER, entityType: "issue" });
    expect(log!.details).toMatchObject({ commentId, assistantAgentId: seeded.assistant, status: "queued" });
  }, 120_000);

  it("integrator đang có run giữ issue: run của Trợ Lý bị giữ ở queued rồi chạy sau khi run đó kết thúc, không bị bỏ", async () => {
    const seeded = await seed();
    const { state, release } = blockingExecute(seeded, seeded.integrator);
    const integratorRun = await wakeOnIssue(seeded, seeded.integrator);
    await waitFor(() => state.started);
    expect((await readRun(integratorRun.id))?.status).toBe("running");

    const commentId = await comment(seeded, tag(seeded, "mang bài đăng ra trang home"));
    const res = await call(seeded, commentId);
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect(res.body).toMatchObject({ status: "deferred" });
    const assistantRunId = res.body.runId as string;
    expect(typeof assistantRunId).toBe("string");

    // Các tick trong lúc integrator còn chạy: run vẫn queued, adapter chưa được gọi cho Trợ Lý.
    for (let i = 0; i < 3; i += 1) await tick();
    expect((await readRun(assistantRunId))?.status).toBe("queued");
    expect(contextsOf(state, seeded.assistant)).toHaveLength(0);

    release();
    await waitFor(async () => (await readRun(integratorRun.id))?.status === "succeeded");
    await tick();
    await waitFor(() => contextsOf(state, seeded.assistant).length > 0);
    expect(contextsOf(state, seeded.assistant)[0]).toMatchObject({
      taskId: seeded.issueId, wakeReason: "crew_assistant_called", wakeCommentId: commentId,
    });
    await waitFor(async () => (await readRun(assistantRunId))?.status === "succeeded");
    const assistantRun = (await readRun(assistantRunId))!;
    expect(assistantRun.startedAt!.getTime()).toBeGreaterThanOrEqual((await readRun(integratorRun.id))!.finishedAt!.getTime());
    expect(await runsFor(seeded.assistant)).toHaveLength(1);
    expect((await issueRow(seeded.issueId))).toMatchObject({ status: "in_review", assigneeAgentId: seeded.integrator });
  }, 120_000);

  it("owner gọi hai lần liên tiếp khi run đang bị giữ: mỗi bình luận một run, Trợ Lý xử lý cả hai", async () => {
    const seeded = await seed();
    const { state, release } = blockingExecute(seeded, seeded.integrator);
    const integratorRun = await wakeOnIssue(seeded, seeded.integrator);
    await waitFor(() => state.started);

    const first = await comment(seeded, tag(seeded, "việc A: làm lại icon"));
    const second = await comment(seeded, tag(seeded, "việc B: mang bài đăng ra home"));
    const resA = await call(seeded, first);
    const resB = await call(seeded, second);
    expect(resA.body).toMatchObject({ status: "deferred" });
    expect(resB.body).toMatchObject({ status: "deferred" });
    expect(resA.body.runId).not.toBe(resB.body.runId);
    // Không gộp: run của bình luận A vẫn mang id của A.
    expect((await readRun(resA.body.runId))?.contextSnapshot).toMatchObject({ wakeCommentId: first });
    expect((await readRun(resB.body.runId))?.contextSnapshot).toMatchObject({ wakeCommentId: second });
    expect((await wakesFor(seeded.assistant)).map((w) => w.status).sort()).toEqual(["queued", "queued"]);

    release();
    await waitFor(async () => (await readRun(integratorRun.id))?.status === "succeeded");
    for (const runId of [resA.body.runId, resB.body.runId]) {
      await waitFor(async () => {
        await tick();
        return (await readRun(runId))?.status === "succeeded";
      });
    }
    const handled = contextsOf(state, seeded.assistant).map((c) => c.wakeCommentId).sort();
    expect(handled).toEqual([first, second].sort());
    expect(await runsFor(seeded.assistant)).toHaveLength(2);
  }, 120_000);

  it("wake thường của lõi tới Trợ Lý không ghi đè run gọi bằng tag đang chờ", async () => {
    const seeded = await seed();
    const { state, release } = blockingExecute(seeded, seeded.integrator);
    const integratorRun = await wakeOnIssue(seeded, seeded.integrator);
    await waitFor(() => state.started);
    const commentId = await comment(seeded, tag(seeded));
    const res = await call(seeded, commentId);
    expect(res.body).toMatchObject({ status: "deferred" });
    const before = (await readRun(res.body.runId))!.contextSnapshot;

    // Wake bình luận của lõi trên cùng issue (có issueId) và wake không có task.
    const otherComment = await comment(seeded, "owner nói thêm, không tag");
    await heartbeatService(db).wakeup(seeded.assistant, {
      source: "automation", triggerDetail: "system", reason: "issue_commented",
      payload: { issueId: seeded.issueId, commentId: otherComment },
      contextSnapshot: { issueId: seeded.issueId, taskId: seeded.issueId, wakeReason: "issue_commented", wakeCommentId: otherComment },
      requestedByActorType: "user", requestedByActorId: OWNER,
    });
    await heartbeatService(db).wakeup(seeded.assistant, {
      source: "on_demand", triggerDetail: "manual", reason: "manual",
      contextSnapshot: { wakeReason: "manual" }, requestedByActorType: "user", requestedByActorId: OWNER,
    });
    const after = (await readRun(res.body.runId))!;
    expect(after.status).toBe("queued");
    expect(after.contextSnapshot).toEqual(before);

    release();
    await waitFor(async () => (await readRun(integratorRun.id))?.status === "succeeded");
    await waitFor(async () => {
      await tick();
      return (await readRun(res.body.runId))?.status === "succeeded";
    });
    expect(contextsOf(state, seeded.assistant)).toContainEqual(expect.objectContaining({
      wakeReason: "crew_assistant_called", wakeCommentId: commentId,
    }));
  }, 120_000);

  it("Trợ Lý pause hay tắt đánh thức: 409 crew_assistant_call_skipped, không khóa bình luận, gọi lại sau khi bật thì chạy", async () => {
    const seeded = await seed();
    execute.mockImplementation(async () => ok);
    const commentId = await comment(seeded, tag(seeded));

    await db.update(agents).set({ status: "paused" }).where(eq(agents.id, seeded.assistant));
    const paused = await call(seeded, commentId);
    expect(paused.status, JSON.stringify(paused.body)).toBe(409);
    expect(codeOf(paused.body)).toBe("crew_assistant_call_skipped");
    expect(paused.body.error).toMatch(/Trợ Lý đang tạm dừng/);

    await db.update(agents).set({
      status: "idle", runtimeConfig: { heartbeat: { enabled: false, wakeOnDemand: false, maxConcurrentRuns: 1 } },
    }).where(eq(agents.id, seeded.assistant));
    const disabled = await call(seeded, commentId);
    expect(disabled.status, JSON.stringify(disabled.body)).toBe(409);
    expect(codeOf(disabled.body)).toBe("crew_assistant_call_skipped");
    expect(disabled.body.details).toMatchObject({ skipReason: "heartbeat.wakeOnDemand.disabled" });
    expect(await runsFor(seeded.assistant)).toHaveLength(0);

    await db.update(agents).set({
      runtimeConfig: { heartbeat: { enabled: false, wakeOnDemand: true, maxConcurrentRuns: 1 } },
    }).where(eq(agents.id, seeded.assistant));
    const retried = await call(seeded, commentId);
    expect(retried.status, JSON.stringify(retried.body)).toBe(202);
    expect(retried.body).toMatchObject({ status: "queued" });
    await waitFor(async () => (await readRun(retried.body.runId))?.status === "succeeded");
    expect((await call(seeded, commentId)).body).toEqual({ status: "already" });
  }, 120_000);

  it("run của agent khác không bị giữ: integrator vẫn chạy khi Trợ Lý đang chạy trên cùng issue", async () => {
    const seeded = await seed();
    const { state, release } = blockingExecute(seeded, seeded.assistant);
    const res = await call(seeded, await comment(seeded, tag(seeded)));
    expect(res.body).toMatchObject({ status: "queued" });
    await waitFor(() => state.started);

    const integratorRun = await wakeOnIssue(seeded, seeded.integrator);
    await waitFor(async () => (await readRun(integratorRun.id))?.status === "succeeded");
    expect(contextsOf(state, seeded.integrator)).toHaveLength(1);

    // Run queued của agent khác không tính là giữ task: Trợ Lý chỉ chờ run đang running.
    const { holdAssistantCallRun } = await import("../crew/assistant-call-routes.js");
    const [assistantRun] = await runsFor(seeded.assistant);
    const [queuedOther] = await db.insert(heartbeatRuns).values({
      companyId: seeded.companyId, agentId: seeded.reviewer, invocationSource: "assignment", status: "queued",
      contextSnapshot: { issueId: seeded.issueId, taskId: seeded.issueId },
    }).returning();
    expect(await holdAssistantCallRun({ db, run: { ...assistantRun!, status: "queued" } })).toBe(false);
    await db.delete(heartbeatRuns).where(eq(heartbeatRuns.id, queuedOther!.id));
    expect(await holdAssistantCallRun({ db, run: { ...assistantRun!, contextSnapshot: { wakeReason: "issue_assigned", taskId: seeded.issueId }, status: "queued" } })).toBe(false);
    release();
    await waitFor(async () => (await readRun(res.body.runId))?.status === "succeeded");
  }, 120_000);
  it("gọi lại cùng bình luận không tạo wake thứ hai", async () => {
    const seeded = await seed();
    execute.mockImplementation(async () => ok);
    const commentId = await comment(seeded, tag(seeded));
    const [first, second] = await Promise.all([call(seeded, commentId), call(seeded, commentId)]);
    expect([first.status, second.status].sort()).toEqual([200, 202]);
    expect([first.body.status, second.body.status]).toContain("already");
    const third = await call(seeded, commentId);
    expect(third.status).toBe(200);
    expect(third.body).toEqual({ status: "already" });
    expect(await wakesFor(seeded.assistant)).toHaveLength(1);
    await waitFor(async () => (await runsFor(seeded.assistant)).length > 0);
    expect(await runsFor(seeded.assistant)).toHaveLength(1);
  }, 120_000);

  it("quyền và kiểm bình luận: 403, 404, 422, 409, 400", async () => {
    const seeded = await seed();
    execute.mockImplementation(async () => ok);
    const own = await comment(seeded, tag(seeded));
    const forbidden = await call(seeded, own, VIEWER);
    expect(forbidden.status).toBe(403);
    const byViewer = await comment(seeded, tag(seeded), VIEWER);
    const notAuthor = await call(seeded, byViewer);
    expect(notAuthor.status).toBe(403);
    expect(codeOf(notAuthor.body)).toBe("crew_assistant_call_not_author");
    const noLink = await call(seeded, await comment(seeded, "@tro-ly làm đi"));
    expect(noLink.status).toBe(422);
    expect(codeOf(noLink.body)).toBe("crew_assistant_not_mentioned");
    const otherAgent = await call(seeded, await comment(seeded, `[@Integrator](agent://${seeded.integrator}) xem`));
    expect(otherAgent.status).toBe(422);
    expect((await call(seeded, randomUUID())).status).toBe(404);
    const [deletedComment] = await db.insert(issueComments).values({
      companyId: seeded.companyId, issueId: seeded.issueId, authorUserId: OWNER, body: tag(seeded), deletedAt: new Date(),
    }).returning();
    expect((await call(seeded, deletedComment!.id)).status).toBe(404);
    const bad = await request(app(seeded)).post(`/api/crew/companies/${seeded.companyId}/issues/${seeded.issueId}/assistant-call`)
      .send({ commentId: "x" });
    expect(bad.status).toBe(400);

    const closed = await seed({ status: "done" });
    const closedRes = await call(closed, await comment(closed, tag(closed)));
    expect(closedRes.status).toBe(409);
    expect(codeOf(closedRes.body)).toBe("crew_assistant_call_closed");

    const noRoles = await seed({ withRoles: false });
    const missing = await call(noRoles, await comment(noRoles, tag(noRoles)));
    expect(missing.status).toBe(409);
    expect(codeOf(missing.body)).toBe("crew_assistant_missing");

    for (const s of [seeded, closed, noRoles]) expect(await wakesFor(s.assistant)).toHaveLength(0);
  }, 120_000);

  it("wake issue_comment_mentioned của lõi bị bỏ: không run, không wake hoãn", async () => {
    const seeded = await seed();
    execute.mockImplementation(async () => ok);
    const commentId = await comment(seeded, tag(seeded));
    const result = await heartbeatService(db).wakeup(seeded.assistant, {
      source: "automation", triggerDetail: "system", reason: "issue_comment_mentioned",
      payload: { issueId: seeded.issueId, commentId },
      contextSnapshot: { issueId: seeded.issueId, taskId: seeded.issueId, wakeReason: "issue_comment_mentioned", wakeCommentId: commentId },
      requestedByActorType: "user", requestedByActorId: OWNER,
    });
    expect(result).toBeNull();
    expect(await wakesFor(seeded.assistant)).toHaveLength(0);
    expect(await runsFor(seeded.assistant)).toHaveLength(0);
  }, 120_000);
});

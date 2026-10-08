import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { remoteExecutionSessionMatches } from "@paperclipai/adapter-utils/remote-managed-runtime";
import {
  activityLog, agentRuntimeState, agentTaskSessions, agentWakeupRequests, agents,
  companies, createDb, heartbeatRuns, issueRelations, issues,
} from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "../__tests__/helpers/embedded-postgres.js";
import { applyBundleResume, findBundlePredecessor } from "./bundle-resume.js";
import { heartbeatService } from "../services/heartbeat.js";

const execute = vi.hoisted(() => vi.fn());
vi.mock("../adapters/index.js", async () => {
  const actual = await vi.importActual<typeof import("../adapters/index.js")>("../adapters/index.js");
  return { ...actual, getServerAdapter: vi.fn(() => ({ supportsLocalAgentJwt: false, execute })) };
});

describe("crew-bundle-resume: cancellation issue_reassigned trước task session", () => {
  let db: ReturnType<typeof createDb>;
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  beforeAll(async () => {
    const support = await getEmbeddedPostgresTestSupport();
    if (!support.supported) throw new Error(support.reason);
    temporary = await startEmbeddedPostgresTestDatabase("crew-cancelled-");
    db = createDb(temporary.connectionString);
  }, 60_000);
  afterEach(() => execute.mockReset());
  afterAll(async () => {
    await db?.$client.end({ timeout: 0 });
    await temporary?.cleanup();
  });

  async function seed(patch: Partial<typeof heartbeatRuns.$inferInsert> = {}) {
    const companyId = randomUUID(), agentId = randomUUID(), otherAgentId = randomUUID();
    const parentId = randomUUID(), issueA = randomUUID(), issueB = randomUUID();
    const runA = randomUUID(), runB = randomUUID(), wakeupRequestId = randomUUID();
    const sessionId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Cancelled bundle", issuePrefix: `C${companyId.slice(0, 7)}`, defaultResponsibleUserId: "owner" });
    await db.insert(agents).values([agentId, otherAgentId].map((id) => ({
      id, companyId, name: id, role: "engineer", status: "idle", adapterType: "process",
      runtimeConfig: { heartbeat: { enabled: false, wakeOnDemand: true, maxConcurrentRuns: 1 } },
    })));
    await db.insert(issues).values({ id: parentId, companyId, title: "Root", responsibleUserId: "owner" });
    await db.insert(issues).values([
      // Sau handoff, A có thể giao reviewer; run nguồn vẫn phải của executor.
      { id: issueA, companyId, parentId, title: "A", status: "done", assigneeAgentId: otherAgentId, responsibleUserId: "owner", description: "crew-bundle id=greet seq=1" },
      { id: issueB, companyId, parentId, title: "B", status: "todo", assigneeAgentId: agentId, responsibleUserId: "owner", description: "crew-bundle id=greet seq=2" },
    ]);
    await db.insert(issueRelations).values({ companyId, issueId: issueA, relatedIssueId: issueB, type: "blocks" });
    await db.insert(heartbeatRuns).values({
      id: runA, companyId, agentId, invocationSource: "automation", responsibleUserId: "owner",
      status: "running", contextSnapshot: { issueId: issueA }, sessionIdAfter: sessionId, ...patch,
    });
    // Dùng cùng API cancellation mà issueRoutes gọi; không tạo task session giả.
    const heartbeat = heartbeatService(db);
    const cancelled = await heartbeat.cancelRun(runA, "Cancelled before issue reassignment", {
      errorCode: "issue_reassigned", resultJson: { reassignmentStopConfirmed: true }, suppressImmediateRecovery: true,
    });
    expect(cancelled).toMatchObject({ status: "cancelled", errorCode: "issue_reassigned" });
    expect(await db.select().from(agentTaskSessions).where(and(eq(agentTaskSessions.agentId, agentId), eq(agentTaskSessions.taskKey, issueA)))).toHaveLength(0);
    await db.insert(agentWakeupRequests).values({
      id: wakeupRequestId, companyId, agentId, source: "automation", triggerDetail: "system",
      reason: "issue_assigned", payload: { issueId: issueB }, status: "queued", runId: runB, requestedByActorType: "system",
    });
    await db.insert(heartbeatRuns).values({
      id: runB, companyId, agentId, invocationSource: "automation", responsibleUserId: "owner", status: "queued",
      wakeupRequestId, triggerDetail: "system", contextSnapshot: { issueId: issueB, taskKey: issueB, wakeReason: "issue_assigned" },
    });
    return { companyId, agentId, otherAgentId, issueA, issueB, runA, runB, sessionId };
  }
  type Seed = Awaited<ReturnType<typeof seed>>;
  const find = (s: Seed) => findBundlePredecessor(db, { ...s, issueId: s.issueB });
  async function claim(s: Seed, expected: string | null) {
    execute.mockResolvedValue({ exitCode: 0, signal: null, timedOut: false, summary: "ok" });
    const heartbeat = heartbeatService(db);
    await heartbeat.resumeQueuedRuns();
    await heartbeat.drainActiveRunExecutions();
    const calls = execute.mock.calls.filter(([ctx]) => ctx.runId === s.runB);
    expect(calls).toHaveLength(1);
    expect(calls[0]![0].runtime.sessionId ?? null).toBe(expected);
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, s.runB));
    expect(run?.status).toBe("succeeded");
    if (expected) expect(run?.contextSnapshot).toMatchObject({ resumeFromRunId: s.runA, resumeSessionParams: { sessionId: expected } });
    else expect(run?.contextSnapshot).not.toHaveProperty("resumeFromRunId");
    const audit = await db.select().from(activityLog).where(and(eq(activityLog.entityId, s.runB), eq(activityLog.action, "crew.bundle_resume")));
    expect(audit).toHaveLength(expected ? 1 : 0);
  }

  it("run A cancelled còn sessionIdAfter, không task session: B nhận đúng session và audit một lần", async () => {
    const s = await seed();
    await claim(s, s.sessionId);
  }, 30_000);
  it.each(["sessionIdBefore", "resultJson.session_id", "resultJson.sessionId", "contextSnapshot.resumeSessionParams"])("cứu session từ %s khi sessionIdAfter null", async (source) => {
    const sessionId = randomUUID();
    const s = await seed({ sessionIdAfter: null, ...(source === "sessionIdBefore" ? { sessionIdBefore: sessionId } : source.startsWith("resultJson") ? { resultJson: { [source.split(".")[1]!]: sessionId } } : {}) });
    if (source.startsWith("contextSnapshot")) await db.update(heartbeatRuns).set({ contextSnapshot: { issueId: s.issueA, resumeSessionParams: { sessionId } } }).where(eq(heartbeatRuns.id, s.runA));
    await claim(s, sessionId);
  }, 30_000);
  it("không có id trên run: không lấy session runtime toàn agent, B mở mới", async () => {
    const s = await seed({ sessionIdAfter: null });
    await db.insert(agentRuntimeState).values({ companyId: s.companyId, agentId: s.agentId, adapterType: "process", sessionId: randomUUID(), lastRunId: s.runB });
    await claim(s, null);
  }, 30_000);
  it("chỉ dùng run mới nhất, không lùi về run cũ có session", async () => {
    const s = await seed();
    await db.insert(heartbeatRuns).values({ id: randomUUID(), companyId: s.companyId, agentId: s.agentId, invocationSource: "automation", status: "cancelled", errorCode: "issue_reassigned", contextSnapshot: { issueId: s.issueA }, createdAt: new Date(Date.now() + 1000) });
    expect(await find(s)).toBeNull();
  });
  it("run mới nhất của agent khác không che session executor", async () => {
    const s = await seed();
    await db.insert(heartbeatRuns).values({ companyId: s.companyId, agentId: s.otherAgentId, invocationSource: "automation", status: "succeeded", contextSnapshot: { issueId: s.issueA }, sessionIdAfter: randomUUID(), createdAt: new Date(Date.now() + 1000) });
    expect((await find(s))?.predecessor.session.lastRunId).toBe(s.runA);
  });
  it("run mới nhất thắng dù run cũ được cập nhật muộn hơn; after ưu tiên hơn before/result", async () => {
    const s = await seed();
    const latestId = randomUUID(), latestSession = randomUUID();
    await db.update(heartbeatRuns).set({ updatedAt: new Date(Date.now() + 5000) }).where(eq(heartbeatRuns.id, s.runA));
    await db.insert(heartbeatRuns).values({ id: latestId, companyId: s.companyId, agentId: s.agentId, invocationSource: "automation", status: "cancelled", errorCode: "issue_reassigned", contextSnapshot: { issueId: s.issueA }, sessionIdAfter: latestSession, sessionIdBefore: s.sessionId, resultJson: { session_id: randomUUID() }, createdAt: new Date(Date.now() + 1000) });
    expect((await find(s))?.predecessor.session).toMatchObject({ lastRunId: latestId, sessionParamsJson: { sessionId: latestSession } });
  });
  it("task session có sẵn trên A vẫn có ưu tiên", async () => {
    const s = await seed();
    const taskSessionId = randomUUID();
    await db.insert(agentTaskSessions).values({ companyId: s.companyId, agentId: s.agentId, adapterType: "process", taskKey: s.issueA, sessionParamsJson: { sessionId: taskSessionId }, lastRunId: s.runA });
    expect((await find(s))?.predecessor.session.sessionParamsJson).toEqual({ sessionId: taskSessionId });
  });
  it("giữ metadata resume chỉ khi id khớp session đã chọn", async () => {
    const s = await seed();
    const params = { sessionId: s.sessionId, promptBundleKey: "bundle-key", mcpServerIdentity: "mcp-id", remoteExecution: { transport: "ssh" } };
    await db.update(heartbeatRuns).set({ contextSnapshot: { issueId: s.issueA, resumeSessionParams: params } }).where(eq(heartbeatRuns.id, s.runA));
    expect((await find(s))?.predecessor.session.sessionParamsJson).toEqual(params);
    await db.update(heartbeatRuns).set({ contextSnapshot: { issueId: s.issueA, resumeSessionParams: { ...params, sessionId: randomUUID() } } }).where(eq(heartbeatRuns.id, s.runA));
    expect((await find(s))?.predecessor.session.sessionParamsJson).toEqual({ sessionId: s.sessionId });
  });
  it("Claude: UUID hợp lệ và identity SSH từ context run được giữ", async () => {
    const s = await seed();
    const remote = { transport: "ssh", host: "fixture.invalid", port: 22, username: "executor", remoteCwd: "/fixture/repo" };
    await db.update(agents).set({ adapterType: "claude_local" }).where(eq(agents.id, s.agentId));
    await db.update(heartbeatRuns).set({ contextSnapshot: { issueId: s.issueA, paperclipEnvironment: { driver: "ssh", ...remote }, paperclipWorkspace: { cwd: "/fixture/local", workspaceId: randomUUID() } } }).where(eq(heartbeatRuns.id, s.runA));
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, s.runB));
    expect(await applyBundleResume({ db, run: run! })).toBe("applied");
    expect(run!.contextSnapshot?.resumeSessionParams).toMatchObject({ sessionId: s.sessionId, remoteExecution: remote });
    const params = run!.contextSnapshot?.resumeSessionParams as Record<string, unknown>;
    const spec = { ...remote, remoteWorkspacePath: remote.remoteCwd, privateKey: null, knownHosts: null, strictHostKeyChecking: true };
    // Pure identity check dùng bởi adapter; không mở SSH hay chạy CLI thật.
    expect(remoteExecutionSessionMatches(params.remoteExecution, spec)).toBe(true);
    expect(remoteExecutionSessionMatches(params.remoteExecution, { ...spec, username: "other" })).toBe(false);
  });
  it.each([null, "", "   ", "not-a-uuid"])("Claude không nối id không hợp lệ %s", async (sessionIdAfter) => {
    const s = await seed({ sessionIdAfter });
    await db.update(agents).set({ adapterType: "claude_local" }).where(eq(agents.id, s.agentId));
    expect(await find(s)).toBeNull();
  });
  it.each(["parent", "bundle", "seq", "status", "blocker", "agent", "company", "own-session", "adapter-session"])("fallback giữ cổng F2: %s", async (gate) => {
    const s = await seed();
    if (gate === "parent") await db.update(issues).set({ parentId: null }).where(eq(issues.id, s.issueA));
    if (gate === "bundle" || gate === "seq") await db.update(issues).set({ description: gate === "bundle" ? "crew-bundle id=other seq=1" : "crew-bundle id=greet seq=2" }).where(eq(issues.id, s.issueA));
    if (gate === "status") await db.update(issues).set({ status: "in_review" }).where(eq(issues.id, s.issueA));
    if (gate === "blocker") await db.delete(issueRelations).where(eq(issueRelations.relatedIssueId, s.issueB));
    if (gate === "agent") await db.update(heartbeatRuns).set({ agentId: s.otherAgentId }).where(eq(heartbeatRuns.id, s.runA));
    if (gate === "company") {
      const foreign = randomUUID();
      await db.insert(companies).values({ id: foreign, name: "Foreign", issuePrefix: `F${foreign.slice(0, 7)}` });
      await db.update(heartbeatRuns).set({ companyId: foreign }).where(eq(heartbeatRuns.id, s.runA));
    }
    if (gate.endsWith("session")) await db.insert(agentTaskSessions).values({ companyId: s.companyId, agentId: s.agentId, adapterType: gate === "adapter-session" ? "claude_local" : "process", taskKey: gate === "own-session" ? s.issueB : s.issueA, sessionParamsJson: { sessionId: randomUUID() } });
    expect(await find(s)).toBeNull();
  });
});

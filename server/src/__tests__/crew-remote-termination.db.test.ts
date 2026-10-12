import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  agentWakeupRequests, agents, companies, createDb, environmentLeases, heartbeatRunEvents, heartbeatRuns, issueComments,
  issueRecoveryActions, issues,
} from "@paperclipai/db";
import type { Environment, EnvironmentLease } from "@paperclipai/shared";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { settleRemoteStopsForTests, startRemoteStopOnRelease, type RemoteStopResult } from "../crew/remote-stop.ts";
import { legacyRunNeverLaunched } from "../crew/remote-termination.ts";
import { admitExplicitNativeContinuation } from "../services/explicit-native-continuation.js";
import { heartbeatService } from "../services/heartbeat.js";
import { hasRemoteTerminationReceipt } from "../services/remote-execution-termination.js";

// Một run legacy (claude_local qua môi trường SSH) bị hủy ngay lúc khởi động, việc bị giữ bởi execution recovery.
// Trước bản vá: lease SSH không bao giờ có biên nhận dừng, nên bình luận của owner bị hoãn mãi
// (`executionWait.reason = "remote_cleanup"`). Sau bản vá: H3 ghi biên nhận khi dừng được xác minh hoặc run chưa
// từng khởi chạy adapter, và tin nhắn đã lưu được đưa vào hàng đợi.
const support = await getEmbeddedPostgresTestSupport();

(support.supported ? describe : describe.skip)("biên nhận dừng của lease SSH", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("crew-remote-termination-");
    db = createDb(database.connectionString);
  }, 30000);
  afterAll(async () => {
    await database?.cleanup();
  });

  type Launch = "never" | "invoked" | "process";

  async function seed(launch: Launch) {
    const companyId = randomUUID(), agentId = randomUUID(), issueId = randomUUID(), runId = randomUUID();
    const commentId = randomUUID(), wakeId = randomUUID(), leaseId = randomUUID();
    const finishedAt = new Date("2026-10-12T03:00:00Z");
    await db.insert(companies).values({ id: companyId, name: "Stuck comment", defaultResponsibleUserId: "owner",
      issuePrefix: `S${companyId.slice(0, 6)}` });
    await db.insert(agents).values({ id: agentId, companyId, name: "Mac Claude", role: "engineer",
      adapterType: "claude_local", status: "idle", runtimeConfig: { heartbeat: { maxConcurrentRuns: 1 } } });
    await db.insert(issues).values({ id: issueId, companyId, title: "TPS", status: "in_progress", assigneeAgentId: agentId });
    await db.insert(heartbeatRuns).values({ id: runId, companyId, agentId, runtimeMode: "legacy", status: "cancelled",
      contextSnapshot: { issueId }, startedAt: new Date("2026-10-12T02:59:00Z"), finishedAt,
      errorCode: launch === "never" ? "legacy_disposition_repair_suppressed" : "cancelled",
      error: launch === "never" ? "Disposition repair suppressed: recorded_disposition" : "Cancelled",
      ...(launch === "process" ? { processPid: 4242, processStartedAt: new Date("2026-10-12T02:59:30Z") } : {}) });
    if (launch !== "never") {
      await db.insert(heartbeatRunEvents).values({ companyId, runId, agentId, seq: 1, eventType: "adapter.invoke",
        stream: "system", level: "info", message: "adapter invocation" });
    }
    await db.insert(issueRecoveryActions).values({ companyId, sourceIssueId: issueId, kind: "active_run_watchdog",
      cause: "legacy_execution_requires_reconciliation", fingerprint: runId, status: "resolved", outcome: "blocked",
      nextAction: "Automatic recovery stopped.",
      evidence: { runId, automaticRecovery: { replay: "blocked", policy: "preserve_without_replay_v1" } } });
    await db.insert(environmentLeases).values({ id: leaseId, companyId, heartbeatRunId: runId, issueId, status: "active",
      leasePolicy: "ephemeral", provider: "ssh", providerLeaseId: "ssh://agent@mac.test:22/Users/agent/crew-agents/w1",
      metadata: { driver: "ssh", remoteCwd: "/Users/agent/crew-agents/w1" } });
    await db.insert(issueComments).values({ id: commentId, companyId, issueId, authorType: "user", authorUserId: "owner",
      body: "Làm tiếp đi.", createdAt: new Date("2026-10-12T03:10:00Z") });
    await db.insert(agentWakeupRequests).values({ id: wakeId, companyId, agentId, source: "automation",
      triggerDetail: "system", reason: "issue_execution_deferred", status: "deferred_issue_execution",
      requestedByActorType: "user", requestedByActorId: "owner",
      payload: { issueId, commentId, executionWait: { reason: "remote_cleanup" },
        _paperclipWakeContext: { issueId, wakeReason: "issue_reopened_via_comment", wakeCommentId: commentId,
          wakeCommentIds: [commentId] } } });
    // Occupy the agent slot on another task: admission is real, but no adapter is launched.
    await db.insert(heartbeatRuns).values({ companyId, agentId, status: "running", contextSnapshot: { issueId: randomUUID() } });
    return { companyId, agentId, issueId, runId, commentId, wakeId, leaseId };
  }
  type Fixture = Awaited<ReturnType<typeof seed>>;

  const admit = (f: Fixture) => {
    let blocked: string | null = null;
    return admitExplicitNativeContinuation({ db, companyId: f.companyId, issueId: f.issueId, agentId: f.agentId,
      actorType: "user", actorId: "owner", reason: "issue_reopened_via_comment", commentId: f.commentId,
      successorRunId: randomUUID(), dryRun: true, onBlocked: (reason) => { blocked = reason; } })
      .then((admitted) => ({ admitted, blocked }));
  };

  async function releaseLease(f: Fixture, stop: RemoteStopResult) {
    const [row] = await db.select().from(environmentLeases).where(eq(environmentLeases.id, f.leaseId));
    await startRemoteStopOnRelease({
      db, status: "expired",
      environment: { id: randomUUID(), driver: "ssh" } as unknown as Environment,
      lease: row as unknown as EnvironmentLease,
    }, async () => stop);
    await settleRemoteStopsForTests();
    const [lease] = await db.select().from(environmentLeases).where(eq(environmentLeases.id, f.leaseId));
    const [wake] = await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.id, f.wakeId));
    return { lease, wake };
  }

  const queuedSuccessors = (f: Fixture) => db.select().from(heartbeatRuns).where(and(
    eq(heartbeatRuns.companyId, f.companyId), eq(heartbeatRuns.status, "queued")));

  it("tái hiện: thiếu biên nhận thì tin nhắn của owner bị hoãn với remote_cleanup", async () => {
    const f = await seed("never");
    await db.update(environmentLeases).set({ status: "expired", releasedAt: new Date() })
      .where(eq(environmentLeases.id, f.leaseId));
    expect(await admit(f)).toEqual({ admitted: null, blocked: "remote_cleanup" });
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, f.runId));
    await heartbeatService(db).resumeRemoteStopComments(run, f.wakeId);
    const [wake] = await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.id, f.wakeId));
    expect(wake.status).toBe("deferred_issue_execution");
  });

  it("run chưa từng khởi chạy, máy Mac không tới được: vẫn ghi biên nhận và đưa tin nhắn vào hàng đợi", async () => {
    const f = await seed("never");
    expect(await legacyRunNeverLaunched(db, f.companyId, f.runId)).toBe(true);
    const { lease, wake } = await releaseLease(f, { outcome: "unreachable", error: "ssh: connect timed out" });
    expect(hasRemoteTerminationReceipt(lease)).toBe(true);
    expect(lease).toMatchObject({ status: "expired", cleanupStatus: "success" });
    expect(lease.metadata).toMatchObject({ crewRemoteTermination: { proof: "never_started", stopOutcome: "unreachable" } });
    const successors = await queuedSuccessors(f);
    expect(successors).toHaveLength(1);
    expect(wake).toMatchObject({ status: "coalesced", runId: successors[0].id, requestedByActorId: "owner" });
    expect(successors[0].contextSnapshot).toMatchObject({ issueId: f.issueId, wakeCommentIds: [f.commentId] });
  });

  it("run đã khởi chạy và lệnh dừng xác nhận không còn process: ghi biên nhận", async () => {
    const f = await seed("process");
    expect(await legacyRunNeverLaunched(db, f.companyId, f.runId)).toBe(false);
    const { lease, wake } = await releaseLease(f, { outcome: "stopped", matched: 3, killed: 0, remaining: 0 });
    expect(hasRemoteTerminationReceipt(lease)).toBe(true);
    expect(lease.metadata).toMatchObject({ crewRemoteTermination: { proof: "remote_stop_verified", matched: 3, remaining: 0 } });
    expect(wake.status).toBe("coalesced");
  });

  it.each([
    ["invoked", { outcome: "unreachable", error: "ssh: connect timed out" }],
    ["process", { outcome: "unreachable", error: "ssh: connect timed out" }],
    ["process", { outcome: "incomplete", matched: 2, killed: 2, remaining: 1 }],
    ["process", { outcome: "failed", exitCode: 1, error: "boom" }],
  ] as Array<[Launch, RemoteStopResult]>)("run đã khởi chạy (%s), dừng chưa xác minh (%o): không biên nhận, tin nhắn vẫn chờ", async (launch, stop) => {
    const f = await seed(launch);
    const { lease, wake } = await releaseLease(f, stop);
    expect(lease.releasedAt).not.toBeNull();
    expect(hasRemoteTerminationReceipt(lease)).toBe(false);
    expect(lease.metadata).not.toHaveProperty("crewRemoteTermination");
    expect(wake.status).toBe("deferred_issue_execution");
    expect(await queuedSuccessors(f)).toHaveLength(0);
    expect((await admit(f)).blocked).toBe("remote_cleanup");
  });

  it("bình luận mới sau khi có biên nhận được nhận vào ngay", async () => {
    const f = await seed("never");
    await db.update(agentWakeupRequests).set({ status: "cancelled" }).where(eq(agentWakeupRequests.id, f.wakeId));
    await releaseLease(f, { outcome: "stopped", matched: 0, killed: 0, remaining: 0, via: "fallback" });
    expect(await admit(f)).toMatchObject({ admitted: { previousRunId: f.runId, commentId: f.commentId }, blocked: null });
  });
});

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import {
  activityLog, agentWakeupRequests, agents, companies, createDb, environmentLeases, environments, heartbeatRunEvents,
  heartbeatRuns, issueComments, issueRecoveryActions, issues,
} from "@paperclipai/db";
import type { Environment, EnvironmentLease } from "@paperclipai/shared";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { overrideCrewCoreHooksForTests } from "../crew/core-hooks.ts";
import {
  settleRemoteStopsForTests, startRemoteStopOnRelease, stopRemoteRunOnRelease, type RemoteStopDeps,
  type RemoteStopResult, type RunLeaseReleasedInput,
} from "../crew/remote-stop.ts";
import {
  SSH_TEARDOWN_ESCALATED_ACTION, SSH_TEARDOWN_ESCALATION_ATTEMPTS, retrySshPendingTeardown,
} from "../crew/ssh-pending-teardown.ts";
import { environmentRuntimeService } from "../services/environment-runtime.js";
import { getExecutionBlocker } from "../services/execution-blocker.js";
import { heartbeatService, type HeartbeatEnvironmentRuntime } from "../services/heartbeat.js";
import { hasRemoteTerminationReceipt } from "../services/remote-execution-termination.js";

// Lease SSH kẹt `pending_cleanup` (TPS-123): Interrupt hoặc vòng quét lease mồ côi chuyển lease SSH sang
// `pending_cleanup`, rồi vòng dọn gọi `retryPendingSandboxTeardown` mà driver SSH gốc không có, nên lần nào cũng
// `destroy_failed`. Thêm: Stop với run legacy trên SSH chỉ được xác nhận sau khi biên nhận dừng đã ghi.
const support = await getEmbeddedPostgresTestSupport();

(support.supported ? describe : describe.skip)("dọn lease SSH kẹt pending_cleanup", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  let restoreHooks: (() => void) | null = null;
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("crew-ssh-pending-teardown-");
    db = createDb(database.connectionString);
  }, 30000);
  afterEach(() => {
    restoreHooks?.();
    restoreHooks = null;
  });
  afterAll(async () => {
    await database?.cleanup();
  });

  type Launch = "never" | "process";

  async function seed(launch: Launch, opts: { environment?: boolean; leaseStatus?: string; stopRequested?: boolean } = {}) {
    const companyId = randomUUID(), agentId = randomUUID(), issueId = randomUUID(), runId = randomUUID();
    const commentId = randomUUID(), wakeId = randomUUID(), leaseId = randomUUID();
    const finishedAt = new Date("2026-10-12T03:00:00Z");
    await db.insert(companies).values({ id: companyId, name: "Stuck lease", defaultResponsibleUserId: "owner",
      issuePrefix: `L${companyId.slice(0, 6)}` });
    await db.insert(agents).values({ id: agentId, companyId, name: "Mac Claude", role: "engineer",
      adapterType: "claude_local", status: "idle", runtimeConfig: { heartbeat: { maxConcurrentRuns: 1 } } });
    await db.insert(issues).values({ id: issueId, companyId, title: "TPS-123", status: "in_progress", assigneeAgentId: agentId });
    await db.insert(heartbeatRuns).values({ id: runId, companyId, agentId, runtimeMode: "legacy", status: "cancelled",
      contextSnapshot: { issueId }, startedAt: new Date("2026-10-12T02:59:00Z"), finishedAt,
      errorCode: launch === "never" ? "legacy_disposition_repair_suppressed" : "cancelled",
      ...(opts.stopRequested ? { resultJson: { executionCancellation: { state: "requested" } } } : {}),
      ...(launch === "process" ? { processPid: 4242, processStartedAt: new Date("2026-10-12T02:59:30Z") } : {}) });
    if (launch === "process") {
      await db.insert(heartbeatRunEvents).values({ companyId, runId, agentId, seq: 1, eventType: "adapter.invoke",
        stream: "system", level: "info", message: "adapter invocation", payload: { adapterType: "claude_local" } });
    }
    await db.insert(issueRecoveryActions).values({ companyId, sourceIssueId: issueId, kind: "active_run_watchdog",
      cause: "legacy_execution_requires_reconciliation", fingerprint: runId, status: "resolved", outcome: "blocked",
      nextAction: "Automatic recovery stopped.",
      evidence: { runId, automaticRecovery: { replay: "blocked", policy: "preserve_without_replay_v1" } } });
    const [environment] = opts.environment === false ? [null] : await db.insert(environments)
      .values({ name: `Mac ${leaseId}`, driver: "ssh" }).returning();
    await db.insert(environmentLeases).values({ id: leaseId, companyId, heartbeatRunId: runId, issueId,
      environmentId: environment?.id ?? null, status: opts.leaseStatus ?? "pending_cleanup",
      cleanupStatus: opts.leaseStatus === "active" ? null : "failed",
      releasedAt: opts.leaseStatus === "active" ? null : new Date("2026-10-12T03:01:00Z"),
      failureReason: opts.leaseStatus === "active" ? null : "orphaned_active_lease_recovered",
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
    return { companyId, agentId, issueId, runId, wakeId, leaseId, environment };
  }
  type Fixture = Awaited<ReturnType<typeof seed>>;

  const readLease = async (f: Fixture) => (await db.select().from(environmentLeases).where(eq(environmentLeases.id, f.leaseId)))[0];
  const readWake = async (f: Fixture) => (await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.id, f.wakeId)))[0];
  const readRun = async (f: Fixture) => (await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, f.runId)))[0];
  const activities = (f: Fixture, action: string) => db.select().from(activityLog).where(and(
    eq(activityLog.companyId, f.companyId), eq(activityLog.action, action)));

  /** Real stop logic and output parsing; only the SSH round trip is replaced. */
  function sshStop(answer: () => Promise<{ stdout: string }>) {
    return (input: RunLeaseReleasedInput, deps: Partial<RemoteStopDeps>) => stopRemoteRunOnRelease(input, {
      resolveSshConfig: async () => ({}) as never, runSsh: answer, ...deps,
    });
  }
  const verified = sshStop(async () => ({ stdout: "crew-stop matched=2 killed=0 remaining=0\n" }));
  const unreachable = sshStop(async () => { throw Object.assign(new Error("ssh: connect timed out"), { code: 255 }); });

  function heartbeatWith(stop: ReturnType<typeof sshStop>) {
    return heartbeatService(db, { environmentRuntime: {
      retryPendingSandboxTeardown: (input: { environment: Environment | null; lease: EnvironmentLease }) =>
        retrySshPendingTeardown(db, input, { stop }),
    } as unknown as HeartbeatEnvironmentRuntime });
  }

  // The sweep is global and the database is shared by the cases, so each case checks its own lease, not counters.

  /** Lets the next sweep run now, as if the stock cooldown had passed. */
  const cooldownPassed = (f: Fixture) => db.update(environmentLeases).set({
    metadata: sql`${environmentLeases.metadata} || '{"pendingCleanupRetryAfterMs": 0}'::jsonb`,
  }).where(eq(environmentLeases.id, f.leaseId));

  it("driver SSH có retryPendingSandboxTeardown: run chưa từng khởi chạy thì trả biên nhận, không cần SSH", async () => {
    const f = await seed("never", { environment: false });
    const lease = await readLease(f);
    const receipt = await environmentRuntimeService(db).retryPendingSandboxTeardown({
      environment: null, lease: lease as unknown as EnvironmentLease,
    });
    expect(receipt).toEqual({ providerLeaseId: lease.providerLeaseId, state: "stopped" });
  });

  it("vòng dọn gốc giải phóng lease SSH của run chưa khởi chạy (môi trường đã xoá) và đưa tin nhắn vào hàng đợi", async () => {
    const f = await seed("never", { environment: false });
    await heartbeatService(db).sweepPendingCleanupLeases();
    const lease = await readLease(f);
    expect(lease).toMatchObject({ status: "expired", cleanupStatus: "success", failureReason: "pending_cleanup_retry" });
    expect(hasRemoteTerminationReceipt(lease)).toBe(true);
    expect(lease.metadata).toMatchObject({ crewRemoteTermination: { proof: "never_started", source: "pending_cleanup_retry" } });
    expect(await readWake(f)).toMatchObject({ status: "coalesced", requestedByActorId: "owner" });
  });

  it("run đã chạy, Interrupt/Stop đang chờ: dừng xác minh thì nhả lease có biên nhận, xác nhận Stop và tiếp tục", async () => {
    const f = await seed("process", { stopRequested: true });
    await heartbeatWith(verified).sweepPendingCleanupLeases();
    const lease = await readLease(f);
    expect(hasRemoteTerminationReceipt(lease)).toBe(true);
    expect(lease.metadata).toMatchObject({ crewRemoteTermination: { proof: "remote_stop_verified", matched: 2, remaining: 0 } });
    expect((await readRun(f)).resultJson?.executionCancellation).toMatchObject({ state: "acknowledged" });
    expect(await getExecutionBlocker(db, f.companyId, f.issueId)).toBeNull();
    expect(await activities(f, "crew.remote_stop")).toEqual([expect.objectContaining({
      details: expect.objectContaining({ outcome: "stopped", source: "pending_cleanup_retry", attempt: 1 }) })]);
  });

  it("dừng chưa xác minh: lease vẫn chờ, ghi hoạt động từng lần, báo một lần khi tới ngưỡng, Mac về thì tự nhả", async () => {
    const f = await seed("process");
    const heartbeat = heartbeatWith(unreachable);
    for (let attempt = 1; attempt <= SSH_TEARDOWN_ESCALATION_ATTEMPTS + 1; attempt += 1) {
      await cooldownPassed(f);
      await heartbeat.sweepPendingCleanupLeases();
      const lease = await readLease(f);
      expect(lease.status).toBe("pending_cleanup");
      expect(hasRemoteTerminationReceipt(lease)).toBe(false);
    }
    expect(await activities(f, "crew.remote_stop")).toHaveLength(SSH_TEARDOWN_ESCALATION_ATTEMPTS - 1);
    const escalations = await activities(f, SSH_TEARDOWN_ESCALATED_ACTION);
    expect(escalations).toHaveLength(1);
    expect(escalations[0].details).toMatchObject({ leaseId: f.leaseId, attempt: SSH_TEARDOWN_ESCALATION_ATTEMPTS,
      outcome: "unreachable" });
    expect((await readWake(f)).status).toBe("deferred_issue_execution");

    await cooldownPassed(f);
    await heartbeatWith(verified).sweepPendingCleanupLeases();
    expect(hasRemoteTerminationReceipt(await readLease(f))).toBe(true);
    expect((await readWake(f)).status).toBe("coalesced");
  });

  it("lease đã kẹt từ trước (đủ số lần thử, đã cảnh báo) được nhả ở lần quét kế tiếp khi xác minh được", async () => {
    const f = await seed("process");
    await db.update(environmentLeases).set({ failureReason: "pending_cleanup_retry", metadata: sql`${environmentLeases.metadata}
      || ${JSON.stringify({ pendingCleanupRetryAttempts: 5, pendingCleanupRetryCapWarned: true, pendingCleanupInFlight: false,
        pendingCleanupRetryAfterMs: Date.now() - 1000 })}::jsonb` }).where(eq(environmentLeases.id, f.leaseId));
    await heartbeatWith(verified).sweepPendingCleanupLeases();
    expect(await readLease(f)).toMatchObject({ status: "expired", cleanupStatus: "success" });
    expect((await readWake(f)).status).toBe("coalesced");
  });

  it("Stop với run legacy trên SSH: Stop được xác nhận sau khi biên nhận dừng ghi xong", async () => {
    const f = await seed("process", { leaseStatus: "active", stopRequested: true });
    const stop: RemoteStopResult = { outcome: "stopped", matched: 1, killed: 0, remaining: 0 };
    restoreHooks = overrideCrewCoreHooksForTests({
      onRunLeaseReleased: (input) => startRemoteStopOnRelease(input, async () => stop),
    });
    await heartbeatService(db).releaseEnvironmentLeasesForRun({ runId: f.runId, companyId: f.companyId,
      agentId: f.agentId, status: "cancelled" });
    await settleRemoteStopsForTests();
    expect(hasRemoteTerminationReceipt(await readLease(f))).toBe(true);
    expect((await readRun(f)).resultJson).toMatchObject({
      executionCancellation: { state: "acknowledged", proof: "provider_termination_receipt" },
      conversationContinuation: "continue_conversation_v1",
    });
    expect(await getExecutionBlocker(db, f.companyId, f.issueId)).toBeNull();
    expect((await readWake(f)).status).toBe("coalesced");
  });
});

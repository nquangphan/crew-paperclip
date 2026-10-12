import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import {
  activityLog, agentWakeupRequests, agents, companies, createDb, environmentLeases, environments, heartbeatRuns, issues,
} from "@paperclipai/db";
import type { Environment, EnvironmentLease } from "@paperclipai/shared";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { overrideCrewCoreHooksForTests } from "../crew/core-hooks.ts";
import { HANDOFF_REWAKE_SWEEP_MIN_AGE_MS, replayStrandedSkippedWakes } from "../crew/handoff-rewake.ts";
import {
  settleRemoteStopsForTests, startRemoteStopOnRelease, stopRemoteRunOnRelease, type RemoteStopDeps,
  type RunLeaseReleasedInput,
} from "../crew/remote-stop.ts";
import { retrySshPendingTeardown } from "../crew/ssh-pending-teardown.ts";
import { heartbeatService, type HeartbeatEnvironmentRuntime } from "../services/heartbeat.js";
import { hasRemoteTerminationReceipt } from "../services/remote-execution-termination.js";

// TPS-133: the executor hands the issue to the reviewer; the route cancels the executor's run and wakes the reviewer,
// whose wake is skipped (execution_reconciliation_required) because the run's SSH lease is still active. The lease is
// older than the reaper's 5-minute staleness, so the reaper tick moves it to pending_cleanup (orphaned active lease of
// a terminal run) and the pending-cleanup sweep releases it through the SSH retry (P8) before executeRun unwinds. The
// executor's own release then finds no active lease, the SSH driver's release hook (H3) never runs, and the replay that
// hangs off it never happens. Stock review recovery only retries a reviewer whose run ended, and this reviewer never ran.
const execute = vi.hoisted(() => vi.fn());
vi.mock("../adapters/index.js", async () => {
  const actual = await vi.importActual<typeof import("../adapters/index.js")>("../adapters/index.js");
  return { ...actual, getServerAdapter: vi.fn(() => ({ supportsLocalAgentJwt: false, execute })) };
});
const support = await getEmbeddedPostgresTestSupport();

(support.supported ? describe : describe.skip)("phát lại wake reviewer bị bỏ khi lease nhả ngoài hook H3", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  let restoreHooks: (() => void) | null = null;
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("crew-handoff-rewake-sweep-");
    db = createDb(database.connectionString);
  }, 60_000);
  afterEach(async () => {
    await settleRemoteStopsForTests();
    restoreHooks?.();
    restoreHooks = null;
    execute.mockReset();
  });
  afterAll(async () => {
    await db?.$client.end({ timeout: 0 });
    await database?.cleanup();
  });

  const STAGE_ID = randomUUID();

  /** Issue already handed to the reviewer (in_review, review stage pending); executor run cancelled, lease active. */
  async function seed() {
    const companyId = randomUUID(), executorId = randomUUID(), reviewerId = randomUUID();
    const issueId = randomUUID(), runId = randomUUID(), leaseId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Crew review", defaultResponsibleUserId: "owner",
      issuePrefix: `R${companyId.replace(/-/g, "").slice(0, 5).toUpperCase()}` });
    for (const [id, name] of [[executorId, "Executor"], [reviewerId, "Reviewer"]] as const) {
      await db.insert(agents).values({ id, companyId, name: `${name} ${id.slice(0, 6)}`, role: "engineer", status: "idle",
        adapterType: "claude_local", adapterConfig: {}, permissions: {},
        runtimeConfig: { heartbeat: { enabled: false, wakeOnDemand: true, maxConcurrentRuns: 1 } } });
    }
    const participant = { type: "agent", userId: null, agentId: reviewerId };
    await db.insert(issues).values({ id: issueId, companyId, title: "TPS-133", status: "in_review", assigneeAgentId: reviewerId,
      responsibleUserId: "owner", executionState: {
        status: "pending", monitor: null, reviewRequest: null, currentStageId: STAGE_ID, currentStageIndex: 0,
        currentStageType: "review", currentParticipant: participant, lastDecisionId: null, lastDecisionOutcome: null,
        completedStageIds: [], changesRequestedCount: 0,
        returnAssignee: { type: "agent", userId: null, agentId: executorId },
      } });
    const [environment] = await db.insert(environments).values({ name: `Mac ${leaseId}`, driver: "ssh", status: "active",
      config: { host: "mac.example.test", port: 22, username: "agent", remoteWorkspacePath: "/Users/a/crew-agents" } }).returning();
    // Started 6 minutes ago and just cancelled by the handoff ("Cancelled before issue reassignment").
    const acquiredAt = new Date(Date.now() - 6 * 60_000);
    await db.insert(heartbeatRuns).values({ id: runId, companyId, agentId: executorId, runtimeMode: "legacy",
      status: "cancelled", invocationSource: "assignment", responsibleUserId: "owner", contextSnapshot: { issueId },
      startedAt: acquiredAt, finishedAt: new Date(), errorCode: "issue_reassigned", error: "Cancelled before issue reassignment",
      runnerProfileJson: { adapterDispatch: { adapterType: "claude_local" } },
      resultJson: { executionCancellation: { state: "acknowledged", acknowledgedAt: new Date().toISOString() } } });
    await db.insert(environmentLeases).values({ id: leaseId, companyId, environmentId: environment!.id, issueId,
      heartbeatRunId: runId, status: "active", leasePolicy: "ephemeral", provider: "ssh",
      providerLeaseId: `ssh://agent@mac.example.test:22/Users/a/crew-agents/${leaseId}`,
      metadata: { driver: "ssh", remoteCwd: "/Users/a/crew-agents/w1" }, createdAt: acquiredAt, updatedAt: acquiredAt });
    restoreHooks = overrideCrewCoreHooksForTests({
      // Keep replayed runs queued: no adapter is launched.
      beforeClaim: async () => true,
      onRunLeaseReleased: (input) => startRemoteStopOnRelease(input, async () => ({ outcome: "stopped", matched: 1, killed: 0, remaining: 0 })),
    });
    return { companyId, executorId, reviewerId, issueId, runId, leaseId, environment: environment! };
  }
  type Fixture = Awaited<ReturnType<typeof seed>>;

  /** The reviewer wake the route sends at the handoff (buildExecutionStageWakeup). */
  function reviewWake(f: Fixture) {
    const executionStage = { stageId: STAGE_ID, wakeRole: "reviewer", stageType: "review", allowedActions: ["approve", "request_changes"],
      currentParticipant: { type: "agent", userId: null, agentId: f.reviewerId } };
    return {
      source: "assignment" as const, triggerDetail: "system" as const, reason: "execution_review_requested",
      payload: { issueId: f.issueId, mutation: "update", executionStage, interruptedRunId: f.runId },
      requestedByActorType: "agent" as const, requestedByActorId: f.executorId,
      contextSnapshot: { issueId: f.issueId, taskId: f.issueId, wakeReason: "execution_review_requested",
        source: "issue.execution_stage", executionStage },
    };
  }

  /** Real stop logic; only the SSH round trip is replaced by a host that confirms no process is left. */
  const verifiedStop = (input: RunLeaseReleasedInput, deps: Partial<RemoteStopDeps>) => stopRemoteRunOnRelease(input, {
    resolveSshConfig: async () => ({}) as never, runSsh: async () => ({ stdout: "crew-stop matched=1 killed=0 remaining=0\n" }), ...deps,
  });
  const heartbeatWithSsh = () => heartbeatService(db, { environmentRuntime: {
    retryPendingSandboxTeardown: (input: { environment: Environment | null; lease: EnvironmentLease }) =>
      retrySshPendingTeardown(db, input, { stop: verifiedStop }),
  } as unknown as HeartbeatEnvironmentRuntime });

  const reviewerRuns = (f: Fixture) => db.select().from(heartbeatRuns).where(eq(heartbeatRuns.agentId, f.reviewerId));
  const reviewerWakes = (f: Fixture) => db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.agentId, f.reviewerId));
  const readLease = async (f: Fixture) => (await db.select().from(environmentLeases).where(eq(environmentLeases.id, f.leaseId)))[0]!;
  const actions = (f: Fixture, action: string) => db.select().from(activityLog).where(and(
    eq(activityLog.companyId, f.companyId), eq(activityLog.action, action)));
  /** Moves the skipped wake past the sweep's minimum age (the H3 replay normally settles it within seconds). */
  const ageSkippedWake = (f: Fixture, ms = HANDOFF_REWAKE_SWEEP_MIN_AGE_MS + 1_000) => db.update(agentWakeupRequests)
    .set({ createdAt: sql`now() - ${`${ms} milliseconds`}::interval` })
    .where(and(eq(agentWakeupRequests.agentId, f.reviewerId), eq(agentWakeupRequests.status, "skipped")));

  /** Handoff wake, then the reaper tick that releases the lease, then the executor unwinding. */
  async function tps133Sequence(f: Fixture) {
    expect(await heartbeatService(db).wakeup(f.reviewerId, reviewWake(f))).toBeNull();
    const [skipped] = await reviewerWakes(f);
    expect(skipped).toMatchObject({ status: "skipped", reason: "execution_reconciliation_required" });
    expect(skipped!.error).toMatch(/has not released its environment lease/);
    expect(skipped!.payload).toMatchObject({ executionWait: { reason: "execution_recovery", recoveryActionId: null } });

    // Reaper tick: orphaned active lease of a terminal run -> pending_cleanup -> SSH retry -> released with a receipt.
    await heartbeatWithSsh().reapOrphanedRuns({ staleThresholdMs: 5 * 60_000 });
    const lease = await readLease(f);
    expect(lease).toMatchObject({ status: "expired", cleanupStatus: "success", failureReason: "pending_cleanup_retry" });
    expect(hasRemoteTerminationReceipt(lease)).toBe(true);

    // executeRun unwinds: its release finds no active lease, so the SSH driver's release hook (H3) never runs.
    await heartbeatService(db).releaseEnvironmentLeasesForRun({ runId: f.runId, companyId: f.companyId,
      agentId: f.executorId, status: "cancelled" });
    await settleRemoteStopsForTests();
    expect(await actions(f, "crew.remote_stop.started")).toHaveLength(0);
    expect(await actions(f, "crew.handoff_rewake")).toHaveLength(0);
    return skipped!;
  }

  it("TPS-133: lease nhả bởi vòng quét lease mồ côi, stock không cứu; vòng quét Crew đánh thức reviewer đúng một lần", async () => {
    const f = await seed();
    const skipped = await tps133Sequence(f);

    // Stock review recovery skips a pending review stage whose participant never had a run.
    await heartbeatService(db).reconcileStrandedAssignedIssues();
    expect(await reviewerRuns(f)).toHaveLength(0);

    // Too fresh: left to the H3 replay.
    expect(await replayStrandedSkippedWakes(db)).toBe(0);
    expect(await reviewerRuns(f)).toHaveLength(0);

    await ageSkippedWake(f);
    expect(await replayStrandedSkippedWakes(db)).toBe(1);
    const runs = await reviewerRuns(f);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.contextSnapshot).toMatchObject({
      issueId: f.issueId, wakeReason: "execution_review_requested",
      executionStage: { wakeRole: "reviewer", stageId: STAGE_ID },
      crewHandoffRewake: { skippedWakeId: skipped.id, previousRunId: null, source: "sweep" },
    });
    expect(await actions(f, "crew.handoff_rewake")).toEqual([
      expect.objectContaining({ entityId: skipped.id, details: expect.objectContaining({ source: "sweep" }) }),
    ]);

    // Next scheduler tick: nothing more.
    expect(await replayStrandedSkippedWakes(db)).toBe(0);
    expect(await reviewerRuns(f)).toHaveLength(1);
  }, 60_000);

  it("issue đã kẹt nhiều giờ (lease đã nhả từ lâu) được cứu ở tick đầu tiên sau khi deploy", async () => {
    const f = await seed();
    await tps133Sequence(f);
    await ageSkippedWake(f, 6 * 60 * 60_000);
    expect(await replayStrandedSkippedWakes(db)).toBe(1);
    expect(await reviewerRuns(f)).toHaveLength(1);
  }, 60_000);

  it("không phát lại khi lease vẫn còn giữ (chưa có biên nhận dừng)", async () => {
    const f = await seed();
    expect(await heartbeatService(db).wakeup(f.reviewerId, reviewWake(f))).toBeNull();
    await ageSkippedWake(f);
    await replayStrandedSkippedWakes(db);
    expect(await reviewerRuns(f)).toHaveLength(0);
    await db.update(environmentLeases).set({ status: "pending_cleanup", cleanupStatus: "failed", releasedAt: new Date() })
      .where(eq(environmentLeases.id, f.leaseId));
    await replayStrandedSkippedWakes(db);
    expect(await reviewerRuns(f)).toHaveLength(0);
  }, 60_000);

  it("không phát lại khi stage đã đổi, issue bị chặn, hoặc reviewer đã có run sau đó", async () => {
    const stageMoved = await seed();
    await tps133Sequence(stageMoved);
    await ageSkippedWake(stageMoved);
    await db.update(issues).set({ executionState: sql`jsonb_set(${issues.executionState}, '{currentStageId}', ${JSON.stringify(randomUUID())}::jsonb)` })
      .where(eq(issues.id, stageMoved.issueId));

    const blocked = await seed();
    await tps133Sequence(blocked);
    await ageSkippedWake(blocked);
    await db.update(issues).set({ status: "blocked" }).where(eq(issues.id, blocked.issueId));

    const ranLater = await seed();
    await tps133Sequence(ranLater);
    await ageSkippedWake(ranLater);
    await db.insert(heartbeatRuns).values({ companyId: ranLater.companyId, agentId: ranLater.reviewerId, status: "succeeded",
      contextSnapshot: { issueId: ranLater.issueId }, finishedAt: new Date() });

    // The sweep is global and the database is shared by the cases, so each case checks its own reviewer.
    await replayStrandedSkippedWakes(db);
    expect(await reviewerRuns(stageMoved)).toHaveLength(0);
    expect(await reviewerRuns(blocked)).toHaveLength(0);
    expect(await reviewerRuns(ranLater)).toHaveLength(1);
  }, 60_000);

  it("không phát lại wake bị bỏ vì một recovery action (luồng recovery của stock sở hữu nó)", async () => {
    const f = await seed();
    await tps133Sequence(f);
    await ageSkippedWake(f);
    await db.update(agentWakeupRequests).set({
      payload: sql`jsonb_set(${agentWakeupRequests.payload}, '{executionWait,recoveryActionId}', ${JSON.stringify(randomUUID())}::jsonb)`,
    }).where(and(eq(agentWakeupRequests.agentId, f.reviewerId), eq(agentWakeupRequests.status, "skipped")));
    await replayStrandedSkippedWakes(db);
    expect(await reviewerRuns(f)).toHaveLength(0);
  }, 60_000);
});

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import {
  activityLog, agentWakeupRequests, agents, companies, createDb, heartbeatRunEvents, heartbeatRuns, issueRecoveryActions,
  issueRelations, issues,
} from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { overrideCrewCoreHooksForTests } from "../crew/core-hooks.ts";
import {
  HANDOFF_REWAKE_SWEEP_MIN_AGE_MS, RECOVERY_HOLD_RELEASED_ACTION, replayStrandedSkippedWakes,
} from "../crew/handoff-rewake.ts";
import { heartbeatService } from "../services/heartbeat.js";
import { settleUnrecoverableExecutions } from "../services/execution-recovery-resolution.js";
import { getExecutionBlocker } from "../services/execution-blocker.js";
import { terminalizeLegacyExecution } from "../services/legacy-execution-recovery.js";

// TPS-508 (27/10): the Assistant's on-demand run on the root ends while the root is still `todo`. Stock disposition
// repair makes every child a blocker of the root, moves the root to `blocked`, and queues a repair run. That run is
// suppressed inside the dispatch gate ("recorded_disposition") before the adapter is called, but its cancellation is
// recorded as a legacy execution needing reconciliation; the automatic disposition then settles it as a permanent
// no-replay hold. When the last child is done, stock's dependency wake for the Assistant is skipped
// (`execution_reconciliation_required`, held by that recovery action) and nothing wakes the root again.
const execute = vi.hoisted(() => vi.fn());
vi.mock("../adapters/index.js", async () => {
  const actual = await vi.importActual<typeof import("../adapters/index.js")>("../adapters/index.js");
  return { ...actual, getServerAdapter: vi.fn(() => ({ supportsLocalAgentJwt: false, execute })) };
});
const support = await getEmbeddedPostgresTestSupport();

(support.supported ? describe : describe.skip)("đánh thức lại issue gốc bị giữ bởi run sửa disposition chưa từng chạy", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  let restoreHooks: (() => void) | null = null;
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("crew-handoff-rewake-blocked-root-");
    db = createDb(database.connectionString);
  }, 60_000);
  afterEach(() => {
    restoreHooks?.();
    restoreHooks = null;
    execute.mockReset();
  });
  afterAll(async () => {
    await db?.$client.end({ timeout: 0 });
    await database?.cleanup();
  });

  /** Root blocked by its children (as disposition repair leaves it); the repair run suppressed before dispatch. */
  async function seed(opts: { childCount?: number; errorCode?: string } = {}) {
    const companyId = randomUUID(), assistantId = randomUUID(), executorId = randomUUID();
    const rootId = randomUUID(), repairRunId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Crew root", defaultResponsibleUserId: "owner",
      issuePrefix: `B${companyId.replace(/-/g, "").slice(0, 5).toUpperCase()}` });
    for (const [id, name] of [[assistantId, "Assistant"], [executorId, "Executor"]] as const) {
      await db.insert(agents).values({ id, companyId, name: `${name} ${id.slice(0, 6)}`, role: "engineer", status: "idle",
        adapterType: "claude_local", adapterConfig: {}, permissions: {},
        runtimeConfig: { heartbeat: { enabled: false, wakeOnDemand: true, maxConcurrentRuns: 1 } } });
    }
    const blockedAt = new Date(Date.now() - 5 * 60 * 60_000);
    await db.insert(issues).values({ id: rootId, companyId, title: "TPS-508", status: "blocked", assigneeAgentId: assistantId,
      responsibleUserId: "owner", blockedTransitionAt: blockedAt });
    const childIds: string[] = [];
    for (let i = 0; i < (opts.childCount ?? 2); i += 1) {
      const childId = randomUUID();
      childIds.push(childId);
      await db.insert(issues).values({ id: childId, companyId, title: `Việc con ${i + 1}`, status: "in_progress",
        parentId: rootId, assigneeAgentId: executorId, responsibleUserId: "owner" });
      await db.insert(issueRelations).values({ companyId, issueId: childId, relatedIssueId: rootId, type: "blocks" });
    }
    // The repair run was claimed (`running`, started) and then cancelled by the dispatch gate.
    const startedAt = new Date(Date.now() - 5 * 60 * 60_000);
    const [repairRun] = await db.insert(heartbeatRuns).values({ id: repairRunId, companyId, agentId: assistantId,
      runtimeMode: "legacy", status: "running", invocationSource: "automation", responsibleUserId: "owner",
      contextSnapshot: { issueId: rootId, wakeReason: "issue_disposition_repair" }, createdAt: startedAt, startedAt,
      runnerProfileJson: { adapterDispatch: { adapterType: "claude_local" } } }).returning();
    // Same write as the stock suppression (`setRunStatusIfRunning` routes a legacy run needing reconciliation here).
    await terminalizeLegacyExecution({ db, run: repairRun!, status: "cancelled", fromStatuses: ["running"], patch: {
      finishedAt: new Date(startedAt.getTime() + 6_000), errorCode: opts.errorCode ?? "legacy_disposition_repair_suppressed",
      error: "Disposition repair suppressed: recorded_disposition",
    } });
    restoreHooks = overrideCrewCoreHooksForTests({ beforeClaim: async () => true });
    return { companyId, assistantId, executorId, rootId, childIds, repairRunId };
  }
  type Fixture = Awaited<ReturnType<typeof seed>>;

  const holdOf = async (f: Fixture) => (await db.select().from(issueRecoveryActions)
    .where(eq(issueRecoveryActions.sourceIssueId, f.rootId)))[0]!;
  const assistantRuns = (f: Fixture) => db.select().from(heartbeatRuns).where(and(
    eq(heartbeatRuns.agentId, f.assistantId), sql`${heartbeatRuns.id} <> ${f.repairRunId}`));
  const assistantWakes = (f: Fixture) => db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.agentId, f.assistantId));
  const actions = (f: Fixture, action: string) => db.select().from(activityLog).where(and(
    eq(activityLog.companyId, f.companyId), eq(activityLog.action, action)));
  const finishChildren = (f: Fixture, ids = f.childIds) => db.update(issues).set({ status: "done", completedAt: new Date() })
    .where(sql`${issues.id} in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})`);
  const ageSkips = (f: Fixture) => db.update(agentWakeupRequests)
    .set({ createdAt: sql`now() - ${`${HANDOFF_REWAKE_SWEEP_MIN_AGE_MS + 1_000} milliseconds`}::interval` })
    .where(and(eq(agentWakeupRequests.agentId, f.assistantId), eq(agentWakeupRequests.status, "skipped")));

  /** Stock settles the hold as permanent, then skips the dependency wake once the children are done. */
  async function strandRoot(f: Fixture) {
    await settleUnrecoverableExecutions(db);
    expect(await holdOf(f)).toMatchObject({ status: "resolved", outcome: "blocked",
      evidence: expect.objectContaining({ automaticRecovery: expect.objectContaining({ replay: "blocked" }) }) });
    await finishChildren(f);
    await heartbeatService(db).reconcileResolvedDependencyWakes({ companyId: f.companyId });
    const wakes = await assistantWakes(f);
    expect(wakes).toEqual([expect.objectContaining({ status: "skipped", reason: "execution_reconciliation_required" })]);
    expect(wakes[0]!.payload).toMatchObject({ executionWait: { recoveryActionId: (await holdOf(f)).id } });
    expect(await assistantRuns(f)).toHaveLength(0);
    await ageSkips(f);
    return wakes[0]!;
  }

  it("TPS-508: mọi việc con xong mà Trợ Lý bị bỏ qua; vòng quét gỡ giữ chỗ và đánh thức Trợ Lý đúng một lần", async () => {
    const f = await seed();
    const skipped = await strandRoot(f);

    expect(await replayStrandedSkippedWakes(db)).toBe(1);

    const hold = await holdOf(f);
    expect(hold).toMatchObject({ status: "resolved", outcome: "false_positive" });
    expect(hold.evidence).toMatchObject({ automaticRecovery: { replay: "allowed" },
      crewRecoveryHoldRelease: { runId: f.repairRunId, proof: "never_started" } });
    expect(await getExecutionBlocker(db, f.companyId, f.rootId)).toBeNull();
    expect(await actions(f, RECOVERY_HOLD_RELEASED_ACTION)).toEqual([expect.objectContaining({
      entityType: "issue", entityId: f.rootId,
      details: expect.objectContaining({ recoveryActionId: hold.id, runId: f.repairRunId }),
    })]);

    const runs = await assistantRuns(f);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.contextSnapshot).toMatchObject({ issueId: f.rootId, wakeReason: "issue_blockers_resolved",
      crewHandoffRewake: { skippedWakeId: skipped.id, source: "sweep" } });
    expect(await actions(f, "crew.handoff_rewake")).toHaveLength(1);

    // Next ticks: neither the sweep nor the stock dependency backstop wakes the Assistant again.
    expect(await replayStrandedSkippedWakes(db)).toBe(0);
    await heartbeatService(db).reconcileResolvedDependencyWakes({ companyId: f.companyId });
    expect(await assistantRuns(f)).toHaveLength(1);
    expect(await actions(f, RECOVERY_HOLD_RELEASED_ACTION)).toHaveLength(1);
  }, 60_000);

  it("gỡ giữ chỗ ngay khi việc con còn chạy, để stock tự đánh thức Trợ Lý khi việc con cuối xong", async () => {
    const f = await seed();
    await settleUnrecoverableExecutions(db);
    expect(await replayStrandedSkippedWakes(db)).toBe(0);
    expect(await holdOf(f)).toMatchObject({ outcome: "false_positive" });
    expect(await assistantRuns(f)).toHaveLength(0);

    // Stock periodic checks must not put the hold back on the suppressed run.
    await heartbeatService(db).reconcileStrandedAssignedIssues();
    await settleUnrecoverableExecutions(db);
    expect(await getExecutionBlocker(db, f.companyId, f.rootId)).toBeNull();

    await finishChildren(f);
    await heartbeatService(db).reconcileResolvedDependencyWakes({ companyId: f.companyId });
    const runs = await assistantRuns(f);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.contextSnapshot).toMatchObject({ wakeReason: "issue_blockers_resolved" });
  }, 60_000);

  it("issue gốc còn chờ việc con thật: gỡ giữ chỗ nhưng không đánh thức", async () => {
    const f = await seed();
    await settleUnrecoverableExecutions(db);
    await finishChildren(f, [f.childIds[0]!]);
    // A wake stock skipped while one child is still open (not a dependency-ready state).
    await heartbeatService(db).wakeup(f.assistantId, { source: "automation", triggerDetail: "system",
      reason: "issue_children_completed", payload: { issueId: f.rootId, completedChildIssueId: f.childIds[0] },
      requestedByActorType: "system", contextSnapshot: { issueId: f.rootId, wakeReason: "issue_children_completed" } });
    expect(await assistantWakes(f)).toEqual([expect.objectContaining({ status: "skipped" })]);
    await ageSkips(f);

    await replayStrandedSkippedWakes(db);
    expect(await holdOf(f)).toMatchObject({ outcome: "false_positive" });
    expect(await assistantRuns(f)).toHaveLength(0);
    expect(await actions(f, "crew.handoff_rewake")).toHaveLength(0);
  }, 60_000);

  it("không gỡ giữ chỗ khi run nguồn đã gọi adapter, hoặc bị hủy vì lý do khác", async () => {
    const invoked = await seed();
    await db.insert(heartbeatRunEvents).values({ companyId: invoked.companyId, runId: invoked.repairRunId,
      agentId: invoked.assistantId, seq: 100, eventType: "adapter.invoke", stream: "system", level: "info", message: "invoke" });
    const otherCause = await seed({ errorCode: "issue_reassigned" });
    await strandRoot(invoked);
    await strandRoot(otherCause);

    await replayStrandedSkippedWakes(db);
    for (const f of [invoked, otherCause]) {
      expect(await holdOf(f)).toMatchObject({ outcome: "blocked" });
      expect(await getExecutionBlocker(db, f.companyId, f.rootId)).not.toBeNull();
      expect(await assistantRuns(f)).toHaveLength(0);
      expect(await actions(f, RECOVERY_HOLD_RELEASED_ACTION)).toHaveLength(0);
    }
  }, 60_000);

  it("không đánh thức khi owner chặn issue gốc bằng tay (không còn blocker nào)", async () => {
    const f = await seed();
    const skipped = await strandRoot(f);
    await db.delete(issueRelations).where(eq(issueRelations.relatedIssueId, f.rootId));
    await replayStrandedSkippedWakes(db);
    expect(await holdOf(f)).toMatchObject({ outcome: "false_positive" });
    expect(await assistantRuns(f)).toHaveLength(0);
    expect(skipped.status).toBe("skipped");
  }, 60_000);
});

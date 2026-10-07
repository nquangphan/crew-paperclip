import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { activityLog, agentWakeupRequests, agents, companies, createDb, heartbeatRuns, issueRecoveryActions, issues } from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { overrideCrewCoreHooksForTests } from "../crew/core-hooks.ts";
import { defaultBeforeClaimDeps, evaluateBeforeClaim } from "../crew/load-gate.ts";
import { getExecutionBlocker } from "../services/execution-blocker.js";
import { heartbeatService } from "../services/heartbeat.js";

// A run the load gate holds never starts provider work. When the gate gives up and cancels it, stock
// must not treat it as an attempt whose outcome needs reconciliation: for a retry whose budget is spent
// (two failed retries before it) that hold would skip every later wake of the issue.
const execute = vi.hoisted(() => vi.fn());
vi.mock("../adapters/index.js", async () => {
  const actual = await vi.importActual<typeof import("../adapters/index.js")>("../adapters/index.js");
  return { ...actual, getServerAdapter: vi.fn(() => ({ supportsLocalAgentJwt: false, execute })) };
});
const support = await getEmbeddedPostgresTestSupport();
const suite = support.supported ? describe : describe.skip;

suite("cổng tải hủy run đã chờ quá hạn", () => {
  let db: ReturnType<typeof createDb>;
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let restore: (() => void) | null = null;

  beforeAll(async () => {
    temporary = await startEmbeddedPostgresTestDatabase("crew-load-gate-cancel-");
    db = createDb(temporary.connectionString);
  }, 60_000);
  afterEach(() => {
    restore?.();
    restore = null;
    execute.mockReset();
  });
  afterAll(async () => {
    await db?.$client.end({ timeout: 0 });
    await temporary?.cleanup();
  });

  /** Queued run created by a stock wake, then shaped as the gate saw it (e.g. the third attempt). */
  async function heldRun(adapterType: string, runFields: Partial<typeof heartbeatRuns.$inferInsert>) {
    const companyId = randomUUID(), agentId = randomUUID(), issueId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Crew gate cancel",
      issuePrefix: `C${companyId.replace(/-/g, "").slice(0, 5).toUpperCase()}`,
      defaultResponsibleUserId: "owner",
    });
    await db.insert(agents).values({
      id: agentId, companyId, name: `Worker ${agentId.slice(0, 6)}`, role: "engineer", status: "idle", adapterType,
      adapterConfig: {}, permissions: {}, runtimeConfig: { heartbeat: { enabled: false, wakeOnDemand: true, maxConcurrentRuns: 1 } },
    });
    await db.insert(issues).values({ id: issueId, companyId, title: "Gate task", status: "todo", assigneeAgentId: agentId, responsibleUserId: "owner" });
    restore = overrideCrewCoreHooksForTests({ beforeClaim: async () => true });
    const run = await heartbeatService(db).wakeup(agentId, {
      source: "assignment", triggerDetail: "system", reason: "issue_assigned",
      payload: { issueId }, contextSnapshot: { issueId, wakeReason: "issue_assigned" },
    });
    if (!run) throw new Error("wake did not create a run");
    const { contextSnapshot, ...fields } = runFields;
    if (contextSnapshot) {
      await db.update(heartbeatRuns).set({ contextSnapshot: { ...(run.contextSnapshot ?? {}), ...contextSnapshot } }).where(eq(heartbeatRuns.id, run.id));
    }
    if (Object.keys(fields).length > 0) await db.update(heartbeatRuns).set(fields).where(eq(heartbeatRuns.id, run.id));
    return { companyId, agentId, issueId, runId: run.id };
  }

  /** Lets the real gate expire the run (Mac unreachable for two hours) and waits for the cancel. */
  async function expireThroughGate(runId: string) {
    restore?.();
    restore = overrideCrewCoreHooksForTests({
      beforeClaim: (input) =>
        evaluateBeforeClaim(input, {
          ...defaultBeforeClaimDeps(input.db),
          loadTarget: async () => ({ environmentId: "env-1", environmentName: "mac-mini", settings: { maxLoad1: 8, maxWaitMinutes: 60 } }),
          probeHost: async () => ({ ok: false, error: "Connection timed out during banner exchange" }),
          firstNoticeAt: async (_runId, kind) => (kind === "waiting" ? new Date(Date.now() - 2 * 60 * 60_000) : null),
        }),
    });
    const heartbeat = heartbeatService(db);
    await heartbeat.resumeQueuedRuns();
    await vi.waitFor(async () => expect((await heartbeat.getRun(runId))?.status).toBe("cancelled"), { timeout: 5_000 });
    restore();
    restore = overrideCrewCoreHooksForTests({ beforeClaim: async () => true });
    return heartbeat.getRun(runId);
  }

  async function wakeAgain(f: { agentId: string; issueId: string }) {
    await db.update(issues).set({ status: "todo" }).where(eq(issues.id, f.issueId));
    return heartbeatService(db).wakeup(f.agentId, {
      source: "assignment", triggerDetail: "system", reason: "issue_assigned",
      payload: { issueId: f.issueId }, contextSnapshot: { issueId: f.issueId, wakeReason: "issue_assigned" },
    });
  }

  /** One tick of the real gate while the Mac is unreachable (waiting, not expired). */
  async function holdThroughGate(runId: string) {
    restore?.();
    restore = overrideCrewCoreHooksForTests({
      beforeClaim: (input) =>
        evaluateBeforeClaim(input, {
          ...defaultBeforeClaimDeps(input.db),
          loadTarget: async () => ({ environmentId: "env-1", environmentName: "mac-mini", settings: { maxLoad1: 8, maxWaitMinutes: 60 } }),
          probeHost: async () => ({ ok: false, error: "Connection timed out during banner exchange" }),
        }),
    });
    const heartbeat = heartbeatService(db);
    await heartbeat.resumeQueuedRuns();
    expect((await heartbeat.getRun(runId))?.status).toBe("queued");
    restore();
    restore = overrideCrewCoreHooksForTests({ beforeClaim: async () => true });
  }

  /** One tick of the real gate with the Mac healthy, through the real claimQueuedRun. */
  async function claimThroughGate() {
    restore?.();
    restore = overrideCrewCoreHooksForTests({
      beforeClaim: (input) =>
        evaluateBeforeClaim(input, {
          ...defaultBeforeClaimDeps(input.db),
          loadTarget: async () => ({ environmentId: "env-1", environmentName: "mac-mini", settings: { maxLoad1: 8, maxWaitMinutes: 60 } }),
          probeHost: async () => ({ ok: true, load1: 1 }),
        }),
    });
    const heartbeat = heartbeatService(db);
    await heartbeat.resumeQueuedRuns();
    await heartbeat.drainActiveRunExecutions();
    restore();
    restore = overrideCrewCoreHooksForTests({ beforeClaim: async () => true });
  }

  it("issue chuyển sang chờ review trong lúc cổng giữ run: stale gate stock hủy ở lần claim, recovery không sinh hold, đánh thức sau vẫn tạo run", async () => {
    // A continuation run of the executor; its summary says to wait for the reviewer.
    const f = await heldRun("claude_local", {
      contextSnapshot: {
        wakeReason: "issue_continuation_needed",
        paperclipContinuationSummary: { body: "## Next Action\n\n- Wait for reviewer feedback before more work starts." },
      },
    });
    await holdThroughGate(f.runId);
    // While the Mac is busy the issue moves on: the executor's work is now waiting on review.
    await db.update(issues).set({ status: "in_progress" }).where(eq(issues.id, f.issueId));
    await claimThroughGate();

    const [cancelled] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, f.runId));
    expect(cancelled).toMatchObject({ status: "cancelled", errorCode: "issue_continuation_waiting_on_review", startedAt: null });
    expect(cancelled?.resultJson).toMatchObject({
      timeoutSource: "stale_queued_run_gate",
      executionRecovery: { kind: "bootstrap", providerWorkStarted: false },
    });
    expect(execute.mock.calls.filter(([context]) => context.runId === f.runId)).toHaveLength(0);

    await heartbeatService(db).reconcileStrandedAssignedIssues();

    const actions = await db.select().from(issueRecoveryActions).where(eq(issueRecoveryActions.sourceIssueId, f.issueId));
    expect(actions.filter((a) => a.cause === "legacy_execution_requires_reconciliation")).toEqual([]);
    expect(await getExecutionBlocker(db, f.companyId, f.issueId)).toBeNull();
    expect(await wakeAgain(f)).not.toBeNull();
  }, 30_000);

  it("hai lần đánh giá song song: lần cho claim xóa dấu trong DB dù bản run của nó chưa thấy dấu", async () => {
    const f = await heldRun("claude_local", {});
    const [snapshot] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, f.runId));
    const gate = (probe: { ok: true; load1: number } | { ok: false; error: string }) => ({
      ...defaultBeforeClaimDeps(db),
      loadTarget: async () => ({ environmentId: "env-1", environmentName: "mac-mini", settings: { maxLoad1: 8, maxWaitMinutes: 60 } }),
      probeHost: async () => probe,
    });
    // A holds the run and commits the marker; B read the run before that and lets it be claimed.
    expect(await evaluateBeforeClaim({ db, run: snapshot! }, gate({ ok: false, error: "timeout" }))).toBe(true);
    const [marked] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, f.runId));
    expect(marked?.resultJson).toMatchObject({ executionRecovery: { heldBy: "crew_load_gate" } });
    expect(await evaluateBeforeClaim({ db, run: snapshot! }, gate({ ok: true, load1: 1 }))).toBe(false);
    const [after] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, f.runId));
    expect(after?.resultJson ?? {}).not.toHaveProperty("executionRecovery");
  }, 30_000);

  it("lệnh dừng đã bắt đầu mà chưa có kết quả (server vừa khởi động lại) vẫn giữ claim trên environment đó, tối đa 120 giây", async () => {
    const f = await heldRun("claude_local", {});
    const environmentId = randomUUID();
    const previousRunId = randomUUID();
    const deps = defaultBeforeClaimDeps(db);
    const started = async (createdAt: Date) =>
      db.insert(activityLog).values({
        companyId: f.companyId, actorType: "system", actorId: "crew", action: "crew.remote_stop.started",
        entityType: "heartbeat_run", entityId: previousRunId, details: { environmentId, runId: previousRunId }, createdAt,
      });
    expect(await deps.remoteStopPending(environmentId, f.companyId)).toBe(false);
    await started(new Date(Date.now() - 150_000));
    expect(await deps.remoteStopPending(environmentId, f.companyId)).toBe(false);
    await started(new Date(Date.now() - 5_000));
    expect(await deps.remoteStopPending(environmentId, f.companyId)).toBe(true);
    expect(await deps.remoteStopPending(randomUUID(), f.companyId)).toBe(false);
    // Scoped to the run's company, so the lookup stays on activity_log_company_created_idx.
    expect(await deps.remoteStopPending(environmentId, randomUUID())).toBe(false);
    await db.insert(activityLog).values({
      companyId: f.companyId, actorType: "system", actorId: "crew", action: "crew.remote_stop",
      entityType: "heartbeat_run", entityId: previousRunId, details: { environmentId, outcome: "stopped" },
    });
    expect(await deps.remoteStopPending(environmentId, f.companyId)).toBe(false);
  }, 30_000);

  it("run được cổng tải cho chạy thì bỏ dấu chưa bắt đầu trước khi claim", async () => {
    const f = await heldRun("claude_local", {});
    await holdThroughGate(f.runId);
    const [held] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, f.runId));
    expect(held?.resultJson).toMatchObject({ executionRecovery: { kind: "bootstrap", providerWorkStarted: false, heldBy: "crew_load_gate" } });
    execute.mockResolvedValue({ exitCode: 0, signal: null, timedOut: false, summary: "Completed" });
    restore?.();
    const claimed: unknown[] = [];
    restore = overrideCrewCoreHooksForTests({
      beforeClaim: async (input) => {
        const result = await evaluateBeforeClaim(input, {
          ...defaultBeforeClaimDeps(input.db),
          loadTarget: async () => ({ environmentId: "env-1", environmentName: "mac-mini", settings: { maxLoad1: 8, maxWaitMinutes: 60 } }),
          probeHost: async () => ({ ok: true, load1: 1 }),
        });
        const [row] = await db.select({ resultJson: heartbeatRuns.resultJson }).from(heartbeatRuns).where(eq(heartbeatRuns.id, input.run.id));
        claimed.push(row?.resultJson ?? null);
        return result;
      },
    });
    const heartbeat = heartbeatService(db);
    await heartbeat.resumeQueuedRuns();
    await heartbeat.drainActiveRunExecutions();
    expect(claimed[0] ?? {}).not.toHaveProperty("executionRecovery");
    expect(execute.mock.calls.filter(([context]) => context.runId === f.runId)).toHaveLength(1);
  }, 30_000);

  it("retry đã hết lượt của adapter hội thoại: hủy không sinh hold đối soát, đánh thức sau vẫn tạo run", async () => {
    const f = await heldRun("claude_local", { scheduledRetryAttempt: 2, scheduledRetryReason: "transient_failure" });

    const cancelled = await expireThroughGate(f.runId);

    expect(cancelled?.startedAt).toBeNull();
    expect(cancelled?.resultJson).toMatchObject({
      conversationContinuation: "continue_conversation_v1",
      executionCancellation: { state: "acknowledged", proof: "crew_load_gate_never_started" },
    });
    expect(await db.select().from(issueRecoveryActions).where(eq(issueRecoveryActions.sourceIssueId, f.issueId))).toEqual([]);
    expect(await getExecutionBlocker(db, f.companyId, f.issueId)).toBeNull();
    const next = await wakeAgain(f);
    expect(next).not.toBeNull();
    const skipped = await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.agentId, f.agentId));
    expect(skipped.filter((w) => w.reason === "execution_reconciliation_required")).toEqual([]);
  }, 30_000);

  it("run thường của adapter hội thoại: hủy vẫn không sinh hold", async () => {
    const f = await heldRun("claude_local", {});
    await expireThroughGate(f.runId);
    expect(await getExecutionBlocker(db, f.companyId, f.issueId)).toBeNull();
  }, 30_000);

  it("adapter không hội thoại giữ nguyên cách stock xử lý (không gắn chính sách hội thoại)", async () => {
    const f = await heldRun("process", { scheduledRetryAttempt: 2, scheduledRetryReason: "transient_failure" });
    const cancelled = await expireThroughGate(f.runId);
    expect(cancelled?.resultJson).not.toHaveProperty("conversationContinuation");
  }, 30_000);
});

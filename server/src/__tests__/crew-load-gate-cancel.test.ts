import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { agentWakeupRequests, agents, companies, createDb, heartbeatRuns, issueRecoveryActions, issues } from "@paperclipai/db";
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
    if (Object.keys(runFields).length > 0) await db.update(heartbeatRuns).set(runFields).where(eq(heartbeatRuns.id, run.id));
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

  /** Same write as the stock stale queued run gate (cancelStaleRunInTx) when the issue waits on review. */
  async function cancelLikeStaleGate(runId: string, issueId: string) {
    const [current] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, runId));
    const now = new Date();
    await db.update(heartbeatRuns).set({
      status: "cancelled",
      finishedAt: now,
      error: "Cancelled because the issue is waiting on review",
      errorCode: "issue_continuation_waiting_on_review",
      resultJson: {
        ...(current?.resultJson ?? {}),
        stopReason: "issue_continuation_waiting_on_review",
        effectiveTimeoutSec: 0,
        timeoutConfigured: false,
        timeoutSource: "stale_queued_run_gate",
        timeoutFired: false,
      },
      updatedAt: now,
    }).where(eq(heartbeatRuns.id, runId));
    await db.update(issues).set({ executionRunId: null, executionAgentNameKey: null, executionLockedAt: null })
      .where(eq(issues.id, issueId));
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

  it("stock stale gate hủy run đang chờ máy (issue chờ review): recovery không sinh hold, đánh thức sau vẫn tạo run", async () => {
    const f = await heldRun("claude_local", {});
    await holdThroughGate(f.runId);
    await cancelLikeStaleGate(f.runId, f.issueId);
    const [cancelled] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, f.runId));
    expect(cancelled).toMatchObject({ errorCode: "issue_continuation_waiting_on_review", startedAt: null, processPid: null });
    expect(cancelled?.resultJson).toMatchObject({ timeoutSource: "stale_queued_run_gate" });

    await heartbeatService(db).reconcileStrandedAssignedIssues();

    const actions = await db.select().from(issueRecoveryActions).where(eq(issueRecoveryActions.sourceIssueId, f.issueId));
    expect(actions.filter((a) => a.cause === "legacy_execution_requires_reconciliation")).toEqual([]);
    expect(await getExecutionBlocker(db, f.companyId, f.issueId)).toBeNull();
    const next = await wakeAgain(f);
    expect(next).not.toBeNull();
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

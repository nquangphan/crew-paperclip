import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  activityLog,
  agentWakeupRequests,
  agents,
  companies,
  createDb,
  environmentLeases,
  environments,
  heartbeatRuns,
  issues,
} from "@paperclipai/db";
import type { Environment, EnvironmentLease } from "@paperclipai/shared";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { overrideCrewCoreHooksForTests } from "../crew/core-hooks.ts";
import { settleRemoteStopsForTests, startRemoteStopOnRelease } from "../crew/remote-stop.ts";
import { rewakeAfterLeaseRelease } from "../crew/handoff-rewake.ts";
import { heartbeatService } from "../services/heartbeat.js";

// Stock order on a stage handoff: the route cancels the executor's run and wakes the reviewer at once,
// while the run's lease is only released when executeRun unwinds. The reviewer's wake is skipped
// (execution_reconciliation_required: the previous execution still holds its lease) and stock never
// retries it. Crew replays such a wake right after the lease is released.
const execute = vi.hoisted(() => vi.fn());
vi.mock("../adapters/index.js", async () => {
  const actual = await vi.importActual<typeof import("../adapters/index.js")>("../adapters/index.js");
  return { ...actual, getServerAdapter: vi.fn(() => ({ supportsLocalAgentJwt: false, execute })) };
});
const support = await getEmbeddedPostgresTestSupport();
const suite = support.supported ? describe : describe.skip;

const STOPPED = async () => ({ outcome: "stopped" as const, matched: 1, killed: 0, remaining: 0 });

suite("đánh thức lại participant sau khi lease nhả", () => {
  let db: ReturnType<typeof createDb>;
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let restore: (() => void) | null = null;

  beforeAll(async () => {
    temporary = await startEmbeddedPostgresTestDatabase("crew-handoff-rewake-");
    db = createDb(temporary.connectionString);
  }, 60_000);
  afterEach(async () => {
    await settleRemoteStopsForTests();
    restore?.();
    restore = null;
    execute.mockReset();
  });
  afterAll(async () => {
    await db?.$client.end({ timeout: 0 });
    await temporary?.cleanup();
  });

  /** Executor run cancelled by the handoff, its SSH lease still held; issue now in review by another agent. */
  async function handoff(issueStatus = "in_review") {
    const companyId = randomUUID(), executorId = randomUUID(), reviewerId = randomUUID();
    const issueId = randomUUID(), runId = randomUUID(), environmentId = randomUUID();
    await db.insert(companies).values({
      id: companyId, name: "Crew handoff", issuePrefix: `H${companyId.replace(/-/g, "").slice(0, 5).toUpperCase()}`,
      defaultResponsibleUserId: "owner",
    });
    for (const [id, name] of [[executorId, "Executor"], [reviewerId, "Reviewer"]] as const) {
      await db.insert(agents).values({
        id, companyId, name: `${name} ${id.slice(0, 6)}`, role: "engineer", status: "idle", adapterType: "claude_local",
        adapterConfig: {}, permissions: {}, runtimeConfig: { heartbeat: { enabled: false, wakeOnDemand: true, maxConcurrentRuns: 1 } },
      });
    }
    await db.insert(issues).values({ id: issueId, companyId, title: "Handoff", status: issueStatus, assigneeAgentId: reviewerId, responsibleUserId: "owner" });
    await db.insert(environments).values({
      id: environmentId, name: `mac-mini-${environmentId.slice(0, 8)}`, driver: "ssh", status: "active",
      config: { host: "mac.example.test", port: 22, username: "agent", remoteWorkspacePath: "/Users/a/crew-agents" },
    });
    const startedAt = new Date(Date.now() - 60_000);
    await db.insert(heartbeatRuns).values({
      id: runId, companyId, agentId: executorId, status: "cancelled", invocationSource: "assignment", responsibleUserId: "owner",
      contextSnapshot: { issueId }, startedAt, finishedAt: new Date(), errorCode: "issue_reassigned",
      error: "Cancelled before issue reassignment", runnerProfileJson: { adapterDispatch: { adapterType: "claude_local" } },
    });
    const [lease] = await db.insert(environmentLeases).values({
      companyId, environmentId, issueId, heartbeatRunId: runId, status: "active", provider: "ssh",
      metadata: { remoteCwd: "/Users/a/crew-agents/mac-claude" },
    }).returning();
    const [environment] = await db.select().from(environments).where(eq(environments.id, environmentId));
    restore = overrideCrewCoreHooksForTests({ beforeClaim: async () => true });
    return { companyId, executorId, reviewerId, issueId, runId, lease: lease!, environment: environment! };
  }

  /** The reviewer wake the route sends at the handoff (buildExecutionStageWakeup). */
  function reviewWake(f: { issueId: string }) {
    const executionStage = { wakeRole: "reviewer", stageId: "stage-review", allowedActions: ["approve", "request_changes"] };
    return {
      source: "assignment" as const, triggerDetail: "system" as const, reason: "execution_review_requested",
      payload: { issueId: f.issueId, mutation: "update", executionStage },
      requestedByActorType: "agent" as const, requestedByActorId: randomUUID(),
      contextSnapshot: { issueId: f.issueId, taskId: f.issueId, wakeReason: "execution_review_requested", source: "issue.execution_stage", executionStage },
    };
  }

  async function wakes(agentId: string) {
    return db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.agentId, agentId));
  }

  async function release(f: Awaited<ReturnType<typeof handoff>>) {
    await startRemoteStopOnRelease(
      {
        db,
        environment: f.environment as unknown as Environment,
        lease: f.lease as unknown as EnvironmentLease,
        status: "failed",
        cancelActiveWork: true,
      },
      STOPPED,
    );
    await settleRemoteStopsForTests();
  }

  it("wake bị bỏ vì lease chưa nhả được phát lại đúng một lần sau khi lease nhả", async () => {
    const f = await handoff();
    const heartbeat = heartbeatService(db);
    expect(await heartbeat.wakeup(f.reviewerId, reviewWake(f))).toBeNull();
    const [skipped] = await wakes(f.reviewerId);
    expect(skipped).toMatchObject({ status: "skipped", reason: "execution_reconciliation_required" });
    expect(skipped?.error).toMatch(/has not released its environment lease/);

    await release(f);

    const [lease] = await db.select().from(environmentLeases).where(eq(environmentLeases.id, f.lease.id));
    expect(lease?.releasedAt).not.toBeNull();
    const runs = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.agentId, f.reviewerId));
    expect(runs).toHaveLength(1);
    expect(runs[0]?.contextSnapshot).toMatchObject({
      issueId: f.issueId,
      wakeReason: "execution_review_requested",
      executionStage: { wakeRole: "reviewer" },
      crewHandoffRewake: { skippedWakeId: skipped!.id, previousRunId: f.runId },
    });
    const marks = await db.select().from(activityLog).where(and(eq(activityLog.action, "crew.handoff_rewake"), eq(activityLog.entityId, skipped!.id)));
    expect(marks).toHaveLength(1);

    // A second release of the same lease (core releases it again) does not wake twice.
    await release(f);
    expect(await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.agentId, f.reviewerId))).toHaveLength(1);
  }, 30_000);

  it("wakeup lỗi thì không ghi dấu, ghi activity lỗi, và lần nhả lease sau thử lại được", async () => {
    const f = await handoff();
    expect(await heartbeatService(db).wakeup(f.reviewerId, reviewWake(f))).toBeNull();
    await db.update(environmentLeases).set({ releasedAt: new Date(), status: "failed" }).where(eq(environmentLeases.id, f.lease.id));
    const input = { db, companyId: f.companyId, runId: f.runId, issueId: f.issueId };

    expect(await rewakeAfterLeaseRelease(input, async () => {
      throw new Error("admission temporarily unavailable");
    })).toBe(0);
    const actions = async (action: string) =>
      db.select().from(activityLog).where(and(eq(activityLog.action, action), eq(activityLog.runId, f.runId)));
    expect(await actions("crew.handoff_rewake")).toHaveLength(0);
    expect(await actions("crew.handoff_rewake.failed")).toEqual([
      expect.objectContaining({ details: expect.objectContaining({ error: "admission temporarily unavailable" }) }),
    ]);
    expect(await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.agentId, f.reviewerId))).toHaveLength(0);

    expect(await rewakeAfterLeaseRelease(input)).toBe(1);
    expect(await actions("crew.handoff_rewake")).toHaveLength(1);
    expect(await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.agentId, f.reviewerId))).toHaveLength(1);
  }, 30_000);

  it("không đánh thức khi issue đã bị người chuyển blocked", async () => {
    const f = await handoff();
    expect(await heartbeatService(db).wakeup(f.reviewerId, reviewWake(f))).toBeNull();
    await db.update(issues).set({ status: "blocked" }).where(eq(issues.id, f.issueId));
    await release(f);
    expect(await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.agentId, f.reviewerId))).toHaveLength(0);
  }, 30_000);

  it("không đánh thức khi không có wake nào bị bỏ", async () => {
    const f = await handoff();
    await release(f);
    expect(await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.agentId, f.reviewerId))).toHaveLength(0);
    expect(await wakes(f.reviewerId)).toHaveLength(0);
  }, 30_000);

  it("không đánh thức agent không còn là assignee", async () => {
    const f = await handoff();
    expect(await heartbeatService(db).wakeup(f.reviewerId, reviewWake(f))).toBeNull();
    await db.update(issues).set({ assigneeAgentId: f.executorId }).where(eq(issues.id, f.issueId));
    await release(f);
    expect(await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.agentId, f.reviewerId))).toHaveLength(0);
  }, 30_000);
});

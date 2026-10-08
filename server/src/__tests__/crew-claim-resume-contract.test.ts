import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  agentTaskSessions,
  agentWakeupRequests,
  agents,
  companies,
  createDb,
  heartbeatRuns,
  issueRelations,
  issues,
} from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { overrideCrewCoreHooksForTests } from "../crew/core-hooks.ts";
import { heartbeatService } from "../services/heartbeat.js";

// Stock contract the Crew claim hook relies on: resume fields written onto a queued run before
// claimQueuedRun parses it reach the adapter, even for wakes that normally force a fresh session.
const execute = vi.hoisted(() => vi.fn());
vi.mock("../adapters/index.js", async () => {
  const actual = await vi.importActual<typeof import("../adapters/index.js")>("../adapters/index.js");
  return { ...actual, getServerAdapter: vi.fn(() => ({ supportsLocalAgentJwt: false, execute })) };
});
const support = await getEmbeddedPostgresTestSupport();
if (!support.supported) throw new Error(`Embedded PostgreSQL unavailable: ${support.reason}`);
const suite = describe;

suite("resume fields set before claim reach the adapter", () => {
  let db: ReturnType<typeof createDb>;
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let restore: (() => void) | null = null;

  beforeAll(async () => {
    temporary = await startEmbeddedPostgresTestDatabase("crew-claim-resume-");
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

  async function seed(wakeReason: string) {
    const companyId = randomUUID(), agentId = randomUUID(), issueA = randomUUID(), issueB = randomUUID();
    const runA = randomUUID(), runB = randomUUID(), wakeupRequestId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Crew resume",
      issuePrefix: `R${companyId.replace(/-/g, "").slice(0, 5).toUpperCase()}`,
      defaultResponsibleUserId: "owner",
    });
    await db.insert(agents).values({
      id: agentId, companyId, name: "Executor", role: "engineer", status: "idle", adapterType: "process",
      adapterConfig: {}, permissions: {}, runtimeConfig: { heartbeat: { enabled: false, wakeOnDemand: true, maxConcurrentRuns: 1 } },
    });
    await db.insert(issues).values([
      { id: issueA, companyId, title: "A", status: "done", assigneeAgentId: agentId, responsibleUserId: "owner" },
      { id: issueB, companyId, title: "B", status: "todo", assigneeAgentId: agentId, responsibleUserId: "owner" },
    ]);
    await db.insert(issueRelations).values({ companyId, issueId: issueA, relatedIssueId: issueB, type: "blocks" });
    await db.insert(heartbeatRuns).values({
      id: runA, companyId, agentId, status: "succeeded", invocationSource: "automation", responsibleUserId: "owner",
      contextSnapshot: { issueId: issueA }, sessionIdBefore: null, sessionIdAfter: "sess-a",
    });
    await db.insert(agentTaskSessions).values({
      companyId, agentId, adapterType: "process", taskKey: issueA,
      sessionParamsJson: { sessionId: "sess-a" }, sessionDisplayId: "sess-a", lastRunId: runA,
    });
    // Automatic runs need a linked wake request for admission at both claim and dispatch.
    await db.insert(agentWakeupRequests).values({
      id: wakeupRequestId, companyId, agentId, source: "automation", triggerDetail: "system",
      reason: wakeReason, payload: { issueId: issueB }, status: "queued", runId: runB,
      requestedByActorType: "system",
    });
    await db.insert(heartbeatRuns).values({
      id: runB, companyId, agentId, status: "queued", invocationSource: "automation", responsibleUserId: "owner",
      triggerDetail: "system", wakeupRequestId,
      contextSnapshot: { issueId: issueB, taskKey: issueB, wakeReason },
    });
    return { companyId, agentId, issueA, issueB, runA, runB };
  }

  async function claimAndGetRuntime(runId: string) {
    const heartbeat = heartbeatService(db);
    await heartbeat.resumeQueuedRuns();
    await heartbeat.drainActiveRunExecutions();
    const run = await heartbeat.getRun(runId);
    const diagnostic = JSON.stringify({
      runId, status: run?.status, errorCode: run?.errorCode, error: run?.error,
      executionStage: run?.executionStage,
    });
    const calls = execute.mock.calls.filter(([ctx]) => ctx.runId === runId);
    expect(calls, `Run phải gọi adapter đúng một lần: ${diagnostic}`).toHaveLength(1);
    expect(run?.status, diagnostic).toBe("succeeded");
    return calls[0]![0].runtime;
  }

  function setResumeBeforeClaim(runId: string, sourceRunId: string) {
    restore = overrideCrewCoreHooksForTests({
      beforeClaim: async ({ db: hookDb, run }) => {
        if (run.id !== runId) return false;
        const next = {
          ...(run.contextSnapshot ?? {}),
          resumeFromRunId: sourceRunId,
          resumeSessionDisplayId: "sess-a",
          resumeSessionParams: { sessionId: "sess-a" },
        };
        await hookDb.update(heartbeatRuns).set({ contextSnapshot: next }).where(and(eq(heartbeatRuns.id, runId), eq(heartbeatRuns.status, "queued")));
        run.contextSnapshot = next;
        return false;
      },
    });
  }

  for (const wakeReason of ["issue_blockers_resolved", "issue_assigned"]) {
    it(`wake ${wakeReason}: adapter nhận session của A`, async () => {
      execute.mockResolvedValue({ exitCode: 0, signal: null, timedOut: false, summary: "ok", sessionId: "sess-a" });
      const s = await seed(wakeReason);
      setResumeBeforeClaim(s.runB, s.runA);
      const runtime = await claimAndGetRuntime(s.runB);
      expect(runtime).toMatchObject({ sessionId: "sess-a" });
      const [session] = await db
        .select()
        .from(agentTaskSessions)
        .where(and(eq(agentTaskSessions.agentId, s.agentId), eq(agentTaskSessions.taskKey, s.issueB)));
      expect(session?.sessionDisplayId ?? (session?.sessionParamsJson as { sessionId?: string } | null)?.sessionId).toBe("sess-a");
    }, 30_000);
  }

  it("đối chứng: không đặt gì thì run B mở session mới", async () => {
    execute.mockResolvedValue({ exitCode: 0, signal: null, timedOut: false, summary: "ok" });
    const s = await seed("issue_blockers_resolved");
    restore = overrideCrewCoreHooksForTests({ beforeClaim: async () => false });
    const runtime = await claimAndGetRuntime(s.runB);
    expect(runtime.sessionId ?? null).toBeNull();
  }, 30_000);
});

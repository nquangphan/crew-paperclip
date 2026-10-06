import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { agents, companies, createDb, heartbeatRuns, issues } from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { overrideCrewCoreHooksForTests } from "../crew/core-hooks.ts";
import { defaultBeforeClaimDeps, evaluateBeforeClaim } from "../crew/load-gate.ts";
import { heartbeatService } from "../services/heartbeat.js";

// Behaviour of hook H1 (first line of claimQueuedRun): a `true` from beforeClaim keeps the run
// queued without executing it; `false` lets the normal claim run unchanged.
const execute = vi.hoisted(() => vi.fn());
vi.mock("../adapters/index.js", async () => {
  const actual = await vi.importActual<typeof import("../adapters/index.js")>("../adapters/index.js");
  return { ...actual, getServerAdapter: vi.fn(() => ({ supportsLocalAgentJwt: false, execute })) };
});
const support = await getEmbeddedPostgresTestSupport();
const suite = support.supported ? describe : describe.skip;

suite("crew beforeClaim hook in claimQueuedRun", () => {
  let db: ReturnType<typeof createDb>;
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let restore: (() => void) | null = null;

  beforeAll(async () => {
    temporary = await startEmbeddedPostgresTestDatabase("crew-before-claim-");
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

  async function queuedRun() {
    const companyId = randomUUID(), agentId = randomUUID(), issueId = randomUUID(), runId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Crew gate",
      issuePrefix: `G${companyId.replace(/-/g, "").slice(0, 5).toUpperCase()}`,
      defaultResponsibleUserId: "owner",
    });
    await db.insert(agents).values({
      id: agentId, companyId, name: "Worker", role: "engineer", status: "idle", adapterType: "process",
      adapterConfig: {}, permissions: {}, runtimeConfig: { heartbeat: { enabled: false, wakeOnDemand: true, maxConcurrentRuns: 1 } },
    });
    await db.insert(issues).values({ id: issueId, companyId, title: "Gate task", status: "todo", assigneeAgentId: agentId, responsibleUserId: "owner" });
    await db.insert(heartbeatRuns).values({
      id: runId, companyId, agentId, status: "queued", invocationSource: "on_demand", responsibleUserId: "owner", contextSnapshot: { issueId },
    });
    return { runId, issueId };
  }

  it("keeps the run queued and does not execute it while beforeClaim returns true", async () => {
    const seen: string[] = [];
    restore = overrideCrewCoreHooksForTests({
      beforeClaim: async ({ run }) => {
        seen.push(`${run.id}:${run.status}`);
        return true;
      },
    });
    const { runId } = await queuedRun();
    const heartbeat = heartbeatService(db);
    await heartbeat.resumeQueuedRuns();
    await heartbeat.drainActiveRunExecutions();
    expect((await heartbeat.getRun(runId))?.status).toBe("queued");
    expect(seen).toContain(`${runId}:queued`);
    expect(execute).not.toHaveBeenCalled();
  }, 30_000);

  it("claims and executes the run normally when beforeClaim returns false", async () => {
    execute.mockResolvedValue({ exitCode: 0, signal: null, timedOut: false, summary: "Completed" });
    restore = overrideCrewCoreHooksForTests({ beforeClaim: async () => false });
    const { runId } = await queuedRun();
    const heartbeat = heartbeatService(db);
    await heartbeat.resumeQueuedRuns();
    await heartbeat.drainActiveRunExecutions();
    expect((await heartbeat.getRun(runId))?.status).not.toBe("queued");
    // The run left queued by the previous test is in the same database and is claimed too.
    expect(execute.mock.calls.filter(([context]) => context.runId === runId)).toHaveLength(1);
  }, 30_000);

  it("cancels an expired run without deadlocking on the agent start lock", async () => {
    restore = overrideCrewCoreHooksForTests({
      beforeClaim: (input) =>
        evaluateBeforeClaim(input, {
          ...defaultBeforeClaimDeps(input.db),
          loadTarget: async () => ({ environmentId: "env-1", environmentName: "mac-mini", settings: { maxLoad1: 8, maxWaitMinutes: 60 } }),
          probeHost: async () => ({ ok: false, error: "Connection timed out during banner exchange" }),
          firstNoticeAt: async (_runId, kind) => (kind === "waiting" ? new Date(Date.now() - 2 * 60 * 60_000) : null),
        }),
    });
    const { runId, issueId } = await queuedRun();
    const heartbeat = heartbeatService(db);
    const started = Date.now();
    await heartbeat.resumeQueuedRuns();
    expect(Date.now() - started).toBeLessThan(5_000);
    let status: string | undefined;
    for (let i = 0; i < 50; i += 1) {
      status = (await heartbeat.getRun(runId))?.status;
      if (status === "cancelled") break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(status).toBe("cancelled");
    expect(Date.now() - started).toBeLessThan(5_000);
    const [issue] = await db.select({ status: issues.status }).from(issues).where(eq(issues.id, issueId));
    expect(issue?.status).toBe("blocked");
    expect(execute.mock.calls.filter(([context]) => context.runId === runId)).toHaveLength(0);
  }, 30_000);

  it("leaves claims unchanged with the real Crew gate when the agent has no gated environment", async () => {
    execute.mockResolvedValue({ exitCode: 0, signal: null, timedOut: false, summary: "Completed" });
    const { runId } = await queuedRun();
    const heartbeat = heartbeatService(db);
    await heartbeat.resumeQueuedRuns();
    await heartbeat.drainActiveRunExecutions();
    expect((await heartbeat.getRun(runId))?.status).not.toBe("queued");
    expect(execute.mock.calls.filter(([context]) => context.runId === runId)).toHaveLength(1);
  }, 30_000);
});

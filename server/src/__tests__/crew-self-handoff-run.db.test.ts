import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import express from "express";
import request from "supertest";
import { and, asc, eq, sql } from "drizzle-orm";
import { WebSocketServer } from "ws";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  agentWakeupRequests,
  authUsers,
  companies,
  companyMemberships,
  createDb,
  heartbeatRuns,
  issues,
} from "@paperclipai/db";
import { runningProcesses } from "../adapters/index.js";
import { errorHandler } from "../middleware/index.js";
import { issueRoutes } from "../routes/issues.js";
import { heartbeatService } from "../services/heartbeat.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe.sequential : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping issue self-handoff run tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

const REPORTED_COST_USD = 0.42;

async function waitFor(condition: () => boolean | Promise<boolean>, timeoutMs = 20_000, intervalMs = 50) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("Timed out waiting for condition");
}

/**
 * A gateway whose first turn stays open until the test releases it, so the
 * test can hand the issue off while that run is live. Every turn reports usage
 * and cost the way a provider does in its final result.
 */
async function createGatedGateway() {
  const server = createServer();
  const wss = new WebSocketServer({ server });
  let waitCount = 0;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let agentRequests = 0;

  wss.on("connection", (socket) => {
    socket.send(JSON.stringify({ type: "event", event: "connect.challenge", payload: { nonce: "nonce-1" } }));
    socket.on("message", async (raw) => {
      const frame = JSON.parse(Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw)) as {
        type: string;
        id: string;
        method: string;
        params?: Record<string, unknown>;
      };
      if (frame.type !== "req") return;
      if (frame.method === "connect") {
        socket.send(JSON.stringify({
          type: "res",
          id: frame.id,
          ok: true,
          payload: {
            type: "hello-ok",
            protocol: 3,
            server: { version: "test", connId: "conn-1" },
            features: { methods: ["connect", "agent", "agent.wait"], events: ["agent"] },
            snapshot: { version: 1, ts: Date.now() },
            policy: { maxPayload: 1_000_000, maxBufferedBytes: 1_000_000, tickIntervalMs: 30_000 },
          },
        }));
        return;
      }
      if (frame.method === "agent") {
        agentRequests += 1;
        socket.send(JSON.stringify({
          type: "res",
          id: frame.id,
          ok: true,
          payload: { runId: frame.params?.idempotencyKey, status: "accepted", acceptedAt: Date.now() },
        }));
        return;
      }
      if (frame.method === "agent.wait") {
        waitCount += 1;
        if (waitCount === 1) await gate;
        socket.send(JSON.stringify({
          type: "res",
          id: frame.id,
          ok: true,
          payload: {
            runId: frame.params?.runId,
            status: "ok",
            startedAt: 1,
            endedAt: 2,
            result: {
              meta: {
                agentMeta: {
                  provider: "anthropic",
                  model: "test-model",
                  usage: { inputTokens: 1200, outputTokens: 300 },
                  costUsd: REPORTED_COST_USD,
                },
              },
            },
          },
        }));
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to resolve gateway address");
  return {
    url: `ws://127.0.0.1:${address.port}`,
    agentRequests: () => agentRequests,
    release: () => release(),
    close: async () => {
      release();
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

describeEmbeddedPostgres("issue self-handoff keeps the handing-off run alive", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let gateway: Awaited<ReturnType<typeof createGatedGateway>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-issue-self-handoff-");
    db = createDb(tempDb.connectionString);
  }, 120_000);

  afterEach(async () => {
    gateway?.release();
    await heartbeatService(db).drainActiveRunExecutions();
    await gateway?.close();
    gateway = null;
    runningProcesses.clear();
    await db.execute(sql`TRUNCATE TABLE companies CASCADE`);
  });

  afterAll(async () => {
    await heartbeatService(db).drainActiveRunExecutions();
    await db?.$client?.end?.({ timeout: 0 });
    await tempDb?.cleanup();
  });

  function app(companyId: string, ownerUserId: string, agentActor?: { agentId: string; runId: string }) {
    const testApp = express();
    testApp.use(express.json());
    testApp.use((req, _res, next) => {
      (req as any).actor = {
        ...(agentActor
          ? { type: "agent", ...agentActor, companyId, source: "agent_jwt" }
          : {
              type: "board",
              source: "session",
              userId: ownerUserId,
              companyIds: [companyId],
              memberships: [{ companyId, status: "active", membershipRole: "owner" }],
              isInstanceAdmin: false,
            }),
      };
      next();
    });
    testApp.use("/api", issueRoutes(db, {} as any, {}));
    testApp.use(errorHandler);
    return testApp;
  }

  async function seedRunningExecutor() {
    gateway = await createGatedGateway();
    const companyId = randomUUID();
    const executorId = randomUUID();
    const reviewerId = randomUUID();
    const otherAgentId = randomUUID();
    const issueId = randomUUID();
    const ownerUserId = `owner-${randomUUID()}`;
    const issuePrefix = `H${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
    await db.insert(authUsers).values({
      id: ownerUserId,
      name: "Owner",
      email: `${ownerUserId}@example.test`,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.insert(companies).values({
      id: companyId,
      name: "Handoff",
      issuePrefix,
      requireBoardApprovalForNewAgents: false,
      defaultResponsibleUserId: ownerUserId,
    });
    await db.insert(companyMemberships).values({
      companyId,
      principalType: "user",
      principalId: ownerUserId,
      status: "active",
      membershipRole: "owner",
    });
    const adapterConfig = {
      url: gateway.url,
      headers: { "x-openclaw-token": "gateway-token" },
      payloadTemplate: { message: "wake now" },
      waitTimeoutMs: 20_000,
    };
    await db.insert(agents).values([executorId, reviewerId, otherAgentId].map((id, index) => ({
      id,
      companyId,
      name: ["Executor", "Reviewer", "Lead"][index]!,
      role: "engineer",
      status: "idle",
      adapterType: "openclaw_gateway",
      adapterConfig,
      runtimeConfig: {},
      permissions: {},
    })));
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Self handoff",
      status: "in_progress",
      priority: "medium",
      responsibleUserId: ownerUserId,
      assigneeAgentId: executorId,
      issueNumber: 1,
      identifier: `${issuePrefix}-1`,
    });

    const executorRun = await heartbeatService(db).wakeup(executorId, {
      source: "assignment",
      triggerDetail: "system",
      reason: "issue_assigned",
      payload: { issueId },
      contextSnapshot: { issueId, taskId: issueId, wakeReason: "issue_assigned" },
      requestedByActorType: "user",
      requestedByActorId: ownerUserId,
    });
    expect(executorRun).not.toBeNull();
    await waitFor(async () => (await readRun(executorRun!.id))?.status === "running");
    await waitFor(() => gateway!.agentRequests() === 1);
    return { companyId, ownerUserId, executorId, reviewerId, otherAgentId, issueId, executorRunId: executorRun!.id };
  }

  async function readRun(runId: string) {
    return db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, runId)).then((rows) => rows[0] ?? null);
  }

  async function runsFor(agentId: string) {
    return db.select().from(heartbeatRuns).where(eq(heartbeatRuns.agentId, agentId)).orderBy(asc(heartbeatRuns.createdAt));
  }

  it("lets the handing-off run finish with its cost, then starts the new assignee", async () => {
    const seeded = await seedRunningExecutor();

    const res = await request(app(seeded.companyId, seeded.ownerUserId, { agentId: seeded.executorId, runId: seeded.executorRunId }))
      .patch(`/api/issues/${seeded.issueId}`)
      .send({ assigneeAgentId: seeded.reviewerId, comment: "Executor: xong, chờ review." });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const [handedOff] = await db.select().from(issues).where(eq(issues.id, seeded.issueId));
    expect(handedOff.assigneeAgentId).toBe(seeded.reviewerId);
    expect((await readRun(seeded.executorRunId))?.status).toBe("running");

    // The reviewer waits behind the executor run instead of running beside it.
    await waitFor(async () => {
      const [deferred] = await db.select().from(agentWakeupRequests).where(and(
        eq(agentWakeupRequests.agentId, seeded.reviewerId),
        eq(agentWakeupRequests.status, "deferred_issue_execution"),
      ));
      return Boolean(deferred);
    });
    expect(await runsFor(seeded.reviewerId)).toHaveLength(0);

    gateway!.release();

    await waitFor(async () => (await readRun(seeded.executorRunId))?.status === "succeeded");
    const executorRun = await readRun(seeded.executorRunId);
    expect(executorRun?.errorCode).toBeNull();
    expect(executorRun?.usageJson).toMatchObject({ costUsd: REPORTED_COST_USD, inputTokens: 1200, outputTokens: 300 });

    await waitFor(async () => (await runsFor(seeded.reviewerId))[0]?.status === "succeeded");
    const [reviewerRun] = await runsFor(seeded.reviewerId);
    expect(reviewerRun.startedAt!.getTime()).toBeGreaterThanOrEqual(executorRun!.finishedAt!.getTime());
    expect(reviewerRun.contextSnapshot).toMatchObject({ issueId: seeded.issueId });
  }, 120_000);

  it("still cancels the previous assignee run when the board reassigns", async () => {
    const seeded = await seedRunningExecutor();

    const res = await request(app(seeded.companyId, seeded.ownerUserId))
      .patch(`/api/issues/${seeded.issueId}`)
      .send({ assigneeAgentId: seeded.reviewerId });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const stopped = await readRun(seeded.executorRunId);
    expect(stopped?.status).toBe("cancelled");
    expect(stopped?.errorCode).toBe("issue_reassigned");
    expect(stopped?.resultJson).toMatchObject({ reassignmentStopConfirmed: true });
    await waitFor(async () => (await runsFor(seeded.reviewerId)).length === 1);
  }, 120_000);

  it("still cancels the assignee run when another agent's run reassigns the issue", async () => {
    const seeded = await seedRunningExecutor();
    const [otherRun] = await db.insert(heartbeatRuns).values({
      companyId: seeded.companyId,
      agentId: seeded.otherAgentId,
      invocationSource: "assignment",
      triggerDetail: "system",
      status: "running",
      startedAt: new Date(),
      contextSnapshot: { issueId: randomUUID() },
    }).returning();
    // Outside in_progress the run checkout lock does not reserve field edits
    // for the assignee, so another agent may reassign the issue.
    await db.update(issues).set({ status: "todo" }).where(eq(issues.id, seeded.issueId));

    const res = await request(app(seeded.companyId, seeded.ownerUserId, { agentId: seeded.otherAgentId, runId: otherRun.id }))
      .patch(`/api/issues/${seeded.issueId}`)
      .send({ assigneeAgentId: seeded.reviewerId });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const stopped = await readRun(seeded.executorRunId);
    expect(stopped?.status).toBe("cancelled");
    expect(stopped?.errorCode).toBe("issue_reassigned");
    expect((await readRun(otherRun.id))?.status).toBe("running");
  }, 120_000);
});

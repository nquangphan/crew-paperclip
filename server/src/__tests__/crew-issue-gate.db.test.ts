import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { activityLog, agents, companies, createDb, issues } from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { buildCrewPolicy } from "../crew/issue-policy.ts";
import { issueService } from "../services/issues.js";

// Hook H2 (first line of runUpdate) through the real issue service: every caller of
// issueService(db).update goes through the Crew gate, not only the REST route.
const support = await getEmbeddedPostgresTestSupport();
const suite = support.supported ? describe : describe.skip;

suite("crew issue gate in issueService.update", () => {
  let db: ReturnType<typeof createDb>;
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;

  beforeAll(async () => {
    temporary = await startEmbeddedPostgresTestDatabase("crew-issue-gate-");
    db = createDb(temporary.connectionString);
  }, 60_000);
  afterAll(async () => {
    await db?.$client.end({ timeout: 0 });
    await temporary?.cleanup();
  });

  async function seed() {
    const companyId = randomUUID();
    const executorId = randomUUID();
    const reviewerId = randomUUID();
    const integratorId = randomUUID();
    const issueId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Crew gate",
      issuePrefix: `G${companyId.replace(/-/g, "").slice(0, 5).toUpperCase()}`,
      defaultResponsibleUserId: "owner-1",
    });
    const agent = (id: string, name: string, metadata: Record<string, unknown> | null) => ({
      id,
      companyId,
      name,
      role: "engineer",
      status: "idle",
      adapterType: "process",
      adapterConfig: {},
      permissions: {},
      metadata,
      runtimeConfig: { heartbeat: { enabled: false, wakeOnDemand: false, maxConcurrentRuns: 1 } },
    });
    await db
      .insert(agents)
      .values([
        agent(executorId, "Executor", null),
        agent(reviewerId, "Reviewer", { crewRole: "reviewer" }),
        agent(integratorId, "Integrator", { crewRole: "integrator" }),
      ]);
    const policy = buildCrewPolicy("root", { reviewerAgentId: reviewerId, integratorAgentId: integratorId }, "owner-1");
    const stage = policy.stages[0]!;
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Yêu cầu gốc",
      status: "in_review",
      assigneeAgentId: reviewerId,
      createdByUserId: "owner-1",
      responsibleUserId: "owner-1",
      executionPolicy: policy,
      executionState: {
        status: "pending",
        currentStageId: stage.id,
        currentStageIndex: 0,
        currentStageType: stage.type,
        currentParticipant: { type: "agent", agentId: reviewerId, userId: null },
        returnAssignee: { type: "agent", agentId: executorId, userId: null },
        reviewRequest: null,
        completedStageIds: [],
        lastDecisionId: null,
        lastDecisionOutcome: null,
        changesRequestedCount: 0,
      },
    });
    return { companyId, issueId, executorId, reviewerId, integratorId };
  }

  async function statusOf(issueId: string) {
    const [row] = await db.select().from(issues).where(eq(issues.id, issueId));
    return row!.status;
  }

  it("system done khi stage reviewer còn chờ bị 422 và issue giữ nguyên", async () => {
    const { issueId } = await seed();
    await expect(issueService(db).update(issueId, { status: "done" })).rejects.toMatchObject({
      status: 422,
      details: { code: "crew_gate_blocked" },
    });
    expect(await statusOf(issueId)).toBe("in_review");
  });

  it("agent xóa executionPolicy bị 422 crew_policy_locked", async () => {
    const { issueId, executorId } = await seed();
    await expect(
      issueService(db).update(issueId, { executionPolicy: null, actorAgentId: executorId }),
    ).rejects.toMatchObject({ status: 422, details: { code: "crew_policy_locked" } });
    const [row] = await db.select().from(issues).where(eq(issues.id, issueId));
    expect((row!.executionPolicy as { stages: unknown[] }).stages).toHaveLength(3);
  });

  it("system ghi blocked vẫn được", async () => {
    const { issueId } = await seed();
    const updated = await issueService(db).update(issueId, { status: "blocked" });
    expect(updated?.status).toBe("blocked");
  });

  it("agent chuyển cancelled bị 422, board thì được", async () => {
    const { issueId, executorId } = await seed();
    await expect(
      issueService(db).update(issueId, { status: "cancelled", actorAgentId: executorId }),
    ).rejects.toMatchObject({
      status: 422,
      details: { code: "crew_gate_blocked", violations: ["agent_cancel_forbidden"] },
    });
    expect(await statusOf(issueId)).toBe("in_review");
    const updated = await issueService(db).update(issueId, { status: "cancelled", actorUserId: "owner-1" });
    expect(updated?.status).toBe("cancelled");
  });

  it("board ép done thì được và ghi đúng một activity crew.policy.board_override", async () => {
    const { issueId } = await seed();
    const updated = await issueService(db).update(issueId, {
      status: "done",
      executionState: null,
      actorUserId: "owner-1",
    });
    expect(updated?.status).toBe("done");
    const rows = await db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.entityId, issueId), eq(activityLog.action, "crew.policy.board_override")));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actorType).toBe("user");
  });
});

import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  activityLog,
  agents,
  companies,
  companyMemberships,
  createDb,
  issueComments,
  issueExecutionDecisions,
  issues,
} from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { buildCrewPolicy, CREW_POLICY_CONFIG_ENV } from "../crew/issue-policy.ts";
import {
  applyIssueExecutionPolicyTransition,
  normalizeIssueExecutionPolicy,
} from "../services/issue-execution-policy.js";
import { issueService } from "../services/issues.js";

// Hook H2 (first line of runUpdate) through the real issue service: every caller of
// issueService(db).update goes through the Crew gate, not only the REST route.
const support = await getEmbeddedPostgresTestSupport();
const suite = support.supported ? describe : describe.skip;

type Principal = { type: "agent" | "user"; agentId: string | null; userId: string | null };

const SHA_BASE = "a".repeat(40);
const SHA_HEAD = "b".repeat(40);
const docsLine = (exit: number) => `crew-docs-check commit=${SHA_HEAD} range=${SHA_BASE}..${SHA_HEAD} exit=${exit}`;
const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000);

suite("crew issue gate in issueService.update", () => {
  let db: ReturnType<typeof createDb>;
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  const configDir = mkdtempSync(path.join(tmpdir(), "crew-issue-gate-config-"));
  const configFile = path.join(configDir, "crew-policy.json");
  const configured: Record<string, unknown> = {};
  const previousEnv = process.env[CREW_POLICY_CONFIG_ENV];

  function writeConfig() {
    writeFileSync(configFile, JSON.stringify({ companies: configured }));
  }

  beforeAll(async () => {
    writeConfig();
    process.env[CREW_POLICY_CONFIG_ENV] = configFile;
    temporary = await startEmbeddedPostgresTestDatabase("crew-issue-gate-");
    db = createDb(temporary.connectionString);
  }, 60_000);
  afterAll(async () => {
    if (previousEnv === undefined) delete process.env[CREW_POLICY_CONFIG_ENV];
    else process.env[CREW_POLICY_CONFIG_ENV] = previousEnv;
    rmSync(configDir, { recursive: true, force: true });
    await db?.$client.end({ timeout: 0 });
    await temporary?.cleanup();
  });

  async function company(config: "ok" | "invalid" | "absent" = "ok") {
    const companyId = randomUUID();
    const executorId = randomUUID();
    const reviewerId = randomUUID();
    const integratorId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Crew gate",
      issuePrefix: `G${companyId.replace(/-/g, "").slice(0, 5).toUpperCase()}`,
      defaultResponsibleUserId: "owner-1",
    });
    const agent = (id: string, name: string) => ({
      id,
      companyId,
      name,
      role: "engineer",
      status: "idle",
      adapterType: "process",
      adapterConfig: {},
      permissions: {},
      runtimeConfig: { heartbeat: { enabled: false, wakeOnDemand: false, maxConcurrentRuns: 1 } },
    });
    await db
      .insert(agents)
      .values([agent(executorId, "Executor"), agent(reviewerId, "Reviewer"), agent(integratorId, "Integrator")]);
    await db.insert(companyMemberships).values({
      companyId,
      principalType: "user",
      principalId: "owner-1",
      status: "active",
      membershipRole: "owner",
    });
    if (config === "ok") configured[companyId] = { reviewerAgentId: reviewerId, integratorAgentId: integratorId, ownerUserId: "owner-1" };
    if (config === "invalid") configured[companyId] = { reviewerAgentId: reviewerId };
    writeConfig();
    const roles = { reviewerAgentId: reviewerId, integratorAgentId: integratorId };
    const legacyRoot = normalizeIssueExecutionPolicy({
      stages: buildCrewPolicy("root", roles, "owner-1").stages.slice(0, 3),
      maxReviewRounds: 5,
    })!;
    const agentP = (agentId: string): Principal => ({ type: "agent", agentId, userId: null });
    return {
      companyId,
      executorId,
      reviewerId,
      integratorId,
      root: buildCrewPolicy("root", roles, "owner-1"),
      legacyRoot,
      child: buildCrewPolicy("child", roles),
      executor: agentP(executorId),
      reviewer: agentP(reviewerId),
      integrator: agentP(integratorId),
    };
  }
  type Company = Awaited<ReturnType<typeof company>>;

  function state(
    c: Company,
    status: "pending" | "completed",
    stageId: string | null,
    participant: Principal | null,
    completedStageIds: string[],
  ) {
    const policy = [c.root, c.child].find((p) => p.stages.some((s) => s.id === (stageId ?? completedStageIds[0])))!;
    const index = stageId ? policy.stages.findIndex((s) => s.id === stageId) : null;
    return {
      status,
      currentStageId: stageId,
      currentStageIndex: index,
      currentStageType: index === null ? null : policy.stages[index]!.type,
      currentParticipant: participant,
      returnAssignee: c.executor,
      reviewRequest: null,
      completedStageIds,
      lastDecisionId: null,
      lastDecisionOutcome: status === "completed" || completedStageIds.length > 0 ? "approved" : null,
      changesRequestedCount: 0,
    };
  }

  async function issue(c: Company, values: Partial<typeof issues.$inferInsert>) {
    const id = randomUUID();
    await db.insert(issues).values({
      id,
      companyId: c.companyId,
      title: "Việc thử",
      status: "todo",
      createdByUserId: "owner-1",
      responsibleUserId: "owner-1",
      ...values,
    });
    return id;
  }

  async function approve(c: Company, issueId: string, stageId: string, actorAgentId: string | null, createdAt: Date, actorUserId: string | null = null) {
    await db.insert(issueExecutionDecisions).values({
      companyId: c.companyId,
      issueId,
      stageId,
      stageType: "review",
      actorAgentId,
      actorUserId,
      outcome: "approved",
      body: "ok",
      createdAt,
    });
  }

  async function comment(c: Company, issueId: string, authorAgentId: string, body: string, createdAt: Date) {
    const [row] = await db
      .insert(issueComments)
      .values({ companyId: c.companyId, issueId, authorAgentId, body, createdAt })
      .returning({ id: issueComments.id });
    return row!.id;
  }

  async function rootAtReviewer(c: Company) {
    const s = c.root.stages[0]!;
    return issue(c, {
      status: "in_review",
      assigneeAgentId: c.reviewerId,
      executionPolicy: c.root,
      executionState: state(c, "pending", s.id, c.reviewer, []),
    });
  }

  async function statusOf(issueId: string) {
    const [row] = await db.select().from(issues).where(eq(issues.id, issueId));
    return row!.status;
  }

  it("system done khi stage reviewer còn chờ bị 422 và issue giữ nguyên", async () => {
    const c = await company();
    const issueId = await rootAtReviewer(c);
    await expect(issueService(db).update(issueId, { status: "done" })).rejects.toMatchObject({
      status: 422,
      details: { code: "crew_gate_blocked" },
    });
    expect(await statusOf(issueId)).toBe("in_review");
  });

  it("agent xóa executionPolicy bị 422 crew_policy_locked", async () => {
    const c = await company();
    const issueId = await rootAtReviewer(c);
    await expect(
      issueService(db).update(issueId, { executionPolicy: null, actorAgentId: c.executorId }),
    ).rejects.toMatchObject({ status: 422, details: { code: "crew_policy_locked" } });
    const [row] = await db.select().from(issues).where(eq(issues.id, issueId));
    expect((row!.executionPolicy as { stages: unknown[] }).stages).toHaveLength(4);
  });

  it("system ghi blocked vẫn được", async () => {
    const c = await company();
    const issueId = await rootAtReviewer(c);
    const updated = await issueService(db).update(issueId, { status: "blocked" });
    expect(updated?.status).toBe("blocked");
  });

  it("system done issue không có policy Crew (issue phụ của hệ thống) vẫn được", async () => {
    const c = await company();
    const issueId = await issue(c, { status: "in_progress", createdByUserId: null });
    const updated = await issueService(db).update(issueId, { status: "done" });
    expect(updated?.status).toBe("done");
  });

  it("agent chuyển cancelled bị 422, board thì được", async () => {
    const c = await company();
    const issueId = await rootAtReviewer(c);
    await expect(
      issueService(db).update(issueId, { status: "cancelled", actorAgentId: c.executorId }),
    ).rejects.toMatchObject({
      status: 422,
      details: { code: "crew_gate_blocked", violations: ["agent_cancel_forbidden"] },
    });
    expect(await statusOf(issueId)).toBe("in_review");
    const updated = await issueService(db).update(issueId, { status: "cancelled", actorUserId: "owner-1" });
    expect(updated?.status).toBe("cancelled");
  });

  it("agent giao issue cho reviewer bị 422 crew_role_assignee", async () => {
    const c = await company();
    const issueId = await issue(c, { status: "in_progress", assigneeAgentId: c.executorId, executionPolicy: c.child });
    await expect(
      issueService(db).update(issueId, { assigneeAgentId: c.reviewerId, actorAgentId: c.executorId }),
    ).rejects.toMatchObject({ status: 422, details: { code: "crew_role_assignee" } });
  });

  it("board ép done thì được và ghi đúng một activity crew.policy.board_override", async () => {
    const c = await company();
    const issueId = await rootAtReviewer(c);
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

  it("company không có trong file cấu hình: hành vi stock, kể cả agent cancel và done", async () => {
    const c = await company("absent");
    const doneId = await issue(c, { status: "in_progress", assigneeAgentId: c.executorId });
    expect((await issueService(db).update(doneId, { status: "done", actorAgentId: c.executorId }))?.status).toBe("done");
    const cancelId = await issue(c, { status: "in_progress", assigneeAgentId: c.executorId });
    expect(
      (await issueService(db).update(cancelId, { status: "cancelled", actorAgentId: c.executorId }))?.status,
    ).toBe("cancelled");
  });

  it("cấu hình company thiếu trường: fail closed, agent không done được", async () => {
    const c = await company("invalid");
    const issueId = await issue(c, { status: "in_progress", assigneeAgentId: c.executorId, executionPolicy: c.child });
    await expect(
      issueService(db).update(issueId, { status: "done", actorAgentId: c.executorId }),
    ).rejects.toMatchObject({ status: 422, details: { violations: expect.arrayContaining(["roles_unconfigured"]) } });
  });

  it("mở lại bằng comment resume (update todo không actor) rồi executor done: 422, approval cũ không tính", async () => {
    const c = await company();
    const stageId = c.child.stages[0]!.id;
    const issueId = await issue(c, {
      status: "done",
      assigneeAgentId: c.reviewerId,
      executionPolicy: c.child,
      executionState: state(c, "completed", null, null, [stageId]),
    });
    await approve(c, issueId, stageId, c.reviewerId, minutesAgo(30));

    expect((await issueService(db).update(issueId, { status: "todo" }))?.status).toBe("todo");
    const resets = await db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.entityId, issueId), eq(activityLog.action, "crew.gate.cycle_reset")));
    expect(resets).toHaveLength(1);

    await expect(
      issueService(db).update(issueId, { status: "done", actorAgentId: c.executorId }),
    ).rejects.toMatchObject({ status: 422, details: { code: "crew_gate_blocked", violations: [`stage_unapproved:${stageId}`] } });
    expect(await statusOf(issueId)).toBe("todo");
  });

  it("mở lại để giao thêm việc: executor PATCH done lại đi vào stage reviewer, approval cũ vẫn không tính", async () => {
    const c = await company();
    const stageId = c.child.stages[0]!.id;
    const issueId = await issue(c, {
      status: "done",
      assigneeAgentId: c.reviewerId,
      executionPolicy: c.child,
      executionState: state(c, "completed", null, null, [stageId]),
    });
    await approve(c, issueId, stageId, c.reviewerId, minutesAgo(30));

    const reopened = await issueService(db).update(issueId, { status: "todo" });
    expect(reopened?.executionState).toBeNull();
    await issueService(db).update(issueId, {
      status: "in_progress",
      assigneeAgentId: c.executorId,
      actorUserId: "owner-1",
    });

    // Như route PATCH: transition stock rồi updateIssue.
    const [row] = await db.select().from(issues).where(eq(issues.id, issueId));
    const policy = normalizeIssueExecutionPolicy(row!.executionPolicy);
    const transition = applyIssueExecutionPolicyTransition({
      issue: row as never,
      policy,
      previousPolicy: policy,
      requestedStatus: "done",
      requestedAssigneePatch: {},
      actor: { agentId: c.executorId, userId: null },
    });
    const handedOff = await issueService(db).update(issueId, {
      status: "done",
      ...transition.patch,
      actorAgentId: c.executorId,
    });
    expect(handedOff?.status).toBe("in_review");
    expect(handedOff?.assigneeAgentId).toBe(c.reviewerId);
    expect(handedOff?.executionState).toMatchObject({ status: "pending", currentStageId: stageId });

    await expect(
      issueService(db).update(issueId, { status: "done", actorAgentId: c.executorId }),
    ).rejects.toMatchObject({ status: 422, details: { violations: [`stage_unapproved:${stageId}`] } });
  });

  it("issue gốc mở lại kèm docs cũ: executor done bị 422 ở mọi stage", async () => {
    const c = await company();
    const [sReview, sIntegrator, sOwner, sPush] = c.root.stages.map((s) => s.id) as [string, string, string, string];
    const issueId = await issue(c, {
      status: "done",
      assigneeUserId: "owner-1",
      executionPolicy: c.root,
      executionState: state(c, "completed", null, null, [sReview, sIntegrator, sOwner]),
    });
    await approve(c, issueId, sReview, c.reviewerId, minutesAgo(40));
    await approve(c, issueId, sIntegrator, c.integratorId, minutesAgo(30));
    await approve(c, issueId, sOwner, null, minutesAgo(20), "owner-1");
    await comment(c, issueId, c.integratorId, docsLine(0), minutesAgo(35));

    await issueService(db).update(issueId, { status: "todo" });
    await expect(
      issueService(db).update(issueId, { status: "done", actorAgentId: c.executorId }),
    ).rejects.toMatchObject({
      status: 422,
      details: {
        violations: [
          `stage_unapproved:${sReview}`,
          `stage_unapproved:${sIntegrator}`,
          `stage_unapproved:${sOwner}`,
          `stage_unapproved:${sPush}`,
          "docs_stale",
          "push_missing",
        ],
      },
    });
  });

  it("reviewer mở lại issue của mình rồi tự done: 422", async () => {
    const c = await company();
    const stageId = c.child.stages[0]!.id;
    const issueId = await issue(c, {
      status: "done",
      assigneeAgentId: c.reviewerId,
      executionPolicy: c.child,
      executionState: state(c, "completed", null, null, [stageId]),
    });
    await approve(c, issueId, stageId, c.reviewerId, minutesAgo(30));
    await issueService(db).update(issueId, { status: "in_progress", actorAgentId: c.reviewerId });
    await expect(
      issueService(db).update(issueId, { status: "done", actorAgentId: c.reviewerId }),
    ).rejects.toMatchObject({ status: 422, details: { code: "crew_gate_blocked" } });
  });

  it("reviewer là assignee hiện tại: approval của chính nó không tính dù không có mốc mở lại", async () => {
    const c = await company();
    const stageId = c.child.stages[0]!.id;
    const issueId = await issue(c, { status: "in_progress", assigneeAgentId: c.reviewerId, executionPolicy: c.child });
    await approve(c, issueId, stageId, c.reviewerId, minutesAgo(5));
    await expect(
      issueService(db).update(issueId, { status: "done", actorAgentId: c.reviewerId }),
    ).rejects.toMatchObject({ status: 422, details: { violations: [`stage_unapproved:${stageId}`] } });
  });

  it("duyệt trong chính lệnh ghi: participant đang chờ thì qua, executor thì bị chặn", async () => {
    const c = await company();
    const stageId = c.child.stages[0]!.id;
    const seed = () =>
      issue(c, {
        status: "in_review",
        assigneeAgentId: c.reviewerId,
        executionPolicy: c.child,
        executionState: state(c, "pending", stageId, c.reviewer, []),
      });
    const approveWrite = (actorAgentId: string) => ({
      status: "done" as const,
      executionState: state(c, "completed", null, null, [stageId]),
      actorAgentId,
    });
    const ok = await seed();
    expect((await issueService(db).update(ok, approveWrite(c.reviewerId)))?.status).toBe("done");
    const bad = await seed();
    await expect(issueService(db).update(bad, approveWrite(c.executorId))).rejects.toMatchObject({
      status: 422,
      details: { violations: [`stage_unapproved:${stageId}`] },
    });
  });

  it("bằng chứng docs: comment mới nhất chưa xóa của participant stage integrator", async () => {
    const c = await company();
    const [sReview, sIntegrator, sOwner] = c.root.stages.map((s) => s.id) as [string, string, string];
    const issueId = await issue(c, {
      status: "in_review",
      assigneeAgentId: c.integratorId,
      executionPolicy: c.root,
      executionState: state(c, "pending", sIntegrator, c.integrator, [sReview]),
    });
    await approve(c, issueId, sReview, c.reviewerId, minutesAgo(60));
    await comment(c, issueId, c.integratorId, docsLine(0), minutesAgo(50));
    const failedId = await comment(c, issueId, c.integratorId, docsLine(1), minutesAgo(40));
    await comment(c, issueId, c.executorId, docsLine(0), minutesAgo(30));
    const integratorWrite = {
      status: "in_review" as const,
      executionState: state(c, "pending", sOwner, { type: "user", agentId: null, userId: "owner-1" }, [sReview, sIntegrator]),
      actorAgentId: c.integratorId,
    };

    await expect(issueService(db).update(issueId, integratorWrite)).rejects.toMatchObject({
      status: 422,
      details: { violations: ["docs_failed:1"] },
    });
    await db.update(issueComments).set({ deletedAt: new Date(), body: "[deleted]" }).where(eq(issueComments.id, failedId));
    const updated = await issueService(db).update(issueId, integratorWrite);
    expect((updated?.executionState as { completedStageIds: string[] }).completedStageIds).toEqual([sReview, sIntegrator]);
  });

  // Như route PATCH: transition stock, updateIssue rồi chèn decision trong cùng transaction.
  async function act(
    c: Company,
    issueId: string,
    actor: { agentId: string } | { userId: string },
    requestedStatus: string,
  ) {
    const [row] = await db.select().from(issues).where(eq(issues.id, issueId));
    const policy = normalizeIssueExecutionPolicy(row!.executionPolicy);
    const agentId = "agentId" in actor ? actor.agentId : null;
    const userId = "userId" in actor ? actor.userId : null;
    const transition = applyIssueExecutionPolicyTransition({
      issue: row as never,
      policy,
      previousPolicy: policy,
      requestedStatus,
      requestedAssigneePatch: {},
      actor: { agentId, userId },
      allowBoardOverride: userId !== null,
      commentBody: "ok",
    });
    const decisionId = transition.decision ? randomUUID() : null;
    if (decisionId) {
      transition.patch.executionState = { ...(transition.patch.executionState as object), lastDecisionId: decisionId };
    }
    return db.transaction(async (tx) => {
      const updated = await issueService(db).update(
        issueId,
        { status: requestedStatus as never, ...transition.patch, actorAgentId: agentId, actorUserId: userId },
        tx,
        [],
        [],
      );
      if (transition.decision && decisionId) {
        await tx.insert(issueExecutionDecisions).values({
          id: decisionId,
          companyId: c.companyId,
          issueId,
          stageId: transition.decision.stageId,
          stageType: transition.decision.stageType,
          actorAgentId: agentId,
          actorUserId: userId,
          outcome: transition.decision.outcome,
          body: transition.decision.body,
        });
      }
      return updated;
    });
  }

  async function postComment(c: Company, issueId: string, authorAgentId: string, body: string) {
    await db.insert(issueComments).values({ companyId: c.companyId, issueId, authorAgentId, body });
  }

  async function runRootToPush(c: Company, opts: { mergeBeforeOwner?: boolean } = {}) {
    const issueId = await issue(c, { status: "in_progress", assigneeAgentId: c.executorId, executionPolicy: c.root });
    const [sReview, sIntegrator, sOwner, sPush] = c.root.stages.map((s) => s.id) as [string, string, string, string];
    expect(await act(c, issueId, { agentId: c.executorId }, "done")).toMatchObject({
      status: "in_review",
      assigneeAgentId: c.reviewerId,
      executionState: { currentStageId: sReview },
    });
    expect(await act(c, issueId, { agentId: c.reviewerId }, "done")).toMatchObject({
      assigneeAgentId: c.integratorId,
      executionState: { currentStageId: sIntegrator },
    });
    await postComment(c, issueId, c.integratorId, docsLine(0));
    expect(await act(c, issueId, { agentId: c.integratorId }, "done")).toMatchObject({
      assigneeUserId: "owner-1",
      executionState: { currentStageId: sOwner },
    });
    if (opts.mergeBeforeOwner) await postComment(c, issueId, c.integratorId, `crew-merge sha=${SHA_HEAD} branch=main pushed=yes`);
    expect(await act(c, issueId, { userId: "owner-1" }, "done")).toMatchObject({
      status: "in_review",
      assigneeAgentId: c.integratorId,
      executionState: { status: "pending", currentStageId: sPush, currentParticipant: { agentId: c.integratorId } },
    });
    return issueId;
  }

  it("luồng gốc 4 stage: reviewer → integrator docs → owner → integrator crew-merge pushed=yes → done", async () => {
    const c = await company();
    const issueId = await runRootToPush(c);
    await postComment(c, issueId, c.integratorId, `crew-merge sha=${SHA_HEAD} branch=main pushed=yes`);
    expect((await act(c, issueId, { agentId: c.integratorId }, "done"))?.status).toBe("done");
    const overrides = await db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.entityId, issueId), eq(activityLog.action, "crew.policy.board_override")));
    expect(overrides).toHaveLength(0);
  });

  it("luồng gốc 4 stage: integrator thiếu docs ở stage 2 bị 422 docs_missing", async () => {
    const c = await company();
    const issueId = await issue(c, { status: "in_progress", assigneeAgentId: c.executorId, executionPolicy: c.root });
    await act(c, issueId, { agentId: c.executorId }, "done");
    await act(c, issueId, { agentId: c.reviewerId }, "done");
    await expect(act(c, issueId, { agentId: c.integratorId }, "done")).rejects.toMatchObject({
      status: 422,
      details: { violations: ["docs_missing"] },
    });
  });

  it("luồng gốc 4 stage: stage push thiếu, cũ hơn owner, lệch sha hoặc pushed=no đều 422", async () => {
    const c = await company();
    const expectPush = async (issueId: string, violation: string) =>
      expect(act(c, issueId, { agentId: c.integratorId }, "done")).rejects.toMatchObject({
        status: 422,
        details: { code: "crew_gate_blocked", violations: [violation] },
      });

    await expectPush(await runRootToPush(c), "push_missing");

    await expectPush(await runRootToPush(c, { mergeBeforeOwner: true }), "push_stale");

    const mismatch = await runRootToPush(c);
    await postComment(c, mismatch, c.integratorId, `crew-merge sha=${SHA_BASE} branch=main pushed=yes`);
    await expectPush(mismatch, "push_sha_mismatch");

    const failed = await runRootToPush(c);
    await postComment(c, failed, c.integratorId, `crew-merge sha=${SHA_HEAD} branch=main pushed=no`);
    await expectPush(failed, "push_missing");

    const byOther = await runRootToPush(c);
    await postComment(c, byOther, c.executorId, `crew-merge sha=${SHA_HEAD} branch=main pushed=yes`);
    await expectPush(byOther, "push_missing");
  });

  it("issue gốc cũ 3 stage vẫn chạy như trước: owner duyệt là done", async () => {
    const c = await company();
    const issueId = await issue(c, { status: "in_progress", assigneeAgentId: c.executorId, executionPolicy: c.legacyRoot });
    await act(c, issueId, { agentId: c.executorId }, "done");
    await act(c, issueId, { agentId: c.reviewerId }, "done");
    await postComment(c, issueId, c.integratorId, docsLine(0));
    await act(c, issueId, { agentId: c.integratorId }, "done");
    expect((await act(c, issueId, { userId: "owner-1" }, "done"))?.status).toBe("done");
  });

  it("push lỗi ở stage 4 → recovery chuyển blocked → owner comment mở về todo: stage 4 vẫn chờ integrator, push lại rồi done", async () => {
    const c = await company();
    const issueId = await runRootToPush(c);
    const sPush = c.root.stages[3]!.id;
    await postComment(c, issueId, c.integratorId, `crew-merge sha=${SHA_HEAD} branch=main pushed=no`);
    // Như recovery stock (escalateStrandedAssignedIssue) rồi comment route (shouldImplicitlyMoveCommentedIssueToTodo):
    // cả hai gọi issueService.update không actor.
    expect((await issueService(db).update(issueId, { status: "blocked", blockedByIssueIds: [] }))?.status).toBe("blocked");
    const reopened = await issueService(db).update(issueId, { status: "todo" });
    expect(reopened).toMatchObject({
      status: "todo",
      assigneeAgentId: c.integratorId,
      executionState: { status: "pending", currentStageId: sPush, currentParticipant: { agentId: c.integratorId } },
    });
    await postComment(c, issueId, c.integratorId, `crew-merge sha=${SHA_HEAD} branch=main pushed=yes`);
    expect((await act(c, issueId, { agentId: c.integratorId }, "done"))?.status).toBe("done");
  });

  it("issue blocked ở stage 4: owner đặt lại in_review thì stock giữ stage 4 và giao integrator", async () => {
    const c = await company();
    const issueId = await runRootToPush(c);
    const sPush = c.root.stages[3]!.id;
    await issueService(db).update(issueId, { status: "blocked", blockedByIssueIds: [] });
    expect(await act(c, issueId, { userId: "owner-1" }, "in_review")).toMatchObject({
      status: "in_review",
      assigneeAgentId: c.integratorId,
      executionState: { status: "pending", currentStageId: sPush },
    });
    await postComment(c, issueId, c.integratorId, `crew-merge sha=${SHA_HEAD} branch=main pushed=yes`);
    expect((await act(c, issueId, { agentId: c.integratorId }, "done"))?.status).toBe("done");
  });

  it("owner comment mở lại issue gốc đã done (assignee là integrator): giao lại executor, luồng chạy lại từ reviewer", async () => {
    const c = await company();
    const issueId = await runRootToPush(c);
    await postComment(c, issueId, c.integratorId, `crew-merge sha=${SHA_HEAD} branch=main pushed=yes`);
    await act(c, issueId, { agentId: c.integratorId }, "done");
    // Như comment route: svc.update({ status: "todo" }) không actor, rồi đánh thức assignee đọc lại sau khi ghi.
    const reopened = await issueService(db).update(issueId, { status: "todo" });
    expect(reopened).toMatchObject({ status: "todo", assigneeAgentId: c.executorId, executionState: null });
    const [reset] = await db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.entityId, issueId), eq(activityLog.action, "crew.gate.cycle_reset")));
    expect(reset!.details).toMatchObject({ reassignedFromAgentId: c.integratorId, reassignedToAgentId: c.executorId });

    const [sReview, sIntegrator] = c.root.stages.map((s) => s.id) as [string, string];
    expect(await act(c, issueId, { agentId: c.executorId }, "done")).toMatchObject({
      status: "in_review",
      assigneeAgentId: c.reviewerId,
      executionState: { currentStageId: sReview, returnAssignee: { agentId: c.executorId } },
    });
    expect(await act(c, issueId, { agentId: c.reviewerId }, "done")).toMatchObject({
      assigneeAgentId: c.integratorId,
      executionState: { currentStageId: sIntegrator },
    });
  });

  it("mở lại khi không còn returnAssignee: lấy tác giả crew-commit mới nhất của vòng trước", async () => {
    const c = await company();
    const issueId = await issue(c, {
      status: "done",
      assigneeAgentId: c.integratorId,
      executionPolicy: c.root,
      executionState: null,
    });
    await postComment(c, issueId, c.reviewerId, `crew-commit sha=${SHA_BASE} branch=x tests=t result=pass`);
    await postComment(c, issueId, c.executorId, `crew-commit sha=${SHA_HEAD} branch=crew/x tests=pnpm result=pass`);
    expect(await issueService(db).update(issueId, { status: "todo" })).toMatchObject({ assigneeAgentId: c.executorId });
  });

  it("mở lại mà không xác định được executor: giữ assignee và ghi activity", async () => {
    const c = await company();
    const issueId = await issue(c, {
      status: "done",
      assigneeAgentId: c.integratorId,
      executionPolicy: c.root,
      executionState: null,
    });
    expect(await issueService(db).update(issueId, { status: "todo" })).toMatchObject({ assigneeAgentId: c.integratorId });
    const rows = await db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.entityId, issueId), eq(activityLog.action, "crew.gate.reopen_executor_unknown")));
    expect(rows).toHaveLength(1);
  });

  it("mở lại với assignee không phải participant (executor) hoặc lệnh ghi tự đặt assignee: không đổi assignee", async () => {
    const c = await company();
    const stageId = c.child.stages[0]!.id;
    const own = await issue(c, {
      status: "done",
      assigneeAgentId: c.executorId,
      executionPolicy: c.child,
      executionState: state(c, "completed", null, null, [stageId]),
    });
    expect(await issueService(db).update(own, { status: "todo" })).toMatchObject({ assigneeAgentId: c.executorId });
    const explicit = await issue(c, {
      status: "done",
      assigneeAgentId: c.reviewerId,
      executionPolicy: c.child,
      executionState: state(c, "completed", null, null, [stageId]),
    });
    const other = randomUUID();
    await db.insert(agents).values({
      id: other,
      companyId: c.companyId,
      name: "Trợ Lý",
      role: "engineer",
      status: "idle",
      adapterType: "process",
      adapterConfig: {},
      permissions: {},
    });
    expect(
      await issueService(db).update(explicit, { status: "todo", assigneeAgentId: other, actorUserId: "owner-1" }),
    ).toMatchObject({ assigneeAgentId: other });
  });
});

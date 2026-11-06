import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import {
  activityLog,
  agents,
  chatConversations,
  chatEndpoints,
  companies,
  companyMemberships,
  createDb,
  issueComments,
  issueExecutionDecisions,
  issues,
  issueThreadInteractions,
  projects,
  toolApplications,
  toolConnections,
} from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import {
  type BugFindingRunFact,
  CREW_BUG_FINDING_RESTART_ACTION,
  CREW_OWNER_CHANGES_RESTART_ACTION,
  setBugFindingRunReader,
} from "../crew/issue-gate.ts";
import { buildCrewPolicy, CREW_POLICY_CONFIG_ENV } from "../crew/issue-policy.ts";
import {
  applyIssueExecutionPolicyTransition,
  normalizeIssueExecutionPolicy,
} from "../services/issue-execution-policy.js";
import { issueService } from "../services/issues.js";
import { crewTable } from "../crew/machine-pin.js";
import { applyCrewMachineTables } from "./helpers/crew-machine-tables.js";

// Hook H2 (first line of runUpdate) through the real issue service: every caller of
// issueService(db).update goes through the Crew gate, not only the REST route.
const support = await getEmbeddedPostgresTestSupport();
const suite = support.supported ? describe : describe.skip;

type Principal = { type: "agent" | "user"; agentId: string | null; userId: string | null };

const SHA_BASE = "a".repeat(40);
const SHA_HEAD = "b".repeat(40);
const SHA_FIX = "c".repeat(40);
const docsLineFor = (sha: string, exit: number) => `crew-docs-check commit=${sha} range=${SHA_BASE}..${sha} exit=${exit}`;
const docsLine = (exit: number) => docsLineFor(SHA_HEAD, exit);
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
      rootBf: buildCrewPolicy("root-bf", roles, "owner-1"),
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

  it("agent PATCH override độc hại bị 422 và DB không đổi", async () => {
    const c = await company();
    const issueId = await issue(c, { status: "in_progress", assigneeAgentId: c.executorId });
    await expect(issueService(db).update(issueId, {
      assigneeAdapterOverrides: { useProjectWorkspace: true, adapterConfig: { extraArgs: ["--plugin-dir", "/tmp/x"], env: {}, command: "/bin/sh", model: "other-provider-model" } },
      actorAgentId: c.executorId,
    } as never)).rejects.toMatchObject({ status: 422, details: { code: "crew_override_forbidden", violations: ["useProjectWorkspace", "adapterConfig.extraArgs", "adapterConfig.env", "adapterConfig.command", "adapterConfig.model:other-provider-model"] } });
    const [row] = await db.select().from(issues).where(eq(issues.id, issueId));
    expect(row!.assigneeAdapterOverrides ?? null).toBeNull();
  });

  it("agent PATCH model/effort hợp lệ hoặc null, board đặt override khác", async () => {
    const c = await company();
    const issueId = await issue(c, { status: "in_progress", assigneeAgentId: c.executorId });
    await issueService(db).update(issueId, { assigneeAdapterOverrides: { adapterConfig: { model: "claude-sonnet-5-5", effort: "medium" } }, actorAgentId: c.executorId } as never);
    await issueService(db).update(issueId, { assigneeAdapterOverrides: null, actorAgentId: c.executorId } as never);
    await issueService(db).update(issueId, { assigneeAdapterOverrides: { adapterConfig: { extraArgs: ["--verbose"] } }, actorUserId: "owner-1" } as never);
    const [row] = await db.select().from(issues).where(eq(issues.id, issueId));
    expect(row!.assigneeAdapterOverrides).toEqual({ adapterConfig: { extraArgs: ["--verbose"] } });
  });

  async function runtimeAgent(c: Company, adapterType: string) {
    const id = randomUUID();
    await db.insert(agents).values({
      id,
      companyId: c.companyId,
      name: `Executor ${adapterType}`,
      role: "engineer",
      status: "idle",
      adapterType,
      adapterConfig: {},
      permissions: {},
      runtimeConfig: { heartbeat: { enabled: false, wakeOnDemand: false, maxConcurrentRuns: 1 } },
    });
    return id;
  }

  it("agent PATCH giao sang executor codex kèm override: kiểm theo runtime của assignee mới", async () => {
    const c = await company();
    const codexId = await runtimeAgent(c, "codex_local");
    const issueId = await issue(c, { status: "todo", assigneeAgentId: c.executorId });
    await expect(issueService(db).update(issueId, {
      assigneeAgentId: codexId,
      assigneeAdapterOverrides: { adapterConfig: { model: "gpt-6-sol", effort: "high" } },
      actorAgentId: c.executorId,
    } as never)).rejects.toMatchObject({ status: 422, details: { code: "crew_override_forbidden", violations: ["adapterConfig.effort"] } });
    let [row] = await db.select().from(issues).where(eq(issues.id, issueId));
    expect(row!.assigneeAgentId).toBe(c.executorId);
    await issueService(db).update(issueId, {
      assigneeAgentId: codexId,
      assigneeAdapterOverrides: { adapterConfig: { model: "gpt-6-sol", modelReasoningEffort: "high" } },
      actorAgentId: c.executorId,
    } as never);
    [row] = await db.select().from(issues).where(eq(issues.id, issueId));
    expect(row!.assigneeAgentId).toBe(codexId);
    expect(row!.assigneeAdapterOverrides).toEqual({ adapterConfig: { model: "gpt-6-sol", modelReasoningEffort: "high" } });
  });

  it("agent PATCH chỉ override: kiểm theo runtime của assignee đang giữ issue; bỏ assignee thì luật Claude", async () => {
    const c = await company();
    const opencodeId = await runtimeAgent(c, "opencode_local");
    const issueId = await issue(c, { status: "todo", assigneeAgentId: opencodeId });
    await expect(issueService(db).update(issueId, {
      assigneeAdapterOverrides: { adapterConfig: { model: "claude-opus-5-5" } },
      actorAgentId: c.executorId,
    } as never)).rejects.toMatchObject({ status: 422, details: { violations: ["adapterConfig.model:claude-opus-5-5@opencode_local"] } });
    await expect(issueService(db).update(issueId, {
      assigneeAdapterOverrides: { adapterConfig: { model: "opencode-go/glm-5.3" } },
      actorAgentId: c.executorId,
    } as never)).resolves.toBeDefined();
    await expect(issueService(db).update(issueId, {
      assigneeAgentId: null,
      assigneeAdapterOverrides: { adapterConfig: { model: "opencode-go/glm-5.3" } },
      actorAgentId: c.executorId,
    } as never)).rejects.toMatchObject({ status: 422, details: { violations: ["adapterConfig.model:opencode-go/glm-5.3"] } });
  });

  it("company ngoài cấu hình giữ cách PATCH stock", async () => {
    const c = await company("absent");
    const issueId = await issue(c, { status: "in_progress", assigneeAgentId: c.executorId });
    await expect(issueService(db).update(issueId, { assigneeAdapterOverrides: { adapterConfig: { extraArgs: [] } }, actorAgentId: c.executorId } as never)).resolves.toBeDefined();
  });

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
    extra: { description?: string } = {},
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
        { status: requestedStatus as never, ...extra, ...transition.patch, actorAgentId: agentId, actorUserId: userId },
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

  it("luồng gốc 4 stage: integrator mở pull request (crew-merge pushed=pr) rồi done kèm mục Merge request trong mô tả", async () => {
    const c = await company();
    const issueId = await runRootToPush(c);
    const pr = "https://github.com/acme/app/pull/12";
    await postComment(c, issueId, c.integratorId, `crew-merge sha=${SHA_HEAD} branch=main pushed=pr pr=${pr}\n\nPR đang mở`);
    const description = `Yêu cầu\n\n## Tổng kết của Trợ Lý\n\n### Kết quả\n- Xong.\n\n### Merge request\n\n- Pull request: ${pr}\n`;
    const done = await act(c, issueId, { agentId: c.integratorId }, "done", { description });
    expect(done).toMatchObject({ status: "done", description });
  });

  const EXECUTOR_OVERRIDES = { adapterConfig: { model: "claude-sonnet-5-5", effort: "medium" } };
  const ROOT_REVIEWER_OVERRIDES = { adapterConfig: { model: "claude-opus-5-5", effort: "high" } };

  async function setAdapterType(agentId: string, adapterType: string) {
    await db.update(agents).set({ adapterType }).where(eq(agents.id, agentId));
  }

  it("reviewer không chạy claude_local nhận issue gốc: không áp opus, override về null", async () => {
    for (const adapterType of ["codex_local", "process"]) {
      const c = await company();
      await setAdapterType(c.reviewerId, adapterType);
      const issueId = await issue(c, {
        status: "in_progress",
        assigneeAgentId: c.executorId,
        assigneeAdapterOverrides: EXECUTOR_OVERRIDES,
        executionPolicy: c.root,
      });
      expect(await act(c, issueId, { agentId: c.executorId }, "done")).toMatchObject({
        status: "in_review",
        assigneeAgentId: c.reviewerId,
        assigneeAdapterOverrides: null,
      });
    }
  });

  it("reviewer chuyển issue gốc sang integrator: override opus bị xóa về null", async () => {
    const c = await company();
    await setAdapterType(c.reviewerId, "claude_local");
    const issueId = await issue(c, { status: "in_progress", assigneeAgentId: c.executorId, executionPolicy: c.root });
    await act(c, issueId, { agentId: c.executorId }, "done");
    expect(await act(c, issueId, { agentId: c.reviewerId }, "done")).toMatchObject({
      assigneeAgentId: c.integratorId,
      assigneeAdapterOverrides: null,
    });
  });

  it("reviewer Claude nhận issue gốc: override opus-5-5/high thay cho override của executor", async () => {
    const c = await company();
    await setAdapterType(c.reviewerId, "claude_local");
    const issueId = await issue(c, {
      status: "in_progress",
      assigneeAgentId: c.executorId,
      assigneeAdapterOverrides: EXECUTOR_OVERRIDES,
      executionPolicy: c.root,
    });
    expect(await act(c, issueId, { agentId: c.executorId }, "done")).toMatchObject({
      status: "in_review",
      assigneeAgentId: c.reviewerId,
      assigneeAdapterOverrides: ROOT_REVIEWER_OVERRIDES,
    });
  });

  it("reviewer Claude nhận gốc của yêu cầu research: không áp opus, chạy theo cấu hình agent", async () => {
    const c = await company();
    await setAdapterType(c.reviewerId, "claude_local");
    const research = buildCrewPolicy(
      "research",
      { reviewerAgentId: c.reviewerId, integratorAgentId: c.integratorId },
      "owner-1",
    );
    const issueId = await issue(c, {
      status: "in_progress",
      assigneeAgentId: c.executorId,
      assigneeAdapterOverrides: EXECUTOR_OVERRIDES,
      executionPolicy: research,
    });
    expect(await act(c, issueId, { agentId: c.executorId }, "done")).toMatchObject({
      status: "in_review",
      assigneeAgentId: c.reviewerId,
      assigneeAdapterOverrides: null,
    });
  });

  it("reviewer Claude nhận issue con: không override, chạy theo cấu hình agent", async () => {
    const c = await company();
    const rootId = await issue(c, { status: "in_progress", assigneeAgentId: c.executorId, executionPolicy: c.root });
    const childId = await issue(c, {
      parentId: rootId,
      status: "in_progress",
      assigneeAgentId: c.executorId,
      assigneeAdapterOverrides: EXECUTOR_OVERRIDES,
      executionPolicy: c.child,
    });
    expect(await act(c, childId, { agentId: c.executorId }, "done")).toMatchObject({
      status: "in_review",
      assigneeAgentId: c.reviewerId,
      assigneeAdapterOverrides: null,
    });
  });

  it("issue gốc review lại sau yêu cầu sửa: executor lấy lại override của mình, reviewer vẫn opus-5-5", async () => {
    const c = await company();
    await setAdapterType(c.reviewerId, "claude_local");
    const issueId = await issue(c, {
      status: "in_progress",
      assigneeAgentId: c.executorId,
      assigneeAdapterOverrides: EXECUTOR_OVERRIDES,
      executionPolicy: c.root,
    });
    await act(c, issueId, { agentId: c.executorId }, "done");
    expect(await act(c, issueId, { agentId: c.reviewerId }, "in_progress")).toMatchObject({
      assigneeAgentId: c.executorId,
      assigneeAdapterOverrides: EXECUTOR_OVERRIDES,
      executionState: { status: "changes_requested" },
    });
    expect(await act(c, issueId, { agentId: c.executorId }, "done")).toMatchObject({
      status: "in_review",
      assigneeAgentId: c.reviewerId,
      assigneeAdapterOverrides: ROOT_REVIEWER_OVERRIDES,
    });
  });

  async function rootAtOwner(c: Company) {
    const issueId = await issue(c, { status: "in_progress", assigneeAgentId: c.executorId, executionPolicy: c.root });
    await act(c, issueId, { agentId: c.executorId }, "done");
    await act(c, issueId, { agentId: c.reviewerId }, "done");
    await postComment(c, issueId, c.integratorId, docsLine(0));
    await act(c, issueId, { agentId: c.integratorId }, "done");
    return issueId;
  }

  async function restartActivities(issueId: string) {
    return db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.entityId, issueId), eq(activityLog.action, CREW_OWNER_CHANGES_RESTART_ACTION)));
  }

  const prDone = async (c: Company, issueId: string, sha: string) => {
    const pr = "https://github.com/acme/app/pull/32";
    await postComment(c, issueId, c.integratorId, `crew-merge sha=${sha} branch=main pushed=pr pr=${pr}\n`);
    const description = `Yêu cầu\n\n## Tổng kết của Trợ Lý\n\n### Merge request\n\n- Pull request: ${pr}\n`;
    return act(c, issueId, { agentId: c.integratorId }, "done", { description });
  };

  it("owner yêu cầu sửa ở stage owner, Trợ Lý thêm con sửa có code mới: gốc chạy lại reviewer → integrator docs mới → owner → PR đúng commit mới", async () => {
    const c = await company();
    const issueId = await rootAtOwner(c);
    const [sReview, sIntegrator, sOwner, sPush] = c.root.stages.map((s) => s.id) as [string, string, string, string];
    const ownerP = { type: "user", agentId: null, userId: "owner-1" };

    // 1. Owner yêu cầu sửa ở stage 3: việc về Trợ Lý, mọi stage đã xong bị xóa để lần nộp sau chạy lại từ stage 1.
    expect(await act(c, issueId, { userId: "owner-1" }, "in_progress")).toMatchObject({
      status: "in_progress",
      assigneeAgentId: c.executorId,
      executionState: {
        status: "changes_requested",
        currentStageId: null,
        currentStageType: "approval",
        currentParticipant: ownerP,
        completedStageIds: [],
        lastDecisionOutcome: "changes_requested",
      },
    });
    expect(await restartActivities(issueId)).toMatchObject([
      { actorType: "user", actorId: "owner-1", details: { stageId: sOwner, clearedStageIds: [sReview, sIntegrator] } },
    ]);

    // 2. Trợ Lý thêm con sửa; executor làm, reviewer duyệt.
    const childId = await issue(c, {
      parentId: issueId,
      status: "in_progress",
      assigneeAgentId: c.executorId,
      executionPolicy: c.child,
      createdByUserId: null,
      createdByAgentId: c.executorId,
    });
    await act(c, childId, { agentId: c.executorId }, "done");
    expect(await act(c, childId, { agentId: c.reviewerId }, "done")).toMatchObject({ status: "done" });

    // 3–4. Trợ Lý nộp lại: gốc về stage 1 (reviewer), không về thẳng owner.
    expect(await act(c, issueId, { agentId: c.executorId }, "done")).toMatchObject({
      status: "in_review",
      assigneeAgentId: c.reviewerId,
      executionState: { status: "pending", currentStageId: sReview, completedStageIds: [] },
    });
    expect(await act(c, issueId, { agentId: c.reviewerId }, "done")).toMatchObject({
      assigneeAgentId: c.integratorId,
      executionState: { status: "pending", currentStageId: sIntegrator, completedStageIds: [sReview] },
    });

    // 5. Stage 2 đòi bằng chứng docs mới hơn yêu cầu sửa của owner: bằng chứng của vòng trước bị 422 docs_stale.
    await expect(act(c, issueId, { agentId: c.integratorId }, "done")).rejects.toMatchObject({
      status: 422,
      details: { code: "crew_gate_blocked", violations: ["docs_stale"] },
    });
    await postComment(c, issueId, c.integratorId, docsLineFor(SHA_FIX, 0));
    expect(await act(c, issueId, { agentId: c.integratorId }, "done")).toMatchObject({
      assigneeUserId: "owner-1",
      executionState: { status: "pending", currentStageId: sOwner, completedStageIds: [sReview, sIntegrator] },
    });

    // 6. Owner duyệt.
    expect(await act(c, issueId, { userId: "owner-1" }, "done")).toMatchObject({
      assigneeAgentId: c.integratorId,
      executionState: { status: "pending", currentStageId: sPush, completedStageIds: [sReview, sIntegrator, sOwner] },
    });

    // 7. Stage 4: pull request phải đúng merged commit mới (có code của con sửa), commit cũ bị 422.
    await postComment(c, issueId, c.integratorId, `crew-merge sha=${SHA_HEAD} branch=main pushed=pr pr=https://github.com/acme/app/pull/32\n`);
    await expect(act(c, issueId, { agentId: c.integratorId }, "done")).rejects.toMatchObject({
      status: 422,
      details: { code: "crew_gate_blocked", violations: ["push_sha_mismatch"] },
    });
    expect(await prDone(c, issueId, SHA_FIX)).toMatchObject({ status: "done" });
    const overrides = await db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.entityId, issueId), eq(activityLog.action, "crew.policy.board_override")));
    expect(overrides).toHaveLength(0);
  });

  it("owner yêu cầu sửa không cần code mới: vẫn chạy lại từ reviewer, integrator ghi lại bằng chứng docs cho cùng commit", async () => {
    const c = await company();
    const issueId = await rootAtOwner(c);
    const [sReview, sIntegrator, sOwner, sPush] = c.root.stages.map((s) => s.id) as [string, string, string, string];
    await act(c, issueId, { userId: "owner-1" }, "in_progress");
    expect(await act(c, issueId, { agentId: c.executorId }, "done")).toMatchObject({
      assigneeAgentId: c.reviewerId,
      executionState: { status: "pending", currentStageId: sReview, completedStageIds: [] },
    });
    await act(c, issueId, { agentId: c.reviewerId }, "done");
    await expect(act(c, issueId, { agentId: c.integratorId }, "done")).rejects.toMatchObject({
      details: { violations: ["docs_stale"] },
    });
    await postComment(c, issueId, c.integratorId, docsLine(0));
    expect(await act(c, issueId, { agentId: c.integratorId }, "done")).toMatchObject({
      executionState: { currentStageId: sOwner, completedStageIds: [sReview, sIntegrator] },
    });
    expect(await act(c, issueId, { userId: "owner-1" }, "done")).toMatchObject({ executionState: { currentStageId: sPush } });
    expect(await prDone(c, issueId, SHA_HEAD)).toMatchObject({ status: "done" });
  });

  it("issue gốc đã ở trạng thái owner yêu cầu sửa từ trước khi có luật chạy lại: nộp lại về stage owner, PR với bằng chứng docs cũ vẫn done", async () => {
    const c = await company();
    const [sReview, sIntegrator, sOwner, sPush] = c.root.stages.map((s) => s.id) as [string, string, string, string];
    const ownerP = { type: "user" as const, agentId: null, userId: "owner-1" };
    const issueId = await issue(c, {
      status: "in_progress",
      assigneeAgentId: c.executorId,
      executionPolicy: c.root,
      executionState: {
        ...state(c, "pending", sOwner, ownerP, [sReview, sIntegrator]),
        status: "changes_requested",
        lastDecisionOutcome: "changes_requested",
      },
    });
    await approve(c, issueId, sReview, c.reviewerId, minutesAgo(30));
    await comment(c, issueId, c.integratorId, docsLine(0), minutesAgo(25));
    await approve(c, issueId, sIntegrator, c.integratorId, minutesAgo(20));
    await db.insert(issueExecutionDecisions).values({
      companyId: c.companyId,
      issueId,
      stageId: sOwner,
      stageType: "approval",
      actorUserId: "owner-1",
      outcome: "changes_requested",
      body: "sửa",
      createdAt: minutesAgo(10),
    });
    expect(await act(c, issueId, { agentId: c.executorId }, "done")).toMatchObject({
      assigneeUserId: "owner-1",
      executionState: { status: "pending", currentStageId: sOwner, completedStageIds: [sReview, sIntegrator] },
    });
    expect(await restartActivities(issueId)).toHaveLength(0);
    expect(await act(c, issueId, { userId: "owner-1" }, "done")).toMatchObject({ executionState: { currentStageId: sPush } });
    expect(await prDone(c, issueId, SHA_HEAD)).toMatchObject({ status: "done" });
  });

  it("integrator yêu cầu sửa ở stage push (giao lỗi): nộp lại về stage push, không chạy lại từ đầu, bằng chứng docs vẫn còn hiệu lực", async () => {
    const c = await company();
    const issueId = await runRootToPush(c);
    const [sReview, sIntegrator, sOwner, sPush] = c.root.stages.map((s) => s.id) as [string, string, string, string];
    expect(await act(c, issueId, { agentId: c.integratorId }, "in_progress")).toMatchObject({
      assigneeAgentId: c.executorId,
      executionState: { status: "changes_requested", currentStageId: sPush, completedStageIds: [sReview, sIntegrator, sOwner] },
    });
    expect(await act(c, issueId, { agentId: c.executorId }, "done")).toMatchObject({
      assigneeAgentId: c.integratorId,
      executionState: { status: "pending", currentStageId: sPush },
    });
    expect(await restartActivities(issueId)).toHaveLength(0);
    expect(await prDone(c, issueId, SHA_HEAD)).toMatchObject({ status: "done" });
  });

  it("yêu cầu sửa ở stage reviewer sau bằng chứng docs: stage docs chạy lại nên docs cũ vẫn bị 422 docs_stale", async () => {
    const c = await company();
    const issueId = await issue(c, { status: "in_progress", assigneeAgentId: c.executorId, executionPolicy: c.root });
    await act(c, issueId, { agentId: c.executorId }, "done");
    await postComment(c, issueId, c.integratorId, docsLine(0));
    await act(c, issueId, { agentId: c.reviewerId }, "in_progress");
    await act(c, issueId, { agentId: c.executorId }, "done");
    await act(c, issueId, { agentId: c.reviewerId }, "done");
    await expect(act(c, issueId, { agentId: c.integratorId }, "done")).rejects.toMatchObject({
      status: 422,
      details: { code: "crew_gate_blocked", violations: ["docs_stale"] },
    });
  });

  it("luồng gốc 4 stage: pushed=pr thiếu URL hay URL không phải pull request GitHub thì 422 push_missing", async () => {
    const c = await company();
    for (const line of [
      `crew-merge sha=${SHA_HEAD} branch=main pushed=pr`,
      `crew-merge sha=${SHA_HEAD} branch=main pushed=pr pr=https://gitlab.com/acme/app/merge_requests/3`,
    ]) {
      const issueId = await runRootToPush(c);
      await postComment(c, issueId, c.integratorId, line);
      await expect(act(c, issueId, { agentId: c.integratorId }, "done")).rejects.toMatchObject({
        status: 422,
        details: { code: "crew_gate_blocked", violations: ["push_missing"] },
      });
    }
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

  async function unknownReasons(issueId: string) {
    const rows = await db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.entityId, issueId), eq(activityLog.action, "crew.gate.reopen_executor_unknown")));
    return rows.map((r) => (r.details as { reason?: string } | null)?.reason);
  }

  it("mở lại sau board override (không returnAssignee): comment crew-commit của agent khác không làm đổi assignee", async () => {
    const c = await company();
    const issueId = await issue(c, { status: "done", assigneeAgentId: c.integratorId, executionPolicy: c.root, executionState: null });
    const intruder = randomUUID();
    await db.insert(agents).values({
      id: intruder,
      companyId: c.companyId,
      name: "Agent khác",
      role: "engineer",
      status: "idle",
      adapterType: "process",
      adapterConfig: {},
      permissions: {},
    });
    await postComment(c, issueId, intruder, `crew-commit sha=${SHA_HEAD} branch=crew/x tests=pnpm result=pass`);
    expect(await issueService(db).update(issueId, { status: "todo" })).toMatchObject({ assigneeAgentId: c.integratorId });
    expect(await unknownReasons(issueId)).toEqual(["no_return_assignee"]);
  });

  it("returnAssignee là participant agent của policy (reviewer): không giao lại", async () => {
    const c = await company();
    const stageId = c.child.stages[0]!.id;
    const issueId = await issue(c, {
      status: "done",
      assigneeAgentId: c.reviewerId,
      executionPolicy: c.child,
      executionState: { ...state(c, "completed", null, null, [stageId]), returnAssignee: c.reviewer },
    });
    expect(await issueService(db).update(issueId, { status: "todo" })).toMatchObject({ assigneeAgentId: c.reviewerId });
    expect(await unknownReasons(issueId)).toEqual(["executor_is_stage_participant"]);
  });

  it("issue gắn kênh chat hoặc executor đang chờ duyệt: không giao lại", async () => {
    const c = await company();
    const stageId = c.child.stages[0]!.id;
    const seedDone = () =>
      issue(c, {
        status: "done",
        assigneeAgentId: c.reviewerId,
        executionPolicy: c.child,
        executionState: state(c, "completed", null, null, [stageId]),
      });
    const bound = await seedDone();
    // Khung kênh tối thiểu như heartbeat-reviewed-chat-binding.integration.test.ts.
    const endpointId = randomUUID();
    const applicationId = randomUUID();
    const connectionId = randomUUID();
    await db.insert(toolApplications).values({
      id: applicationId,
      companyId: c.companyId,
      applicationKey: `chat:discord:${endpointId}`,
      name: "Discord",
      type: "chat",
      status: "active",
    });
    await db.insert(toolConnections).values({
      id: connectionId,
      companyId: c.companyId,
      applicationId,
      name: "Discord",
      uid: `chat-discord-${endpointId}`,
      connectionPurpose: "channel",
      transport: "chat_sdk",
      status: "active",
      enabled: true,
    });
    await db.insert(chatEndpoints).values({
      id: endpointId,
      companyId: c.companyId,
      connectionId,
      provider: "discord",
      publicId: randomUUID(),
      assignedAgentId: c.reviewerId,
      status: "active",
      providerAccountId: "guild-1",
      allowUnlinkedPeople: false,
    });
    await db.insert(chatConversations).values({
      companyId: c.companyId,
      endpointId,
      issueId: bound,
      externalConversationId: randomUUID(),
      externalLabel: "kênh thử",
    });
    expect(await issueService(db).update(bound, { status: "todo" })).toMatchObject({ assigneeAgentId: c.reviewerId });
    expect(await unknownReasons(bound)).toEqual(["chat_bound"]);

    const pending = await seedDone();
    await db.update(agents).set({ status: "pending_approval" }).where(eq(agents.id, c.executorId));
    expect(await issueService(db).update(pending, { status: "todo" })).toMatchObject({ assigneeAgentId: c.reviewerId });
    expect(await unknownReasons(pending)).toEqual(["executor_unavailable"]);
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

  // Ép Done: plugin gọi thẳng issueService.update({status:'done'}) đứng tên owner, không đi qua transition của route.
  async function forceDone(issueId: string) {
    return issueService(db).update(issueId, { status: "done", actorUserId: "owner-1" });
  }

  async function overridesOf(issueId: string) {
    return db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.entityId, issueId), eq(activityLog.action, "crew.policy.board_override")));
  }

  async function decisionCount(issueId: string) {
    return (await db.select().from(issueExecutionDecisions).where(eq(issueExecutionDecisions.issueId, issueId))).length;
  }

  it("board ép done issue đang chờ stage review của agent: xóa execution state, một activity override", async () => {
    const c = await company();
    const issueId = await rootAtReviewer(c);
    const updated = await forceDone(issueId);
    expect(updated?.status).toBe("done");
    expect(updated?.executionState).toBeNull();
    const [row] = await db.select().from(issues).where(eq(issues.id, issueId));
    expect(row!.executionState).toBeNull();
    expect(row!.executionPolicy).not.toBeNull();
    const overrides = await overridesOf(issueId);
    expect(overrides).toHaveLength(1);
    expect(overrides[0]!.actorType).toBe("user");
    expect(await decisionCount(issueId)).toBe(0);
  });

  it("board ép done issue đang chờ chính mình duyệt: không thành Duyệt, không có decision mới", async () => {
    const c = await company();
    const issueId = await issue(c, { status: "in_progress", assigneeAgentId: c.executorId, executionPolicy: c.root });
    const sOwner = c.root.stages[2]!.id;
    await act(c, issueId, { agentId: c.executorId }, "done");
    await act(c, issueId, { agentId: c.reviewerId }, "done");
    await postComment(c, issueId, c.integratorId, docsLine(0));
    expect(await act(c, issueId, { agentId: c.integratorId }, "done")).toMatchObject({
      assigneeUserId: "owner-1",
      executionState: { status: "pending", currentStageId: sOwner },
    });
    const decisionsBefore = await decisionCount(issueId);

    const updated = await forceDone(issueId);
    expect(updated?.status).toBe("done");
    expect(updated?.executionState).toBeNull();
    expect(await decisionCount(issueId)).toBe(decisionsBefore);
    const overrides = await overridesOf(issueId);
    expect(overrides).toHaveLength(1);
    expect((overrides[0]!.details as { violations: string[] }).violations).toEqual(
      expect.arrayContaining([`stage_unapproved:${sOwner}`]),
    );
  });

  it("board ép done issue chưa vào stage nào: done, không mở workflow, override liệt kê stage chưa duyệt", async () => {
    const c = await company();
    const issueId = await issue(c, { status: "in_progress", assigneeAgentId: c.executorId, executionPolicy: c.root });
    const updated = await forceDone(issueId);
    expect(updated?.status).toBe("done");
    expect(updated?.executionState).toBeNull();
    expect(updated?.assigneeAgentId).toBe(c.executorId);
    const overrides = await overridesOf(issueId);
    expect(overrides).toHaveLength(1);
    expect((overrides[0]!.details as { violations: string[] }).violations).toEqual(
      expect.arrayContaining(c.root.stages.map((s) => `stage_unapproved:${s.id}`)),
    );
    expect(await decisionCount(issueId)).toBe(0);
  });

  it("board ép done mà lệnh ghi đã có executionState: giữ nguyên giá trị của lệnh ghi", async () => {
    const c = await company();
    const issueId = await rootAtReviewer(c);
    const own = state(c, "completed", null, null, [c.root.stages[0]!.id]);
    const updated = await issueService(db).update(issueId, { status: "done", executionState: own, actorUserId: "owner-1" });
    expect(updated?.status).toBe("done");
    expect(updated?.executionState).toMatchObject({ status: "completed", completedStageIds: [c.root.stages[0]!.id] });
    expect(await overridesOf(issueId)).toHaveLength(1);
  });

  it("agent vào done thiếu cổng vẫn bị chặn và execution state không đổi", async () => {
    const c = await company();
    const issueId = await rootAtReviewer(c);
    const [before] = await db.select().from(issues).where(eq(issues.id, issueId));
    await expect(
      issueService(db).update(issueId, { status: "done", actorAgentId: c.executorId }),
    ).rejects.toMatchObject({ status: 422, details: { code: "crew_gate_blocked" } });
    const [after] = await db.select().from(issues).where(eq(issues.id, issueId));
    expect(after!.status).toBe("in_review");
    expect(after!.executionState).toEqual(before!.executionState);
    expect(await overridesOf(issueId)).toHaveLength(0);
  });

  describe("ticket tổng Bug Finding (root-bf)", () => {
    const PR = "https://github.com/acme/app/pull/87";
    const MERGE = "d".repeat(40);
    const runs = new Map<string, BugFindingRunFact[]>();
    afterEach(() => {
      runs.clear();
      setBugFindingRunReader(null);
    });
    const useRuns = () => setBugFindingRunReader(async ({ issueId }) => runs.get(issueId) ?? []);
    // Mốc thời gian của comment lấy theo DB; cách nhau vài ms để "mới hơn" không bị trùng mili giây khi đọc ra Date.
    const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
    const post = async (c: Company, issueId: string, author: string, body: string) => {
      await tick();
      await postComment(c, issueId, author, body);
      await tick();
    };
    const blocked = (violations: string[]) => ({ status: 422, details: { code: "crew_gate_blocked", violations } });

    async function rootBfAtBridge(c: Company, sha = SHA_HEAD) {
      const issueId = await issue(c, { status: "in_progress", assigneeAgentId: c.executorId, executionPolicy: c.rootBf });
      const [sMerge] = c.rootBf.stages.map((s) => s.id) as [string];
      expect(await act(c, issueId, { agentId: c.executorId }, "done")).toMatchObject({
        status: "in_review",
        assigneeAgentId: c.integratorId,
        executionState: { status: "pending", currentStageId: sMerge },
      });
      await post(c, issueId, c.integratorId, docsLineFor(sha, 0));
      await post(c, issueId, c.integratorId, `crew-pr sha=${sha} pr=${PR}`);
      expect(await act(c, issueId, { agentId: c.integratorId }, "done")).toMatchObject({ assigneeAgentId: c.reviewerId });
      return issueId;
    }

    it("luồng đủ: gộp + crew-pr → Bug Finding cho head PR → owner → crew-merge pushed=merged → done", async () => {
      useRuns();
      const c = await company();
      const issueId = await issue(c, { status: "in_progress", assigneeAgentId: c.executorId, executionPolicy: c.rootBf });
      const [sMerge, sBridge, sOwner, sLand] = c.rootBf.stages.map((s) => s.id) as [string, string, string, string];
      await act(c, issueId, { agentId: c.executorId }, "done");

      // Stage 0: docs rồi PR đúng merged commit.
      await post(c, issueId, c.integratorId, docsLine(0));
      await expect(act(c, issueId, { agentId: c.integratorId }, "done")).rejects.toMatchObject(blocked(["pr_missing"]));
      await post(c, issueId, c.integratorId, `crew-pr sha=${SHA_BASE} pr=${PR}`);
      await expect(act(c, issueId, { agentId: c.integratorId }, "done")).rejects.toMatchObject(blocked(["pr_sha_mismatch"]));
      await post(c, issueId, c.executorId, `crew-pr sha=${SHA_HEAD} pr=${PR}`);
      await expect(act(c, issueId, { agentId: c.integratorId }, "done")).rejects.toMatchObject(blocked(["pr_sha_mismatch"]));
      await post(c, issueId, c.integratorId, `crew-pr sha=${SHA_HEAD} pr=${PR}`);
      expect(await act(c, issueId, { agentId: c.integratorId }, "done")).toMatchObject({
        assigneeAgentId: c.reviewerId,
        executionState: { status: "pending", currentStageId: sBridge, completedStageIds: [sMerge] },
      });

      // Stage 1: cần lượt succeeded cho đúng head PR.
      await expect(act(c, issueId, { agentId: c.reviewerId }, "done")).rejects.toMatchObject(blocked(["bf_missing"]));
      runs.set(issueId, [{ headSha: SHA_BASE, state: "succeeded" }, { headSha: SHA_HEAD, state: "running" }]);
      await expect(act(c, issueId, { agentId: c.reviewerId }, "done")).rejects.toMatchObject(blocked(["bf_missing"]));
      runs.set(issueId, [{ headSha: SHA_HEAD, state: "succeeded" }]);
      expect(await act(c, issueId, { agentId: c.reviewerId }, "done")).toMatchObject({
        assigneeUserId: "owner-1",
        executionState: { status: "pending", currentStageId: sOwner, completedStageIds: [sMerge, sBridge] },
      });

      // Owner duyệt, rồi stage 3: pushed=pr chưa đủ, phải merge.
      await post(c, issueId, c.integratorId, `crew-merge sha=${SHA_HEAD} branch=crew/req/X pushed=merged pr=${PR} merge=${MERGE}`);
      expect(await act(c, issueId, { userId: "owner-1" }, "done")).toMatchObject({
        assigneeAgentId: c.integratorId,
        executionState: { status: "pending", currentStageId: sLand },
      });
      await expect(act(c, issueId, { agentId: c.integratorId }, "done")).rejects.toMatchObject(blocked(["merge_missing"]));
      await post(c, issueId, c.integratorId, `crew-merge sha=${SHA_HEAD} branch=crew/req/X pushed=pr pr=${PR}`);
      await expect(act(c, issueId, { agentId: c.integratorId }, "done")).rejects.toMatchObject(blocked(["merge_missing"]));
      await post(c, issueId, c.integratorId, `crew-merge sha=${SHA_BASE} branch=crew/req/X pushed=merged pr=${PR} merge=${MERGE}`);
      await expect(act(c, issueId, { agentId: c.integratorId }, "done")).rejects.toMatchObject(blocked(["push_sha_mismatch"]));
      await post(c, issueId, c.integratorId, `crew-merge sha=${SHA_HEAD} branch=crew/req/X pushed=merged pr=${PR} merge=${MERGE}`);
      expect(await act(c, issueId, { agentId: c.integratorId }, "done")).toMatchObject({ status: "done" });
    });

    let crewNs: string | undefined;
    /** Project có origin trong `project_repos` của plugin, và `bugFinding.gitlabHosts` của company. */
    async function projectWithOrigin(c: Company, originUrl: string, gitlabHosts: string[] = []) {
      crewNs ??= await applyCrewMachineTables(db);
      const projectId = randomUUID();
      await db.insert(projects).values({ id: projectId, companyId: c.companyId, name: "business-app" });
      await db.execute(sql`INSERT INTO ${sql.raw(`${crewNs}.project_repos`)} (company_id, project_id, origin_url, branch, updated_by_user_id)
        VALUES (${c.companyId}, ${projectId}, ${originUrl}, 'main', 'owner-1')`);
      configured[c.companyId] = { ...(configured[c.companyId] as object), bugFinding: { enabled: true, gitlabHosts } };
      writeConfig();
      return projectId;
    }
    const SELF_HOSTED_ORIGIN = "git@gitlab.qasoftsolution.com:nail/business-app.git";

    it("origin GitLab: crew-pr và crew-merge pushed=merged mang URL MR GitLab qua đủ bốn stage", async () => {
      useRuns();
      const MR = "https://gitlab.qasoftsolution.com/nail/business-app/-/merge_requests/12";
      const c = await company();
      const projectId = await projectWithOrigin(c, SELF_HOSTED_ORIGIN, ["gitlab.qasoftsolution.com"]);
      const issueId = await issue(c, { status: "in_progress", assigneeAgentId: c.executorId, executionPolicy: c.rootBf, projectId });
      await act(c, issueId, { agentId: c.executorId }, "done");
      await post(c, issueId, c.integratorId, docsLine(0));
      await post(c, issueId, c.integratorId, `crew-pr sha=${SHA_HEAD} pr=${MR}`);
      expect(await act(c, issueId, { agentId: c.integratorId }, "done")).toMatchObject({ assigneeAgentId: c.reviewerId });
      runs.set(issueId, [{ headSha: SHA_HEAD, state: "succeeded" }]);
      expect(await act(c, issueId, { agentId: c.reviewerId }, "done")).toMatchObject({ assigneeUserId: "owner-1" });
      expect(await act(c, issueId, { userId: "owner-1" }, "done")).toMatchObject({ assigneeAgentId: c.integratorId });
      await post(c, issueId, c.integratorId, `crew-merge sha=${SHA_HEAD} branch=crew/req/X pushed=merged pr=${MR} merge=${MERGE}`);
      expect(await act(c, issueId, { agentId: c.integratorId }, "done")).toMatchObject({ status: "done" });
    });

    it("F-01: crew-pr có host khác origin của project bị chặn (pr_origin_mismatch); host viết hoa vẫn khớp", async () => {
      useRuns();
      const c = await company();
      const projectId = await projectWithOrigin(c, SELF_HOSTED_ORIGIN, ["gitlab.qasoftsolution.com"]);
      const issueId = await issue(c, { status: "in_progress", assigneeAgentId: c.executorId, executionPolicy: c.rootBf, projectId });
      await act(c, issueId, { agentId: c.executorId }, "done");
      await post(c, issueId, c.integratorId, docsLine(0));
      for (const pr of [
        "https://evil.example/a/b/-/merge_requests/1",
        "https://gitlab.com/nail/business-app/-/merge_requests/12",
        "https://github.com/acme/app/pull/87",
      ]) {
        await post(c, issueId, c.integratorId, `crew-pr sha=${SHA_HEAD} pr=${pr}`);
        await expect(act(c, issueId, { agentId: c.integratorId }, "done"), pr).rejects.toMatchObject(blocked(["pr_origin_mismatch"]));
      }
      await post(c, issueId, c.integratorId, `crew-pr sha=${SHA_HEAD} pr=https://GitLab.QASoftSolution.com/nail/business-app/-/merge_requests/12`);
      expect(await act(c, issueId, { agentId: c.integratorId }, "done")).toMatchObject({ assigneeAgentId: c.reviewerId });
    });

    it("F-01: host GitLab tự host chưa khai báo trong gitlabHosts thì crew-pr bị chặn", async () => {
      const c = await company();
      const projectId = await projectWithOrigin(c, SELF_HOSTED_ORIGIN, []);
      const issueId = await issue(c, { status: "in_progress", assigneeAgentId: c.executorId, executionPolicy: c.rootBf, projectId });
      await act(c, issueId, { agentId: c.executorId }, "done");
      await post(c, issueId, c.integratorId, docsLine(0));
      await post(c, issueId, c.integratorId, `crew-pr sha=${SHA_HEAD} pr=https://gitlab.qasoftsolution.com/nail/business-app/-/merge_requests/12`);
      await expect(act(c, issueId, { agentId: c.integratorId }, "done")).rejects.toMatchObject(blocked(["pr_origin_mismatch"]));
    });

    it("F-01: crew-merge có URL khác crew-pr (merge_pr_mismatch) hoặc host khác origin (push_origin_mismatch) bị chặn", async () => {
      useRuns();
      const MR = "https://gitlab.qasoftsolution.com/nail/business-app/-/merge_requests/12";
      const c = await company();
      const projectId = await projectWithOrigin(c, SELF_HOSTED_ORIGIN, ["gitlab.qasoftsolution.com"]);
      const issueId = await issue(c, { status: "in_progress", assigneeAgentId: c.executorId, executionPolicy: c.rootBf, projectId });
      await act(c, issueId, { agentId: c.executorId }, "done");
      await post(c, issueId, c.integratorId, docsLine(0));
      await post(c, issueId, c.integratorId, `crew-pr sha=${SHA_HEAD} pr=${MR}`);
      await act(c, issueId, { agentId: c.integratorId }, "done");
      runs.set(issueId, [{ headSha: SHA_HEAD, state: "succeeded" }]);
      await act(c, issueId, { agentId: c.reviewerId }, "done");
      expect(await act(c, issueId, { userId: "owner-1" }, "done")).toMatchObject({ assigneeAgentId: c.integratorId });
      const merged = (pr: string) => `crew-merge sha=${SHA_HEAD} branch=crew/req/X pushed=merged pr=${pr} merge=${MERGE}`;
      await post(c, issueId, c.integratorId, merged("https://gitlab.qasoftsolution.com/nail/business-app/-/merge_requests/13"));
      await expect(act(c, issueId, { agentId: c.integratorId }, "done")).rejects.toMatchObject(blocked(["merge_pr_mismatch"]));
      await post(c, issueId, c.integratorId, merged("https://evil.example/nail/business-app/-/merge_requests/12"));
      await expect(act(c, issueId, { agentId: c.integratorId }, "done")).rejects.toMatchObject(
        blocked(["push_origin_mismatch", "merge_pr_mismatch"]),
      );
      await post(c, issueId, c.integratorId, merged(MR));
      expect(await act(c, issueId, { agentId: c.integratorId }, "done")).toMatchObject({ status: "done" });
    });

    it("chưa đặt reader lượt Bug Finding: stage cầu nối không qua được", async () => {
      const c = await company();
      const issueId = await rootBfAtBridge(c);
      await expect(act(c, issueId, { agentId: c.reviewerId }, "done")).rejects.toMatchObject(blocked(["bf_missing"]));
    });

    it("reader mặc định đọc bảng crew_bug_finding_runs của plugin: chỉ lượt succeeded/skipped đúng head PR mới qua", async () => {
      const table = crewTable("crew_bug_finding_runs");
      const schema = table.split(".")[0]!;
      await db.execute(sql.raw(`CREATE SCHEMA IF NOT EXISTS ${schema}`));
      await db.execute(sql.raw(`CREATE TABLE IF NOT EXISTS ${table} (company_id uuid NOT NULL, issue_id uuid NOT NULL,
        head_sha text NOT NULL, state text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`));
      try {
        const c = await company();
        const issueId = await rootBfAtBridge(c);
        const insert = (head: string, state: string, companyId = c.companyId) =>
          db.execute(sql`INSERT INTO ${sql.raw(table)} (company_id, issue_id, head_sha, state) VALUES (${companyId}, ${issueId}, ${head}, ${state})`);
        await insert(SHA_HEAD, "running");
        await insert(SHA_BASE, "succeeded");
        await insert(SHA_HEAD, "succeeded", randomUUID());
        await expect(act(c, issueId, { agentId: c.reviewerId }, "done")).rejects.toMatchObject(blocked(["bf_missing"]));
        await insert(SHA_HEAD, "succeeded");
        expect(await act(c, issueId, { agentId: c.reviewerId }, "done")).toMatchObject({ status: "in_review" });
      } finally {
        await db.execute(sql.raw(`DROP TABLE IF EXISTS ${table}`));
      }
    });

    it("owner yêu cầu sửa ticket tổng Bug Finding: tăng vòng trong crew_bug_finding_rounds; reviewer cầu nối yêu cầu sửa thì không", async () => {
      useRuns();
      const table = crewTable("crew_bug_finding_rounds");
      await db.execute(sql.raw(`CREATE SCHEMA IF NOT EXISTS ${table.split(".")[0]!}`));
      await db.execute(sql.raw(`CREATE TABLE IF NOT EXISTS ${table} (company_id uuid NOT NULL, issue_id uuid NOT NULL,
        round integer NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (company_id, issue_id))`));
      const round = async (issueId: string) => {
        const rows = (await db.execute(sql`SELECT round FROM ${sql.raw(table)} WHERE issue_id = ${issueId}`)) as unknown as { round: number }[];
        return [...rows][0]?.round ?? null;
      };
      try {
        const c = await company();
        const issueId = await rootBfAtBridge(c);
        runs.set(issueId, [{ headSha: SHA_HEAD, state: "succeeded" }]);
        await act(c, issueId, { agentId: c.reviewerId }, "in_progress");
        expect(await round(issueId)).toBeNull();

        const second = await rootBfAtBridge(c);
        runs.set(second, [{ headSha: SHA_HEAD, state: "succeeded" }]);
        await act(c, second, { agentId: c.reviewerId }, "done");
        expect(await act(c, second, { userId: "owner-1" }, "in_progress")).toMatchObject({
          executionState: { status: "changes_requested", currentStageId: null, completedStageIds: [] },
        });
        expect(await round(second)).toBe(1);
      } finally {
        await db.execute(sql.raw(`DROP TABLE IF EXISTS ${table}`));
      }
    });

    it("reviewer cần sửa ở stage cầu nối: Trợ Lý chờ hết lô bf-fix và thẻ hỏi crew-bf, rồi nộp lại từ stage gộp với docs và PR mới", async () => {
      useRuns();
      const c = await company();
      const issueId = await rootBfAtBridge(c);
      const [sMerge, sBridge] = c.rootBf.stages.map((s) => s.id) as [string, string];
      runs.set(issueId, [{ headSha: SHA_HEAD, state: "succeeded" }]);

      expect(await act(c, issueId, { agentId: c.reviewerId }, "in_progress")).toMatchObject({
        status: "in_progress",
        assigneeAgentId: c.executorId,
        executionState: { status: "changes_requested", currentStageId: null, completedStageIds: [] },
      });
      const restarts = await db
        .select()
        .from(activityLog)
        .where(and(eq(activityLog.entityId, issueId), eq(activityLog.action, CREW_BUG_FINDING_RESTART_ACTION)));
      expect(restarts).toMatchObject([{ details: { stageId: sBridge, clearedStageIds: [sMerge] } }]);
      expect(await restartActivities(issueId)).toHaveLength(0);

      // Kế hoạch lô của Trợ Lý; lô cũ (bf-fix-1) không còn tính khi đã có lô mới hơn.
      await post(c, issueId, c.executorId, "crew-bf-triage run=1 batch=bf-fix-1 fix=F-09");
      await post(c, issueId, c.reviewerId, "crew-bf-triage run=9 batch=bf-fix-9 fix=F-01");
      await post(c, issueId, c.executorId, "crew-bf-triage run=2 batch=bf-fix-2 fix=F-01,F-02 ask=F-04 dismiss=F-05");
      const agentChild = (description: string, status: string) =>
        issue(c, {
          parentId: issueId,
          status,
          description,
          assigneeAgentId: c.executorId,
          executionPolicy: c.child,
          createdByUserId: null,
          createdByAgentId: c.executorId,
        });
      await agentChild("Sửa cũ\ncrew-child key=f-09 revision=bf-fix-1", "in_progress");
      await agentChild("Sửa lô khác\ncrew-child key=f-01 revision=bf-fix-9", "in_progress");
      const fix1 = await agentChild(`Sửa F-01\ncrew-fix base=${SHA_HEAD}\ncrew-bf finding=F-01 run=2\ncrew-child key=f-01 revision=bf-fix-2`, "in_progress");
      const fix2 = await agentChild(`Sửa F-02\ncrew-bf finding=F-02 run=2`, "todo");
      const e2e = await agentChild("E2E lô\ncrew-child key=e2e-fix-1 revision=bf-fix-2", "blocked");
      const [question] = await db
        .insert(issueThreadInteractions)
        .values({
          companyId: c.companyId,
          issueId,
          kind: "ask_user_questions",
          status: "pending",
          idempotencyKey: `crew-bf:${issueId}:2`,
          createdByAgentId: c.executorId,
          payload: { version: 1, questions: [] } as never,
        })
        .returning({ id: issueThreadInteractions.id });
      await db.insert(issueThreadInteractions).values({
        companyId: c.companyId,
        issueId,
        kind: "ask_user_questions",
        status: "pending",
        idempotencyKey: "other:1",
        createdByAgentId: c.executorId,
        payload: { version: 1, questions: [] } as never,
      });

      await expect(act(c, issueId, { agentId: c.executorId }, "done")).rejects.toMatchObject(
        blocked(["bf_batch_open", "bf_questions_open"]),
      );
      for (const id of [fix1, fix2]) await db.update(issues).set({ status: "done" }).where(eq(issues.id, id));
      await db.update(issues).set({ status: "cancelled" }).where(eq(issues.id, e2e));
      await expect(act(c, issueId, { agentId: c.executorId }, "done")).rejects.toMatchObject(blocked(["bf_questions_open"]));
      await db.update(issueThreadInteractions).set({ status: "answered" }).where(eq(issueThreadInteractions.id, question!.id));

      // Nộp lại về stage gộp: docs và PR của vòng trước cũ đi, phải gộp lại cho head mới.
      expect(await act(c, issueId, { agentId: c.executorId }, "done")).toMatchObject({
        assigneeAgentId: c.integratorId,
        executionState: { status: "pending", currentStageId: sMerge, completedStageIds: [] },
      });
      await expect(act(c, issueId, { agentId: c.integratorId }, "done")).rejects.toMatchObject(blocked(["docs_stale"]));
      await post(c, issueId, c.integratorId, docsLineFor(SHA_FIX, 0));
      await expect(act(c, issueId, { agentId: c.integratorId }, "done")).rejects.toMatchObject(blocked(["pr_missing"]));
      await post(c, issueId, c.integratorId, `crew-pr sha=${SHA_FIX} pr=${PR}`);
      expect(await act(c, issueId, { agentId: c.integratorId }, "done")).toMatchObject({
        executionState: { status: "pending", currentStageId: sBridge, completedStageIds: [sMerge] },
      });
      // Lượt cũ cho head trước không tính cho head mới.
      await expect(act(c, issueId, { agentId: c.reviewerId }, "done")).rejects.toMatchObject(blocked(["bf_missing"]));
      runs.set(issueId, [{ headSha: SHA_HEAD, state: "succeeded" }, { headSha: SHA_FIX, state: "skipped" }]);
      expect(await act(c, issueId, { agentId: c.reviewerId }, "done")).toMatchObject({ assigneeUserId: "owner-1" });
    });
  });
});

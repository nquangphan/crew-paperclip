import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { agents, companies, createDb, issues, projects } from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { decideCreatePolicy } from "../crew/issue-create-policy.ts";
import { buildCrewPolicy, CREW_POLICY_CONFIG_ENV } from "../crew/issue-policy.ts";
import { heartbeatService } from "../services/heartbeat.ts";
import { issueService } from "../services/issues.js";
import { routineService } from "../services/routines.ts";

const roles = { reviewerAgentId: "r", integratorAgentId: "i" };

describe("decideCreatePolicy", () => {
  it("agent tạo issue gốc bị từ chối", () => {
    expect(decideCreatePolicy({ data: { createdByAgentId: "e" }, roles, ownerUserId: "owner-1" })).toEqual({
      kind: "reject",
      code: "crew_agent_root_issue",
    });
  });
  it("agent tạo issue con: luôn thay bằng template con", () => {
    const d = decideCreatePolicy({
      data: { createdByAgentId: "e", parentId: "p", executionPolicy: { stages: [] } },
      roles,
      ownerUserId: null,
    });
    expect(d).toMatchObject({ kind: "set", template: "child" });
  });
  it("agent giao việc cho reviewer hoặc integrator bị từ chối", () => {
    for (const assigneeAgentId of ["r", "i"]) {
      expect(
        decideCreatePolicy({ data: { createdByAgentId: "e", parentId: "p", assigneeAgentId }, roles, ownerUserId: null }),
      ).toEqual({ kind: "reject", code: "crew_role_assignee" });
    }
  });
  it("agent tạo khi company chưa có vai trò bị từ chối; board thì giữ nguyên", () => {
    expect(
      decideCreatePolicy({ data: { createdByAgentId: "e", parentId: "p" }, roles: null, ownerUserId: null }),
    ).toEqual({ kind: "reject", code: "crew_roles_unconfigured" });
    expect(decideCreatePolicy({ data: { createdByUserId: "owner-1" }, roles: null, ownerUserId: null })).toEqual({
      kind: "keep",
    });
  });
  it("agent tạo issue ở trạng thái done, cancelled hoặc in_review bị từ chối", () => {
    for (const status of ["done", "cancelled", "in_review"]) {
      expect(
        decideCreatePolicy({ data: { createdByAgentId: "e", parentId: "p", status }, roles, ownerUserId: "owner-1" }),
      ).toEqual({ kind: "reject", code: "crew_gate_blocked" });
    }
    expect(
      decideCreatePolicy({ data: { createdByAgentId: "e", parentId: "p", status: "todo" }, roles, ownerUserId: null }),
    ).toEqual({ kind: "set", template: "child" });
  });
  it("board tạo issue gốc không policy: template gốc với owner của file cấu hình", () => {
    expect(decideCreatePolicy({ data: { createdByUserId: "board-2" }, roles, ownerUserId: "owner-1" })).toEqual({
      kind: "set",
      template: "root",
      ownerUserId: "owner-1",
    });
  });
  it("board tạo issue con không policy: template con", () => {
    expect(decideCreatePolicy({ data: { createdByUserId: "owner-1", parentId: "p" }, roles, ownerUserId: "owner-1" })).toEqual(
      { kind: "set", template: "child" },
    );
  });
  it("board gửi policy riêng thì giữ nguyên", () => {
    expect(
      decideCreatePolicy({
        data: { createdByUserId: "owner-1", executionPolicy: { stages: [] } },
        roles,
        ownerUserId: "owner-1",
      }),
    ).toEqual({ kind: "keep" });
  });
  it("issue watchdog/recovery giao cho chính executor của issue nguồn: template con", () => {
    expect(
      decideCreatePolicy({
        data: { parentId: "p", originKind: "stranded_issue_recovery", assigneeAgentId: "e" },
        roles,
        ownerUserId: "owner-1",
        sourceExecutorAgentIds: ["e"],
      }),
    ).toEqual({ kind: "set", template: "child" });
    expect(
      decideCreatePolicy({
        data: { parentId: "p", originKind: "task_watchdog", assigneeAgentId: "w" },
        roles,
        ownerUserId: "owner-1",
        sourceExecutorAgentIds: ["e"],
      }),
    ).toEqual({ kind: "keep" });
  });
  it("hệ thống tạo issue watchdog/recovery: giữ hành vi stock, không policy", () => {
    for (const originKind of ["task_watchdog", "stale_active_run_evaluation", "stranded_issue_recovery"]) {
      expect(decideCreatePolicy({ data: { parentId: "p", originKind }, roles, ownerUserId: "owner-1" })).toEqual({
        kind: "keep",
      });
      expect(decideCreatePolicy({ data: { parentId: "p", originKind }, roles: null, ownerUserId: null })).toEqual({
        kind: "keep",
      });
    }
  });
  it("hệ thống tạo issue routine hoặc nguồn không nhận diện được: con → template con, gốc → template gốc", () => {
    for (const originKind of ["routine_execution", "manual", "plugin:x", undefined]) {
      expect(
        decideCreatePolicy({
          data: { originKind, parentId: "p", executionPolicy: { stages: [] } },
          roles,
          ownerUserId: "owner-1",
        }),
      ).toEqual({ kind: "set", template: "child" });
      expect(
        decideCreatePolicy({ data: { originKind, executionPolicy: { stages: [] } }, roles, ownerUserId: "owner-1" }),
      ).toEqual({ kind: "set", template: "root", ownerUserId: "owner-1" });
    }
    expect(decideCreatePolicy({ data: { originKind: "routine_execution" }, roles: null, ownerUserId: null })).toEqual({
      kind: "reject",
      code: "crew_roles_unconfigured",
    });
  });
});

// Hook H4 (first line of issueService.create) through the real service: createChild and every
// other caller of create receive the Crew policy template.
const support = await getEmbeddedPostgresTestSupport();
const suite = support.supported ? describe : describe.skip;

suite("crew policy in issueService.create", () => {
  let db: ReturnType<typeof createDb>;
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  const configDir = mkdtempSync(path.join(tmpdir(), "crew-issue-create-config-"));
  const configFile = path.join(configDir, "crew-policy.json");
  const configured: Record<string, unknown> = {};
  const previousEnv = process.env[CREW_POLICY_CONFIG_ENV];
  const writeConfig = () => writeFileSync(configFile, JSON.stringify({ companies: configured }));

  beforeAll(async () => {
    writeConfig();
    process.env[CREW_POLICY_CONFIG_ENV] = configFile;
    temporary = await startEmbeddedPostgresTestDatabase("crew-issue-create-policy-");
    db = createDb(temporary.connectionString);
  }, 60_000);
  afterAll(async () => {
    if (previousEnv === undefined) delete process.env[CREW_POLICY_CONFIG_ENV];
    else process.env[CREW_POLICY_CONFIG_ENV] = previousEnv;
    rmSync(configDir, { recursive: true, force: true });
    await db?.$client.end({ timeout: 0 });
    await temporary?.cleanup();
  });

  async function seed(config: "ok" | "invalid" | "absent" = "ok") {
    const companyId = randomUUID();
    const executorId = randomUUID();
    const reviewerId = randomUUID();
    const integratorId = randomUUID();
    const rootId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Crew create",
      issuePrefix: `C${companyId.replace(/-/g, "").slice(0, 5).toUpperCase()}`,
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
    if (config === "ok") configured[companyId] = { reviewerAgentId: reviewerId, integratorAgentId: integratorId, ownerUserId: "owner-1" };
    if (config === "invalid") configured[companyId] = { reviewerAgentId: reviewerId, integratorAgentId: reviewerId, ownerUserId: "owner-1" };
    writeConfig();
    await db.insert(issues).values({
      id: rootId,
      companyId,
      title: "Yêu cầu gốc",
      status: "todo",
      createdByUserId: "owner-1",
      responsibleUserId: "owner-1",
    });
    return { companyId, executorId, reviewerId, integratorId, rootId };
  }

  it("agent tạo issue gốc qua service bị 422", async () => {
    const { companyId, executorId } = await seed();
    await expect(
      issueService(db).create(companyId, { title: "x", createdByAgentId: executorId }),
    ).rejects.toMatchObject({ status: 422, details: { code: "crew_agent_root_issue" } });
  });

  it("agent tạo issue con qua createChild: policy template con, có responsibleUserId để leo thang", async () => {
    const { executorId, reviewerId, rootId } = await seed();
    const { issue } = await issueService(db).createChild(rootId, {
      title: "con",
      createdByAgentId: executorId,
      executionPolicy: { stages: [] },
    } as never);
    const [row] = await db.select().from(issues).where(eq(issues.id, issue.id));
    const policy = row!.executionPolicy as {
      stages: Array<{ type: string; participants: Array<{ agentId: string | null }> }>;
      maxReviewRounds: number;
    };
    expect(policy.stages.map((s) => s.type)).toEqual(["review"]);
    expect(policy.stages[0]!.participants.map((p) => p.agentId)).toEqual([reviewerId]);
    expect(policy.maxReviewRounds).toBe(5);
    expect(row!.responsibleUserId).toBe("owner-1");
  });

  it("agent giao issue con cho reviewer bị 422 crew_role_assignee", async () => {
    const { executorId, reviewerId, rootId } = await seed();
    await expect(
      issueService(db).createChild(rootId, {
        title: "con",
        createdByAgentId: executorId,
        assigneeAgentId: reviewerId,
      } as never),
    ).rejects.toMatchObject({ status: 422, details: { code: "crew_role_assignee" } });
  });

  it("agent tạo issue con thẳng ở done/cancelled/in_review bị 422 crew_gate_blocked", async () => {
    const { executorId, rootId } = await seed();
    for (const status of ["done", "cancelled", "in_review"]) {
      await expect(
        issueService(db).createChild(rootId, { title: `con ${status}`, createdByAgentId: executorId, status } as never),
      ).rejects.toMatchObject({ status: 422, details: { code: "crew_gate_blocked" } });
    }
    const children = await db.select().from(issues).where(eq(issues.parentId, rootId));
    expect(children).toHaveLength(0);
  });

  it("board tạo issue gốc không policy: template bốn stage, owner theo file cấu hình", async () => {
    const { companyId, integratorId } = await seed();
    const created = await issueService(db).create(companyId, { title: "yêu cầu", createdByUserId: "board-2" });
    const policy = created.executionPolicy as {
      stages: Array<{ type: string; participants: Array<{ agentId: string | null; userId: string | null }> }>;
    };
    expect(policy.stages.map((s) => s.type)).toEqual(["review", "review", "approval", "review"]);
    expect(policy.stages[1]!.participants[0]!.agentId).toBe(integratorId);
    expect(policy.stages[2]!.participants[0]!.userId).toBe("owner-1");
  });

  it("hệ thống tạo issue watchdog: không gắn template; hệ thống và agent được giao đều done được", async () => {
    const { companyId, executorId, rootId } = await seed();
    const create = (title: string) =>
      issueService(db).create(companyId, {
        title,
        parentId: rootId,
        originKind: "task_watchdog",
        assigneeAgentId: executorId,
      });
    const bySystem = await create("watchdog 1");
    expect(bySystem.executionPolicy).toBeNull();
    expect((await issueService(db).update(bySystem.id, { status: "done" }))?.status).toBe("done");
    const byAgent = await create("watchdog 2");
    expect((await issueService(db).update(byAgent.id, { status: "done", actorAgentId: executorId }))?.status).toBe("done");
  });

  type StagePolicy = { stages: Array<{ type: string; participants: Array<{ agentId: string | null; userId: string | null }> }> };
  const principals = (policy: unknown) =>
    (policy as StagePolicy).stages.map((s) => [s.type, s.participants[0]!.agentId ?? s.participants[0]!.userId]);

  it("hệ thống tạo issue routine cấp gốc: template gốc bốn stage, agent không done thẳng được", async () => {
    const { companyId, executorId, reviewerId, integratorId } = await seed();
    const created = await issueService(db).create(companyId, {
      title: "routine",
      originKind: "routine_execution",
      originId: randomUUID(),
      assigneeAgentId: executorId,
    });
    expect(principals(created.executionPolicy)).toEqual([
      ["review", reviewerId],
      ["review", integratorId],
      ["approval", "owner-1"],
      ["review", integratorId],
    ]);
    await expect(
      issueService(db).update(created.id, { status: "done", actorAgentId: executorId }),
    ).rejects.toMatchObject({ status: 422, details: { code: "crew_gate_blocked" } });
  });

  it("hệ thống tạo issue con nguồn routine: template con", async () => {
    const { companyId, executorId, reviewerId, rootId } = await seed();
    const created = await issueService(db).create(companyId, {
      title: "routine con",
      parentId: rootId,
      originKind: "routine_execution",
      originId: randomUUID(),
      assigneeAgentId: executorId,
    });
    expect(principals(created.executionPolicy)).toEqual([["review", reviewerId]]);
  });

  it("hệ thống tạo issue nguồn không nhận diện được (manual) cấp gốc: template gốc", async () => {
    const { companyId } = await seed();
    const created = await issueService(db).create(companyId, { title: "khác" });
    expect((created.executionPolicy as StagePolicy).stages.map((s) => s.type)).toEqual(["review", "review", "approval", "review"]);
  });

  it("agent tạo routine giao cho chính mình: issue routine sinh ra cần integrator và owner", async () => {
    const { companyId, executorId, reviewerId, integratorId } = await seed();
    const projectId = randomUUID();
    await db.insert(projects).values({ id: projectId, companyId, name: "Routines", status: "in_progress" });
    const routines = routineService(db, { heartbeat: { wakeup: async () => null } });
    const routine = await routines.create(
      companyId,
      {
        projectId,
        goalId: null,
        parentIssueId: null,
        title: "tự làm hằng ngày",
        description: "routine của executor",
        assigneeAgentId: executorId,
        priority: "medium",
        status: "active",
        concurrencyPolicy: "coalesce_if_active",
        catchUpPolicy: "skip_missed",
      },
      { agentId: executorId },
    );
    const run = await routines.runRoutine(routine.id, { source: "schedule" });
    expect(run.linkedIssueId).toBeTruthy();
    const [row] = await db.select().from(issues).where(eq(issues.id, run.linkedIssueId!));
    expect(row!.createdByAgentId).toBeNull();
    expect(principals(row!.executionPolicy)).toEqual([
      ["review", reviewerId],
      ["review", integratorId],
      ["approval", "owner-1"],
      ["review", integratorId],
    ]);
    await expect(
      issueService(db).update(row!.id, { status: "done", actorAgentId: executorId }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("monitor create_recovery_issue do executor đặt: issue recovery giao lại executor nhận template con", async () => {
    const { companyId, executorId, reviewerId, integratorId } = await seed();
    const sourceId = randomUUID();
    const nextCheckAt = new Date("2026-04-11T12:30:00.000Z");
    const monitor = {
      nextCheckAt: nextCheckAt.toISOString(),
      notes: "Check deploy",
      scheduledBy: "assignee",
      timeoutAt: "2026-04-11T12:00:00.000Z",
      recoveryPolicy: "create_recovery_issue",
    };
    const crewChild = {
      ...buildCrewPolicy("child", { reviewerAgentId: reviewerId, integratorAgentId: integratorId }),
      monitor,
    };
    await db.insert(issues).values({
      id: sourceId,
      companyId,
      title: "Việc có monitor",
      status: "in_progress",
      priority: "medium",
      assigneeAgentId: executorId,
      createdByUserId: "owner-1",
      responsibleUserId: "owner-1",
      executionPolicy: crewChild,
      executionState: {
        status: "idle",
        currentStageId: null,
        currentStageIndex: null,
        currentStageType: null,
        currentParticipant: null,
        returnAssignee: null,
        completedStageIds: [],
        lastDecisionId: null,
        lastDecisionOutcome: null,
        monitor: {
          status: "scheduled",
          nextCheckAt: nextCheckAt.toISOString(),
          lastTriggeredAt: null,
          attemptCount: 0,
          notes: "Check deploy",
          scheduledBy: "assignee",
          serviceName: null,
          externalRef: null,
          timeoutAt: monitor.timeoutAt,
          maxAttempts: null,
          recoveryPolicy: "create_recovery_issue",
          clearedAt: null,
          clearReason: null,
        },
      },
      monitorNextCheckAt: nextCheckAt,
      monitorAttemptCount: 0,
      monitorNotes: "Check deploy",
      monitorScheduledBy: "assignee",
    });

    await heartbeatService(db).tickTimers(new Date("2026-04-11T12:31:00.000Z"));

    const [recovery] = await db.select().from(issues).where(eq(issues.originId, sourceId));
    expect(recovery).toMatchObject({ originKind: "stranded_issue_recovery", parentId: sourceId, assigneeAgentId: executorId });
    expect(principals(recovery!.executionPolicy)).toEqual([["review", reviewerId]]);
    await expect(
      issueService(db).update(recovery!.id, { status: "done", actorAgentId: executorId }),
    ).rejects.toMatchObject({ status: 422, details: { code: "crew_gate_blocked" } });
  });

  it("executor tự giao issue watchdog không policy và đổi parentId sang issue khác: done vẫn 422", async () => {
    const { companyId, executorId, reviewerId, rootId } = await seed();
    await db.update(issues).set({ assigneeAgentId: executorId }).where(eq(issues.id, rootId));
    const otherParent = randomUUID();
    await db.insert(issues).values({ id: otherParent, companyId, title: "khác", status: "todo", createdByUserId: "owner-1" });
    const watchdogId = randomUUID();
    await db.insert(issues).values({
      id: watchdogId,
      companyId,
      title: "watchdog",
      status: "todo",
      parentId: rootId,
      assigneeAgentId: reviewerId,
      originKind: "task_watchdog",
      originId: rootId,
      originFingerprint: randomUUID(),
    });
    await issueService(db).update(watchdogId, { assigneeAgentId: executorId, actorAgentId: executorId });
    await issueService(db).update(watchdogId, { parentId: otherParent, actorAgentId: executorId });
    await expect(
      issueService(db).update(watchdogId, { status: "done", actorAgentId: executorId }),
    ).rejects.toMatchObject({ status: 422, details: { violations: ["policy_missing"] } });
  });

  it("issue recovery không policy: executor của issue nguồn không done được, agent khác thì được", async () => {
    const { companyId, executorId, reviewerId, rootId } = await seed();
    await db.update(issues).set({ assigneeAgentId: executorId }).where(eq(issues.id, rootId));
    const insertRecovery = async () => {
      const id = randomUUID();
      await db.insert(issues).values({
        id,
        companyId,
        title: "recovery",
        status: "todo",
        parentId: rootId,
        assigneeAgentId: executorId,
        originKind: "stranded_issue_recovery",
        originId: rootId,
        originFingerprint: randomUUID(),
      });
      return id;
    };
    const mine = await insertRecovery();
    await expect(
      issueService(db).update(mine, { status: "done", actorAgentId: executorId }),
    ).rejects.toMatchObject({ status: 422, details: { violations: ["policy_missing"] } });
    // Mỗi issue nguồn chỉ có một issue recovery đang mở (unique index stock).
    await db.update(issues).set({ status: "cancelled" }).where(eq(issues.id, mine));
    const other = await insertRecovery();
    await db.update(issues).set({ assigneeAgentId: reviewerId }).where(eq(issues.id, other));
    expect((await issueService(db).update(other, { status: "done", actorAgentId: reviewerId }))?.status).toBe("done");
  });

  it("company không có trong file cấu hình: agent tạo issue gốc như stock", async () => {
    const { companyId, executorId } = await seed("absent");
    const created = await issueService(db).create(companyId, { title: "gốc", createdByAgentId: executorId });
    expect(created.executionPolicy).toBeNull();
  });

  it("cấu hình company lỗi: agent tạo issue con bị 422 crew_roles_unconfigured", async () => {
    const { executorId, rootId } = await seed("invalid");
    await expect(
      issueService(db).createChild(rootId, { title: "con", createdByAgentId: executorId } as never),
    ).rejects.toMatchObject({ status: 422, details: { code: "crew_roles_unconfigured" } });
  });
});

import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { agents, companies, createDb, issues, labels, projects, routineTriggers } from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { decideCreatePolicy } from "../crew/issue-create-policy.ts";
import { buildCrewPolicy, CREW_POLICY_CONFIG_ENV } from "../crew/issue-policy.ts";
import { heartbeatService } from "../services/heartbeat.ts";
import { issueService } from "../services/issues.js";
import { routineService } from "../services/routines.ts";

const roles = { reviewerAgentId: "r", integratorAgentId: "i" };

describe("decideCreatePolicy", () => {
  it("board tạo gốc trong project theo dõi thì keep; con và agent không bị ảnh hưởng", () => {
    expect(decideCreatePolicy({ data: { createdByUserId: "board-2" }, roles, ownerUserId: "owner-1", trackingProject: true })).toEqual({ kind: "keep" });
    expect(decideCreatePolicy({ data: { createdByUserId: "board-2", parentId: "p" }, roles, ownerUserId: "owner-1", trackingProject: true })).toEqual({ kind: "set", template: "child" });
    expect(decideCreatePolicy({ data: { createdByAgentId: "e" }, roles, ownerUserId: "owner-1", trackingProject: true })).toEqual({ kind: "reject", code: "crew_agent_root_issue" });
  });

  it("board tạo gốc có nhãn research nhận hai stage; con vẫn nhận template con", () => {
    expect(decideCreatePolicy({ data: { createdByUserId: "board-2" }, roles, ownerUserId: "owner-1", researchLabel: true })).toEqual({ kind: "set", template: "research", ownerUserId: "owner-1" });
    expect(decideCreatePolicy({ data: { createdByUserId: "board-2", parentId: "p" }, roles, ownerUserId: "owner-1", researchLabel: true })).toEqual({ kind: "set", template: "child" });
    expect(decideCreatePolicy({ data: { createdByAgentId: "e", parentId: "p" }, roles, ownerUserId: "owner-1", researchLabel: true })).toEqual({ kind: "set", template: "child" });
    expect(decideCreatePolicy({ data: { createdByUserId: "board-2", executionPolicy: { stages: [] } }, roles, ownerUserId: "owner-1", researchLabel: true })).toEqual({ kind: "keep" });
    expect(decideCreatePolicy({ data: {}, roles, ownerUserId: "owner-1", researchLabel: true })).toEqual({ kind: "set", template: "root", ownerUserId: "owner-1" });
  });
  it("agent không thể đặt command, extraArgs, env hay model ngoài bảng", () => {
    expect(decideCreatePolicy({
      data: { createdByAgentId: "e", parentId: "p", assigneeAdapterOverrides: { adapterConfig: { extraArgs: [], command: "/bin/sh", env: {}, model: "claude-fable-5" } } },
      roles,
      ownerUserId: null,
    })).toEqual({ kind: "reject", code: "crew_override_forbidden", violations: ["adapterConfig.extraArgs", "adapterConfig.command", "adapterConfig.env", "adapterConfig.model:claude-fable-5"] });
  });
  it("agent dùng model/effort hợp lệ, board được đặt override khác", () => {
    expect(decideCreatePolicy({
      data: { createdByAgentId: "e", parentId: "p", assigneeAdapterOverrides: { adapterConfig: { model: "claude-opus-5", effort: "high" } } }, roles, ownerUserId: null,
    })).toEqual({ kind: "set", template: "child" });
    expect(decideCreatePolicy({
      data: { createdByUserId: "owner-1", parentId: "p", assigneeAdapterOverrides: { adapterConfig: { extraArgs: [] } } }, roles, ownerUserId: "owner-1",
    })).toEqual({ kind: "set", template: "child" });
  });
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
  it("agent tạo con có dòng crew-kind bmad nhận template bmad (review rồi owner)", () => {
    const description = "Lập epic/story\ncrew-bundle id=bmad seq=1\ncrew-kind bmad\nTiêu chí nghiệm thu:\n- có file";
    expect(decideCreatePolicy({ data: { createdByAgentId: "e", parentId: "p", description }, roles, ownerUserId: "owner-1" }))
      .toEqual({ kind: "set", template: "bmad", ownerUserId: "owner-1" });
    expect(decideCreatePolicy({ data: { createdByAgentId: "e", parentId: "p", description: "crew-kind bmad  \nx" }, roles, ownerUserId: "owner-1" }))
      .toEqual({ kind: "set", template: "bmad", ownerUserId: "owner-1" });
  });
  it("marker phải đứng riêng một dòng; research và con thường không đổi", () => {
    for (const description of ["xcrew-kind bmad", "crew-kind bmadx", "crew-kind research", "ghi chú: crew-kind bmad ở giữa dòng", " crew-kind bmad", "crew-kind  bmad", null, undefined]) {
      expect(decideCreatePolicy({ data: { createdByAgentId: "e", parentId: "p", description }, roles, ownerUserId: "owner-1" }))
        .toEqual({ kind: "set", template: "child" });
    }
  });
  it("luật từ chối đứng trước marker bmad", () => {
    const description = "crew-kind bmad";
    expect(decideCreatePolicy({ data: { createdByAgentId: "e", description }, roles, ownerUserId: "owner-1" })).toEqual({ kind: "reject", code: "crew_agent_root_issue" });
    expect(decideCreatePolicy({ data: { createdByAgentId: "e", parentId: "p", description }, roles: null, ownerUserId: null })).toEqual({ kind: "reject", code: "crew_roles_unconfigured" });
    expect(decideCreatePolicy({ data: { createdByAgentId: "e", parentId: "p", description, status: "done" }, roles, ownerUserId: "owner-1" })).toEqual({ kind: "reject", code: "crew_gate_blocked" });
    expect(decideCreatePolicy({ data: { createdByAgentId: "e", parentId: "p", description, assigneeAgentId: "r" }, roles, ownerUserId: "owner-1" })).toEqual({ kind: "reject", code: "crew_role_assignee" });
    expect(decideCreatePolicy({
      data: { createdByAgentId: "e", parentId: "p", description, assigneeAdapterOverrides: { adapterConfig: { command: "/bin/sh" } } }, roles, ownerUserId: "owner-1",
    })).toEqual({ kind: "reject", code: "crew_override_forbidden", violations: ["adapterConfig.command"] });
  });
  it("marker bmad mà thiếu owner trong cấu hình thì từ chối, không gắn template thiếu stage", () => {
    expect(decideCreatePolicy({ data: { createdByAgentId: "e", parentId: "p", description: "crew-kind bmad" }, roles, ownerUserId: null }))
      .toEqual({ kind: "reject", code: "crew_roles_unconfigured" });
  });
  it("board hay hệ thống tạo con có marker bmad vẫn nhận template con (board tự gửi policy nếu muốn)", () => {
    expect(decideCreatePolicy({ data: { createdByUserId: "owner-1", parentId: "p", description: "crew-kind bmad" }, roles, ownerUserId: "owner-1" }))
      .toEqual({ kind: "set", template: "child" });
    expect(decideCreatePolicy({ data: { originKind: "routine_execution", parentId: "p", description: "crew-kind bmad" }, roles, ownerUserId: "owner-1" }))
      .toEqual({ kind: "set", template: "child" });
  });
  it("buildCrewPolicy bmad cùng hình dạng research", () => {
    const r = { reviewerAgentId: randomUUID(), integratorAgentId: randomUUID() };
    const owner = "owner-1";
    const shape = (p: ReturnType<typeof buildCrewPolicy>) => ({
      maxReviewRounds: p.maxReviewRounds,
      stages: p.stages.map((s) => [s.type, s.participants.map((x) => `${x.type}:${x.agentId ?? x.userId}`)]),
    });
    expect(shape(buildCrewPolicy("bmad", r, owner))).toEqual(shape(buildCrewPolicy("research", r, owner)));
    expect(() => buildCrewPolicy("bmad", r)).toThrow(/owner/);
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
  it("issue do routine của agent sinh ra bị từ chối, kể cả cấu hình lỗi", () => {
    for (const parentId of [undefined, "p"]) {
      expect(
        decideCreatePolicy({ data: { originKind: "routine_execution", parentId }, roles, ownerUserId: "owner-1", agentRoutine: true }),
      ).toEqual({ kind: "reject", code: "crew_routine_issue_forbidden" });
    }
    expect(decideCreatePolicy({ data: { originKind: "routine_execution" }, roles: null, ownerUserId: null, agentRoutine: true })).toEqual({
      kind: "reject",
      code: "crew_routine_issue_forbidden",
    });
  });

  it("giao con giữa agent theo dòng vai trò project: Trợ Lý giao bất kỳ, agent khác chỉ cho executor", () => {
    const projectAgentRoles = { assistantAgentId: "a", executorAgentIds: ["e1", "e2"] };
    const create = (createdByAgentId: string, assigneeAgentId: string, rolesOfProject: typeof projectAgentRoles | null = projectAgentRoles) =>
      decideCreatePolicy({ data: { createdByAgentId, assigneeAgentId, parentId: "p" }, roles, ownerUserId: "owner-1", projectAgentRoles: rolesOfProject });
    expect(create("a", "x")).toEqual({ kind: "set", template: "child" });
    expect(create("e1", "E2")).toEqual({ kind: "set", template: "child" });
    expect(create("i", "e1")).toEqual({ kind: "set", template: "child" });
    expect(create("e1", "x")).toEqual({ kind: "reject", code: "crew_assignment_forbidden" });
    expect(create("e1", "a")).toEqual({ kind: "reject", code: "crew_assignment_forbidden" });
    expect(create("e1", "x", null)).toEqual({ kind: "set", template: "child" });
  });

  it("agent tạo con nằm ngoài project của issue cha bị từ chối, kể cả Trợ Lý; board thì giữ", () => {
    const outside = (data: Parameters<typeof decideCreatePolicy>[0]["data"]) =>
      decideCreatePolicy({ data, roles, ownerUserId: "owner-1", projectOutsideParent: true });
    expect(outside({ createdByAgentId: "e1", parentId: "p", assigneeAgentId: "e2" })).toEqual({
      kind: "reject",
      code: "crew_project_outside_parent",
    });
    expect(outside({ createdByAgentId: "a", parentId: "p" })).toEqual({ kind: "reject", code: "crew_project_outside_parent" });
    expect(outside({ createdByUserId: "owner-1", parentId: "p" })).toEqual({ kind: "set", template: "child" });
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

  it("board tạo gốc với nhãn Research nhận policy hai stage; không nhãn nhận bốn stage", async () => {
    const { companyId } = await seed();
    const labelId = randomUUID();
    await db.insert(labels).values({ id: labelId, companyId, name: "Research", color: "#888888" });
    const research = await issueService(db).create(companyId, { title: "r", createdByUserId: "owner-1", labelIds: [labelId] } as never);
    const plain = await issueService(db).create(companyId, { title: "p", createdByUserId: "owner-1" } as never);
    const stagesOf = async (id: string) =>
      ((await db.select().from(issues).where(eq(issues.id, id)))[0]!.executionPolicy as { stages: { type: string }[] }).stages.map((s) => s.type);
    expect(await stagesOf(research.id)).toEqual(["review", "approval"]);
    expect(await stagesOf(plain.id)).toEqual(["review", "review", "approval", "review"]);
  });

  it("board tạo gốc trong project theo dõi không nhận policy; ngoài project vẫn bốn stage; con vẫn nhận template con", async () => {
    const { companyId, rootId } = await seed();
    const trackingId = randomUUID();
    const otherId = randomUUID();
    await db.insert(projects).values([
      { id: trackingId, companyId, name: "Theo dõi" },
      { id: otherId, companyId, name: "Khác" },
    ]);
    configured[companyId] = { ...(configured[companyId] as object), trackingProjectIds: [trackingId.toUpperCase()] };
    writeConfig();
    const policyOf = async (id: string) => (await db.select().from(issues).where(eq(issues.id, id)))[0]!.executionPolicy as { stages: { type: string }[] } | null;
    const tracked = await issueService(db).create(companyId, { title: "t", createdByUserId: "owner-1", projectId: trackingId } as never);
    const outside = await issueService(db).create(companyId, { title: "o", createdByUserId: "owner-1", projectId: otherId } as never);
    const child = await issueService(db).create(companyId, { title: "c", createdByUserId: "owner-1", projectId: trackingId, parentId: rootId } as never);
    expect(await policyOf(tracked.id)).toBeNull();
    expect((await policyOf(outside.id))!.stages.map((s) => s.type)).toEqual(["review", "review", "approval", "review"]);
    expect((await policyOf(child.id))!.stages.map((s) => s.type)).toEqual(["review"]);
    // Đổi project sau khi tạo không đổi policy đã chốt.
    await db.update(issues).set({ projectId: otherId }).where(eq(issues.id, tracked.id));
    expect(await policyOf(tracked.id)).toBeNull();
  });

  it("config không có trackingProjectIds: issue trong project vẫn nhận bốn stage như cũ", async () => {
    const { companyId } = await seed();
    const projectId = randomUUID();
    await db.insert(projects).values({ id: projectId, companyId, name: "P" });
    const created = await issueService(db).create(companyId, { title: "t", createdByUserId: "owner-1", projectId } as never);
    const policy = (await db.select().from(issues).where(eq(issues.id, created.id)))[0]!.executionPolicy as { stages: unknown[] };
    expect(policy.stages).toHaveLength(4);
  });

  it("nhãn research của company khác không tính", async () => {
    const { companyId } = await seed();
    const other = await seed();
    const labelId = randomUUID();
    await db.insert(labels).values({ id: labelId, companyId: other.companyId, name: "research", color: "#888888" });
    await expect(issueService(db).create(companyId, { title: "r", createdByUserId: "owner-1", labelIds: [labelId] } as never)).rejects.toMatchObject({ status: 422 });
  });

  it("agent tạo con với override độc hại bị 422 và không ghi DB", async () => {
    const { companyId, executorId, rootId } = await seed();
    const before = await db.select().from(issues).where(eq(issues.companyId, companyId));
    await expect(issueService(db).createChild(rootId, {
      title: "con", createdByAgentId: executorId, assigneeAgentId: executorId,
      assigneeAdapterOverrides: { adapterConfig: { command: "/bin/sh", model: "claude-fable-5" } },
    } as never)).rejects.toMatchObject({ status: 422, details: { code: "crew_override_forbidden", violations: ["adapterConfig.command", "adapterConfig.model:claude-fable-5"] } });
    expect(await db.select().from(issues).where(eq(issues.companyId, companyId))).toHaveLength(before.length);
  });

  it("agent tạo con với model/effort hợp lệ được lưu", async () => {
    const { executorId, rootId } = await seed();
    const { issue } = await issueService(db).createChild(rootId, {
      title: "con", createdByAgentId: executorId, assigneeAgentId: executorId,
      assigneeAdapterOverrides: { adapterConfig: { model: "claude-opus-5", effort: "high" } },
    } as never);
    const [row] = await db.select().from(issues).where(eq(issues.id, issue.id));
    expect(row!.assigneeAdapterOverrides).toEqual({ adapterConfig: { model: "claude-opus-5", effort: "high" } });
  });

  it("company ngoài cấu hình giữ cách tạo stock", async () => {
    const { executorId, rootId } = await seed("absent");
    await expect(issueService(db).createChild(rootId, {
      title: "con", createdByAgentId: executorId, assigneeAgentId: executorId,
      assigneeAdapterOverrides: { adapterConfig: { extraArgs: [] } },
    } as never)).resolves.toBeDefined();
  });

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

  it("agent tạo con có dòng crew-kind bmad: policy reviewer rồi owner duyệt; con thường vẫn một stage", async () => {
    const { companyId, executorId, reviewerId, rootId } = await seed();
    type Stored = { stages: Array<{ type: string; participants: Array<{ type: string; agentId: string | null; userId: string | null }> }>; maxReviewRounds: number };
    const policyOf = async (id: string) => (await db.select().from(issues).where(eq(issues.id, id)))[0]!.executionPolicy as Stored;
    const { issue: bmad } = await issueService(db).createChild(rootId, {
      title: "BMAD: lập epic và story",
      createdByAgentId: executorId,
      assigneeAgentId: executorId,
      description: "Yêu cầu của owner:\nx\ncrew-bundle id=bmad seq=1\ncrew-kind bmad",
      acceptanceCriteria: ["Có file epic/story"],
      executionPolicy: { stages: [] },
    } as never);
    const policy = await policyOf(bmad.id);
    expect(policy.stages.map((s) => [s.type, s.participants.map((p) => [p.type, p.agentId ?? p.userId])])).toEqual([
      ["review", [["agent", reviewerId]]],
      ["approval", [["user", "owner-1"]]],
    ]);
    expect(policy.maxReviewRounds).toBe(5);
    const viaCreate = await issueService(db).create(companyId, {
      title: "BMAD qua POST",
      parentId: rootId,
      createdByAgentId: executorId,
      description: "crew-kind bmad",
    } as never);
    expect((await policyOf(viaCreate.id)).stages.map((s) => s.type)).toEqual(["review", "approval"]);
    const { issue: plain } = await issueService(db).createChild(rootId, {
      title: "con thường",
      createdByAgentId: executorId,
      description: "ghi chú: crew-kind bmad ở giữa dòng",
    } as never);
    expect((await policyOf(plain.id)).stages.map((s) => s.type)).toEqual(["review"]);
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

  async function newRoutine(companyId: string, assigneeAgentId: string, actor: { agentId?: string; userId?: string }) {
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
        description: "routine",
        assigneeAgentId,
        priority: "medium",
        status: "active",
        concurrencyPolicy: "coalesce_if_active",
        catchUpPolicy: "skip_missed",
      },
      actor,
    );
    return { routines, routine };
  }
  const routineIssues = (routineId: string) =>
    db.select().from(issues).where(and(eq(issues.originKind, "routine_execution"), eq(issues.originId, routineId)));

  it("agent tạo routine giao cho chính mình: lịch chạy không sinh được issue, routine run failed", async () => {
    const { companyId, executorId } = await seed();
    const { routines, routine } = await newRoutine(companyId, executorId, { agentId: executorId });
    const run = await routines.runRoutine(routine.id, { source: "schedule" });
    expect(run).toMatchObject({ status: "failed", linkedIssueId: null });
    expect(run.failureReason).toMatch(/routine do agent/);
    expect(await routineIssues(routine.id)).toHaveLength(0);
  });

  it("routine của board mà agent thêm trigger: không sinh được issue", async () => {
    const { companyId, executorId } = await seed();
    const { routines, routine } = await newRoutine(companyId, executorId, { userId: "owner-1" });
    await db.insert(routineTriggers).values({ companyId, routineId: routine.id, kind: "schedule", createdByAgentId: executorId });
    const run = await routines.runRoutine(routine.id, { source: "schedule" });
    expect(run).toMatchObject({ status: "failed", linkedIssueId: null });
    expect(run.failureReason).toMatch(/routine do agent/);
    expect(await routineIssues(routine.id)).toHaveLength(0);
  });

  it("routine do board tạo giao cho executor: issue sinh ra nhận template gốc, agent không done thẳng được", async () => {
    const { companyId, executorId, reviewerId, integratorId } = await seed();
    const { routines, routine } = await newRoutine(companyId, executorId, { userId: "owner-1" });
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

  it("company ngoài cấu hình: routine do agent tạo vẫn sinh issue như stock", async () => {
    const { companyId, executorId } = await seed("absent");
    const { routines, routine } = await newRoutine(companyId, executorId, { agentId: executorId });
    const run = await routines.runRoutine(routine.id, { source: "schedule" });
    expect(run.linkedIssueId).toBeTruthy();
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

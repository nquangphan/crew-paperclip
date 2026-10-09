import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { agents, companies, createDb, issues, projects } from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { buildCrewPolicy, CREW_POLICY_CONFIG_ENV } from "../crew/issue-policy.ts";
import { crewRolesTable } from "../crew/project-roles.ts";
import { issueService } from "../services/issues.js";

// Vai trò reviewer/integrator theo project (bảng plugin crew.core) qua H2 (update) và H4 (create) thật.
// Các ca chạy theo thứ tự: trước khi có bảng, bảng hỏng, rồi bảng thật của migration plugin.
const support = await getEmbeddedPostgresTestSupport();
const suite = support.supported ? describe : describe.skip;

const migrationFile = fileURLToPath(
  new URL("../../../packages/crew-plugin/migrations/0004_project_roles.sql", import.meta.url),
);

type Policy = { stages: { id: string; type: string; participants: { type: string; agentId?: string | null }[] }[] };
type Outcome = string;

suite("crew project roles in issueService", () => {
  let db: ReturnType<typeof createDb>;
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  const configDir = mkdtempSync(path.join(tmpdir(), "crew-project-roles-config-"));
  const configFile = path.join(configDir, "crew-policy.json");
  const configured: Record<string, unknown> = {};
  const previousEnv = process.env[CREW_POLICY_CONFIG_ENV];
  const writeConfig = () => writeFileSync(configFile, JSON.stringify({ companies: configured }));

  beforeAll(async () => {
    writeConfig();
    process.env[CREW_POLICY_CONFIG_ENV] = configFile;
    temporary = await startEmbeddedPostgresTestDatabase("crew-project-roles-");
    db = createDb(temporary.connectionString);
  }, 60_000);
  afterAll(async () => {
    if (previousEnv === undefined) delete process.env[CREW_POLICY_CONFIG_ENV];
    else process.env[CREW_POLICY_CONFIG_ENV] = previousEnv;
    rmSync(configDir, { recursive: true, force: true });
    await db?.$client.end({ timeout: 0 });
    await temporary?.cleanup();
  });

  const agentRow = (id: string, companyId: string, name: string) => ({
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

  async function newCompany(name: string) {
    const companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name,
      issuePrefix: `R${companyId.replace(/-/g, "").slice(0, 5).toUpperCase()}`,
      defaultResponsibleUserId: "owner-1",
    });
    return companyId;
  }

  /** Company có vai trò file (R1, I1), executor E, cặp vai trò project (R2, I2) và hai project P1, P2. */
  async function seed() {
    const companyId = await newCompany("Crew roles");
    const [executorId, r1, i1, r2, i2, p1, p2] = Array.from({ length: 7 }, () => randomUUID()) as [
      string, string, string, string, string, string, string,
    ];
    await db.insert(agents).values([
      agentRow(executorId, companyId, "Executor"),
      agentRow(r1, companyId, "Reviewer"),
      agentRow(i1, companyId, "Integrator"),
      agentRow(r2, companyId, "Reviewer 2"),
      agentRow(i2, companyId, "Integrator 2"),
    ]);
    await db.insert(projects).values([
      { id: p1, companyId, name: "repo-a" },
      { id: p2, companyId, name: "repo-b" },
    ]);
    configured[companyId] = { reviewerAgentId: r1, integratorAgentId: i1, ownerUserId: "owner-1" };
    writeConfig();
    return { companyId, executorId, r1, i1, r2, i2, p1, p2 };
  }
  type Seed = Awaited<ReturnType<typeof seed>>;

  async function setRoles(s: Seed, projectId: string, reviewerId: string, integratorId: string) {
    await db.execute(sql`INSERT INTO ${sql.raw(crewRolesTable())}
      (company_id, project_id, assistant_agent_id, executor_agent_ids, reviewer_agent_id, integrator_agent_id, updated_by_user_id)
      VALUES (${s.companyId}, ${projectId}, ${s.executorId}, ARRAY[${s.executorId}]::uuid[], ${reviewerId}, ${integratorId}, 'owner-1')`);
  }

  async function insertIssue(s: Seed, values: Partial<typeof issues.$inferInsert>) {
    const id = randomUUID();
    await db.insert(issues).values({
      id,
      companyId: s.companyId,
      title: "Việc thử",
      status: "todo",
      createdByUserId: "owner-1",
      responsibleUserId: "owner-1",
      ...values,
    });
    return id;
  }

  const policyOf = async (id: string) =>
    (await db.select().from(issues).where(eq(issues.id, id)))[0]!.executionPolicy as Policy | null;
  const stageAgents = (policy: Policy | null) =>
    (policy?.stages ?? []).map((stage) => stage.participants.map((p) => p.agentId ?? `${p.type}`).join(","));

  const outcome = (promise: Promise<unknown>): Promise<Outcome> =>
    promise.then(
      (value) => `ok:${(value as { status?: string } | null)?.status ?? "?"}`,
      (error: { status?: number; details?: { code?: string; violations?: string[] } }) =>
        `${error.status}:${error.details?.code}:${(error.details?.violations ?? []).join("|")}`,
    );

  /**
   * Các ca chính của gate trên một project (hoặc không project), kết quả dạng chuỗi để so sánh giữa các lần chạy.
   * Mỗi lần chạy dùng company mới để không phụ thuộc lần trước.
   */
  async function gateScenarios(projectOf: (s: Seed) => string | null): Promise<Outcome[]> {
    const s = await seed();
    const projectId = projectOf(s);
    const roles = { reviewerAgentId: s.r1, integratorAgentId: s.i1 };
    const child = buildCrewPolicy("child", roles);
    const stageId = child.stages[0]!.id;
    const pending = {
      status: "pending",
      currentStageId: stageId,
      currentStageIndex: 0,
      currentStageType: "review",
      currentParticipant: { type: "agent", agentId: s.r1, userId: null },
      returnAssignee: { type: "agent", agentId: s.executorId, userId: null },
      reviewRequest: null,
      completedStageIds: [],
      lastDecisionId: null,
      lastDecisionOutcome: null,
      changesRequestedCount: 0,
    };
    const completed = { ...pending, status: "completed", currentStageId: null, currentStageIndex: null, currentStageType: null, currentParticipant: null, completedStageIds: [stageId], lastDecisionOutcome: "approved" };
    const working = () => insertIssue(s, { projectId, status: "in_progress", assigneeAgentId: s.executorId, executionPolicy: child });
    const inReview = () => insertIssue(s, { projectId, status: "in_review", assigneeAgentId: s.r1, executionPolicy: child, executionState: pending });
    const svc = issueService(db);
    const results: Outcome[] = [];
    results.push(await outcome(svc.update(await working(), { status: "done", actorAgentId: s.executorId })));
    results.push(await outcome(svc.update(await working(), { status: "cancelled", actorAgentId: s.executorId })));
    results.push(await outcome(svc.update(await working(), { assigneeAgentId: s.r1, actorAgentId: s.executorId })));
    results.push(await outcome(svc.update(await working(), { assigneeAgentId: s.i1, actorAgentId: s.executorId })));
    results.push(await outcome(svc.update(await working(), { status: "done", actorUserId: "owner-1" })));
    results.push(await outcome(svc.update(await working(), { status: "blocked" })));
    results.push(await outcome(svc.update(await inReview(), { status: "done", executionState: completed, actorAgentId: s.r1 } as never)));
    results.push(await outcome(svc.update(await inReview(), { status: "done", executionState: completed, actorAgentId: s.i1 } as never)));
    const root = await outcome(svc.create(s.companyId, { title: "gốc", createdByUserId: "owner-1", projectId } as never));
    results.push(root);
    results.push(await svc.create(s.companyId, { title: "gốc 2", createdByUserId: "owner-1", projectId } as never).then(
      async (created) => stageAgents(await policyOf(created.id)).join(" / "),
      (error: { status?: number; details?: { code?: string } }) => `${error.status}:${error.details?.code}:`,
    ));
    return results.map((r) => r.replaceAll(stageId, "S").replaceAll(s.r1, "R").replaceAll(s.i1, "I"));
  }

  let baseline: Outcome[] = [];

  describe("bảng plugin chưa migrate", () => {
    it("H2/H4 chạy như hôm nay: kết quả các ca chính trên project giống hệt issue không project", async () => {
      baseline = await gateScenarios(() => null);
      expect(baseline).toEqual([
        "422:crew_gate_blocked:stage_unapproved:S",
        "422:crew_gate_blocked:agent_cancel_forbidden",
        "422:crew_role_assignee:role_assignee",
        "422:crew_role_assignee:role_assignee",
        "ok:done",
        "ok:blocked",
        "ok:done",
        "422:crew_gate_blocked:stage_unapproved:S",
        "ok:backlog",
        "R / I / user / I",
      ]);
      expect(await gateScenarios((s) => s.p1)).toEqual(baseline);
    });

    it("bảng hỏng (đọc lỗi): H2 dùng vai trò file trong savepoint; H4 trên project trả 503 để thử lại, không ghim vai trò file", async () => {
      const table = crewRolesTable();
      await db.execute(sql.raw(`CREATE SCHEMA IF NOT EXISTS ${table.split(".")[0]}`));
      await db.execute(sql.raw(`CREATE TABLE ${table} (company_id uuid NOT NULL)`));
      try {
        expect(await gateScenarios((s) => s.p1)).toEqual([
          ...baseline.slice(0, 8),
          "503:crew_roles_unavailable:",
          "503:crew_roles_unavailable:",
        ]);
        // Issue không project vẫn theo vai trò file.
        expect(await gateScenarios(() => null)).toEqual(baseline);
        // Issue con của agent không ghi project, cha thuộc P1: cũng 503, không tạo issue nào.
        const s = await seed();
        const parent = await insertIssue(s, { projectId: s.p1 });
        const svc = issueService(db);
        await expect(svc.createChild(parent, {
          title: "con", createdByAgentId: s.executorId, assigneeAgentId: s.executorId,
        } as never)).rejects.toMatchObject({ status: 503, details: { code: "crew_roles_unavailable" } });
        await expect(svc.create(s.companyId, {
          title: "con", createdByAgentId: s.executorId, assigneeAgentId: s.executorId, parentId: parent,
        } as never)).rejects.toMatchObject({ status: 503, details: { code: "crew_roles_unavailable" } });
        expect(await db.select().from(issues).where(eq(issues.parentId, parent))).toHaveLength(0);
      } finally {
        await db.execute(sql.raw(`DROP TABLE ${table}`));
      }
    });
  });

  describe("bảng plugin đã migrate", () => {
    beforeAll(async () => {
      const table = crewRolesTable();
      await db.execute(sql.raw(`CREATE SCHEMA IF NOT EXISTS ${table.split(".")[0]}`));
      const statements = readFileSync(migrationFile, "utf8")
        .split(";")
        .map((statement) => statement.trim())
        .filter(Boolean);
      for (const statement of statements) await db.execute(sql.raw(statement));
    });

    it("project không có dòng vai trò: kết quả giống hệt khi chưa có bảng", async () => {
      expect(await gateScenarios((s) => s.p1)).toEqual(baseline);
    });

    it("round-trip H4: issue gốc trong P2 nhận reviewer/integrator của dòng, P1 nhận vai trò file", async () => {
      const s = await seed();
      await setRoles(s, s.p2, s.r2, s.i2);
      const svc = issueService(db);
      const inP2 = await svc.create(s.companyId, { title: "p2", createdByUserId: "owner-1", projectId: s.p2 } as never);
      const inP1 = await svc.create(s.companyId, { title: "p1", createdByUserId: "owner-1", projectId: s.p1 } as never);
      expect(stageAgents(await policyOf(inP2.id))).toEqual([s.r2, s.i2, "user", s.i2]);
      expect(stageAgents(await policyOf(inP1.id))).toEqual([s.r1, s.i1, "user", s.i1]);

      // Issue con: project theo con, không có thì theo issue cha.
      const { issue: childByAgent } = await svc.createChild(inP2.id, {
        title: "con", createdByAgentId: s.executorId, assigneeAgentId: s.executorId,
      } as never);
      expect(stageAgents(await policyOf(childByAgent.id))).toEqual([s.r2]);
      const childNoProject = await svc.create(s.companyId, { title: "con 2", createdByUserId: "owner-1", parentId: inP2.id } as never);
      expect(stageAgents(await policyOf(childNoProject.id))).toEqual([s.r2]);
    });

    it("issue con suy project như lõi: theo inheritExecutionWorkspaceFromIssueId trước parentId, bỏ khi skip", async () => {
      const s = await seed();
      await setRoles(s, s.p2, s.r2, s.i2);
      const svc = issueService(db);
      const parentP1 = await insertIssue(s, { projectId: s.p1 });
      const sourceP2 = await insertIssue(s, { projectId: s.p2 });
      const parentP2 = await insertIssue(s, { projectId: s.p2 });

      // Cha ở P1, nguồn workspace ở P2: lõi gán P2 nên vai trò là R2.
      const inherited = await svc.create(s.companyId, {
        title: "con kế thừa", createdByAgentId: s.executorId, assigneeAgentId: s.executorId,
        parentId: parentP1, inheritExecutionWorkspaceFromIssueId: sourceP2,
      } as never);
      expect(inherited.projectId).toBe(s.p2);
      expect(stageAgents(await policyOf(inherited.id))).toEqual([s.r2]);

      // Cha ở P2 nhưng bỏ kế thừa: lõi không gán project nên vai trò file R1.
      const skipped = await svc.create(s.companyId, {
        title: "con bỏ kế thừa", createdByAgentId: s.executorId, assigneeAgentId: s.executorId,
        parentId: parentP2, skipExecutionWorkspaceInheritance: true,
      } as never);
      expect(skipped.projectId).toBeNull();
      expect(stageAgents(await policyOf(skipped.id))).toEqual([s.r1]);

      // Con ghi rõ project khác cha: theo project của con.
      const explicit = await svc.create(s.companyId, {
        title: "con khác project", createdByAgentId: s.executorId, assigneeAgentId: s.executorId,
        parentId: parentP1, projectId: s.p2,
      } as never);
      expect(stageAgents(await policyOf(explicit.id))).toEqual([s.r2]);
    });

    it("dòng của project đã xóa không còn chặn giao việc cho reviewer cũ", async () => {
      const s = await seed();
      await setRoles(s, s.p2, s.r2, s.i2);
      const svc = issueService(db);
      const blocked = await insertIssue(s, { projectId: s.p1, status: "in_progress", assigneeAgentId: s.executorId });
      await expect(svc.update(blocked, { assigneeAgentId: s.r2, actorAgentId: s.executorId })).rejects.toMatchObject({
        status: 422, details: { code: "crew_role_assignee" },
      });
      await db.delete(projects).where(eq(projects.id, s.p2));
      const free = await insertIssue(s, { projectId: s.p1, status: "in_progress", assigneeAgentId: s.executorId });
      expect((await svc.update(free, { assigneeAgentId: s.r2, actorAgentId: s.executorId }))?.assigneeAgentId).toBe(s.r2);
      const parent = await insertIssue(s, { projectId: s.p1 });
      const child = await svc.create(s.companyId, {
        title: "con", createdByAgentId: s.executorId, assigneeAgentId: s.i2, parentId: parent,
      } as never);
      expect(child.assigneeAgentId).toBe(s.i2);
    });

    // Hai ca này mô tả hành vi theo participant đã ghim trên policy của issue; chúng vẫn đúng khi H2 không đọc bảng vai trò
// theo project. Việc đọc theo project của H2 được chứng minh ở ca "H2 đọc vai trò theo project của chính issue".
it("H2: participant đã ghim trên policy P2: executor done sớm bị 422; R2 duyệt được; R1 duyệt issue P2 bị từ chối", async () => {
      const s = await seed();
      await setRoles(s, s.p2, s.r2, s.i2);
      const svc = issueService(db);
      const child = buildCrewPolicy("child", { reviewerAgentId: s.r2, integratorAgentId: s.i2 });
      const stageId = child.stages[0]!.id;
      const pending = {
        status: "pending", currentStageId: stageId, currentStageIndex: 0, currentStageType: "review",
        currentParticipant: { type: "agent", agentId: s.r2, userId: null },
        returnAssignee: { type: "agent", agentId: s.executorId, userId: null },
        reviewRequest: null, completedStageIds: [], lastDecisionId: null, lastDecisionOutcome: null, changesRequestedCount: 0,
      };
      const completed = { ...pending, status: "completed", currentStageId: null, currentStageIndex: null, currentStageType: null, currentParticipant: null, completedStageIds: [stageId], lastDecisionOutcome: "approved" };

      const working = await insertIssue(s, { projectId: s.p2, status: "in_progress", assigneeAgentId: s.executorId, executionPolicy: child });
      await expect(svc.update(working, { status: "done", actorAgentId: s.executorId })).rejects.toMatchObject({
        status: 422, details: { code: "crew_gate_blocked", violations: [`stage_unapproved:${stageId}`] },
      });

      const byR1 = await insertIssue(s, { projectId: s.p2, status: "in_review", assigneeAgentId: s.r2, executionPolicy: child, executionState: pending });
      await expect(svc.update(byR1, { status: "done", executionState: completed, actorAgentId: s.r1 } as never)).rejects.toMatchObject({
        status: 422, details: { code: "crew_gate_blocked", violations: [`stage_unapproved:${stageId}`] },
      });

      const byR2 = await insertIssue(s, { projectId: s.p2, status: "in_review", assigneeAgentId: s.r2, executionPolicy: child, executionState: pending });
      expect((await svc.update(byR2, { status: "done", executionState: completed, actorAgentId: s.r2 } as never))?.status).toBe("done");
    });

    it("H2 đọc vai trò theo project của chính issue: dòng hỏng ở P2 chỉ chặn issue P2, không chặn issue P1", async () => {
      const s = await seed();
      await setRoles(s, s.p2, s.r2, s.i2);
      await db.update(agents).set({ status: "terminated" }).where(eq(agents.id, s.r2));
      const svc = issueService(db);
      const doneEarly = async (projectId: string, reviewerAgentId: string, integratorAgentId: string) => {
        const policy = buildCrewPolicy("child", { reviewerAgentId, integratorAgentId });
        const id = await insertIssue(s, { projectId, status: "in_progress", assigneeAgentId: s.executorId, executionPolicy: policy });
        const error = await svc.update(id, { status: "done", actorAgentId: s.executorId }).catch((e: unknown) => e);
        return { stageId: policy.stages[0]!.id, violations: (error as { details?: { violations?: string[] } }).details?.violations };
      };

      const inP2 = await doneEarly(s.p2, s.r2, s.i2);
      expect(inP2.violations).toEqual(expect.arrayContaining(["roles_unconfigured", `stage_unapproved:${inP2.stageId}`]));
      const inP1 = await doneEarly(s.p1, s.r1, s.i1);
      expect(inP1.violations).toEqual([`stage_unapproved:${inP1.stageId}`]);
    });

    it("giao việc: agent giao cho I2 hay R2 bị 422 crew_role_assignee, cả khi issue thuộc P1; H4 cũng chặn", async () => {
      const s = await seed();
      await setRoles(s, s.p2, s.r2, s.i2);
      const svc = issueService(db);
      for (const projectId of [s.p1, s.p2, null]) {
        for (const target of [s.i2, s.r2, s.i1]) {
          const id = await insertIssue(s, { projectId, status: "in_progress", assigneeAgentId: s.executorId });
          await expect(svc.update(id, { assigneeAgentId: target, actorAgentId: s.executorId })).rejects.toMatchObject({
            status: 422, details: { code: "crew_role_assignee" },
          });
        }
      }
      const root = await insertIssue(s, { projectId: s.p1 });
      await expect(svc.createChild(root, {
        title: "con", createdByAgentId: s.executorId, assigneeAgentId: s.i2,
      } as never)).rejects.toMatchObject({ status: 422, details: { code: "crew_role_assignee" } });
      // Agent khác vai trò vẫn nhận việc bình thường.
      const free = await insertIssue(s, { projectId: s.p1, status: "in_progress", assigneeAgentId: s.r1 });
      expect((await svc.update(free, { assigneeAgentId: s.executorId, actorAgentId: s.r1 }))?.assigneeAgentId).toBe(s.executorId);
    });

    it("dòng trỏ agent đã chuyển company, đã xóa hoặc terminated: fail closed, agent đó không duyệt được", async () => {
      for (const change of ["moved", "deleted", "terminated"] as const) {
        const s = await seed();
        await setRoles(s, s.p2, s.r2, s.i2);
        const child = buildCrewPolicy("child", { reviewerAgentId: s.r2, integratorAgentId: s.i2 });
        const stageId = child.stages[0]!.id;
        const pending = {
          status: "pending", currentStageId: stageId, currentStageIndex: 0, currentStageType: "review",
          currentParticipant: { type: "agent", agentId: s.r2, userId: null },
          returnAssignee: { type: "agent", agentId: s.executorId, userId: null },
          reviewRequest: null, completedStageIds: [], lastDecisionId: null, lastDecisionOutcome: null, changesRequestedCount: 0,
        };
        const completed = { ...pending, status: "completed", currentStageId: null, currentStageIndex: null, currentStageType: null, currentParticipant: null, completedStageIds: [stageId], lastDecisionOutcome: "approved" };
        const pinned = await insertIssue(s, { projectId: s.p2, status: "in_review", assigneeAgentId: s.executorId, executionPolicy: child, executionState: pending });

        if (change === "moved") {
          const other = await newCompany("Company khác");
          await db.update(agents).set({ companyId: other }).where(eq(agents.id, s.r2));
        } else if (change === "deleted") {
          await db.delete(agents).where(eq(agents.id, s.r2));
        } else {
          await db.update(agents).set({ status: "terminated" }).where(eq(agents.id, s.r2));
        }
        const svc = issueService(db);

        // R2 (không còn trong company) duyệt issue đã ghim policy cũ: bị từ chối, issue giữ nguyên.
        await expect(svc.update(pinned, { status: "done", executionState: completed, actorAgentId: s.r2 } as never)).rejects.toMatchObject({
          status: 422, details: { code: "crew_gate_blocked", violations: expect.arrayContaining(["roles_unconfigured"]) },
        });
        expect((await db.select().from(issues).where(eq(issues.id, pinned)))[0]!.status).toBe("in_review");

        // H4 không gắn policy trỏ agent cũ, cũng không lấy vai trò file của project khác.
        const root = await svc.create(s.companyId, { title: "gốc", createdByUserId: "owner-1", projectId: s.p2 } as never);
        expect(await policyOf(root.id)).toBeNull();
        await expect(svc.createChild(root.id, {
          title: "con", createdByAgentId: s.executorId, assigneeAgentId: s.executorId,
        } as never)).rejects.toMatchObject({ status: 422, details: { code: "crew_roles_unconfigured" } });

        // Executor không done được issue không policy của project đó; board vẫn ép được (có activity override).
        const working = await insertIssue(s, { projectId: s.p2, status: "in_progress", assigneeAgentId: s.executorId });
        await expect(svc.update(working, { status: "done", actorAgentId: s.executorId })).rejects.toMatchObject({
          status: 422, details: { violations: expect.arrayContaining(["roles_unconfigured", "policy_missing"]) },
        });
        expect((await svc.update(working, { status: "done", actorUserId: "owner-1" }))?.status).toBe("done");

        // Project P1 không có dòng: không ảnh hưởng.
        const p1Root = await svc.create(s.companyId, { title: "p1", createdByUserId: "owner-1", projectId: s.p1 } as never);
        expect(stageAgents(await policyOf(p1Root.id))).toEqual([s.r1, s.i1, "user", s.i1]);
      }
    });
  });
});

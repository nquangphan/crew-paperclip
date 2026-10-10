import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { activityLog, agents, companies, createDb, environments, issueExecutionDecisions, issues, projects } from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { buildCrewPolicy, CREW_POLICY_CONFIG_ENV } from "../crew/issue-policy.ts";
import { crewRolesTable, loadCompanyRoleAgentIds, loadCrewRoles, loadProjectAgentRoles } from "../crew/project-roles.ts";
import { crewRuntimeSwitchesTable } from "../crew/runtime-switch.ts";
import { applyIssueExecutionPolicyTransition, normalizeIssueExecutionPolicy } from "../services/issue-execution-policy.js";
import { issueService } from "../services/issues.js";

// Giao việc giữa agent trong project có vai trò crew.core: chỉ Trợ Lý giao cho agent bất kỳ (trừ reviewer/integrator);
// agent khác chỉ giao cho executor của project. Áp ở H4 (tạo issue có assignee) và H2 (đổi assignee).
const support = await getEmbeddedPostgresTestSupport();
const suite = support.supported ? describe : describe.skip;

const migration = (file: string) =>
  readFileSync(fileURLToPath(new URL(`../../../packages/crew-plugin/migrations/${file}`, import.meta.url)), "utf8")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);

suite("crew agent-to-agent assignment", () => {
  let db: ReturnType<typeof createDb>;
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  const configDir = mkdtempSync(path.join(tmpdir(), "crew-agent-assignment-config-"));
  const configFile = path.join(configDir, "crew-policy.json");
  const configured: Record<string, unknown> = {};
  const previousEnv = process.env[CREW_POLICY_CONFIG_ENV];
  const writeConfig = () => writeFileSync(configFile, JSON.stringify({ companies: configured }));

  beforeAll(async () => {
    writeConfig();
    process.env[CREW_POLICY_CONFIG_ENV] = configFile;
    temporary = await startEmbeddedPostgresTestDatabase("crew-agent-assignment-");
    db = createDb(temporary.connectionString);
    const ns = crewRolesTable().split(".")[0]!;
    await db.execute(sql.raw(`CREATE SCHEMA IF NOT EXISTS ${ns}`));
    // Bảng vai trò (0004) + ba cột runtime, công tắc (0012) + bản tin máy (0003); bỏ phần của bảng việc máy.
    const statements = [
      ...migration("0004_project_roles.sql"),
      ...migration("0003_machine_latest.sql").filter((s) => s.startsWith(`CREATE TABLE ${ns}.machine_latest`)),
      ...migration("0012_runtimes.sql").filter((s) => s.startsWith("CREATE") || s.includes(".crew_project_roles")),
    ];
    for (const statement of statements) await db.execute(sql.raw(statement));
  }, 60_000);
  afterAll(async () => {
    if (previousEnv === undefined) delete process.env[CREW_POLICY_CONFIG_ENV];
    else process.env[CREW_POLICY_CONFIG_ENV] = previousEnv;
    rmSync(configDir, { recursive: true, force: true });
    await db?.$client.end({ timeout: 0 });
    await temporary?.cleanup();
  });

  /** Company: Trợ Lý A, executor E1/E2, agent ngoài vai trò X, reviewer R, integrator I; P có dòng vai trò, Q không. */
  async function seed(config: "ok" | "absent" = "ok") {
    const companyId = randomUUID();
    const [a, e1, e2, x, r, i, p, q] = Array.from({ length: 8 }, () => randomUUID()) as [
      string, string, string, string, string, string, string, string,
    ];
    await db.insert(companies).values({
      id: companyId,
      name: "Crew assign",
      issuePrefix: `A${companyId.replace(/-/g, "").slice(0, 5).toUpperCase()}`,
      defaultResponsibleUserId: "owner-1",
    });
    const row = (id: string, name: string) => ({
      id, companyId, name, role: "engineer", status: "idle", adapterType: "process", adapterConfig: {}, permissions: {},
      runtimeConfig: { heartbeat: { enabled: false, wakeOnDemand: false, maxConcurrentRuns: 1 } },
    });
    await db.insert(agents).values([
      row(a, "Trợ Lý"), row(e1, "Executor 1"), row(e2, "Executor 2"), row(x, "BMAD"), row(r, "Reviewer"), row(i, "Integrator"),
    ]);
    await db.insert(projects).values([{ id: p, companyId, name: "repo-p" }, { id: q, companyId, name: "repo-q" }]);
    await db.execute(sql`INSERT INTO ${sql.raw(crewRolesTable())}
      (company_id, project_id, assistant_agent_id, executor_agent_ids, reviewer_agent_id, integrator_agent_id, updated_by_user_id)
      VALUES (${companyId}, ${p}, ${a}, ARRAY[${e1}, ${e2}]::uuid[], ${r}, ${i}, 'owner-1')`);
    if (config === "ok") configured[companyId] = { reviewerAgentId: r, integratorAgentId: i, ownerUserId: "owner-1" };
    writeConfig();
    const root = await insertIssue(companyId, { projectId: p, assigneeAgentId: a, status: "in_progress" });
    const rootQ = await insertIssue(companyId, { projectId: q, assigneeAgentId: a, status: "in_progress" });
    return { companyId, a, e1, e2, x, r, i, p, q, root, rootQ };
  }
  type Seed = Awaited<ReturnType<typeof seed>>;

  async function insertIssue(companyId: string, values: Partial<typeof issues.$inferInsert>) {
    const id = randomUUID();
    await db.insert(issues).values({
      id, companyId, title: "Việc", status: "todo", createdByUserId: "owner-1", responsibleUserId: "owner-1", ...values,
    });
    return id;
  }

  const child = (s: Seed, actor: string, assignee: string, parentId = s.root) =>
    issueService(db).create(s.companyId, {
      title: "con", parentId, createdByAgentId: actor, assigneeAgentId: assignee,
    } as never);
  const assigneeOf = async (id: string) => (await db.select().from(issues).where(eq(issues.id, id)))[0]!.assigneeAgentId;
  const countIssues = async (companyId: string) =>
    (await db.select({ id: issues.id }).from(issues).where(eq(issues.companyId, companyId))).length;

  describe("H4 tạo issue con có assignee", () => {
    it("Trợ Lý giao cho executor hoặc agent ngoài vai trò (BMAD) được", async () => {
      const s = await seed();
      expect((await child(s, s.a, s.e1)).assigneeAgentId).toBe(s.e1);
      expect((await child(s, s.a, s.x)).assigneeAgentId).toBe(s.x);
    });

    it("executor giao cho executor khác hoặc chính mình được; integrator giao con sửa cho executor được", async () => {
      const s = await seed();
      expect((await child(s, s.e1, s.e2)).assigneeAgentId).toBe(s.e2);
      expect((await child(s, s.e1, s.e1)).assigneeAgentId).toBe(s.e1);
      expect((await child(s, s.i, s.e1)).assigneeAgentId).toBe(s.e1);
    });

    it.each([["agent ngoài vai trò", "x"], ["Trợ Lý", "a"]] as const)(
      "executor giao cho %s bị 422 crew_assignment_forbidden, không tạo issue",
      async (_label, target) => {
        const s = await seed();
        const before = await countIssues(s.companyId);
        await expect(child(s, s.e1, s[target])).rejects.toMatchObject({
          status: 422, details: { code: "crew_assignment_forbidden" },
        });
        expect(await countIssues(s.companyId)).toBe(before);
      },
    );

    it("project chưa có dòng vai trò hoặc company ngoài cấu hình: giữ hành vi cũ", async () => {
      const s = await seed();
      expect((await child(s, s.e1, s.x, s.rootQ)).assigneeAgentId).toBe(s.x);
      const absent = await seed("absent");
      expect((await child(absent, absent.e1, absent.x)).assigneeAgentId).toBe(absent.x);
    });

    it("luật giao cho reviewer/integrator vẫn đứng trước, kể cả với Trợ Lý", async () => {
      const s = await seed();
      await expect(child(s, s.a, s.r)).rejects.toMatchObject({ status: 422, details: { code: "crew_role_assignee" } });
    });

    it.each([
      ["projectId của project không có dòng vai trò", (s: Seed) => ({ projectId: s.q })],
      ["inheritExecutionWorkspaceFromIssueId sang issue của project khác", (s: Seed) => ({ inheritExecutionWorkspaceFromIssueId: s.rootQ })],
      ["skipExecutionWorkspaceInheritance (con không có project)", () => ({ skipExecutionWorkspaceInheritance: true })],
    ] as const)("agent tạo con nằm ngoài project của cha (%s) bị 422, không tạo issue", async (_label, extra) => {
      const s = await seed();
      const before = await countIssues(s.companyId);
      for (const [actor, assignee] of [[s.e1, s.x], [s.e1, s.e2], [s.a, s.e1]] as const) {
        await expect(
          issueService(db).create(s.companyId, {
            title: "con", parentId: s.root, createdByAgentId: actor, assigneeAgentId: assignee, ...extra(s),
          } as never),
        ).rejects.toMatchObject({ status: 422, details: { code: "crew_project_outside_parent" } });
      }
      expect(await countIssues(s.companyId)).toBe(before);
    });

    it("agent tạo con ghi rõ đúng project của cha vẫn được; board tạo con ở project khác như cũ", async () => {
      const s = await seed();
      const own = await issueService(db).create(s.companyId, {
        title: "con", parentId: s.root, createdByAgentId: s.a, assigneeAgentId: s.e1, projectId: s.p,
      } as never);
      expect(own).toMatchObject({ projectId: s.p, assigneeAgentId: s.e1 });
      const board = await issueService(db).create(s.companyId, {
        title: "con", parentId: s.root, createdByUserId: "owner-1", assigneeAgentId: s.x, projectId: s.q,
      } as never);
      expect(board).toMatchObject({ projectId: s.q, assigneeAgentId: s.x });
    });
  });

  // Như route PATCH: transition stock rồi updateIssue và chèn decision trong cùng transaction.
  async function act(s: Seed, issueId: string, agentId: string, requestedStatus: string) {
    const [row] = await db.select().from(issues).where(eq(issues.id, issueId));
    const policy = normalizeIssueExecutionPolicy(row!.executionPolicy);
    const transition = applyIssueExecutionPolicyTransition({
      issue: row as never, policy, previousPolicy: policy, requestedStatus, requestedAssigneePatch: {},
      actor: { agentId, userId: null }, allowBoardOverride: false, commentBody: "ok",
    });
    const decisionId = transition.decision ? randomUUID() : null;
    if (decisionId) transition.patch.executionState = { ...(transition.patch.executionState as object), lastDecisionId: decisionId };
    return db.transaction(async (tx) => {
      const updated = await issueService(db).update(
        issueId, { status: requestedStatus as never, ...transition.patch, actorAgentId: agentId }, tx, [], [],
      );
      if (transition.decision && decisionId) {
        await tx.insert(issueExecutionDecisions).values({
          id: decisionId, companyId: s.companyId, issueId, stageId: transition.decision.stageId,
          stageType: transition.decision.stageType, actorAgentId: agentId, outcome: transition.decision.outcome,
          body: transition.decision.body,
        });
      }
      return updated;
    });
  }

  describe("H2 đổi assignee", () => {
    it("executor chuyển việc của mình cho agent ngoài vai trò hoặc Trợ Lý bị 422, DB không đổi", async () => {
      const s = await seed();
      const issueId = await insertIssue(s.companyId, { projectId: s.p, parentId: s.root, assigneeAgentId: s.e1, status: "in_progress" });
      for (const target of [s.x, s.a]) {
        await expect(issueService(db).update(issueId, { assigneeAgentId: target, actorAgentId: s.e1 })).rejects.toMatchObject({
          status: 422, details: { code: "crew_assignment_forbidden" },
        });
        expect(await assigneeOf(issueId)).toBe(s.e1);
      }
    });

    it("executor chuyển cho executor khác được; Trợ Lý chuyển cho agent ngoài vai trò được", async () => {
      const s = await seed();
      const issueId = await insertIssue(s.companyId, { projectId: s.p, parentId: s.root, assigneeAgentId: s.e1, status: "in_progress" });
      expect((await issueService(db).update(issueId, { assigneeAgentId: s.e2, actorAgentId: s.e1 }))?.assigneeAgentId).toBe(s.e2);
      expect((await issueService(db).update(issueId, { assigneeAgentId: s.x, actorAgentId: s.a }))?.assigneeAgentId).toBe(s.x);
    });

    it("agent đổi project của issue bị 422 crew_project_locked, rồi đổi assignee vẫn bị luật của project cũ chặn", async () => {
      const s = await seed();
      const issueId = await insertIssue(s.companyId, { projectId: s.p, parentId: s.root, assigneeAgentId: s.e1, status: "in_progress" });
      for (const actor of [s.e1, s.a]) {
        for (const projectId of [s.q, null]) {
          await expect(issueService(db).update(issueId, { projectId, actorAgentId: actor })).rejects.toMatchObject({
            status: 422, details: { code: "crew_project_locked" },
          });
        }
      }
      await expect(issueService(db).update(issueId, { assigneeAgentId: s.x, actorAgentId: s.e1 })).rejects.toMatchObject({
        status: 422, details: { code: "crew_assignment_forbidden" },
      });
      const [row] = await db.select().from(issues).where(eq(issues.id, issueId));
      expect(row).toMatchObject({ projectId: s.p, assigneeAgentId: s.e1 });
    });

    it("agent gửi lại đúng project hiện tại vẫn được; board đổi project được", async () => {
      const s = await seed();
      const issueId = await insertIssue(s.companyId, { projectId: s.p, parentId: s.root, assigneeAgentId: s.e1, status: "in_progress" });
      expect((await issueService(db).update(issueId, { projectId: s.p, title: "Việc mới", actorAgentId: s.e1 }))?.title).toBe("Việc mới");
      expect((await issueService(db).update(issueId, { projectId: s.q, actorUserId: "owner-1" }))?.projectId).toBe(s.q);
    });

    it("executor chỉ tự nhận issue chưa giao agent nào; issue của Trợ Lý hay executor khác thì 422", async () => {
      const s = await seed();
      for (const owner of [s.a, s.e1]) {
        const issueId = await insertIssue(s.companyId, { projectId: s.p, parentId: s.root, assigneeAgentId: owner, status: "todo" });
        await expect(issueService(db).update(issueId, { assigneeAgentId: s.e2, actorAgentId: s.e2 })).rejects.toMatchObject({
          status: 422, details: { code: "crew_assignment_forbidden" },
        });
        expect(await assigneeOf(issueId)).toBe(owner);
      }
      const free = await insertIssue(s.companyId, { projectId: s.p, parentId: s.root, status: "todo" });
      expect((await issueService(db).update(free, { assigneeAgentId: s.e2, actorAgentId: s.e2 }))?.assigneeAgentId).toBe(s.e2);
    });

    it("không đọc được bảng vai trò: agent đổi assignee hay trạng thái bị 503, board vẫn đổi được", async () => {
      const s = await seed();
      const issueId = await insertIssue(s.companyId, { projectId: s.p, parentId: s.root, assigneeAgentId: s.e1, status: "in_progress" });
      const table = crewRolesTable();
      // Cột executor chỉ được đọc khi đổi assignee; cột reviewer được đọc ở mọi lệnh ghi qua cổng.
      const cases = [
        ["executor_agent_ids", [{ assigneeAgentId: s.e2 }]],
        ["reviewer_agent_id", [{ assigneeAgentId: s.e2 }, { status: "blocked" as const }]],
      ] as const;
      for (const [column, patches] of cases) {
        await db.execute(sql.raw(`ALTER TABLE ${table} RENAME COLUMN ${column} TO ${column}_broken`));
        try {
          for (const patch of patches) {
            await expect(issueService(db).update(issueId, { ...patch, actorAgentId: s.e1 })).rejects.toMatchObject({
              status: 503, details: { code: "crew_roles_unavailable" },
            });
          }
          expect(await db.select().from(issues).where(eq(issues.id, issueId))).toMatchObject([
            { assigneeAgentId: s.e1, status: "in_progress" },
          ]);
        } finally {
          await db.execute(sql.raw(`ALTER TABLE ${table} RENAME COLUMN ${column}_broken TO ${column}`));
        }
      }
      await db.execute(sql.raw(`ALTER TABLE ${table} RENAME COLUMN executor_agent_ids TO executor_agent_ids_broken`));
      try {
        expect((await issueService(db).update(issueId, { assigneeAgentId: s.x, actorUserId: "owner-1" }))?.assigneeAgentId).toBe(s.x);
      } finally {
        await db.execute(sql.raw(`ALTER TABLE ${table} RENAME COLUMN executor_agent_ids_broken TO executor_agent_ids`));
      }
    });

    it("project chưa có dòng vai trò: executor chuyển cho agent khác như cũ", async () => {
      const s = await seed();
      const issueId = await insertIssue(s.companyId, { projectId: s.q, parentId: s.rootQ, assigneeAgentId: s.e1, status: "in_progress" });
      expect((await issueService(db).update(issueId, { assigneeAgentId: s.x, actorAgentId: s.e1 }))?.assigneeAgentId).toBe(s.x);
    });

    it("workflow stock vẫn chạy: executor nộp → reviewer, reviewer trả về → executor, nộp lại → reviewer duyệt", async () => {
      const s = await seed();
      const policy = buildCrewPolicy("child", { reviewerAgentId: s.r, integratorAgentId: s.i });
      const issueId = await insertIssue(s.companyId, {
        projectId: s.p, parentId: s.root, assigneeAgentId: s.e1, status: "in_progress", executionPolicy: policy,
      });
      expect(await act(s, issueId, s.e1, "done")).toMatchObject({ status: "in_review", assigneeAgentId: s.r });
      expect(await act(s, issueId, s.r, "in_progress")).toMatchObject({ status: "in_progress", assigneeAgentId: s.e1 });
      expect(await act(s, issueId, s.e1, "done")).toMatchObject({ status: "in_review", assigneeAgentId: s.r });
      expect((await act(s, issueId, s.r, "done"))?.status).toBe("done");
    });
  });
  describe("ô runtime: executor Codex/OpenCode, reviewer Codex", () => {
    const MACHINE = "50000000-0000-4000-8000-0000000000aa";
    const WORKSPACE = "/Users/owner/crew-agents/repo-p/reviewer-codex";

    /** Thêm vào seed: executor Codex EC, executor OpenCode EO, reviewer Codex CR (environment trỏ checkout trên máy M). */
    async function seedRuntimes(opts: { reviewerEnvironment?: boolean; reviewerStatus?: string; switchOn?: boolean } = {}) {
      const s = await seed();
      const [ec, eo, cr] = [randomUUID(), randomUUID(), randomUUID()];
      let environmentId: string | null = null;
      if (opts.reviewerEnvironment !== false) {
        environmentId = randomUUID();
        await db.insert(environments).values({
          id: environmentId, name: `repo-p-reviewer-codex-${environmentId.slice(0, 8)}`, driver: "ssh", status: "active",
          config: { host: "mac.example.test", port: 22, username: "agent", remoteWorkspacePath: WORKSPACE },
        });
      }
      const row = (id: string, name: string, adapterType: string, extra: Record<string, unknown> = {}) => ({
        id, companyId: s.companyId, name, role: "engineer", status: "idle", adapterType, adapterConfig: {}, permissions: {},
        runtimeConfig: { heartbeat: { enabled: false, wakeOnDemand: false, maxConcurrentRuns: 1 } }, ...extra,
      });
      await db.insert(agents).values([
        row(ec, "Executor Codex", "codex_local"),
        row(eo, "Executor OpenCode", "opencode_local"),
        row(cr, "Reviewer Codex", "codex_local", { status: opts.reviewerStatus ?? "idle", defaultEnvironmentId: environmentId }),
      ]);
      await db.execute(sql`UPDATE ${sql.raw(crewRolesTable())} SET codex_executor_agent_id = ${ec},
        opencode_executor_agent_id = ${eo}, codex_reviewer_agent_id = ${cr}
        WHERE company_id = ${s.companyId} AND project_id = ${s.p}`);
      const ns = crewRolesTable().split(".")[0]!;
      await db.execute(sql.raw(`INSERT INTO ${ns}.machine_latest (company_id, machine_id, hostname, received_at, sent_at, report)
        VALUES ('${s.companyId}', '${MACHINE}', 'mac', now(), now(), '${JSON.stringify({ checkouts: [{ path: WORKSPACE }] })}'::jsonb)`));
      if (opts.switchOn !== false) await setCodex(s.companyId, true);
      return { ...s, ec, eo, cr };
    }
    type RuntimeSeed = Awaited<ReturnType<typeof seedRuntimes>>;
    const setCodex = (companyId: string, enabled: boolean) =>
      db.execute(sql.raw(`INSERT INTO ${crewRuntimeSwitchesTable()} (company_id, machine_id, runtime, enabled, updated_by_user_id)
        VALUES ('${companyId}', '${MACHINE}', 'codex_local', ${enabled}, 'owner')
        ON CONFLICT (company_id, machine_id, runtime) DO UPDATE SET enabled = EXCLUDED.enabled`));

    type Stage = { participants: { agentId?: string | null }[] };
    const reviewers = (issue: { executionPolicy: unknown } | null | undefined) =>
      ((issue?.executionPolicy as { stages: Stage[] } | null)?.stages ?? []).map((stage) => stage.participants.map((p) => p.agentId));
    const childOf = (s: RuntimeSeed, values: Record<string, unknown>) =>
      issueService(db).create(s.companyId, { title: "con", parentId: s.root, ...values } as never);

    it("đọc ba cột mới: reviewer Codex vào vai trò, executor runtime vào tập executor, reviewer Codex vào tập cấm giao", async () => {
      const s = await seedRuntimes();
      const config = await loadCrewRoles({ db, companyId: s.companyId, projectId: s.p });
      expect(config).toMatchObject({ kind: "ok", roles: { reviewerAgentId: s.r, integratorAgentId: s.i, codexReviewerAgentId: s.cr } });
      const other = await loadCrewRoles({ db, companyId: s.companyId, projectId: s.q });
      expect(other.kind === "ok" ? other.roles.codexReviewerAgentId ?? null : "x").toBeNull();
      expect((await loadProjectAgentRoles({ db, companyId: s.companyId, projectId: s.p, onReadError: "throw" }))?.executorAgentIds).toEqual([
        s.e1, s.e2, s.ec, s.eo,
      ]);
      expect(await loadCompanyRoleAgentIds({ db, companyId: s.companyId })).toEqual(new Set([s.r, s.i, s.cr]));
    });

    it("executor giao con cho executor Codex/OpenCode được; agent giao cho reviewer Codex bị 422 ở H4 và H2", async () => {
      const s = await seedRuntimes();
      expect((await child(s, s.e1, s.ec)).assigneeAgentId).toBe(s.ec);
      expect((await child(s, s.ec, s.eo)).assigneeAgentId).toBe(s.eo);
      await expect(child(s, s.a, s.cr)).rejects.toMatchObject({ status: 422, details: { code: "crew_role_assignee" } });
      const issueId = await insertIssue(s.companyId, { projectId: s.p, parentId: s.root, assigneeAgentId: s.e1, status: "in_progress" });
      await expect(issueService(db).update(issueId, { assigneeAgentId: s.cr, actorAgentId: s.a })).rejects.toMatchObject({
        status: 422, details: { code: "crew_role_assignee" },
      });
      expect(await assigneeOf(issueId)).toBe(s.e1);
    });

    it("H4: issue con của executor Claude/OpenCode nhận [reviewer Codex, reviewer Claude] khi Codex bật trên máy reviewer", async () => {
      const s = await seedRuntimes();
      expect(reviewers(await childOf(s, { createdByAgentId: s.a, assigneeAgentId: s.e1 }))).toEqual([[s.cr, s.r]]);
      expect(reviewers(await childOf(s, { createdByAgentId: s.a, assigneeAgentId: s.eo }))).toEqual([[s.cr, s.r]]);
      // Chưa giao ai, board hay hệ thống tạo con: cũng là issue con code.
      expect(reviewers(await childOf(s, { createdByAgentId: s.a }))).toEqual([[s.cr, s.r]]);
      expect(reviewers(await childOf(s, { createdByUserId: "owner-1", assigneeAgentId: s.e1 }))).toEqual([[s.cr, s.r]]);
    });

    it("H4 giữ reviewer Claude: executor Codex (assignee hay marker runtime=), bmad, issue gốc, Codex tắt, reviewer pause, không environment", async () => {
      const s = await seedRuntimes();
      const marker = (runtime: string) =>
        `Việc\ncrew-model complexity=small model=gpt-6-luna effort=medium runtime=${runtime} reason=thử\n`;
      expect(reviewers(await childOf(s, { createdByAgentId: s.a, assigneeAgentId: s.ec }))).toEqual([[s.r]]);
      expect(reviewers(await childOf(s, { createdByAgentId: s.a, description: marker("codex_local") }))).toEqual([[s.r]]);
      // Marker thắng adapterType: assignee Claude mà marker Codex vẫn coi là executor Codex, và ngược lại.
      expect(reviewers(await childOf(s, { createdByAgentId: s.a, assigneeAgentId: s.e1, description: marker("codex_local") }))).toEqual([[s.r]]);
      expect(reviewers(await childOf(s, { createdByAgentId: s.a, assigneeAgentId: s.ec, description: marker("opencode_local") }))).toEqual([[s.cr, s.r]]);
      expect(reviewers(await childOf(s, { createdByAgentId: s.a, assigneeAgentId: s.e1, description: "crew-kind bmad\n" }))[0]).toEqual([s.r]);
      const root = await issueService(db).create(s.companyId, { title: "gốc", projectId: s.p, createdByUserId: "owner-1" } as never);
      expect(reviewers(root)[0]).toEqual([s.r]);

      await setCodex(s.companyId, false);
      expect(reviewers(await childOf(s, { createdByAgentId: s.a, assigneeAgentId: s.e1 }))).toEqual([[s.r]]);

      const paused = await seedRuntimes({ reviewerStatus: "paused" });
      expect(reviewers(await childOf(paused, { createdByAgentId: paused.a, assigneeAgentId: paused.e1 }))).toEqual([[paused.r]]);
      const terminated = await seedRuntimes({ reviewerStatus: "terminated" });
      expect(reviewers(await childOf(terminated, { createdByAgentId: terminated.a, assigneeAgentId: terminated.e1 }))).toEqual([[terminated.r]]);
      // Reviewer Codex không có environment: không xác định máy, dùng công tắc mặc định (tắt) dù company chỉ một máy.
      const noEnv = await seedRuntimes({ reviewerEnvironment: false });
      expect(reviewers(await childOf(noEnv, { createdByAgentId: noEnv.a, assigneeAgentId: noEnv.e1 }))).toEqual([[noEnv.r]]);
    });

    it("đầu-cuối: Codex review, trả về, nộp lại; hệ thống chuyển sang reviewer Claude; Claude duyệt done", async () => {
      const s = await seedRuntimes();
      const created = await childOf(s, { createdByAgentId: s.a, assigneeAgentId: s.e1 });
      const issueId = created.id;
      await db.update(issues).set({ status: "in_progress" }).where(eq(issues.id, issueId));
      // Stock chọn participant đầu (Codex); sau changes_requested giữ Codex.
      expect(await act(s, issueId, s.e1, "done")).toMatchObject({ status: "in_review", assigneeAgentId: s.cr });
      expect(await act(s, issueId, s.cr, "in_progress")).toMatchObject({ status: "in_progress", assigneeAgentId: s.e1 });
      expect(await act(s, issueId, s.e1, "done")).toMatchObject({ status: "in_review", assigneeAgentId: s.cr });

      const [before] = await db.select().from(issues).where(eq(issues.id, issueId));
      const lockedState = before!.executionState as Record<string, unknown>;
      expect(lockedState).toMatchObject({ status: "pending", currentParticipant: { agentId: s.cr }, changesRequestedCount: 1 });
      const swapped = { ...lockedState, currentParticipant: { type: "agent", agentId: s.r, userId: null } };

      // Agent tự sửa state (kể cả reviewer Codex) bị chặn; DB không đổi.
      for (const actorAgentId of [s.cr, s.e1, s.a]) {
        await expect(
          issueService(db).update(issueId, { executionState: swapped, assigneeAgentId: s.r, actorAgentId } as never),
        ).rejects.toMatchObject({ status: 422, details: { code: "crew_policy_locked", violations: ["participant_changed"] } });
      }
      // Hệ thống chuyển sai đích hay thiếu assignee: chặn.
      const toIntegrator = { ...lockedState, currentParticipant: { type: "agent", agentId: s.i, userId: null } };
      await expect(issueService(db).update(issueId, { executionState: toIntegrator, assigneeAgentId: s.i } as never)).rejects.toMatchObject({
        status: 422, details: { violations: ["participant_changed"] },
      });
      await expect(issueService(db).update(issueId, { executionState: swapped } as never)).rejects.toMatchObject({
        status: 422, details: { violations: ["participant_changed"] },
      });
      const [unchanged] = await db.select().from(issues).where(eq(issues.id, issueId));
      expect(unchanged).toMatchObject({ status: "in_review", assigneeAgentId: s.cr, executionState: lockedState });

      // Lệnh đúng của hệ thống (không actor): chỉ đổi participant + assignee.
      const moved = await issueService(db).update(issueId, { executionState: swapped, assigneeAgentId: s.r } as never);
      expect(moved).toMatchObject({ status: "in_review", assigneeAgentId: s.r });
      const [after] = await db.select().from(issues).where(eq(issues.id, issueId));
      expect(after!.executionPolicy).toEqual(before!.executionPolicy);
      expect(after!.executionState).toEqual(swapped);
      const actions = async (action: string) =>
        db.select().from(activityLog).where(and(eq(activityLog.entityId, issueId), eq(activityLog.action, action)));
      expect(await actions("crew.gate.codex_reviewer_fallback")).toMatchObject([
        { actorType: "system", details: { fromAgentId: s.cr, toAgentId: s.r } },
      ]);
      expect(await actions("crew.policy.board_override")).toEqual([]);

      // Lặp lại lệnh cũ (state đã là Claude): chặn, không đổi về Codex.
      const back = { ...swapped, currentParticipant: { type: "agent", agentId: s.cr, userId: null } };
      await expect(issueService(db).update(issueId, { executionState: back, assigneeAgentId: s.cr } as never)).rejects.toMatchObject({
        status: 422, details: { violations: ["participant_changed"] },
      });
      // Reviewer Codex không duyệt thay được nữa; reviewer Claude duyệt là done.
      await expect(act(s, issueId, s.cr, "done")).rejects.toMatchObject({ status: 422 });
      expect((await act(s, issueId, s.r, "done"))?.status).toBe("done");
    });
  });
});

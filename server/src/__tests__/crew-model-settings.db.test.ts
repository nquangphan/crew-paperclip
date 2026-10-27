import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import {
  activityLog, agentConfigRevisions, agents, companies, createDb, issues, plugins, projects,
} from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import manifest from "../../../packages/crew-plugin/src/manifest.ts";
import { overrideCrewCoreHooksForTests } from "../crew/core-hooks.ts";
import { buildCrewPolicy, CREW_POLICY_CONFIG_ENV } from "../crew/issue-policy.ts";
import { CREW_RUNTIME_CATALOG, CREW_RUNTIME_ORDER } from "../crew/model-policy.ts";
import {
  clearModelSettingsCache, CREW_MODEL_SETTINGS_DEFAULT, type CrewModelSettings, crewModelSettingsTable,
} from "../crew/model-settings.ts";
import { crewRolesTable } from "../crew/project-roles.ts";
import { heartbeatService } from "../services/heartbeat.js";
import { applyIssueExecutionPolicyTransition, normalizeIssueExecutionPolicy } from "../services/issue-execution-policy.js";
import { issueService } from "../services/issues.js";
import { pluginDatabaseService } from "../services/plugin-database.js";

// Cài đặt model trên Postgres nhúng: route thật (gắn trong router góp ý), migration plugin thật (runner kiểm luật),
// service agent thật (revision cấu hình) và issue service thật (H2/H4). Adapter được mock để không run nào chạy CLI.
const execute = vi.hoisted(() => vi.fn());
vi.mock("../adapters/index.js", async () => {
  const actual = await vi.importActual<typeof import("../adapters/index.js")>("../adapters/index.js");
  return { ...actual, getServerAdapter: vi.fn(() => ({ supportsLocalAgentJwt: false, execute })) };
});

const support = await getEmbeddedPostgresTestSupport();
const suite = support.supported ? describe.sequential : describe.skip;

const OWNER = "owner-1";
const ADMIN = "admin-1";
const pluginId = randomUUID();
const pluginRoot = fileURLToPath(new URL("../../../packages/crew-plugin", import.meta.url));
const URL_BASE = "/api/crew/model-settings";

type Settings = CrewModelSettings;
const clone = (settings: Readonly<Settings>): Settings => structuredClone(settings) as Settings;

suite("Crew: cài đặt model", () => {
  let db: ReturnType<typeof createDb>;
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let restore: (() => void) | null = null;
  const configDir = mkdtempSync(path.join(tmpdir(), "crew-model-settings-"));
  const configFile = path.join(configDir, "crew-policy.json");
  const previousEnv = process.env[CREW_POLICY_CONFIG_ENV];

  const crew = {
    companyId: randomUUID(), projectId: randomUUID(), project2Id: randomUUID(), otherCompanyId: randomUUID(),
    assistant: randomUUID(), exec1: randomUUID(), exec2: randomUUID(), execPending: randomUUID(), exec3: randomUUID(),
    reviewer: randomUUID(), integrator: randomUUID(), codexExec: randomUUID(), codexReviewer: randomUUID(),
    codexPending: randomUUID(), codexTerminated: randomUUID(), solAgent: randomUUID(), bmad: randomUUID(), foreignLuna: randomUUID(),
  };

  beforeAll(async () => {
    writeFileSync(configFile, JSON.stringify({
      companies: { [crew.companyId]: { reviewerAgentId: crew.reviewer, integratorAgentId: crew.integrator, ownerUserId: OWNER } },
    }));
    process.env[CREW_POLICY_CONFIG_ENV] = configFile;
    temporary = await startEmbeddedPostgresTestDatabase("crew-model-settings-");
    db = createDb(temporary.connectionString);
    clearModelSettingsCache();
  }, 60_000);
  beforeEach(() => {
    restore = overrideCrewCoreHooksForTests({ beforeClaim: async () => true });
  });
  afterEach(async () => {
    restore?.();
    restore = null;
    await heartbeatService(db).drainActiveRunExecutions();
  });
  afterAll(async () => {
    if (previousEnv === undefined) delete process.env[CREW_POLICY_CONFIG_ENV];
    else process.env[CREW_POLICY_CONFIG_ENV] = previousEnv;
    rmSync(configDir, { recursive: true, force: true });
    clearModelSettingsCache();
    await db?.$client.end({ timeout: 0 });
    await temporary?.cleanup();
  });

  async function app(actor: Record<string, unknown>) {
    const [{ crewContributionRoutes }, { errorHandler }] = await Promise.all([
      import("../crew/contribution-routes.js"),
      import("../middleware/index.js"),
    ]);
    const server = express();
    server.use(express.json());
    server.use((req, _res, next) => {
      req.actor = actor as typeof req.actor;
      next();
    });
    server.use("/api", crewContributionRoutes(db));
    server.use(errorHandler);
    return server;
  }

  const actors = {
    admin: { type: "board", userId: ADMIN, source: "session", isInstanceAdmin: true, companyIds: [] },
    companyOwner: {
      type: "board", userId: OWNER, source: "session", isInstanceAdmin: false, companyIds: [crew.companyId],
      memberships: [{ companyId: crew.companyId, membershipRole: "owner", status: "active" }],
    },
    viewer: {
      type: "board", userId: "viewer-1", source: "session", isInstanceAdmin: false, companyIds: [crew.companyId],
      memberships: [{ companyId: crew.companyId, membershipRole: "viewer", status: "active" }],
    },
    boardKey: { type: "board", userId: ADMIN, source: "board_key", isInstanceAdmin: true, companyIds: [] },
    agent: { type: "agent", agentId: crew.assistant, companyId: crew.companyId, runId: randomUUID(), source: "agent_jwt" },
    local: { type: "board", userId: "local-board", source: "local_implicit", isInstanceAdmin: true },
    none: { type: "none", source: "none" },
  } as const;

  const get = async (actor: Record<string, unknown> = actors.admin) => request(await app(actor)).get(URL_BASE);
  const put = async (body: unknown, actor: Record<string, unknown> = actors.admin) =>
    request(await app(actor)).put(URL_BASE).send(body as object);
  const upgrade = async (body: unknown, actor: Record<string, unknown> = actors.admin) =>
    request(await app(actor)).post(`${URL_BASE}/upgrade`).send(body as object);
  const current = async () => (await get()).body as { revision: number; settings: Settings };

  const countRevisions = async () =>
    Number((await db.execute(sql.raw(`SELECT count(*)::int AS n FROM ${crewModelSettingsTable()}`)) as unknown as { n: number }[])[0]!.n);
  const agentRow = async (id: string) => (await db.select().from(agents).where(eq(agents.id, id)))[0]!;
  const configOf = async (id: string) => (await agentRow(id)).adapterConfig as Record<string, unknown>;
  const issueRow = async (id: string) => (await db.select().from(issues).where(eq(issues.id, id)))[0]!;

  async function seed() {
    await db.insert(plugins).values({
      id: pluginId, pluginKey: manifest.id, packageName: "@crew/paperclip-plugin", version: manifest.version,
      apiVersion: manifest.apiVersion, categories: manifest.categories, manifestJson: manifest, status: "installed",
    });
    await pluginDatabaseService(db).applyMigrations(pluginId, manifest, pluginRoot);
    for (const [id, name] of [[crew.companyId, "Crew"], [crew.otherCompanyId, "Khác"]] as const) {
      await db.insert(companies).values({
        id, name, issuePrefix: `M${id.replaceAll("-", "").slice(0, 5).toUpperCase()}`, defaultResponsibleUserId: OWNER,
      });
    }
    await db.insert(projects).values([
      { id: crew.projectId, companyId: crew.companyId, name: "repo-a" },
      { id: crew.project2Id, companyId: crew.companyId, name: "repo-b" },
    ]);
    const agent = (
      id: string, name: string, adapterType: string, adapterConfig: Record<string, unknown>,
      extra: { status?: string; companyId?: string } = {},
    ) => ({
      id, companyId: extra.companyId ?? crew.companyId, name, role: "engineer", status: extra.status ?? "idle", adapterType,
      adapterConfig, permissions: {}, runtimeConfig: { heartbeat: { enabled: false, wakeOnDemand: true, maxConcurrentRuns: 1 } },
    });
    const claude = (model: string) => ({ engine: "cli", command: "/Users/a/.crew/bin/crew-claude-run", extraArgs: [], model, env: {} });
    const codex = (model: string, effort: string) => ({
      engine: "cli", command: "/Users/a/.crew/bin/crew-codex-run", model, modelReasoningEffort: effort,
      dangerouslyBypassApprovalsAndSandbox: true, env: { CODEX_HOME: "/paperclip/x" },
    });
    await db.insert(agents).values([
      agent(crew.assistant, "a-assistant", "claude_local", claude("claude-opus-5-5")),
      agent(crew.exec1, "b-exec1", "claude_local", claude("claude-sonnet-5-5")),
      agent(crew.exec2, "c-exec2-manual", "claude_local", claude("claude-sonnet-5")),
      agent(crew.execPending, "d-exec-pending", "claude_local", claude("claude-sonnet-5-5"), { status: "pending_approval" }),
      agent(crew.exec3, "e-exec3-integrator", "claude_local", claude("claude-sonnet-5-5")),
      agent(crew.reviewer, "f-reviewer", "claude_local", claude("claude-sonnet-5-5")),
      agent(crew.integrator, "g-integrator", "claude_local", claude("claude-sonnet-5-5")),
      agent(crew.codexExec, "h-codex-exec", "codex_local", codex("gpt-6-luna", "medium")),
      agent(crew.codexReviewer, "i-codex-reviewer", "codex_local", codex("gpt-6-sol", "high")),
      agent(crew.codexPending, "j-codex-pending", "codex_local", codex("gpt-6-luna", "medium"), { status: "pending_approval" }),
      agent(crew.codexTerminated, "k-codex-terminated", "codex_local", codex("gpt-6-luna", "medium"), { status: "terminated" }),
      agent(crew.bmad, "l-bmad", "claude_local", {
        ...claude("claude-opus-5-5"), extraArgs: ["--plugin-dir", "/Users/a/.crew/workflows/bmad/6.0"],
      }),
      agent(crew.foreignLuna, "m-foreign", "codex_local", codex("gpt-6-luna", "medium"), { companyId: crew.otherCompanyId }),
    ]);
    const roles = crewRolesTable();
    await db.execute(sql`INSERT INTO ${sql.raw(roles)} (company_id, project_id, assistant_agent_id, executor_agent_ids,
        reviewer_agent_id, integrator_agent_id, updated_by_user_id, codex_executor_agent_id, opencode_executor_agent_id,
        codex_reviewer_agent_id)
      VALUES (${crew.companyId}, ${crew.projectId}, ${crew.assistant}, ARRAY[${crew.exec1}, ${crew.exec2}]::uuid[], ${crew.reviewer},
        ${crew.integrator}, ${OWNER}, ${crew.codexExec}, NULL, ${crew.codexReviewer}),
        (${crew.companyId}, ${crew.project2Id}, ${crew.assistant}, ARRAY[${crew.execPending}, ${crew.exec3}]::uuid[], ${crew.reviewer},
        ${crew.exec3}, ${OWNER}, NULL, NULL, NULL)`);
    await db.execute(sql`INSERT INTO ${sql.raw(roles.replace("crew_project_roles", "crew_companies"))} (company_id, name)
      VALUES (${crew.companyId}, 'Crew')`);
  }

  async function issue(values: Partial<typeof issues.$inferInsert>) {
    const id = randomUUID();
    await db.insert(issues).values({
      id, companyId: crew.companyId, projectId: crew.projectId, title: "Việc thử", status: "todo", createdByUserId: OWNER,
      responsibleUserId: OWNER, ...values,
    });
    return id;
  }

  /** Lệnh ghi như route PATCH: transition stock của policy rồi `issueService.update` (H2). */
  async function act(issueId: string, agentId: string, requestedStatus: string) {
    const row = await issueRow(issueId);
    const policy = normalizeIssueExecutionPolicy(row.executionPolicy);
    const transition = applyIssueExecutionPolicyTransition({
      issue: row as never, policy, previousPolicy: policy, requestedStatus, requestedAssigneePatch: {},
      actor: { agentId, userId: null }, allowBoardOverride: false, commentBody: "ok",
    });
    if (transition.decision) {
      transition.patch.executionState = { ...(transition.patch.executionState as object), lastDecisionId: randomUUID() };
    }
    await issueService(db).update(issueId, {
      status: requestedStatus as never, ...transition.patch, actorAgentId: agentId, actorUserId: null,
    });
    return issueRow(issueId);
  }

  it("chưa có bảng: GET trả mặc định revision 0, PUT và POST trả 503", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ revision: 0, updatedAt: null, updatedByUserId: null, canEdit: true });
    expect(res.body.settings).toEqual(CREW_MODEL_SETTINGS_DEFAULT);
    const saved = await put({ baseRevision: 0, settings: CREW_MODEL_SETTINGS_DEFAULT });
    expect(saved.status).toBe(503);
    expect(saved.body.code).toBe("crew_model_settings_unavailable");
    const upgraded = await upgrade({ baseRevision: 0, runtime: "claude_local", fromModel: "claude-sonnet-5", toModel: "claude-sonnet-5-5" });
    expect(upgraded.status).toBe(503);
    await seed();
  }, 60_000);

  it("chưa có dòng nào: GET trả revision 0 và bảng mặc định = hằng số hôm nay", async () => {
    const res = await get();
    expect(res.body.revision).toBe(0);
    expect(res.body.settings.catalog).toEqual(CREW_RUNTIME_CATALOG);
    expect(res.body.settings.order).toEqual(CREW_RUNTIME_ORDER);
    expect(res.body.settings).toEqual(CREW_MODEL_SETTINGS_DEFAULT);
  });

  it("quyền: mọi actor đã xác thực đọc được, chỉ phiên instance admin sửa được", async () => {
    for (const actor of [actors.agent, actors.boardKey, actors.viewer, actors.companyOwner, actors.local]) {
      const res = await get(actor);
      expect(res.status, JSON.stringify(actor)).toBe(200);
      expect(res.body).toMatchObject({ revision: 0, canEdit: false });
    }
    expect((await get(actors.none)).status).toBe(401);

    const body = { baseRevision: 0, settings: CREW_MODEL_SETTINGS_DEFAULT, dryRun: true };
    const up = { baseRevision: 0, runtime: "claude_local", fromModel: "claude-opus-5", toModel: "claude-opus-5-5", dryRun: true };
    for (const actor of [actors.agent, actors.boardKey, actors.viewer, actors.companyOwner, actors.local, actors.none]) {
      const saved = await put(body, actor);
      expect(saved.status, JSON.stringify(actor)).toBe(403);
      expect(saved.body.code).toBe("crew_model_settings_forbidden");
      const upgraded = await upgrade(up, actor);
      expect(upgraded.status, JSON.stringify(actor)).toBe(403);
    }
    expect((await put(body)).status).toBe(200);
    expect((await upgrade(up)).status).toBe(200);
    expect(await countRevisions()).toBe(0);
  });

  it("body sai: 400; bảng sai luật: 422 kèm path; bản cũ: 409", async () => {
    expect((await put([])).status).toBe(400);
    const badBase = await put({ baseRevision: "x", settings: CREW_MODEL_SETTINGS_DEFAULT });
    expect(badBase.status).toBe(400);
    expect(badBase.body).toMatchObject({ code: "crew_model_settings_invalid", issues: [{ path: "baseRevision" }] });
    expect((await put({ baseRevision: 0, settings: CREW_MODEL_SETTINGS_DEFAULT, extra: 1 })).status).toBe(400);

    const blindLarge = clone(CREW_MODEL_SETTINGS_DEFAULT);
    blindLarge.catalog.claude_local.models["claude-opus-5-5"] = { vision: false };
    const invalid = await put({ baseRevision: 0, settings: blindLarge });
    expect(invalid.status).toBe(422);
    expect(invalid.body.code).toBe("crew_model_settings_invalid");
    expect(invalid.body.issues.map((i: { path: string }) => i.path)).toEqual(["catalog.claude_local.byComplexity.large.model"]);

    const stale = await put({ baseRevision: 5, settings: CREW_MODEL_SETTINGS_DEFAULT });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ code: "crew_model_settings_stale", currentRevision: 0 });
    expect(await countRevisions()).toBe(0);
  });

  it("đổi mặc định vai: dry-run không ghi gì mà trả đúng kết quả của lần lưu thật", async () => {
    const next = clone(CREW_MODEL_SETTINGS_DEFAULT);
    next.catalog.claude_local.models["claude-sonnet-6"] = { vision: true };
    next.roles.executor = { model: "claude-sonnet-6", effort: null };
    next.roles["executor-codex"] = { model: "gpt-6-luna", effort: "high" };

    const configsBefore = await Promise.all([crew.exec1, crew.codexExec].map(configOf));
    const revisionsBefore = (await db.select().from(agentConfigRevisions)).length;
    const dry = await put({ baseRevision: 0, settings: next, dryRun: true });
    expect(dry.status).toBe(200);
    expect(await countRevisions()).toBe(0);
    expect(await Promise.all([crew.exec1, crew.codexExec].map(configOf))).toEqual(configsBefore);
    expect((await db.select().from(agentConfigRevisions)).length).toBe(revisionsBefore);
    expect((await get()).body.revision).toBe(0);

    const saved = await put({ baseRevision: 0, settings: next });
    expect(saved.status).toBe(200);
    expect({ ...dry.body, dryRun: false }).toEqual(saved.body);
    expect(saved.body).toMatchObject({ revision: 1, dryRun: false });
    expect(saved.body.applied.agents).toEqual([
      {
        agentId: crew.exec1, companyId: crew.companyId, name: "b-exec1", role: "executor",
        from: { model: "claude-sonnet-5-5", effort: null }, to: { model: "claude-sonnet-6", effort: null },
      },
      {
        agentId: crew.codexExec, companyId: crew.companyId, name: "h-codex-exec", role: "executor-codex",
        from: { model: "gpt-6-luna", effort: "medium" }, to: { model: "gpt-6-luna", effort: "high" },
      },
    ]);
    expect(saved.body.applied.skipped).toEqual([
      { agentId: crew.exec2, companyId: crew.companyId, name: "c-exec2-manual", role: "executor", reason: "manual" },
      { agentId: crew.execPending, companyId: crew.companyId, name: "d-exec-pending", role: "executor", reason: "pending_approval" },
      { agentId: crew.exec3, companyId: crew.companyId, name: "e-exec3-integrator", role: "executor", reason: "multi_role" },
    ]);
    expect(await configOf(crew.exec1)).toMatchObject({ model: "claude-sonnet-6" });
    expect(await configOf(crew.exec1)).not.toHaveProperty("effort");
    // Phần còn lại giữ nguyên; env được lõi chuẩn hóa như mọi lệnh sửa agent.
    expect(await configOf(crew.codexExec)).toMatchObject({
      model: "gpt-6-luna", modelReasoningEffort: "high", dangerouslyBypassApprovalsAndSandbox: true,
      env: { CODEX_HOME: { type: "plain", value: "/paperclip/x" } },
    });
    expect(await configOf(crew.exec2)).toMatchObject({ model: "claude-sonnet-5" });

    for (const agentId of [crew.exec1, crew.codexExec]) {
      const logs = await db.select().from(activityLog)
        .where(and(eq(activityLog.entityId, agentId), eq(activityLog.action, "crew.model_settings.agent_model")));
      expect(logs).toHaveLength(1);
      expect(logs[0]!.details).toMatchObject({ revision: 1, cause: "role_default" });
      const revisions = await db.select().from(agentConfigRevisions).where(eq(agentConfigRevisions.agentId, agentId));
      expect(revisions).toHaveLength(1);
      expect(revisions[0]).toMatchObject({ source: "crew_model_settings", createdByUserId: ADMIN });
    }
    const row = await get(actors.agent);
    expect(row.body).toMatchObject({ revision: 1, updatedByUserId: ADMIN, canEdit: false });
    expect(row.body.settings).toEqual(next);
  });

  it("H4/H2: model vừa thêm được nhận ngay, model vừa gỡ bị crew_override_forbidden", async () => {
    const rootId = await issue({ status: "in_progress" });
    const { issue: child } = await issueService(db).createChild(rootId, {
      title: "con", createdByAgentId: crew.assistant, assigneeAgentId: crew.exec1,
      assigneeAdapterOverrides: { adapterConfig: { model: "claude-sonnet-6", effort: "low" } },
    } as never);
    expect((await issueRow(child.id)).assigneeAdapterOverrides).toEqual({ adapterConfig: { model: "claude-sonnet-6", effort: "low" } });

    const inUse = clone((await current()).settings);
    delete (inUse.catalog.claude_local.models as Record<string, unknown>)["claude-sonnet-5"];
    const blocked = await put({ baseRevision: 1, settings: inUse });
    expect(blocked.status).toBe(422);
    expect(blocked.body).toMatchObject({
      code: "crew_model_in_use",
      inUse: [{ runtime: "claude_local", model: "claude-sonnet-5", agents: 1, issues: 0 }],
    });
    const overridden = clone((await current()).settings);
    delete (overridden.catalog.claude_local.models as Record<string, unknown>)["claude-sonnet-6"];
    overridden.roles.executor = { model: "claude-sonnet-5-5", effort: null };
    const byIssue = await put({ baseRevision: 1, settings: overridden, dryRun: true });
    expect(byIssue.status).toBe(422);
    expect(byIssue.body.inUse).toEqual([{ runtime: "claude_local", model: "claude-sonnet-6", agents: 1, issues: 1 }]);

    const removed = clone((await current()).settings);
    delete (removed.catalog.claude_local.models as Record<string, unknown>)["claude-opus-5"];
    expect((await put({ baseRevision: 1, settings: removed })).status).toBe(200);
    await expect(issueService(db).createChild(rootId, {
      title: "con 2", createdByAgentId: crew.assistant, assigneeAgentId: crew.exec1,
      assigneeAdapterOverrides: { adapterConfig: { model: "claude-opus-5" } },
    } as never)).rejects.toMatchObject({
      status: 422, details: { code: "crew_override_forbidden", violations: ["adapterConfig.model:claude-opus-5@claude_local"] },
    });
    await expect(issueService(db).update(child.id, {
      assigneeAdapterOverrides: { adapterConfig: { model: "claude-opus-5" } }, actorAgentId: crew.assistant, actorUserId: null,
    } as never)).rejects.toMatchObject({ status: 422, details: { code: "crew_override_forbidden" } });
    await issueService(db).update(child.id, {
      assigneeAdapterOverrides: { adapterConfig: { model: "claude-sonnet-6", effort: "high" } }, actorAgentId: crew.assistant,
      actorUserId: null,
    } as never);
    expect((await issueRow(child.id)).assigneeAdapterOverrides).toEqual({ adapterConfig: { model: "claude-sonnet-6", effort: "high" } });
  });

  it("override reviewer Codex và reviewer gốc lấy từ roles", async () => {
    const next = clone((await current()).settings);
    next.roles["reviewer-codex"] = { model: "gpt-6-luna", effort: "medium" };
    next.roles["reviewer-root"] = { model: "claude-sonnet-5-5", effort: "low" };
    const saved = await put({ baseRevision: 2, settings: next });
    expect(saved.status).toBe(200);
    // Vai reviewer-root không có agent; agent reviewer Codex đang chạy đúng mặc định cũ nên đổi theo.
    expect(saved.body.applied.agents.map((a: { agentId: string }) => a.agentId)).toEqual([crew.codexReviewer]);

    const roles = { reviewerAgentId: crew.reviewer, integratorAgentId: crew.integrator };
    const parentId = await issue({ status: "in_progress" });
    const codexChild = await issue({
      status: "in_progress", assigneeAgentId: crew.exec1, parentId,
      assigneeAdapterOverrides: { adapterConfig: { model: "claude-sonnet-6", effort: "medium" } },
      executionPolicy: buildCrewPolicy("child", roles, null, { codexReviewerAgentId: crew.codexReviewer }),
    });
    expect(await act(codexChild, crew.exec1, "in_review")).toMatchObject({
      assigneeAgentId: crew.codexReviewer,
      assigneeAdapterOverrides: { adapterConfig: { model: "gpt-6-luna", modelReasoningEffort: "medium" } },
    });
    // Trả về executor: override đã cất vẫn hợp với catalog hiện hành nên được trả lại.
    expect(await act(codexChild, crew.codexReviewer, "in_progress")).toMatchObject({
      assigneeAgentId: crew.exec1,
      assigneeAdapterOverrides: { adapterConfig: { model: "claude-sonnet-6", effort: "medium" } },
    });

    // Issue không có `parentId`: reviewer Claude nhận override của issue gốc.
    const root = await issue({ status: "in_progress", assigneeAgentId: crew.exec1, executionPolicy: buildCrewPolicy("child", roles, null) });
    expect(await act(root, crew.exec1, "in_review")).toMatchObject({
      assigneeAgentId: crew.reviewer,
      assigneeAdapterOverrides: { adapterConfig: { model: "claude-sonnet-5-5", effort: "low" } },
    });
  });

  it("đọc bảng lỗi trong transaction ghi issue không làm hỏng lệnh ghi", async () => {
    const issueId = await issue({ status: "in_progress", assigneeAgentId: crew.exec1 });
    clearModelSettingsCache();
    await db.execute(sql.raw(`ALTER TABLE ${crewModelSettingsTable()} RENAME COLUMN settings TO settings_broken`));
    try {
      await issueService(db).update(issueId, {
        assigneeAdapterOverrides: { adapterConfig: { model: "claude-opus-5-5", effort: "high" } }, actorAgentId: crew.assistant,
        actorUserId: null,
      } as never);
      expect((await issueRow(issueId)).assigneeAdapterOverrides).toEqual({ adapterConfig: { model: "claude-opus-5-5", effort: "high" } });
    } finally {
      await db.execute(sql.raw(`ALTER TABLE ${crewModelSettingsTable()} RENAME COLUMN settings_broken TO settings`));
      clearModelSettingsCache();
    }
  });

  it("nâng hàng loạt, Y là id mới: đổi tên trong catalog, ô, vai, agent và override của issue đang mở", async () => {
    const luna = (model: string) => ({ adapterConfig: { model, modelReasoningEffort: "medium" } });
    const open = await issue({ status: "todo", assigneeAgentId: crew.codexExec, assigneeAdapterOverrides: luna("gpt-6-luna") });
    const done = await issue({ status: "done", assigneeAgentId: crew.codexExec, assigneeAdapterOverrides: luna("gpt-6-luna") });
    const foreign = randomUUID();
    await db.insert(issues).values({
      id: foreign, companyId: crew.otherCompanyId, title: "Khác", status: "todo", assigneeAdapterOverrides: luna("gpt-6-luna"),
    });
    const body = { baseRevision: 3, runtime: "codex_local", fromModel: "gpt-6-luna", toModel: "gpt-6-luna-2" };

    const dry = await upgrade({ ...body, dryRun: true });
    expect(dry.status).toBe(200);
    expect(await countRevisions()).toBe(3);
    expect((await configOf(crew.codexExec)).model).toBe("gpt-6-luna");
    expect((await issueRow(open)).assigneeAdapterOverrides).toEqual(luna("gpt-6-luna"));

    const real = await upgrade(body);
    expect(real.status).toBe(200);
    expect({ ...dry.body, dryRun: false }).toEqual(real.body);
    expect(real.body.revision).toBe(4);
    expect(real.body.changes).toMatchObject({
      catalog: "renamed",
      cells: [{ level: "trivial" }, { level: "small" }],
      roles: ["executor-codex", "reviewer-codex"],
      skipped: [{ agentId: crew.codexPending, reason: "pending_approval" }],
      issues: [{ issueId: open, companyId: crew.companyId }],
    });
    expect(real.body.changes.agents.map((a: { agentId: string }) => a.agentId)).toEqual([crew.codexExec, crew.codexReviewer]);
    expect(real.body.changes.agents[0]).toMatchObject({
      from: { model: "gpt-6-luna", effort: "high" }, to: { model: "gpt-6-luna-2", effort: "high" },
    });

    const after = (await current()).settings;
    expect(after.catalog.codex_local.models).toEqual({ "gpt-6-luna-2": { vision: true }, "gpt-6-sol": { vision: true } });
    expect(Object.values(after.catalog.codex_local.byComplexity).map((cell) => cell!.model)).not.toContain("gpt-6-luna");
    expect(Object.values(after.roles).map((role) => role.model)).not.toContain("gpt-6-luna");
    expect((await configOf(crew.codexExec)).model).toBe("gpt-6-luna-2");
    expect((await configOf(crew.codexReviewer)).model).toBe("gpt-6-luna-2");
    expect((await configOf(crew.codexPending)).model).toBe("gpt-6-luna");
    expect((await configOf(crew.codexTerminated)).model).toBe("gpt-6-luna");
    expect((await configOf(crew.foreignLuna)).model).toBe("gpt-6-luna");
    expect((await issueRow(open)).assigneeAdapterOverrides).toEqual(luna("gpt-6-luna-2"));
    expect((await issueRow(done)).assigneeAdapterOverrides).toEqual(luna("gpt-6-luna"));
    expect((await issueRow(foreign)).assigneeAdapterOverrides).toEqual(luna("gpt-6-luna"));
    const issueLogs = await db.select().from(activityLog)
      .where(and(eq(activityLog.entityId, open), eq(activityLog.action, "crew.model_settings.issue_override_model")));
    expect(issueLogs).toHaveLength(1);
    const agentLogs = await db.select().from(activityLog)
      .where(and(eq(activityLog.entityId, crew.codexReviewer), eq(activityLog.action, "crew.model_settings.agent_model")));
    expect(agentLogs.map((log) => (log.details as { cause: string }).cause).sort()).toEqual(["bulk_upgrade", "role_default"]);
  });

  it("nâng hàng loạt, Y đã có: gỡ X, đổi cả agent chỉnh tay", async () => {
    const res = await upgrade({ baseRevision: 4, runtime: "claude_local", fromModel: "claude-sonnet-5", toModel: "claude-sonnet-5-5" });
    expect(res.status).toBe(200);
    expect(res.body.changes).toMatchObject({ catalog: "merged", cells: [], roles: [], issues: [] });
    expect(res.body.changes.agents.map((a: { agentId: string }) => a.agentId)).toEqual([crew.exec2]);
    expect(res.body.settings.catalog.claude_local.models).not.toHaveProperty(["claude-sonnet-5"]);
    expect((await configOf(crew.exec2)).model).toBe("claude-sonnet-5-5");
  });

  it("nâng hàng loạt: model mới không đọc được ảnh mà đang dùng ở large thì 422; model cũ không có thì 422", async () => {
    const blind = await upgrade({
      baseRevision: 5, runtime: "claude_local", fromModel: "claude-opus-5-5", toModel: "claude-opus-x", vision: false,
    });
    expect(blind.status).toBe(422);
    expect(blind.body.issues.map((i: { path: string }) => i.path)).toEqual(["catalog.claude_local.byComplexity.large.model"]);
    const missing = await upgrade({ baseRevision: 5, runtime: "claude_local", fromModel: "gpt-6-sol", toModel: "claude-opus-x" });
    expect(missing.status).toBe(422);
    expect(missing.body.issues).toEqual([expect.objectContaining({ path: "fromModel" })]);
    expect((await upgrade({ baseRevision: 4, runtime: "claude_local", fromModel: "claude-opus-5-5", toModel: "x" })).status).toBe(409);
    expect(await countRevisions()).toBe(5);
  });

  it("nâng hàng loạt: một lỗi giữa chừng rollback toàn bộ", async () => {
    await db.insert(agents).values({
      id: crew.solAgent, companyId: crew.companyId, name: "n-sol", role: "engineer", status: "idle", adapterType: "codex_local",
      adapterConfig: { model: "gpt-6-sol", modelReasoningEffort: "high" }, permissions: {}, runtimeConfig: {},
    });
    const open = await issue({ status: "todo", assigneeAdapterOverrides: { adapterConfig: { model: "gpt-6-sol" } } });
    await db.execute(sql.raw(`CREATE FUNCTION crew_test_boom() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.assignee_adapter_overrides->'adapterConfig'->>'model' = 'boom-model' THEN RAISE EXCEPTION 'boom'; END IF;
        RETURN NEW;
      END $$`));
    await db.execute(sql.raw(`CREATE TRIGGER crew_test_boom BEFORE UPDATE ON issues FOR EACH ROW EXECUTE FUNCTION crew_test_boom()`));
    const revisionsBefore = (await db.select().from(agentConfigRevisions).where(eq(agentConfigRevisions.agentId, crew.solAgent))).length;
    try {
      const res = await upgrade({ baseRevision: 5, runtime: "codex_local", fromModel: "gpt-6-sol", toModel: "boom-model" });
      expect(res.status).toBe(500);
    } finally {
      await db.execute(sql.raw("DROP TRIGGER crew_test_boom ON issues"));
      await db.execute(sql.raw("DROP FUNCTION crew_test_boom()"));
    }
    expect(await countRevisions()).toBe(5);
    expect((await current()).revision).toBe(5);
    expect((await configOf(crew.solAgent)).model).toBe("gpt-6-sol");
    expect((await db.select().from(agentConfigRevisions).where(eq(agentConfigRevisions.agentId, crew.solAgent))).length).toBe(revisionsBefore);
    expect((await issueRow(open)).assigneeAdapterOverrides).toEqual({ adapterConfig: { model: "gpt-6-sol" } });
  });
});

import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activityLog, agentConfigRevisions, agents, approvals, companies, companyMemberships, createDb, principalPermissionGrants } from "@paperclipai/db";
import { agentRoutes } from "../routes/agents.js";
import { errorHandler } from "../middleware/error-handler.js";
import { CREW_POLICY_CONFIG_ENV } from "../crew/issue-policy.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

const protectedConfig = {
  command: "crew-claude-run",
  extraArgs: ["--plugin-dir", "/crew/pinned"],
  env: { CREW_TEST_VALUE: { type: "plain", value: "pinned" } },
  model: "claude-sonnet-5",
};
const attacks = [
  ["command", "/bin/sh"],
  ["extraArgs", []],
  ["env", {}],
  ["model", "claude-fable-5"],
] as const;

describe("agent config hook registration", () => {
  it("đặt đúng một hook chung trên agent router và đăng ký test", () => {
    const source = readFileSync(new URL("../routes/agents.ts", import.meta.url), "utf8");
    expect(source.match(/crewCoreHooks\.beforeAgentMutation\(/g)).toHaveLength(1);
    const registry = JSON.parse(readFileSync(new URL("../../../crew/release/core-hooks.json", import.meta.url), "utf8"));
    expect(registry.entries.filter((entry: { kind: string }) => entry.kind === "hook")).toHaveLength(5);
    expect(registry.entries.find((entry: { file: string }) => entry.file === "server/src/routes/agents.ts")).toMatchObject({
      kind: "hook",
      tests: expect.arrayContaining(["server/src/__tests__/crew-agent-config.test.ts"]),
    });
  });
});

describe("Crew agent config routes with PostgreSQL", () => {
  let db: ReturnType<typeof createDb>;
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  const dir = mkdtempSync(path.join(tmpdir(), "crew-agent-config-"));
  const configFile = path.join(dir, "crew-policy.json");
  const configured: Record<string, unknown> = {};
  const previousConfig = process.env[CREW_POLICY_CONFIG_ENV];
  const previousKeyFile = process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE;

  beforeAll(async () => {
    process.env[CREW_POLICY_CONFIG_ENV] = configFile;
    process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE = path.join(dir, "master.key");
    writeFileSync(configFile, JSON.stringify({ companies: configured }));
    temporary = await startEmbeddedPostgresTestDatabase("crew-agent-config-db-");
    db = createDb(temporary.connectionString);
  }, 60_000);

  afterAll(async () => {
    if (previousConfig === undefined) delete process.env[CREW_POLICY_CONFIG_ENV];
    else process.env[CREW_POLICY_CONFIG_ENV] = previousConfig;
    if (previousKeyFile === undefined) delete process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE;
    else process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE = previousKeyFile;
    await db?.$client.end({ timeout: 0 });
    await temporary?.cleanup();
    rmSync(dir, { recursive: true, force: true });
  });

  async function seed(config: "ok" | "invalid" | "absent" = "ok") {
    const companyId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Crew config", issuePrefix: `C${companyId.slice(0, 7)}`, requireBoardApprovalForNewAgents: false });
    const [actor, other] = await db.insert(agents).values(["Executor", "Peer"].map((name) => ({
      companyId, name, role: "engineer", status: "idle", adapterType: "process", adapterConfig: protectedConfig,
      permissions: { canCreateAgents: true }, runtimeConfig: { heartbeat: { enabled: false, wakeOnDemand: false } },
    }))).returning();
    await db.insert(companyMemberships).values({ companyId, principalType: "agent", principalId: actor!.id, status: "active", membershipRole: "member" });
    await db.insert(principalPermissionGrants).values({ companyId, principalType: "agent", principalId: actor!.id, permissionKey: "agents:configure" });
    if (config === "ok") configured[companyId] = { reviewerAgentId: randomUUID(), integratorAgentId: randomUUID(), ownerUserId: "owner-1" };
    if (config === "invalid") configured[companyId] = {};
    writeFileSync(configFile, JSON.stringify({ companies: configured }));
    return { companyId, actor: actor!, other: other! };
  }

  function app(c: Awaited<ReturnType<typeof seed>>, board = false) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.actor = board
        ? { type: "board", userId: "owner-1", source: "local_implicit" }
        : { type: "agent", agentId: c.actor.id, companyId: c.companyId, source: "agent_jwt" };
      next();
    });
    app.use("/api", agentRoutes(db));
    app.use(errorHandler);
    return app;
  }

  async function snapshot(companyId: string) {
    return {
      agents: await db.select().from(agents).where(eq(agents.companyId, companyId)).orderBy(agents.id),
      revisions: await db.select().from(agentConfigRevisions).where(eq(agentConfigRevisions.companyId, companyId)).orderBy(agentConfigRevisions.id),
      approvals: await db.select().from(approvals).where(eq(approvals.companyId, companyId)).orderBy(approvals.id),
      activity: await db.select().from(activityLog).where(eq(activityLog.companyId, companyId)).orderBy(activityLog.id),
    };
  }

  for (const target of ["actor", "other"] as const) {
    it.each(attacks)(`agent PATCH ${target} %s bị 422 và DB không đổi`, async (key, value) => {
      const c = await seed();
      const before = await snapshot(c.companyId);
      const response = await request(app(c)).patch(`/api/agents/${c[target].id}`).send({ adapterConfig: { [key]: value } });
      expect(response.status, JSON.stringify(response.body)).toBe(422);
      expect(response.body.details).toMatchObject({ code: "crew_agent_config_forbidden", keys: [`adapterConfig.${key}`] });
      expect(await snapshot(c.companyId)).toEqual(before);
    });
  }

  for (const route of ["agents", "agent-hires"]) {
    it.each(attacks)(`agent POST ${route} %s bị 422 và không tạo agent`, async (key, value) => {
      const c = await seed();
      const before = await snapshot(c.companyId);
      const response = await request(app(c)).post(`/api/companies/${c.companyId}/${route}`).send({ name: "New agent", role: "engineer", adapterType: "process", adapterConfig: { [key]: value } });
      expect(response.status, JSON.stringify(response.body)).toBe(422);
      expect(response.body.details).toMatchObject({ code: "crew_agent_create_forbidden" });
      expect(await snapshot(c.companyId)).toEqual(before);
    });

    it(`agent POST ${route} body không có key ghim (kể cả role ceo) vẫn bị 422 dù có canCreateAgents`, async () => {
      const c = await seed();
      const before = await snapshot(c.companyId);
      const response = await request(app(c)).post(`/api/companies/${c.companyId}/${route}`).send({ name: "Sneaky", role: "ceo", adapterType: "process", permissions: { canCreateAgents: true } });
      expect(response.status, JSON.stringify(response.body)).toBe(422);
      expect(response.body.details).toEqual({ code: "crew_agent_create_forbidden" });
      expect(await snapshot(c.companyId)).toEqual(before);
    });
  }

  it("agent chạy thử adapter (test-environment) với cấu hình tùy ý bị 422", async () => {
    const c = await seed();
    const before = await snapshot(c.companyId);
    const response = await request(app(c)).post(`/api/companies/${c.companyId}/adapters/process/test-environment`).send({ adapterConfig: { command: "/bin/sh" } });
    expect(response.status, JSON.stringify(response.body)).toBe(422);
    expect(response.body.details).toEqual({ code: "crew_agent_create_forbidden" });
    expect(await snapshot(c.companyId)).toEqual(before);
  });

  it.each([
    ["tự nâng role ceo kèm field khác", { role: "ceo", budgetMonthlyCents: 1 }],
    ["đổi reportsTo và bật heartbeat", { reportsTo: null, runtimeConfig: { heartbeat: { enabled: true } } }],
    ["đổi tên", { name: "Renamed executor" }],
    ["đổi key adapter không ghim", { adapterConfig: { effort: "high" } }],
  ])("agent PATCH chính mình (%s) bị 422 và DB không đổi", async (_label, patch) => {
    const c = await seed();
    const before = await snapshot(c.companyId);
    const response = await request(app(c)).patch(`/api/agents/${c.actor.id}`).send(patch);
    expect(response.status, JSON.stringify(response.body)).toBe(422);
    expect(response.body.details).toEqual({ code: "crew_agent_config_forbidden", keys: Object.keys(patch) });
    expect(await snapshot(c.companyId)).toEqual(before);
  });

  it("agent PATCH agent khác cùng company (có grant agents:configure) bị 422", async () => {
    const c = await seed();
    const before = await snapshot(c.companyId);
    const response = await request(app(c)).patch(`/api/agents/${c.other.id}`).send({ name: "Peer renamed" });
    expect(response.status, JSON.stringify(response.body)).toBe(422);
    expect(response.body.details.code).toBe("crew_agent_config_forbidden");
    expect(await snapshot(c.companyId)).toEqual(before);
  });

  it("agent đổi quyền hay resume agent khác đang bị pause bị 422 và DB không đổi", async () => {
    const c = await seed();
    await db.update(agents).set({ status: "paused" }).where(eq(agents.id, c.other.id));
    const before = await snapshot(c.companyId);
    const permissions = await request(app(c)).patch(`/api/agents/${c.other.id}/permissions`).send({ canCreateAgents: true, canAssignTasks: true });
    expect(permissions.status, JSON.stringify(permissions.body)).toBe(422);
    expect(permissions.body.details).toEqual({ code: "crew_agent_config_forbidden", keys: ["permissions"] });
    const resume = await request(app(c)).post(`/api/agents/${c.other.id}/resume`);
    expect(resume.status, JSON.stringify(resume.body)).toBe(422);
    expect(resume.body.details).toEqual({ code: "crew_agent_config_forbidden", keys: ["resume"] });
    expect(await snapshot(c.companyId)).toEqual(before);
  });

  it.each([
    ["POST", "skills/sync", { desiredSkills: [] }],
    ["PUT", "instructions-bundle/file", { path: "AGENTS.md", content: "x" }],
    ["PATCH", "instructions-bundle", { mode: "managed" }],
    ["DELETE", "instructions-bundle/file?path=AGENTS.md", undefined],
    ["POST", "instructions-bundle/restore", { revisionId: "00000000-0000-4000-8000-000000000000" }],
    ["POST", "instructions-bundle/candidates/00000000-0000-4000-8000-000000000000/resolve", { action: "accept" }],
    ["PATCH", "instructions-path", { path: "AGENTS.md" }],
    ["PATCH", "permissions", { canCreateAgents: true, canAssignTasks: true }],
    ["POST", "resume", undefined],
  ] as const)("agent %s /agents/<self>/%s bị 422 và DB không đổi", async (method, suffix, body) => {
    const c = await seed();
    const before = await snapshot(c.companyId);
    const agent = request(app(c));
    const url = `/api/agents/${c.actor.id}/${suffix}`;
    const call = method === "POST" ? agent.post(url) : method === "PUT" ? agent.put(url) : method === "PATCH" ? agent.patch(url) : agent.delete(url);
    const response = await (body === undefined ? call : call.send(body));
    expect(response.status, JSON.stringify(response.body)).toBe(422);
    expect(response.body.details.code).toBe("crew_agent_config_forbidden");
    expect(await snapshot(c.companyId)).toEqual(before);
  });

  it("agent đọc skill và bundle của chính mình vẫn được (GET không bị chặn)", async () => {
    const c = await seed();
    const response = await request(app(c)).get(`/api/agents/${c.actor.id}/skills`);
    expect(response.status, JSON.stringify(response.body)).not.toBe(422);
  });

  it("cấu hình Crew invalid vẫn chặn", async () => {
    const c = await seed("invalid");
    const before = await snapshot(c.companyId);
    const response = await request(app(c)).patch(`/api/agents/${c.actor.id}`).send({ adapterConfig: { extraArgs: [] } });
    expect(response.status, JSON.stringify(response.body)).toBe(422);
    expect(response.body.details.code).toBe("crew_agent_config_forbidden");
    expect(await snapshot(c.companyId)).toEqual(before);
  });

  it("self-update không grant vẫn bị chặn và trả đủ tên key, không trả giá trị", async () => {
    const c = await seed();
    await db.delete(principalPermissionGrants).where(eq(principalPermissionGrants.companyId, c.companyId));
    const before = await snapshot(c.companyId);
    const response = await request(app(c)).patch(`/api/agents/${c.actor.id}`).send({ adapterConfig: { command: "/private/payload", extraArgs: [], env: { SENSITIVE_VALUE: "not-for-error" }, model: "outside-list" } });
    expect(response.status, JSON.stringify(response.body)).toBe(422);
    expect(response.body.details).toEqual({ code: "crew_agent_config_forbidden", keys: ["adapterConfig.command", "adapterConfig.extraArgs", "adapterConfig.env", "adapterConfig.model"] });
    expect(JSON.stringify(response.body)).not.toMatch(/private\/payload|not-for-error|outside-list/);
    expect(await snapshot(c.companyId)).toEqual(before);
  });

  it.each(["board", "absent"])("%s vẫn đổi name như stock", async (mode) => {
    const c = await seed(mode === "absent" ? "absent" : "ok");
    const response = await request(app(c, mode === "board")).patch(`/api/agents/${c.actor.id}`).send({ name: "Renamed executor" });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const [row] = await db.select().from(agents).where(eq(agents.id, c.actor.id));
    expect(row!.name).toBe("Renamed executor");
    expect(row!.adapterConfig).toEqual(protectedConfig);
  });

  it.each(["board", "absent"])("%s vẫn PATCH bốn key như stock", async (mode) => {
    const c = await seed(mode === "absent" ? "absent" : "ok");
    const config = { command: "/bin/sh", extraArgs: [], env: {}, model: "other-model" };
    const response = await request(app(c, mode === "board")).patch(`/api/agents/${c.actor.id}`).send({ adapterConfig: config });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const [row] = await db.select().from(agents).where(eq(agents.id, c.actor.id));
    expect(row!.adapterConfig).toMatchObject(config);
  });

  it.each(attacks)("agent rollback %s bị 422 và DB không đổi", async (key, value) => {
    const c = await seed();
    const [revision] = await db.insert(agentConfigRevisions).values({ companyId: c.companyId, agentId: c.actor.id, beforeConfig: {}, afterConfig: { ...c.actor, adapterConfig: { ...protectedConfig, [key]: value } } }).returning();
    const before = await snapshot(c.companyId);
    const response = await request(app(c)).post(`/api/agents/${c.actor.id}/config-revisions/${revision!.id}/rollback`).send({});
    expect(response.status, JSON.stringify(response.body)).toBe(422);
    expect(response.body.details.code).toBe("crew_agent_config_forbidden");
    expect(response.body.details.keys).toContain(`adapterConfig.${key}`);
    expect(await snapshot(c.companyId)).toEqual(before);
  });

  it.each([
    [{ adapterConfig: {}, replaceAdapterConfig: true }, "replaceAdapterConfig"],
    [{ adapterType: "http" }, "adapterType"],
  ])("agent không thể xóa ghim bằng thay toàn bộ cấu hình hoặc adapter", async (patch, key) => {
    const c = await seed();
    const before = await snapshot(c.companyId);
    const response = await request(app(c)).patch(`/api/agents/${c.actor.id}`).send(patch);
    expect(response.status, JSON.stringify(response.body)).toBe(422);
    expect(response.body.details).toMatchObject({ code: "crew_agent_config_forbidden", keys: expect.arrayContaining([key]) });
    expect(await snapshot(c.companyId)).toEqual(before);
  });

  it("rollback snapshot thiếu key vẫn bị chặn", async () => {
    const c = await seed();
    const [revision] = await db.insert(agentConfigRevisions).values({ companyId: c.companyId, agentId: c.actor.id, beforeConfig: {}, afterConfig: { ...c.actor, adapterConfig: {} } }).returning();
    const before = await snapshot(c.companyId);
    const response = await request(app(c)).post(`/api/agents/${c.actor.id}/config-revisions/${revision!.id}/rollback`).send({});
    expect(response.status, JSON.stringify(response.body)).toBe(422);
    expect(response.body.details.code).toBe("crew_agent_config_forbidden");
    expect(await snapshot(c.companyId)).toEqual(before);
  });

  it.each(["board", "absent"])("%s vẫn rollback snapshot qua stock", async (mode) => {
    const c = await seed(mode === "absent" ? "absent" : "ok");
    const [revision] = await db.insert(agentConfigRevisions).values({ companyId: c.companyId, agentId: c.actor.id, beforeConfig: {}, afterConfig: { ...c.actor, adapterConfig: { model: "old-model" } } }).returning();
    const response = await request(app(c, mode === "board")).post(`/api/agents/${c.actor.id}/config-revisions/${revision!.id}/rollback`).send({});
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const [row] = await db.select().from(agents).where(eq(agents.id, c.actor.id));
    expect(row!.adapterConfig).toEqual({ model: "old-model" });
  });

  for (const route of ["agents", "agent-hires"]) {
    it.each(["board", "absent"])(`%s vẫn tạo agent qua ${route}`, async (mode) => {
      const c = await seed(mode === "absent" ? "absent" : "ok");
      const response = await request(app(c, mode === "board")).post(`/api/companies/${c.companyId}/${route}`).send({ name: "New agent", role: "engineer", adapterType: "process", adapterConfig: { command: "/bin/sh" } });
      expect(response.status, JSON.stringify(response.body)).toBe(201);
      const id = route === "agents" ? response.body.id : response.body.agent.id;
      const [row] = await db.select().from(agents).where(eq(agents.id, id));
      expect(row!.adapterConfig.command).toBe("/bin/sh");
    });
  }

  it("agent company ngoài cấu hình vẫn tự đổi effort như stock", async () => {
    const c = await seed("absent");
    const response = await request(app(c)).patch(`/api/agents/${c.actor.id}`).send({ adapterConfig: { effort: "high" } });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const [row] = await db.select().from(agents).where(eq(agents.id, c.actor.id));
    expect(row!.adapterConfig).toEqual({ ...protectedConfig, effort: "high" });
  });

  it.each(["alias", "encoded", "uppercase"])("không vượt guard bằng URL %s", async (mode) => {
    const c = await seed();
    const before = await snapshot(c.companyId);
    const id = mode === "alias" ? "executor" : mode === "encoded" ? `%${c.actor.id.charCodeAt(0).toString(16)}${c.actor.id.slice(1)}` : c.actor.id;
    const url = mode === "uppercase" ? `/api/AGENTS/${id}/` : `/api/agents/${id}`;
    const response = await request(app(c)).patch(url).send({ adapterConfig: { command: "/bin/sh" } });
    expect(response.status, JSON.stringify(response.body)).toBe(422);
    expect(response.body.details.code).toBe("crew_agent_config_forbidden");
    expect(await snapshot(c.companyId)).toEqual(before);
  });

  it("key agent không nhìn thấy agent company khác qua guard", async () => {
    const c = await seed();
    const other = await seed();
    const before = await snapshot(other.companyId);
    const response = await request(app(c)).patch(`/api/agents/${other.actor.id}`).send({ adapterConfig: { command: "/bin/sh" } });
    expect(response.status, JSON.stringify(response.body)).toBe(404);
    expect(await snapshot(other.companyId)).toEqual(before);
  });
});

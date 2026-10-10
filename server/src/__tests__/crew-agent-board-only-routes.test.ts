import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  companies,
  createDb,
  executionWorkspaces,
  goals,
  heartbeatRuns,
  issues,
  projects,
  projectWorkspaces,
} from "@paperclipai/db";
import { errorHandler } from "../middleware/error-handler.js";
import { CREW_POLICY_CONFIG_ENV } from "../crew/issue-policy.js";
import { executionWorkspaceRoutes } from "../routes/execution-workspaces.js";
import { issueRoutes } from "../routes/issues.js";
import { onboardingSeedRoutes } from "../routes/onboarding-seed.js";
import { projectRoutes } from "../routes/projects.js";
import { callProjectTool } from "../services/project-tools.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

const SEED = {
  revision: "b".repeat(32),
  mission: "Agent-written mission",
  agent: { name: "Shadow CEO", role: "Chief of Staff" },
  firstTask: { title: "Agent-written root task", details: "seeded by an agent" },
};

describe("Crew: agent writes reserved for the board", () => {
  let db: ReturnType<typeof createDb>;
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  const dir = mkdtempSync(path.join(tmpdir(), "crew-board-only-"));
  const configFile = path.join(dir, "crew-policy.json");
  const configured: Record<string, unknown> = {};
  const previousConfig = process.env[CREW_POLICY_CONFIG_ENV];

  beforeAll(async () => {
    process.env[CREW_POLICY_CONFIG_ENV] = configFile;
    writeFileSync(configFile, JSON.stringify({ companies: configured }));
    temporary = await startEmbeddedPostgresTestDatabase("crew-board-only-db-");
    db = createDb(temporary.connectionString);
  }, 60_000);

  afterAll(async () => {
    if (previousConfig === undefined) delete process.env[CREW_POLICY_CONFIG_ENV];
    else process.env[CREW_POLICY_CONFIG_ENV] = previousConfig;
    await db?.$client.end({ timeout: 0 });
    await temporary?.cleanup();
    rmSync(dir, { recursive: true, force: true });
  });

  async function seed(config: "ok" | "absent" = "ok") {
    const companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId, name: "Crew board only", issuePrefix: `B${companyId.replaceAll("-", "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    const [actor, peer] = await db.insert(agents).values(["Executor", "Peer"].map((name) => ({
      companyId, name, role: "engineer", status: "idle", adapterType: "process", adapterConfig: {},
      permissions: {}, runtimeConfig: { heartbeat: { enabled: false, wakeOnDemand: false } },
    }))).returning();
    const [project] = await db.insert(projects).values({ companyId, name: "Crew project" }).returning();
    // Run gắn task: đường tạo project của agent (REST và MCP) đòi run có task.
    const [runTask] = await db.insert(issues).values({
      companyId, projectId: project!.id, title: "Run task", status: "in_progress", priority: "medium", assigneeAgentId: actor!.id,
    }).returning();
    const [run] = await db.insert(heartbeatRuns).values({
      companyId, agentId: actor!.id, status: "running", invocationSource: "manual", startedAt: new Date(),
      contextSnapshot: { issueId: runTask!.id },
    }).returning();
    const [projectWorkspace] = await db.insert(projectWorkspaces).values({
      companyId, projectId: project!.id, name: "main", cwd: "/srv/crew/main", isPrimary: true,
    }).returning();
    const [executionWorkspace] = await db.insert(executionWorkspaces).values({
      companyId, projectId: project!.id, projectWorkspaceId: projectWorkspace!.id, mode: "shared_workspace",
      strategyType: "project_primary", name: "peer workspace", cwd: "/srv/crew/main",
    }).returning();
    if (config === "ok") {
      configured[companyId] = { reviewerAgentId: randomUUID(), integratorAgentId: randomUUID(), ownerUserId: "owner-1" };
      writeFileSync(configFile, JSON.stringify({ companies: configured }));
    }
    return { companyId, actor: actor!, peer: peer!, runId: run!.id, runTaskId: runTask!.id, project: project!, projectWorkspace: projectWorkspace!, executionWorkspace: executionWorkspace! };
  }
  type Seeded = Awaited<ReturnType<typeof seed>>;

  function app(c: Seeded, board = false) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.actor = board
        ? { type: "board", userId: "owner-1", source: "local_implicit" }
        : { type: "agent", agentId: c.actor.id, companyId: c.companyId, runId: c.runId, source: "agent_jwt" };
      next();
    });
    app.use("/api", onboardingSeedRoutes(db));
    app.use("/api", projectRoutes(db));
    app.use("/api", issueRoutes(db, {} as never));
    app.use("/api", executionWorkspaceRoutes(db));
    app.use(errorHandler);
    return app;
  }

  async function issue(c: Seeded, values: Partial<typeof issues.$inferInsert>) {
    const [row] = await db.insert(issues).values({
      companyId: c.companyId, projectId: c.project.id, title: "Crew issue", status: "todo", priority: "medium", ...values,
    }).returning();
    return row!;
  }

  async function projectState(c: Seeded) {
    return {
      projects: await db.select().from(projects).where(eq(projects.companyId, c.companyId)).orderBy(projects.id),
      workspaces: await db.select().from(projectWorkspaces).where(eq(projectWorkspaces.companyId, c.companyId)).orderBy(projectWorkspaces.id),
    };
  }

  function expectBoardOnly(response: request.Response) {
    expect(response.status, JSON.stringify(response.body)).toBe(403);
    expect(response.body.details).toMatchObject({ code: "crew_board_only" });
  }

  describe("onboarding seed", () => {
    it.each(["ok", "absent"] as const)("agent không gieo được onboarding (cấu hình Crew: %s), không tạo agent hay goal", async (config) => {
      const c = await seed(config);
      const response = await request(app(c)).post(`/api/companies/${c.companyId}/onboarding-seed`).send(SEED);
      expect(response.status, JSON.stringify(response.body)).toBe(403);
      expect(await db.select().from(agents).where(eq(agents.companyId, c.companyId))).toHaveLength(2);
      expect(await db.select().from(goals).where(eq(goals.companyId, c.companyId))).toHaveLength(0);
    });

    it("board vẫn gieo onboarding được", async () => {
      const c = await seed();
      const response = await request(app(c, true)).post(`/api/companies/${c.companyId}/onboarding-seed`).send(SEED);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(response.body.applied).toBe(true);
    });
  });

  describe("project và workspace của project", () => {
    const writes: [string, (c: Seeded) => [method: "post" | "patch" | "delete", url: string, body?: object]][] = [
      ["tạo project", (c) => ["post", `/api/companies/${c.companyId}/projects`, { name: "Agent project" }]],
      ["sửa project", (c) => ["patch", `/api/projects/${c.project.id}`, { name: "Renamed by agent" }]],
      ["archive project", (c) => ["patch", `/api/projects/${c.project.id}`, { archivedAt: new Date().toISOString() }]],
      ["xóa project", (c) => ["delete", `/api/projects/${c.project.id}`]],
      ["tạo workspace", (c) => ["post", `/api/projects/${c.project.id}/workspaces`, { name: "agent ws", cwd: "/tmp/agent" }]],
      ["sửa workspace", (c) => ["patch", `/api/projects/${c.project.id}/workspaces/${c.projectWorkspace.id}`, { cwd: "/tmp/agent" }]],
      ["xóa workspace", (c) => ["delete", `/api/projects/${c.project.id}/workspaces/${c.projectWorkspace.id}`]],
    ];

    it.each(writes)("agent Crew không %s được, DB không đổi", async (_name, build) => {
      const c = await seed();
      const before = await projectState(c);
      const [method, url, body] = build(c);
      const response = await request(app(c))[method](url).send(body ?? {});
      expectBoardOnly(response);
      expect(await projectState(c)).toEqual(before);
    });

    it("MCP create_project của agent Crew bị từ chối, không tạo project", async () => {
      const c = await seed();
      const before = await projectState(c);
      const server = app(c).listen(0);
      try {
        const { port } = server.address() as AddressInfo;
        await expect(callProjectTool({
          name: "create_project", arguments: { name: "MCP project", idempotencyKey: "k1" },
          apiUrl: `http://127.0.0.1:${port}`, token: "agent-token",
          companyId: c.companyId, issueId: c.runTaskId, agentId: c.actor.id, conversation: false,
        })).rejects.toThrow(/Crew/);
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
      expect(await projectState(c)).toEqual(before);
    });

    it("board vẫn tạo và sửa project được", async () => {
      const c = await seed();
      const created = await request(app(c, true)).post(`/api/companies/${c.companyId}/projects`).send({ name: "Board project" });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const renamed = await request(app(c, true)).patch(`/api/projects/${c.project.id}`).send({ name: "Board renamed" });
      expect(renamed.status, JSON.stringify(renamed.body)).toBe(200);
    });

    it("company ngoài cấu hình Crew giữ hành vi gốc: agent tạo project được", async () => {
      const c = await seed("absent");
      const response = await request(app(c)).post(`/api/companies/${c.companyId}/projects`).send({ name: "Stock project" });
      expect(response.status, JSON.stringify(response.body)).toBe(201);
    });
  });

  describe("xóa issue", () => {
    it("agent Crew không xóa được issue, kể cả issue giao chính mình", async () => {
      const c = await seed();
      const own = await issue(c, { assigneeAgentId: c.actor.id });
      const response = await request(app(c)).delete(`/api/issues/${own.id}`);
      expectBoardOnly(response);
      expect(await db.select().from(issues).where(eq(issues.id, own.id))).toHaveLength(1);
    });

    it("board vẫn xóa được issue", async () => {
      const c = await seed();
      const row = await issue(c, {});
      const response = await request(app(c, true)).delete(`/api/issues/${row.id}`);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(await db.select().from(issues).where(eq(issues.id, row.id))).toHaveLength(0);
    });
  });

  describe("checkout issue", () => {
    function checkout(c: Seeded, issueId: string, expectedStatuses: string[], board = false) {
      return request(app(c, board)).post(`/api/issues/${issueId}/checkout`).send({ agentId: c.actor.id, expectedStatuses });
    }

    it("agent không giành issue đang chờ owner", async () => {
      const c = await seed();
      const waiting = await issue(c, { status: "in_review", assigneeUserId: "owner-1" });
      const response = await checkout(c, waiting.id, ["in_review"]);
      expect(response.status, JSON.stringify(response.body)).toBe(409);
      expect(response.body.details).toMatchObject({ code: "crew_checkout_forbidden" });
      const [after] = await db.select().from(issues).where(eq(issues.id, waiting.id));
      expect(after).toMatchObject({ status: "in_review", assigneeUserId: "owner-1", assigneeAgentId: null });
    });

    it("agent không giành issue đang giao agent khác", async () => {
      const c = await seed();
      const peers = await issue(c, { assigneeAgentId: c.peer.id });
      const response = await checkout(c, peers.id, ["todo"]);
      expect(response.status, JSON.stringify(response.body)).toBe(409);
      expect(response.body.details).toMatchObject({ code: "crew_checkout_forbidden" });
      const [after] = await db.select().from(issues).where(eq(issues.id, peers.id));
      expect(after).toMatchObject({ status: "todo", assigneeAgentId: c.peer.id });
    });

    it("executor checkout issue giao chính mình", async () => {
      const c = await seed();
      const own = await issue(c, { assigneeAgentId: c.actor.id });
      const response = await checkout(c, own.id, ["todo"]);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(response.body).toMatchObject({ status: "in_progress", assigneeAgentId: c.actor.id });
    });

    it("agent tự nhận issue chưa giao ai", async () => {
      const c = await seed();
      const open = await issue(c, {});
      const response = await checkout(c, open.id, ["todo"]);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(response.body).toMatchObject({ status: "in_progress", assigneeAgentId: c.actor.id });
    });

    it("board vẫn checkout hộ agent issue đang giao owner", async () => {
      const c = await seed();
      const waiting = await issue(c, { status: "todo", assigneeUserId: "owner-1" });
      const response = await checkout(c, waiting.id, ["todo"], true);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(response.body).toMatchObject({ assigneeAgentId: c.actor.id, assigneeUserId: null });
    });
  });

  describe("execution workspace", () => {
    it("agent Crew không sửa được execution workspace", async () => {
      const c = await seed();
      const response = await request(app(c)).patch(`/api/execution-workspaces/${c.executionWorkspace.id}`).send({ cwd: "/tmp/elsewhere" });
      expectBoardOnly(response);
      const [after] = await db.select().from(executionWorkspaces).where(eq(executionWorkspaces.id, c.executionWorkspace.id));
      expect(after!.cwd).toBe("/srv/crew/main");
    });

    it("board vẫn sửa được execution workspace", async () => {
      const c = await seed();
      const response = await request(app(c, true)).patch(`/api/execution-workspaces/${c.executionWorkspace.id}`).send({ name: "renamed" });
      expect(response.status, JSON.stringify(response.body)).toBe(200);
    });
  });
});

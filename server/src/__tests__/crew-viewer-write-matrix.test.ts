import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  agents,
  companies,
  companyMemberships,
  createDb,
  issueComments,
  issues,
  projects,
} from "@paperclipai/db";
import manifest from "../../../packages/crew-plugin/src/manifest.ts";
import { CREW_POLICY_CONFIG_ENV } from "../crew/issue-policy.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

const CREW_PLUGIN_ID = "11111111-1111-4111-8111-111111111111";
const crewPlugin = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));

vi.mock("../services/plugin-registry.js", () => ({
  pluginRegistryService: () => ({
    getById: vi.fn(async (id: string) => (crewPlugin.current?.id === id ? crewPlugin.current : null)),
    getByKey: vi.fn(async (key: string) => (crewPlugin.current?.pluginKey === key ? crewPlugin.current : null)),
  }),
}));

/**
 * Viewer (kể cả khách góp ý của Crew) chỉ đọc: mọi route ghi lõi và route plugin có scope trả 403 stock. Bộ test khóa
 * hành vi này để rebase upstream hay vá Crew (đọc data plugin cho viewer) không mở lỗ ghi.
 */
describe("Crew: viewer bị chặn ở mọi route ghi", () => {
  let db: ReturnType<typeof createDb>;
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  const dir = mkdtempSync(path.join(tmpdir(), "crew-viewer-write-matrix-"));
  const configFile = path.join(dir, "crew-policy.json");
  const previousConfig = process.env[CREW_POLICY_CONFIG_ENV];
  const call = vi.fn();

  let companyId: string;
  let issueId: string;
  let agentId: string;
  const viewerId = `user-${randomUUID()}`;
  const operatorId = `user-${randomUUID()}`;

  beforeAll(async () => {
    temporary = await startEmbeddedPostgresTestDatabase("crew-viewer-write-matrix-db-");
    db = createDb(temporary.connectionString);
    companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Crew viewer matrix",
      issuePrefix: `W${companyId.replaceAll("-", "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    process.env[CREW_POLICY_CONFIG_ENV] = configFile;
    writeFileSync(configFile, JSON.stringify({
      companies: { [companyId]: { reviewerAgentId: randomUUID(), integratorAgentId: randomUUID(), ownerUserId: "owner-1" } },
    }));
    const [agent] = await db.insert(agents).values({
      companyId, name: "Executor", role: "engineer", status: "idle", adapterType: "process", adapterConfig: {},
      permissions: {}, runtimeConfig: { heartbeat: { enabled: false, wakeOnDemand: false } },
    }).returning();
    agentId = agent!.id;
    const [project] = await db.insert(projects).values({ companyId, name: "Crew project" }).returning();
    const [issue] = await db.insert(issues).values({
      companyId, projectId: project!.id, title: "Viewer matrix issue", status: "todo", priority: "medium",
    }).returning();
    issueId = issue!.id;
    await db.insert(companyMemberships).values([
      { companyId, principalType: "user", principalId: viewerId, status: "active", membershipRole: "viewer" },
      { companyId, principalType: "user", principalId: operatorId, status: "active", membershipRole: "operator" },
    ]);
    crewPlugin.current = {
      id: CREW_PLUGIN_ID, pluginKey: "crew.core", version: manifest.version, status: "ready", manifestJson: manifest,
    };
  }, 60_000);

  afterAll(async () => {
    if (previousConfig === undefined) delete process.env[CREW_POLICY_CONFIG_ENV];
    else process.env[CREW_POLICY_CONFIG_ENV] = previousConfig;
    await db?.$client.end({ timeout: 0 });
    await temporary?.cleanup();
    rmSync(dir, { recursive: true, force: true });
  });

  function board(userId: string, role: "viewer" | "operator") {
    return {
      type: "board",
      userId,
      source: "session",
      isInstanceAdmin: false,
      companyIds: [companyId],
      memberships: [{ companyId, membershipRole: role, status: "active" }],
    };
  }

  async function app(actor: Record<string, unknown>) {
    const [{ issueRoutes }, { pluginRoutes }, { errorHandler }] = await Promise.all([
      import("../routes/issues.js"),
      import("../routes/plugins.js"),
      import("../middleware/index.js"),
    ]);
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.actor = actor as typeof req.actor;
      next();
    });
    app.use("/api", issueRoutes(db, {} as never));
    app.use("/api", pluginRoutes(db, { installPlugin: vi.fn() } as never, undefined, undefined, undefined, {
      workerManager: { call, isRunning: () => true },
    } as never));
    app.use(errorHandler);
    return app;
  }

  function writes(): Array<[name: string, send: (server: express.Express) => request.Test]> {
    return [
      ["POST /companies/:cid/issues", (s) => request(s).post(`/api/companies/${companyId}/issues`).send({ title: "Viewer issue" })],
      ["POST /issues/:id/comments", (s) => request(s).post(`/api/issues/${issueId}/comments`).send({ body: "Viewer comment" })],
      ["PATCH /issues/:id", (s) => request(s).patch(`/api/issues/${issueId}`).send({ title: "Viewer patch" })],
      ["PUT /issues/:id/title", (s) => request(s).put(`/api/issues/${issueId}/title`).send({ title: "Viewer title" })],
      ["POST /issues/:id/checkout", (s) => request(s).post(`/api/issues/${issueId}/checkout`).send({ agentId, expectedStatuses: ["todo"] })],
      ["DELETE /issues/:id", (s) => request(s).delete(`/api/issues/${issueId}`)],
      ["POST /issues/:id/children", (s) => request(s).post(`/api/issues/${issueId}/children`).send({ title: "Viewer child" })],
      ["POST /companies/:cid/issues/:id/attachments", (s) => request(s)
        .post(`/api/companies/${companyId}/issues/${issueId}/attachments`)
        .attach("file", Buffer.from("viewer"), { filename: "viewer.txt", contentType: "text/plain" })],
      ["POST /issues/:id/interactions", (s) => request(s).post(`/api/issues/${issueId}/interactions`).send({
        kind: "request_confirmation", payload: { version: 1, prompt: "Viewer confirmation" },
      })],
      ["POST /issues/:id/read", (s) => request(s).post(`/api/issues/${issueId}/read`)],
      ["POST /plugins/crew.core/api/issues/:id/force-done", (s) => request(s)
        .post(`/api/plugins/crew.core/api/issues/${issueId}/force-done`).send({ companyId })],
    ];
  }

  it("viewer nhận 403 Viewer access is read-only ở 11 route ghi, dữ liệu không đổi", async () => {
    const server = await app(board(viewerId, "viewer"));
    const routes = writes();
    expect(routes).toHaveLength(11);

    for (const [name, send] of routes) {
      const res = await send(server);
      expect(res.status, name).toBe(403);
      expect(res.body.error, name).toBe("Viewer access is read-only");
    }

    expect(call).not.toHaveBeenCalled();
    const [issue] = await db.select().from(issues).where(eq(issues.id, issueId));
    expect(issue).toMatchObject({ title: "Viewer matrix issue", status: "todo", parentId: null });
    expect(await db.select().from(issues).where(eq(issues.companyId, companyId))).toHaveLength(1);
    expect(await db.select().from(issueComments).where(eq(issueComments.issueId, issueId))).toHaveLength(0);
  }, 120_000);

  it("operator bình luận được qua cùng route, nên 403 ở trên đến từ role viewer", async () => {
    const res = await request(await app(board(operatorId, "operator")))
      .post(`/api/issues/${issueId}/comments`)
      .send({ body: "Operator comment" });

    expect(res.status).not.toBe(403);
    expect(res.status).toBe(201);
    expect(await db.select().from(issueComments).where(eq(issueComments.issueId, issueId))).toHaveLength(1);
    // Route bình luận chạy khối đánh thức best-effort sau khi trả 201; chờ nó đọc DB xong trước khi đóng Postgres.
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }, 60_000);
});

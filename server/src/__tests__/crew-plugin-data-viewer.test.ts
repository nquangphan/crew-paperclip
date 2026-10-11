import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { companies, companyMemberships, createDb } from "@paperclipai/db";
import { CREW_POLICY_CONFIG_ENV } from "../crew/issue-policy.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

const mockRegistry = vi.hoisted(() => ({
  getById: vi.fn(),
  getByKey: vi.fn(),
}));

vi.mock("../services/plugin-registry.js", () => ({
  pluginRegistryService: () => mockRegistry,
}));

vi.mock("../services/activity-log.js", () => ({
  logActivity: vi.fn(),
}));

vi.mock("../services/live-events.js", () => ({
  publishGlobalLiveEvent: vi.fn(),
}));

const CREW_PLUGIN_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_PLUGIN_ID = "22222222-2222-4222-8222-222222222222";
const PLUGINS: Record<string, { id: string; pluginKey: string; version: string; status: string }> = {
  "crew.core": { id: CREW_PLUGIN_ID, pluginKey: "crew.core", version: "1.0.0", status: "ready" },
  "paperclip.example": { id: OTHER_PLUGIN_ID, pluginKey: "paperclip.example", version: "1.0.0", status: "ready" },
};

type MembershipRole = "owner" | "admin" | "operator" | "viewer";

describe("Crew: viewer đọc data plugin crew.core", () => {
  let db: ReturnType<typeof createDb>;
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  const dir = mkdtempSync(path.join(tmpdir(), "crew-plugin-data-viewer-"));
  const configFile = path.join(dir, "crew-policy.json");
  const configured: Record<string, unknown> = {};
  const previousConfig = process.env[CREW_POLICY_CONFIG_ENV];
  const call = vi.fn();

  beforeAll(async () => {
    process.env[CREW_POLICY_CONFIG_ENV] = configFile;
    writeFileSync(configFile, JSON.stringify({ companies: configured }));
    temporary = await startEmbeddedPostgresTestDatabase("crew-plugin-data-viewer-db-");
    db = createDb(temporary.connectionString);
  }, 60_000);

  afterAll(async () => {
    if (previousConfig === undefined) delete process.env[CREW_POLICY_CONFIG_ENV];
    else process.env[CREW_POLICY_CONFIG_ENV] = previousConfig;
    await db?.$client.end({ timeout: 0 });
    await temporary?.cleanup();
    rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockRegistry.getByKey.mockImplementation(async (key: string) => PLUGINS[key] ?? null);
    mockRegistry.getById.mockImplementation(
      async (id: string) => Object.values(PLUGINS).find((plugin) => plugin.id === id) ?? null,
    );
    call.mockResolvedValue({ companies: [] });
  });

  async function company(crew: boolean) {
    const companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: crew ? "Crew company" : "Stock company",
      issuePrefix: `V${companyId.replaceAll("-", "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    if (crew) {
      configured[companyId] = { reviewerAgentId: randomUUID(), integratorAgentId: randomUUID(), ownerUserId: "owner-1" };
      writeFileSync(configFile, JSON.stringify({ companies: configured }));
    }
    return companyId;
  }

  async function member(companyId: string, role: MembershipRole, status = "active") {
    const userId = `user-${randomUUID()}`;
    await db.insert(companyMemberships).values({
      companyId,
      principalType: "user",
      principalId: userId,
      status,
      membershipRole: role,
    });
    return userId;
  }

  /** Actor phiên board như middleware dựng: danh sách company và membership lấy lúc đăng nhập. */
  function board(userId: string, companyId: string, role: MembershipRole) {
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
    const [{ pluginRoutes }, { errorHandler }] = await Promise.all([
      import("../routes/plugins.js"),
      import("../middleware/index.js"),
    ]);
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.actor = actor as typeof req.actor;
      next();
    });
    app.use("/api", pluginRoutes(db, { installPlugin: vi.fn() } as never, undefined, undefined, undefined, {
      workerManager: { call },
    } as never));
    app.use(errorHandler);
    return app;
  }

  function readData(server: express.Express, companyId: unknown, plugin = "crew.core") {
    return request(server)
      .post(`/api/plugins/${plugin}/data/crew.companies`)
      .send({ companyId, params: {} });
  }

  it("viewer của company Crew đọc được crew.companies, worker nhận đúng company", async () => {
    const companyId = await company(true);
    const userId = await member(companyId, "viewer");

    const res = await readData(await app(board(userId, companyId, "viewer")), companyId);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { companies: [] } });
    expect(call).toHaveBeenCalledWith(CREW_PLUGIN_ID, "getData", {
      key: "crew.companies",
      companyId,
      params: {},
      renderEnvironment: null,
    });
  }, 60_000);

  it("viewer gọi data của plugin khác vẫn nhận 403 stock", async () => {
    const companyId = await company(true);
    const userId = await member(companyId, "viewer");

    const res = await readData(await app(board(userId, companyId, "viewer")), companyId, "paperclip.example");

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Viewer access is read-only");
    expect(call).not.toHaveBeenCalled();
  });

  it("viewer của company không có trong cấu hình Crew nhận 403", async () => {
    const companyId = await company(false);
    const userId = await member(companyId, "viewer");

    const res = await readData(await app(board(userId, companyId, "viewer")), companyId);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Viewer access is read-only");
    expect(call).not.toHaveBeenCalled();
  });

  it("viewer đọc data của company Crew khác nhận 403", async () => {
    const own = await company(true);
    const other = await company(true);
    const userId = await member(own, "viewer");
    await member(other, "viewer");

    const res = await readData(await app(board(userId, own, "viewer")), other);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("User does not have access to this company");
    expect(call).not.toHaveBeenCalled();
  });

  it("phiên ghi viewer nhưng DB không còn membership viewer active thì nhận 403", async () => {
    const companyId = await company(true);
    const promoted = await member(companyId, "operator");
    const suspended = await member(companyId, "viewer", "suspended");
    const missing = `user-${randomUUID()}`;

    for (const userId of [promoted, suspended, missing]) {
      const res = await readData(await app(board(userId, companyId, "viewer")), companyId);
      expect(res.status, userId).toBe(403);
    }
    expect(call).not.toHaveBeenCalled();
  });

  it("viewer gửi companyId sai kiểu vẫn nhận 400 stock", async () => {
    const companyId = await company(true);
    const userId = await member(companyId, "viewer");

    const res = await readData(await app(board(userId, companyId, "viewer")), "   ");

    expect(res.status).toBe(400);
    expect(call).not.toHaveBeenCalled();
  });

  it("viewer vẫn bị chặn ở bridge/data, bridge/action và actions/:key của crew.core", async () => {
    const companyId = await company(true);
    const userId = await member(companyId, "viewer");
    const server = await app(board(userId, companyId, "viewer"));

    const responses = [
      await request(server).post("/api/plugins/crew.core/bridge/data").send({ key: "crew.companies", companyId }),
      await request(server).post("/api/plugins/crew.core/bridge/action").send({ key: "crew.anything", companyId }),
      await request(server).post("/api/plugins/crew.core/actions/crew.anything").send({ companyId }),
    ];

    for (const res of responses) {
      expect(res.status).toBe(403);
      expect(res.body.error).toBe("Viewer access is read-only");
    }
    expect(call).not.toHaveBeenCalled();
  });

  it("owner và operator giữ hành vi stock: đọc được data crew.core", async () => {
    const companyId = await company(true);
    for (const role of ["owner", "operator"] as const) {
      const userId = await member(companyId, role);
      const res = await readData(await app(board(userId, companyId, role)), companyId);
      expect(res.status, role).toBe(200);
    }
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("agent giữ hành vi stock: route data chỉ dành cho board", async () => {
    const companyId = await company(true);

    const res = await readData(
      await app({ type: "agent", agentId: randomUUID(), companyId, runId: randomUUID(), source: "agent_jwt" }),
      companyId,
    );

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Board access required");
    expect(call).not.toHaveBeenCalled();
  });
});

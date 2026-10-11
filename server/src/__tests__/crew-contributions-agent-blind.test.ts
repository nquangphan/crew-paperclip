import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import request from "supertest";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  activityLog,
  agents,
  agentWakeupRequests,
  companies,
  companyMemberships,
  createDb,
  heartbeatRuns,
  issueComments,
  issues,
  projects,
} from "@paperclipai/db";
import { CREW_POLICY_CONFIG_ENV } from "../crew/issue-policy.js";
import { crewContributionsTable } from "../crew/contributions.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

/** Mọi lần stock gọi `heartbeat.wakeup` (vẫn chuyển cho heartbeat thật). */
const wakeCalls = vi.hoisted(() => [] as { agentId: string; reason: string | null }[]);

vi.mock("../services/heartbeat.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/heartbeat.js")>();
  return {
    ...actual,
    heartbeatService: (...args: Parameters<typeof actual.heartbeatService>) => {
      const service = actual.heartbeatService(...args);
      const wakeup = service.wakeup;
      service.wakeup = (async (agentId: string, opts?: { reason?: string | null }) => {
        wakeCalls.push({ agentId, reason: opts?.reason ?? null });
        return wakeup(agentId, opts as never);
      }) as typeof service.wakeup;
      return service;
    },
  };
});

const migration = readFileSync(
  fileURLToPath(new URL("../../../packages/crew-plugin/migrations/0013_contributions.sql", import.meta.url)),
  "utf8",
)
  .split(";")
  .map((statement) => statement.trim())
  .filter(Boolean);

const support = await getEmbeddedPostgresTestSupport();
const suite = support.supported ? describe.sequential : describe.skip;

/**
 * Quyết định của owner: lúc chờ duyệt, agent không thấy nội dung góp ý ở bất cứ đâu và không bị đánh thức. Sau khi
 * owner duyệt qua route stock, nội dung vào lõi và agent được đánh thức như board đăng.
 */
suite("Crew: agent không thấy góp ý chờ duyệt", () => {
  let db: ReturnType<typeof createDb>;
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  const dir = mkdtempSync(path.join(tmpdir(), "crew-contributions-blind-"));
  const configFile = path.join(dir, "crew-policy.json");
  const previousConfig = process.env[CREW_POLICY_CONFIG_ENV];

  const companyId = randomUUID();
  const ownerId = "user-owner";
  const guestId = "user-guest";
  const marker = `crew-blind-${randomUUID()}`;
  const rejectedMarker = `crew-blind-rejected-${randomUUID()}`;
  let projectId: string;
  let issueId: string;
  let agentId: string;
  let issueContributionId: string;
  let commentContributionId: string;
  let rejectedContributionId: string;

  beforeAll(async () => {
    temporary = await startEmbeddedPostgresTestDatabase("crew-contributions-blind-db-");
    db = createDb(temporary.connectionString);
    await db.execute(sql.raw("CREATE EXTENSION IF NOT EXISTS pg_trgm"));
    await db.insert(companies).values({
      id: companyId,
      name: "Crew blind",
      issuePrefix: `B${companyId.replaceAll("-", "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
      defaultResponsibleUserId: ownerId,
    });
    const [agent] = await db.insert(agents).values({
      companyId, name: "Executor", role: "engineer", status: "idle", adapterType: "process", adapterConfig: {},
      permissions: {}, runtimeConfig: { heartbeat: { enabled: false, wakeOnDemand: false } },
    }).returning();
    agentId = agent!.id;
    process.env[CREW_POLICY_CONFIG_ENV] = configFile;
    writeFileSync(configFile, JSON.stringify({
      companies: { [companyId]: { reviewerAgentId: randomUUID(), integratorAgentId: randomUUID(), ownerUserId: ownerId } },
    }));
    const [project] = await db.insert(projects).values({ companyId, name: "Marketing" }).returning();
    projectId = project!.id;
    const [issue] = await db.insert(issues).values({
      companyId, projectId, title: "Việc đang làm", status: "todo", priority: "medium", assigneeAgentId: agentId,
      responsibleUserId: ownerId,
    }).returning();
    issueId = issue!.id;
    await db.insert(companyMemberships).values([
      { companyId, principalType: "user", principalId: ownerId, status: "active", membershipRole: "owner" },
      { companyId, principalType: "user", principalId: guestId, status: "active", membershipRole: "viewer" },
    ]);
    const namespace = crewContributionsTable().split(".")[0]!;
    await db.execute(sql.raw(`CREATE SCHEMA IF NOT EXISTS ${namespace}`));
    for (const statement of migration) await db.execute(sql.raw(statement));
  }, 60_000);

  afterAll(async () => {
    // Route stock chạy khối đánh thức best-effort sau khi trả; chờ nó xong trước khi đóng Postgres.
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    if (previousConfig === undefined) delete process.env[CREW_POLICY_CONFIG_ENV];
    else process.env[CREW_POLICY_CONFIG_ENV] = previousConfig;
    await db?.$client.end({ timeout: 0 });
    await temporary?.cleanup();
    rmSync(dir, { recursive: true, force: true });
  });

  function board(userId: string, role: "owner" | "viewer") {
    return {
      type: "board",
      userId,
      source: "session",
      isInstanceAdmin: false,
      companyIds: [companyId],
      memberships: [{ companyId, membershipRole: role, status: "active" }],
    };
  }

  function agentActor() {
    return { type: "agent", agentId, companyId, runId: undefined, source: "agent_key" };
  }

  async function app(actor: Record<string, unknown>) {
    const [{ crewContributionRoutes }, { issueRoutes }, { activityRoutes }, { errorHandler }] = await Promise.all([
      import("../crew/contribution-routes.js"),
      import("../routes/issues.js"),
      import("../routes/activity.js"),
      import("../middleware/index.js"),
    ]);
    const server = express();
    server.use(express.json());
    server.use((req, _res, next) => {
      req.actor = actor as typeof req.actor;
      next();
    });
    server.use("/api", issueRoutes(db, {} as never));
    server.use("/api", activityRoutes(db));
    server.use("/api", crewContributionRoutes(db));
    server.use(errorHandler);
    return server;
  }

  const crew = (suffix: string) => `/api/crew/companies/${companyId}${suffix}`;

  /** Mọi đường agent đọc; trả toàn bộ body để quét chuỗi đánh dấu. */
  async function agentReads() {
    const server = await app(agentActor());
    const reads = {
      list: await request(server).get(`/api/companies/${companyId}/issues`),
      // Route tìm kiếm trả lại chuỗi truy vấn; tìm theo phần đầu của chuỗi đánh dấu (vẫn khớp nếu có lộ), để phần
      // trả lại không chứa nguyên chuỗi đánh dấu.
      search: await request(server).get(`/api/companies/${companyId}/search`).query({ q: marker.slice(0, -8) }),
      issue: await request(server).get(`/api/issues/${issueId}`),
      comments: await request(server).get(`/api/issues/${issueId}/comments`),
      context: await request(server).get(`/api/issues/${issueId}/heartbeat-context`),
      activity: await request(server).get(`/api/companies/${companyId}/activity`),
    };
    for (const [name, res] of Object.entries(reads)) expect(res.status, `${name}: ${JSON.stringify(res.body)}`).toBe(200);
    return reads;
  }

  const contains = (value: unknown, needle: string) => JSON.stringify(value).includes(needle);

  async function coreRowsContain(needle: string) {
    const [issueRows, commentRows, activityRows] = await Promise.all([
      db.select().from(issues),
      db.select().from(issueComments),
      db.select().from(activityLog),
    ]);
    return contains(issueRows, needle) || contains(commentRows, needle) || contains(activityRows, needle);
  }

  it("lúc chờ: mọi đường agent đọc không chứa nội dung, không có wake hay run mới", async () => {
    const wakeupsBefore = await db.select().from(agentWakeupRequests);
    const runsBefore = await db.select().from(heartbeatRuns);
    const guest = await app(board(guestId, "viewer"));
    expect((await request(await app(board(ownerId, "owner"))).put(crew(`/contributors/${guestId}`))).status).toBe(204);

    const issueItem = await request(guest).post(crew("/contributions")).send({
      kind: "issue", projectId, title: `Yêu cầu ${marker}`, description: `Mô tả ${marker}`,
    });
    const commentItem = await request(guest).post(crew("/contributions")).send({ kind: "comment", issueId, body: `Góp ý ${marker}` });
    const rejectedItem = await request(guest).post(crew("/contributions")).send({ kind: "comment", issueId, body: `Bỏ ${rejectedMarker}` });
    for (const res of [issueItem, commentItem, rejectedItem]) expect(res.status, JSON.stringify(res.body)).toBe(201);
    issueContributionId = issueItem.body.id;
    commentContributionId = commentItem.body.id;
    rejectedContributionId = rejectedItem.body.id;
    expect((await request(await app(board(ownerId, "owner"))).post(crew(`/contributions/${rejectedContributionId}/reject`))).status).toBe(200);

    const reads = await agentReads();
    for (const [name, res] of Object.entries(reads)) {
      expect(contains(res.body, marker), name).toBe(false);
      expect(contains(res.body, rejectedMarker), name).toBe(false);
    }
    expect(await coreRowsContain(marker)).toBe(false);
    expect(await coreRowsContain(rejectedMarker)).toBe(false);

    expect(wakeCalls).toEqual([]);
    expect(await db.select().from(agentWakeupRequests)).toHaveLength(wakeupsBefore.length);
    expect(await db.select().from(heartbeatRuns)).toHaveLength(runsBefore.length);
  }, 60_000);

  it("agent nhận 403 ở mọi endpoint Crew góp ý", async () => {
    const server = await app(agentActor());
    const calls = [
      request(server).get(crew("/access")),
      request(server).get(crew("/contributions")),
      request(server).get(crew("/contributions/summary")),
      request(server).get(crew(`/contributions/${commentContributionId}`)),
      request(server).post(crew("/contributions")).send({ kind: "comment", issueId, body: "agent" }),
      request(server).post(crew(`/contributions/${commentContributionId}/approve`)),
      request(server).post(crew(`/contributions/${commentContributionId}/approve/complete`)),
      request(server).post(crew(`/contributions/${commentContributionId}/reject`)),
      request(server).get(crew("/contributors")),
      request(server).put(crew(`/contributors/${guestId}`)),
      request(server).delete(crew(`/contributors/${guestId}`)),
    ];
    for (const res of await Promise.all(calls)) {
      expect(res.status, res.req.path).toBe(403);
      expect(res.body.code).toBe("crew_contribution_forbidden");
      expect(contains(res.body, marker)).toBe(false);
    }
  });

  it("owner duyệt bình luận qua route stock: agent thấy bình luận và được đánh thức issue_commented", async () => {
    const owner = await app(board(ownerId, "owner"));
    const wakeupsBefore = (await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.agentId, agentId))).length;
    const approve = await request(owner).post(crew(`/contributions/${commentContributionId}/approve`));
    expect(approve.status).toBe(200);
    const { materialize } = approve.body;

    const posted = await request(owner).post(`/api/issues/${materialize.issueId}/comments`).send({
      body: materialize.body, clientRequestId: materialize.clientRequestId,
    });
    expect(posted.status, JSON.stringify(posted.body)).toBe(201);
    // Gọi lại bước đăng (tab owner thử lại) không tạo bình luận trùng.
    const replay = await request(owner).post(`/api/issues/${materialize.issueId}/comments`).send({
      body: materialize.body, clientRequestId: materialize.clientRequestId,
    });
    expect(replay.body.id).toBe(posted.body.id);

    const complete = await request(owner).post(crew(`/contributions/${commentContributionId}/approve/complete`));
    expect(complete.status).toBe(200);
    expect(complete.body).toMatchObject({ status: "approved", resultCommentId: posted.body.id });

    const comments = await request(await app(agentActor())).get(`/api/issues/${issueId}/comments`);
    const matching = (comments.body as { body: string; authorUserId: string }[]).filter((comment) => comment.body.includes(marker));
    expect(matching).toHaveLength(1);
    expect(matching[0]!.authorUserId).toBe(ownerId);

    await vi.waitFor(() => expect(wakeCalls).toContainEqual({ agentId, reason: "issue_commented" }), { timeout: 10_000 });
    await vi.waitFor(async () => {
      const rows = await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.agentId, agentId));
      expect(rows.length).toBeGreaterThan(wakeupsBefore);
    }, { timeout: 10_000 });
  }, 60_000);

  it("owner duyệt yêu cầu kèm người nhận qua route stock: issue thật, wake issue_assigned, không trùng khi đăng lại", async () => {
    const owner = await app(board(ownerId, "owner"));
    const approve = await request(owner).post(crew(`/contributions/${issueContributionId}/approve`));
    expect(approve.status).toBe(200);
    const { materialize } = approve.body;
    const body = {
      projectId: materialize.projectId, title: materialize.title, description: materialize.description,
      status: "todo", priority: "medium", assigneeAgentId: agentId, idempotencyKey: materialize.idempotencyKey,
    };
    const created = await request(owner).post(`/api/companies/${companyId}/issues`).send(body);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const replay = await request(owner).post(`/api/companies/${companyId}/issues`).send(body);
    expect(replay.body.id).toBe(created.body.id);

    const complete = await request(owner).post(crew(`/contributions/${issueContributionId}/approve/complete`));
    expect(complete.status).toBe(200);
    expect(complete.body).toMatchObject({ status: "approved", resultIssueId: created.body.id });
    expect(await db.select().from(issues).where(eq(issues.title, materialize.title))).toHaveLength(1);

    await vi.waitFor(() => expect(wakeCalls).toContainEqual({ agentId, reason: "issue_assigned" }), { timeout: 10_000 });
    const agent = await app(agentActor());
    const list = await request(agent).get(`/api/companies/${companyId}/issues`);
    expect(contains(list.body, marker)).toBe(true);
    // Cùng truy vấn tìm kiếm của ca chờ duyệt giờ tìm thấy issue: ca đó không xanh nhờ truy vấn hỏng.
    const search = await request(agent).get(`/api/companies/${companyId}/search`).query({ q: marker.slice(0, -8) });
    expect(contains(search.body, created.body.id)).toBe(true);
  }, 60_000);

  it("mục bị từ chối vẫn không bao giờ tới agent", async () => {
    const reads = await agentReads();
    for (const [name, res] of Object.entries(reads)) expect(contains(res.body, rejectedMarker), name).toBe(false);
    expect(await coreRowsContain(rejectedMarker)).toBe(false);
  }, 60_000);
});

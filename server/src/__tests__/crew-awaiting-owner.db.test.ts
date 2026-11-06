import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import request from "supertest";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agents, companies, companyMemberships, createDb, issues, issueThreadInteractions, projects } from "@paperclipai/db";
import { CREW_POLICY_CONFIG_ENV } from "../crew/issue-policy.js";
import { crewProjectAccessTable } from "../crew/project-access.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

const accessMigration = readFileSync(
  fileURLToPath(new URL("../../../packages/crew-plugin/migrations/0016_project_access.sql", import.meta.url)),
  "utf8",
)
  .split(";")
  .map((statement) => statement.trim())
  .filter(Boolean);

const support = await getEmbeddedPostgresTestSupport();
const suite = support.supported ? describe.sequential : describe.skip;

const OWNER = "ao-owner";
const VIEWER = "ao-viewer";
const OUTSIDER = "ao-outsider";

/**
 * Issue đang làm hay đang bị chặn mà có thẻ câu hỏi/xác nhận chờ owner: route Crew chỉ đọc trả về để UI hiện
 * "Chờ owner trả lời". Thẻ gửi cho agent, thẻ đã trả lời, loại thẻ khác và issue đã đóng không tính.
 */
suite("Crew: yêu cầu chờ owner trả lời thẻ", () => {
  let db: ReturnType<typeof createDb>;
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  const dir = mkdtempSync(path.join(tmpdir(), "crew-awaiting-owner-"));
  const configFile = path.join(dir, "crew-policy.json");
  const previousConfig = process.env[CREW_POLICY_CONFIG_ENV];
  const companyId = randomUUID();
  const ids: Record<string, string> = {};
  const cards: Record<string, string> = {};

  beforeAll(async () => {
    temporary = await startEmbeddedPostgresTestDatabase("crew-awaiting-owner-db-");
    db = createDb(temporary.connectionString);
    await db.insert(companies).values({
      id: companyId,
      name: "Crew Awaiting",
      issuePrefix: `A${companyId.replaceAll("-", "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    process.env[CREW_POLICY_CONFIG_ENV] = configFile;
    writeFileSync(configFile, JSON.stringify({
      companies: { [companyId]: { reviewerAgentId: randomUUID(), integratorAgentId: randomUUID(), ownerUserId: OWNER } },
    }));
    await db.insert(companyMemberships).values([
      { companyId, principalType: "user", principalId: OWNER, status: "active", membershipRole: "owner" },
      { companyId, principalType: "user", principalId: VIEWER, status: "active", membershipRole: "viewer" },
    ]);
    const [agent] = await db.insert(agents).values({
      companyId, name: "Trợ Lý", role: "engineer", status: "idle", adapterType: "process", adapterConfig: {},
      permissions: {}, runtimeConfig: { heartbeat: { enabled: false, wakeOnDemand: false } },
    }).returning();
    const [shared, hidden] = await db.insert(projects).values([{ companyId, name: "Chung" }, { companyId, name: "Riêng" }]).returning();
    const namespace = crewProjectAccessTable().split(".")[0]!;
    await db.execute(sql.raw(`CREATE SCHEMA IF NOT EXISTS ${namespace}`));
    for (const statement of accessMigration) await db.execute(sql.raw(statement));
    await db.execute(sql`INSERT INTO ${sql.raw(crewProjectAccessTable())} (company_id, user_id, project_id, granted_by_user_id)
      VALUES (${companyId}, ${VIEWER}, ${shared!.id}, ${OWNER})`);

    const issue = async (key: string, status: string, projectId: string | null = shared!.id) => {
      const [row] = await db.insert(issues).values({ companyId, projectId, title: key, status }).returning();
      ids[key] = row!.id;
    };
    await issue("working", "in_progress");
    await issue("blocked", "blocked");
    await issue("toAgent", "in_progress");
    await issue("answered", "in_progress");
    await issue("closed", "done");
    await issue("otherKind", "in_progress");
    await issue("privateProject", "in_progress", hidden!.id);
    await issue("noProject", "blocked", null);

    const card = async (key: string, issueKey: string, extra: Partial<typeof issueThreadInteractions.$inferInsert> = {}) => {
      const [row] = await db.insert(issueThreadInteractions).values({
        companyId,
        issueId: ids[issueKey]!,
        kind: "ask_user_questions",
        createdByAgentId: agent!.id,
        payload: { version: 1, questions: [] } as never,
        ...extra,
      }).returning();
      cards[key] = row!.id;
    };
    await card("workingOld", "working", { createdAt: new Date("2026-11-01T01:00:00Z") });
    await card("workingNew", "working", { createdAt: new Date("2026-11-02T01:00:00Z") });
    await card("blocked", "blocked", { kind: "request_confirmation", createdAt: new Date("2026-11-01T02:00:00Z") });
    await card("toAgent", "toAgent", { addresseeAgentId: agent!.id });
    await card("answered", "answered", { status: "answered", resolvedByUserId: OWNER, resolvedAt: new Date() });
    await card("closed", "closed");
    await card("otherKind", "otherKind", { kind: "suggest_tasks" });
    await card("privateProject", "privateProject", { createdAt: new Date("2026-11-01T03:00:00Z") });
    await card("noProject", "noProject", { kind: "request_checkbox_confirmation", createdAt: new Date("2026-11-01T04:00:00Z") });
  }, 60_000);

  afterAll(async () => {
    if (previousConfig === undefined) delete process.env[CREW_POLICY_CONFIG_ENV];
    else process.env[CREW_POLICY_CONFIG_ENV] = previousConfig;
    await db?.$client.end({ timeout: 0 });
    await temporary?.cleanup();
    rmSync(dir, { recursive: true, force: true });
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
  const board = (userId: string) => ({
    type: "board", userId, source: "session", isInstanceAdmin: false, companyIds: [companyId],
    memberships: [{ companyId, membershipRole: userId === OWNER ? "owner" : "viewer", status: "active" }],
  });
  const url = `/api/crew/companies/${companyId}/awaiting-owner`;

  it("owner: issue chưa đóng có thẻ chờ người trả lời, mỗi issue một dòng (thẻ cũ nhất), chờ lâu nhất trước", async () => {
    const res = await request(await app(board(OWNER))).get(url);
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([
      { issueId: ids.working, interactionId: cards.workingOld, kind: "ask_user_questions", createdAt: "2026-11-01T01:00:00.000Z" },
      { issueId: ids.blocked, interactionId: cards.blocked, kind: "request_confirmation", createdAt: "2026-11-01T02:00:00.000Z" },
      { issueId: ids.privateProject, interactionId: cards.privateProject, kind: "ask_user_questions", createdAt: "2026-11-01T03:00:00.000Z" },
      { issueId: ids.noProject, interactionId: cards.noProject, kind: "request_checkbox_confirmation", createdAt: "2026-11-01T04:00:00.000Z" },
    ]);
  });

  it("thành viên khác chỉ thấy issue trong project được cấp", async () => {
    const res = await request(await app(board(VIEWER))).get(url);
    expect(res.status).toBe(200);
    expect(res.body.items.map((item: { issueId: string }) => item.issueId)).toEqual([ids.working, ids.blocked]);
  });

  it("trả lời thẻ xong thì issue ra khỏi danh sách", async () => {
    await db.execute(sql`UPDATE "issue_thread_interactions" SET status = 'answered', resolved_at = now()
      WHERE issue_id = ${ids.blocked}`);
    const res = await request(await app(board(OWNER))).get(url);
    expect(res.body.items.map((item: { issueId: string }) => item.issueId)).not.toContain(ids.blocked);
  });

  it("người ngoài company, agent và board API key không đọc được", async () => {
    expect((await request(await app(board(OUTSIDER))).get(url)).status).toBe(403);
    expect((await request(await app({ ...board(OWNER), source: "board_key" })).get(url)).status).toBe(403);
    expect((await request(await app({ type: "agent", agentId: randomUUID(), companyId, source: "agent_key" })).get(url)).status).toBe(403);
    const other = randomUUID();
    expect((await request(await app({ ...board(OWNER), companyIds: [other] })).get(`/api/crew/companies/${other}/awaiting-owner`)).status)
      .toBe(404);
  });
});

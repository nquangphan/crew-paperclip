import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { hashPassword } from "better-auth/crypto";
import express from "express";
import request from "supertest";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authAccounts, authUsers, companyMemberships, createDb } from "@paperclipai/db";
import { CREW_POLICY_CONFIG_ENV } from "../crew/issue-policy.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { applyCrewMachineTables, BOOK, MINI, type SeededProject, seedCrewProject, seedPairing, seedTemplate } from "./helpers/crew-machine-tables.js";

const support = await getEmbeddedPostgresTestSupport();
const suite = support.supported ? describe.sequential : describe.skip;
const OWNER = "tm-owner";
const VIEWER = "tm-viewer";
const PASSWORD = "mat-khau-dung-1";

suite("route terminal của Crew", () => {
  let db: ReturnType<typeof createDb>;
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let ns: string;
  let w: SeededProject;
  const dir = mkdtempSync(path.join(tmpdir(), "crew-terminal-routes-"));
  const configFile = path.join(dir, "crew-policy.json");
  const previous = process.env[CREW_POLICY_CONFIG_ENV];

  beforeAll(async () => {
    temporary = await startEmbeddedPostgresTestDatabase("crew-terminal-routes-");
    db = createDb(temporary.connectionString);
    ns = await applyCrewMachineTables(db);
    w = await seedCrewProject(db, ns, { key: "kidy-school", host: BOOK.ip });
    await seedPairing(db, ns, w.companyId, BOOK, await seedTemplate(db, BOOK));
    await seedPairing(db, ns, w.companyId, MINI, await seedTemplate(db, MINI));
    await db.execute(sql.raw(`INSERT INTO ${ns}.project_repos (company_id, project_id, origin_url, branch, updated_by_user_id)
      VALUES ('${w.companyId}', '${w.projectId}', 'git@github.com:nquangphan/kidy_school.git', 'develop', 'owner')`));
    await db.execute(sql.raw(`INSERT INTO ${ns}.project_machines (company_id, project_id, machine_id, repo_path, status) VALUES
      ('${w.companyId}', '${w.projectId}', '${BOOK.machineId}', '/Users/owner/crew-agents/kidy-school/repo', 'ready'),
      ('${w.companyId}', '${w.projectId}', '${MINI.machineId}', '/Users/owner/crew-agents/kidy-school/repo', 'provisioning')`));
    process.env[CREW_POLICY_CONFIG_ENV] = configFile;
    writeFileSync(configFile, JSON.stringify({ companies: { [w.companyId]: { reviewerAgentId: w.agents.reviewer.agentId, integratorAgentId: w.agents.integrator.agentId, ownerUserId: OWNER } } }));
    await db.insert(companyMemberships).values([
      { companyId: w.companyId, principalType: "user", principalId: OWNER, status: "active", membershipRole: "owner" },
      { companyId: w.companyId, principalType: "user", principalId: VIEWER, status: "active", membershipRole: "viewer" },
    ]);
    const now = new Date();
    await db.insert(authUsers).values({ id: OWNER, name: "Owner", email: "owner@example.test", createdAt: now, updatedAt: now });
    await db.insert(authAccounts).values({
      id: "acc-owner", issuer: "local:credential", accountId: OWNER, providerId: "credential", userId: OWNER,
      password: await hashPassword(PASSWORD), createdAt: now, updatedAt: now,
    });
  }, 60_000);
  afterAll(async () => {
    if (previous === undefined) delete process.env[CREW_POLICY_CONFIG_ENV];
    else process.env[CREW_POLICY_CONFIG_ENV] = previous;
    await db?.$client.end({ timeout: 0 });
    await temporary?.cleanup();
    rmSync(dir, { recursive: true, force: true });
  });

  async function as(userId: string, sessionId: string | null = `sess-${userId}`) {
    const [{ crewContributionRoutes }, { errorHandler }] = await Promise.all([
      import("../crew/contribution-routes.js"),
      import("../middleware/index.js"),
    ]);
    const server = express();
    server.use(express.json());
    server.use((req, _res, next) => {
      req.actor = {
        type: "board", userId, sessionId, source: "session", isInstanceAdmin: false, companyIds: [w.companyId],
        memberships: [{ companyId: w.companyId, membershipRole: userId === OWNER ? "owner" : "viewer", status: "active" }],
      } as typeof req.actor;
      next();
    });
    server.use("/api", crewContributionRoutes(db));
    server.use(errorHandler);
    return server;
  }
  const url = (suffix: string) => `/api/crew/companies/${w.companyId}/terminal${suffix}`;
  const codeOf = (body: { code?: string; details?: { code?: string } }) => body.details?.code ?? body.code;

  it("viewer không xem được danh sách target", async () => {
    expect((await request(await as(VIEWER)).get(url("/targets"))).status).toBe(403);
  });

  it("thiếu phiên đăng nhập thì 401", async () => {
    expect((await request(await as(OWNER, null)).get(url("/unlock"))).status).toBe(401);
  });

  it("targets chỉ trả máy và dự án ready, kèm projectKey và nhánh", async () => {
    const res = await request(await as(OWNER)).get(url("/targets"));
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([{
      machineId: BOOK.machineId, hostname: BOOK.hostname, projectId: w.projectId, projectName: "kidy-school",
      projectKey: "kidy-school", branch: "develop",
    }]);
  });

  it("chưa mở khoá thì không cấp vé (423)", async () => {
    const status = await request(await as(OWNER)).get(url("/unlock"));
    expect(status.body).toEqual({ unlocked: false, expiresAt: null });
    const res = await request(await as(OWNER)).post(url("/tickets")).send({ machineId: BOOK.machineId, projectId: w.projectId });
    expect(res.status).toBe(423);
    expect(codeOf(res.body)).toBe("crew_terminal_locked");
  });

  it("sai mật khẩu thì 403, đúng thì mở khoá và cấp được vé", async () => {
    const bad = await request(await as(OWNER)).post(url("/unlock")).send({ password: "sai" });
    expect(bad.status).toBe(403);
    expect(codeOf(bad.body)).toBe("crew_terminal_bad_password");
    expect((await request(await as(OWNER)).get(url("/unlock"))).body.unlocked).toBe(false);

    const ok = await request(await as(OWNER)).post(url("/unlock")).send({ password: PASSWORD });
    expect(ok.status).toBe(200);
    expect(typeof ok.body.expiresAt).toBe("string");
    expect((await request(await as(OWNER)).get(url("/unlock"))).body.unlocked).toBe(true);

    const ticket = await request(await as(OWNER)).post(url("/tickets")).send({ machineId: BOOK.machineId, projectId: w.projectId });
    expect(ticket.status).toBe(201);
    expect(typeof ticket.body.ticket).toBe("string");
    const { crewTerminalTicketStore } = await import("../crew/terminal/ticket-store.js");
    expect(crewTerminalTicketStore.consume(ticket.body.ticket)).toEqual({
      companyId: w.companyId, userId: OWNER, sessionId: `sess-${OWNER}`, machineId: BOOK.machineId, projectId: w.projectId,
    });
  });

  it("target không ready trên máy đó thì 404", async () => {
    const res = await request(await as(OWNER)).post(url("/tickets")).send({ machineId: MINI.machineId, projectId: w.projectId });
    expect(res.status).toBe(404);
    expect(codeOf(res.body)).toBe("crew_terminal_target_missing");
  });

  it("mở khoá theo phiên: phiên khác vẫn bị khoá", async () => {
    const res = await request(await as(OWNER, "sess-khac")).post(url("/tickets")).send({ machineId: BOOK.machineId, projectId: w.projectId });
    expect(res.status).toBe(423);
  });
});

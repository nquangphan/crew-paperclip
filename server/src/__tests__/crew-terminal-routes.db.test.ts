import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { hashPassword } from "better-auth/crypto";
import express from "express";
import request from "supertest";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { authAccounts, authUsers, companyMemberships, createDb } from "@paperclipai/db";
import { CREW_POLICY_CONFIG_ENV } from "../crew/issue-policy.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { applyCrewMachineTables, BOOK, MINI, type SeededProject, seedCrewProject, seedPairing, seedTemplate } from "./helpers/crew-machine-tables.js";

// Route /sessions hỏi Mac qua SSH: thay connector bằng bản giả, máy nào có thông tin SSH do `sshMachines` quyết.
const sshFake = vi.hoisted(() => ({ sshMachines: new Set<string>(), output: "", fail: false }));
vi.mock("../crew/terminal/ssh-connector.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../crew/terminal/ssh-connector.js")>()),
  resolveMachineSshTarget: async (_db: unknown, _companyId: string, machineId: string) =>
    sshFake.sshMachines.has(machineId)
      ? { host: "100.64.0.9", port: 2222, username: "owner", privateKey: "k", knownHosts: null, strictHostKeyChecking: false }
      : null,
  createSsh2CrewTerminalConnector: () => ({
    open: async () => {
      throw new Error("không dùng");
    },
    run: async () => {
      if (sshFake.fail) throw new Error("ssh lỗi");
      return sshFake.output;
    },
  }),
}));

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

  it("viewer không mở khoá và không xin vé được (403)", async () => {
    expect((await request(await as(VIEWER)).post(url("/unlock")).send({ password: PASSWORD })).status).toBe(403);
    const res = await request(await as(VIEWER)).post(url("/tickets")).send({ machineId: BOOK.machineId, projectId: w.projectId });
    expect(res.status).toBe(403);
  });

  it("máy đã gỡ ghép không còn trong targets và không cấp vé", async () => {
    await db.execute(sql.raw(`UPDATE ${ns}.project_machines SET status = 'ready' WHERE machine_id = '${MINI.machineId}'`));
    expect((await request(await as(OWNER)).get(url("/targets"))).body.items).toHaveLength(2);
    await db.execute(sql.raw(`UPDATE ${ns}.machine_pairings SET revoked_at = now() WHERE machine_id = '${MINI.machineId}'`));
    const targets = await request(await as(OWNER)).get(url("/targets"));
    expect(targets.body.items.map((t: { machineId: string }) => t.machineId)).toEqual([BOOK.machineId]);
    const res = await request(await as(OWNER)).post(url("/tickets")).send({ machineId: MINI.machineId, projectId: w.projectId });
    expect(res.status).toBe(404);
    expect(codeOf(res.body)).toBe("crew_terminal_target_missing");
  });

  it("5 lần sai mật khẩu thì lần 6 bị chặn 429 dù mật khẩu đúng", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await request(await as(OWNER)).post(url("/unlock")).send({ password: "sai" })).status).toBe(403);
    }
    const res = await request(await as(OWNER, "sess-khac-nua")).post(url("/unlock")).send({ password: PASSWORD });
    expect(res.status).toBe(429);
    expect(codeOf(res.body)).toBe("crew_terminal_unlock_throttled");
  });

  it("10 lần sai gửi cùng lúc thì nhiều nhất 5 lần được kiểm mật khẩu, còn lại 429", async () => {
    const { crewTerminalUnlockThrottle } = await import("../crew/terminal/unlock-throttle.js");
    crewTerminalUnlockThrottle.clear(OWNER);
    const app = await as(OWNER);
    const results = await Promise.all(Array.from({ length: 10 }, () => request(app).post(url("/unlock")).send({ password: "sai" })));
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 403).length).toBeLessThanOrEqual(5);
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThanOrEqual(5);
    crewTerminalUnlockThrottle.clear(OWNER);
  });

  it("sessions: liệt kê phiên tmux owner trên từng máy, gắn tên dự án; máy không hỏi được thì ok=false", async () => {
    sshFake.sshMachines = new Set([BOOK.machineId]);
    sshFake.output = "crew-owner-kidy-school|2|1793540000|1793545000\ncrew-owner-du-an-cu|0|1793500000|1793500100\n";
    const res = await request(await as(OWNER)).get(url("/sessions"));
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([
      {
        machineId: BOOK.machineId, hostname: BOOK.hostname, projectKey: "kidy-school", projectId: w.projectId,
        projectName: "kidy-school", attached: 2, createdAt: new Date(1793540000_000).toISOString(),
        activityAt: new Date(1793545000_000).toISOString(),
      },
      {
        machineId: BOOK.machineId, hostname: BOOK.hostname, projectKey: "du-an-cu", projectId: null, projectName: null,
        attached: 0, createdAt: new Date(1793500000_000).toISOString(), activityAt: new Date(1793500100_000).toISOString(),
      },
    ]);
    expect(res.body.machines).toEqual([{ machineId: BOOK.machineId, hostname: BOOK.hostname, ok: true }]);

    sshFake.fail = true;
    const failed = await request(await as(OWNER)).get(url("/sessions"));
    expect(failed.body).toEqual({ items: [], machines: [{ machineId: BOOK.machineId, hostname: BOOK.hostname, ok: false }] });
    sshFake.fail = false;
  });

  it("viewer không xem được phiên trên máy (403)", async () => {
    expect((await request(await as(VIEWER)).get(url("/sessions"))).status).toBe(403);
  });

  it("project dùng bản clone sẵn của owner (repo_path ngoài crew-agents, chưa có project_repos): khóa lấy từ checkout agent, nhánh null", async () => {
    await db.execute(sql.raw(`UPDATE ${ns}.project_machines SET repo_path = '/Volumes/CORSAIR/Projects/kidy_school'
      WHERE machine_id = '${BOOK.machineId}'`));
    await db.execute(sql.raw(`DELETE FROM ${ns}.project_repos WHERE project_id = '${w.projectId}'`));
    const res = await request(await as(OWNER)).get(url("/targets"));
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([{
      machineId: BOOK.machineId, hostname: BOOK.hostname, projectId: w.projectId, projectName: "kidy-school",
      projectKey: "kidy-school", branch: null,
    }]);
  });
});

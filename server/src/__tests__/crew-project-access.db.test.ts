import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import request from "supertest";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { companies, companyMemberships, createDb, issues, projects } from "@paperclipai/db";
import { CREW_POLICY_CONFIG_ENV } from "../crew/issue-policy.js";
import { crewProjectAccessTable } from "../crew/project-access.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

const statements = (file: string) =>
  readFileSync(fileURLToPath(new URL(`../../../packages/crew-plugin/migrations/${file}`, import.meta.url)), "utf8")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);

const support = await getEmbeddedPostgresTestSupport();
const suite = support.supported ? describe.sequential : describe.skip;

suite("Crew: quyền xem project theo thành viên", () => {
  let db: ReturnType<typeof createDb>;
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  const dir = mkdtempSync(path.join(tmpdir(), "crew-project-access-"));
  const configFile = path.join(dir, "crew-policy.json");
  const previousConfig = process.env[CREW_POLICY_CONFIG_ENV];

  const companyId = randomUUID();
  const otherCompanyId = randomUUID();
  let projectA: string;
  let projectB: string;
  let foreignProject: string;
  let issueA: string;
  let issueB: string;
  let looseIssue: string;
  const users = {
    owner: "pa-owner",
    admin: "pa-admin",
    operator: "pa-operator",
    viewer: "pa-viewer",
    guest: "pa-guest",
  };
  const roles: Record<string, string> = {
    [users.owner]: "owner",
    [users.admin]: "admin",
    [users.operator]: "operator",
    [users.viewer]: "viewer",
    [users.guest]: "viewer",
  };

  beforeAll(async () => {
    temporary = await startEmbeddedPostgresTestDatabase("crew-project-access-db-");
    db = createDb(temporary.connectionString);
    for (const [id, name] of [[companyId, "Crew"], [otherCompanyId, "Other"]] as const) {
      await db.insert(companies).values({
        id, name, issuePrefix: `P${id.replaceAll("-", "").slice(0, 6).toUpperCase()}`, requireBoardApprovalForNewAgents: false,
      });
    }
    process.env[CREW_POLICY_CONFIG_ENV] = configFile;
    writeFileSync(configFile, JSON.stringify({
      companies: { [companyId]: { reviewerAgentId: randomUUID(), integratorAgentId: randomUUID(), ownerUserId: users.owner } },
    }));
    const [a] = await db.insert(projects).values({ companyId, name: "A" }).returning();
    const [b] = await db.insert(projects).values({ companyId, name: "B" }).returning();
    const [foreign] = await db.insert(projects).values({ companyId: otherCompanyId, name: "Foreign" }).returning();
    projectA = a!.id;
    projectB = b!.id;
    foreignProject = foreign!.id;
    const issue = async (projectId: string | null) =>
      (await db.insert(issues).values({ companyId, projectId, title: "I", status: "todo", priority: "medium" }).returning())[0]!.id;
    issueA = await issue(projectA);
    issueB = await issue(projectB);
    looseIssue = await issue(null);
    await db.insert(companyMemberships).values(Object.entries(roles).map(([principalId, membershipRole]) => ({
      companyId, principalType: "user", principalId, status: "active", membershipRole,
    })));
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

  const as = (userId: string) =>
    app({
      type: "board", userId, source: "session", isInstanceAdmin: false, companyIds: [companyId],
      memberships: [{ companyId, membershipRole: roles[userId] ?? "viewer", status: "active" }],
    });
  const url = (suffix: string) => `/api/crew/companies/${companyId}${suffix}`;
  const setAccess = async (userId: string, projectIds: string[], by = users.owner) =>
    request(await as(by)).put(url(`/project-access/${userId}`)).send({ projectIds });
  const me = async (userId: string) => (await request(await as(userId)).get(url("/project-access/me"))).body;

  it("chưa có bảng: người bị giới hạn không thấy project nào, owner thấy tất cả, đặt quyền trả 503", async () => {
    expect(await me(users.guest)).toEqual({ all: false, projectIds: [] });
    expect(await me(users.owner)).toEqual({ all: true, projectIds: [] });
    const res = await setAccess(users.guest, [projectA]);
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("crew_project_access_unavailable");

    const namespace = crewProjectAccessTable().split(".")[0]!;
    await db.execute(sql.raw(`CREATE SCHEMA IF NOT EXISTS ${namespace}`));
    for (const statement of [...statements("0013_contributions.sql"), ...statements("0016_project_access.sql"), ...statements("0018_contributor_department.sql")]) {
      await db.execute(sql.raw(statement));
    }
    expect((await request(await as(users.owner)).put(url(`/contributors/${users.guest}`))).status).toBe(204);
  });

  it("mặc định mọi thành viên trừ owner không thấy project nào", async () => {
    for (const userId of [users.admin, users.operator, users.viewer, users.guest]) {
      expect(await me(userId), userId).toEqual({ all: false, projectIds: [] });
    }
    expect(await me(users.owner)).toEqual({ all: true, projectIds: [] });
  });

  it("chỉ owner xem và đặt quyền; agent và board key bị chặn", async () => {
    for (const userId of [users.admin, users.operator, users.viewer, users.guest]) {
      expect((await setAccess(users.viewer, [projectA], userId)).status, userId).toBe(403);
      expect((await request(await as(userId)).get(url("/project-access"))).status, userId).toBe(403);
    }
    const agent = await app({ type: "agent", agentId: randomUUID(), companyId, runId: randomUUID(), source: "agent_jwt" });
    expect((await request(agent).get(url("/project-access/me"))).status).toBe(403);
    const key = await app({ type: "board", userId: users.owner, source: "board_key", companyIds: [companyId] });
    expect((await request(key).put(url(`/project-access/${users.guest}`)).send({ projectIds: [] })).status).toBe(403);
    expect(await me(users.viewer)).toEqual({ all: false, projectIds: [] });
  });

  it("kiểm dữ liệu: owner và người lạ 409, project company khác 422, body sai 400", async () => {
    const owner = await setAccess(users.owner, [projectA]);
    expect(owner.status).toBe(409);
    expect(owner.body.code).toBe("crew_project_access_not_member");
    expect((await setAccess("pa-stranger", [projectA])).status).toBe(409);
    const foreign = await setAccess(users.viewer, [projectA, foreignProject]);
    expect(foreign.status).toBe(422);
    expect(foreign.body.projectIds).toEqual([foreignProject]);
    for (const body of [{}, { projectIds: ["nope"] }, { projectIds: [projectA], extra: 1 }]) {
      const res = await request(await as(users.owner)).put(url(`/project-access/${users.viewer}`)).send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(await me(users.viewer)).toEqual({ all: false, projectIds: [] });
  });

  it("cấp, liệt kê, thay và thu hồi", async () => {
    const granted = await setAccess(users.operator, [projectB, projectA, projectA]);
    expect(granted.status).toBe(200);
    expect(granted.body).toEqual({ userId: users.operator, all: false, projectIds: [projectA, projectB].sort() });
    expect(await me(users.operator)).toEqual({ all: false, projectIds: [projectA, projectB].sort() });

    const list = await request(await as(users.owner)).get(url("/project-access"));
    expect(list.status).toBe(200);
    expect(list.body.items).toEqual(expect.arrayContaining([
      { userId: users.owner, all: true, projectIds: [] },
      { userId: users.operator, all: false, projectIds: [projectA, projectB].sort() },
      { userId: users.admin, all: false, projectIds: [] },
    ]));

    expect((await setAccess(users.operator, [projectB])).status).toBe(200);
    expect(await me(users.operator)).toEqual({ all: false, projectIds: [projectB] });
    expect((await setAccess(users.operator, [])).status).toBe(200);
    expect(await me(users.operator)).toEqual({ all: false, projectIds: [] });
  });

  it("góp ý: chặn project và issue không được xem, cả issue không thuộc project nào", async () => {
    const guest = await as(users.guest);
    const post = (body: object) => request(guest).post(url("/contributions")).send(body);

    const noGrant = await post({ kind: "issue", projectId: projectA, title: "Không quyền" });
    expect(noGrant.status).toBe(403);
    expect(noGrant.body.code).toBe("crew_project_not_visible");

    expect((await setAccess(users.guest, [projectA])).status).toBe(200);
    expect((await post({ kind: "issue", projectId: projectA, title: "Được" })).status).toBe(201);
    expect((await post({ kind: "comment", issueId: issueA, body: "Được" })).status).toBe(201);
    const hiddenProject = await post({ kind: "issue", projectId: projectB, title: "Không quyền" });
    expect(hiddenProject.status).toBe(403);
    expect(hiddenProject.body.code).toBe("crew_project_not_visible");
    const hiddenIssue = await post({ kind: "comment", issueId: issueB, body: "Không quyền" });
    expect(hiddenIssue.status).toBe(403);
    expect(hiddenIssue.body.code).toBe("crew_project_not_visible");
    const loose = await post({ kind: "comment", issueId: looseIssue, body: "Không project" });
    expect(loose.status).toBe(403);
    expect(loose.body.code).toBe("crew_project_not_visible");
  });

  it("duyệt: người gửi mất quyền xem project thì 409, cấp lại thì duyệt được", async () => {
    expect((await setAccess(users.guest, [projectA])).status).toBe(200);
    const guest = await as(users.guest);
    const issueItem = (await request(guest).post(url("/contributions")).send({ kind: "issue", projectId: projectA, title: "T" })).body;
    const commentItem = (await request(guest).post(url("/contributions")).send({ kind: "comment", issueId: issueA, body: "C" })).body;
    expect((await setAccess(users.guest, [projectB])).status).toBe(200);

    const owner = await as(users.owner);
    for (const item of [issueItem, commentItem]) {
      const res = await request(owner).post(url(`/contributions/${item.id}/approve`));
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("crew_project_not_visible");
      const after = await request(owner).get(url(`/contributions/${item.id}`));
      expect(after.body.status).toBe("pending");
    }

    expect((await setAccess(users.guest, [projectA])).status).toBe(200);
    for (const item of [issueItem, commentItem]) {
      const res = await request(owner).post(url(`/contributions/${item.id}/approve`));
      expect(res.status).toBe(200);
      expect(res.body.contribution.status).toBe("approving");
    }
  });
});

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { companyMemberships, createDb, environmentLeases, heartbeatRuns, issues } from "@paperclipai/db";
import { CREW_POLICY_CONFIG_ENV } from "../crew/issue-policy.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { applyCrewMachineTables, BOOK, MINI, type SeededProject, seedCrewProject, seedPairing, seedReport, seedTemplate } from "./helpers/crew-machine-tables.js";

const support = await getEmbeddedPostgresTestSupport();
const suite = support.supported ? describe.sequential : describe.skip;
const OWNER = "mm-owner";
const VIEWER = "mm-viewer";
const ORIGIN = "git@github.com:nquangphan/kidy_school.git";

suite("route máy của Crew", () => {
  let db: ReturnType<typeof createDb>;
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let ns: string;
  let w: SeededProject & { root: string; child: string };
  const dir = mkdtempSync(path.join(tmpdir(), "crew-machine-routes-"));
  const configFile = path.join(dir, "crew-policy.json");
  const previous = process.env[CREW_POLICY_CONFIG_ENV];

  beforeAll(async () => {
    temporary = await startEmbeddedPostgresTestDatabase("crew-machine-routes-");
    db = createDb(temporary.connectionString);
    ns = await applyCrewMachineTables(db);
    const p = await seedCrewProject(db, ns, { key: "kidy-school", host: BOOK.ip });
    await seedPairing(db, ns, p.companyId, BOOK, await seedTemplate(db, BOOK));
    await seedPairing(db, ns, p.companyId, MINI, await seedTemplate(db, MINI));
    const now = new Date();
    await seedReport(db, ns, p.companyId, BOOK, { receivedAt: now, load1: 3.9, cpuCount: 12, memFreePct: 60, pollAt: now });
    await seedReport(db, ns, p.companyId, MINI, { receivedAt: now, load1: 1.2, cpuCount: 10, memFreePct: 54, pollAt: now });
    await db.execute(sql.raw(`INSERT INTO ${ns}.project_machines (company_id, project_id, machine_id, status)
      VALUES ('${p.companyId}', '${p.projectId}', '${BOOK.machineId}', 'ready')`));
    const [root] = await db.insert(issues).values({ companyId: p.companyId, projectId: p.projectId, title: "Gốc", status: "backlog" }).returning();
    const [child] = await db.insert(issues).values({ companyId: p.companyId, projectId: p.projectId, parentId: root!.id, title: "Con", status: "todo" }).returning();
    w = { ...p, root: root!.id, child: child!.id };
    process.env[CREW_POLICY_CONFIG_ENV] = configFile;
    writeFileSync(configFile, JSON.stringify({ companies: { [p.companyId]: { reviewerAgentId: p.agents.reviewer.agentId, integratorAgentId: p.agents.integrator.agentId, ownerUserId: OWNER } } }));
    await db.insert(companyMemberships).values([
      { companyId: p.companyId, principalType: "user", principalId: OWNER, status: "active", membershipRole: "owner" },
      { companyId: p.companyId, principalType: "user", principalId: VIEWER, status: "active", membershipRole: "viewer" },
    ]);
  }, 60_000);
  afterAll(async () => {
    if (previous === undefined) delete process.env[CREW_POLICY_CONFIG_ENV];
    else process.env[CREW_POLICY_CONFIG_ENV] = previous;
    await db?.$client.end({ timeout: 0 });
    await temporary?.cleanup();
    rmSync(dir, { recursive: true, force: true });
  });

  async function as(userId: string) {
    const [{ crewContributionRoutes }, { errorHandler }] = await Promise.all([
      import("../crew/contribution-routes.js"),
      import("../middleware/index.js"),
    ]);
    const server = express();
    server.use(express.json());
    server.use((req, _res, next) => {
      req.actor = {
        type: "board", userId, source: "session", isInstanceAdmin: false, companyIds: [w.companyId],
        memberships: [{ companyId: w.companyId, membershipRole: userId === OWNER ? "owner" : "viewer", status: "active" }],
      } as typeof req.actor;
      next();
    });
    server.use("/api", crewContributionRoutes(db));
    server.use(errorHandler);
    return server;
  }
  const url = (suffix: string) => `/api/crew/companies/${w.companyId}${suffix}`;

  it("danh sách máy cho form: máy đã ghép, online, số run, tải, trạng thái project", async () => {
    const res = await request(await as(VIEWER)).get(url(`/machines?projectId=${w.projectId}`));
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items).toEqual(expect.arrayContaining([
      { machineId: MINI.machineId, hostname: MINI.hostname, online: true, status: null, running: 0, load1: 1.2, cpuCount: 10, memFreePct: 54 },
      { machineId: BOOK.machineId, hostname: BOOK.hostname, online: true, status: "ready", running: 0, load1: 3.9, cpuCount: 12, memFreePct: 60 },
    ]));
  });

  it("ghim máy: chỉ owner, chỉ issue gốc, máy phải đã ghép", async () => {
    expect((await request(await as(VIEWER)).put(url(`/issues/${w.root}/machine`)).send({ machineId: BOOK.machineId })).status).toBe(403);
    const child = await request(await as(OWNER)).put(url(`/issues/${w.child}/machine`)).send({ machineId: BOOK.machineId });
    expect(child.status).toBe(422);
    expect(child.body.details?.code ?? child.body.code).toBe("crew_machine_not_root");
    const unknown = await request(await as(OWNER)).put(url(`/issues/${w.root}/machine`)).send({ machineId: "50000000-0000-4000-8000-0000000000ff" });
    expect(unknown.status).toBe(422);
  });

  it("máy chưa dựng mà project chưa có repo: 409 no_repo, chưa ghim", async () => {
    const res = await request(await as(OWNER)).put(url(`/issues/${w.root}/machine`)).send({ machineId: MINI.machineId });
    expect(res.status).toBe(409);
    const view = await request(await as(VIEWER)).get(url(`/issues/${w.root}/machine`));
    expect(view.body).toEqual({ rootIssueId: w.root, isRoot: true, locked: false, pin: null });
  });

  it("repo của project: chỉ owner, kiểm origin, nhánh và tên repo đi kèm (422 kèm mã)", async () => {
    const put = async (body: unknown) => request(await as(OWNER)).put(url(`/projects/${w.projectId}/repo`)).send(body);
    const companion = (name: string) => ({ name, originUrl: ORIGIN });
    const invalid = [
      { originUrl: "ftp://x", branch: "main", companions: [] },
      { originUrl: "https://bob:tok@github.com/o/r.git", branch: "main", companions: [] },
      { originUrl: "ssh://bob:pw@github.com/o/r.git", branch: "main", companions: [] },
      { originUrl: "ssh://git:p@ss@github.com:22/o/r.git", branch: "main", companions: [] },
      { originUrl: ORIGIN, branch: "main", companions: [{ name: "docs", originUrl: "ssh://u:p@github.com/o/d.git" }] },
      { originUrl: "https://github.com/o/r.git\u0007", branch: "main", companions: [] },
      { originUrl: `https://github.com/${"a".repeat(500)}.git`, branch: "main", companions: [] },
      { originUrl: ORIGIN, branch: "-main", companions: [] },
      { originUrl: ORIGIN, branch: "main nhánh", companions: [] },
      { originUrl: ORIGIN, branch: "main", companions: [companion("docs"), companion("docs")] },
      { originUrl: ORIGIN, branch: "main", companions: [companion("repo")] },
      { originUrl: ORIGIN, branch: "main", companions: [companion("executor-1")] },
      { originUrl: ORIGIN, branch: "main", companions: [companion(".docs")] },
      { originUrl: ORIGIN, branch: "main", companions: ["a", "b", "c", "d", "e", "f"].map(companion) },
      { originUrl: ORIGIN, branch: "main", companions: [{ name: "docs", originUrl: "https://u@github.com/o/d.git" }] },
      { originUrl: ORIGIN, branch: "main" },
    ];
    for (const body of invalid) {
      const res = await put(body);
      expect(res.status, JSON.stringify(body)).toBe(422);
      expect(res.body.details?.code).toBe("crew_machine_invalid");
    }
    expect((await request(await as(VIEWER)).put(url(`/projects/${w.projectId}/repo`)).send({ originUrl: ORIGIN, branch: "main", companions: [] })).status).toBe(403);
    const ok = await request(await as(OWNER)).put(url(`/projects/${w.projectId}/repo`)).send({
      originUrl: ORIGIN, branch: "main", companions: [{ name: "kidy_school_2.0_docs", originUrl: "git@github.com:nquangphan/kidy_school_2.0_docs.git" }],
    });
    expect(ok.status).toBe(200);
    expect(ok.body.companions).toHaveLength(1);
    const sshUser = await request(await as(OWNER)).put(url(`/projects/${w.projectId}/repo`)).send({
      originUrl: "ssh://git@github.com/nquangphan/kidy_school.git", branch: "main",
      companions: [{ name: "docs", originUrl: "ssh://git@github.com:22/nquangphan/docs.git" }],
    });
    expect(sshUser.status).toBe(200);
    expect(sshUser.body.originUrl).toBe("ssh://git@github.com/nquangphan/kidy_school.git");
    expect((await request(await as(OWNER)).put(url(`/projects/${w.projectId}/repo`)).send({
      originUrl: ORIGIN, branch: "main", companions: [{ name: "kidy_school_2.0_docs", originUrl: "git@github.com:nquangphan/kidy_school_2.0_docs.git" }],
    })).status).toBe(200);
  });

  it("owner chọn máy chưa dựng: ghim owner và xếp ensure-project; trang project thấy provisioning", async () => {
    const res = await request(await as(OWNER)).put(url(`/issues/${w.root}/machine`)).send({ machineId: MINI.machineId });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ rootIssueId: w.root, isRoot: true, locked: false, pin: { machineId: MINI.machineId, hostname: MINI.hostname, source: "owner" } });
    const project = await request(await as(VIEWER)).get(url(`/projects/${w.projectId}/machines`));
    expect(project.status).toBe(200);
    expect(project.body.repo.originUrl).toBe(ORIGIN);
    expect(project.body.machines.find((m: { machineId: string }) => m.machineId === MINI.machineId)).toMatchObject({ status: "provisioning", online: true });
    expect(project.body.machines.find((m: { machineId: string }) => m.machineId === BOOK.machineId)).toMatchObject({ status: "ready" });
  });

  it("cây đã có run (lease) thì khóa: 409 crew_machine_locked", async () => {
    const executor = w.agents["executor-1"];
    const [run] = await db.insert(heartbeatRuns).values({
      companyId: w.companyId, agentId: executor.agentId, status: "running", invocationSource: "on_demand", responsibleUserId: OWNER,
      contextSnapshot: { issueId: w.child },
    }).returning();
    await db.insert(environmentLeases).values({ companyId: w.companyId, environmentId: executor.environmentId, issueId: w.child, heartbeatRunId: run!.id, status: "active" });
    const res = await request(await as(OWNER)).put(url(`/issues/${w.root}/machine`)).send({ machineId: BOOK.machineId });
    expect(res.status).toBe(409);
    expect((await request(await as(VIEWER)).get(url(`/issues/${w.child}/machine`))).body).toMatchObject({ rootIssueId: w.root, isRoot: false, locked: true });
  });

  it("Thêm máy ở trang project: chỉ owner, máy chưa ghép thì 422 kèm hướng dẫn", async () => {
    expect((await request(await as(VIEWER)).post(url(`/projects/${w.projectId}/machines`)).send({ machineId: BOOK.machineId })).status).toBe(403);
    const unknown = await request(await as(OWNER)).post(url(`/projects/${w.projectId}/machines`)).send({ machineId: "50000000-0000-4000-8000-0000000000ff" });
    expect(unknown.status).toBe(422);
    expect(unknown.body.error).toContain("Máy chưa ghép, mở app 2P Crew → Máy → Ghép");
    const ok = await request(await as(OWNER)).post(url(`/projects/${w.projectId}/machines`)).send({ machineId: BOOK.machineId });
    expect(ok.status).toBe(202);
    expect(ok.body).toEqual({ status: "provisioning" });
  });
});

import express from "express";
import request from "supertest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { agents, companyMemberships, createDb, environments, heartbeatRuns, issues, projects } from "@paperclipai/db";
import { CREW_POLICY_CONFIG_ENV } from "../crew/issue-policy.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { applyCrewMachineTables, BOOK, MINI, type SeededProject, seedCrewProject, seedPairing, seedTemplate } from "./helpers/crew-machine-tables.js";
import { setOwnerPin } from "../crew/machine-pin.ts";
import { machineReleaseBlockers, provisionOtherMachines, releaseProjectMachines } from "../crew/machine-release.ts";
import { readProjectRepo, writeProjectRepo } from "../crew/machine-provision.ts";

const support = await getEmbeddedPostgresTestSupport();
const suite = support.supported ? describe.sequential : describe.skip;
const ORIGIN = "git@github.com:nquangphan/kidy_school.git";

suite("dọn máy khác khi gỡ, dựng sẵn máy khác khi thêm", () => {
  let db: ReturnType<typeof createDb>;
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let ns: string;
  const dir = mkdtempSync(path.join(tmpdir(), "crew-machine-release-"));
  const configFile = path.join(dir, "crew-policy.json");
  const previous = process.env[CREW_POLICY_CONFIG_ENV];
  const policy: Record<string, unknown> = {};

  beforeAll(async () => {
    temporary = await startEmbeddedPostgresTestDatabase("crew-machine-release-");
    db = createDb(temporary.connectionString);
    ns = await applyCrewMachineTables(db);
    process.env[CREW_POLICY_CONFIG_ENV] = configFile;
  }, 60_000);
  afterAll(async () => {
    if (previous === undefined) delete process.env[CREW_POLICY_CONFIG_ENV];
    else process.env[CREW_POLICY_CONFIG_ENV] = previous;
    await db?.$client.end({ timeout: 0 });
    await temporary?.cleanup();
    rmSync(dir, { recursive: true, force: true });
  });

  const rows = (result: unknown) => (Array.isArray(result) ? result : (result as { rows: unknown[] }).rows) as Record<string, unknown>[];

  /** Project dựng trên MacBook (máy chính) và Mac mini (environment `@phans-mac-mini` cho mọi agent), một cây ghim Mac mini. */
  async function world(): Promise<SeededProject & { root: string; child: string; miniEnvs: Record<string, string> }> {
    const p = await seedCrewProject(db, ns, { key: "kidy-school", host: BOOK.ip });
    await seedPairing(db, ns, p.companyId, BOOK, await seedTemplate(db, BOOK));
    await seedPairing(db, ns, p.companyId, MINI, await seedTemplate(db, MINI));
    await db.execute(sql.raw(`INSERT INTO ${ns}.project_machines (company_id, project_id, machine_id, status) VALUES
      ('${p.companyId}', '${p.projectId}', '${BOOK.machineId}', 'ready'), ('${p.companyId}', '${p.projectId}', '${MINI.machineId}', 'ready')`));
    const miniEnvs: Record<string, string> = {};
    for (const [slot, agent] of Object.entries(p.agents)) {
      const [env] = await db.insert(environments).values({
        name: `${agent.environmentName}@phans-mac-mini`, driver: "ssh", status: "active",
        config: { host: MINI.ip, port: 2222, username: "owner", remoteWorkspacePath: `/Users/owner/crew-agents/kidy-school/${slot}` },
        metadata: { workspaceRealizationMode: "in_place", crewAgentId: agent.agentId, crewMachineId: MINI.machineId },
      }).returning();
      miniEnvs[slot] = env!.id;
    }
    const [root] = await db.insert(issues).values({ companyId: p.companyId, projectId: p.projectId, title: "Gốc", status: "in_progress", identifier: `KS-${Date.now() % 100000}` }).returning();
    const [child] = await db.insert(issues).values({ companyId: p.companyId, projectId: p.projectId, parentId: root!.id, title: "Con", status: "todo" }).returning();
    await setOwnerPin(db, { companyId: p.companyId, rootIssueId: root!.id, machineId: MINI.machineId });
    policy[p.companyId] = { reviewerAgentId: p.agents.reviewer.agentId, integratorAgentId: p.agents.integrator.agentId, ownerUserId: "owner" };
    writeFileSync(configFile, JSON.stringify({ companies: policy }));
    await db.insert(companyMemberships).values([
      { companyId: p.companyId, principalType: "user", principalId: "owner", status: "active", membershipRole: "owner" },
      { companyId: p.companyId, principalType: "user", principalId: "viewer", status: "active", membershipRole: "viewer" },
    ]);
    return { ...p, root: root!.id, child: child!.id, miniEnvs };
  }
  const queuedRun = async (w: SeededProject, agentId: string, issueId: string, status = "queued") =>
    (await db.insert(heartbeatRuns).values({
      companyId: w.companyId, agentId, status, invocationSource: "on_demand", responsibleUserId: "owner", contextSnapshot: { issueId },
    }).returning())[0]!;
  /** Project khác cùng company, một agent có checkout `other-app/executor-1` và environment `@phans-mac-mini`. */
  async function otherProjectAgent(w: SeededProject) {
    await db.insert(projects).values({ companyId: w.companyId, name: "other-app" });
    const [base] = await db.insert(environments).values({
      name: `other-app-executor-1-${w.companyId.slice(0, 6)}`, driver: "ssh", status: "active",
      config: { host: BOOK.ip, port: 2222, username: "owner", remoteWorkspacePath: "/Users/owner/crew-agents/other-app/executor-1" },
      metadata: { workspaceRealizationMode: "in_place" },
    }).returning();
    const [agent] = await db.insert(agents).values({
      companyId: w.companyId, name: "other-app executor-1", role: "engineer", status: "idle", adapterType: "claude_local",
      adapterConfig: {}, permissions: {}, runtimeConfig: {}, defaultEnvironmentId: base!.id,
    }).returning();
    const [mini] = await db.insert(environments).values({
      name: `${base!.name}@phans-mac-mini`, driver: "ssh", status: "active",
      config: { host: MINI.ip, port: 2222, username: "owner", remoteWorkspacePath: "/Users/owner/crew-agents/other-app/executor-1" },
      metadata: { workspaceRealizationMode: "in_place", crewAgentId: agent!.id, crewMachineId: MINI.machineId },
    }).returning();
    return { agentId: agent!.id, miniEnvId: mini!.id };
  }
  const jobs = async (companyId: string) =>
    rows(await db.execute(sql.raw(`SELECT machine_id::text AS machine_id, kind, payload, created_by_user_id FROM ${ns}.crew_machine_jobs
      WHERE company_id = '${companyId}' ORDER BY created_at`)));

  it("cây ghim còn run chờ hay đang chạy thì từ chối gỡ, không archive gì", async () => {
    const w = await world();
    const executor = w.agents["executor-1"];
    await queuedRun(w, executor.agentId, w.child, "running");
    const blockers = await machineReleaseBlockers(db, { companyId: w.companyId, projectId: w.projectId, agentIds: null });
    expect(blockers).toEqual([expect.objectContaining({ issueId: w.root, hostname: MINI.hostname, runStatus: "running" })]);
    expect(await machineReleaseBlockers(db, { companyId: w.companyId, projectId: w.projectId, agentIds: [w.agents.reviewer.agentId] })).toEqual([]);
    const refused = await releaseProjectMachines(db, {
      companyId: w.companyId, projectId: w.projectId, agentIds: [executor.agentId], wholeProject: false, primaryMachineId: BOOK.machineId, createdBy: "owner",
    });
    expect(refused).toMatchObject({ ok: false, blockers: [expect.objectContaining({ issueId: w.root })] });
    const [env] = await db.select().from(environments).where(eq(environments.id, w.miniEnvs["executor-1"]!));
    expect(env?.status).toBe("active");
  });

  it("gỡ một agent: archive environment trên máy khác (không xóa), xếp remove-checkouts đúng tên checkout, giữ dòng máy của project", async () => {
    const w = await world();
    const executor = w.agents["executor-1"];
    const released = await releaseProjectMachines(db, {
      companyId: w.companyId, projectId: w.projectId, agentIds: [executor.agentId], wholeProject: false, primaryMachineId: BOOK.machineId, createdBy: "owner",
    });
    expect(released).toEqual({ ok: true, result: { archivedEnvironmentIds: [w.miniEnvs["executor-1"]], jobs: [{ machineId: MINI.machineId, jobId: expect.any(String) }] } });
    const [env] = await db.select().from(environments).where(eq(environments.id, w.miniEnvs["executor-1"]!));
    expect(env?.status).toBe("archived");
    const [kept] = await db.select().from(environments).where(eq(environments.id, executor.environmentId));
    expect(kept?.status).toBe("active");
    expect(await jobs(w.companyId)).toEqual([{
      machine_id: MINI.machineId, kind: "remove-checkouts", created_by_user_id: "owner",
      payload: { kind: "remove-checkouts", projectId: w.projectId, projectKey: "kidy-school", roles: ["executor-1"], removeStatusRepo: false },
    }]);
    const machineRows = rows(await db.execute(sql.raw(`SELECT count(*)::int AS n FROM ${ns}.project_machines WHERE project_id = '${w.projectId}'`)));
    expect(machineRows[0]?.n).toBe(2);
  });

  it("agent không thuộc vai trò của project (dù cùng company) thì từ chối cả lệnh: không archive, không xếp việc", async () => {
    const w = await world();
    const other = await otherProjectAgent(w);
    for (const agentIds of [[other.agentId], [w.agents["executor-1"].agentId, other.agentId]]) {
      for (const wholeProject of [false, true]) {
        expect(await releaseProjectMachines(db, {
          companyId: w.companyId, projectId: w.projectId, agentIds, wholeProject, primaryMachineId: BOOK.machineId, createdBy: "owner",
        })).toEqual({ ok: false, reason: "unknown_agents", agentIds: [other.agentId] });
      }
    }
    const archived = await db.select().from(environments).where(eq(environments.status, "archived"));
    expect(archived.map((e) => e.id).filter((id) => [other.miniEnvId, ...Object.values(w.miniEnvs)].includes(id))).toEqual([]);
    expect(await jobs(w.companyId)).toEqual([]);
  });

  it("gỡ agent A rồi B trước khi máy nhận việc: gộp vai trò vào việc còn queued; việc đã claimed thì xếp việc mới", async () => {
    const w = await world();
    const release = (agentId: string) => releaseProjectMachines(db, {
      companyId: w.companyId, projectId: w.projectId, agentIds: [agentId], wholeProject: false, primaryMachineId: BOOK.machineId, createdBy: "owner",
    });
    const jobIdOf = (r: Awaited<ReturnType<typeof release>>) => (r.ok ? r.result.jobs[0]?.jobId : null);
    const first = jobIdOf(await release(w.agents.reviewer.agentId));
    expect(jobIdOf(await release(w.agents["executor-1"].agentId))).toBe(first);
    expect((await jobs(w.companyId)).map((j) => (j.payload as { roles: string[] }).roles)).toEqual([["executor-1", "reviewer"]]);
    expect(jobIdOf(await release(w.agents.reviewer.agentId))).toBe(first);
    await db.execute(sql.raw(`UPDATE ${ns}.crew_machine_jobs SET status = 'claimed' WHERE id = '${first}'`));
    expect(jobIdOf(await release(w.agents["executor-1"].agentId))).toBe(first);
    const third = jobIdOf(await release(w.agents.assistant.agentId));
    expect(third).not.toBe(first);
    expect((await jobs(w.companyId)).map((j) => (j.payload as { roles: string[] }).roles)).toEqual([["executor-1", "reviewer"], ["assistant"]]);
  });

  it("gỡ cả project: archive mọi environment máy khác, một việc remove-checkouts cho Mac mini, xóa dòng máy của project; gọi lại không xếp thêm", async () => {
    const w = await world();
    const all = Object.values(w.agents).map((a) => a.agentId);
    const input = { companyId: w.companyId, projectId: w.projectId, agentIds: all, wholeProject: true, primaryMachineId: BOOK.machineId, createdBy: "owner" };
    const released = await releaseProjectMachines(db, input);
    expect(released.ok && released.result.archivedEnvironmentIds.sort()).toEqual(Object.values(w.miniEnvs).sort());
    expect((await jobs(w.companyId)).map((j) => [j.machine_id, (j.payload as { roles: string[] }).roles])).toEqual([
      [MINI.machineId, ["assistant", "executor-1", "reviewer", "integrator"]],
    ]);
    expect(rows(await db.execute(sql.raw(`SELECT count(*)::int AS n FROM ${ns}.project_machines WHERE project_id = '${w.projectId}'`)))[0]?.n).toBe(0);
    await releaseProjectMachines(db, input);
    expect(await jobs(w.companyId)).toHaveLength(1);
  });

  it("dựng sẵn mọi máy khác: ghi repo khi chưa có, máy ready bỏ qua (trừ includeReady), máy chính bỏ qua", async () => {
    const w = await world();
    await db.execute(sql.raw(`DELETE FROM ${ns}.project_machines WHERE project_id = '${w.projectId}' AND machine_id = '${MINI.machineId}'`));
    const first = await provisionOtherMachines(db, {
      companyId: w.companyId, projectId: w.projectId, exceptMachineId: BOOK.machineId, includeReady: false,
      repo: { originUrl: ORIGIN, branch: "main" }, createdBy: "owner",
    });
    expect(first).toEqual({ queued: [{ machineId: MINI.machineId, jobId: expect.any(String) }], skipped: [] });
    expect(await readProjectRepo(db, w.companyId, w.projectId)).toEqual({ originUrl: ORIGIN, branch: "main", companions: [] });
    const again = await provisionOtherMachines(db, {
      companyId: w.companyId, projectId: w.projectId, exceptMachineId: BOOK.machineId, includeReady: false, repo: null, createdBy: "owner",
    });
    expect(again).toEqual({ queued: [], skipped: [{ machineId: MINI.machineId, reason: "provisioning" }] });
    await db.execute(sql.raw(`UPDATE ${ns}.project_machines SET status = 'ready' WHERE project_id = '${w.projectId}'`));
    const ready = await provisionOtherMachines(db, {
      companyId: w.companyId, projectId: w.projectId, exceptMachineId: null, includeReady: true, repo: null, createdBy: "owner",
    });
    expect(ready.queued.map((q) => q.machineId).sort()).toEqual([BOOK.machineId, MINI.machineId].sort());
  });

  it("dựng sẵn: máy chính (máy của crew-mac status, chứa environment mặc định của agent) được ghi ready, máy khác thì không", async () => {
    const w = await world();
    await db.execute(sql.raw(`DELETE FROM ${ns}.project_machines WHERE project_id = '${w.projectId}'`));
    const statusOf = async (machineId: string) =>
      rows(await db.execute(sql.raw(`SELECT status FROM ${ns}.project_machines
        WHERE project_id = '${w.projectId}' AND machine_id = '${machineId}'`)))[0]?.status ?? null;
    const result = await provisionOtherMachines(db, {
      companyId: w.companyId, projectId: w.projectId, exceptMachineId: BOOK.machineId.toUpperCase(), includeReady: false,
      repo: { originUrl: ORIGIN, branch: "main" }, createdBy: "owner",
    });
    expect(result).toEqual({ queued: [{ machineId: MINI.machineId, jobId: expect.any(String) }], skipped: [] });
    expect(await statusOf(BOOK.machineId)).toBe("ready");
    expect(await statusOf(MINI.machineId)).toBe("provisioning");
    expect((await jobs(w.companyId)).map((j) => j.machine_id)).toEqual([MINI.machineId]);

    await db.execute(sql.raw(`DELETE FROM ${ns}.project_machines WHERE project_id = '${w.projectId}'`));
    await provisionOtherMachines(db, {
      companyId: w.companyId, projectId: w.projectId, exceptMachineId: MINI.machineId, includeReady: false, repo: null, createdBy: "owner",
    });
    expect(await statusOf(MINI.machineId)).toBeNull();
    expect(await statusOf(BOOK.machineId)).toBe("provisioning");
  });

  it("dựng sẵn khi project chưa có repo: máy nằm ở skipped với lý do, không ném", async () => {
    const w = await world();
    await db.execute(sql.raw(`DELETE FROM ${ns}.project_machines WHERE project_id = '${w.projectId}'`));
    expect(await provisionOtherMachines(db, {
      companyId: w.companyId, projectId: w.projectId, exceptMachineId: BOOK.machineId, includeReady: false, repo: null, createdBy: "owner",
    })).toEqual({ queued: [], skipped: [{ machineId: MINI.machineId, reason: "no_repo" }] });
  });

  it("route: owner bằng board key được gọi; viewer bị 403; release bận trả 409 kèm danh sách", async () => {
    const w = await world();
    await writeProjectRepo(db, { companyId: w.companyId, projectId: w.projectId, userId: "owner", repo: { originUrl: ORIGIN, branch: "main", companions: [] } });
    const [{ crewContributionRoutes }, { errorHandler }] = await Promise.all([import("../crew/contribution-routes.js"), import("../middleware/index.js")]);
    const app = (userId: string, source: string) => {
      const server = express();
      server.use(express.json());
      server.use((req, _res, next) => {
        req.actor = { type: "board", userId, source, isInstanceAdmin: false, companyIds: [w.companyId],
          memberships: [{ companyId: w.companyId, membershipRole: userId === "owner" ? "owner" : "viewer", status: "active" }] } as typeof req.actor;
        next();
      });
      server.use("/api", crewContributionRoutes(db));
      server.use(errorHandler);
      return server;
    };
    const base = `/api/crew/companies/${w.companyId}/projects/${w.projectId}/machines`;
    expect((await request(app("viewer", "session")).get(`${base}/blockers`)).status).toBe(403);
    const ok = await request(app("owner", "board_key")).get(`${base}/blockers?agentIds=${w.agents.assistant.agentId}`);
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ blockers: [] });
    await queuedRun(w, w.agents.assistant.agentId, w.root);
    const busy = await request(app("owner", "board_key")).post(`${base}/release`)
      .send({ agentIds: [w.agents.assistant.agentId], wholeProject: false, primaryMachineId: BOOK.machineId });
    expect(busy.status).toBe(409);
    expect(busy.body).toMatchObject({ code: "crew_machine_busy", blockers: [expect.objectContaining({ issueId: w.root, runStatus: "queued" })] });
    const whole = await request(app("owner", "board_key")).get(`${base}/blockers`);
    expect(whole.status).toBe(200);
    expect(whole.body.blockers).toEqual([expect.objectContaining({ issueId: w.root, hostname: MINI.hostname, runStatus: "queued" })]);
    expect((await request(app("owner", "board_key")).get(`${base}/blockers?agentIds=nope`)).status).toBe(400);
    const [env] = await db.select().from(environments).where(eq(environments.id, w.miniEnvs.assistant!));
    expect(env?.status).toBe("active");
    const other = await otherProjectAgent(w);
    const foreign = await request(app("owner", "board_key")).get(`${base}/blockers?agentIds=${other.agentId}`);
    expect(foreign.status).toBe(422);
    expect(JSON.stringify(foreign.body)).toContain("crew_machine_invalid");
    const foreignRelease = await request(app("owner", "board_key")).post(`${base}/release`)
      .send({ agentIds: [other.agentId], wholeProject: true, primaryMachineId: BOOK.machineId });
    expect(foreignRelease.status).toBe(422);
    const [otherEnv] = await db.select().from(environments).where(eq(environments.id, other.miniEnvId));
    expect(otherEnv?.status).toBe("active");
    const many = Array.from({ length: 21 }, () => w.agents.assistant.agentId).join(",");
    expect((await request(app("owner", "board_key")).get(`${base}/blockers?agentIds=${many}`)).status).toBe(422);
    const provision = await request(app("owner", "board_key")).post(`${base}/provision`)
      .send({ exceptMachineId: BOOK.machineId, includeReady: true, repo: null });
    expect(provision.status).toBe(200);
    expect(provision.body.queued).toEqual([{ machineId: MINI.machineId, jobId: expect.any(String) }]);
    const bad = await request(app("owner", "session")).post(`${base}/provision`)
      .send({ exceptMachineId: null, includeReady: false, repo: { originUrl: "https://bob:tok@github.com/o/r.git", branch: "main" } });
    expect(bad.status).toBe(400);
  });
});

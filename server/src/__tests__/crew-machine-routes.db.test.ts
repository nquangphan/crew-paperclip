import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { companies, companyMemberships, createDb, environmentLeases, heartbeatRuns, issues } from "@paperclipai/db";
import { CREW_POLICY_CONFIG_ENV } from "../crew/issue-policy.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { issueMachines, MAX_TREE_DEPTH, pinnedMachineId } from "../crew/machine-pin.js";
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

  async function withActor(actor: unknown, database: typeof db = db) {
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
    server.use("/api", crewContributionRoutes(database));
    server.use(errorHandler);
    return server;
  }
  const boardActor = (userId: string, companyIds: string[] = [w.companyId]) => ({
    type: "board", userId, source: "session", isInstanceAdmin: false, companyIds,
    memberships: companyIds.map((companyId) => ({ companyId, membershipRole: userId === OWNER ? "owner" : "viewer", status: "active" })),
  });
  const as = (userId: string, database: typeof db = db) => withActor(boardActor(userId), database);
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

  describe("route lô máy ghim cho danh sách issue", () => {
    const OLD = { machineId: "50000000-0000-4000-8000-0000000000c3", hostname: "demo-mac-old", ip: "100.64.0.4" };
    const GONE = "50000000-0000-4000-8000-0000000000d4";
    let t: Record<string, string>;
    let otherIssue: string;

    beforeAll(async () => {
      const add = async (title: string, parentId: string | null = null) =>
        (await db.insert(issues).values({ companyId: w.companyId, projectId: w.projectId, parentId, title, status: "todo" }).returning())[0]!.id;
      const pinned = await add("Gốc ghim BOOK");
      const child = await add("Con", pinned);
      const grand = await add("Cháu", child);
      const loose = await add("Gốc chưa ghim");
      const looseChild = await add("Con chưa ghim", loose);
      const revoked = await add("Gốc ghim máy đã gỡ");
      const stale = await add("Gốc ghim máy offline");
      t = { pinned, child, grand, loose, looseChild, revoked, stale };
      const now = new Date();
      await seedPairing(db, ns, w.companyId, OLD, await seedTemplate(db, OLD));
      await seedReport(db, ns, w.companyId, OLD, { receivedAt: new Date(now.getTime() - 10 * 60_000), load1: 1, cpuCount: 8, memFreePct: 50, pollAt: null });
      await db.execute(sql.raw(`INSERT INTO ${ns}.machine_pairings (company_id, machine_id, hostname, key_nonce, revoked_at)
        VALUES ('${w.companyId}', '${GONE}', 'demo-mac-gone', 'nonce', now())`));
      await db.execute(sql.raw(`INSERT INTO ${ns}.machine_latest (company_id, machine_id, hostname, received_at, sent_at, report)
        VALUES ('${w.companyId}', '${GONE}', 'demo-mac-gone', now(), now(), '{}'::jsonb)`));
      const pin = (root: string, machineId: string, companyId = w.companyId) => db.execute(sql.raw(`INSERT INTO ${ns}.issue_machine_pins
        (company_id, root_issue_id, machine_id, source) VALUES ('${companyId}', '${root}', '${machineId}', 'auto')`));
      await pin(pinned, BOOK.machineId);
      await pin(revoked, GONE);
      await pin(stale, OLD.machineId);
      const otherCompany = randomUUID();
      await db.insert(companies).values({ id: otherCompany, name: "Company khác", issuePrefix: `X${otherCompany.replace(/-/g, "").slice(0, 5).toUpperCase()}` });
      otherIssue = (await db.insert(issues).values({ companyId: otherCompany, title: "Issue company khác", status: "todo" }).returning())[0]!.id;
      await seedPairing(db, ns, otherCompany, BOOK, await seedTemplate(db, BOOK));
      await pin(otherIssue, BOOK.machineId, otherCompany);
    });

    const post = async (body: unknown, server?: Awaited<ReturnType<typeof as>>) =>
      request(server ?? (await as(VIEWER))).post(url("/issue-machines")).send(body);

    it("gốc ghim, con và cháu kế thừa máy gốc, cây chưa ghim trả null", async () => {
      const res = await post({ issueIds: [t.pinned, t.child, t.grand, t.loose, t.looseChild] });
      expect(res.status).toBe(200);
      const book = { rootIssueId: t.pinned, machineId: BOOK.machineId, hostname: BOOK.hostname, online: true, paired: true };
      expect(res.body).toEqual({ items: { [t.pinned]: book, [t.child]: book, [t.grand]: book, [t.loose]: null, [t.looseChild]: null } });
    });

    it("máy đã gỡ ghép: paired=false, hostname=null, online=false; máy có bản tin cũ hơn 5 phút: offline", async () => {
      const res = await post({ issueIds: [t.revoked, t.stale] });
      expect(res.status).toBe(200);
      expect(res.body.items[t.revoked]).toEqual({ rootIssueId: t.revoked, machineId: GONE, hostname: null, online: false, paired: false });
      expect(res.body.items[t.stale]).toEqual({ rootIssueId: t.stale, machineId: OLD.machineId, hostname: OLD.hostname, online: false, paired: true });
    });

    it("issue company khác hay id không có: bỏ khỏi items, không lỗi", async () => {
      const res = await post({ issueIds: [t.pinned, otherIssue, "50000000-0000-4000-8000-00000000eeee"] });
      expect(res.status).toBe(200);
      expect(Object.keys(res.body.items)).toEqual([t.pinned]);
    });

    describe("CTE đi lên gốc của lô khớp pinnedMachineId ở các biên (F-09)", () => {
      const insertIssue = async (companyId: string, parentId: string | null, title: string) =>
        (await db.insert(issues).values({ companyId, projectId: companyId === w.companyId ? w.projectId : null, parentId, title, status: "todo" }).returning())[0]!.id;
      const pinTo = (companyId: string, root: string, machineId = BOOK.machineId) => db.execute(sql.raw(`INSERT INTO ${ns}.issue_machine_pins
        (company_id, root_issue_id, machine_id, source) VALUES ('${companyId}', '${root}', '${machineId}', 'auto')`));
      /** Chuỗi cha→con dài `length` issue (phần tử 0 là gốc, cuối là lá), trả id theo thứ tự đó. */
      const chain = async (length: number, title: string) => {
        const ids: string[] = [];
        for (let i = 0; i < length; i += 1) ids.push(await insertIssue(w.companyId, ids[i - 1] ?? null, `${title} ${i}`));
        return ids;
      };
      /** Lô và đường đơn lẻ phải cùng kết luận, cả qua route. */
      const expectNoMachine = async (issueId: string) => {
        expect(await pinnedMachineId(db, w.companyId, issueId)).toBeNull();
        expect((await issueMachines(db, w.companyId, [issueId])).get(issueId)).toBeNull();
        const res = await post({ issueIds: [issueId] });
        expect(res.status).toBe(200);
        expect(res.body.items).toEqual({ [issueId]: null });
      };

      it("cha thuộc company khác (kể cả đã ghim) thì không đi qua: item null như pinnedMachineId", async () => {
        const other = randomUUID();
        await db.insert(companies).values({ id: other, name: "Company cha", issuePrefix: `P${other.replace(/-/g, "").slice(0, 5).toUpperCase()}` });
        await seedPairing(db, ns, other, BOOK, await seedTemplate(db, BOOK));
        const foreignParent = await insertIssue(other, null, "Cha company khác");
        const child = await insertIssue(w.companyId, foreignParent, "Con có cha company khác");
        await pinTo(other, foreignParent);
        // Dòng ghim cùng company với con nhưng trỏ vào cha ngoại: bỏ lọc company ở CTE thì lô sẽ nhận máy này.
        await pinTo(w.companyId, foreignParent);
        await expectNoMachine(child);
      });

      it("vòng parentId giữa hai issue: item null, không lỗi, issue khác trong lô vẫn đúng", async () => {
        const [x, y] = [await insertIssue(w.companyId, null, "Vòng X"), await insertIssue(w.companyId, null, "Vòng Y")];
        await db.update(issues).set({ parentId: y }).where(sql`${issues.id} = ${x}`);
        await db.update(issues).set({ parentId: x }).where(sql`${issues.id} = ${y}`);
        await pinTo(w.companyId, x);
        await pinTo(w.companyId, y);
        await expectNoMachine(x);
        await expectNoMachine(y);
        const batch = await issueMachines(db, w.companyId, [x, y, t.pinned]);
        expect(batch.get(x)).toBeNull();
        expect(batch.get(y)).toBeNull();
        expect(batch.get(t.pinned)).toMatchObject({ rootIssueId: t.pinned, machineId: BOOK.machineId });
      });

      it("độ sâu: gốc ở MAX_TREE_DEPTH còn tìm được, MAX_TREE_DEPTH + 1 thì null như pinnedMachineId", async () => {
        const reachable = await chain(MAX_TREE_DEPTH + 1, "Sâu đủ");
        const tooDeep = await chain(MAX_TREE_DEPTH + 2, "Sâu quá");
        await pinTo(w.companyId, reachable[0]!);
        await pinTo(w.companyId, tooDeep[0]!);
        const leaf = reachable.at(-1)!;
        expect(await pinnedMachineId(db, w.companyId, leaf)).toBe(BOOK.machineId);
        expect((await issueMachines(db, w.companyId, [leaf])).get(leaf)).toMatchObject({ rootIssueId: reachable[0], machineId: BOOK.machineId });
        await expectNoMachine(tooDeep.at(-1)!);
        // Một issue nằm giữa chuỗi quá sâu nhưng cách gốc ≤ MAX_TREE_DEPTH vẫn nhận máy.
        const middle = tooDeep[1]!;
        expect((await issueMachines(db, w.companyId, [middle])).get(middle)).toMatchObject({ rootIssueId: tooDeep[0], machineId: BOOK.machineId });
        expect(await pinnedMachineId(db, w.companyId, middle)).toBe(BOOK.machineId);
      }, 60_000);
    });

    it("body sai: 400 crew_machine_invalid", async () => {
      const ids = Array.from({ length: 501 }, () => randomUUID());
      for (const body of [{}, { issueIds: [] }, { issueIds: ["khong-phai-uuid"] }, { issueIds: ids }, { issueIds: [t.pinned], extra: 1 }, { issueIds: t.pinned }]) {
        const res = await post(body);
        expect(res.status, JSON.stringify(body).slice(0, 80)).toBe(400);
        expect(res.body.details?.code).toBe("crew_machine_invalid");
      }
      expect((await post({ issueIds: Array.from({ length: 500 }, () => randomUUID()) })).status).toBe(200);
    });

    it("quyền giống GET …/issues/:issueId/machine: viewer đọc được, ngoài company hay agent bị từ chối như GET", async () => {
      expect((await post({ issueIds: [t.pinned] }, await as(OWNER))).status).toBe(200);
      const outsider = boardActor("mm-outsider", []);
      const agent = { type: "agent", agentId: w.agents["executor-1"].agentId, companyId: w.companyId, source: "agent_key" };
      for (const actor of [outsider, agent]) {
        const server = await withActor(actor);
        const get = await request(server).get(url(`/issues/${t.pinned}/machine`));
        const res = await post({ issueIds: [t.pinned] }, server);
        expect(get.status).not.toBe(200);
        expect(res.status).toBe(get.status);
        expect(res.body.items).toBeUndefined();
      }
    });

    it("số truy vấn SQL không tăng theo số issue", async () => {
      let count = 0;
      const counted = new Proxy(db, {
        get(target, prop, receiver) {
          if (prop === "execute") return (...args: Parameters<typeof db.execute>) => { count += 1; return target.execute(...args); };
          return Reflect.get(target, prop, receiver);
        },
      });
      const server = await as(VIEWER, counted);
      count = 0;
      expect((await post({ issueIds: [t.pinned] }, server)).status).toBe(200);
      const one = count;
      expect(one).toBeGreaterThan(0);
      count = 0;
      expect((await post({ issueIds: Object.values(t) }, server)).status).toBe(200);
      expect(count).toBe(one);
    });
  });
});

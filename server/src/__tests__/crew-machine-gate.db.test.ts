import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, type SQL, sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { activityLog, agents, createDb, environments, heartbeatRuns, issueComments, issues } from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { applyCrewMachineTables, BOOK, MINI, seedCrewProject, seedPairing, seedReport, seedTemplate } from "./helpers/crew-machine-tables.js";

vi.mock("../services/secrets.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/secrets.ts")>()),
  secretService: () => ({ replaceSecretRefsForInstanceTarget: async () => undefined, syncEnvBindingsForTarget: async () => undefined }),
}));

import { defaultBeforeClaimDeps, evaluateBeforeClaim } from "../crew/load-gate.ts";
import { evaluateMachineGate, MACHINE_FAILED_ACTION, MACHINE_PINNED_ACTION, MACHINE_WAITING_ACTION } from "../crew/machine-gate.ts";
import { readPin, setOwnerPin } from "../crew/machine-pin.ts";
import { writeProjectRepo } from "../crew/machine-provision.ts";

const support = await getEmbeddedPostgresTestSupport();
const suite = support.supported ? describe.sequential : describe.skip;

suite("cổng ghim máy của H1 (Postgres)", () => {
  let db: ReturnType<typeof createDb>;
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let ns: string;

  beforeAll(async () => {
    temporary = await startEmbeddedPostgresTestDatabase("crew-machine-gate-");
    db = createDb(temporary.connectionString);
    ns = await applyCrewMachineTables(db);
  }, 60_000);
  afterAll(async () => {
    await db?.$client.end({ timeout: 0 });
    await temporary?.cleanup();
  });

  async function world(opts: { managed?: boolean; bookLoad?: number; repo?: boolean } = {}) {
    const p = await seedCrewProject(db, ns, { key: "kidy-school", host: BOOK.ip });
    await seedPairing(db, ns, p.companyId, BOOK, await seedTemplate(db, BOOK));
    await seedPairing(db, ns, p.companyId, MINI, await seedTemplate(db, MINI));
    const now = new Date();
    await seedReport(db, ns, p.companyId, BOOK, { receivedAt: now, load1: opts.bookLoad ?? 2, cpuCount: 12, memFreePct: 60, pollAt: now });
    await seedReport(db, ns, p.companyId, MINI, { receivedAt: now, load1: 1, cpuCount: 10, memFreePct: 54, pollAt: now });
    if (opts.managed !== false) {
      await db.execute(sql.raw(`INSERT INTO ${ns}.project_machines (company_id, project_id, machine_id, status)
        VALUES ('${p.companyId}', '${p.projectId}', '${BOOK.machineId}', 'ready')`));
    }
    if (opts.repo !== false) {
      await writeProjectRepo(db, { companyId: p.companyId, projectId: p.projectId, userId: "owner",
        repo: { originUrl: "git@github.com:nquangphan/kidy_school.git", branch: "main", companions: [] } });
    }
    const [root] = await db.insert(issues).values({ companyId: p.companyId, projectId: p.projectId, title: "Gốc", status: "todo" }).returning();
    const [child] = await db.insert(issues).values({ companyId: p.companyId, projectId: p.projectId, parentId: root!.id, title: "Con", status: "todo" }).returning();
    return { ...p, root: root!.id, child: child!.id };
  }
  async function queuedRun(companyId: string, agentId: string, issueId: string) {
    const [run] = await db.insert(heartbeatRuns).values({
      companyId, agentId, status: "queued", invocationSource: "on_demand", responsibleUserId: "owner", contextSnapshot: { issueId },
    }).returning();
    return run!;
  }
  /** Agent ngoài bảng vai trò; `host` thì có environment SSH mặc định ở host đó, không thì chạy trên server. */
  async function extraAgent(companyId: string, host?: string) {
    let defaultEnvironmentId: string | null = null;
    if (host) {
      const [env] = await db.insert(environments).values({
        name: `ngoai-vai-${companyId.slice(0, 8)}`, driver: "ssh", status: "active",
        config: { host, port: 2222, username: "owner", remoteWorkspacePath: "/Users/owner/khac" }, metadata: {},
      }).returning();
      defaultEnvironmentId = env!.id;
    }
    const [agent] = await db.insert(agents).values({
      companyId, name: `ngoài vai ${host ?? "server"}`, role: "engineer", status: "idle", adapterType: "claude_local",
      adapterConfig: {}, permissions: {}, runtimeConfig: {}, defaultEnvironmentId,
    }).returning();
    return agent!.id;
  }
  /** `db` ném lỗi ở mọi câu SQL chạm tới bảng `table`. */
  function failingOn(table: string): typeof db {
    const dialect = new PgDialect();
    return new Proxy(db, {
      get(target, prop) {
        if (prop === "execute") {
          return async (query: SQL) => {
            if (dialect.sqlToQuery(query).sql.includes(table)) throw new Error("mất kết nối Postgres");
            return target.execute(query);
          };
        }
        const value = Reflect.get(target, prop, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }
  const actions = async (runId: string, action: string) =>
    db.select({ id: activityLog.id }).from(activityLog).where(and(eq(activityLog.runId, runId), eq(activityLog.action, action)));
  const comments = async (issueId: string) => db.select({ body: issueComments.body }).from(issueComments).where(eq(issueComments.issueId, issueId));
  const rows = (result: unknown) => (Array.isArray(result) ? result : (result as { rows: unknown[] }).rows) as Record<string, unknown>[];
  const jobs = async (companyId: string) =>
    rows(await db.execute(sql.raw(`SELECT status FROM ${ns}.crew_machine_jobs WHERE company_id = '${companyId}' AND kind = 'ensure-project'`)));

  it("project chưa có máy nào trong project_machines: giữ hành vi stock, không ghim", async () => {
    const w = await world({ managed: false });
    const run = await queuedRun(w.companyId, w.agents.assistant.agentId, w.root);
    expect(await evaluateMachineGate(db, run)).toEqual({ action: "pass", environmentId: null });
    expect(await readPin(db, w.companyId, w.root)).toBeNull();
  });

  it("chưa ghim, MacBook ready và ổn: ghim auto MacBook, dùng environment mặc định, ghi activity", async () => {
    const w = await world();
    const run = await queuedRun(w.companyId, w.agents.assistant.agentId, w.root);
    expect(await evaluateMachineGate(db, run)).toEqual({ action: "pass", environmentId: w.agents.assistant.environmentId });
    expect(await readPin(db, w.companyId, w.root)).toMatchObject({ machineId: BOOK.machineId, source: "auto", reason: { rule: "ready" } });
    expect(await actions(run.id, MACHINE_PINNED_ACTION)).toHaveLength(1);
  });

  it("MacBook quá tải, Mac mini chưa dựng: ghim Mac mini, xếp ensure-project, giữ run, comment một lần", async () => {
    const w = await world({ bookLoad: 9 });
    const run = await queuedRun(w.companyId, w.agents["executor-1"].agentId, w.child);
    expect(await evaluateMachineGate(db, run)).toEqual({ action: "hold" });
    expect(await evaluateMachineGate(db, run)).toEqual({ action: "hold" });
    expect(await readPin(db, w.companyId, w.root)).toMatchObject({ machineId: MINI.machineId, reason: { rule: "provision" } });
    expect(await jobs(w.companyId)).toHaveLength(1);
    expect(await actions(run.id, MACHINE_WAITING_ACTION)).toHaveLength(1);
    expect((await comments(w.child)).filter((c) => c.body.includes("đang chờ dựng project trên máy Phans-Mac-mini"))).toHaveLength(1);

    const result = {
      kind: "ensure-project", repoPath: "/Volumes/CORSAIR/Projects/kidy_school", cloned: false, companions: [],
      checkouts: ["assistant", "executor-1", "reviewer", "integrator"].map((role) => ({ role, path: `/Users/owner/crew-agents/kidy-school/${role}`, head: "c".repeat(40) })),
    };
    await db.execute(sql.raw(`UPDATE ${ns}.crew_machine_jobs SET status = 'done', result = '${JSON.stringify(result)}'::jsonb
      WHERE company_id = '${w.companyId}' AND kind = 'ensure-project'`));
    const passed = await evaluateMachineGate(db, run);
    expect(passed.action).toBe("pass");
    expect(passed.action === "pass" && passed.environmentId !== null && passed.environmentId !== w.agents["executor-1"].environmentId).toBe(true);
  });

  it("project chưa có repo, mọi máy ready quá tải: không ghim máy chưa dựng, không chặn issue", async () => {
    const w = await world({ bookLoad: 9, repo: false });
    const run = await queuedRun(w.companyId, w.agents["executor-1"].agentId, w.child);
    expect(await evaluateMachineGate(db, run)).toEqual({ action: "pass", environmentId: w.agents["executor-1"].environmentId });
    expect(await readPin(db, w.companyId, w.root)).toMatchObject({ machineId: BOOK.machineId, reason: { rule: "overloaded" } });
    expect(await jobs(w.companyId)).toHaveLength(0);
    expect(await actions(run.id, MACHINE_FAILED_ACTION)).toHaveLength(0);
    const [child] = await db.select({ status: issues.status }).from(issues).where(eq(issues.id, w.child));
    expect(child!.status).toBe("todo");
  });

  it("dựng thất bại: fail kèm lý do và comment một lần", async () => {
    const w = await world();
    await setOwnerPin(db, { companyId: w.companyId, rootIssueId: w.root, machineId: MINI.machineId });
    const run = await queuedRun(w.companyId, w.agents.reviewer.agentId, w.child);
    expect(await evaluateMachineGate(db, run)).toEqual({ action: "hold" });
    await db.execute(sql.raw(`UPDATE ${ns}.crew_machine_jobs SET status = 'failed', error_code = 'clone_auth_failed',
      error_text = 'GitHub từ chối key SSH' WHERE company_id = '${w.companyId}'`));
    const outcome = await evaluateMachineGate(db, run);
    expect(outcome).toEqual({ action: "fail", issueId: w.child, reason: "không dựng được project trên máy Phans-Mac-mini: GitHub từ chối key SSH" });
    await evaluateMachineGate(db, run);
    expect(await actions(run.id, MACHINE_FAILED_ACTION)).toHaveLength(1);
  });

  it("project trên máy ghim đang failed: cổng claim hủy run và chuyển issue sang blocked", async () => {
    const w = await world();
    await db.execute(sql.raw(`INSERT INTO ${ns}.project_machines (company_id, project_id, machine_id, status, error)
      VALUES ('${w.companyId}', '${w.projectId}', '${MINI.machineId}', 'failed', 'Máy không dựng checkout reviewer')`));
    await setOwnerPin(db, { companyId: w.companyId, rootIssueId: w.root, machineId: MINI.machineId });
    const run = await queuedRun(w.companyId, w.agents.reviewer.agentId, w.child);
    const cancels: string[] = [];
    const deps = { ...defaultBeforeClaimDeps(db), scheduleCancel: (runId: string) => void cancels.push(runId) };
    expect(await evaluateBeforeClaim({ db, run }, deps)).toBe(true);
    expect(cancels).toEqual([run.id]);
    const [child] = await db.select({ status: issues.status }).from(issues).where(eq(issues.id, w.child));
    expect(child!.status).toBe("blocked");
    expect((await comments(w.child)).filter((c) => c.body.includes("Máy không dựng checkout reviewer"))).toHaveLength(1);
    expect(await jobs(w.companyId)).toHaveLength(0);
  });

  it("run chờ máy dựng quá 60 phút: hủy run, việc dựng vẫn chờ trong hàng đợi", async () => {
    const w = await world();
    await setOwnerPin(db, { companyId: w.companyId, rootIssueId: w.root, machineId: MINI.machineId });
    const run = await queuedRun(w.companyId, w.agents.assistant.agentId, w.root);
    expect(await evaluateMachineGate(db, run)).toEqual({ action: "hold" });
    expect(await evaluateMachineGate(db, run, new Date(Date.now() + 59 * 60_000))).toEqual({ action: "hold" });
    const later = new Date(Date.now() + 61 * 60_000);
    expect(await evaluateMachineGate(db, run, later)).toMatchObject({ action: "fail", reason: expect.stringContaining("sau 60 phút") });
    const pm = await db.execute(sql.raw(`SELECT status FROM ${ns}.project_machines WHERE company_id = '${w.companyId}' AND machine_id = '${MINI.machineId}'`));
    expect(rows(pm)[0]).toMatchObject({ status: "provisioning" });
    expect(await jobs(w.companyId)).toEqual([{ status: "queued" }]);
  });

  it("ghim của owner được giữ, không chọn lại theo tải", async () => {
    const w = await world();
    await setOwnerPin(db, { companyId: w.companyId, rootIssueId: w.root, machineId: MINI.machineId });
    const run = await queuedRun(w.companyId, w.agents.assistant.agentId, w.root);
    expect(await evaluateMachineGate(db, run)).toEqual({ action: "hold" });
    expect(await readPin(db, w.companyId, w.root)).toMatchObject({ machineId: MINI.machineId, source: "owner" });
  });

  it("máy ghim không còn ghép: giữ run, không rơi về environment mặc định trên máy khác", async () => {
    const w = await world();
    await setOwnerPin(db, { companyId: w.companyId, rootIssueId: w.root, machineId: MINI.machineId });
    await db.execute(sql.raw(`UPDATE ${ns}.machine_pairings SET revoked_at = now()
      WHERE company_id = '${w.companyId}' AND machine_id = '${MINI.machineId}'`));
    const run = await queuedRun(w.companyId, w.agents.assistant.agentId, w.root);
    expect(await evaluateMachineGate(db, run)).toEqual({ action: "hold" });
    expect(await evaluateMachineGate(db, run)).toEqual({ action: "hold" });
    expect(await actions(run.id, MACHINE_WAITING_ACTION)).toHaveLength(1);
    expect((await comments(w.root)).filter((c) => c.body.includes("không còn ghép"))).toHaveLength(1);
    expect(await jobs(w.companyId)).toHaveLength(0);
    expect(await evaluateMachineGate(db, run, new Date(Date.now() + 59 * 60_000))).toEqual({ action: "hold" });
    expect(await evaluateMachineGate(db, run, new Date(Date.now() + 61 * 60_000))).toEqual({
      action: "fail", issueId: w.root, reason: "máy Phans-Mac-mini đã gỡ ghép khỏi Crew và chưa được ghép lại sau 60 phút chờ",
    });
    expect((await comments(w.root)).filter((c) => c.body.startsWith("Máy Phans-Mac-mini đã gỡ ghép"))).toHaveLength(1);
  });

  it("agent ngoài vai trò chạy trên Mac khác máy ghim: giữ run; agent chạy trên server: stock", async () => {
    const w = await world();
    await setOwnerPin(db, { companyId: w.companyId, rootIssueId: w.root, machineId: MINI.machineId });
    const onBook = await queuedRun(w.companyId, await extraAgent(w.companyId, BOOK.ip), w.child);
    expect(await evaluateMachineGate(db, onBook)).toEqual({ action: "hold" });
    expect(await actions(onBook.id, MACHINE_WAITING_ACTION)).toHaveLength(1);
    expect(await evaluateMachineGate(db, onBook, new Date(Date.now() + 59 * 60_000))).toEqual({ action: "hold" });
    expect(await evaluateMachineGate(db, onBook, new Date(Date.now() + 61 * 60_000))).toEqual({
      action: "fail", issueId: w.child, reason: `agent ngoài vai ${BOOK.ip} chưa có environment trên máy Phans-Mac-mini sau 60 phút chờ`,
    });
    expect(await actions(onBook.id, MACHINE_FAILED_ACTION)).toHaveLength(1);
    const onServer = await queuedRun(w.companyId, await extraAgent(w.companyId), w.child);
    expect(await evaluateMachineGate(db, onServer)).toEqual({ action: "pass", environmentId: null });
    expect(await jobs(w.companyId)).toHaveLength(0);
  });

  it("lỗi bất ngờ khi cây đã ghim: giữ run; cây chưa ghim: stock", async () => {
    const w = await world();
    await setOwnerPin(db, { companyId: w.companyId, rootIssueId: w.root, machineId: MINI.machineId });
    const pinned = await queuedRun(w.companyId, w.agents.assistant.agentId, w.root);
    expect(await evaluateMachineGate(failingOn("machine_pairings"), pinned)).toEqual({ action: "hold" });

    const fresh = await world();
    const unpinned = await queuedRun(fresh.companyId, fresh.agents.assistant.agentId, fresh.root);
    expect(await evaluateMachineGate(failingOn("machine_latest"), unpinned)).toEqual({ action: "pass", environmentId: null });
    expect(await readPin(db, fresh.companyId, fresh.root)).toBeNull();
  });
});

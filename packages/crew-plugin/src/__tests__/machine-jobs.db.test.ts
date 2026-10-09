import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PluginApiRequestInput, PluginApiResponse, PluginContext } from "@paperclipai/plugin-sdk";
import postgres from "../../../db/node_modules/postgres";
import { createDb, plugins } from "../../../db/src/index.js";
import { startEmbeddedPostgresTestDatabase } from "../../../db/src/test-embedded-postgres.js";
import { pluginDatabaseService } from "../../../../server/src/services/plugin-database.js";
import { handleJobsApi } from "../jobs/api.js";
import { claimNextJob, loadMachineJobs } from "../jobs/data.js";
import type { MachineJob } from "../jobs/types.js";
import manifest from "../manifest.js";

const companyId = "10000000-0000-4000-8000-000000000001";
const otherCompany = "10000000-0000-4000-8000-000000000002";
const machine1 = "50000000-0000-4000-8000-000000000001";
const machine2 = "50000000-0000-4000-8000-000000000002";
const setupRun = "60000000-0000-4000-8000-0000000000aa";
const hostPluginId = "60000000-0000-4000-8000-000000000001";
const userId = "user-board-1";
const packageRoot = fileURLToPath(new URL("../..", import.meta.url));
const awsKey = `AKIA${"IOSFODNN7EXAMPLE"}`;
const JOBS_ERROR = "Không đọc/ghi được việc trên máy";

type Actor = PluginApiRequestInput["actor"];
const board: Actor = { actorType: "user", actorId: userId, userId, agentId: null, runId: null };
const agent: Actor = { actorType: "agent", actorId: "40000000-0000-4000-8000-000000000001", agentId: "40000000-0000-4000-8000-000000000001", userId: null, runId: null };

const ROUTES: Record<string, { method: string; path: (id?: string) => string }> = {
  "jobs.create": { method: "POST", path: () => "/machine-jobs" },
  "jobs.list": { method: "GET", path: () => "/machine-jobs" },
  "jobs.claim": { method: "POST", path: () => "/machine-jobs/claim" },
  "jobs.result": { method: "POST", path: (id) => `/machine-jobs/${id}/result` },
  "jobs.retry": { method: "POST", path: (id) => `/machine-jobs/${id}/retry` },
  "jobs.cancel": { method: "POST", path: (id) => `/machine-jobs/${id}/cancel` },
};

function request(routeKey: string, options: {
  body?: unknown; query?: Record<string, string | string[]>; jobId?: string; company?: string; actor?: Actor;
} = {}): PluginApiRequestInput {
  const route = ROUTES[routeKey]!;
  const company = options.company ?? companyId;
  return {
    routeKey, method: route.method, path: route.path(options.jobId), params: options.jobId ? { jobId: options.jobId } : {},
    query: route.method === "GET" ? { companyId: company, ...options.query } : {}, body: options.body ?? null,
    actor: options.actor ?? board, companyId: company, headers: {},
  };
}

interface Host { sql: postgres.Sql; ctx: PluginContext; ns: string; logs: { level: string; message: string; meta?: unknown }[]; fail: { error: Error | null }; cleanup: () => Promise<void> }

/** Embedded Postgres with the real host plugin-database service, so SQL binding and validators match production. */
async function startHost(): Promise<Host> {
  const database = await startEmbeddedPostgresTestDatabase("crew-machine-jobs-");
  const sql = postgres(database.connectionString, { max: 4, onnotice: () => {} });
  const hostDb = createDb(database.connectionString);
  await hostDb.insert(plugins).values({
    id: hostPluginId, pluginKey: manifest.id, packageName: "@crew/paperclip-plugin", version: manifest.version,
    apiVersion: manifest.apiVersion, categories: manifest.categories, manifestJson: manifest, status: "installed",
  });
  const pluginDb = pluginDatabaseService(hostDb);
  await pluginDb.applyMigrations(hostPluginId, manifest, packageRoot);
  const ns = await pluginDb.getRuntimeNamespace(hostPluginId);
  const logs: Host["logs"] = [];
  const fail: Host["fail"] = { error: null };
  const record = (level: string) => (message: string, meta?: unknown) => { logs.push({ level, message, meta }); };
  const ctx = {
    db: {
      namespace: ns,
      query: <T>(statement: string, params?: unknown[]) => {
        if (fail.error) throw fail.error;
        return pluginDb.query<T>(hostPluginId, statement, params);
      },
      execute: (statement: string, params?: unknown[]) => {
        if (fail.error) throw fail.error;
        return pluginDb.execute(hostPluginId, statement, params);
      },
    },
    logger: { info: record("info"), debug: record("debug"), error: record("error"), warn: record("warn") },
  } as unknown as PluginContext;
  return { sql, ctx, ns, logs, fail, cleanup: async () => { await sql.end(); await database.cleanup(); } };
}

const inspectBody = (overrides: Record<string, unknown> = {}) => ({
  companyId, machineId: machine1, kind: "inspect-folder", payload: { folder: "/Users/a/repo" }, ...overrides,
});

describe("machine job queue on the real host database", () => {
  let host: Host;
  const call = (input: PluginApiRequestInput): Promise<PluginApiResponse> => handleJobsApi(host.ctx, input);
  const create = async (overrides: Record<string, unknown> = {}): Promise<MachineJob> => {
    const res = await call(request("jobs.create", { body: inspectBody(overrides) }));
    expect(res.status).toBe(201);
    return res.body as MachineJob;
  };
  const row = async (id: string) => (await host.sql.unsafe(`SELECT * FROM ${host.ns}.crew_machine_jobs WHERE id = $1`, [id]))[0]!;
  const expireLease = (id: string) => host.sql.unsafe(
    `UPDATE ${host.ns}.crew_machine_jobs SET lease_until = now() - interval '1 minute' WHERE id = $1`, [id]);

  beforeAll(async () => { host = await startHost(); }, 120_000);
  afterAll(async () => { await host?.cleanup(); });
  beforeEach(async () => {
    host.fail.error = null;
    host.logs.length = 0;
    await host.sql.unsafe(`DELETE FROM ${host.ns}.crew_machine_jobs`);
  });

  it("tạo việc cho board, chặn agent và payload sai", async () => {
    const job = await create({ setupRunId: setupRun });
    expect(job).toMatchObject({
      companyId, machineId: machine1, kind: "inspect-folder", payload: { kind: "inspect-folder", folder: "/Users/a/repo" },
      status: "queued", result: null, errorCode: null, errorText: null, attempts: 0, setupRunId: setupRun,
      claimedAt: null, finishedAt: null,
    });
    expect(new Date(job.createdAt).toISOString()).toBe(job.createdAt);
    expect((await row(job.id)).created_by_user_id).toBe(userId);

    expect(await call(request("jobs.create", { body: inspectBody(), actor: agent })))
      .toEqual({ status: 403, body: { error: "Chỉ board được dùng hàng đợi việc trên máy" } });
    for (const [body, error] of [
      [inspectBody({ payload: { folder: "relative" } }), "folder phải là đường tuyệt đối"],
      [inspectBody({ companyId: otherCompany }), "companyId không hợp lệ"],
      [inspectBody({ machineId: "m1" }), "machineId phải là uuid"],
      [inspectBody({ kind: "reboot" }), "kind không hợp lệ"],
      [inspectBody({ setupRunId: "x" }), "setupRunId phải là uuid"],
      [inspectBody({ priority: 1 }), "trường priority không được hỗ trợ"],
      ["text", "body phải là object"],
    ] as const) {
      expect(await call(request("jobs.create", { body }))).toEqual({ status: 400, body: { error } });
    }
    expect(await host.sql.unsafe(`SELECT id FROM ${host.ns}.crew_machine_jobs`)).toHaveLength(1);
  });

  it("hai lời gọi claim song song chỉ một bên nhận được việc", async () => {
    const job = await create();
    // Both callers must read the same candidate before either writes, otherwise the race is not exercised.
    let arrivals = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const racing = {
      ...host.ctx,
      db: {
        namespace: host.ctx.db.namespace,
        execute: host.ctx.db.execute,
        query: async <T>(statement: string, params?: unknown[]) => {
          const rows = await host.ctx.db.query<T>(statement, params);
          if (statement.includes("status = 'queued' ORDER BY") && arrivals < 2) {
            arrivals++;
            if (arrivals === 2) release();
            await gate;
          }
          return rows;
        },
      },
    } as unknown as PluginContext;
    const claim = () => call(request("jobs.claim", { body: { companyId, machineId: machine1 } }));
    const raced = () => handleJobsApi(racing, request("jobs.claim", { body: { companyId, machineId: machine1 } }));
    const results = await Promise.all([raced(), raced()]);
    expect(arrivals).toBe(2);
    expect(results.map((res) => res.status).sort()).toEqual([200, 204]);
    const won = results.find((res) => res.status === 200)!.body as MachineJob;
    expect(won).toMatchObject({ id: job.id, status: "claimed", attempts: 0 });
    expect(won.claimedAt).not.toBeNull();
    const stored = await row(job.id);
    const lease = new Date(stored.lease_until).getTime() - new Date(stored.claimed_at).getTime();
    expect(lease).toBe(10 * 60_000);
    expect((await claim()).status).toBe(204);
  });

  it("claim lấy việc cũ nhất của đúng máy và đúng company", async () => {
    const first = await create();
    const second = await create();
    await create({ machineId: machine2 });
    await host.sql.unsafe(`UPDATE ${host.ns}.crew_machine_jobs SET created_at = now() - interval '1 hour' WHERE id = $1`, [second.id]);
    expect((await call(request("jobs.claim", { body: { companyId, machineId: machine1 } }))).body).toMatchObject({ id: second.id });
    expect((await call(request("jobs.claim", { body: { companyId, machineId: machine1 } }))).body).toMatchObject({ id: first.id });
    expect((await call(request("jobs.claim", { body: { companyId, machineId: machine1 } }))).status).toBe(204);
    // A job of another company is invisible even for the same machine id.
    await host.sql.unsafe(`UPDATE ${host.ns}.crew_machine_jobs SET company_id = $1 WHERE machine_id = $2`, [otherCompany, machine2]);
    expect((await call(request("jobs.claim", { body: { companyId, machineId: machine2 } }))).status).toBe(204);
    expect(await call(request("jobs.claim", { body: { companyId, machineId: machine2 }, actor: agent }))).toMatchObject({ status: 403 });
    expect(await call(request("jobs.claim", { body: { companyId, machineId: "x" } })))
      .toEqual({ status: 400, body: { error: "machineId phải là uuid" } });
  });

  it("hết lease thì trả việc về hàng đợi, quá 3 lần thì failed lease_expired", async () => {
    const job = await create();
    const claim = () => call(request("jobs.claim", { body: { companyId, machineId: machine1 } }));
    expect((await claim()).body).toMatchObject({ id: job.id, attempts: 0 });
    // Lease still valid: nothing else to claim.
    expect((await claim()).status).toBe(204);
    await expireLease(job.id);
    expect((await claim()).body).toMatchObject({ id: job.id, status: "claimed", attempts: 1 });
    await expireLease(job.id);
    expect((await claim()).body).toMatchObject({ id: job.id, attempts: 2 });
    await expireLease(job.id);
    expect((await claim()).status).toBe(204);
    const failed = await row(job.id);
    expect(failed).toMatchObject({ status: "failed", error_code: "lease_expired", attempts: 3, lease_until: null });
    expect(failed.finished_at).not.toBeNull();
    expect(failed.error_text).toBe("Máy không báo kết quả trong 10 phút");
  });

  it("claimNextJob nhận thời điểm do người gọi đưa vào", async () => {
    const job = await create();
    const t0 = new Date("2026-10-10T00:00:00.000Z");
    expect(await claimNextJob(host.ctx, companyId, machine1, t0)).toMatchObject({ id: job.id, claimedAt: t0.toISOString() });
    expect(await claimNextJob(host.ctx, companyId, machine1, new Date(t0.getTime() + 9 * 60_000))).toBeNull();
    expect(await claimNextJob(host.ctx, companyId, machine1, new Date(t0.getTime() + 11 * 60_000))).toMatchObject({ id: job.id, attempts: 1 });
  });

  it("nhận kết quả đúng máy, đúng trạng thái và làm sạch lỗi", async () => {
    const job = await create();
    const result = (body: Record<string, unknown>, id = job.id) =>
      call(request("jobs.result", { jobId: id, body: { companyId, machineId: machine1, ...body } }));
    const done = { status: "done", result: { kind: "inspect-folder", root: "/Users/a/repo", branch: "main", remote: null, docsBundle: null, clean: true } };

    expect(await result(done)).toEqual({ status: 409, body: { error: "Việc không ở trạng thái đang nhận" } });
    await call(request("jobs.claim", { body: { companyId, machineId: machine1 } }));
    expect(await call(request("jobs.result", { jobId: job.id, body: { companyId, machineId: machine2, ...done } })))
      .toEqual({ status: 409, body: { error: "Việc đang do máy khác nhận" } });
    expect(await result({ status: "done", result: { kind: "check", items: [] } }))
      .toEqual({ status: 400, body: { error: "result không khớp loại việc" } });
    expect(await result({ status: "done" })).toEqual({ status: 400, body: { error: "result phải là object" } });
    expect(await result({ status: "skipped" })).toEqual({ status: 400, body: { error: "status phải là done hoặc failed" } });
    expect(await result({ ...done, errorCode: "git_failed" })).toEqual({ status: 400, body: { error: "errorCode chỉ gửi khi status là failed" } });
    expect(await result(done, "70000000-0000-4000-8000-000000000099")).toEqual({ status: 404, body: { error: "Không tìm thấy việc" } });
    expect(await call(request("jobs.result", { jobId: job.id, body: { companyId, machineId: machine1, ...done }, actor: agent })))
      .toMatchObject({ status: 403 });

    const ok = await result(done);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ id: job.id, status: "done", result: done.result, errorCode: null });
    expect((ok.body as MachineJob).finishedAt).not.toBeNull();
    expect((await row(job.id)).lease_until).toBeNull();
    expect(await result(done)).toEqual({ status: 409, body: { error: "Việc không ở trạng thái đang nhận" } });

    const second = await create();
    await call(request("jobs.claim", { body: { companyId, machineId: machine1 } }));
    expect(await result({ status: "failed", errorCode: "boom" }, second.id)).toEqual({ status: 400, body: { error: "errorCode không hợp lệ" } });
    const failed = await result({ status: "failed", errorCode: "git_failed", errorText: `fatal: \x1b[31m${awsKey} ${"y".repeat(400)}` }, second.id);
    expect(failed.status).toBe(200);
    const stored = failed.body as MachineJob;
    expect(stored).toMatchObject({ status: "failed", errorCode: "git_failed", result: null });
    expect(stored.errorText).not.toContain(awsKey);
    expect(stored.errorText).not.toContain("\x1b");
    expect(stored.errorText).toContain("[ĐÃ CHE]");
    expect(stored.errorText!.length).toBeLessThanOrEqual(300);

    const third = await create();
    await call(request("jobs.claim", { body: { companyId, machineId: machine1 } }));
    expect((await result({ status: "failed" }, third.id)).body).toMatchObject({ status: "failed", errorCode: "app_error", errorText: null });
  });

  it("việc check failed giữ danh sách mục kiểm, kind khác vẫn bị từ chối result", async () => {
    const checkResult = { kind: "check", items: [{ id: "git", status: "ok", title: "Git" }, { id: "workflow:executor", status: "error", title: "Workflow chưa sạch" }] };
    const fail = (id: string, extra: Record<string, unknown>) =>
      call(request("jobs.result", { jobId: id, body: { companyId, machineId: machine1, status: "failed", errorCode: "check_failed", ...extra } }));

    const inspect = await create();
    await call(request("jobs.claim", { body: { companyId, machineId: machine1 } }));
    expect(await fail(inspect.id, { result: checkResult }))
      .toEqual({ status: 400, body: { error: "result chỉ gửi khi status là done, hoặc failed của việc check" } });

    const created = await call(request("jobs.create", { body: { companyId, machineId: machine1, kind: "check", payload: { projectKey: "demo" } } }));
    expect(created.status).toBe(201);
    const checkId = (created.body as MachineJob).id;
    expect(await call(request("jobs.claim", { body: { companyId, machineId: machine1 } }))).toMatchObject({ status: 200 });
    expect(await fail(checkId, { result: { kind: "inspect-folder" } })).toEqual({ status: 400, body: { error: "result không khớp loại việc" } });
    expect(await fail(checkId, { result: "x" })).toEqual({ status: 400, body: { error: "result phải là object" } });
    expect(await fail(checkId, { result: { kind: "check", items: [{ title: "y".repeat(70_000) }] } })).toEqual({ status: 400, body: { error: "result quá lớn" } });
    const ok = await fail(checkId, { result: checkResult, errorText: "Workflow chưa sạch" });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ status: "failed", errorCode: "check_failed", result: checkResult });
    const listed = (await loadMachineJobs(host.ctx, { companyId })).find((job) => job.id === checkId);
    expect(listed?.result).toEqual(checkResult);
  });

  it("retry chỉ nhận việc failed, cancel chỉ nhận việc chưa xong", async () => {
    const job = await create();
    const retry = (id: string, company = companyId) => call(request("jobs.retry", { jobId: id, company, body: { companyId: company } }));
    const cancel = (id: string) => call(request("jobs.cancel", { jobId: id, body: { companyId } }));
    expect(await retry(job.id)).toEqual({ status: 409, body: { error: "Chỉ thử lại được việc đã thất bại" } });

    for (let i = 0; i < 3; i++) {
      await call(request("jobs.claim", { body: { companyId, machineId: machine1 } }));
      await expireLease(job.id);
    }
    expect((await call(request("jobs.claim", { body: { companyId, machineId: machine1 } }))).status).toBe(204);
    const retried = await retry(job.id);
    expect(retried.status).toBe(200);
    expect(retried.body).toMatchObject({ id: job.id, status: "queued", attempts: 3, errorCode: null, errorText: null, finishedAt: null, claimedAt: null });
    expect(await retry(job.id)).toEqual({ status: 409, body: { error: "Chỉ thử lại được việc đã thất bại" } });
    expect(await retry(job.id, otherCompany)).toEqual({ status: 404, body: { error: "Không tìm thấy việc" } });

    const cancelled = await cancel(job.id);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toMatchObject({ status: "cancelled" });
    expect((cancelled.body as MachineJob).finishedAt).not.toBeNull();
    expect(await cancel(job.id)).toEqual({ status: 409, body: { error: "Chỉ hủy được việc đang chờ hoặc đang nhận" } });

    const claimed = await create();
    await call(request("jobs.claim", { body: { companyId, machineId: machine1 } }));
    expect((await cancel(claimed.id)).body).toMatchObject({ status: "cancelled" });
    expect((await call(request("jobs.result", { jobId: claimed.id, body: { companyId, machineId: machine1, status: "failed" } }))).status).toBe(409);
    expect(await call(request("jobs.cancel", { jobId: "bad", body: { companyId } }))).toEqual({ status: 400, body: { error: "jobId phải là uuid" } });
    expect(await call(request("jobs.cancel", { jobId: claimed.id, body: { companyId }, actor: agent }))).toMatchObject({ status: 403 });
  });

  it("liệt kê mới nhất trước, lọc theo máy, setup run, trạng thái, tối đa 100", async () => {
    const values: string[] = [];
    for (let i = 0; i < 105; i++) {
      const machine = i % 2 === 0 ? machine1 : machine2;
      const run = i < 3 ? `'${setupRun}'` : "NULL";
      const status = i === 104 ? "failed" : "queued";
      values.push(`('${companyId}','${machine}','check','{"kind":"check","projectKey":"demo"}'::jsonb,'${status}',${run},'u',now() - interval '${i} minutes')`);
    }
    values.push(`('${otherCompany}','${machine1}','check','{"kind":"check","projectKey":"demo"}'::jsonb,'queued',NULL,'u',now() + interval '1 minute')`);
    await host.sql.unsafe(`INSERT INTO ${host.ns}.crew_machine_jobs (company_id,machine_id,kind,payload,status,setup_run_id,created_by_user_id,created_at) VALUES ${values.join(",")}`);

    const list = async (query: Record<string, string> = {}) => {
      const res = await call(request("jobs.list", { query }));
      expect(res.status).toBe(200);
      return res.body as MachineJob[];
    };
    const all = await list();
    expect(all).toHaveLength(100);
    expect(all.every((job) => job.companyId === companyId)).toBe(true);
    const times = all.map((job) => new Date(job.createdAt).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(await list({ limit: "5" })).toHaveLength(5);
    expect(await list({ limit: "500" })).toHaveLength(100);
    expect((await list({ machineId: machine2 })).every((job) => job.machineId === machine2)).toBe(true);
    expect(await list({ machineId: machine2 })).toHaveLength(52);
    expect(await list({ setupRunId: setupRun })).toHaveLength(3);
    expect((await list({ status: "failed" })).map((job) => job.status)).toEqual(["failed"]);
    expect(await call(request("jobs.list", { query: { status: "lost" } }))).toEqual({ status: 400, body: { error: "status không hợp lệ" } });
    expect(await call(request("jobs.list", { query: { limit: "0" } }))).toEqual({ status: 400, body: { error: "limit phải là số nguyên dương" } });
    expect(await call(request("jobs.list", { query: { machineId: "x" } }))).toEqual({ status: 400, body: { error: "machineId phải là uuid" } });
    expect(await call(request("jobs.list", { actor: agent }))).toMatchObject({ status: 403 });

    expect(await loadMachineJobs(host.ctx, { companyId })).toHaveLength(100);
    expect(await loadMachineJobs(host.ctx, { companyId, setupRunId: setupRun })).toHaveLength(3);
    expect((await loadMachineJobs(host.ctx, { companyId, machineId: machine1 })).every((job) => job.machineId === machine1)).toBe(true);
    await expect(loadMachineJobs(host.ctx, { companyId: "x" })).rejects.toThrow("ID không hợp lệ");
  });

  it("lỗi DB trả 500 câu cố định, không lộ SQL, ghi log kèm routeKey", async () => {
    host.fail.error = new Error('Failed query: SELECT secret FROM "plugin_x".crew_machine_jobs');
    const res = await call(request("jobs.claim", { body: { companyId, machineId: machine1 } }));
    expect(res).toEqual({ status: 500, body: { error: JOBS_ERROR } });
    expect(host.logs).toEqual([expect.objectContaining({ level: "error", meta: expect.objectContaining({ routeKey: "jobs.claim" }) })]);
    expect(await call({ ...request("jobs.list"), routeKey: "jobs.unknown" })).toEqual({ status: 404, body: { error: "Route không tồn tại" } });
  });
});

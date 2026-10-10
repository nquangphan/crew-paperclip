import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PluginApiRequestInput, PluginContext } from "@paperclipai/plugin-sdk";
import { pluginManifestV1Schema } from "../../../shared/src/validators/plugin.js";
import manifest from "../manifest.js";
import { resolveAgentMachine } from "../runtimes/machine.js";
import { CREW_RUNTIME_SWITCH_DEFAULTS, handleRuntimeSwitchesApi, readRuntimeSwitch } from "../runtimes/switches.js";
import { type PluginHost, startPluginHost } from "./plugin-host-db.js";

const companyId = "10000000-0000-4000-8000-000000000001";
const otherCompany = "10000000-0000-4000-8000-000000000002";
const [mini, studio, foreign] = ["50000000-0000-4000-8000-000000000001", "50000000-0000-4000-8000-000000000002", "50000000-0000-4000-8000-000000000003"];
const userId = "user-board-1";
const SWITCH_ERROR = "Không đọc/ghi được công tắc runtime";

type Actor = PluginApiRequestInput["actor"];
const board: Actor = { actorType: "user", actorId: userId, userId, agentId: null, runId: null };
const agent: Actor = { actorType: "agent", actorId: "40000000-0000-4000-8000-000000000001", agentId: "40000000-0000-4000-8000-000000000001", userId: null, runId: null };

let host: PluginHost;
let ctx: PluginContext;
const activity: unknown[] = [];
let config: Record<string, unknown> = {};
const configCalls: (string | undefined)[] = [];

function request(routeKey: string, options: { body?: unknown; company?: string; actor?: Actor } = {}): PluginApiRequestInput {
  const company = options.company ?? companyId;
  const get = routeKey === "runtimes.switches.get";
  return {
    routeKey, method: get ? "GET" : "POST", path: "/runtime-switches", params: {},
    query: get ? { companyId: company } : {}, body: options.body ?? null,
    actor: options.actor ?? board, companyId: company, headers: {},
  };
}
const set = (body: Record<string, unknown>, actor?: Actor) =>
  handleRuntimeSwitchesApi(ctx, request("runtimes.switches.set", { body: { companyId, ...body }, actor }));
const defaults = (lockedOpencode: boolean) => ({
  claude_local: { enabled: true, updatedAt: null, updatedByUserId: null, locked: null },
  codex_local: { enabled: false, updatedAt: null, updatedByUserId: null, locked: null },
  opencode_local: { enabled: false, updatedAt: null, updatedByUserId: null, locked: lockedOpencode ? "opencode-patch-missing" : null },
});

beforeAll(async () => {
  host = await startPluginHost("crew-runtime-switches-");
  ctx = {
    ...host.ctx,
    config: { get: async (company?: string) => { configCalls.push(company); return config; } },
    activity: { log: async (entry: unknown) => { activity.push(entry); } },
  } as unknown as PluginContext;
  const report = (machineId: string, hostname: string, company = companyId) => host.sql.unsafe(
    `INSERT INTO ${host.ns}.machine_latest (company_id,machine_id,hostname,received_at,sent_at,report) VALUES ($1,$2,$3,now(),now(),'{}'::jsonb)`,
    [company, machineId, hostname],
  );
  await report(studio, "studio");
  await report(mini, "mac-mini");
  await report(foreign, "foreign", otherCompany);
}, 120_000);
afterAll(async () => { await host?.cleanup(); });
beforeEach(async () => {
  await host.sql.unsafe(`DELETE FROM ${host.ns}.crew_runtime_switches`);
  activity.length = 0;
  configCalls.length = 0;
  config = {};
  host.logs.length = 0;
});

describe("route công tắc runtime theo máy", () => {
  it("khai báo hai route chỉ board, không thêm capability", () => {
    const parsed = pluginManifestV1Schema.parse(manifest);
    expect(parsed.apiRoutes?.filter((r) => r.routeKey.startsWith("runtimes.")).map((r) => [r.routeKey, r.method, r.path, r.auth, r.companyResolution]))
      .toEqual([
        ["runtimes.switches.get", "GET", "/runtime-switches", "board", { from: "query", key: "companyId" }],
        ["runtimes.switches.set", "POST", "/runtime-switches", "board", { from: "body", key: "companyId" }],
      ]);
    expect(parsed.capabilities).toEqual(expect.arrayContaining(["api.routes.register", "activity.log.write"]));
    expect(parsed.capabilities).toHaveLength(28);
  });

  it("GET trả mọi máy có bản tin của company, chưa có dòng thì mặc định (claude bật, codex/opencode tắt, opencode bị khóa khi thiếu vá)", async () => {
    expect(CREW_RUNTIME_SWITCH_DEFAULTS).toEqual({ claude_local: true, codex_local: false, opencode_local: false });
    expect(await handleRuntimeSwitchesApi(ctx, request("runtimes.switches.get"))).toEqual({ status: 200, body: { machines: [
      { machineId: mini, hostname: "mac-mini", runtimes: defaults(true) },
      { machineId: studio, hostname: "studio", runtimes: defaults(true) },
    ] } });
    expect(configCalls).toEqual([companyId]);
    config = { opencodeInPlacePatch: true };
    const res = await handleRuntimeSwitchesApi(ctx, request("runtimes.switches.get"));
    expect((res.body as { machines: { runtimes: unknown }[] }).machines[0]!.runtimes).toEqual(defaults(false));
  });

  it("POST của board ghi, đọc lại đúng, ghi activity kèm company; máy khác không đổi", async () => {
    const res = await set({ machineId: mini.toUpperCase(), runtime: "codex_local", enabled: true });
    expect(res.status).toBe(200);
    const runtimes = (res.body as { ok: boolean; runtimes: Record<string, { enabled: boolean; updatedAt: string | null; updatedByUserId: string | null }> });
    expect(runtimes.ok).toBe(true);
    expect(runtimes.runtimes.codex_local).toMatchObject({ enabled: true, updatedByUserId: userId, locked: null });
    expect(Number.isFinite(Date.parse(runtimes.runtimes.codex_local!.updatedAt!))).toBe(true);
    expect(activity).toEqual([{
      companyId, message: "crew.runtime_switch.set", entityType: "company", entityId: companyId,
      metadata: { machineId: mini, runtime: "codex_local", before: false, after: true, actorUserId: userId },
    }]);
    expect((await set({ machineId: mini, runtime: "codex_local", enabled: false })).status).toBe(200);
    expect(activity.at(-1)).toMatchObject({ metadata: { before: true, after: false } });
    expect((await set({ machineId: mini, runtime: "claude_local", enabled: false })).status).toBe(200);
    const machines = (await handleRuntimeSwitchesApi(ctx, request("runtimes.switches.get"))).body as { machines: { machineId: string; runtimes: Record<string, { enabled: boolean }> }[] };
    expect(machines.machines.map((m) => [m.machineId, m.runtimes.claude_local!.enabled, m.runtimes.codex_local!.enabled]))
      .toEqual([[mini, false, false], [studio, true, false]]);
    expect(await readRuntimeSwitch(ctx, { companyId, machineId: mini, runtime: "claude_local" })).toBe(false);
    expect(await readRuntimeSwitch(ctx, { companyId, machineId: studio, runtime: "claude_local" })).toBe(true);
    expect(await readRuntimeSwitch(ctx, { companyId, machineId: null, runtime: "codex_local" })).toBe(false);
  });

  it("opencode: bật khi chưa có vá → 409, tắt vẫn được; có vá thì bật được; đọc luôn tắt khi bị khóa", async () => {
    expect(await set({ machineId: mini, runtime: "opencode_local", enabled: true }))
      .toEqual({ status: 409, body: { error: "OpenCode chưa có vá chạy đúng worktree trên server" } });
    expect((await set({ machineId: mini, runtime: "opencode_local", enabled: false })).status).toBe(200);
    config = { opencodeInPlacePatch: true };
    expect((await set({ machineId: mini, runtime: "opencode_local", enabled: true })).status).toBe(200);
    expect(await readRuntimeSwitch(ctx, { companyId, machineId: mini, runtime: "opencode_local" })).toBe(true);
    config = {};
    expect(await readRuntimeSwitch(ctx, { companyId, machineId: mini, runtime: "opencode_local" })).toBe(false);
    const machines = (await handleRuntimeSwitchesApi(ctx, request("runtimes.switches.get"))).body as { machines: { runtimes: Record<string, unknown> }[] };
    expect(machines.machines[0]!.runtimes.opencode_local).toMatchObject({ enabled: false, locked: "opencode-patch-missing" });
  });

  it("agent bị 403 ở cả hai route; input sai → 400 không chạm DB; máy lạ/máy company khác → 400", async () => {
    for (const routeKey of ["runtimes.switches.get", "runtimes.switches.set"]) {
      expect(await handleRuntimeSwitchesApi(ctx, request(routeKey, { actor: agent, body: { companyId, machineId: mini, runtime: "codex_local", enabled: true } })))
        .toEqual({ status: 403, body: { error: "Chỉ board được bật/tắt runtime" } });
    }
    host.fail.error = new Error("không được chạm DB");
    for (const body of [
      { machineId: mini, runtime: "process", enabled: true },
      { machineId: "mini", runtime: "codex_local", enabled: true },
      { machineId: mini, runtime: "codex_local", enabled: "yes" },
      { machineId: mini, runtime: "codex_local" },
      { machineId: mini, runtime: "codex_local", enabled: true, extra: 1 },
      { machineId: mini, runtime: "codex_local", enabled: true, companyId: otherCompany },
    ]) {
      const res = await set(body);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: expect.any(String) });
    }
    expect((await handleRuntimeSwitchesApi(ctx, request("runtimes.switches.set", { body: [] }))).status).toBe(400);
    expect((await handleRuntimeSwitchesApi(ctx, request("runtimes.switches.get", { company: "x" }))).status).toBe(400);
    expect((await handleRuntimeSwitchesApi(ctx, request("runtimes.unknown"))).status).toBe(404);
    host.fail.error = null;
    for (const machineId of [foreign, "50000000-0000-4000-8000-0000000000ff"]) {
      expect(await set({ machineId, runtime: "codex_local", enabled: true }))
        .toEqual({ status: 400, body: { error: `máy ${machineId} không thuộc company` } });
    }
    expect(await host.sql.unsafe(`SELECT * FROM ${host.ns}.crew_runtime_switches`)).toEqual([]);
    expect(activity).toEqual([]);
  });

  it("lỗi DB không lộ SQL ra board, chi tiết chỉ ở log", async () => {
    const sqlError = new Error('relation "plugin_crew_core_0433ea20b6.crew_runtime_switches" does not exist');
    for (const req of [request("runtimes.switches.get"), request("runtimes.switches.set", { body: { companyId, machineId: mini, runtime: "codex_local", enabled: true } })]) {
      host.logs.length = 0;
      host.fail.error = sqlError;
      const res = await handleRuntimeSwitchesApi(ctx, req);
      host.fail.error = null;
      expect(res).toEqual({ status: 500, body: { error: SWITCH_ERROR } });
      expect(JSON.stringify(res)).not.toContain("relation");
      expect(host.logs.filter((l) => l.level === "error")).toEqual([
        expect.objectContaining({ meta: expect.objectContaining({ routeKey: req.routeKey, companyId, err: sqlError.message }) }),
      ]);
    }
  });
});

describe("máy của agent đọc từ DB", () => {
  it("environment của agent → checkout trong refs wizard → máy có bản tin chứa checkout; không xác định → null", async () => {
    const { sql, ns } = host;
    const env = "80000000-0000-4000-8000-000000000001";
    const [codexAgent, homeless, outsider] = ["40000000-0000-4000-8000-000000000031", "40000000-0000-4000-8000-000000000032", "40000000-0000-4000-8000-000000000033"];
    const checkout = "/Users/owner/crew-agents/repo-a/executor-codex";
    await sql`INSERT INTO companies (id,name,issue_prefix) VALUES (${companyId},'Crew','CRE'),(${otherCompany},'Other','OTH')`;
    await sql`INSERT INTO environments (id,name,driver,config) VALUES (${env},'repo-a-executor-codex','ssh',${sql.json({ remoteWorkspacePath: checkout })})`;
    await sql`INSERT INTO agents (id,company_id,name,adapter_type,default_environment_id) VALUES (${codexAgent},${companyId},'Codex','codex_local',${env})`;
    await sql`INSERT INTO agents (id,company_id,name) VALUES (${homeless},${companyId},'Không env'),(${outsider},${otherCompany},'Ngoài')`;
    await sql.unsafe(`INSERT INTO ${ns}.crew_setup_runs (company_id,kind,project_key,machine_id,input,steps,created_by_user_id)
      VALUES ($1,'add-agent','repo-a',$2,'{}'::jsonb,$3::text::jsonb,'u')`,
    [companyId, mini, JSON.stringify({ agent: { status: "done", at: "x", refs: { agent: codexAgent } }, environment: { status: "done", at: "x", refs: { environment: env, checkout } } })]);
    // Hai máy, chưa máy nào báo checkout: không xác định.
    expect(await resolveAgentMachine(host.ctx, { companyId, agentId: codexAgent })).toBeNull();
    await sql.unsafe(`UPDATE ${ns}.machine_latest SET report = $1::text::jsonb WHERE machine_id = $2`,
      [JSON.stringify({ checkouts: [{ path: checkout, head: null, clean: true }] }), studio]);
    expect(await resolveAgentMachine(host.ctx, { companyId, agentId: codexAgent })).toBe(studio);
    expect(await resolveAgentMachine(host.ctx, { companyId, agentId: homeless })).toBeNull();
    // Agent company khác không được đọc chéo: company chỉ một máy nên lấy máy đó.
    expect(await resolveAgentMachine(host.ctx, { companyId: otherCompany, agentId: codexAgent })).toBe(foreign);
    expect(await resolveAgentMachine(host.ctx, { companyId: otherCompany, agentId: outsider })).toBe(foreign);
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PluginApiRequestInput, PluginApiResponse } from "@paperclipai/plugin-sdk";
import { handleSetupApi } from "../setup/api.js";
import { loadSetupRuns } from "../setup/data.js";
import type { SetupRun } from "../setup/types.js";
import { type PluginHost, startPluginHost } from "./plugin-host-db.js";

const companyId = "10000000-0000-4000-8000-000000000001";
const otherCompany = "10000000-0000-4000-8000-000000000002";
const machineId = "50000000-0000-4000-8000-000000000001";
const projectId = "30000000-0000-4000-8000-000000000001";
const userId = "user-board-1";
const awsKey = `AKIA${"IOSFODNN7EXAMPLE"}`;
const SETUP_ERROR = "Không đọc/ghi được tiến độ cài đặt";

type Actor = PluginApiRequestInput["actor"];
const board: Actor = { actorType: "user", actorId: userId, userId, agentId: null, runId: null };
const agent: Actor = { actorType: "agent", actorId: "40000000-0000-4000-8000-000000000001", agentId: "40000000-0000-4000-8000-000000000001", userId: null, runId: null };

function request(routeKey: string, options: {
  body?: unknown; id?: string; stepId?: string; company?: string; actor?: Actor;
} = {}): PluginApiRequestInput {
  const company = options.company ?? companyId;
  const params: Record<string, string> = {};
  if (options.id) params.id = options.id;
  if (options.stepId) params.stepId = options.stepId;
  const path = routeKey === "setup.create" ? "/setup-runs"
    : routeKey === "setup.get" ? `/setup-runs/${options.id}`
      : `/setup-runs/${options.id}/steps/${options.stepId}/${routeKey === "setup.begin" ? "begin" : "finish"}`;
  const method = routeKey === "setup.get" ? "GET" : "POST";
  return {
    routeKey, method, path, params, query: method === "GET" ? { companyId: company } : {}, body: options.body ?? null,
    actor: options.actor ?? board, companyId: company, headers: {},
  };
}

const projectInput = { name: "Demo", key: "demo", folder: "/Users/a/demo", executors: 1 };
const createBody = (overrides: Record<string, unknown> = {}) => ({
  companyId, kind: "add-project", projectKey: "demo", machineId, input: projectInput, ...overrides,
});

describe("tiến độ wizard trên database thật của host", () => {
  let host: PluginHost;
  const call = (input: PluginApiRequestInput): Promise<PluginApiResponse> => handleSetupApi(host.ctx, input);
  const create = async (overrides: Record<string, unknown> = {}): Promise<SetupRun> => {
    const res = await call(request("setup.create", { body: createBody(overrides) }));
    expect(res.status).toBe(201);
    return res.body as SetupRun;
  };
  const begin = (id: string, stepId: string) => call(request("setup.begin", { id, stepId, body: { companyId } }));
  const finish = (id: string, stepId: string, body: Record<string, unknown>) =>
    call(request("setup.finish", { id, stepId, body: { companyId, ...body } }));
  const row = async (id: string) => (await host.sql.unsafe(`SELECT * FROM ${host.ns}.crew_setup_runs WHERE id = $1`, [id]))[0]!;

  beforeAll(async () => { host = await startPluginHost("crew-setup-runs-"); }, 120_000);
  afterAll(async () => { await host?.cleanup(); });
  beforeEach(async () => {
    host.fail.error = null;
    host.logs.length = 0;
    await host.sql.unsafe(`DELETE FROM ${host.ns}.crew_setup_runs`);
  });

  it("tạo run add-project, chặn run dở cùng khóa, chặn agent và input sai", async () => {
    const run = await create();
    expect(run).toMatchObject({
      companyId, kind: "add-project", projectKey: "demo", projectId: null, machineId, input: projectInput,
      steps: {}, status: "running", runningStep: null,
    });
    expect(new Date(run.createdAt).toISOString()).toBe(run.createdAt);
    expect((await row(run.id)).created_by_user_id).toBe(userId);

    expect(await call(request("setup.create", { body: createBody() })))
      .toEqual({ status: 409, body: { error: "Đang có lần thêm project dở cho khóa này", setupRunId: run.id } });
    // A failed run is resumed, not replaced.
    await begin(run.id, "inspect");
    await finish(run.id, "inspect", { status: "failed", error: "x" });
    expect((await call(request("setup.create", { body: createBody() }))).status).toBe(409);
    // Other company, other key: no conflict.
    expect((await call(request("setup.create", { body: createBody({ companyId: otherCompany }), company: otherCompany }))).status).toBe(201);
    expect((await call(request("setup.create", { body: createBody({ projectKey: "demo-2", input: { ...projectInput, key: "demo-2" } }) }))).status).toBe(201);

    expect(await call(request("setup.create", { body: createBody(), actor: agent })))
      .toEqual({ status: 403, body: { error: "Chỉ board được dùng tiến độ cài đặt" } });
    for (const [body, error] of [
      [createBody({ companyId: otherCompany }), "companyId không hợp lệ"],
      [createBody({ kind: "add-skill" }), "kind không hợp lệ"],
      [createBody({ projectKey: "Bad_Key" }), "projectKey không hợp lệ"],
      [createBody({ machineId: "m1" }), "machineId phải là uuid"],
      [createBody({ extra: 1 }), "trường extra không được hỗ trợ"],
      [createBody({ input: "x" }), "input phải là object"],
      [createBody({ projectKey: "other", input: projectInput }), "input.key phải trùng projectKey"],
      [createBody({ input: { ...projectInput, executors: 3 } }), "executors phải là 1 hoặc 2"],
      [createBody({ input: { ...projectInput, folder: "relative" } }), "folder phải là đường tuyệt đối"],
      [createBody({ input: { ...projectInput, name: "" } }), "name không hợp lệ"],
      [createBody({ input: { ...projectInput, extra: 1 } }), "trường extra không được hỗ trợ"],
      [createBody({ kind: "add-agent", input: { projectId: "x", slot: "executor", name: "A", model: "claude-sonnet-5" } }), "projectId phải là uuid"],
      [createBody({ kind: "add-agent", input: { projectId, slot: "boss", name: "A", model: "claude-sonnet-5" } }), "slot không hợp lệ"],
      [createBody({ kind: "add-agent", input: { projectId, slot: "executor", name: "A", model: "bad model" } }), "model không hợp lệ"],
      ["text", "body phải là object"],
    ] as const) {
      expect(await call(request("setup.create", { body }))).toEqual({ status: 400, body: { error } });
    }
  });

  it("run add-agent không khóa theo key và ghi projectId từ input", async () => {
    const input = { projectId, slot: "executor-2", name: "Thợ 2", model: "claude-sonnet-5" };
    const first = await create({ kind: "add-agent", input });
    const second = await create({ kind: "add-agent", input });
    expect(first.projectId).toBe(projectId);
    expect(second.id).not.toBe(first.id);
    expect(first.input).toEqual(input);
  });

  it("mỗi run chỉ một bước chạy một lúc; finish nhả khóa; khóa quá 5 phút coi như chết", async () => {
    const run = await create();
    const started = await begin(run.id, "agents");
    expect(started.status).toBe(200);
    expect((started.body as SetupRun).runningStep).toBe("agents");
    expect(await begin(run.id, "agents")).toEqual({ status: 409, body: { error: "Bước agents đang chạy" } });
    expect((await begin(run.id, "roles")).status).toBe(409);

    const done = await finish(run.id, "agents", { status: "done", refs: { agent_assistant: "40000000-0000-4000-8000-000000000009" } });
    expect(done.status).toBe(200);
    const after = done.body as SetupRun;
    expect(after.runningStep).toBeNull();
    expect(after.status).toBe("running");
    expect(after.steps.agents).toMatchObject({ status: "done", refs: { agent_assistant: "40000000-0000-4000-8000-000000000009" } });
    expect(new Date(after.steps.agents!.at).toISOString()).toBe(after.steps.agents!.at);
    expect((await begin(run.id, "roles")).status).toBe(200);

    await host.sql.unsafe(`UPDATE ${host.ns}.crew_setup_runs SET running_since = now() - interval '6 minutes' WHERE id = $1`, [run.id]);
    expect((await call(request("setup.get", { id: run.id }))).body).toMatchObject({ runningStep: null });
    const retaken = await begin(run.id, "check");
    expect(retaken.status).toBe(200);
    expect((retaken.body as SetupRun).runningStep).toBe("check");
  });

  it("hai lần begin cùng lúc chỉ một lần được", async () => {
    const run = await create();
    const results = await Promise.all([begin(run.id, "inspect"), begin(run.id, "project")]);
    expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
  });

  it("finish failed đánh dấu run thất bại với lỗi đã làm sạch; chạy tiếp được", async () => {
    const run = await create();
    await begin(run.id, "checkouts");
    const failed = await finish(run.id, "checkouts", { status: "failed", error: `git lỗi \x1b[31m${awsKey}` });
    expect(failed.status).toBe(200);
    const body = failed.body as SetupRun;
    expect(body.status).toBe("failed");
    expect(body.steps.checkouts?.status).toBe("failed");
    expect(body.steps.checkouts?.error).toBe("git lỗi [ĐÃ CHE]");
    expect(JSON.stringify(await row(run.id))).not.toContain("AKIA");

    const resumed = await begin(run.id, "checkouts");
    expect(resumed.status).toBe(200);
    expect((resumed.body as SetupRun).status).toBe("running");
  });

  it("bước project ghi projectId; bước check done kết thúc run", async () => {
    const run = await create();
    await begin(run.id, "project");
    expect((await finish(run.id, "project", { status: "done", projectId })).body).toMatchObject({ projectId, status: "running" });
    await begin(run.id, "check");
    expect((await finish(run.id, "check", { status: "done" })).body).toMatchObject({ status: "done", runningStep: null });
    expect(await begin(run.id, "check")).toEqual({ status: 409, body: { error: "Lần cài đặt đã xong" } });
    // Once done, the key is free for a new run.
    expect((await call(request("setup.create", { body: createBody() }))).status).toBe(201);
  });

  it("từ chối finish sai, bước lạ, run của company khác", async () => {
    const run = await create();
    expect(await finish(run.id, "agents", { status: "done" })).toEqual({ status: 409, body: { error: "Bước agents không đang chạy" } });
    expect(await begin(run.id, "pin")).toEqual({ status: 400, body: { error: "stepId không hợp lệ" } });
    await begin(run.id, "agents");
    for (const [body, error] of [
      [{ status: "skipped" }, "status phải là done hoặc failed"],
      [{ status: "done", projectId }, "projectId chỉ gửi khi xong bước project"],
      [{ status: "done", error: "x" }, "error chỉ gửi khi status là failed"],
      [{ status: "done", refs: { "bad key": "x" } }, "refs không hợp lệ"],
      [{ status: "done", refs: { ok: 1 } }, "refs không hợp lệ"],
      [{ status: "done", extra: 1 }, "trường extra không được hỗ trợ"],
    ] as const) {
      expect(await finish(run.id, "agents", body)).toEqual({ status: 400, body: { error } });
    }
    expect(await call(request("setup.get", { id: run.id, company: otherCompany })))
      .toEqual({ status: 404, body: { error: "Không tìm thấy lần cài đặt" } });
    expect(await call(request("setup.begin", { id: run.id, stepId: "inspect", body: { companyId: otherCompany }, company: otherCompany })))
      .toEqual({ status: 404, body: { error: "Không tìm thấy lần cài đặt" } });
    expect((await call(request("setup.get", { id: run.id }))).body).toMatchObject({ id: run.id, runningStep: "agents" });
    expect(await call(request("setup.get", { id: "x" }))).toEqual({ status: 400, body: { error: "id phải là uuid" } });
  });

  it("data crew.setupRuns lọc theo kind, status, projectId, mới nhất trước", async () => {
    const a = await create();
    const b = await create({ kind: "add-agent", input: { projectId, slot: "executor", name: "A", model: "claude-sonnet-5" } });
    expect((await call(request("setup.create", { body: createBody({ companyId: otherCompany }), company: otherCompany }))).status).toBe(201);
    await host.sql.unsafe(`UPDATE ${host.ns}.crew_setup_runs SET created_at = now() - interval '1 hour' WHERE id = $1`, [a.id]);
    expect((await loadSetupRuns(host.ctx, { companyId })).map((run) => run.id)).toEqual([b.id, a.id]);
    expect((await loadSetupRuns(host.ctx, { companyId, kind: "add-project" })).map((run) => run.id)).toEqual([a.id]);
    expect((await loadSetupRuns(host.ctx, { companyId, projectId })).map((run) => run.id)).toEqual([b.id]);
    expect(await loadSetupRuns(host.ctx, { companyId, status: "done" })).toEqual([]);
    await expect(loadSetupRuns(host.ctx, { companyId: "x" })).rejects.toThrow();
  });

  it("lỗi database trả câu cố định, không lộ SQL", async () => {
    host.fail.error = new Error(`relation ${host.ns}.crew_setup_runs does not exist`);
    const res = await call(request("setup.create", { body: createBody() }));
    expect(res).toEqual({ status: 500, body: { error: SETUP_ERROR } });
    expect(host.logs.find((log) => log.level === "error")?.meta).toMatchObject({ routeKey: "setup.create" });
  });
});

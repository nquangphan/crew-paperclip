import { copyFile, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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
      : routeKey === "setup.abandon" ? `/setup-runs/${options.id}/abandon`
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
  /** Lock token of the last successful begin per run, sent back by `finish` unless the test overrides it. */
  const tokens = new Map<string, string>();
  const begin = async (id: string, stepId: string) => {
    const res = await call(request("setup.begin", { id, stepId, body: { companyId } }));
    if (res.status === 200) tokens.set(id, (res.body as { lockToken: string }).lockToken);
    return res;
  };
  const finish = (id: string, stepId: string, body: Record<string, unknown>) =>
    call(request("setup.finish", { id, stepId, body: { companyId, lockToken: tokens.get(id), ...body } }));
  const abandon = (id: string) => call(request("setup.abandon", { id, body: { companyId } }));
  const ageLock = (id: string, minutes: number) => host.sql.unsafe(
    `UPDATE ${host.ns}.crew_setup_runs SET running_since = now() - make_interval(mins => ${minutes}) WHERE id = $1`, [id]);
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

  it("mỗi run chỉ một bước chạy một lúc; finish nhả khóa; khóa quá 15 phút coi như chết", async () => {
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

    await ageLock(run.id, 16);
    expect((await call(request("setup.get", { id: run.id }))).body).toMatchObject({ runningStep: null });
    const retaken = await begin(run.id, "check");
    expect(retaken.status).toBe(200);
    expect((retaken.body as SetupRun).runningStep).toBe("check");
  });

  it("khóa bước sống lâu hơn hạn một việc trên máy (10 phút)", async () => {
    const run = await create();
    expect((await begin(run.id, "check")).status).toBe(200);
    await ageLock(run.id, 11);
    expect((await call(request("setup.get", { id: run.id }))).body).toMatchObject({ runningStep: "check" });
    expect(await begin(run.id, "check")).toEqual({ status: 409, body: { error: "Bước check đang chạy" } });
  });

  it("begin trả mã chủ khóa; finish phải gửi đúng mã, tab cũ không kết thúc được bước tab mới đã nhận", async () => {
    const run = await create();
    const first = await begin(run.id, "check");
    const firstToken = (first.body as { lockToken: string }).lockToken;
    expect(firstToken).toMatch(/^[0-9a-f-]{36}$/);
    expect((await call(request("setup.get", { id: run.id }))).body).not.toHaveProperty("lockToken");
    expect(JSON.stringify(await loadSetupRuns(host.ctx, { companyId }))).not.toContain(firstToken);

    expect(await finish(run.id, "check", { status: "done", lockToken: undefined }))
      .toEqual({ status: 400, body: { error: "lockToken phải là uuid" } });
    expect(await finish(run.id, "check", { status: "done", lockToken: "70000000-0000-4000-8000-000000000001" }))
      .toEqual({ status: 409, body: { error: "Bước check không đang chạy" } });

    // Tab 1 waits past the lock window; tab 2 resumes and takes the step over.
    await ageLock(run.id, 16);
    const second = await begin(run.id, "check");
    expect(second.status).toBe(200);
    expect((second.body as { lockToken: string }).lockToken).not.toBe(firstToken);
    expect(await finish(run.id, "check", { status: "failed", error: "x", lockToken: firstToken }))
      .toEqual({ status: 409, body: { error: "Bước check không đang chạy" } });
    expect(await finish(run.id, "check", { status: "done", lockToken: firstToken }))
      .toEqual({ status: 409, body: { error: "Bước check không đang chạy" } });
    expect((await finish(run.id, "check", { status: "done" })).body).toMatchObject({ status: "done" });
  });

  it("finish đúng mã vẫn nhận khi khóa đã quá hạn nhưng chưa ai nhận lại", async () => {
    const run = await create();
    await begin(run.id, "inspect");
    await ageLock(run.id, 30);
    expect((await finish(run.id, "inspect", { status: "done" })).status).toBe(200);
  });

  it("bỏ lần thêm project hỏng chưa có project thì nhả khóa project, không xóa gì", async () => {
    const run = await create();
    await begin(run.id, "inspect");
    expect(await abandon(run.id)).toEqual({ status: 409, body: { error: "Bước inspect đang chạy" } });
    await finish(run.id, "inspect", { status: "failed", error: "Folder không phải git" });

    const res = await abandon(run.id);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: run.id, status: "abandoned", projectKey: "demo", runningStep: null, input: projectInput });
    expect((res.body as SetupRun).steps.inspect).toMatchObject({ status: "failed", error: "Folder không phải git" });
    expect(host.logs.find((log) => log.message === "crew setup run abandoned")?.meta).toMatchObject({ setupRunId: run.id, actorUserId: userId });

    expect(await abandon(run.id)).toEqual({ status: 409, body: { error: "Lần cài đặt đã bỏ" } });
    expect(await begin(run.id, "inspect")).toEqual({ status: 409, body: { error: "Lần cài đặt đã bỏ" } });
    expect((await loadSetupRuns(host.ctx, { companyId, status: "abandoned" })).map((item) => item.id)).toEqual([run.id]);
    const again = await create();
    expect(again.id).not.toBe(run.id);
    expect(await host.sql.unsafe(`SELECT id FROM ${host.ns}.crew_setup_runs`)).toHaveLength(2);
  });

  it("bỏ được run đang chạy mà khóa đã chết; từ chối run có project, run xong, run add-agent, agent, company khác", async () => {
    const stale = await create();
    await begin(stale.id, "inspect");
    await ageLock(stale.id, 16);
    expect((await abandon(stale.id)).body).toMatchObject({ status: "abandoned" });

    const withProject = await create();
    await begin(withProject.id, "project");
    await finish(withProject.id, "project", { status: "done", projectId });
    await begin(withProject.id, "checkouts");
    await finish(withProject.id, "checkouts", { status: "failed", error: "x" });
    expect(await abandon(withProject.id)).toEqual({ status: 409, body: { error: "Lần cài đặt đã tạo project, không bỏ được" } });
    await begin(withProject.id, "check");
    await finish(withProject.id, "check", { status: "done" });
    expect(await abandon(withProject.id)).toEqual({ status: 409, body: { error: "Lần cài đặt đã xong" } });

    const agentRun = await create({ kind: "add-agent", input: { projectId, slot: "executor", name: "A", model: "claude-sonnet-5" } });
    expect(await abandon(agentRun.id)).toEqual({ status: 409, body: { error: "Chỉ bỏ được lần thêm project" } });

    const other = await create({ projectKey: "demo-3", input: { ...projectInput, key: "demo-3" } });
    expect(await call(request("setup.abandon", { id: other.id, body: { companyId }, actor: agent })))
      .toEqual({ status: 403, body: { error: "Chỉ board được dùng tiến độ cài đặt" } });
    expect(await call(request("setup.abandon", { id: other.id, body: { companyId: otherCompany }, company: otherCompany })))
      .toEqual({ status: 404, body: { error: "Không tìm thấy lần cài đặt" } });
    expect(await call(request("setup.abandon", { id: other.id, body: { companyId, extra: 1 } })))
      .toEqual({ status: 400, body: { error: "trường extra không được hỗ trợ" } });
    expect(await call(request("setup.abandon", { id: "x", body: { companyId } }))).toEqual({ status: 400, body: { error: "id phải là uuid" } });
    expect((await row(other.id)).status).toBe("running");
  });

  it("run add-agent phải dùng đúng khóa của project", async () => {
    const otherProject = "30000000-0000-4000-8000-000000000002";
    const run = await create();
    await begin(run.id, "project");
    await finish(run.id, "project", { status: "done", projectId });
    const agentBody = (projectKey: string, project = projectId) =>
      createBody({ kind: "add-agent", projectKey, input: { projectId: project, slot: "executor-2", name: "Thợ 2", model: "claude-sonnet-5" } });

    expect(await call(request("setup.create", { body: agentBody("demo-b") })))
      .toEqual({ status: 400, body: { error: "projectKey không khớp project" } });
    expect(await call(request("setup.create", { body: agentBody("demo", otherProject) })))
      .toEqual({ status: 400, body: { error: "Khóa project đã thuộc project khác" } });
    expect((await call(request("setup.create", { body: agentBody("demo") }))).status).toBe(201);
    // A project the app created has no add-project run: any free key is accepted.
    expect((await call(request("setup.create", { body: agentBody("app-made", otherProject) }))).status).toBe(201);
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
    expect(await finish(run.id, "agents", { status: "done", lockToken: "70000000-0000-4000-8000-000000000002" }))
      .toEqual({ status: 409, body: { error: "Bước agents không đang chạy" } });
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

  const agentId = "40000000-0000-4000-8000-0000000000ab";
  const removeProjectBody = (overrides: Record<string, unknown> = {}) => createBody({
    kind: "remove-project", projectKey: "demo", input: { projectId, projectName: "Demo" }, ...overrides,
  });
  const removeAgentBody = (input: Record<string, unknown>, projectKey: string) => createBody({
    kind: "remove-agent", projectKey, input: { agentId, agentName: "Thợ 2", ...input },
  });

  it("tạo run remove-project gắn projectId; 409 kèm id khi đã có run gỡ dở cùng project", async () => {
    const run = await create({ kind: "remove-project", input: { projectId, projectName: "Demo" } });
    expect(run).toMatchObject({ kind: "remove-project", projectKey: "demo", projectId, input: { projectId, projectName: "Demo" }, status: "running" });
    expect(await call(request("setup.create", { body: removeProjectBody() })))
      .toEqual({ status: 409, body: { error: "Đang có lần gỡ project dở", setupRunId: run.id } });
    // A failed removal is resumed with "Chạy tiếp", not replaced.
    await begin(run.id, "checkouts");
    await finish(run.id, "checkouts", { status: "failed", error: "x" });
    expect((await call(request("setup.create", { body: removeProjectBody() }))).status).toBe(409);
    // An add-project run on the same key does not block the removal, nor the other way round.
    expect((await call(request("setup.create", { body: createBody() }))).status).toBe(201);
    // Another project, another company: no conflict.
    const other = "30000000-0000-4000-8000-000000000002";
    expect((await call(request("setup.create", { body: removeProjectBody({ projectKey: "other", input: { projectId: other, projectName: "B" } }) }))).status).toBe(201);
    expect((await call(request("setup.create", { body: removeProjectBody({ companyId: otherCompany }), company: otherCompany }))).status).toBe(201);
    // Removal cannot be abandoned.
    expect((await abandon(run.id)).status).toBe(409);
  });

  it("hai tab tạo run gỡ cùng lúc chỉ một run được tạo", async () => {
    const results = await Promise.all([call(request("setup.create", { body: removeProjectBody() })), call(request("setup.create", { body: removeProjectBody() }))]);
    expect(results.map((res) => res.status).sort()).toEqual([201, 409]);
    const agentResults = await Promise.all([1, 2].map(() => call(request("setup.create", { body: removeAgentBody({ projectId: null, role: null }, "agent-40000000") }))));
    expect(agentResults.map((res) => res.status).sort()).toEqual([201, 409]);
  });

  it("remove-project đi đủ bước theo thứ tự, bước project done kết thúc run, không nhận projectId", async () => {
    const run = await create({ kind: "remove-project", input: { projectId, projectName: "Demo" } });
    for (const step of ["pause-agents", "roles", "environments", "checkouts"]) {
      await begin(run.id, step);
      expect((await finish(run.id, step, { status: "done", refs: { [`${step}_1`]: "x" } })).body).toMatchObject({ status: "running" });
    }
    expect(await begin(run.id, "inspect")).toEqual({ status: 400, body: { error: "stepId không hợp lệ" } });
    await begin(run.id, "project");
    expect(await finish(run.id, "project", { status: "done", projectId })).toEqual({ status: 400, body: { error: "projectId chỉ gửi khi xong bước project" } });
    const done = (await finish(run.id, "project", { status: "done" })).body as SetupRun;
    expect(done).toMatchObject({ status: "done", projectId });
    expect(Object.keys(done.steps)).toEqual(expect.arrayContaining(["pause-agents", "roles", "environments", "checkouts", "project"]));
    // Once done, the project can be removed again (e.g. after an owner restored it).
    expect((await call(request("setup.create", { body: removeProjectBody() }))).status).toBe(201);
  });

  it("remove-agent có vai trò: dùng khóa project, bước cuối checkout; 409 khi agent đang có run gỡ dở", async () => {
    const run = await create({ kind: "remove-agent", projectKey: "demo", input: { agentId, agentName: "Thợ 2", projectId, role: "executor-2" } });
    expect(run).toMatchObject({ kind: "remove-agent", projectKey: "demo", projectId, input: { agentId, agentName: "Thợ 2", projectId, role: "executor-2" } });
    expect(await call(request("setup.create", { body: removeAgentBody({ projectId, role: "executor-2" }, "demo") })))
      .toEqual({ status: 409, body: { error: "Đang có lần gỡ agent dở", setupRunId: run.id } });
    expect(await begin(run.id, "pause-agents")).toEqual({ status: 400, body: { error: "stepId không hợp lệ" } });
    for (const step of ["roles", "pause-agent", "environment"]) {
      await begin(run.id, step);
      expect((await finish(run.id, step, { status: "done" })).body).toMatchObject({ status: "running" });
    }
    await begin(run.id, "checkout");
    expect((await finish(run.id, "checkout", { status: "done" })).body).toMatchObject({ status: "done" });
  });

  it("remove-agent không vai trò: khóa agent-<8 hex>, chỉ pause-agent và environment", async () => {
    const run = await create({ kind: "remove-agent", projectKey: "agent-40000000", input: { agentId, agentName: "Lẻ", projectId: null, role: null } });
    expect(run).toMatchObject({ projectKey: "agent-40000000", projectId: null });
    expect(await begin(run.id, "roles")).toEqual({ status: 400, body: { error: "stepId không hợp lệ" } });
    expect(await begin(run.id, "checkout")).toEqual({ status: 400, body: { error: "stepId không hợp lệ" } });
    await begin(run.id, "pause-agent");
    await finish(run.id, "pause-agent", { status: "done" });
    await begin(run.id, "environment");
    expect((await finish(run.id, "environment", { status: "done" })).body).toMatchObject({ status: "done" });
  });

  it("từ chối run gỡ có input sai hoặc khóa không khớp", async () => {
    const project = await create();
    await begin(project.id, "project");
    await finish(project.id, "project", { status: "done", projectId });
    for (const [body, error] of [
      [removeProjectBody({ input: { projectId: "x", projectName: "Demo" } }), "projectId phải là uuid"],
      [removeProjectBody({ input: { projectId, projectName: "" } }), "projectName không hợp lệ"],
      [removeProjectBody({ input: { projectId, projectName: "Demo", extra: 1 } }), "trường extra không được hỗ trợ"],
      [removeProjectBody({ projectKey: "demo-b" }), "projectKey không khớp project"],
      [removeAgentBody({ agentId: "x", projectId: null, role: null }, "agent-40000000"), "agentId phải là uuid"],
      [removeAgentBody({ agentName: " ", projectId: null, role: null }, "agent-40000000"), "agentName không hợp lệ"],
      [removeAgentBody({ projectId: null, role: null }, "agent-40000001"), "projectKey phải là agent-40000000"],
      [removeAgentBody({ projectId, role: null }, "demo"), "projectId và role phải cùng có hoặc cùng không"],
      [removeAgentBody({ projectId: null, role: "executor" }, "demo"), "projectId và role phải cùng có hoặc cùng không"],
      [removeAgentBody({ projectId, role: "boss" }, "demo"), "role không hợp lệ"],
      [removeAgentBody({ projectId: "x", role: "executor" }, "demo"), "projectId phải là uuid"],
      [removeAgentBody({ projectId, role: "executor" }, "demo-b"), "projectKey không khớp project"],
      [removeAgentBody({ projectId: null }, "agent-40000000"), "projectId và role phải cùng có hoặc cùng không"],
    ] as const) {
      expect(await call(request("setup.create", { body }))).toEqual({ status: 400, body: { error } });
    }
    expect(await call(request("setup.create", { body: removeProjectBody(), actor: agent })))
      .toEqual({ status: 403, body: { error: "Chỉ board được dùng tiến độ cài đặt" } });
  });

  it("data crew.setupRuns lọc được theo kind gỡ", async () => {
    const run = await create({ kind: "remove-agent", projectKey: "agent-40000000", input: { agentId, agentName: "Lẻ", projectId: null, role: null } });
    await create();
    expect((await loadSetupRuns(host.ctx, { companyId, kind: "remove-agent" })).map((item) => item.id)).toEqual([run.id]);
    expect(await loadSetupRuns(host.ctx, { companyId, kind: "remove-project" })).toEqual([]);
  });

  it("lỗi database trả câu cố định, không lộ SQL", async () => {
    host.fail.error = new Error(`relation ${host.ns}.crew_setup_runs does not exist`);
    const res = await call(request("setup.create", { body: createBody() }));
    expect(res).toEqual({ status: 500, body: { error: SETUP_ERROR } });
    expect(host.logs.find((log) => log.level === "error")?.meta).toMatchObject({ routeKey: "setup.create" });
  });
});

describe("migration thêm kind gỡ trên database đã có các migration trước", () => {
  it("giữ dữ liệu cũ, tên constraint đúng, nhận kind mới và vẫn chặn kind lạ", async () => {
    const packageRoot = fileURLToPath(new URL("../..", import.meta.url));
    const root = await mkdtemp(join(tmpdir(), "crew-removal-kinds-"));
    let host: PluginHost | undefined;
    try {
      await mkdir(join(root, "migrations"));
      const files = (await readdir(join(packageRoot, "migrations"))).filter((file) => file.endsWith(".sql")).sort();
      const removal = files.find((file) => file.startsWith("0011_"));
      expect(removal).toBe("0011_removal_kinds.sql");
      for (const file of files.filter((name) => name < "0011_")) await copyFile(join(packageRoot, "migrations", file), join(root, "migrations", file));
      host = await startPluginHost("crew-removal-kinds-", root);
      const { sql, ns } = host;
      const constraints = async () => (await sql.unsafe(`SELECT c.conrelid::regclass::text AS tbl, c.conname, pg_get_constraintdef(c.oid) AS def
        FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE n.nspname = $1 AND c.contype = 'c' AND c.conname LIKE '%kind_check' ORDER BY c.conname`, [ns]))
        .map((row) => ({ name: row.conname as string, def: row.def as string }));
      expect((await constraints()).map((row) => row.name)).toEqual(["crew_machine_jobs_kind_check", "crew_setup_runs_kind_check"]);
      await sql.unsafe(`INSERT INTO ${ns}.crew_machine_jobs (company_id,machine_id,kind,payload,created_by_user_id)
        VALUES ($1,$2,'skill-sync',$3::text::jsonb,'u')`, [companyId, machineId, JSON.stringify({ kind: "skill-sync" })]);
      await sql.unsafe(`INSERT INTO ${ns}.crew_setup_runs (company_id,kind,project_key,machine_id,input,created_by_user_id)
        VALUES ($1,'add-project','demo',$2,'{}'::jsonb,'u')`, [companyId, machineId]);

      await copyFile(join(packageRoot, "migrations", removal!), join(root, "migrations", removal!));
      await host.applyMigrations(root);
      const defs = await constraints();
      expect(defs.map((row) => row.name)).toEqual(["crew_machine_jobs_kind_check", "crew_setup_runs_kind_check"]);
      expect(defs[0]!.def).toContain("remove-checkouts");
      expect(defs[0]!.def).toContain("skill-remove");
      expect(defs[1]!.def).toContain("remove-project");
      expect(defs[1]!.def).toContain("remove-agent");
      expect(await sql.unsafe(`SELECT kind FROM ${ns}.crew_machine_jobs`)).toEqual([{ kind: "skill-sync" }]);
      expect(await sql.unsafe(`SELECT kind, project_key FROM ${ns}.crew_setup_runs`)).toEqual([{ kind: "add-project", project_key: "demo" }]);
      for (const kind of ["remove-checkouts", "skill-remove"]) {
        await sql.unsafe(`INSERT INTO ${ns}.crew_machine_jobs (company_id,machine_id,kind,payload,created_by_user_id)
          VALUES ($1,$2,$3,'{}'::jsonb,'u')`, [companyId, machineId, kind]);
      }
      for (const kind of ["remove-project", "remove-agent"]) {
        await sql.unsafe(`INSERT INTO ${ns}.crew_setup_runs (company_id,kind,project_key,machine_id,input,created_by_user_id)
          VALUES ($1,$2,'demo',$3,'{}'::jsonb,'u')`, [companyId, kind, machineId]);
      }
      await expect(sql.unsafe(`INSERT INTO ${ns}.crew_machine_jobs (company_id,machine_id,kind,payload,created_by_user_id)
        VALUES ($1,$2,'reboot','{}'::jsonb,'u')`, [companyId, machineId])).rejects.toThrow(/kind_check/);
      await expect(sql.unsafe(`INSERT INTO ${ns}.crew_setup_runs (company_id,kind,project_key,machine_id,input,created_by_user_id)
        VALUES ($1,'remove-skill','demo',$2,'{}'::jsonb,'u')`, [companyId, machineId])).rejects.toThrow(/kind_check/);
    } finally {
      await host?.cleanup();
      await rm(root, { recursive: true, force: true });
    }
  }, 180_000);
});

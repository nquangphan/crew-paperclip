import type { PluginApiRequestInput, PluginApiResponse, PluginContext } from "@paperclipai/plugin-sdk";
import { UUID } from "../shared/db.js";
import { sanitizeJobError } from "../jobs/sanitize.js";
import { CREW_ROLE_SLOTS, type CrewRoleSlot } from "../jobs/types.js";
import { folderError, unknownKeyError } from "../jobs/validate.js";
import { activeProjectRun, beginStep, finishStep, getSetupRun, insertSetupRun } from "./data.js";
import {
  type AddAgentInput, type AddProjectInput, SETUP_RUN_KINDS, SETUP_STEPS, type SetupRun, type SetupRunKind, type SetupStepId, type SetupStepState,
} from "./types.js";

type Ctx = Pick<PluginContext, "db" | "logger">;
const SETUP_ERROR = "Không đọc/ghi được tiến độ cài đặt";
const ROUTE_KEYS = ["setup.create", "setup.begin", "setup.finish", "setup.get"];
/** Same rule as the app's project key and the machine job payloads. */
const PROJECT_KEY = /^[a-z][a-z0-9-]{1,30}$/;
const MODEL = /^[A-Za-z0-9._:/[\]-]{1,100}$/;
const REF_KEY = /^[A-Za-z0-9_.-]{1,64}$/;
const MAX_REFS = 50;
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are exactly what is rejected
const CONTROL = /[\x00-\x1f\x7f]/;

const bad = (error: string): PluginApiResponse => ({ status: 400, body: { error } });
const conflict = (error: string): PluginApiResponse => ({ status: 409, body: { error } });
/** An unfinished add-project run already holds the key; the wizard offers to resume it. */
const busy = (setupRunId: string): PluginApiResponse =>
  ({ status: 409, body: { error: "Đang có lần thêm project dở cho khóa này", setupRunId } });
const NOT_FOUND: PluginApiResponse = { status: 404, body: { error: "Không tìm thấy lần cài đặt" } };
const uuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);
const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max && !CONTROL.test(value);

function parseBody(input: PluginApiRequestInput, keys: readonly string[], company: string): Record<string, unknown> | string {
  if (!isObject(input.body)) return "body phải là object";
  const unknown = unknownKeyError(input.body, keys);
  if (unknown) return unknown;
  if (!uuid(input.body.companyId) || input.body.companyId.toLowerCase() !== company) return "companyId không hợp lệ";
  return input.body;
}

function parseInput(kind: SetupRunKind, projectKey: string, input: unknown): AddProjectInput | AddAgentInput | string {
  if (!isObject(input)) return "input phải là object";
  if (kind === "add-project") {
    const unknown = unknownKeyError(input, ["name", "key", "folder", "executors"]);
    if (unknown) return unknown;
    if (!text(input.name, 200)) return "name không hợp lệ";
    if (input.key !== projectKey) return "input.key phải trùng projectKey";
    const folder = folderError(input.folder);
    if (folder) return folder;
    if (input.executors !== 1 && input.executors !== 2) return "executors phải là 1 hoặc 2";
    return { name: input.name, key: projectKey, folder: input.folder as string, executors: input.executors };
  }
  const unknown = unknownKeyError(input, ["projectId", "slot", "name", "model"]);
  if (unknown) return unknown;
  if (!uuid(input.projectId)) return "projectId phải là uuid";
  if (!CREW_ROLE_SLOTS.includes(input.slot as CrewRoleSlot)) return "slot không hợp lệ";
  if (!text(input.name, 200)) return "name không hợp lệ";
  if (typeof input.model !== "string" || !MODEL.test(input.model)) return "model không hợp lệ";
  return { projectId: input.projectId.toLowerCase(), slot: input.slot as CrewRoleSlot, name: input.name, model: input.model };
}

function parseRefs(refs: unknown): Record<string, string> | string {
  if (!isObject(refs)) return "refs không hợp lệ";
  const entries = Object.entries(refs);
  if (entries.length > MAX_REFS || !entries.every(([key, value]) => REF_KEY.test(key) && text(value, 200))) return "refs không hợp lệ";
  return Object.fromEntries(entries) as Record<string, string>;
}

/**
 * Scoped API for wizard progress. Board only: the host already enforced board auth and company access, the actor
 * check stays here so an agent can never drive a wizard. Database failures reach the caller as a fixed sentence.
 */
export async function handleSetupApi(ctx: Ctx, input: PluginApiRequestInput): Promise<PluginApiResponse> {
  try {
    return await routeSetupApi(ctx, input);
  } catch (error) {
    ctx.logger.error("crew setup run request failed", {
      routeKey: input.routeKey, companyId: input.companyId, setupRunId: input.params.id,
      err: error instanceof Error ? error.message : String(error),
    });
    return { status: 500, body: { error: SETUP_ERROR } };
  }
}

async function routeSetupApi(ctx: Ctx, input: PluginApiRequestInput): Promise<PluginApiResponse> {
  if (!ROUTE_KEYS.includes(input.routeKey)) return { status: 404, body: { error: "Route không tồn tại" } };
  if (input.actor.actorType !== "user") return { status: 403, body: { error: "Chỉ board được dùng tiến độ cài đặt" } };
  if (!uuid(input.companyId)) return bad("companyId phải là uuid");
  const company = input.companyId.toLowerCase();
  const now = new Date();
  if (input.routeKey === "setup.create") return createRoute(ctx, input, company);

  if (!uuid(input.params.id)) return bad("id phải là uuid");
  const id = input.params.id.toLowerCase();
  if (input.routeKey === "setup.get") {
    const run = await getSetupRun(ctx, company, id, now);
    return run ? { status: 200, body: run } : NOT_FOUND;
  }

  const body = parseBody(input, input.routeKey === "setup.begin" ? ["companyId"] : ["companyId", "status", "refs", "error", "projectId"], company);
  if (typeof body === "string") return bad(body);
  const run = await getSetupRun(ctx, company, id, now);
  if (!run) return NOT_FOUND;
  const steps: readonly string[] = SETUP_STEPS[run.kind];
  const stepId = input.params.stepId;
  if (!steps.includes(stepId)) return bad("stepId không hợp lệ");
  const step = stepId as SetupStepId;

  if (input.routeKey === "setup.begin") {
    if (run.status === "done") return conflict("Lần cài đặt đã xong");
    if (!await beginStep(ctx, company, id, step, now)) {
      const current = await getSetupRun(ctx, company, id, now);
      if (current?.status === "done") return conflict("Lần cài đặt đã xong");
      return conflict(`Bước ${current?.runningStep ?? step} đang chạy`);
    }
    return { status: 200, body: await getSetupRun(ctx, company, id, now) };
  }

  const state: SetupStepState = { status: "done", at: now.toISOString() };
  if (body.status === "failed") {
    state.status = "failed";
    if (body.error !== undefined && body.error !== null) {
      if (typeof body.error !== "string") return bad("error phải là chuỗi");
      const clean = sanitizeJobError(body.error);
      if (clean !== "") state.error = clean;
    }
  } else if (body.status !== "done") {
    return bad("status phải là done hoặc failed");
  } else if (body.error !== undefined) {
    return bad("error chỉ gửi khi status là failed");
  }
  if (body.refs !== undefined) {
    const refs = parseRefs(body.refs);
    if (typeof refs === "string") return bad(refs);
    state.refs = refs;
  }
  let projectId: string | null = null;
  if (body.projectId !== undefined) {
    if (step !== "project" || state.status !== "done") return bad("projectId chỉ gửi khi xong bước project");
    if (!uuid(body.projectId)) return bad("projectId phải là uuid");
    projectId = body.projectId.toLowerCase();
  }
  const last = steps[steps.length - 1] === step;
  if (!await finishStep(ctx, company, id, step, { state, projectId, last }, now)) return conflict(`Bước ${step} không đang chạy`);
  ctx.logger.info("crew setup step finished", { setupRunId: id, companyId: company, stepId: step, status: state.status });
  return { status: 200, body: await getSetupRun(ctx, company, id, now) };
}

async function createRoute(ctx: Ctx, input: PluginApiRequestInput, company: string): Promise<PluginApiResponse> {
  const body = parseBody(input, ["companyId", "kind", "projectKey", "machineId", "input"], company);
  if (typeof body === "string") return bad(body);
  if (!SETUP_RUN_KINDS.includes(body.kind as SetupRunKind)) return bad("kind không hợp lệ");
  const kind = body.kind as SetupRunKind;
  if (typeof body.projectKey !== "string" || !PROJECT_KEY.test(body.projectKey)) return bad("projectKey không hợp lệ");
  const projectKey = body.projectKey;
  if (!uuid(body.machineId)) return bad("machineId phải là uuid");
  const parsed = parseInput(kind, projectKey, body.input);
  if (typeof parsed === "string") return bad(parsed);

  if (kind === "add-project") {
    const active = await activeProjectRun(ctx, company, projectKey);
    if (active) return busy(active);
  }
  const createdByUserId = input.actor.userId ?? input.actor.actorId;
  let run: SetupRun;
  try {
    run = await insertSetupRun(ctx, {
      companyId: company, kind, projectKey, projectId: kind === "add-agent" ? (parsed as AddAgentInput).projectId : null,
      machineId: body.machineId.toLowerCase(), input: parsed, createdByUserId,
    });
  } catch (error) {
    // Two tabs racing past the check: the partial unique index lets one insert win; report the winner.
    const active = kind === "add-project" ? await activeProjectRun(ctx, company, projectKey) : null;
    if (!active) throw error;
    return busy(active);
  }
  ctx.logger.info("crew setup run created", { setupRunId: run.id, kind, projectKey, companyId: company, actorUserId: createdByUserId });
  return { status: 201, body: run };
}

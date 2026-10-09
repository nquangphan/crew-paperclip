import type { PluginApiRequestInput, PluginApiResponse, PluginContext } from "@paperclipai/plugin-sdk";
import { UUID } from "../shared/db.js";
import { cancelJob, claimNextJob, finishJob, getJob, insertJob, type JobOutcome, listJobs, retryJob } from "./data.js";
import { sanitizeJobError } from "./sanitize.js";
import { JOB_ERROR_CODES, type JobErrorCode, type JobResult, MACHINE_JOB_STATUSES, type MachineJobKind, type MachineJobStatus } from "./types.js";
import { unknownKeyError, validateJobPayload } from "./validate.js";

type Ctx = Pick<PluginContext, "db" | "logger">;
const JOBS_ERROR = "Không đọc/ghi được việc trên máy";
const ROUTE_KEYS = ["jobs.create", "jobs.list", "jobs.claim", "jobs.result", "jobs.retry", "jobs.cancel"];
const RESULT_MAX_BYTES = 65_536;

const bad = (error: string): PluginApiResponse => ({ status: 400, body: { error } });
const conflict = (error: string): PluginApiResponse => ({ status: 409, body: { error } });
const NOT_FOUND: PluginApiResponse = { status: 404, body: { error: "Không tìm thấy việc" } };
const uuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);
const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** Body object with only the allowed keys and the company the host resolved; or the error sentence. */
function parseBody(input: PluginApiRequestInput, keys: readonly string[]): Record<string, unknown> | string {
  if (!isObject(input.body)) return "body phải là object";
  const unknown = unknownKeyError(input.body, keys);
  if (unknown) return unknown;
  if (!uuid(input.body.companyId) || input.body.companyId.toLowerCase() !== input.companyId.toLowerCase()) return "companyId không hợp lệ";
  return input.body;
}

/**
 * Scoped API for the machine job queue. The board queues work from the web; the 2P Crew app on the Mac uses a
 * board key to claim it and report back. The host already enforced board auth and company access; the actor check
 * stays here so an agent can never queue work on a machine. Database failures reach the caller as a fixed sentence,
 * the detail goes to the server log only.
 */
export async function handleJobsApi(ctx: Ctx, input: PluginApiRequestInput): Promise<PluginApiResponse> {
  try {
    return await routeJobsApi(ctx, input);
  } catch (error) {
    ctx.logger.error("crew machine jobs request failed", {
      routeKey: input.routeKey, companyId: input.companyId, jobId: input.params.jobId,
      err: error instanceof Error ? error.message : String(error),
    });
    return { status: 500, body: { error: JOBS_ERROR } };
  }
}

async function routeJobsApi(ctx: Ctx, input: PluginApiRequestInput): Promise<PluginApiResponse> {
  if (!ROUTE_KEYS.includes(input.routeKey)) return { status: 404, body: { error: "Route không tồn tại" } };
  if (input.actor.actorType !== "user") return { status: 403, body: { error: "Chỉ board được dùng hàng đợi việc trên máy" } };
  if (!uuid(input.companyId)) return bad("companyId phải là uuid");
  const company = input.companyId.toLowerCase();
  const now = new Date();

  switch (input.routeKey) {
    case "jobs.list": return listRoute(ctx, input, company);
    case "jobs.create": return createRoute(ctx, input, company);
    case "jobs.claim": {
      const body = parseBody(input, ["companyId", "machineId"]);
      if (typeof body === "string") return bad(body);
      if (!uuid(body.machineId)) return bad("machineId phải là uuid");
      const job = await claimNextJob(ctx, company, body.machineId.toLowerCase(), now);
      return job ? { status: 200, body: job } : { status: 204 };
    }
  }

  const jobId = input.params.jobId;
  if (!uuid(jobId)) return bad("jobId phải là uuid");
  const id = jobId.toLowerCase();
  if (input.routeKey === "jobs.result") return resultRoute(ctx, input, company, id, now);
  const body = parseBody(input, ["companyId"]);
  if (typeof body === "string") return bad(body);
  if (!await getJob(ctx, company, id)) return NOT_FOUND;
  if (input.routeKey === "jobs.retry") {
    if (!await retryJob(ctx, company, id)) return conflict("Chỉ thử lại được việc đã thất bại");
  } else if (!await cancelJob(ctx, company, id, now)) {
    return conflict("Chỉ hủy được việc đang chờ hoặc đang nhận");
  }
  ctx.logger.info("crew machine job changed", { action: input.routeKey, jobId: id, companyId: company, actorUserId: actorUser(input) });
  return { status: 200, body: await getJob(ctx, company, id) };
}

const actorUser = (input: PluginApiRequestInput) => input.actor.userId ?? input.actor.actorId;

async function listRoute(ctx: Ctx, input: PluginApiRequestInput, company: string): Promise<PluginApiResponse> {
  const param = (key: string): string | undefined | null => {
    const value = input.query[key];
    if (value === undefined || value === "") return undefined;
    return typeof value === "string" ? value : null;
  };
  const machineId = param("machineId");
  const setupRunId = param("setupRunId");
  const status = param("status");
  const limit = param("limit");
  if (machineId !== undefined && !uuid(machineId)) return bad("machineId phải là uuid");
  if (setupRunId !== undefined && !uuid(setupRunId)) return bad("setupRunId phải là uuid");
  if (status !== undefined && !MACHINE_JOB_STATUSES.includes(status as MachineJobStatus)) return bad("status không hợp lệ");
  if (limit !== undefined && (limit === null || !/^\d+$/.test(limit) || Number(limit) < 1)) return bad("limit phải là số nguyên dương");
  return {
    status: 200,
    body: await listJobs(ctx, company, {
      machineId: machineId?.toLowerCase(), setupRunId: setupRunId?.toLowerCase(),
      status: status as MachineJobStatus | undefined, limit: limit === undefined ? undefined : Number(limit),
    }),
  };
}

async function createRoute(ctx: Ctx, input: PluginApiRequestInput, company: string): Promise<PluginApiResponse> {
  const body = parseBody(input, ["companyId", "machineId", "kind", "payload", "setupRunId"]);
  if (typeof body === "string") return bad(body);
  if (!uuid(body.machineId)) return bad("machineId phải là uuid");
  const setupRunId = body.setupRunId ?? null;
  if (setupRunId !== null && !uuid(setupRunId)) return bad("setupRunId phải là uuid");
  const payload = validateJobPayload(body.kind as MachineJobKind, body.payload);
  if (typeof payload === "string") return bad(payload);
  const job = await insertJob(ctx, {
    companyId: company, machineId: body.machineId.toLowerCase(), payload,
    setupRunId: setupRunId?.toLowerCase() ?? null, createdByUserId: actorUser(input),
  });
  ctx.logger.info("crew machine job queued", { jobId: job.id, kind: job.kind, machineId: job.machineId, companyId: company, actorUserId: actorUser(input) });
  return { status: 201, body: job };
}

async function resultRoute(
  ctx: Ctx, input: PluginApiRequestInput, company: string, id: string, now: Date,
): Promise<PluginApiResponse> {
  const body = parseBody(input, ["companyId", "machineId", "status", "result", "errorCode", "errorText"]);
  if (typeof body === "string") return bad(body);
  if (!uuid(body.machineId)) return bad("machineId phải là uuid");
  const machineId = body.machineId.toLowerCase();
  let outcome: JobOutcome;
  if (body.status === "done") {
    if (body.errorCode !== undefined || body.errorText !== undefined) return bad("errorCode chỉ gửi khi status là failed");
    if (!isObject(body.result)) return bad("result phải là object");
    if (Buffer.byteLength(JSON.stringify(body.result)) > RESULT_MAX_BYTES) return bad("result quá lớn");
    outcome = { status: "done", result: body.result as unknown as JobResult };
  } else if (body.status === "failed") {
    if (body.result !== undefined && body.result !== null) {
      // Only a failed `check` carries a result (the doctor items); the kind is verified against the job below.
      if (!isObject(body.result)) return bad("result phải là object");
      if (Buffer.byteLength(JSON.stringify(body.result)) > RESULT_MAX_BYTES) return bad("result quá lớn");
    }
    const code = body.errorCode ?? "app_error";
    if (!JOB_ERROR_CODES.includes(code as JobErrorCode)) return bad("errorCode không hợp lệ");
    if (body.errorText !== undefined && body.errorText !== null && typeof body.errorText !== "string") return bad("errorText phải là chuỗi");
    const text = typeof body.errorText === "string" ? sanitizeJobError(body.errorText) : "";
    outcome = {
      status: "failed", errorCode: code as JobErrorCode, errorText: text === "" ? null : text,
      ...(isObject(body.result) ? { result: body.result as unknown as JobResult } : {}),
    };
  } else {
    return bad("status phải là done hoặc failed");
  }

  const job = await getJob(ctx, company, id);
  if (!job) return NOT_FOUND;
  if (job.status !== "claimed") return conflict("Việc không ở trạng thái đang nhận");
  if (job.machineId !== machineId) return conflict("Việc đang do máy khác nhận");
  if (outcome.status === "done" && outcome.result.kind !== job.kind) return bad("result không khớp loại việc");
  if (outcome.status === "failed" && outcome.result) {
    if (job.kind !== "check") return bad("result chỉ gửi khi status là done, hoặc failed của việc check");
    if (outcome.result.kind !== "check") return bad("result không khớp loại việc");
  }
  if (!await finishJob(ctx, company, id, machineId, outcome, now)) return conflict("Việc không ở trạng thái đang nhận");
  return { status: 200, body: await getJob(ctx, company, id) };
}

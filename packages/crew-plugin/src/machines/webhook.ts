import type { PluginContext, PluginWebhookInput } from "@paperclipai/plugin-sdk";
import { authenticateCrewWebhook } from "../shared/webhook.js";
import { pluginNamespace, UUID } from "../shared/db.js";

export interface MachineReport {
  version: 1; companyId: string; machineId: string; hostname: string; sentAt: string;
  load1: number | null; cpuCount: number | null; memFreePct: number | null;
  tccPending: Array<{ service: string; client: string; since: string }>;
  claude: { version: string | null; loggedIn: boolean | null; plan: string | null };
  superpowers: SuperpowersReport;
  checks: Array<{ id: string; status: "ok" | "warn" | "error"; title: string }>;
  app?: AppReport;
  attachmentCache?: AttachmentCache;
  /** Git folders `~/crew-agents/<project>/<role>` on the Mac, at most 64, sorted by path. */
  checkouts?: CheckoutReport[];
  /** Present while the 2P Crew app polls the machine job queue. */
  jobsAgent?: JobsAgentReport;
  /** Trạng thái runtime Codex/OpenCode trên máy (crew-mac `status/runtimes.ts`); `null` ở trường = không đọc được. */
  runtimes?: RuntimesReport;
}

export interface RuntimesReport {
  codex: { version: string | null; loggedIn: boolean | null; primaryUsedPct: number | null; resetsAt: string | null };
  opencode: {
    version: string | null; keyPresent: boolean | null;
    costDay: number | null; costWeek: number | null; costMonth: number | null; models: string[];
  };
}

/** `pinDir` is the pinned copy agents load with `--plugin-dir` (null before pinning); `skills` lists its skill folders. */
export interface SuperpowersReport { pinned: string | null; ownerInstalled: string | null; pinDir?: string | null; skills?: string[] }
export interface CheckoutReport { path: string; head: string | null; clean: boolean | null }
export interface JobsAgentReport { version: string; lastPollAt: string }

/** crew-mac caps a report at 64 KiB. */
export const MACHINE_REPORT_MAX_BYTES = 65_536;
const MAX_CHECKOUTS = 64;
const MAX_SKILLS = 100;

/** Cache file đính kèm trên Mac: `bytes` là mọi file dưới gốc cache, `blobBytes` là phần blobs/ mà GC so với trần. */
export interface AttachmentCache { bytes: number; blobBytes: number; blobs: number; runs: number; limitBytes: number; measuredAt: string }

export const UPDATE_STATES = ["idle", "downloading", "waiting-idle", "installing", "probation", "rolled-back"] as const;
export type UpdateState = (typeof UPDATE_STATES)[number];
export interface AppReport { version: string; sshdOwner: "app" | "launchd"; updateState: UpdateState }
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
function fields(value: unknown, names: string[]): value is Record<string, unknown> {
  return object(value) && Object.keys(value).every((key) => names.includes(key)) && names.every((key) => key in value);
}
const label = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 200 && !value.includes("\0");
const nullableLabel = (value: unknown): value is string | null => value === null || label(value);
const iso = (value: unknown): value is string => label(value) && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/.test(value) && Number.isFinite(Date.parse(value));
const bounded = (value: unknown, min: number, max: number): value is number | null => value === null || typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;

function appReport(value: unknown): value is AppReport {
  return fields(value, ["version", "sshdOwner", "updateState"])
    && typeof value.version === "string" && value.version.length <= 32 && SEMVER.test(value.version)
    && (value.sshdOwner === "app" || value.sshdOwner === "launchd")
    && UPDATE_STATES.includes(value.updateState as UpdateState);
}

const count = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
function attachmentCacheReport(value: unknown): value is AttachmentCache {
  return fields(value, ["bytes", "blobBytes", "blobs", "runs", "limitBytes", "measuredAt"])
    && count(value.bytes) && count(value.blobBytes) && value.blobBytes <= value.bytes
    && count(value.blobs) && count(value.runs) && count(value.limitBytes) && iso(value.measuredAt);
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are exactly what is rejected
const CONTROL = /[\x00-\x1f\x7f]/;
const absolutePath = (value: unknown): value is string =>
  typeof value === "string" && value.startsWith("/") && value.length <= 4096 && !CONTROL.test(value);

function checkoutsReport(value: unknown): value is CheckoutReport[] {
  return Array.isArray(value) && value.length <= MAX_CHECKOUTS && value.every((item) => fields(item, ["path", "head", "clean"])
    && absolutePath(item.path)
    && (item.head === null || typeof item.head === "string" && /^[0-9a-f]{40}$/.test(item.head))
    && (item.clean === null || typeof item.clean === "boolean"));
}

const skillsReport = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length <= MAX_SKILLS && value.every(label);

const MAX_RUNTIME_VERSION = 50;
const MAX_RUNTIME_MODELS = 60;
const MAX_RUNTIME_MODEL_ID = 120;
const MAX_RUNTIME_COST = 100_000;
const RUNTIME_MODEL_ID = /^[a-z0-9._/-]+$/;
const runtimeVersion = (value: unknown): value is string | null =>
  value === null || typeof value === "string" && value.length > 0 && value.length <= MAX_RUNTIME_VERSION && !CONTROL.test(value);
const nullableBool = (value: unknown): value is boolean | null => value === null || typeof value === "boolean";

const orNull = <T>(ok: boolean, value: T): T | null => (ok ? value : null);
const modelId = (id: unknown): id is string => typeof id === "string" && id.length <= MAX_RUNTIME_MODEL_ID && RUNTIME_MODEL_ID.test(id);

/**
 * Làm sạch từng trường của khối runtimes: trường sai dạng thành `null`, model id không hợp lệ bị lọc, danh sách cắt ở
 * MAX_RUNTIME_MODELS. Chỉ trả `undefined` (bỏ cả khối) khi `runtimes` không phải object hoặc thiếu cả codex lẫn opencode.
 * Id có chữ hoa bị bỏ chứ không hạ chữ thường: catalog so khớp id chữ thường nguyên văn, hạ chữ sẽ bịa ra id không có thật.
 * Ký tự điều khiển vẫn bị chặn như trước.
 */
function sanitizeRuntimes(value: unknown): RuntimesReport | undefined {
  if (!object(value) || !(object(value.codex) || object(value.opencode))) return undefined;
  const codex = object(value.codex) ? value.codex : {};
  const opencode = object(value.opencode) ? value.opencode : {};
  const cost = (v: unknown) => orNull(bounded(v, 0, MAX_RUNTIME_COST), v as number | null);
  return {
    codex: {
      version: orNull(runtimeVersion(codex.version), codex.version as string | null),
      loggedIn: orNull(nullableBool(codex.loggedIn), codex.loggedIn as boolean | null),
      primaryUsedPct: orNull(bounded(codex.primaryUsedPct, 0, 100), codex.primaryUsedPct as number | null),
      resetsAt: orNull(iso(codex.resetsAt), codex.resetsAt as string | null),
    },
    opencode: {
      version: orNull(runtimeVersion(opencode.version), opencode.version as string | null),
      keyPresent: orNull(nullableBool(opencode.keyPresent), opencode.keyPresent as boolean | null),
      costDay: cost(opencode.costDay), costWeek: cost(opencode.costWeek), costMonth: cost(opencode.costMonth),
      models: Array.isArray(opencode.models) ? opencode.models.filter(modelId).slice(0, MAX_RUNTIME_MODELS) : [],
    },
  };
}

function jobsAgentReport(value: unknown): value is JobsAgentReport {
  return fields(value, ["version", "lastPollAt"])
    && typeof value.version === "string" && value.version.length <= 32 && SEMVER.test(value.version) && iso(value.lastPollAt);
}

/**
 * Optional keys (`app`, `attachmentCache`, `checkouts`, `jobsAgent`, `runtimes`, `superpowers.pinDir`, `superpowers.skills`) are
 * dropped one by one when malformed, and the rest of the report is still accepted: an older or newer crew-mac must
 * not lose its whole heartbeat over one field. Unknown keys and malformed required keys still reject the report.
 */
export function parseMachineReport(input: unknown): MachineReport {
  let value = input;
  const optional: Partial<MachineReport> = {};
  const superpowersExtra: Pick<SuperpowersReport, "pinDir" | "skills"> = {};
  if (object(input)) {
    const { app, attachmentCache, checkouts, jobsAgent, runtimes, ...rest } = input;
    value = rest;
    if (appReport(app)) optional.app = { version: app.version, sshdOwner: app.sshdOwner, updateState: app.updateState };
    if (attachmentCacheReport(attachmentCache)) {
      optional.attachmentCache = { bytes: attachmentCache.bytes, blobBytes: attachmentCache.blobBytes, blobs: attachmentCache.blobs,
        runs: attachmentCache.runs, limitBytes: attachmentCache.limitBytes, measuredAt: attachmentCache.measuredAt };
    }
    if (checkoutsReport(checkouts)) optional.checkouts = checkouts.map(({ path, head, clean }) => ({ path, head, clean }));
    if (jobsAgentReport(jobsAgent)) optional.jobsAgent = { version: jobsAgent.version, lastPollAt: jobsAgent.lastPollAt };
    const cleanRuntimes = sanitizeRuntimes(runtimes);
    if (cleanRuntimes) optional.runtimes = cleanRuntimes;
    if (object(rest.superpowers)) {
      const { pinDir, skills, ...required } = rest.superpowers;
      rest.superpowers = required;
      if (pinDir === null || absolutePath(pinDir)) superpowersExtra.pinDir = pinDir;
      if (skillsReport(skills)) superpowersExtra.skills = [...skills];
    }
  }
  if (!fields(value, ["version", "companyId", "machineId", "hostname", "sentAt", "load1", "cpuCount", "memFreePct", "tccPending", "claude", "superpowers", "checks"])
    || value.version !== 1 || typeof value.companyId !== "string" || !UUID.test(value.companyId)
    || typeof value.machineId !== "string" || !UUID.test(value.machineId) || !label(value.hostname) || !iso(value.sentAt)
    || !bounded(value.load1, 0, 1000)
    || !bounded(value.cpuCount, 1, 1024) || value.cpuCount !== null && !Number.isInteger(value.cpuCount)
    || !bounded(value.memFreePct, 0, 100)
    || !Array.isArray(value.tccPending) || value.tccPending.length > 100
    || !value.tccPending.every((t) => fields(t, ["service", "client", "since"]) && label(t.service) && label(t.client) && iso(t.since))
    || !fields(value.claude, ["version", "loggedIn", "plan"]) || !nullableLabel(value.claude.version) || value.claude.loggedIn !== null && typeof value.claude.loggedIn !== "boolean" || !nullableLabel(value.claude.plan)
    || !fields(value.superpowers, ["pinned", "ownerInstalled"]) || !nullableLabel(value.superpowers.pinned) || !nullableLabel(value.superpowers.ownerInstalled)
    || !Array.isArray(value.checks) || value.checks.length > 100
    || !value.checks.every((c) => fields(c, ["id", "status", "title"]) && label(c.id) && ["ok", "warn", "error"].includes(String(c.status)) && label(c.title))) {
    throw new Error("Bản tin máy không hợp lệ");
  }
  const parsed = value as unknown as MachineReport;
  return { ...parsed, superpowers: { ...parsed.superpowers, ...superpowersExtra }, ...optional };
}

export async function handleMachineStatus(ctx: PluginContext, input: PluginWebhookInput, now = new Date()): Promise<void> {
  const { body, companyId } = await authenticateCrewWebhook(input, ctx, { maxBytes: MACHINE_REPORT_MAX_BYTES, nowSec: Math.floor(now.getTime() / 1000) });
  const report = parseMachineReport(body);
  if (report.companyId !== companyId) throw new Error("Company không hợp lệ");
  const namespace = pluginNamespace(ctx);
  const history = `${namespace}.machine_reports`;
  const latest = `${namespace}.machine_latest`;
  const values = [companyId, report.machineId, report.hostname, now.toISOString(), report.sentAt, report.load1, report.cpuCount, report.memFreePct, JSON.stringify(report)];
  await ctx.db.execute(`INSERT INTO ${history} (company_id,machine_id,hostname,received_at,sent_at,load1,cpu_count,mem_free_pct,report)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
    values);
  await ctx.db.execute(`INSERT INTO ${latest} (company_id,machine_id,hostname,received_at,sent_at,load1,cpu_count,mem_free_pct,report)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
    ON CONFLICT (company_id,machine_id) DO UPDATE SET hostname=EXCLUDED.hostname,received_at=EXCLUDED.received_at,
      sent_at=EXCLUDED.sent_at,load1=EXCLUDED.load1,cpu_count=EXCLUDED.cpu_count,
      mem_free_pct=EXCLUDED.mem_free_pct,report=EXCLUDED.report
    WHERE ${latest}.received_at <= EXCLUDED.received_at`, values);
  // Retention is opportunistic because the stock plugin manifest has no scheduled-job slot.
  await ctx.db.execute(`DELETE FROM ${history} WHERE company_id = $1 AND received_at < $2`, [companyId, new Date(now.getTime() - 86_400_000).toISOString()]);
}

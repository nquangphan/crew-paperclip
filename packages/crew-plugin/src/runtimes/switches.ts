import type { PluginApiRequestInput, PluginApiResponse, PluginContext } from "@paperclipai/plugin-sdk";
import { pluginNamespace, UUID } from "../shared/db.js";
import { CREW_RUNTIMES, type CrewRuntime, isCrewRuntime } from "./catalog.js";

/** Máy chưa có dòng công tắc: Claude bật, Codex/OpenCode tắt; chỉ board bật. Cùng giá trị với server. */
export const CREW_RUNTIME_SWITCH_DEFAULTS: Readonly<Record<CrewRuntime, boolean>> = Object.freeze({
  claude_local: true, codex_local: false, opencode_local: false,
});

/**
 * Worker plugin không nhận biến môi trường của server, nên khóa OpenCode đọc từ cấu hình plugin của company
 * (`opencodeInPlacePatch: true` khi server đã có vá chạy OpenCode đúng worktree). Server đọc env riêng của nó.
 */
export const OPENCODE_PATCH_CONFIG_KEY = "opencodeInPlacePatch";
export type RuntimeSwitchLock = "opencode-patch-missing";

export interface RuntimeSwitchState {
  enabled: boolean; updatedAt: string | null; updatedByUserId: string | null; locked: RuntimeSwitchLock | null;
}
export interface MachineRuntimeSwitches { machineId: string; hostname: string; runtimes: Record<CrewRuntime, RuntimeSwitchState> }

type Ctx = Pick<PluginContext, "db" | "config">;
type SwitchRow = { machine_id: string; runtime: string; enabled: boolean; updated_at: string | Date; updated_by_user_id: string };

const SWITCH_ERROR = "Không đọc/ghi được công tắc runtime";
const FORBIDDEN = "Chỉ board được bật/tắt runtime";
const LOCKED_ERROR = "OpenCode chưa có vá chạy đúng worktree trên server";
const BODY_KEYS = ["companyId", "machineId", "runtime", "enabled"];
const bad = (error: string): PluginApiResponse => ({ status: 400, body: { error } });
const uuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);
const table = (ctx: Pick<PluginContext, "db">) => `${pluginNamespace(ctx)}.crew_runtime_switches`;

async function opencodeLocked(ctx: Pick<PluginContext, "config">, companyId: string): Promise<boolean> {
  const config = await ctx.config.get(companyId);
  return config?.[OPENCODE_PATCH_CONFIG_KEY] !== true;
}

function states(rows: SwitchRow[], locked: boolean): Record<CrewRuntime, RuntimeSwitchState> {
  const result = {} as Record<CrewRuntime, RuntimeSwitchState>;
  for (const runtime of CREW_RUNTIMES) {
    const row = rows.find((item) => item.runtime === runtime);
    const lock = runtime === "opencode_local" && locked ? "opencode-patch-missing" : null;
    result[runtime] = {
      enabled: lock ? false : row ? row.enabled : CREW_RUNTIME_SWITCH_DEFAULTS[runtime],
      updatedAt: row ? new Date(row.updated_at).toISOString() : null,
      updatedByUserId: row?.updated_by_user_id ?? null,
      locked: lock,
    };
  }
  return result;
}

async function switchRows(ctx: Pick<PluginContext, "db">, companyId: string, machineId?: string): Promise<SwitchRow[]> {
  return await ctx.db.query<SwitchRow>(
    `SELECT machine_id::text AS machine_id, runtime, enabled, updated_at, updated_by_user_id FROM ${table(ctx)}
     WHERE company_id = $1${machineId ? " AND machine_id = $2" : ""}`,
    machineId ? [companyId, machineId] : [companyId],
  );
}

/** Mọi máy có bản tin của company (bảng `machine_latest`), kèm trạng thái ba công tắc. */
export async function loadRuntimeSwitches(ctx: Ctx, companyId: string): Promise<MachineRuntimeSwitches[]> {
  const machines = await ctx.db.query<{ machine_id: string; hostname: string }>(
    `SELECT machine_id::text AS machine_id, hostname FROM ${pluginNamespace(ctx)}.machine_latest
     WHERE company_id = $1 ORDER BY hostname, machine_id`,
    [companyId],
  );
  const rows = await switchRows(ctx, companyId);
  const locked = await opencodeLocked(ctx, companyId);
  return machines.map((machine) => ({
    machineId: machine.machine_id, hostname: machine.hostname,
    runtimes: states(rows.filter((row) => row.machine_id === machine.machine_id), locked),
  }));
}

/**
 * Công tắc đang có hiệu lực. `machineId` null (không xác định được máy của agent) → mặc định. OpenCode luôn tắt khi
 * thiếu vá.
 */
export async function readRuntimeSwitch(
  ctx: Ctx, input: { companyId: string; machineId: string | null; runtime: CrewRuntime },
): Promise<boolean> {
  if (input.runtime === "opencode_local" && await opencodeLocked(ctx, input.companyId)) return false;
  if (!input.machineId) return CREW_RUNTIME_SWITCH_DEFAULTS[input.runtime];
  const rows = await ctx.db.query<{ enabled: boolean }>(
    `SELECT enabled FROM ${table(ctx)} WHERE company_id = $1 AND machine_id = $2 AND runtime = $3`,
    [input.companyId, input.machineId, input.runtime],
  );
  return rows[0]?.enabled ?? CREW_RUNTIME_SWITCH_DEFAULTS[input.runtime];
}

function parseSetBody(body: unknown, companyId: string): { machineId: string; runtime: CrewRuntime; enabled: boolean } | string {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "body phải là object";
  const value = body as Record<string, unknown>;
  const unknownKey = Object.keys(value).find((key) => !BODY_KEYS.includes(key));
  if (unknownKey) return `trường ${unknownKey} không được hỗ trợ`;
  if (!uuid(value.companyId) || value.companyId.toLowerCase() !== companyId) return "companyId không hợp lệ";
  if (!uuid(value.machineId)) return "machineId phải là uuid";
  if (!isCrewRuntime(value.runtime)) return "runtime không hợp lệ";
  if (typeof value.enabled !== "boolean") return "enabled phải là boolean";
  return { machineId: value.machineId.toLowerCase(), runtime: value.runtime, enabled: value.enabled };
}

/**
 * Route công tắc runtime theo máy. Host đã kiểm auth board và quyền company; kiểm actor ở đây để một thay đổi luật
 * host không cho agent tự bật runtime. Lỗi DB không bao giờ trả câu SQL ra ngoài, chi tiết chỉ ở log server.
 */
export async function handleRuntimeSwitchesApi(
  ctx: Pick<PluginContext, "db" | "config" | "activity" | "logger">, input: PluginApiRequestInput,
): Promise<PluginApiResponse> {
  try {
    return await routeRuntimeSwitches(ctx, input);
  } catch (error) {
    ctx.logger.error("crew runtime switch request failed", {
      routeKey: input.routeKey, companyId: input.companyId, err: error instanceof Error ? error.message : String(error),
    });
    return { status: 500, body: { error: SWITCH_ERROR } };
  }
}

async function routeRuntimeSwitches(
  ctx: Pick<PluginContext, "db" | "config" | "activity" | "logger">, input: PluginApiRequestInput,
): Promise<PluginApiResponse> {
  if (!["runtimes.switches.get", "runtimes.switches.set"].includes(input.routeKey)) {
    return { status: 404, body: { error: "Route không tồn tại" } };
  }
  if (input.actor.actorType !== "user") return { status: 403, body: { error: FORBIDDEN } };
  if (!uuid(input.companyId)) return bad("companyId phải là uuid");
  const companyId = input.companyId.toLowerCase();
  if (input.routeKey === "runtimes.switches.get") {
    return { status: 200, body: { machines: await loadRuntimeSwitches(ctx, companyId) } };
  }

  const parsed = parseSetBody(input.body, companyId);
  if (typeof parsed === "string") return bad(parsed);
  const known = await ctx.db.query(
    `SELECT machine_id FROM ${pluginNamespace(ctx)}.machine_latest WHERE company_id = $1 AND machine_id = $2`,
    [companyId, parsed.machineId],
  );
  if (known.length === 0) return bad(`máy ${parsed.machineId} không thuộc company`);
  const locked = await opencodeLocked(ctx, companyId);
  if (parsed.runtime === "opencode_local" && parsed.enabled && locked) return { status: 409, body: { error: LOCKED_ERROR } };

  const before = states(await switchRows(ctx, companyId, parsed.machineId), locked)[parsed.runtime].enabled;
  const actorUserId = input.actor.userId ?? input.actor.actorId;
  await ctx.db.execute(
    `INSERT INTO ${table(ctx)} (company_id,machine_id,runtime,enabled,updated_by_user_id,updated_at)
     VALUES ($1,$2,$3,$4,$5,now())
     ON CONFLICT (company_id,machine_id,runtime) DO UPDATE SET enabled = EXCLUDED.enabled,
       updated_by_user_id = EXCLUDED.updated_by_user_id, updated_at = EXCLUDED.updated_at`,
    [companyId, parsed.machineId, parsed.runtime, parsed.enabled, actorUserId],
  );
  const runtimes = states(await switchRows(ctx, companyId, parsed.machineId), locked);
  try {
    await ctx.activity.log({
      companyId, message: "crew.runtime_switch.set", entityType: "company", entityId: companyId,
      metadata: { machineId: parsed.machineId, runtime: parsed.runtime, before, after: runtimes[parsed.runtime].enabled, actorUserId },
    });
  } catch (error) {
    // Công tắc đã ghi; mất dòng activity không được làm board tưởng lệnh thất bại.
    ctx.logger.warn("crew runtime switch activity failed", {
      companyId, machineId: parsed.machineId, runtime: parsed.runtime, err: error instanceof Error ? error.message : String(error),
    });
  }
  return { status: 200, body: { ok: true, runtimes } };
}

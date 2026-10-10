import { sql } from "drizzle-orm";
import { derivePluginDatabaseNamespace } from "../services/plugin-database.js";
import type { CrewRuntime } from "./model-policy.js";
import { CREW_PLUGIN_KEY, type CrewRolesDb, rowsOf, warnOncePerMinute } from "./project-roles.js";

/**
 * Công tắc runtime theo máy: bảng `crew_runtime_switches` của plugin crew.core (migration `0012_runtimes.sql`), khóa
 * `(company_id, machine_id, runtime)`. Chưa có dòng, chưa có bảng hay đọc lỗi thì dùng mặc định: Claude bật, Codex và
 * OpenCode tắt (chỉ board bật).
 */
export const CREW_RUNTIME_SWITCH_DEFAULTS: Readonly<Record<CrewRuntime, boolean>> = Object.freeze({
  claude_local: true,
  codex_local: false,
  opencode_local: false,
});

/** Server có vá adapter OpenCode chạy đúng worktree trên Mac khi biến này là `"1"`; thiếu vá thì OpenCode luôn tắt. */
export const CREW_OPENCODE_IN_PLACE_PATCH_ENV = "CREW_OPENCODE_IN_PLACE_PATCH";

const pluginTable = (name: string) => `${derivePluginDatabaseNamespace(CREW_PLUGIN_KEY)}.${name}`;
export const crewRuntimeSwitchesTable = () => pluginTable("crew_runtime_switches");
/** Hàng chờ run bị công tắc giữ: server (H1) ghi, job fallback của plugin đọc. Bảng duy nhất server ghi trong namespace plugin. */
export const crewRuntimeWaitsTable = () => pluginTable("crew_runtime_waits");
export const crewRuntimeDecisionsTable = () => pluginTable("crew_runtime_decisions");
export const crewMachineLatestTable = () => pluginTable("machine_latest");

type Row = Record<string, unknown>;

/**
 * Đọc bảng plugin trong transaction lồng (savepoint khi chạy trong `tx` của H2/H4): câu SQL lỗi không abort transaction
 * của bên gọi. Trả `null` khi bảng chưa có (plugin chưa migrate).
 */
export async function readPluginRows(
  db: CrewRolesDb,
  table: string,
  query: (table: ReturnType<typeof sql.raw>) => ReturnType<typeof sql>,
): Promise<Row[] | null> {
  return db.transaction(async (tx) => {
    const exists = rowsOf(await tx.execute(sql`SELECT to_regclass(${table}) IS NOT NULL AS ok`));
    if (exists[0]?.ok !== true) return null;
    return rowsOf(await tx.execute(query(sql.raw(table))));
  });
}

/**
 * Công tắc của `runtime` trên máy `machineId`. `machineId` null (không xác định được máy) → mặc định. OpenCode luôn tắt
 * khi server chưa có vá chạy đúng worktree. Bảng chưa có hoặc đọc lỗi → mặc định, cảnh báo tối đa 1 lần/phút/company.
 */
export async function readRuntimeSwitch(
  db: CrewRolesDb,
  input: { companyId: string; machineId: string | null; runtime: CrewRuntime },
): Promise<boolean> {
  const { companyId, machineId, runtime } = input;
  if (runtime === "opencode_local" && process.env[CREW_OPENCODE_IN_PLACE_PATCH_ENV] !== "1") return false;
  const fallback = CREW_RUNTIME_SWITCH_DEFAULTS[runtime];
  if (!machineId) return fallback;
  try {
    const rows = await readPluginRows(
      db,
      crewRuntimeSwitchesTable(),
      (table) => sql`SELECT enabled FROM ${table}
        WHERE company_id = ${companyId} AND machine_id = ${machineId} AND runtime = ${runtime} LIMIT 1`,
    );
    if (rows === null) {
      warnOncePerMinute(companyId, "runtime-switch-missing", {}, "crew runtime switches table missing; using default switches");
      return fallback;
    }
    const enabled = rows[0]?.enabled;
    return typeof enabled === "boolean" ? enabled : fallback;
  } catch (error) {
    warnOncePerMinute(companyId, "runtime-switch-read", { machineId, runtime, err: error }, "crew runtime switch unreadable; using default switch");
    return fallback;
  }
}

/** Bản tin mới nhất của một máy, rút gọn còn đường các checkout. */
export interface MachineCheckouts {
  machineId: string;
  receivedAt: string;
  checkouts: string[];
}

/**
 * Máy chạy một agent, cùng luật với plugin (`runtimes/machine.ts`): máy có bản tin mới nhất chứa checkout = thư mục làm
 * việc của environment (nhiều máy thì bản tin mới nhất thắng); không thấy mà company chỉ có một máy thì lấy máy đó; còn
 * lại `null` (dùng công tắc mặc định).
 */
export function resolveMachineForWorkspace(workspacePath: string | null, machines: readonly MachineCheckouts[]): string | null {
  if (workspacePath) {
    const matches = machines
      .filter((machine) => machine.checkouts.includes(workspacePath))
      .sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt));
    if (matches[0]) return matches[0].machineId;
  }
  return machines.length === 1 ? machines[0]!.machineId : null;
}

function checkoutPaths(value: unknown): string[] {
  const list = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => (item && typeof item === "object" ? (item as Record<string, unknown>).path : undefined))
    .filter((path): path is string => typeof path === "string");
}

/**
 * Máy của agent: `defaultEnvironmentId` → `environment.config.remoteWorkspacePath` → bản tin mới nhất của các máy trong
 * company (bảng `machine_latest` của plugin). Bảng bản tin chưa có thì coi như chưa có máy (`null`). Lỗi đọc thì ném để
 * bên gọi tự chọn cách xử lý (cổng H1 fail open).
 */
export async function resolveAgentMachine(db: CrewRolesDb, input: { companyId: string; agentId: string }): Promise<string | null> {
  const { companyId, agentId } = input;
  const agentRows = rowsOf(
    await db.execute(sql`SELECT e.config->>'remoteWorkspacePath' AS workspace
      FROM "agents" a LEFT JOIN "environments" e ON e.id = a.default_environment_id
      WHERE a.id = ${agentId} AND a.company_id = ${companyId} LIMIT 1`),
  );
  const workspace = agentRows[0]?.workspace;
  const reports = await readPluginRows(
    db,
    crewMachineLatestTable(),
    (table) => sql`SELECT machine_id::text AS machine_id, received_at, report->'checkouts' AS checkouts
      FROM ${table} WHERE company_id = ${companyId} ORDER BY machine_id`,
  );
  const machines = (reports ?? []).map((row) => ({
    machineId: String(row.machine_id),
    receivedAt: new Date(row.received_at as string | Date).toISOString(),
    checkouts: checkoutPaths(row.checkouts),
  }));
  return resolveMachineForWorkspace(typeof workspace === "string" && workspace ? workspace : null, machines);
}

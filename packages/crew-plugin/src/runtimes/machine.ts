import type { PluginContext } from "@paperclipai/plugin-sdk";
import { checkedId, jsonObject, pluginNamespace } from "../shared/db.js";

/** Bản tin mới nhất của một máy, rút gọn còn đường các checkout. */
export interface MachineCheckouts { machineId: string; receivedAt: string; checkouts: string[] }

/**
 * Máy chạy một agent, cùng luật với server: máy có bản tin mới nhất chứa checkout = thư mục làm việc của environment
 * (nhiều máy thì bản tin mới nhất thắng); không thấy mà company chỉ có một máy thì lấy máy đó; còn lại `null` (bên gọi
 * dùng công tắc mặc định).
 */
export function resolveMachineForWorkspace(workspacePath: string | null, machines: readonly MachineCheckouts[]): string | null {
  if (workspacePath) {
    const matches = machines.filter((machine) => machine.checkouts.includes(workspacePath))
      .sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt));
    if (matches[0]) return matches[0].machineId;
  }
  return machines.length === 1 ? machines[0]!.machineId : null;
}

/**
 * Thư mục làm việc của environment theo refs mà wizard ghi trong setup run: thêm project ghi `environment_<ô>` +
 * `checkout_<ô>`, thêm agent ghi `environment` + `checkout`. Wizard tạo environment với `remoteWorkspacePath` đúng
 * checkout đó. Plugin không đọc được bảng `environments`, nên đây là nguồn duy nhất. `runs` xếp mới nhất trước.
 */
export function workspaceOfEnvironment(environmentId: string | null, runs: readonly unknown[]): string | null {
  if (!environmentId) return null;
  const wanted = environmentId.toLowerCase();
  for (const steps of runs) {
    const refs: Record<string, unknown> = {};
    for (const step of Object.values(jsonObject(steps) ?? {})) Object.assign(refs, jsonObject(jsonObject(step)?.refs) ?? {});
    for (const [key, value] of Object.entries(refs)) {
      if (typeof value !== "string" || value.toLowerCase() !== wanted) continue;
      const slot = key === "environment" ? "" : key.startsWith("environment_") ? key.slice("environment".length) : null;
      if (slot === null) continue;
      const checkout = refs[`checkout${slot}`];
      if (typeof checkout === "string" && checkout.startsWith("/")) return checkout;
    }
  }
  return null;
}

const SETUP_RUN_SCAN_LIMIT = 200;

/** Bản tin mới nhất của mọi máy trong company. */
export async function loadMachineCheckouts(ctx: Pick<PluginContext, "db">, companyId: string): Promise<MachineCheckouts[]> {
  const rows = await ctx.db.query<{ machine_id: string; received_at: string | Date; checkouts: unknown }>(
    `SELECT machine_id::text AS machine_id, received_at, report->'checkouts' AS checkouts
     FROM ${pluginNamespace(ctx)}.machine_latest WHERE company_id = $1 ORDER BY machine_id`,
    [checkedId(companyId)],
  );
  return rows.map((row) => {
    const list = typeof row.checkouts === "string" ? JSON.parse(row.checkouts) as unknown : row.checkouts;
    const checkouts = Array.isArray(list)
      ? list.map((item) => jsonObject(item)?.path).filter((path): path is string => typeof path === "string")
      : [];
    return { machineId: row.machine_id, receivedAt: new Date(row.received_at).toISOString(), checkouts };
  });
}

/** Máy của agent (`null` = không xác định, dùng công tắc mặc định). Mọi truy vấn đều lọc theo company. */
export async function resolveAgentMachine(
  ctx: Pick<PluginContext, "db">, input: { companyId: string; agentId: string },
): Promise<string | null> {
  const companyId = checkedId(input.companyId);
  const agents = await ctx.db.query<{ default_environment_id: string | null }>(
    "SELECT default_environment_id::text AS default_environment_id FROM public.agents WHERE id = $1 AND company_id = $2",
    [checkedId(input.agentId), companyId],
  );
  const machines = await loadMachineCheckouts(ctx, companyId);
  const environmentId = agents[0]?.default_environment_id ?? null;
  if (!environmentId) return resolveMachineForWorkspace(null, machines);
  const runs = await ctx.db.query<{ steps: unknown }>(
    `SELECT steps FROM ${pluginNamespace(ctx)}.crew_setup_runs
     WHERE company_id = $1 AND kind IN ('add-project','add-agent') ORDER BY updated_at DESC, created_at DESC LIMIT ${SETUP_RUN_SCAN_LIMIT}`,
    [companyId],
  );
  return resolveMachineForWorkspace(workspaceOfEnvironment(environmentId, runs.map((run) => run.steps)), machines);
}

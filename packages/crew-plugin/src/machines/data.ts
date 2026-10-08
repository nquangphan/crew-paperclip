import type { PluginContext } from "@paperclipai/plugin-sdk";
import type { MachineReport } from "./webhook.js";
import { registerCrewWebhook } from "../shared/webhook.js";
import { handleMachineStatus } from "./webhook.js";
import { checkedId, pluginNamespace } from "../shared/db.js";

export interface CrewMachine {
  machineId: string; hostname: string; lastSeenAt: string; online: boolean; latest: MachineReport;
  load24h: Array<{ at: string; load1: number | null }>;
}
type Row = { machine_id: string; hostname: string; received_at: string | Date; load1: number | null; report: MachineReport | string };
const date = (value: string | Date) => new Date(value).toISOString();

export async function loadCrewMachines(ctx: Pick<PluginContext, "db">, companyId: string, now = new Date()): Promise<CrewMachine[]> {
  checkedId(companyId);
  const ns = pluginNamespace(ctx);
  const latest = await ctx.db.query<Row>(`SELECT machine_id,hostname,received_at,load1,report FROM ${ns}.machine_latest
    WHERE company_id=$1 ORDER BY machine_id`, [companyId]);
  const history = await ctx.db.query<Row>(`SELECT machine_id,received_at,load1 FROM ${ns}.machine_reports
    WHERE company_id=$1 AND received_at >= $2 ORDER BY machine_id,received_at,id`, [companyId, new Date(now.getTime() - 86_400_000).toISOString()]);
  return latest.map((row) => {
    const samples = history.filter((item) => item.machine_id === row.machine_id);
    const stride = Math.max(1, Math.ceil(samples.length / 288));
    return { machineId: row.machine_id, hostname: row.hostname, lastSeenAt: date(row.received_at),
      online: now.getTime() - new Date(row.received_at).getTime() <= 180_000,
      latest: typeof row.report === "string" ? JSON.parse(row.report) as MachineReport : row.report,
      load24h: samples.filter((_, index) => index % stride === 0).map((item) => ({ at: date(item.received_at), load1: item.load1 === null ? null : Number(item.load1) })) };
  });
}

export function registerMachinesFeature(ctx: PluginContext): void {
  ctx.data.register("crew.machines", (params) => loadCrewMachines(ctx, String(params.companyId ?? "")));
  // Webhook registration is shared with the worker dispatcher.
  // Import lazily nowhere: static import keeps registration deterministic.
  registerMachineWebhook(ctx);
}

function registerMachineWebhook(ctx: PluginContext): void {
  registerCrewWebhook("machine-status", (input) => handleMachineStatus(ctx, input));
}

import type { PluginContext } from "@paperclipai/plugin-sdk";
import type { MachineReport } from "./webhook.js";
import { registerCrewWebhook } from "../shared/webhook.js";
import { handleMachineStatus } from "./webhook.js";
import { checkedId, pluginNamespace } from "../shared/db.js";

/**
 * Automatic pairing of a machine; `revokedAt` set once an owner unpaired it. Machines paired by hand have none. A
 * machine removed while it still used the company secret was never paired: its row carries only `revokedAt`.
 */
export type CrewMachinePairing =
  | { pairedAt: string; revokedAt: string | null; environmentId: string; tailscaleIp: string }
  | { pairedAt: null; revokedAt: string; environmentId: null; tailscaleIp: null };
export interface CrewMachine {
  machineId: string; hostname: string; lastSeenAt: string; online: boolean; latest: MachineReport;
  load24h: Array<{ at: string; load1: number | null }>;
  pairing: CrewMachinePairing | null;
}
type Row = {
  machine_id: string; hostname: string; received_at: string | Date; load1: number | null; report: MachineReport | string;
  paired_at: string | Date | null; revoked_at: string | Date | null; environment_id: string | null; tailscale_ip: string | null;
};
const date = (value: string | Date) => new Date(value).toISOString();

export async function loadCrewMachines(ctx: Pick<PluginContext, "db">, companyId: string, now = new Date()): Promise<CrewMachine[]> {
  checkedId(companyId);
  const ns = pluginNamespace(ctx);
  // The key nonce stays server side: only the public pairing facts are selected.
  const latest = await ctx.db.query<Row>(`SELECT l.machine_id,l.hostname,l.received_at,l.load1,l.report,
      p.paired_at,p.revoked_at,p.environment_id::text AS environment_id,p.tailscale_ip
    FROM ${ns}.machine_latest l LEFT JOIN ${ns}.machine_pairings p ON p.company_id = l.company_id AND p.machine_id = l.machine_id
    WHERE l.company_id=$1 ORDER BY l.machine_id`, [companyId]);
  const history = await ctx.db.query<Pick<Row, "machine_id" | "received_at" | "load1">>(`SELECT machine_id,received_at,load1 FROM ${ns}.machine_reports
    WHERE company_id=$1 AND received_at >= $2 ORDER BY machine_id,received_at,id`, [companyId, new Date(now.getTime() - 86_400_000).toISOString()]);
  return latest.map((row) => {
    const samples = history.filter((item) => item.machine_id === row.machine_id);
    const stride = Math.max(1, Math.ceil(samples.length / 288));
    return { machineId: row.machine_id, hostname: row.hostname, lastSeenAt: date(row.received_at),
      online: now.getTime() - new Date(row.received_at).getTime() <= 180_000,
      latest: typeof row.report === "string" ? JSON.parse(row.report) as MachineReport : row.report,
      load24h: samples.filter((_, index) => index % stride === 0).map((item) => ({ at: date(item.received_at), load1: item.load1 === null ? null : Number(item.load1) })),
      pairing: toPairing(row) };
  });
}

function toPairing(row: Row): CrewMachinePairing | null {
  if (row.paired_at !== null && row.environment_id !== null && row.tailscale_ip !== null) {
    return { pairedAt: date(row.paired_at), revokedAt: row.revoked_at === null ? null : date(row.revoked_at),
      environmentId: row.environment_id, tailscaleIp: row.tailscale_ip };
  }
  // The table check keeps every unrevoked row complete, so an incomplete row is a removed company-secret machine.
  return row.revoked_at === null ? null : { pairedAt: null, revokedAt: date(row.revoked_at), environmentId: null, tailscaleIp: null };
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

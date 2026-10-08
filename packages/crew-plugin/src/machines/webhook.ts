import type { PluginContext, PluginWebhookInput } from "@paperclipai/plugin-sdk";
import { authenticateCrewWebhook } from "../shared/webhook.js";

export interface MachineReport {
  version: 1; companyId: string; machineId: string; hostname: string; sentAt: string;
  load1: number; cpuCount: number; memFreePct: number;
  tccPending: Array<{ service: string; client: string; since: string }>;
  claude: { version: string; loggedIn: boolean; plan: string };
  superpowers: { pinned: string; ownerInstalled: string };
  checks: Array<{ id: string; status: "ok" | "warn" | "error"; title: string }>;
}

const uuid = /^[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$/;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
function fields(value: unknown, names: string[]): value is Record<string, unknown> {
  return object(value) && Object.keys(value).every((key) => names.includes(key)) && names.every((key) => key in value);
}
const iso = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/.test(value) && Number.isFinite(Date.parse(value));
const label = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 512;

export function parseMachineReport(value: unknown): MachineReport {
  if (!fields(value, ["version", "companyId", "machineId", "hostname", "sentAt", "load1", "cpuCount", "memFreePct", "tccPending", "claude", "superpowers", "checks"])
    || value.version !== 1 || typeof value.companyId !== "string" || !uuid.test(value.companyId)
    || typeof value.machineId !== "string" || !uuid.test(value.machineId) || !label(value.hostname) || !iso(value.sentAt)
    || typeof value.load1 !== "number" || !Number.isFinite(value.load1) || value.load1 < 0
    || typeof value.cpuCount !== "number" || !Number.isInteger(value.cpuCount) || value.cpuCount < 1
    || typeof value.memFreePct !== "number" || !Number.isFinite(value.memFreePct) || value.memFreePct < 0 || value.memFreePct > 100
    || !Array.isArray(value.tccPending) || value.tccPending.length > 100
    || !value.tccPending.every((t) => fields(t, ["service", "client", "since"]) && label(t.service) && label(t.client) && iso(t.since))
    || !fields(value.claude, ["version", "loggedIn", "plan"]) || !label(value.claude.version) || typeof value.claude.loggedIn !== "boolean" || !label(value.claude.plan)
    || !fields(value.superpowers, ["pinned", "ownerInstalled"]) || !label(value.superpowers.pinned) || !label(value.superpowers.ownerInstalled)
    || !Array.isArray(value.checks) || value.checks.length > 100
    || !value.checks.every((c) => fields(c, ["id", "status", "title"]) && label(c.id) && ["ok", "warn", "error"].includes(String(c.status)) && label(c.title))) {
    throw new Error("Bản tin máy không hợp lệ");
  }
  return value as unknown as MachineReport;
}

export async function handleMachineStatus(ctx: PluginContext, input: PluginWebhookInput, now = new Date()): Promise<void> {
  const { body, companyId } = await authenticateCrewWebhook(input, ctx, { maxBytes: 16_384, nowSec: Math.floor(now.getTime() / 1000) });
  const report = parseMachineReport(body);
  if (report.companyId !== companyId) throw new Error("Company không hợp lệ");
  const table = `${ctx.db.namespace}.machine_reports`;
  await ctx.db.execute(`INSERT INTO ${table} (company_id,machine_id,hostname,received_at,sent_at,load1,cpu_count,mem_free_pct,report)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
    [companyId, report.machineId, report.hostname, now.toISOString(), report.sentAt, report.load1, report.cpuCount, report.memFreePct, JSON.stringify(report)]);
  // Retention is opportunistic because the stock plugin manifest has no scheduled-job slot.
  await ctx.db.execute(`DELETE FROM ${table} WHERE received_at < $1`, [new Date(now.getTime() - 86_400_000).toISOString()]);
}

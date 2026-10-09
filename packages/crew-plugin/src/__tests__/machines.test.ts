import { readFile } from "node:fs/promises";
import { createHmac } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import postgres from "../../../db/node_modules/postgres";
import { startEmbeddedPostgresTestDatabase } from "../../../db/src/test-embedded-postgres.js";
import type { PluginContext, PluginWebhookInput } from "@paperclipai/plugin-sdk";
import { handleMachineStatus, parseMachineReport } from "../machines/webhook.js";
import { loadCrewMachines } from "../machines/data.js";
import { validatePluginMigrationStatement, validatePluginRuntimeExecute } from "../../../../server/src/services/plugin-database.js";

const companyId = "10000000-0000-4000-8000-000000000001";
const otherCompany = "10000000-0000-4000-8000-000000000002";
const machineId = "20000000-0000-4000-8000-000000000001";
const machineB = "20000000-0000-4000-8000-000000000002";
const now = new Date("2026-10-08T14:00:00.000Z");
const base = { version: 1, companyId, machineId, hostname: "mac-mini", sentAt: now.toISOString(), load1: 2.2, cpuCount: 10, memFreePct: 52,
  tccPending: [{ service: "kTCCServiceSystemPolicyAppData", client: "/Applications/Claude.app", since: now.toISOString() }],
  claude: { version: "2.1.294", loggedIn: true, plan: "max" }, superpowers: { pinned: "6.4.1", ownerInstalled: "6.4.1" },
  checks: [{ id: "status", status: "warn", title: "Attention" }] };
let cleanup: (() => Promise<void>) | undefined;
afterAll(async () => { await cleanup?.(); });

it("stores one signed report, rejects unsafe envelopes without writes, and computes freshness and 24h load", async () => {
  const database = await startEmbeddedPostgresTestDatabase("crew-machines-");
  const sql = postgres(database.connectionString, { max: 2, onnotice: () => {} });
  cleanup = async () => { await sql.end(); await database.cleanup(); };
  await sql`CREATE SCHEMA plugin_crew_core_0433ea20b6`;
  await sql.unsafe(await readFile(new URL("../../migrations/0001_docs.sql", import.meta.url), "utf8"));
  await sql.unsafe(await readFile(new URL("../../migrations/0002_machines.sql", import.meta.url), "utf8"));
  const migration = await readFile(new URL("../../migrations/0003_machine_latest.sql", import.meta.url), "utf8");
  for (const statement of migration.split(";").map(part => part.trim()).filter(Boolean)) {
    validatePluginMigrationStatement(statement, "plugin_crew_core_0433ea20b6");
    await sql.unsafe(statement);
  }
  const ctx = { db: {
    namespace: "plugin_crew_core_0433ea20b6", query: async <T>(query: string, params: unknown[] = []) => await sql.unsafe<T[]>(query, params as never[]),
    execute: async (query: string, params: unknown[] = []) => {
      validatePluginRuntimeExecute(query, "plugin_crew_core_0433ea20b6");
      return { rowCount: (await sql.unsafe(query, params as never[])).count };
    },
  }, config: { get: async () => ({ companies: [companyId, otherCompany].map(companyId => ({ companyId, webhookSecretRef: { type: "secret_ref", secretId: machineId } })) }) },
    secrets: { resolve: async () => "test-secret" } } as unknown as PluginContext;
  const send = async (report: unknown, options: { signature?: string; timestamp?: number; raw?: string; receivedAt?: Date } = {}) => {
    const rawBody = options.raw ?? JSON.stringify(report);
    const receivedAt = options.receivedAt ?? now;
    const timestamp = options.timestamp ?? Math.floor(receivedAt.getTime() / 1000);
    const signature = options.signature ?? `sha256=${createHmac("sha256", "test-secret").update(`${timestamp}.${rawBody}`).digest("hex")}`;
    const input: PluginWebhookInput = { endpointKey: "machine-status", requestId: "test", rawBody,
      headers: { "X-Crew-Timestamp": String(timestamp), "X-Crew-Signature": signature } };
    await handleMachineStatus(ctx, input, receivedAt);
  };
  await send(base);
  expect((await sql`SELECT * FROM plugin_crew_core_0433ea20b6.machine_reports`)).toHaveLength(1);
  const bad = [
    () => send(base, { signature: "sha256=" + "0".repeat(64) }),
    () => send(base, { signature: "" }),
    () => send(base, { timestamp: Math.floor(now.getTime() / 1000) - 301 }),
    () => send({ ...base, companyId: "10000000-0000-4000-8000-000000000099" }),
    () => send({ ...base, machineId: "not-a-uuid" }),
    () => send({ ...base, secret: "bad" }),
    () => send({ ...base, checks: [{ ...base.checks[0], detail: "/secret" }] }),
    () => send(base, { raw: "x".repeat(65_537) }),
  ];
  for (const reject of bad) { await expect(reject()).rejects.toThrow(); expect((await sql`SELECT * FROM plugin_crew_core_0433ea20b6.machine_reports`)).toHaveLength(1); }
  const rows = await loadCrewMachines(ctx, companyId, now);
  expect(rows[0]?.online).toBe(true);
  expect(rows[0]?.load24h).toHaveLength(1);
  expect(rows[0]).not.toHaveProperty("lastLoadGate");
  expect((await loadCrewMachines(ctx, companyId, new Date(now.getTime() + 180_000)))[0]?.online).toBe(true);
  expect((await loadCrewMachines(ctx, companyId, new Date(now.getTime() + 180_001)))[0]?.online).toBe(false);
  expect((await loadCrewMachines(ctx, companyId, new Date(now.getTime() + 86_400_001)))[0]?.load24h).toHaveLength(0);
  const unknown = { ...base, claude: { version: null, loggedIn: false, plan: null }, superpowers: { pinned: null, ownerInstalled: null }, load1: null, cpuCount: null, memFreePct: null };
  await send(unknown);
  expect((await loadCrewMachines(ctx, companyId, now))[0]?.latest.claude.plan).toBeNull();
  for (const report of [
    { ...base, load1: 1001 }, { ...base, cpuCount: 1025 },
    { ...base, hostname: "x".repeat(201) }, { ...base, hostname: "bad\0host" },
    { ...base, checks: [{ ...base.checks[0], title: "x".repeat(201) }] },
  ]) {
    const historyBefore = (await sql`SELECT count(*)::int AS n FROM plugin_crew_core_0433ea20b6.machine_reports`)[0]?.n;
    const latestBefore = (await sql`SELECT count(*)::int AS n FROM plugin_crew_core_0433ea20b6.machine_latest`)[0]?.n;
    await expect(send(report)).rejects.toThrow();
    expect((await sql`SELECT count(*)::int AS n FROM plugin_crew_core_0433ea20b6.machine_reports`)[0]?.n).toBe(historyBefore);
    expect((await sql`SELECT count(*)::int AS n FROM plugin_crew_core_0433ea20b6.machine_latest`)[0]?.n).toBe(latestBefore);
  }
  const app = { version: "0.1.0", sshdOwner: "app", updateState: "probation" };
  await send({ ...base, app });
  expect((await loadCrewMachines(ctx, companyId, now))[0]?.latest.app).toEqual(app);
  await send({ ...base, app: { ...app, sshdOwner: "x" } });
  const afterBadApp = (await loadCrewMachines(ctx, companyId, now))[0]?.latest;
  expect(afterBadApp).not.toHaveProperty("app");
  expect(afterBadApp?.hostname).toBe("mac-mini");
  await send({ ...base, companyId: otherCompany });
  const later = new Date(now.getTime() + 25 * 3_600_000);
  await send({ ...base, machineId: machineB, sentAt: later.toISOString() }, { receivedAt: later });
  const machines = await loadCrewMachines(ctx, companyId, later);
  expect(machines.map(machine => machine.machineId)).toEqual([machineId, machineB]);
  expect(machines.find(machine => machine.machineId === machineId)).toMatchObject({ online: false, load24h: [] });
  expect((await loadCrewMachines(ctx, otherCompany, later)).map(machine => machine.machineId)).toEqual([machineId]);
  expect((await sql`SELECT count(*)::int AS n FROM plugin_crew_core_0433ea20b6.machine_reports WHERE company_id=${otherCompany}`)[0]?.n).toBe(1);
}, 90_000);

it("keeps a valid attachmentCache and drops a malformed one", () => {
  const cache = { bytes: 1234, blobBytes: 1000, blobs: 3, runs: 2, limitBytes: 2147483648, measuredAt: "2026-10-10T01:00:00.000Z" };
  expect(parseMachineReport({ ...base, attachmentCache: cache }).attachmentCache).toEqual(cache);
  expect(parseMachineReport(base)).not.toHaveProperty("attachmentCache");
  for (const bad of [{ ...cache, bytes: -1 }, { ...cache, extra: 1 }, { ...cache, measuredAt: "hôm qua" }, { ...cache, blobBytes: 2000 },
    { ...cache, runs: 1.5 }, { bytes: 1 }, "x", null]) {
    const parsed = parseMachineReport({ ...base, attachmentCache: bad });
    expect(parsed).not.toHaveProperty("attachmentCache");
    expect(parsed.machineId).toBe(base.machineId);
  }
});

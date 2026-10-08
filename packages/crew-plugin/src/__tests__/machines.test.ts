import { readFile } from "node:fs/promises";
import { createHmac } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import postgres from "../../../db/node_modules/postgres";
import { startEmbeddedPostgresTestDatabase } from "../../../db/src/test-embedded-postgres.js";
import type { PluginContext, PluginWebhookInput } from "@paperclipai/plugin-sdk";
import { handleMachineStatus } from "../machines/webhook.js";
import { loadCrewMachines } from "../machines/data.js";

const companyId = "10000000-0000-4000-8000-000000000001";
const machineId = "20000000-0000-4000-8000-000000000001";
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
  await sql.unsafe(await readFile(new URL("../../migrations/0002_machines.sql", import.meta.url), "utf8"));
  const ctx = { db: {
    namespace: "plugin_crew_core_0433ea20b6", query: async <T>(query: string, params: unknown[] = []) => await sql.unsafe<T[]>(query, params as never[]),
    execute: async (query: string, params: unknown[] = []) => ({ rowCount: (await sql.unsafe(query, params as never[])).count }),
  }, config: { get: async () => ({ companies: [{ companyId, webhookSecretRef: { type: "secret_ref", secretId: machineId } }] }) },
    secrets: { resolve: async () => "test-secret" } } as unknown as PluginContext;
  const send = async (report: unknown, options: { signature?: string; timestamp?: number; raw?: string } = {}) => {
    const rawBody = options.raw ?? JSON.stringify(report);
    const timestamp = options.timestamp ?? Math.floor(now.getTime() / 1000);
    const signature = options.signature ?? `sha256=${createHmac("sha256", "test-secret").update(`${timestamp}.${rawBody}`).digest("hex")}`;
    const input: PluginWebhookInput = { endpointKey: "machine-status", requestId: "test", rawBody,
      headers: { "X-Crew-Timestamp": String(timestamp), "X-Crew-Signature": signature } };
    await handleMachineStatus(ctx, input, now);
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
    () => send(base, { raw: "x".repeat(17_000) }),
  ];
  for (const reject of bad) { await expect(reject()).rejects.toThrow(); expect((await sql`SELECT * FROM plugin_crew_core_0433ea20b6.machine_reports`)).toHaveLength(1); }
  const rows = await loadCrewMachines(ctx, companyId, now);
  expect(rows[0]?.online).toBe(true);
  expect(rows[0]?.load24h).toHaveLength(1);
  expect(rows[0]).not.toHaveProperty("lastLoadGate");
  expect((await loadCrewMachines(ctx, companyId, new Date(now.getTime() + 180_000)))[0]?.online).toBe(true);
  expect((await loadCrewMachines(ctx, companyId, new Date(now.getTime() + 180_001)))[0]?.online).toBe(false);
  expect((await loadCrewMachines(ctx, companyId, new Date(now.getTime() + 86_400_001)))[0]?.load24h).toHaveLength(0);
}, 90_000);

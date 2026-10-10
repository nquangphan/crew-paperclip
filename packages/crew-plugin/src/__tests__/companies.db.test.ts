import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { PluginContext } from "@paperclipai/plugin-sdk";
import { loadCrewCompanies } from "../companies/data.js";
import { registerAttachmentsAudit, runAttachmentsAudit } from "../attachments/audit.js";
import { type PluginHost, startPluginHost } from "./plugin-host-db.js";

/**
 * The core plugin host refuses a worker→host call that carries no invocation and touches companies while an
 * event invocation (kept 15 minutes) is alive: `companies.list` from an unscoped data call or a job fails with
 * JSON-RPC -32005 INVOCATION_SCOPE_DENIED. Crew must keep working through that window.
 */
const A = "10000000-0000-4000-8000-00000000000a";
const B = "10000000-0000-4000-8000-00000000000b";
const C = "10000000-0000-4000-8000-00000000000c";
const ref = { type: "secret_ref", secretId: "20000000-0000-4000-8000-000000000001" };
const NAMES: Record<string, string> = { [A]: "TPS", [B]: "E2E", [C]: "Không Crew" };

function scopeDenied(): Error {
  return Object.assign(new Error("Plugin \"crew.core\" denied for companies.list: the worker referenced a missing, expired, or unknown invocation scope"), {
    name: "JsonRpcCallError", code: -32005,
  });
}

let host: PluginHost;
let ctx: PluginContext;
let denied: boolean;
let listCalls: number;
let searched: string[];
let configs: Record<string, unknown>;
let registered: (() => Promise<void>) | undefined;

beforeAll(async () => { host = await startPluginHost("crew-companies-"); });
afterAll(async () => { await host?.cleanup(); });

beforeEach(async () => {
  await host.sql.unsafe(`DELETE FROM ${host.ns}.crew_companies`);
  host.logs.length = 0;
  denied = false;
  listCalls = 0;
  searched = [];
  configs = {
    [A]: { companies: [{ companyId: A, webhookSecretRef: ref }] },
    [B]: { companies: [{ companyId: B, webhookSecretRef: ref }] },
    [C]: { companies: [] },
  };
  ctx = {
    ...host.ctx,
    companies: {
      list: vi.fn(async () => {
        listCalls++;
        if (denied) throw scopeDenied();
        return Object.entries(NAMES).map(([id, name]) => ({ id, name, status: "active" }));
      }),
      get: vi.fn(async (id: string) => (NAMES[id] ? { id, name: NAMES[id], status: "active" } : null)),
    },
    config: { get: vi.fn(async (id: string) => configs[id] ?? {}) },
    jobs: { register: (_key: string, fn: () => Promise<void>) => { registered = fn; } },
    authorization: { audit: { search: async (input: { companyId: string }) => { searched.push(input.companyId); return []; } } },
    issues: {},
  } as unknown as PluginContext;
});

const stored = async () => (await host.sql.unsafe<{ id: string; name: string }[]>(
  `SELECT company_id::text AS id, name FROM ${host.ns}.crew_companies ORDER BY company_id`)).map((row) => ({ ...row }));
const warnings = () => host.logs.filter((log) => log.level === "warn");

it("có companyId thì đọc đúng company đó bằng companies.get, không cần companies.list, và nhớ company Crew", async () => {
  denied = true;
  expect(await loadCrewCompanies(ctx, { companyId: A })).toEqual([{ id: A, name: "TPS" }]);
  expect(await loadCrewCompanies(ctx, { companyId: C })).toEqual([]);
  expect(listCalls).toBe(0);
  expect(await stored()).toEqual([{ id: A, name: "TPS" }]);
});

it("company đã lưu mà nay không còn cấu hình Crew thì bị xóa khỏi danh sách đã lưu", async () => {
  await loadCrewCompanies(ctx, { companyId: B });
  expect(await stored()).toEqual([{ id: B, name: "E2E" }]);
  configs[B] = { companies: [] };
  expect(await loadCrewCompanies(ctx, { companyId: B })).toEqual([]);
  expect(await stored()).toEqual([]);
});

it("không companyId: list thành công thì đồng bộ danh sách đã lưu; host từ chối (-32005) thì dùng danh sách đã lưu", async () => {
  await host.sql.unsafe(`INSERT INTO ${host.ns}.crew_companies (company_id, name) VALUES ($1, 'Cũ')`, [C]);
  expect(await loadCrewCompanies(ctx, {})).toEqual([{ id: A, name: "TPS" }, { id: B, name: "E2E" }]);
  expect(await stored()).toEqual([{ id: A, name: "TPS" }, { id: B, name: "E2E" }]);

  denied = true;
  configs[B] = { companies: [] };
  expect(await loadCrewCompanies(ctx, {})).toEqual([{ id: A, name: "TPS" }]);
  expect(warnings()).toHaveLength(1);
});

it("lỗi khác của companies.list vẫn ném ra", async () => {
  (ctx.companies.list as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("db down"));
  await expect(loadCrewCompanies(ctx, {})).rejects.toThrow("db down");
});

it("job attachments-audit: chỉ quét company Crew đã lưu, không gọi companies.list, không đọc config company khác", async () => {
  await loadCrewCompanies(ctx, { companyId: A });
  await loadCrewCompanies(ctx, { companyId: B });
  await loadCrewCompanies(ctx, { companyId: C });
  expect(await stored()).toEqual([{ id: A, name: "TPS" }, { id: B, name: "E2E" }]);
  const listed = listCalls;
  const configReads = vi.spyOn(ctx.config, "get");

  registerAttachmentsAudit(ctx);
  for (const denyList of [false, true]) {
    denied = denyList;
    searched = [];
    configReads.mockClear();
    await expect(registered!()).resolves.toBeUndefined();
    expect([...searched].sort()).toEqual([A, B]);
    expect(configReads.mock.calls.map(([id]) => id).sort()).toEqual([A, B]);
  }
  expect(listCalls).toBe(listed);
  expect(warnings()).toEqual([]);
  expect(host.logs.filter((log) => log.level === "error")).toEqual([]);
});

it("job attachments-audit: chưa lưu company nào thì không quét gì, không gọi companies.list, không lỗi", async () => {
  expect(await runAttachmentsAudit(ctx, new Date())).toEqual({ checked: 0, warned: 0 });
  expect(searched).toEqual([]);
  expect(listCalls).toBe(0);
  expect(warnings()).toEqual([]);
});

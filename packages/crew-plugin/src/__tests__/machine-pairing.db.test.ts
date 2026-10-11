import { createHash, createHmac } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PluginApiRequestInput, PluginContext, PluginWebhookInput } from "@paperclipai/plugin-sdk";
import { pluginManifestV1Schema } from "../../../shared/src/validators/plugin.js";
import { receiveDocsSnapshot } from "../docs/webhook.js";
import { loadCrewMachines } from "../machines/data.js";
import { deriveMachineKey, handleMachinesApi, isTailscaleIp } from "../machines/pairing.js";
import { handleMachineStatus } from "../machines/webhook.js";
import manifest from "../manifest.js";
import { type PluginHost, startPluginHost } from "./plugin-host-db.js";

const companyId = "10000000-0000-4000-8000-000000000001";
const otherCompany = "10000000-0000-4000-8000-000000000002";
const projectId = "20000000-0000-4000-8000-000000000001";
const secretRef = { type: "secret_ref", secretId: "20000000-0000-4000-8000-0000000000aa" };
const mini = "50000000-0000-4000-8000-000000000001";
const macbook = "50000000-0000-4000-8000-000000000002";
const environmentId = "70000000-0000-4000-8000-000000000001";
const userId = "user-owner-1";
const COMPANY_SECRET = "company-webhook-secret";
const PUBLIC_KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPaperclipKey paperclip@server";
const FINGERPRINT = `SHA256:${"A".repeat(43)}`;

type Actor = PluginApiRequestInput["actor"];
const owner: Actor = { actorType: "user", actorId: userId, userId, agentId: null, runId: null };
const agent: Actor = { actorType: "agent", actorId: "40000000-0000-4000-8000-000000000001", agentId: "40000000-0000-4000-8000-000000000001", userId: null, runId: null };

let host: PluginHost;
let ctx: PluginContext;
let config: Record<string, unknown> = {};
const configCalls: unknown[] = [];
const resolveCalls: unknown[] = [];

const pairBody = (overrides: Record<string, unknown> = {}) => ({
  companyId, machineId: macbook, hostname: "Phans-MacBook-Pro", environmentId,
  tailscaleIp: "100.100.157.19", port: 2222, hostKeyFingerprint: FINGERPRINT, ...overrides,
});
function request(routeKey: string, options: { body?: unknown; actor?: Actor; company?: string; machineId?: string } = {}): PluginApiRequestInput {
  const company = options.company ?? companyId;
  const get = routeKey === "machines.pair-info";
  return {
    routeKey, method: get ? "GET" : "POST", path: "/machines", params: options.machineId ? { machineId: options.machineId } : {},
    query: get ? { companyId: company } : {}, body: options.body ?? null, actor: options.actor ?? owner, companyId: company, headers: {},
  };
}
const pair = (body: unknown = pairBody(), actor?: Actor) => handleMachinesApi(ctx, request("machines.pair", { body, actor }));
const unpair = (machineId = macbook, body: unknown = { companyId }) =>
  handleMachinesApi(ctx, request("machines.unpair", { body, machineId }));

const now = new Date();
const nowSec = Math.floor(now.getTime() / 1000);
function signed(endpointKey: string, payload: unknown, secret: string): PluginWebhookInput {
  const rawBody = JSON.stringify(payload);
  return { endpointKey, rawBody, requestId: "request-1", headers: {
    "X-Crew-Timestamp": String(nowSec),
    "X-Crew-Signature": `sha256=${createHmac("sha256", secret).update(`${nowSec}.${rawBody}`).digest("hex")}`,
  } };
}
const report = (machineId: string, hostname: string) => ({
  version: 1, companyId, machineId, hostname, sentAt: now.toISOString(), load1: 1, cpuCount: 8, memFreePct: 50, tccPending: [],
  claude: { version: null, loggedIn: null, plan: null }, superpowers: { pinned: null, ownerInstalled: null }, checks: [],
});
const status = (machineId: string, hostname: string, secret: string) =>
  handleMachineStatus(ctx, signed("machine-status", report(machineId, hostname), secret), now);
const docsPage = (path: string, text: string) => ({ path, title: path, parentPath: "docs", text, sha256: createHash("sha256").update(text, "utf8").digest("hex") });
const snapshot = (machineId: string, commit: string) => ({
  version: 1, companyId, machineId, projectId, repo: "repo-a", commit, auditState: "verified", checkExit: 0,
  pages: [docsPage("docs/index.md", "Index")], links: [], dropped: [],
});
const keyFor = async (machineId: string) => {
  const [row] = await host.sql.unsafe(`SELECT key_nonce FROM ${host.ns}.machine_pairings WHERE company_id = $1 AND machine_id = $2`, [companyId, machineId]);
  return deriveMachineKey(COMPANY_SECRET, companyId, machineId, String(row?.key_nonce));
};

beforeAll(async () => {
  host = await startPluginHost("crew-machine-pairing-");
  ctx = {
    ...host.ctx,
    config: { get: async (company?: string) => { configCalls.push(company); return config; } },
    secrets: { resolve: async (ref: unknown, scope: unknown) => { resolveCalls.push(scope); return COMPANY_SECRET; } },
  } as unknown as PluginContext;
  await host.sql.unsafe(`INSERT INTO companies (id,name,issue_prefix) VALUES ($1,'2P Solutions','TPS')`, [companyId]);
  await host.sql.unsafe(`INSERT INTO projects (id,company_id,name) VALUES ($1,$2,'Repo A')`, [projectId, companyId]);
}, 120_000);
afterAll(async () => { await host?.cleanup(); });
beforeEach(async () => {
  await host.sql.unsafe(`DELETE FROM ${host.ns}.machine_pairings`);
  config = { companies: [{ companyId, webhookSecretRef: secretRef }], paperclipSshPublicKey: PUBLIC_KEY };
  configCalls.length = 0;
  resolveCalls.length = 0;
  host.logs.length = 0;
  host.fail.error = null;
});

describe("manifest ghép máy", () => {
  it("khai báo ba route board, công ty lấy từ query cho GET và body cho POST, không thêm capability", () => {
    const parsed = pluginManifestV1Schema.parse(manifest);
    expect(parsed.apiRoutes?.filter((r) => r.routeKey.startsWith("machines.")).map((r) => [r.routeKey, r.method, r.path, r.auth, r.companyResolution]))
      .toEqual([
        ["machines.pair-info", "GET", "/machines/pair-info", "board", { from: "query", key: "companyId" }],
        ["machines.pair", "POST", "/machines/pair", "board", { from: "body", key: "companyId" }],
        ["machines.unpair", "POST", "/machines/:machineId/unpair", "board", { from: "body", key: "companyId" }],
      ]);
    expect(parsed.capabilities).toHaveLength(28);
  });
});

describe("route machines.pair-info", () => {
  it("trả public key Paperclip của company, đọc config theo company", async () => {
    expect(await handleMachinesApi(ctx, request("machines.pair-info"))).toEqual({ status: 200, body: { paperclipSshPublicKey: PUBLIC_KEY } });
    expect(configCalls).toEqual([companyId]);
  });
  it("409 khi thiếu hoặc sai dạng key", async () => {
    for (const value of [undefined, "", "ssh-rsa AAAAB3Nza", 7]) {
      config = { companies: [{ companyId, webhookSecretRef: secretRef }], paperclipSshPublicKey: value };
      expect(await handleMachinesApi(ctx, request("machines.pair-info"))).toEqual({ status: 409, body: { error: "Server chưa có key Paperclip" } });
    }
  });
  it("agent bị 403", async () => {
    expect((await handleMachinesApi(ctx, request("machines.pair-info", { actor: agent }))).status).toBe(403);
  });
});

describe("route machines.pair", () => {
  it("ghi dòng ghép và trả key máy đúng một lần, không log key", async () => {
    const response = await pair();
    expect(response.status).toBe(200);
    const body = response.body as { machineKey: string; pairedAt: string };
    expect(Object.keys(body).sort()).toEqual(["machineKey", "pairedAt"]);
    expect(body.machineKey).toBe(await keyFor(macbook));
    expect(body.machineKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Number.isFinite(Date.parse(body.pairedAt))).toBe(true);
    expect(resolveCalls).toEqual([{ companyId }]);
    const [row] = await host.sql.unsafe(`SELECT hostname, environment_id::text AS env, tailscale_ip, port, host_key_fingerprint,
      key_nonce, paired_by_user_id, revoked_at FROM ${host.ns}.machine_pairings`);
    expect(row).toMatchObject({ hostname: "Phans-MacBook-Pro", env: environmentId, tailscale_ip: "100.100.157.19", port: 2222,
      host_key_fingerprint: FINGERPRINT, paired_by_user_id: userId, revoked_at: null });
    expect(String(row?.key_nonce)).toMatch(/^[0-9a-f]{64}$/);
    expect(host.logs).toEqual([{ level: "info", message: "crew machine paired", meta: { companyId, machineId: macbook, userId } }]);
    expect(JSON.stringify(host.logs)).not.toContain(body.machineKey);
  });

  it("ghép lại đổi nonce, xóa trạng thái gỡ và làm key cũ chết", async () => {
    const first = (await pair()).body as { machineKey: string };
    expect((await unpair()).status).toBe(200);
    const second = (await pair(pairBody({ port: 2223 }))).body as { machineKey: string };
    expect(second.machineKey).not.toBe(first.machineKey);
    const rows = await host.sql.unsafe(`SELECT port, revoked_at, revoked_by_user_id FROM ${host.ns}.machine_pairings`);
    expect(rows).toEqual([{ port: 2223, revoked_at: null, revoked_by_user_id: null }]);
    await expect(status(macbook, "Phans-MacBook-Pro", first.machineKey)).rejects.toMatchObject({ code: "bad_signature" });
    await status(macbook, "Phans-MacBook-Pro", second.machineKey);
  });

  it("từ chối body sai mà không ghi gì", async () => {
    const cases: unknown[] = [
      null, [], "x",
      { ...pairBody(), extra: 1 },
      (({ hostKeyFingerprint: _, ...rest }) => rest)(pairBody()),
      pairBody({ companyId: otherCompany }),
      pairBody({ machineId: "macbook" }),
      pairBody({ environmentId: "env-1" }),
      pairBody({ tailscaleIp: "100.128.0.1" }), pairBody({ tailscaleIp: "100.63.255.255" }),
      pairBody({ tailscaleIp: "192.168.1.2" }), pairBody({ tailscaleIp: "100.100.1.256" }), pairBody({ tailscaleIp: "100.100.01.2" }),
      pairBody({ port: 22 }), pairBody({ port: 65536 }), pairBody({ port: 2222.5 }), pairBody({ port: "2222" }),
      pairBody({ hostKeyFingerprint: "SHA256:short" }), pairBody({ hostKeyFingerprint: `MD5:${"A".repeat(43)}` }),
      pairBody({ hostname: "" }), pairBody({ hostname: "x".repeat(201) }), pairBody({ hostname: "a\0b" }),
    ];
    for (const body of cases) expect((await pair(body)).status, JSON.stringify(body)).toBe(400);
    expect(await host.sql.unsafe(`SELECT 1 FROM ${host.ns}.machine_pairings`)).toEqual([]);
  });

  it("nhận biên dải Tailscale 100.64.0.0/10 và cổng 1024–65535", async () => {
    expect(isTailscaleIp("100.64.0.0")).toBe(true);
    expect(isTailscaleIp("100.127.255.255")).toBe(true);
    expect((await pair(pairBody({ port: 1024 }))).status).toBe(200);
    expect((await pair(pairBody({ port: 65535 }))).status).toBe(200);
  });

  it("agent bị 403 và không ghi gì", async () => {
    expect(await pair(pairBody(), agent)).toEqual({ status: 403, body: { error: "Chỉ người dùng board được ghép hoặc gỡ máy" } });
    expect(await host.sql.unsafe(`SELECT 1 FROM ${host.ns}.machine_pairings`)).toEqual([]);
  });

  it("409 khi company chưa có secret webhook", async () => {
    config = { companies: [], paperclipSshPublicKey: PUBLIC_KEY };
    expect(await pair()).toEqual({ status: 409, body: { error: "Company chưa có secret webhook" } });
    expect(await host.sql.unsafe(`SELECT 1 FROM ${host.ns}.machine_pairings`)).toEqual([]);
  });

  it("lỗi DB trả 500 câu chung, chi tiết chỉ ở log", async () => {
    host.fail.error = new Error("relation does not exist");
    expect(await pair()).toEqual({ status: 500, body: { error: "Không đọc/ghi được thông tin ghép máy" } });
    expect(host.logs.at(-1)).toMatchObject({ level: "error", message: "crew machine pairing request failed" });
  });
});

describe("route machines.unpair", () => {
  it("đặt revoked_at, trả environmentId, gọi lại vẫn ra cùng kết quả", async () => {
    await pair();
    const first = await unpair();
    expect(first.status).toBe(200);
    const body = first.body as { environmentId: string; revokedAt: string };
    expect(body.environmentId).toBe(environmentId);
    expect(Number.isFinite(Date.parse(body.revokedAt))).toBe(true);
    expect(await unpair()).toEqual(first);
    expect(await host.sql.unsafe(`SELECT revoked_by_user_id FROM ${host.ns}.machine_pairings`)).toEqual([{ revoked_by_user_id: userId }]);
  });
  it("404 khi máy chưa ghép (Mac mini), 400 khi body hoặc machineId sai", async () => {
    expect(await unpair(mini)).toEqual({ status: 404, body: { error: "Máy chưa được ghép" } });
    expect((await unpair("mini")).status).toBe(400);
    expect((await unpair(macbook, { companyId, extra: 1 })).status).toBe(400);
    expect((await unpair(macbook, { companyId: otherCompany })).status).toBe(400);
    expect((await handleMachinesApi(ctx, { ...request("machines.unpair", { body: { companyId }, machineId: macbook }), actor: agent })).status).toBe(403);
  });
});

describe("webhook với bảng ghép thật", () => {
  it("Mac mini chưa ghép vẫn gửi bản tin máy và ảnh chụp docs bằng secret company", async () => {
    await pair();
    await status(mini, "mac-mini", COMPANY_SECRET);
    await receiveDocsSnapshot(ctx, signed("docs-snapshot", snapshot(mini, "a".repeat(40)), COMPANY_SECRET));
    expect(await host.sql.unsafe(`SELECT 1 FROM ${host.ns}.machine_pairings WHERE machine_id = $1`, [mini])).toEqual([]);
    expect(resolveCalls.every((scope) => JSON.stringify(scope) === JSON.stringify({ companyId }))).toBe(true);
    expect(configCalls.every((company) => company === companyId)).toBe(true);
  });

  it("máy đã ghép: key máy được nhận ở cả hai endpoint, secret company bị từ chối, gỡ rồi thì machine_revoked", async () => {
    const { machineKey } = (await pair()).body as { machineKey: string };
    await status(macbook, "Phans-MacBook-Pro", machineKey);
    await receiveDocsSnapshot(ctx, signed("docs-snapshot", snapshot(macbook, "b".repeat(40)), machineKey));
    await expect(status(macbook, "Phans-MacBook-Pro", COMPANY_SECRET)).rejects.toMatchObject({ code: "bad_signature" });
    // Key của MacBook ký bản tin mang machineId của Mac mini: rơi về secret company và trượt.
    await expect(status(mini, "mac-mini", machineKey)).rejects.toMatchObject({ code: "bad_signature" });

    await unpair();
    await expect(status(macbook, "Phans-MacBook-Pro", machineKey)).rejects.toMatchObject({ code: "machine_revoked" });
    await expect(receiveDocsSnapshot(ctx, signed("docs-snapshot", snapshot(macbook, "c".repeat(40)), machineKey)))
      .rejects.toMatchObject({ code: "machine_revoked" });
    // Mac mini không bị ảnh hưởng khi gỡ máy khác.
    await status(mini, "mac-mini", COMPANY_SECRET);
  });
});

describe("data crew.machines", () => {
  it("có pairing cho máy đã ghép, null cho máy chưa ghép, không trả nonce", async () => {
    const { machineKey } = (await pair()).body as { machineKey: string };
    await status(mini, "mac-mini", COMPANY_SECRET);
    await status(macbook, "Phans-MacBook-Pro", machineKey);
    let machines = await loadCrewMachines(ctx, companyId, now);
    const byId = (id: string) => machines.find((m) => m.machineId === id);
    expect(byId(mini)?.pairing).toBeNull();
    expect(byId(macbook)?.pairing).toEqual({
      pairedAt: expect.any(String), revokedAt: null, environmentId, tailscaleIp: "100.100.157.19",
    });
    const nonce = String((await host.sql.unsafe(`SELECT key_nonce FROM ${host.ns}.machine_pairings`))[0]?.key_nonce);
    expect(JSON.stringify(machines)).not.toContain(nonce);
    expect(JSON.stringify(machines)).not.toContain(machineKey);

    await unpair();
    machines = await loadCrewMachines(ctx, companyId, now);
    expect(byId(macbook)?.pairing?.revokedAt).toEqual(expect.any(String));
  });
});

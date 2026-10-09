import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { PluginContext, PluginWebhookInput } from "@paperclipai/plugin-sdk";
import type { CrewHeaders } from "../shared/signature.js";
import { verifyCrewSignature } from "../shared/signature.js";
import { authenticateCrewWebhook, dispatchCrewWebhook, registerCrewWebhook } from "../shared/webhook.js";
import { parseMachineReport } from "../machines/webhook.js";
import manifest from "../manifest.js";
import { validateInstanceConfig } from "../../../../server/src/services/plugin-config-validator.js";

const timestamp = 1_760_000_000;
const companyId = "10000000-0000-4000-8000-000000000001";
const ref = { type: "secret_ref" as const, secretId: "20000000-0000-4000-8000-000000000001" };
const body = JSON.stringify({ version: 1, companyId, machineId: "machine-1" });
const signed = (rawBody: string, time = timestamp) => ({
  "X-Crew-Timestamp": String(time),
  "X-Crew-Signature": `sha256=${createHmac("sha256", "test-secret").update(`${time}.${rawBody}`).digest("hex")}`,
});
const input = (rawBody = body, headers: CrewHeaders = signed(rawBody)): PluginWebhookInput => ({
  endpointKey: "machine-status", headers, rawBody, requestId: "request-1",
});

function context(companies: unknown = [{ companyId, webhookSecretRef: ref }]) {
  const get = vi.fn(async () => ({ companies }));
  const resolve = vi.fn(async () => "test-secret");
  return { ctx: { config: { get }, secrets: { resolve } } as unknown as PluginContext, get, resolve };
}

describe("verifyCrewSignature", () => {
  it("matches the shared fixed vector", () => {
    const vector = "6ee0c20d3f215ce4a77295bac40239010978f18848bf25541d7bb317e3358411";
    expect(createHmac("sha256", "test-secret").update('1760000000.{"a":1}').digest("hex")).toBe(vector);
    expect(verifyCrewSignature('{"a":1}', {
      "X-Crew-Timestamp": "1760000000",
      "X-Crew-Signature": `sha256=${vector}`,
    }, "test-secret", timestamp)).toBe("ok");
  });
  it("rejects missing, changed and stale signatures", () => {
    expect(verifyCrewSignature(body, {}, "test-secret", timestamp)).toBe("missing");
    expect(verifyCrewSignature(body, { ...signed(body), "X-Crew-Signature": "sha256=" + "0".repeat(64) }, "test-secret", timestamp)).toBe("bad");
    expect(verifyCrewSignature(body, signed(body), "test-secret", timestamp + 301)).toBe("stale");
    expect(verifyCrewSignature(body, signed(body), "test-secret", timestamp + 300)).toBe("ok");
  });
});

describe("authenticateCrewWebhook", () => {
  it("returns the company and verified parsed body, resolving the secret each time", async () => {
    const { ctx, resolve } = context();
    const result = await authenticateCrewWebhook(input(), ctx, { maxBytes: 16_384, nowSec: timestamp });
    expect(result).toEqual({ companyId, body: JSON.parse(body) });
    expect(ctx.config.get).toHaveBeenCalledWith(companyId);
    expect(resolve).toHaveBeenCalledWith(ref, { companyId });
    await authenticateCrewWebhook(input(), ctx, { maxBytes: 16_384, nowSec: timestamp });
    expect(resolve).toHaveBeenCalledTimes(2);
  });
  it("rejects oversize and missing or stale headers before config or secrets", async () => {
    const { ctx, get, resolve } = context();
    await expect(authenticateCrewWebhook(input("x".repeat(16_385)), ctx, { maxBytes: 16_384, nowSec: timestamp })).rejects.toMatchObject({ code: "body_too_large" });
    await expect(authenticateCrewWebhook(input(body, {}), ctx, { maxBytes: 16_384, nowSec: timestamp })).rejects.toMatchObject({ code: "missing_signature" });
    await expect(authenticateCrewWebhook(input(body, signed(body, timestamp - 301)), ctx, { maxBytes: 16_384, nowSec: timestamp })).rejects.toMatchObject({ code: "stale_signature" });
    expect(get).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
  });
  it("rejects an unknown company or secret failure without trusting the body", async () => {
    const noCompany = context([]);
    await expect(authenticateCrewWebhook(input(), noCompany.ctx, { maxBytes: 16_384, nowSec: timestamp })).rejects.toMatchObject({ code: "unknown_company" });
    expect(noCompany.resolve).not.toHaveBeenCalled();
    const broken = context();
    broken.resolve.mockRejectedValueOnce(new Error("provider failed"));
    await expect(authenticateCrewWebhook(input(), broken.ctx, { maxBytes: 16_384, nowSec: timestamp })).rejects.toMatchObject({ code: "secret_unavailable" });
    const noConfig = context();
    noConfig.get.mockRejectedValueOnce(new Error("config failed"));
    await expect(authenticateCrewWebhook(input(), noConfig.ctx, { maxBytes: 16_384, nowSec: timestamp })).rejects.toMatchObject({ code: "config_unavailable" });
  });
  it("rejects invalid HMAC and invalid envelope", async () => {
    const { ctx } = context();
    await expect(authenticateCrewWebhook(input(body, { ...signed(body), "X-Crew-Signature": "sha256=" + "0".repeat(64) }), ctx, { maxBytes: 16_384, nowSec: timestamp })).rejects.toMatchObject({ code: "bad_signature" });
    const invalid = JSON.stringify({ companyId, version: 2 });
    await expect(authenticateCrewWebhook(input(invalid, signed(invalid)), ctx, { maxBytes: 16_384, nowSec: timestamp })).rejects.toMatchObject({ code: "invalid_body" });
  });
});

it("dispatches only registered webhook handlers", async () => {
  await expect(dispatchCrewWebhook({ ...input(), endpointKey: "unknown" })).rejects.toThrow("chưa có handler");
  const handler = vi.fn(async () => {});
  registerCrewWebhook("test-endpoint", handler);
  await dispatchCrewWebhook({ ...input(), endpointKey: "test-endpoint" });
  expect(handler).toHaveBeenCalledOnce();
});

it("accepts an object secret binding in the host config validator", () => {
  const schema = manifest.instanceConfigSchema!;
  expect(validateInstanceConfig({ companies: [{ companyId, webhookSecretRef: ref }] }, schema).valid).toBe(true);
  expect(validateInstanceConfig({ companies: [{ companyId, webhookSecretRef: "test-secret" }] }, schema).valid).toBe(false);
});

describe("trường app của bản tin máy", () => {
  const report = { version: 1, companyId, machineId: "20000000-0000-4000-8000-000000000001", hostname: "mini", sentAt: "2026-10-09T05:00:00.000Z",
    load1: 1, cpuCount: 8, memFreePct: 50, tccPending: [], claude: { version: null, loggedIn: null, plan: null },
    superpowers: { pinned: null, ownerInstalled: null }, checks: [] };
  const app = { version: "0.1.0", sshdOwner: "app", updateState: "idle" };

  it("nhận bản tin cũ không có app như trước", () => {
    expect(parseMachineReport(report)).toEqual(report);
    expect(parseMachineReport(report)).not.toHaveProperty("app");
  });
  it("giữ nguyên app hợp lệ", () => {
    expect(parseMachineReport({ ...report, app }).app).toEqual(app);
    expect(parseMachineReport({ ...report, app: { ...app, version: "1.2.3-beta.1", sshdOwner: "launchd", updateState: "rolled-back" } }).app)
      .toEqual({ version: "1.2.3-beta.1", sshdOwner: "launchd", updateState: "rolled-back" });
  });
  it("bỏ riêng app sai dạng, vẫn nhận phần còn lại", () => {
    for (const bad of [{ ...app, version: "1.0.0-" + "x".repeat(30) }, { ...app, version: "abc" }, { ...app, sshdOwner: "x" },
      { ...app, updateState: "lạ" }, { ...app, extra: 1 }, { version: "0.1.0", sshdOwner: "app" }, null, "x", [], 7]) {
      const parsed = parseMachineReport({ ...report, app: bad });
      expect(parsed).not.toHaveProperty("app");
      expect(parsed).toEqual(report);
    }
  });
  it("vẫn từ chối khi phần bắt buộc sai, dù có app", () => {
    expect(() => parseMachineReport({ ...report, app, load1: 1001 })).toThrow();
    expect(() => parseMachineReport({ ...report, app, secret: "x" })).toThrow();
  });
});

import { createHmac, randomUUID } from "node:crypto";
import type { Request } from "express";
import { describe, expect, it } from "vitest";
import { deriveMachineKey as pluginDeriveMachineKey } from "../../../packages/crew-plugin/src/machines/pairing.ts";
import { verifyCrewSignature as pluginVerifyCrewSignature } from "../../../packages/crew-plugin/src/shared/signature.ts";
import { deriveMachineKey, verifyCrewSignature, verifyMachineRequest } from "../crew/jev-machine-auth.js";

/** Cùng thuật toán với `signCrewBody` của crew-mac (`apps/crew-mac/src/status/sign.ts`, repo crew). */
function signLikeCrewMac(body: string, secret: string, nowSec: number) {
  const timestamp = String(Math.floor(nowSec));
  const hex = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return { "X-Crew-Timestamp": timestamp, "X-Crew-Signature": `sha256=${hex}` };
}

/** Cách e2e ký bản tin máy: `createHmac` nối từng phần. */
function signLikeE2e(body: string, secret: string, nowSec: number) {
  const timestamp = String(nowSec);
  const hex = createHmac("sha256", secret).update(timestamp).update(".").update(body).digest("hex");
  return { "x-crew-timestamp": timestamp, "x-crew-signature": `sha256=${hex}` };
}

function fakeRequest(rawBody: string | undefined, headers: Record<string, string>): Request {
  const lower = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return { headers: lower, rawBody: rawBody === undefined ? undefined : Buffer.from(rawBody, "utf8") } as unknown as Request;
}

async function statusOf(promise: Promise<unknown>): Promise<{ status: number; code: unknown }> {
  try {
    await promise;
    return { status: 200, code: null };
  } catch (error) {
    const err = error as { status?: number; details?: { code?: unknown } };
    return { status: err.status ?? 0, code: err.details?.code };
  }
}

describe("Crew Jev: khóa máy và chữ ký giống plugin", () => {
  const companySecret = "company-secret-for-tests-only";
  const companyId = randomUUID();
  const machineId = randomUUID();

  it("khóa máy giống hệt deriveMachineKey của plugin, kể cả uuid viết hoa", () => {
    for (const nonce of ["n1", "abc-DEF_123", "x".repeat(43)]) {
      expect(deriveMachineKey(companySecret, companyId, machineId, nonce)).toBe(
        pluginDeriveMachineKey(companySecret, companyId, machineId, nonce),
      );
      expect(deriveMachineKey(companySecret, companyId.toUpperCase(), machineId.toUpperCase(), nonce)).toBe(
        pluginDeriveMachineKey(companySecret, companyId, machineId, nonce),
      );
    }
    expect(deriveMachineKey(companySecret, companyId, machineId, "a")).not.toBe(
      deriveMachineKey(companySecret, companyId, machineId, "b"),
    );
  });

  it("kiểm chữ ký cho cùng kết quả với plugin", () => {
    const now = 1_800_000_000;
    const body = JSON.stringify({ version: 1, companyId, machineId });
    const cases: Array<Record<string, string>> = [
      signLikeCrewMac(body, companySecret, now),
      signLikeE2e(body, companySecret, now),
      signLikeE2e(body, "wrong-secret", now),
      signLikeE2e(body, companySecret, now - 301),
      signLikeE2e(body, companySecret, now + 300),
      { "x-crew-timestamp": String(now) },
      { "x-crew-timestamp": "01", "x-crew-signature": "sha256=00" },
      { "x-crew-timestamp": String(now), "x-crew-signature": "sha256=zz" },
    ];
    const results = cases.map((headers) => verifyCrewSignature(body, headers, companySecret, now));
    expect(results).toEqual(cases.map((headers) => pluginVerifyCrewSignature(body, headers, companySecret, now)));
    expect(results).toEqual(["ok", "ok", "bad", "stale", "ok", "missing", "bad", "bad"]);
  });

  it("verifyMachineRequest nhận chữ ký kiểu crew-mac và kiểu e2e", async () => {
    const now = Math.floor(Date.now() / 1000);
    const key = deriveMachineKey(companySecret, companyId, machineId, "nonce");
    const body = JSON.stringify({ version: 1, companyId, machineId, sentAt: new Date().toISOString() });
    const seen: Array<[string, string]> = [];
    const resolveSecret = async (cid: string, mid: string) => {
      seen.push([cid, mid]);
      return key;
    };
    for (const headers of [signLikeCrewMac(body, key, now), signLikeE2e(body, key, now)]) {
      const verified = await verifyMachineRequest(fakeRequest(body, headers), {
        companyId, maxBytes: 4096, resolveSecret, nowSec: now,
      });
      expect(verified.companyId).toBe(companyId);
      expect(verified.machineId).toBe(machineId);
      expect(verified.body).toEqual(JSON.parse(body));
    }
    expect(seen).toEqual([[companyId, machineId], [companyId, machineId]]);
  });

  it("verifyMachineRequest từ chối đúng mã lỗi", async () => {
    const now = Math.floor(Date.now() / 1000);
    const key = "machine-key";
    const resolveSecret = async () => key;
    const check = (raw: string | undefined, headers: Record<string, string>, opts: Partial<{ companyId: string; maxBytes: number }> = {}) =>
      statusOf(verifyMachineRequest(fakeRequest(raw, headers), {
        companyId: opts.companyId ?? companyId, maxBytes: opts.maxBytes ?? 4096, resolveSecret, nowSec: now,
      }));
    const body = JSON.stringify({ version: 1, companyId, machineId });
    const signed = signLikeE2e(body, key, now);

    expect(await check(body, signLikeE2e(body, "other", now))).toEqual({ status: 401, code: "bad_signature" });
    expect(await check(body, {})).toEqual({ status: 401, code: "missing_signature" });
    expect(await check(body, signLikeE2e(body, key, now - 400))).toEqual({ status: 401, code: "stale_signature" });
    expect(await check(body, signed, { maxBytes: 10 })).toEqual({ status: 413, code: "body_too_large" });
    expect(await check(undefined, signed)).toEqual({ status: 400, code: "invalid_body" });
    expect(await check("{not json", signLikeE2e("{not json", key, now))).toEqual({ status: 400, code: "invalid_body" });
    expect(await check(body, signed, { companyId: randomUUID() })).toEqual({ status: 400, code: "company_mismatch" });
    const noMachine = JSON.stringify({ version: 1, companyId, machineId: "nope" });
    expect(await check(noMachine, signLikeE2e(noMachine, key, now))).toEqual({ status: 400, code: "invalid_body" });
    const v2 = JSON.stringify({ version: 2, companyId, machineId });
    expect(await check(v2, signLikeE2e(v2, key, now))).toEqual({ status: 400, code: "invalid_body" });
    // Body bị sửa sau khi ký (khác một byte) không qua.
    const tampered = body.replace(machineId, machineId.toUpperCase());
    expect(await check(tampered, signed)).toEqual({ status: 401, code: "bad_signature" });
  });
});

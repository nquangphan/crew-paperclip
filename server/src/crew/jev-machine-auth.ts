import { createHmac, timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Request } from "express";
import type { Db } from "@paperclipai/db";
import { HttpError } from "../errors.js";
import { derivePluginDatabaseNamespace } from "../services/plugin-database.js";
import { secretService } from "../services/secrets.js";
import { CREW_PLUGIN_KEY, rowsOf } from "./project-roles.js";

/**
 * Xác thực request do Mac ký (route `/jev/machine/*`). Luật giống hệt webhook máy của plugin `crew.core`
 * (`packages/crew-plugin/src/shared/webhook.ts` `authenticateCrewWebhook` + `verificationSecret`): server không import được
 * plugin lúc build, nên hai hàm thuần ({@link deriveMachineKey}, {@link verifyCrewSignature}) được chép sang đây và có test
 * hợp đồng gọi chính bản của plugin để hai bên không lệch.
 */

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

export type MachineAuthErrorCode =
  | "missing_signature"
  | "bad_signature"
  | "stale_signature"
  | "body_too_large"
  | "invalid_body"
  | "company_mismatch"
  | "unknown_company"
  | "secret_unavailable"
  | "pairing_unavailable"
  | "machine_revoked";

const STATUS: Record<MachineAuthErrorCode, number> = {
  missing_signature: 401,
  bad_signature: 401,
  stale_signature: 401,
  body_too_large: 413,
  invalid_body: 400,
  company_mismatch: 400,
  unknown_company: 404,
  secret_unavailable: 503,
  pairing_unavailable: 503,
  machine_revoked: 403,
};

const MESSAGE: Record<MachineAuthErrorCode, string> = {
  missing_signature: "Thiếu chữ ký máy.",
  bad_signature: "Chữ ký máy không hợp lệ.",
  stale_signature: "Chữ ký máy đã quá hạn (lệch giờ hơn 5 phút).",
  body_too_large: "Bản tin quá lớn.",
  invalid_body: "Bản tin không hợp lệ.",
  company_mismatch: "companyId trong bản tin không khớp đường dẫn.",
  unknown_company: "Company chưa có cấu hình Crew.",
  secret_unavailable: "Chưa đọc được secret webhook của company.",
  pairing_unavailable: "Chưa đọc được thông tin ghép máy.",
  machine_revoked: "Máy đã bị gỡ khỏi company.",
};

export function machineAuthError(code: MachineAuthErrorCode): HttpError {
  return new HttpError(STATUS[code], MESSAGE[code], { code });
}

export type CrewHeaders = Record<string, string | string[] | undefined>;
export type CrewSignatureResult = "ok" | "missing" | "bad" | "stale";

function crewHeader(headers: CrewHeaders, name: string): string | undefined {
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return typeof entry?.[1] === "string" ? entry[1] : undefined;
}

/** Bản chép của `deriveMachineKey` (`packages/crew-plugin/src/machines/pairing.ts`). */
export function deriveMachineKey(companySecret: string, companyId: string, machineId: string, nonce: string): string {
  return createHmac("sha256", companySecret)
    .update(`crew-machine-key/v1\n${companyId.toLowerCase()}\n${machineId.toLowerCase()}\n${nonce}`)
    .digest("base64url");
}

/** Bản chép của `verifyCrewSignature` (`packages/crew-plugin/src/shared/signature.ts`). */
export function verifyCrewSignature(
  rawBody: string,
  headers: CrewHeaders,
  secret: string,
  nowSec: number,
): CrewSignatureResult {
  const timestamp = crewHeader(headers, "x-crew-timestamp");
  const signature = crewHeader(headers, "x-crew-signature");
  if (!timestamp || !signature) return "missing";
  if (!/^(0|[1-9][0-9]*)$/.test(timestamp)) return "bad";
  const sentAt = Number(timestamp);
  if (!Number.isSafeInteger(sentAt) || !Number.isSafeInteger(nowSec)) return "bad";
  if (Math.abs(nowSec - sentAt) > 300) return "stale";
  if (!/^sha256=[0-9a-fA-F]{64}$/.test(signature)) return "bad";
  const expected = createHmac("sha256", secret).update(timestamp).update(".").update(rawBody).digest();
  const received = Buffer.from(signature.slice(7), "hex");
  return timingSafeEqual(expected, received) ? "ok" : "bad";
}

type Sql = Pick<Db, "execute">;

interface SecretRef {
  secretId: string;
  version: number | "latest";
}

function secretRefOf(value: unknown): SecretRef | null {
  if (!value || typeof value !== "object") return null;
  const ref = value as Record<string, unknown>;
  if (ref.type !== "secret_ref" || typeof ref.secretId !== "string" || !UUID.test(ref.secretId)) return null;
  if (ref.version === undefined || ref.version === "latest") return { secretId: ref.secretId, version: "latest" };
  if (typeof ref.version === "number" && Number.isInteger(ref.version) && ref.version > 0) {
    return { secretId: ref.secretId, version: ref.version };
  }
  return null;
}

/** Secret company đã đọc, giữ trong process {@link SECRET_CACHE_MS} để mỗi bản tin máy không ghi một access event. */
const SECRET_CACHE_MS = 60_000;
const secretCache = new Map<string, { value: string; expiresAt: number }>();

/**
 * Secret webhook của company, đọc như plugin: `plugin_config` của `crew.core` cho company đó →
 * `companies[].webhookSecretRef` → giá trị secret. Không có cấu hình → `404 unknown_company`; không đọc được → `503`.
 * Giá trị được cache theo `(companyId, secretId, version)` trong 60 s; secret webhook vừa đổi thì chữ ký mới có thể bị
 * từ chối tối đa 60 s.
 */
export async function resolveCrewCompanySecret(db: Db, companyId: string, now: number = Date.now()): Promise<string> {
  let config: unknown;
  try {
    const rows = rowsOf(
      await db.execute(sql`SELECT pc.config_json FROM "plugin_config" pc
        JOIN "plugins" p ON p.id = pc.plugin_id
        WHERE p.plugin_key = ${CREW_PLUGIN_KEY} AND p.status <> 'uninstalled' AND pc.company_id = ${companyId}
        LIMIT 1`),
    );
    config = rows[0]?.config_json;
  } catch {
    throw machineAuthError("secret_unavailable");
  }
  const companies =
    config && typeof config === "object" && Array.isArray((config as Record<string, unknown>).companies)
      ? ((config as Record<string, unknown>).companies as unknown[])
      : [];
  const item = companies.find(
    (candidate) =>
      candidate !== null &&
      typeof candidate === "object" &&
      typeof (candidate as Record<string, unknown>).companyId === "string" &&
      ((candidate as Record<string, unknown>).companyId as string).toLowerCase() === companyId.toLowerCase(),
  ) as Record<string, unknown> | undefined;
  const ref = secretRefOf(item?.webhookSecretRef);
  if (!ref) throw machineAuthError("unknown_company");

  const cacheKey = `${companyId.toLowerCase()}:${ref.secretId}:${ref.version}`;
  const cached = secretCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.value;
  let secret: string;
  try {
    secret = await secretService(db).resolveSecretValue(companyId, ref.secretId, ref.version, {
      accessContext: {
        consumerType: "system",
        consumerId: "crew-jev-machine-auth",
        configPath: "crew.core.companies.webhookSecretRef",
        actorType: "system",
      },
    });
  } catch {
    throw machineAuthError("secret_unavailable");
  }
  if (!secret) throw machineAuthError("secret_unavailable");
  for (const [key, entry] of secretCache) if (entry.expiresAt <= now) secretCache.delete(key);
  secretCache.set(cacheKey, { value: secret, expiresAt: now + SECRET_CACHE_MS });
  return secret;
}

/**
 * Secret phải ký bản tin của máy này, đúng luật `verificationSecret` của plugin: có dòng `machine_pairings` thì dùng khóa
 * máy suy ra, bị thu hồi thì `403 machine_revoked`; không có dòng (máy ghép trước khi có ghép tự động) thì dùng secret
 * company.
 *
 * Hai chỗ chặt hơn plugin, có chủ ý: `machineId` không phải uuid bị {@link verifyMachineRequest} trả 400 (plugin dùng
 * secret company rồi để HMAC quyết), và `companyId` được so không phân biệt hoa thường rồi chuyển về chữ thường.
 */
export async function machineSecret(db: Sql, companyId: string, machineId: string, companySecret: string): Promise<string> {
  let rows: Array<Record<string, unknown>>;
  try {
    rows = rowsOf(
      await db.execute(sql`SELECT key_nonce, revoked_at IS NOT NULL AS revoked
        FROM ${sql.raw(`${derivePluginDatabaseNamespace(CREW_PLUGIN_KEY)}.machine_pairings`)}
        WHERE company_id = ${companyId} AND machine_id = ${machineId}`),
    );
  } catch {
    throw machineAuthError("pairing_unavailable");
  }
  const row = rows[0];
  if (!row) return companySecret;
  if (row.revoked === true) throw machineAuthError("machine_revoked");
  return deriveMachineKey(companySecret, companyId, machineId, String(row.key_nonce));
}

export interface VerifiedMachineRequest {
  companyId: string;
  machineId: string;
  body: Record<string, unknown>;
}

/**
 * Kiểm một request do Mac ký, theo thứ tự của `authenticateCrewWebhook` ở plugin: kích thước → dạng header và lệch
 * ±300 s → JSON → `companyId` khớp đường dẫn → `machineId` là uuid → secret của máy → HMAC trên `req.rawBody`
 * (`timingSafeEqual`) → `version === 1`. Mọi bước rẻ chạy trước khi đọc secret, nên request giả hay cũ không chạm bảng
 * secret. Body chỉ được trả về sau khi chữ ký đúng.
 */
export async function verifyMachineRequest(
  req: Request,
  opts: {
    companyId: string;
    maxBytes: number;
    resolveSecret: (companyId: string, machineId: string) => Promise<string>;
    nowSec?: number;
  },
): Promise<VerifiedMachineRequest> {
  const raw = (req as { rawBody?: unknown }).rawBody;
  if (!Buffer.isBuffer(raw)) throw machineAuthError("invalid_body");
  if (raw.byteLength > opts.maxBytes) throw machineAuthError("body_too_large");
  const timestamp = crewHeader(req.headers, "x-crew-timestamp");
  const signature = crewHeader(req.headers, "x-crew-signature");
  if (!timestamp || !signature) throw machineAuthError("missing_signature");
  if (!/^(0|[1-9][0-9]*)$/.test(timestamp) || !Number.isSafeInteger(Number(timestamp))) {
    throw machineAuthError("bad_signature");
  }
  const nowSec = opts.nowSec ?? Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - Number(timestamp)) > 300) throw machineAuthError("stale_signature");
  if (!/^sha256=[0-9a-fA-F]{64}$/.test(signature)) throw machineAuthError("bad_signature");
  const rawBody = raw.toString("utf8");

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw machineAuthError("invalid_body");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw machineAuthError("invalid_body");
  const body = parsed as Record<string, unknown>;
  if (typeof body.companyId !== "string" || !UUID.test(body.companyId)) throw machineAuthError("invalid_body");
  if (body.companyId.toLowerCase() !== opts.companyId.toLowerCase()) throw machineAuthError("company_mismatch");
  if (typeof body.machineId !== "string" || !UUID.test(body.machineId)) throw machineAuthError("invalid_body");
  const companyId = body.companyId.toLowerCase();
  const machineId = body.machineId.toLowerCase();

  const secret = await opts.resolveSecret(companyId, machineId);
  const result = verifyCrewSignature(rawBody, req.headers, secret, nowSec);
  if (result !== "ok") {
    throw machineAuthError(result === "stale" ? "stale_signature" : result === "missing" ? "missing_signature" : "bad_signature");
  }
  if (body.version !== 1) throw machineAuthError("invalid_body");
  return { companyId, machineId, body };
}

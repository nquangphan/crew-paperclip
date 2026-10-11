import { createHmac, randomBytes } from "node:crypto";
import type { PluginApiRequestInput, PluginApiResponse, PluginContext } from "@paperclipai/plugin-sdk";
import { pluginNamespace, UUID } from "../shared/db.js";
import { CrewWebhookError, resolveCompanyWebhookSecret } from "../shared/webhook.js";

/** Config key holding the public key Paperclip uses to SSH into Crew machines (set once by ops per company). */
export const PAPERCLIP_SSH_PUBLIC_KEY_CONFIG_KEY = "paperclipSshPublicKey";
export const PAPERCLIP_SSH_PUBLIC_KEY_PATTERN = "^ssh-ed25519 [A-Za-z0-9+/=]+( .*)?$";

type Ctx = Pick<PluginContext, "db" | "config" | "secrets" | "logger">;

const ROUTES = ["machines.pair-info", "machines.pair", "machines.unpair"];
const PAIR_KEYS = ["companyId", "machineId", "hostname", "environmentId", "tailscaleIp", "port", "hostKeyFingerprint"];
/** Optional key: only an explicit owner action ("ghép lại máy đã gỡ") sends it. */
const ALLOW_REPAIR_KEY = "allowRepair";
const FORBIDDEN = "Chỉ người dùng board được ghép hoặc gỡ máy";
const NO_PUBLIC_KEY = "Server chưa có key Paperclip";
const NO_SECRET = "Company chưa có secret webhook";
const UNKNOWN_MACHINE = "Không có máy này trong company";
const PAIRING_ERROR = "Không đọc/ghi được thông tin ghép máy";
const REVOKED = "Máy đã bị gỡ, owner phải cho phép ghép lại";
const USES_COMPANY_SECRET = "Máy đang gửi bản tin bằng secret company, không ghép đè được";
const FINGERPRINT = /^SHA256:[A-Za-z0-9+/]{43}$/;
const PUBLIC_KEY = new RegExp(PAPERCLIP_SSH_PUBLIC_KEY_PATTERN);

const bad = (error: string): PluginApiResponse => ({ status: 400, body: { error } });
const uuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);
const table = (ctx: Pick<PluginContext, "db">) => `${pluginNamespace(ctx)}.machine_pairings`;
const iso = (value: string | Date | null) => (value === null ? null : new Date(value).toISOString());

/**
 * Per-machine webhook key: `base64url(HMAC-SHA256(companySecret, "crew-machine-key/v1\n" + companyId + "\n" +
 * machineId + "\n" + nonce))`. It is handed to the app once by `machines.pair` and recomputed by the webhook on every
 * message, so the server never stores it. A new nonce on re-pairing kills the previous key.
 */
export function deriveMachineKey(companySecret: string, companyId: string, machineId: string, nonce: string): string {
  return createHmac("sha256", companySecret)
    .update(`crew-machine-key/v1\n${companyId.toLowerCase()}\n${machineId.toLowerCase()}\n${nonce}`)
    .digest("base64url");
}

/** True for a dotted IPv4 address inside the Tailscale CGNAT range 100.64.0.0/10. */
export function isTailscaleIp(value: unknown): value is string {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]{0,2})(?:\.(?:0|[1-9][0-9]{0,2})){3}$/.test(value)) return false;
  const octets = value.split(".").map(Number);
  if (octets.some((octet) => octet > 255)) return false;
  return octets[0] === 100 && octets[1]! >= 64 && octets[1]! <= 127;
}

interface PairBody {
  machineId: string; hostname: string; environmentId: string; tailscaleIp: string; port: number; hostKeyFingerprint: string;
  allowRepair: boolean;
}

function parsePairBody(body: unknown, companyId: string): PairBody | string {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "body phải là object";
  const value = body as Record<string, unknown>;
  const unknownKey = Object.keys(value).find((key) => !PAIR_KEYS.includes(key) && key !== ALLOW_REPAIR_KEY);
  if (unknownKey) return `trường ${unknownKey} không được hỗ trợ`;
  const missing = PAIR_KEYS.find((key) => !(key in value));
  if (missing) return `thiếu trường ${missing}`;
  if (!uuid(value.companyId) || value.companyId.toLowerCase() !== companyId) return "companyId không hợp lệ";
  if (!uuid(value.machineId)) return "machineId phải là uuid";
  if (!uuid(value.environmentId)) return "environmentId phải là uuid";
  if (typeof value.hostname !== "string" || value.hostname.length < 1 || value.hostname.length > 200 || value.hostname.includes("\0")) {
    return "hostname phải dài 1 đến 200 ký tự";
  }
  if (!isTailscaleIp(value.tailscaleIp)) return "tailscaleIp phải nằm trong 100.64.0.0/10";
  if (typeof value.port !== "number" || !Number.isInteger(value.port) || value.port < 1024 || value.port > 65535) {
    return "port phải là số nguyên từ 1024 đến 65535";
  }
  if (typeof value.hostKeyFingerprint !== "string" || !FINGERPRINT.test(value.hostKeyFingerprint)) {
    return "hostKeyFingerprint phải có dạng SHA256:<43 ký tự base64>";
  }
  if (ALLOW_REPAIR_KEY in value && typeof value.allowRepair !== "boolean") return "allowRepair phải là boolean";
  return {
    machineId: value.machineId.toLowerCase(), hostname: value.hostname, environmentId: value.environmentId.toLowerCase(),
    tailscaleIp: value.tailscaleIp, port: value.port, hostKeyFingerprint: value.hostKeyFingerprint,
    allowRepair: value.allowRepair === true,
  };
}

function parseUnpairBody(body: unknown, companyId: string): true | string {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "body phải là object";
  const value = body as Record<string, unknown>;
  const unknownKey = Object.keys(value).find((key) => key !== "companyId");
  if (unknownKey) return `trường ${unknownKey} không được hỗ trợ`;
  if (!uuid(value.companyId) || value.companyId.toLowerCase() !== companyId) return "companyId không hợp lệ";
  return true;
}

async function pairInfo(ctx: Ctx, companyId: string): Promise<PluginApiResponse> {
  const config = await ctx.config.get(companyId);
  const key = config?.[PAPERCLIP_SSH_PUBLIC_KEY_CONFIG_KEY];
  if (typeof key !== "string" || !PUBLIC_KEY.test(key)) return { status: 409, body: { error: NO_PUBLIC_KEY } };
  return { status: 200, body: { paperclipSshPublicKey: key } };
}

async function pair(ctx: Ctx, input: PluginApiRequestInput, companyId: string, userId: string): Promise<PluginApiResponse> {
  const parsed = parsePairBody(input.body, companyId);
  if (typeof parsed === "string") return bad(parsed);
  let companySecret: string;
  try {
    companySecret = await resolveCompanyWebhookSecret(ctx, companyId);
  } catch (error) {
    if (!(error instanceof CrewWebhookError)) throw error;
    ctx.logger.warn("crew machine pairing has no company secret", { companyId, machineId: parsed.machineId, code: error.code });
    return { status: 409, body: { error: NO_SECRET } };
  }
  const nonce = randomBytes(32).toString("hex");
  const pairedAt = new Date().toISOString();
  const pairings = table(ctx);
  // One guarded statement, so the checks and the write cannot race:
  // - a machine without a pairing row that already reports in `machine_latest` signs with the company secret (the
  //   Mac mini); pairing it would make all its messages fail, so the INSERT selects nothing;
  // - a revoked row is only re-armed with `allowRepair`, otherwise the app could silently undo an owner's "Gỡ máy".
  //   That includes the row "Gỡ máy" writes for a company-secret machine, which is how such a machine moves to pairing.
  // The host `execute` returns only a row count (no RETURNING), so the key is derived from the nonce this call wrote:
  // a concurrent re-pair that lands later kills this key, but two callers never receive the same key.
  const written = await ctx.db.execute(
    `INSERT INTO ${pairings} (company_id,machine_id,hostname,environment_id,tailscale_ip,port,host_key_fingerprint,
       key_nonce,paired_by_user_id,paired_at,revoked_at,revoked_by_user_id)
     SELECT $1::uuid,$2::uuid,$3::text,$4::uuid,$5::text,$6::integer,$7::text,$8::text,$9::text,$11::timestamptz,NULL,NULL
     WHERE NOT EXISTS (SELECT 1 FROM ${pluginNamespace(ctx)}.machine_latest WHERE company_id = $1::uuid AND machine_id = $2::uuid)
        OR EXISTS (SELECT 1 FROM ${pairings} WHERE company_id = $1::uuid AND machine_id = $2::uuid)
     ON CONFLICT (company_id,machine_id) DO UPDATE SET hostname = EXCLUDED.hostname,
       environment_id = EXCLUDED.environment_id, tailscale_ip = EXCLUDED.tailscale_ip, port = EXCLUDED.port,
       host_key_fingerprint = EXCLUDED.host_key_fingerprint, key_nonce = EXCLUDED.key_nonce,
       paired_by_user_id = EXCLUDED.paired_by_user_id, paired_at = EXCLUDED.paired_at,
       revoked_at = NULL, revoked_by_user_id = NULL
     WHERE ${pairings}.revoked_at IS NULL OR $10::boolean`,
    [companyId, parsed.machineId, parsed.hostname, parsed.environmentId, parsed.tailscaleIp, parsed.port,
      parsed.hostKeyFingerprint, nonce, userId, parsed.allowRepair, pairedAt],
  );
  if (written.rowCount !== 1) return refusePair(ctx, companyId, parsed.machineId, userId);
  const machineKey = deriveMachineKey(companySecret, companyId, parsed.machineId, nonce);
  ctx.logger.info("crew machine paired", { companyId, machineId: parsed.machineId, userId });
  return { status: 200, body: { machineKey, pairedAt } };
}

/** Explains why the guarded upsert of `pair` wrote nothing. */
async function refusePair(ctx: Ctx, companyId: string, machineId: string, userId: string): Promise<PluginApiResponse> {
  const rows = await ctx.db.query<{ revoked: boolean }>(
    `SELECT revoked_at IS NOT NULL AS revoked FROM ${table(ctx)} WHERE company_id = $1 AND machine_id = $2`,
    [companyId, machineId],
  );
  const code = rows[0]?.revoked ? "machine_revoked" : "machine_uses_company_secret";
  ctx.logger.warn("crew machine pairing refused", { companyId, machineId, userId, code });
  return { status: 409, body: { error: code === "machine_revoked" ? REVOKED : USES_COMPANY_SECRET, code } };
}

async function unpair(ctx: Ctx, input: PluginApiRequestInput, companyId: string, userId: string): Promise<PluginApiResponse> {
  const machineId = input.params.machineId;
  if (!uuid(machineId)) return bad("machineId phải là uuid");
  const checked = parseUnpairBody(input.body, companyId);
  if (checked !== true) return bad(checked);
  const id = machineId.toLowerCase();
  // A machine that reports with the company secret has no pairing row: write one that is revoked from the start, so
  // the webhook refuses its messages (company secret included) and only an owner-approved re-pair can bring it back.
  // The row has no environment and a random nonce whose key is never handed out.
  const created = await ctx.db.execute(
    `INSERT INTO ${table(ctx)} (company_id,machine_id,hostname,environment_id,tailscale_ip,port,host_key_fingerprint,
       key_nonce,paired_by_user_id,paired_at,revoked_at,revoked_by_user_id)
     SELECT l.company_id,l.machine_id,l.hostname,NULL::uuid,NULL::text,NULL::integer,NULL::text,$3::text,NULL::text,
       NULL::timestamptz,now(),$4::text
     FROM ${pluginNamespace(ctx)}.machine_latest l WHERE l.company_id = $1::uuid AND l.machine_id = $2::uuid
     ON CONFLICT (company_id,machine_id) DO NOTHING`,
    [companyId, id, randomBytes(32).toString("hex"), userId],
  );
  await ctx.db.execute(
    `UPDATE ${table(ctx)} SET revoked_at = now(), revoked_by_user_id = $3
     WHERE company_id = $1 AND machine_id = $2 AND revoked_at IS NULL`,
    [companyId, id, userId],
  );
  const rows = await ctx.db.query<{ environment_id: string | null; revoked_at: string | Date | null }>(
    `SELECT environment_id::text AS environment_id, revoked_at FROM ${table(ctx)} WHERE company_id = $1 AND machine_id = $2`,
    [companyId, id],
  );
  const row = rows[0];
  if (!row) return { status: 404, body: { error: UNKNOWN_MACHINE } };
  ctx.logger.info("crew machine unpaired", { companyId, machineId: id, userId, usedCompanySecret: created.rowCount === 1 });
  return { status: 200, body: { environmentId: row.environment_id, revokedAt: iso(row.revoked_at) } };
}

/**
 * Machine pairing routes. The host already checked board auth and company access; the actor check keeps agents out
 * even if host rules change. The derived key appears only in the `machines.pair` response, never in a log, and DB
 * errors are logged server side without reaching the caller.
 */
export async function handleMachinesApi(ctx: Ctx, input: PluginApiRequestInput): Promise<PluginApiResponse> {
  try {
    return await routeMachines(ctx, input);
  } catch (error) {
    ctx.logger.error("crew machine pairing request failed", {
      routeKey: input.routeKey, companyId: input.companyId, err: error instanceof Error ? error.message : String(error),
    });
    return { status: 500, body: { error: PAIRING_ERROR } };
  }
}

async function routeMachines(ctx: Ctx, input: PluginApiRequestInput): Promise<PluginApiResponse> {
  if (!ROUTES.includes(input.routeKey)) return { status: 404, body: { error: "Route không tồn tại" } };
  if (input.actor.actorType !== "user") return { status: 403, body: { error: FORBIDDEN } };
  if (!uuid(input.companyId)) return bad("companyId phải là uuid");
  const companyId = input.companyId.toLowerCase();
  if (input.routeKey === "machines.pair-info") return pairInfo(ctx, companyId);
  const userId = input.actor.userId ?? input.actor.actorId;
  if (input.routeKey === "machines.pair") return pair(ctx, input, companyId, userId);
  return unpair(ctx, input, companyId, userId);
}

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
const FORBIDDEN = "Chỉ người dùng board được ghép hoặc gỡ máy";
const NO_PUBLIC_KEY = "Server chưa có key Paperclip";
const NO_SECRET = "Company chưa có secret webhook";
const NOT_PAIRED = "Máy chưa được ghép";
const PAIRING_ERROR = "Không đọc/ghi được thông tin ghép máy";
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
}

function parsePairBody(body: unknown, companyId: string): PairBody | string {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "body phải là object";
  const value = body as Record<string, unknown>;
  const unknownKey = Object.keys(value).find((key) => !PAIR_KEYS.includes(key));
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
  return {
    machineId: value.machineId.toLowerCase(), hostname: value.hostname, environmentId: value.environmentId.toLowerCase(),
    tailscaleIp: value.tailscaleIp, port: value.port, hostKeyFingerprint: value.hostKeyFingerprint,
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
  await ctx.db.execute(
    `INSERT INTO ${table(ctx)} (company_id,machine_id,hostname,environment_id,tailscale_ip,port,host_key_fingerprint,
       key_nonce,paired_by_user_id,paired_at,revoked_at,revoked_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now(),NULL,NULL)
     ON CONFLICT (company_id,machine_id) DO UPDATE SET hostname = EXCLUDED.hostname,
       environment_id = EXCLUDED.environment_id, tailscale_ip = EXCLUDED.tailscale_ip, port = EXCLUDED.port,
       host_key_fingerprint = EXCLUDED.host_key_fingerprint, key_nonce = EXCLUDED.key_nonce,
       paired_by_user_id = EXCLUDED.paired_by_user_id, paired_at = EXCLUDED.paired_at,
       revoked_at = NULL, revoked_by_user_id = NULL`,
    [companyId, parsed.machineId, parsed.hostname, parsed.environmentId, parsed.tailscaleIp, parsed.port,
      parsed.hostKeyFingerprint, nonce, userId],
  );
  // No host transaction: read back the row and derive from the nonce actually stored, so a concurrent re-pair can
  // never hand out a key the webhook will not accept.
  const rows = await ctx.db.query<{ key_nonce: string; paired_at: string | Date }>(
    `SELECT key_nonce, paired_at FROM ${table(ctx)} WHERE company_id = $1 AND machine_id = $2 AND revoked_at IS NULL`,
    [companyId, parsed.machineId],
  );
  const row = rows[0];
  if (!row) throw new Error("Dòng ghép máy vừa ghi không còn");
  const machineKey = deriveMachineKey(companySecret, companyId, parsed.machineId, row.key_nonce);
  ctx.logger.info("crew machine paired", { companyId, machineId: parsed.machineId, userId });
  return { status: 200, body: { machineKey, pairedAt: iso(row.paired_at) } };
}

async function unpair(ctx: Ctx, input: PluginApiRequestInput, companyId: string, userId: string): Promise<PluginApiResponse> {
  const machineId = input.params.machineId;
  if (!uuid(machineId)) return bad("machineId phải là uuid");
  const checked = parseUnpairBody(input.body, companyId);
  if (checked !== true) return bad(checked);
  const id = machineId.toLowerCase();
  await ctx.db.execute(
    `UPDATE ${table(ctx)} SET revoked_at = now(), revoked_by_user_id = $3
     WHERE company_id = $1 AND machine_id = $2 AND revoked_at IS NULL`,
    [companyId, id, userId],
  );
  const rows = await ctx.db.query<{ environment_id: string; revoked_at: string | Date | null }>(
    `SELECT environment_id::text AS environment_id, revoked_at FROM ${table(ctx)} WHERE company_id = $1 AND machine_id = $2`,
    [companyId, id],
  );
  const row = rows[0];
  if (!row) return { status: 404, body: { error: NOT_PAIRED } };
  ctx.logger.info("crew machine unpaired", { companyId, machineId: id, userId });
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

import type { PluginContext, PluginWebhookInput } from "@paperclipai/plugin-sdk";
import { crewHeader, verifyCrewSignature } from "./signature.js";

export type CrewWebhookErrorCode =
  | "body_too_large"
  | "missing_signature"
  | "bad_signature"
  | "stale_signature"
  | "unknown_company"
  | "config_unavailable"
  | "secret_unavailable"
  | "invalid_body";

type WebhookHandler = (input: PluginWebhookInput) => Promise<void>;
const webhookHandlers = new Map<string, WebhookHandler>();

export function registerCrewWebhook(endpointKey: string, handler: WebhookHandler): void {
  if (webhookHandlers.has(endpointKey)) throw new Error(`Webhook ${endpointKey} đã được đăng ký`);
  webhookHandlers.set(endpointKey, handler);
}

export async function dispatchCrewWebhook(input: PluginWebhookInput): Promise<void> {
  const handler = webhookHandlers.get(input.endpointKey);
  if (!handler) throw new Error(`Webhook ${input.endpointKey} chưa có handler`);
  await handler(input);
}

export class CrewWebhookError extends Error {
  constructor(readonly code: CrewWebhookErrorCode) {
    super(code);
    this.name = "CrewWebhookError";
  }
}

type SecretRef = { type: "secret_ref"; secretId: string; version?: "latest" | number };
function isSecretRef(value: unknown): value is SecretRef {
  if (!value || typeof value !== "object") return false;
  const ref = value as Record<string, unknown>;
  return ref.type === "secret_ref" && typeof ref.secretId === "string"
    && /^[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$/.test(ref.secretId)
    && (ref.version === undefined || ref.version === "latest" || (Number.isInteger(ref.version) && Number(ref.version) > 0));
}

function selectCompany(body: unknown): string {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new CrewWebhookError("invalid_body");
  const companyId = (body as Record<string, unknown>).companyId;
  if (typeof companyId !== "string" || !/^[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$/.test(companyId)) {
    throw new CrewWebhookError("invalid_body");
  }
  return companyId;
}

/** Verify the common envelope. Endpoint handlers validate their full message schema before writing. */
export async function authenticateCrewWebhook(
  input: PluginWebhookInput,
  ctx: PluginContext,
  options: { maxBytes: number; nowSec?: number },
): Promise<{ companyId: string; body: Record<string, unknown> }> {
  if (Buffer.byteLength(input.rawBody, "utf8") > options.maxBytes) throw new CrewWebhookError("body_too_large");
  const timestamp = crewHeader(input.headers, "x-crew-timestamp");
  const signature = crewHeader(input.headers, "x-crew-signature");
  if (!timestamp || !signature) throw new CrewWebhookError("missing_signature");
  if (!/^(0|[1-9][0-9]*)$/.test(timestamp) || !Number.isSafeInteger(Number(timestamp))) {
    throw new CrewWebhookError("bad_signature");
  }
  const nowSec = options.nowSec ?? Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - Number(timestamp)) > 300) throw new CrewWebhookError("stale_signature");

  // Parse only enough untrusted input to select the company secret. The full
  // payload is not passed to a feature handler until HMAC succeeds.
  let parsed: unknown;
  try { parsed = JSON.parse(input.rawBody); }
  catch { throw new CrewWebhookError("invalid_body"); }
  const companyId = selectCompany(parsed);
  let config: Record<string, unknown>;
  try { config = await ctx.config.get(companyId); }
  catch { throw new CrewWebhookError("config_unavailable"); }
  const companies = Array.isArray(config.companies) ? config.companies : [];
  const item = companies.find((candidate: unknown) =>
    candidate && typeof candidate === "object" && (candidate as Record<string, unknown>).companyId === companyId
  ) as Record<string, unknown> | undefined;
  if (!item || !isSecretRef(item.webhookSecretRef)) throw new CrewWebhookError("unknown_company");
  let secret: string;
  try { secret = await ctx.secrets.resolve(item.webhookSecretRef, { companyId }); }
  catch { throw new CrewWebhookError("secret_unavailable"); }
  if (!secret) throw new CrewWebhookError("secret_unavailable");
  const result = verifyCrewSignature(input.rawBody, input.headers, secret, nowSec);
  if (result !== "ok") throw new CrewWebhookError(result === "stale" ? "stale_signature" : result === "missing" ? "missing_signature" : "bad_signature");
  if ((parsed as Record<string, unknown>).version !== 1) throw new CrewWebhookError("invalid_body");
  return { companyId, body: parsed as Record<string, unknown> };
}

import { createHmac, timingSafeEqual } from "node:crypto";

export type CrewSignatureResult = "ok" | "missing" | "bad" | "stale";
export type CrewHeaders = Record<string, string | string[] | undefined>;

export function crewHeader(headers: CrewHeaders, name: string): string | undefined {
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return typeof entry?.[1] === "string" ? entry[1] : undefined;
}

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

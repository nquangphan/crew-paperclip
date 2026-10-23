import express, { type Request, type RequestHandler, type Response } from "express";

/**
 * Crew machines post the whole `docs/` tree of a repo as one HMAC-signed snapshot, and a large docs repo outgrows the
 * global 10 MB JSON parser. Only this route gets the larger parser; the crew.core webhook checks the same byte cap
 * after auth (`DOCS_SNAPSHOT_MAX_BYTES`), and crew-mac stops before sending more (`DOCS_BODY_MAX_BYTES`).
 */
export const CREW_DOCS_SNAPSHOT_WEBHOOK_PATH = "/api/plugins/crew.core/webhooks/docs-snapshot";
export const CREW_DOCS_SNAPSHOT_BODY_LIMIT_BYTES = 16 * 1024 * 1024;

/** Mounted before the global parser, which then skips the already-parsed body. `verify` keeps the raw bytes for HMAC. */
export function crewDocsSnapshotJson(verify: (req: Request, res: Response, buf: Buffer) => void): RequestHandler {
  return express.json({ limit: CREW_DOCS_SNAPSHOT_BODY_LIMIT_BYTES, verify });
}

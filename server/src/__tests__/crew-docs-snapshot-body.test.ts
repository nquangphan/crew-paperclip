import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import {
  CREW_DOCS_SNAPSHOT_BODY_LIMIT_BYTES,
  CREW_DOCS_SNAPSHOT_WEBHOOK_PATH,
  crewDocsSnapshotJson,
} from "../crew/docs-snapshot-body.js";

/** Same order as `createApp`: docs snapshot parser, then the global 10 MB parser, then the stock plugin webhook route. */
function app() {
  const a = express();
  const capture = (req: express.Request, _res: express.Response, buf: Buffer) => {
    (req as unknown as { rawBody: Buffer }).rawBody = buf;
  };
  a.use(CREW_DOCS_SNAPSHOT_WEBHOOK_PATH, crewDocsSnapshotJson(capture));
  a.use(express.json({ limit: "10mb", verify: capture }));
  a.post("/api/plugins/:pluginId/webhooks/:key", (req, res) => {
    res.json({ raw: (req as unknown as { rawBody?: Buffer }).rawBody?.length ?? 0, n: req.body.x.length });
  });
  return a;
}

const body = (bytes: number) => JSON.stringify({ x: "y".repeat(bytes - 8) });

describe("Crew docs snapshot JSON parser", () => {
  it("accepts a 12 MB snapshot and keeps the exact raw bytes", async () => {
    const payload = body(12 * 1024 * 1024);
    const res = await request(app()).post(CREW_DOCS_SNAPSHOT_WEBHOOK_PATH).set("content-type", "application/json").send(payload);
    expect(res.status).toBe(200);
    expect(res.body.raw).toBe(Buffer.byteLength(payload));
  });

  it("rejects a snapshot over 16 MB", async () => {
    const res = await request(app())
      .post(CREW_DOCS_SNAPSHOT_WEBHOOK_PATH)
      .set("content-type", "application/json")
      .send(body(CREW_DOCS_SNAPSHOT_BODY_LIMIT_BYTES + 1024));
    expect(res.status).toBe(413);
  });

  it("leaves other plugin webhooks on the global 10 MB limit", async () => {
    const res = await request(app())
      .post("/api/plugins/crew.core/webhooks/machine-status")
      .set("content-type", "application/json")
      .send(body(12 * 1024 * 1024));
    expect(res.status).toBe(413);
  });
});

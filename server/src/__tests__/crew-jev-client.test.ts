import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const KEY = `sk-or-test-${"d4".repeat(16)}`;
const question = { ok: { type: "noul" as const, question: "Is this a connectivity check?" } };

describe("Crew Jev: client gọi bản jev-use vendored", () => {
  let stub: Server;
  let reply: { status: number; body: string } = { status: 200, body: "{}" };
  const savedBaseUrl = process.env.CREW_JEV_BASE_URL;

  beforeAll(async () => {
    stub = createServer((req, res) => {
      req.resume();
      req.on("end", () => {
        res.writeHead(reply.status, { "content-type": "application/json" });
        res.end(reply.body);
      });
    });
    await new Promise<void>((resolve) => stub.listen(0, "127.0.0.1", resolve));
    process.env.CREW_JEV_BASE_URL = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    if (savedBaseUrl === undefined) delete process.env.CREW_JEV_BASE_URL;
    else process.env.CREW_JEV_BASE_URL = savedBaseUrl;
    await new Promise<void>((resolve) => stub.close(() => resolve()));
  });

  afterEach(() => {
    vi.doUnmock("../crew/vendor/jev-use-0.8.0.js");
    vi.resetModules();
  });

  const judge = async () => {
    const { jevJudge } = await import("../crew/jev-client.js");
    return jevJudge({ apiKey: KEY, model: "typesafe/jev-1.14", timeoutMs: 1000, state: "s", questions: question });
  };

  it("trả lời đúng qua bundle vendored", async () => {
    reply = { status: 200, body: JSON.stringify({ model: "typesafe/jev-1.14-x", answers: { ok: { type: "noul", noul: 0.95 } } }) };
    const result = await judge();
    expect(result).toMatchObject({ ok: true, model: "typesafe/jev-1.14-x" });
    if (result.ok) expect(result.answers.ok).toMatchObject({ answer: 0.95, escalated: false });
  });

  it("401/403 là auth, 5xx là unreachable, body không phải JSON là bad_response", async () => {
    for (const [status, body, code] of [
      [401, JSON.stringify({ error: { message: `bad key ${KEY}` } }), "auth"],
      [403, "{}", "auth"],
      [500, "{}", "unreachable"],
      [404, "{}", "unreachable"],
      [200, "<html>not json</html>", "bad_response"],
      [200, JSON.stringify({ nothing: true }), "bad_response"],
    ] as const) {
      reply = { status, body };
      const result = await judge();
      expect(result, `${status} ${body}`).toMatchObject({ ok: false, errorCode: code });
      expect(JSON.stringify(result)).not.toContain(KEY);
    }
  });

  it("bundle nạp hỏng: chỉ Jev báo internal, router Crew vẫn tạo được", async () => {
    vi.doMock("../crew/vendor/jev-use-0.8.0.js", () => {
      throw new Error("bundle hỏng");
    });
    expect(await judge()).toMatchObject({ ok: false, errorCode: "internal" });
    const { crewContributionRoutes } = await import("../crew/contribution-routes.js");
    expect(typeof crewContributionRoutes({} as never)).toBe("function");

    // Lần nạp hỏng không bị cache: gỡ mock là chạy lại được.
    vi.doUnmock("../crew/vendor/jev-use-0.8.0.js");
    reply = { status: 200, body: JSON.stringify({ answers: { ok: { type: "noul", noul: 0.9 } } }) };
    const { jevJudge } = await import("../crew/jev-client.js");
    expect(await jevJudge({ apiKey: KEY, model: "typesafe/jev-1.14", timeoutMs: 1000, state: "s", questions: question }))
      .toMatchObject({ ok: true });
  });

  it("hàm che của plugin cho cùng kết quả với redactSecrets của bản vendored", async () => {
    const { loadJevUse } = await import("../crew/vendor/jev-use.js");
    const { redactSecrets: pluginRedact } = await import("../../../packages/crew-plugin/src/shared/redact.ts");
    const { redactSecrets } = await loadJevUse();
    const samples = [
      `curl -H "Authorization: Bearer ${KEY}" https://x`,
      "psql postgres://app:hunter2secret@db.internal:5432/orders",
      "export GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123",
      "--password=s3cr3t --api-key $API_KEY",
      "AKIAABCDEFGHIJKLMNOP xoxb-1234567890-abc eyJhbGciOiJI.eyJzdWIiOiIx.sig",
      "lỗi bình thường không có secret",
    ];
    for (const sample of samples) expect(pluginRedact(sample), sample).toBe(redactSecrets(sample));
  });
});

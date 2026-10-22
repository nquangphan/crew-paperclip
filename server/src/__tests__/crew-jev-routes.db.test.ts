import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import request from "supertest";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { companies, companyMemberships, companySecrets, createDb, pluginConfig, plugins, secretAccessEvents } from "@paperclipai/db";
import pino from "pino";
import { CREW_POLICY_CONFIG_ENV } from "../crew/issue-policy.js";
import { deriveMachineKey } from "../crew/jev-machine-auth.js";
import { crewJevTable } from "../crew/jev-store.js";
import { validatePluginMigrationStatement } from "../services/plugin-database.js";
import { secretService } from "../services/secrets.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

const statements = (file: string) =>
  readFileSync(fileURLToPath(new URL(`../../../packages/crew-plugin/migrations/${file}`, import.meta.url)), "utf8")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);

const support = await getEmbeddedPostgresTestSupport();
const suite = support.supported ? describe.sequential : describe.skip;

/** Key thử, không phải key thật. */
const TEST_KEY = `sk-or-test-${"a1".repeat(16)}`;
const TEST_KEY_2 = `sk-or-test-${"b2".repeat(16)}`;
const WEBHOOK_SECRET = `whsec-test-${"c3".repeat(16)}`;
const fingerprint = (key: string) => createHash("sha256").update(key).digest("hex").slice(0, 12);

suite("Crew Jev: route owner và route máy", () => {
  let db: ReturnType<typeof createDb>;
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  const dir = mkdtempSync(path.join(tmpdir(), "crew-jev-routes-"));
  const configFile = path.join(dir, "crew-policy.json");
  const saved = {
    config: process.env[CREW_POLICY_CONFIG_ENV],
    masterKey: process.env.PAPERCLIP_SECRETS_MASTER_KEY,
    baseUrl: process.env.CREW_JEV_BASE_URL,
  };

  const companyId = randomUUID();
  const strangerCompanyId = randomUUID();
  const users = { owner: "jev-owner", viewer: "jev-viewer", admin: "jev-admin" };
  const roles: Record<string, string> = { [users.owner]: "owner", [users.viewer]: "viewer", [users.admin]: "admin" };
  const machines = { legacy: randomUUID(), paired: randomUUID(), revoked: randomUUID() };
  const nonce = "nonce-for-tests";

  /** Mọi response đi qua đây, để cuối suite kiểm không response nào chứa key. */
  const dumps: string[] = [];

  let stub: Server;
  let stubMode: "ok" | "fail" | "garbage" | "slow" = "ok";
  const stubAuth: string[] = [];

  beforeAll(async () => {
    process.env.PAPERCLIP_SECRETS_MASTER_KEY = randomBytes(32).toString("hex");
    stub = createServer((req: IncomingMessage, res) => {
      stubAuth.push(String(req.headers.authorization ?? ""));
      req.resume();
      req.on("end", () => {
        if (stubMode === "slow") {
          setTimeout(() => {
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ answers: { ok: { type: "noul", noul: 0.9 } } }));
          }, 1500);
          return;
        }
        if (stubMode === "garbage") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ nothing: true }));
          return;
        }
        if (stubMode === "fail") {
          res.writeHead(503, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: { message: "provider echo: Bearer leaked?" } }));
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ model: "typesafe/jev-1.14-test", answers: { ok: { type: "noul", noul: 0.9 } } }));
      });
    });
    await new Promise<void>((resolve) => stub.listen(0, "127.0.0.1", resolve));
    process.env.CREW_JEV_BASE_URL = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;

    temporary = await startEmbeddedPostgresTestDatabase("crew-jev-routes-db-");
    db = createDb(temporary.connectionString);
    for (const [id, name] of [[companyId, "Crew"], [strangerCompanyId, "Stranger"]] as const) {
      await db.insert(companies).values({
        id, name, issuePrefix: `J${id.replaceAll("-", "").slice(0, 6).toUpperCase()}`, requireBoardApprovalForNewAgents: false,
      });
    }
    process.env[CREW_POLICY_CONFIG_ENV] = configFile;
    writeFileSync(configFile, JSON.stringify({
      companies: { [companyId]: { reviewerAgentId: randomUUID(), integratorAgentId: randomUUID(), ownerUserId: users.owner } },
    }));
    await db.insert(companyMemberships).values(Object.entries(roles).map(([principalId, membershipRole]) => ({
      companyId, principalType: "user", principalId, status: "active", membershipRole,
    })));

    const webhook = await secretService(db).create(companyId, {
      name: "crew-webhook", provider: "local_encrypted", value: WEBHOOK_SECRET,
    });
    const [plugin] = await db.insert(plugins).values({
      pluginKey: "crew.core", packageName: "@crew/paperclip-plugin", version: "0.0.0", apiVersion: 1, categories: [],
      manifestJson: {} as never, status: "ready",
    }).returning();
    await db.insert(pluginConfig).values({
      pluginId: plugin!.id, companyId,
      configJson: { companies: [{ companyId, webhookSecretRef: { type: "secret_ref", secretId: webhook.id } }] },
    });
  }, 60_000);

  afterAll(async () => {
    for (const [name, value] of [
      [CREW_POLICY_CONFIG_ENV, saved.config],
      ["PAPERCLIP_SECRETS_MASTER_KEY", saved.masterKey],
      ["CREW_JEV_BASE_URL", saved.baseUrl],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await new Promise<void>((resolve) => (stub ? stub.close(() => resolve()) : resolve()));
    await db?.$client.end({ timeout: 0 });
    await temporary?.cleanup();
    rmSync(dir, { recursive: true, force: true });
  });

  /** `logLines`: gắn thêm log HTTP thật (ghi vào mảng) và `boardMutationGuard` như `createApp`. */
  async function app(actor: Record<string, unknown>, logLines?: string[]) {
    const [{ crewContributionRoutes }, { errorHandler }, { createHttpLogger }, { boardMutationGuard }] = await Promise.all([
      import("../crew/contribution-routes.js"),
      import("../middleware/index.js"),
      import("../middleware/logger.js"),
      import("../middleware/board-mutation-guard.js"),
    ]);
    const server = express();
    server.use(express.json({
      limit: "10mb",
      verify: (req, _res, buf) => {
        (req as unknown as { rawBody: Buffer }).rawBody = buf;
      },
    }));
    server.use((req, _res, next) => {
      req.actor = actor as typeof req.actor;
      next();
    });
    if (logLines) {
      server.use(createHttpLogger(pino({ level: "info" }, { write: (line: string) => void logLines.push(line) })));
      server.use("/api", boardMutationGuard());
    }
    server.use("/api", crewContributionRoutes(db));
    server.use(errorHandler);
    return server;
  }

  const as = (userId: string) =>
    app({
      type: "board", userId, source: "session", isInstanceAdmin: false, companyIds: [companyId],
      memberships: [{ companyId, membershipRole: roles[userId] ?? "viewer", status: "active" }],
    });
  const anonymous = () => app({ type: "none", source: "none" });
  const url = (suffix: string, cid = companyId) => `/api/crew/companies/${cid}/jev${suffix}`;
  const record = <T extends { status: number; body: unknown; text: string }>(res: T): T => {
    dumps.push(res.text ?? JSON.stringify(res.body));
    return res;
  };
  const owner = async () => request(await as(users.owner));

  const signed = async (
    pathSuffix: string,
    payload: Record<string, unknown> | string,
    secret: string,
    opts: { cid?: string; nowSec?: number } = {},
  ) => {
    const body = typeof payload === "string" ? payload : JSON.stringify(payload);
    const timestamp = String(opts.nowSec ?? Math.floor(Date.now() / 1000));
    const signature = `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
    return record(await request(await anonymous()).post(url(pathSuffix, opts.cid))
      .set("content-type", "application/json")
      .set("x-crew-timestamp", timestamp)
      .set("x-crew-signature", signature)
      .send(body));
  };
  const pairedKey = () => deriveMachineKey(WEBHOOK_SECRET, companyId, machines.paired, nonce);
  const pullBody = (machineId: string, extra: Record<string, unknown> = {}) => ({
    version: 1, companyId, machineId, sentAt: new Date().toISOString(), appliedVersion: null, keyFingerprint: null, ...extra,
  });

  const event = (overrides: Record<string, unknown> = {}) => ({
    v: 1, eventId: randomUUID(), ts: new Date(Date.now() - 60_000).toISOString(), companyId, runId: randomUUID(),
    agentId: randomUUID(), cwd: "/Users/crew/crew-agents/p/executor", mode: "shadow", category: null, blocking: false,
    verdict: "allow", applied: "allow", confidence: 0.9, reason: null, errorCode: null, latencyMs: 100,
    model: "typesafe/jev-1.14-test", command: "git status", ...overrides,
  });
  const eventsBody = (events: unknown[], machineId = machines.legacy) => ({
    version: 1, companyId, machineId, sentAt: new Date().toISOString(), events,
  });

  it("chưa áp migration: route owner trả 503", async () => {
    const res = record(await (await owner()).get(url("/settings")));
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("crew_jev_unavailable");

    const namespace = crewJevTable("crew_jev_settings").split(".")[0]!;
    await db.execute(sql.raw(`CREATE SCHEMA IF NOT EXISTS ${namespace}`));
    for (const statement of statements("0020_jev.sql")) validatePluginMigrationStatement(statement, namespace);
    for (const statement of [...statements("0014_machine_pairings.sql"), ...statements("0020_jev.sql")]) {
      await db.execute(sql.raw(statement));
    }
    const pairing = (machineId: string, revoked: boolean) => sql`INSERT INTO ${sql.raw(`${namespace}.machine_pairings`)}
      (company_id, machine_id, hostname, environment_id, tailscale_ip, port, host_key_fingerprint, key_nonce,
       paired_by_user_id, revoked_at)
      VALUES (${companyId}, ${machineId}, 'mac', ${randomUUID()}, '100.64.0.1', 2222, 'SHA256:x', ${nonce}, ${users.owner},
        ${revoked ? sql`now()` : sql`NULL`})`;
    await db.execute(pairing(machines.paired, false));
    await db.execute(pairing(machines.revoked, true));
  });

  it("viewer, admin, board key, agent và khách nhận 403", async () => {
    const key = await app({ type: "board", userId: users.owner, source: "board_key", companyIds: [companyId] });
    const agent = await app({ type: "agent", agentId: randomUUID(), companyId, runId: randomUUID(), source: "agent_jwt" });
    const callers = [await as(users.viewer), await as(users.admin), key, agent, await anonymous()];
    for (const caller of callers) {
      const calls = [
        request(caller).get(url("/settings")),
        request(caller).put(url("/settings")).send({}),
        request(caller).put(url("/key")).send({ apiKey: TEST_KEY }),
        request(caller).delete(url("/key")),
        request(caller).get(url("/stats")),
        request(caller).get(url("/gate-events")),
        request(caller).post(url("/gate-events/1/label")).send({ label: "correct" }),
        request(caller).get(url("/shadow")),
      ];
      for (const res of await Promise.all(calls)) expect(record(res).status).toBe(403);
    }
    expect(stubAuth).toEqual([]);
  });

  it("GET /settings trả mặc định khi chưa cấu hình", async () => {
    const res = record(await (await owner()).get(url("/settings")));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      enabled: false, gateMode: "shadow", model: "typesafe/jev-1.14", threshold: 0.5, timeoutMs: 2500,
      serverShadow: false, hasKey: false, keyFingerprint: null, version: 1, updatedAt: null, machines: [],
    });
  });

  it("PUT /key lưu secret, chỉ trả vân tay; kiểm key gọi Jev mà không lộ message của provider", async () => {
    for (const apiKey of ["short", `${TEST_KEY}\nsecond`, `${TEST_KEY} x`, 12345, "x".repeat(201)]) {
      const bad = record(await (await owner()).put(url("/key")).send({ apiKey }));
      expect(bad.status, String(apiKey)).toBe(400);
      expect(bad.body.code).toBe("crew_jev_invalid");
    }
    expect(record(await (await owner()).put(url("/key")).send({ apiKey: TEST_KEY, extra: 1 })).status).toBe(400);

    const res = record(await (await owner()).put(url("/key")).send({ apiKey: TEST_KEY, test: true }));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ hasKey: true, keyFingerprint: fingerprint(TEST_KEY), test: "ok" });
    expect(stubAuth).toEqual([`Bearer ${TEST_KEY}`]);

    const settings = record(await (await owner()).get(url("/settings")));
    expect(settings.body.hasKey).toBe(true);
    expect(settings.body.keyFingerprint).toBe(fingerprint(TEST_KEY));
    expect(settings.body.version).toBe(2);
    expect(settings.text).not.toContain(TEST_KEY);

    const [stored] = await db.select().from(companySecrets).where(eq(companySecrets.key, "crew-jev-openrouter"));
    expect(stored?.companyId).toBe(companyId);
    const tableDump = JSON.stringify((await db.execute(sql.raw(`SELECT * FROM ${crewJevTable("crew_jev_settings")}`))));
    expect(tableDump).not.toContain(TEST_KEY);

    stubMode = "fail";
    const failed = record(await (await owner()).put(url("/key")).send({ apiKey: TEST_KEY_2, test: true }));
    stubMode = "ok";
    expect(failed.status).toBe(200);
    expect(failed.body).toEqual({ hasKey: true, keyFingerprint: fingerprint(TEST_KEY_2), test: "error", errorCode: "unreachable" });
    expect(failed.text).not.toContain("provider echo");
    stubMode = "garbage";
    const garbage = record(await (await owner()).put(url("/key")).send({ apiKey: TEST_KEY_2, test: true }));
    stubMode = "ok";
    expect(garbage.body).toMatchObject({ test: "error", errorCode: "bad_response" });

    // Đổi lại key đầu (rotate cùng secret, không tạo secret mới).
    expect(record(await (await owner()).put(url("/key")).send({ apiKey: TEST_KEY })).body).toEqual({
      hasKey: true, keyFingerprint: fingerprint(TEST_KEY),
    });
    expect(await db.select().from(companySecrets).where(eq(companySecrets.key, "crew-jev-openrouter"))).toHaveLength(1);
  });

  it("PUT /settings kiểm schema và tăng version", async () => {
    const before = (await (await owner()).get(url("/settings"))).body.version as number;
    const input = { enabled: true, gateMode: "enforce", model: "typesafe/jev-1.14", threshold: 0.7, timeoutMs: 2000, serverShadow: true };
    for (const body of [
      {}, { ...input, gateMode: "block" }, { ...input, threshold: 0.2 }, { ...input, timeoutMs: 3001 },
      { ...input, model: "openai/gpt-5" }, { ...input, extra: true },
    ]) {
      const bad = record(await (await owner()).put(url("/settings")).send(body));
      expect(bad.status, JSON.stringify(body)).toBe(400);
    }
    const res = record(await (await owner()).put(url("/settings")).send(input));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ...input, hasKey: true, keyFingerprint: fingerprint(TEST_KEY), version: before + 1 });
    const again = record(await (await owner()).put(url("/settings")).send({ ...input, gateMode: "shadow" }));
    expect(again.body.version).toBe(before + 2);
    expect(again.body.gateMode).toBe("shadow");

    // Kiểm key theo timeoutMs đã lưu: provider chậm hơn thì trả timeout, không chờ.
    await (await owner()).put(url("/settings")).send({ ...input, timeoutMs: 500 });
    stubMode = "slow";
    const started = Date.now();
    const slow = record(await (await owner()).put(url("/key")).send({ apiKey: TEST_KEY, test: true }));
    stubMode = "ok";
    expect(slow.body).toEqual({ hasKey: true, keyFingerprint: fingerprint(TEST_KEY), test: "error", errorCode: "timeout" });
    expect(Date.now() - started).toBeLessThan(1400);
  });

  it("pull: chữ ký sai 401, máy bị gỡ 403, company không có cấu hình 404", async () => {
    expect((await signed("/machine/pull", pullBody(machines.legacy), "wrong-secret")).body.code).toBe("bad_signature");
    expect((await signed("/machine/pull", pullBody(machines.legacy), "wrong-secret")).status).toBe(401);
    // Máy đã ghép phải ký bằng khóa máy, không dùng được secret company.
    expect((await signed("/machine/pull", pullBody(machines.paired), WEBHOOK_SECRET)).status).toBe(401);
    const stale = await signed("/machine/pull", pullBody(machines.legacy), WEBHOOK_SECRET, {
      nowSec: Math.floor(Date.now() / 1000) - 600,
    });
    expect(stale.status).toBe(401);
    expect(stale.body.code).toBe("stale_signature");
    const revoked = await signed("/machine/pull", pullBody(machines.revoked), WEBHOOK_SECRET);
    expect(revoked.status).toBe(403);
    expect(revoked.body.code).toBe("machine_revoked");
    const unknown = await signed(
      "/machine/pull", { ...pullBody(machines.legacy), companyId: strangerCompanyId }, WEBHOOK_SECRET, { cid: strangerCompanyId },
    );
    expect(unknown.status).toBe(404);
    expect(unknown.body.code).toBe("unknown_company");
    const mismatch = await signed("/machine/pull", pullBody(machines.legacy), WEBHOOK_SECRET, { cid: strangerCompanyId });
    expect(mismatch.status).toBe(400);
    const unsigned = record(await request(await anonymous()).post(url("/machine/pull")).send(pullBody(machines.legacy)));
    expect(unsigned.status).toBe(401);
    const bad = await signed("/machine/pull", pullBody(machines.legacy, { appliedVersion: "x" }), WEBHOOK_SECRET);
    expect(bad.status).toBe(400);
  });

  it("pull chỉ kèm apiKey khi Jev bật, có key và vân tay Mac khác server", async () => {
    await (await owner()).put(url("/settings")).send({
      enabled: false, gateMode: "shadow", model: "typesafe/jev-1.14", threshold: 0.5, timeoutMs: 2500, serverShadow: false,
    });
    const off = await signed("/machine/pull", pullBody(machines.legacy), WEBHOOK_SECRET);
    expect(off.status).toBe(200);
    expect(off.body).toMatchObject({ enabled: false, hasKey: true, keyFingerprint: fingerprint(TEST_KEY) });
    expect(off.body.apiKey).toBeUndefined();

    const on = record(await (await owner()).put(url("/settings")).send({
      enabled: true, gateMode: "shadow", model: "typesafe/jev-1.14", threshold: 0.5, timeoutMs: 2500, serverShadow: false,
    }));
    const version = on.body.version as number;
    const first = await signed("/machine/pull", pullBody(machines.paired, { appliedVersion: version - 1 }), pairedKey());
    expect(first.status).toBe(200);
    expect(first.body).toEqual({
      version, enabled: true, gateMode: "shadow", model: "typesafe/jev-1.14", threshold: 0.5, timeoutMs: 2500,
      hasKey: true, keyFingerprint: fingerprint(TEST_KEY), apiKey: TEST_KEY,
    });
    expect(first.headers["cache-control"]).toContain("no-store");
    dumps.pop(); // Response duy nhất được phép mang key: Mac đã ký đúng và vân tay khác.

    const second = await signed(
      "/machine/pull", pullBody(machines.paired, { appliedVersion: version, keyFingerprint: fingerprint(TEST_KEY) }), pairedKey(),
    );
    expect(second.status).toBe(200);
    expect(second.body.apiKey).toBeUndefined();
    expect(second.body.version).toBe(version);

    const settings = record(await (await owner()).get(url("/settings")));
    expect(settings.body.machines).toEqual(expect.arrayContaining([
      expect.objectContaining({ machineId: machines.paired, appliedVersion: version, keyOk: true, lastEventsAt: null }),
      expect.objectContaining({ machineId: machines.legacy, appliedVersion: null, keyOk: false }),
    ]));
  });

  it("events: quá 500 dòng hay quá 256 KiB trả 413; trùng eventId đếm duplicates; lệnh được che secret", async () => {
    const tooMany = await signed("/machine/events", eventsBody(Array.from({ length: 501 }, () => event())), WEBHOOK_SECRET);
    expect(tooMany.status).toBe(413);
    const huge = await signed(
      "/machine/events", eventsBody([event({ command: "x".repeat(300 * 1024) })]), WEBHOOK_SECRET,
    );
    expect(huge.status).toBe(413);
    expect(huge.body.code).toBe("body_too_large");

    const batch = [
      event(),
      event({
        verdict: "deny", applied: "deny", mode: "enforce", category: "force_push", blocking: true, confidence: 0.95,
        latencyMs: 300, command: `git push --force origin crew/x # ${TEST_KEY_2}`,
      }),
      event({ verdict: "error", errorCode: "timeout", confidence: null, latencyMs: null, command: "pnpm test" }),
    ];
    const res = await signed("/machine/events", eventsBody(batch), WEBHOOK_SECRET);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ accepted: 3, duplicates: 0, rejected: 0 });
    const again = await signed("/machine/events", eventsBody([...batch, event({ v: 2 }), event({ companyId: strangerCompanyId })]), WEBHOOK_SECRET);
    expect(again.body).toEqual({ accepted: 0, duplicates: 3, rejected: 2 });

    const stored = JSON.stringify(await db.execute(sql.raw(`SELECT command FROM ${crewJevTable("crew_jev_gate_events")}`)));
    expect(stored).not.toContain(TEST_KEY_2);
    expect(stored).toContain("git push --force origin crew/x");

    const machinesRows = (await (await owner()).get(url("/settings"))).body.machines as Array<Record<string, unknown>>;
    expect(machinesRows.find((machine) => machine.machineId === machines.legacy)?.lastEventsAt).toEqual(expect.any(String));
  });

  it("stats đúng số, ngày theo giờ Việt Nam", async () => {
    const shadowTable = sql.raw(crewJevTable("crew_jev_shadow"));
    const shadow = (kind: string, regex: string, jev: string | null, status: string, escalated: boolean | null) =>
      db.execute(sql`INSERT INTO ${shadowTable} (company_id, kind, run_id, regex_label, jev_label, status, escalated)
        VALUES (${companyId}, ${kind}, ${randomUUID()}, ${regex}, ${jev}, ${status}, ${escalated})`);
    await shadow("liveness", "blocked", "blocked", "done", false);
    await shadow("liveness", "blocked", "progress", "done", false);
    await shadow("liveness", "progress", "blocked", "done", true);
    await shadow("liveness", "progress", null, "error", null);
    await shadow("runtime", "quota", null, "pending", null);

    const res = record(await (await owner()).get(url("/stats?days=7")));
    expect(res.status).toBe(200);
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(Date.now() - 60_000));
    expect(res.body).toEqual({
      days: 7,
      gate: {
        calls: 3, allow: 1, deny: 1, escalate: 0, error: 1, appliedDeny: 1, p50Ms: 200, p95Ms: 290,
        byCategory: [{ category: "force_push", calls: 1, deny: 1, appliedDeny: 1 }],
        byDay: [{ day: today, calls: 3, allow: 1, deny: 1, escalate: 0, error: 1 }],
      },
      shadow: {
        liveness: { done: 3, mismatch: 1, escalated: 1, error: 1, pending: 0 },
        runtime: { done: 0, mismatch: 0, escalated: 0, error: 0, pending: 1 },
      },
    });
    for (const days of ["0", "31", "x"]) expect(record(await (await owner()).get(url(`/stats?days=${days}`))).status).toBe(400);
  });

  it("danh sách ca và đánh dấu đúng/nhầm/null", async () => {
    const denies = record(await (await owner()).get(url("/gate-events?verdict=deny")));
    expect(denies.status).toBe(200);
    expect(denies.body.items).toHaveLength(1);
    expect(denies.body.nextBefore).toBeNull();
    const deny = denies.body.items[0];
    expect(deny).toMatchObject({ verdict: "deny", applied: "deny", category: "force_push", ownerLabel: null });
    expect(deny.command).toContain("[redacted]");

    for (const label of ["correct", "wrong"] as const) {
      const res = record(await (await owner()).post(url(`/gate-events/${deny.id}/label`)).send({ label }));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: deny.id, ownerLabel: label, labeledByUserId: users.owner });
    }
    expect((await (await owner()).get(url("/gate-events?label=wrong"))).body.items.map((item: { id: string }) => item.id))
      .toEqual([deny.id]);
    expect((await (await owner()).get(url("/gate-events?label=unlabeled"))).body.items).toHaveLength(2);
    const cleared = record(await (await owner()).post(url(`/gate-events/${deny.id}/label`)).send({ label: null }));
    expect(cleared.body).toMatchObject({ ownerLabel: null, labeledByUserId: null, labeledAt: null });

    expect(record(await (await owner()).post(url(`/gate-events/${deny.id}/label`)).send({ label: "maybe" })).status).toBe(400);
    expect(record(await (await owner()).post(url(`/gate-events/${deny.id}/label`)).send({})).status).toBe(400);
    expect(record(await (await owner()).post(url("/gate-events/999999/label")).send({ label: "correct" })).status).toBe(404);
    expect(record(await (await owner()).post(url("/gate-events/abc/label")).send({ label: "correct" })).status).toBe(404);
    expect(record(await (await owner()).get(url("/gate-events?verdict=boom"))).status).toBe(400);

    const all = (await (await owner()).get(url("/gate-events"))).body.items as Array<{ id: string }>;
    const older = (await (await owner()).get(url(`/gate-events?before=${all[0]!.id}`))).body.items as Array<{ id: string }>;
    expect(older.map((item) => item.id)).toEqual(all.slice(1).map((item) => item.id));

    const mismatches = record(await (await owner()).get(url("/shadow?mismatch=true")));
    expect(mismatches.status).toBe(200);
    expect(mismatches.body.items).toEqual([
      expect.objectContaining({ kind: "liveness", regexLabel: "blocked", jevLabel: "progress", mismatch: true }),
    ]);
    expect((await (await owner()).get(url("/shadow?kind=runtime"))).body.items).toHaveLength(1);
  });

  it("DELETE /key bỏ liên kết, vô hiệu secret; Mac được báo hasKey:false", async () => {
    const res = record(await (await owner()).delete(url("/key")));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ hasKey: false });
    const [secret] = await db.select().from(companySecrets).where(eq(companySecrets.key, "crew-jev-openrouter"));
    expect(secret?.status).toBe("disabled");
    const pull = await signed("/machine/pull", pullBody(machines.paired), pairedKey());
    expect(pull.body).toMatchObject({ enabled: true, hasKey: false, keyFingerprint: null });
    expect(pull.body.apiKey).toBeUndefined();

    const restored = record(await (await owner()).put(url("/key")).send({ apiKey: TEST_KEY_2 }));
    expect(restored.body).toEqual({ hasKey: true, keyFingerprint: fingerprint(TEST_KEY_2) });
    const rows = await db.select().from(companySecrets).where(eq(companySecrets.key, "crew-jev-openrouter"));
    expect(rows.map((row) => row.status)).toEqual(["active"]);
  });

  it("route máy: request giả hay cũ không đọc secret; secret company được cache", async () => {
    const accessEvents = async () => (await db.select().from(secretAccessEvents)).length;
    // Mac đã giữ đúng key hiện tại, nên pull không đọc key Jev; chỉ còn secret webhook có thể bị đọc.
    const synced = () => pullBody(machines.legacy, { keyFingerprint: fingerprint(TEST_KEY_2) });
    await signed("/machine/pull", synced(), WEBHOOK_SECRET);
    const before = await accessEvents();
    const body = JSON.stringify(pullBody(machines.legacy));
    const post = async (headers: Record<string, string>) =>
      record(await request(await anonymous()).post(url("/machine/pull")).set("content-type", "application/json").set(headers).send(body));
    const now = Math.floor(Date.now() / 1000);
    expect((await post({ "x-crew-timestamp": String(now - 3600), "x-crew-signature": `sha256=${"0".repeat(64)}` })).status).toBe(401);
    expect((await post({ "x-crew-timestamp": String(now), "x-crew-signature": "sha256=nothex" })).status).toBe(401);
    expect((await post({ "x-crew-timestamp": "x", "x-crew-signature": `sha256=${"0".repeat(64)}` })).status).toBe(401);
    for (let i = 0; i < 3; i += 1) {
      expect((await signed("/machine/pull", synced(), WEBHOOK_SECRET)).status).toBe(200);
    }
    expect(await accessEvents()).toBe(before);
  });

  it("qua log HTTP thật và boardMutationGuard: route máy chạy được, log không có key hay lệnh", async () => {
    const lines: string[] = [];
    const ownerApp = await app({
      type: "board", userId: users.owner, source: "session", isInstanceAdmin: false, companyIds: [companyId],
      memberships: [{ companyId, membershipRole: "owner", status: "active" }],
    }, lines);
    const machineApp = await app({ type: "none", source: "none" }, lines);
    // Body sai (400) vẫn mang key: log không được chép body.
    record(await request(ownerApp).put(url("/key")).set("origin", "http://127.0.0.1").send({ apiKey: `${TEST_KEY} bad` }));
    const command = `git push --force origin crew/log-check # ${TEST_KEY}`;
    const body = JSON.stringify(eventsBody([event({ command })]));
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = `sha256=${createHmac("sha256", WEBHOOK_SECRET).update(`${timestamp}.${body}`).digest("hex")}`;
    const ok = record(await request(machineApp).post(url("/machine/events")).set("content-type", "application/json")
      .set("x-crew-timestamp", timestamp).set("x-crew-signature", signature).send(body));
    expect(ok.status).toBe(200);
    expect(ok.body.accepted).toBe(1);
    const bad = record(await request(machineApp).post(url("/machine/events")).set("content-type", "application/json")
      .set("x-crew-timestamp", timestamp).set("x-crew-signature", `sha256=${"0".repeat(64)}`).send(body));
    expect(bad.status).toBe(401);
    expect(lines.length).toBeGreaterThanOrEqual(3);
    const log = lines.join("\n");
    expect(log).not.toContain(TEST_KEY);
    expect(log).not.toContain("crew/log-check");
    expect(log).not.toContain(WEBHOOK_SECRET);
  });

  it("không response nào chứa key thử hay secret webhook", () => {
    expect(dumps.length).toBeGreaterThan(40);
    for (const dump of dumps) {
      expect(dump).not.toContain(TEST_KEY);
      expect(dump).not.toContain(TEST_KEY_2);
      expect(dump).not.toContain(WEBHOOK_SECRET);
    }
  });
});

import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { agents, companies, createDb, heartbeatRuns, issueComments, issues, secretAccessEvents } from "@paperclipai/db";
import { crewJevTable } from "../crew/jev-store.js";
import { runJevShadowSweep } from "../crew/jev-shadow.js";
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
const TEST_KEY = `sk-or-test-${"e5".repeat(16)}`;
const LEAKED = `sk-or-test-${"f6".repeat(16)}`;

type Reply = { status: number; label?: string; confidence?: number };

suite("Crew Jev: worker so sánh Jev với regex", () => {
  let db: ReturnType<typeof createDb>;
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  const saved = { masterKey: process.env.PAPERCLIP_SECRETS_MASTER_KEY, baseUrl: process.env.CREW_JEV_BASE_URL };
  const companyId = randomUUID();
  const offCompanyId = randomUUID();
  const noKeyCompanyId = randomUUID();
  const agentIds: Record<string, string> = {};
  let issueId: string;

  let stub: Server;
  /** Stub chọn câu trả lời theo marker có trong state (`RUN-A`, ...). */
  const replies = new Map<string, Reply>();
  const received: string[] = [];

  beforeAll(async () => {
    process.env.PAPERCLIP_SECRETS_MASTER_KEY = randomBytes(32).toString("hex");
    stub = createServer((req: IncomingMessage, res) => {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        received.push(`${req.headers.authorization ?? ""}\n${body}`);
        const marker = [...replies.keys()].find((key) => body.includes(key));
        const reply = (marker && replies.get(marker)) || { status: 200, label: "progress", confidence: 0.9 };
        res.writeHead(reply.status, { "content-type": "application/json" });
        res.end(reply.status === 200
          ? JSON.stringify({ model: "typesafe/jev-1.14-test", answers: { label: { type: "choice", choice: reply.label, confidence: reply.confidence } } })
          : JSON.stringify({ error: { message: "down" } }));
      });
    });
    await new Promise<void>((resolve) => stub.listen(0, "127.0.0.1", resolve));
    process.env.CREW_JEV_BASE_URL = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;

    temporary = await startEmbeddedPostgresTestDatabase("crew-jev-shadow-db-");
    db = createDb(temporary.connectionString);
    for (const [id, name] of [[companyId, "Crew"], [offCompanyId, "Off"], [noKeyCompanyId, "NoKey"]] as const) {
      await db.insert(companies).values({
        id, name, issuePrefix: `S${id.replaceAll("-", "").slice(0, 6).toUpperCase()}`, requireBoardApprovalForNewAgents: false,
      });
      const [agent] = await db.insert(agents).values({ companyId: id, name: `agent-${name}` }).returning();
      agentIds[id] = agent!.id;
    }
    const [issue] = await db.insert(issues).values({ companyId, title: "I", status: "todo", priority: "medium" }).returning();
    issueId = issue!.id;

    const namespace = crewJevTable("crew_jev_settings").split(".")[0]!;
    await db.execute(sql.raw(`CREATE SCHEMA IF NOT EXISTS ${namespace}`));
    for (const statement of statements("0020_jev.sql")) await db.execute(sql.raw(statement));

    const settings = sql.raw(crewJevTable("crew_jev_settings"));
    for (const [id, serverShadow, withKey] of [[companyId, true, true], [offCompanyId, false, true], [noKeyCompanyId, true, false]] as const) {
      const secretId = withKey
        ? (await secretService(db).create(id, { name: "crew-jev-openrouter", provider: "local_encrypted", value: TEST_KEY })).id
        : null;
      await db.execute(sql`INSERT INTO ${settings} (company_id, enabled, server_shadow, key_secret_id, key_fingerprint, threshold)
        VALUES (${id}, true, ${serverShadow}, ${secretId}, ${withKey ? "abcdefabcdef" : null}, 0.5)`);
    }
  }, 60_000);

  afterAll(async () => {
    for (const [name, value] of [["PAPERCLIP_SECRETS_MASTER_KEY", saved.masterKey], ["CREW_JEV_BASE_URL", saved.baseUrl]] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await new Promise<void>((resolve) => (stub ? stub.close(() => resolve()) : resolve()));
    await db?.$client.end({ timeout: 0 });
    await temporary?.cleanup();
  });

  beforeEach(() => {
    replies.clear();
    received.length = 0;
  });

  async function addRun(input: {
    company?: string; status?: string; liveness: string | null; comment?: string; result?: Record<string, unknown>; minutesAgo?: number;
    withIssue?: boolean;
  }): Promise<string> {
    const company = input.company ?? companyId;
    const [run] = await db.insert(heartbeatRuns).values({
      companyId: company,
      agentId: agentIds[company]!,
      status: input.status ?? "succeeded",
      livenessState: input.liveness,
      livenessReason: input.liveness ? `regex ${input.liveness}` : null,
      resultJson: input.result ?? null,
      contextSnapshot: input.withIssue === false || company !== companyId ? {} : { issueId },
      finishedAt: new Date(Date.now() - (input.minutesAgo ?? 5) * 60_000),
    }).returning();
    if (input.comment && company === companyId) {
      await db.insert(issueComments).values({ companyId, issueId, body: input.comment, createdByRunId: run!.id });
    }
    return run!.id;
  }

  const shadow = async () =>
    (await db.execute(sql.raw(`SELECT company_id::text AS company_id, kind, run_id::text AS run_id, regex_label, jev_label,
      confidence, escalated, status, error_code, input_excerpt FROM ${crewJevTable("crew_jev_shadow")} ORDER BY id`))) as unknown as
      Array<Record<string, unknown>>;
  const runOf = async (runId: string) =>
    (await shadow()).find((row) => row.run_id === runId);
  const accessEvents = async () => (await db.select().from(secretAccessEvents)).length;

  it("liveness: lệch, escalate, lỗi được ghi; run không do regex quyết định thì bỏ; liveness của run không đổi", async () => {
    const blocked = await addRun({ liveness: "blocked", comment: "RUN-A bị chặn vì thiếu quyền" });
    const completed = await addRun({ liveness: "completed", result: { summary: "RUN-B xong", stdout: `token ${LEAKED}` } });
    const planOnly = await addRun({ liveness: "plan_only", comment: "RUN-C mới lập kế hoạch" });
    const followup = await addRun({ liveness: "needs_followup", comment: "RUN-D còn việc" });
    const empty = await addRun({ liveness: "empty_response", comment: "RUN-E" });
    const failedRun = await addRun({ status: "failed", liveness: "failed", comment: "RUN-F" });
    const noLiveness = await addRun({ liveness: null, comment: "RUN-G" });
    replies.set("RUN-A", { status: 200, label: "progress", confidence: 0.95 });
    replies.set("RUN-B", { status: 200, label: "blocked", confidence: 0.1 });
    replies.set("RUN-C", { status: 503 });
    replies.set("RUN-D", { status: 200, label: "future_work", confidence: 0.9 });
    const eventsBefore = await accessEvents();

    const result = await runJevShadowSweep(db, new Date());
    expect(result).toMatchObject({ companies: 1, liveness: 4, runtime: 0 });
    // Một lần đọc key cho cả lượt của company.
    expect(await accessEvents()).toBe(eventsBefore + 1);

    expect(await runOf(blocked)).toMatchObject({
      kind: "liveness", regex_label: "blocked", jev_label: "progress", escalated: false, status: "done",
    });
    expect(await runOf(completed)).toMatchObject({ regex_label: "progress", jev_label: "blocked", escalated: true, status: "done" });
    expect(await runOf(planOnly)).toMatchObject({ regex_label: "future_work", jev_label: null, status: "error", error_code: "unreachable" });
    expect(await runOf(followup)).toMatchObject({ regex_label: "future_work", jev_label: "future_work", escalated: false, status: "done" });
    for (const skipped of [empty, failedRun, noLiveness]) expect(await runOf(skipped)).toBeUndefined();
    expect(received.some((body) => body.includes("RUN-E") || body.includes("RUN-F") || body.includes("RUN-G"))).toBe(false);

    // Text gửi Jev đã che secret; key chỉ nằm ở header Authorization.
    for (const request of received) {
      expect(request.startsWith(`Bearer ${TEST_KEY}\n`)).toBe(true);
      expect(request.split("\n").slice(1).join("\n")).not.toContain(LEAKED);
    }
    expect(JSON.stringify(await shadow())).not.toContain(LEAKED);

    const runs = await db.select().from(heartbeatRuns);
    for (const run of runs) expect(run.livenessReason).toBe(run.livenessState ? `regex ${run.livenessState}` : null);

    // Lượt sau không gửi lại run đã có dòng.
    received.length = 0;
    expect(await runJevShadowSweep(db, new Date())).toMatchObject({ liveness: 0 });
    expect(received).toEqual([]);
  });

  it("runtime: điền dòng pending do plugin ghi, che message, escalate khi không chắc", async () => {
    const shadowTable = sql.raw(crewJevTable("crew_jev_shadow"));
    const quotaRun = randomUUID();
    const unsureRun = randomUUID();
    await db.execute(sql`INSERT INTO ${shadowTable} (company_id, kind, run_id, regex_label, input_excerpt) VALUES
      (${companyId}, 'runtime', ${quotaRun}, 'quota', ${`RUN-Q usage limit reached key=${LEAKED}`}),
      (${companyId}, 'runtime', ${unsureRun}, 'other', 'RUN-U lỗi lạ')`);
    replies.set("RUN-Q", { status: 200, label: "quota", confidence: 0.97 });
    replies.set("RUN-U", { status: 200, label: "auth", confidence: 0.2 });

    expect(await runJevShadowSweep(db, new Date())).toMatchObject({ runtime: 2 });
    const quota = await runOf(quotaRun);
    expect(quota).toMatchObject({ kind: "runtime", regex_label: "quota", jev_label: "quota", escalated: false, status: "done" });
    expect(String(quota?.input_excerpt)).not.toContain(LEAKED);
    expect(String(quota?.input_excerpt)).toContain("[redacted]");
    expect(await runOf(unsureRun)).toMatchObject({ jev_label: "auth", escalated: true, status: "done" });
    for (const request of received) expect(request.split("\n").slice(1).join("\n")).not.toContain(LEAKED);
  });

  it("company tắt so sánh hoặc thiếu key: không gọi Jev, không ghi gì", async () => {
    await addRun({ company: offCompanyId, liveness: "blocked", comment: "RUN-OFF" });
    await addRun({ company: noKeyCompanyId, liveness: "blocked", comment: "RUN-NOKEY" });
    const shadowTable = sql.raw(crewJevTable("crew_jev_shadow"));
    await db.execute(sql`INSERT INTO ${shadowTable} (company_id, kind, run_id, regex_label, input_excerpt)
      VALUES (${offCompanyId}, 'runtime', ${randomUUID()}, 'quota', 'RUN-OFF-RT')`);
    const before = await shadow();
    const eventsBefore = await accessEvents();
    await runJevShadowSweep(db, new Date());
    expect(received).toEqual([]);
    expect(await shadow()).toEqual(before);
    expect(await accessEvents()).toBe(eventsBefore);
  });

  it("dọn dữ liệu cũ hơn 30 ngày ở cả hai bảng", async () => {
    const shadowTable = sql.raw(crewJevTable("crew_jev_shadow"));
    const gateTable = sql.raw(crewJevTable("crew_jev_gate_events"));
    const oldRun = randomUUID();
    await db.execute(sql`INSERT INTO ${shadowTable} (company_id, kind, run_id, regex_label, status, created_at)
      VALUES (${offCompanyId}, 'liveness', ${oldRun}, 'blocked', 'done', now() - interval '31 days')`);
    const oldEvent = randomUUID();
    const newEvent = randomUUID();
    await db.execute(sql`INSERT INTO ${gateTable} (company_id, machine_id, event_id, occurred_at, mode, verdict, applied, blocking, command)
      VALUES (${companyId}, ${randomUUID()}, ${oldEvent}, now() - interval '31 days', 'shadow', 'allow', 'allow', false, 'ls'),
             (${companyId}, ${randomUUID()}, ${newEvent}, now() - interval '29 days', 'shadow', 'allow', 'allow', false, 'ls')`);
    const result = await runJevShadowSweep(db, new Date(), { forcePurge: true });
    expect(result.purged).toBeGreaterThanOrEqual(2);
    expect(await runOf(oldRun)).toBeUndefined();
    const events = (await db.execute(sql`SELECT event_id::text AS event_id FROM ${gateTable}`)) as unknown as Array<{ event_id: string }>;
    expect(events.map((row) => row.event_id)).toEqual([newEvent]);
  });

  const settingsTable = () => sql.raw(crewJevTable("crew_jev_settings"));
  const setCursor = (at: Date | null) =>
    db.execute(sql`UPDATE ${settingsTable()} SET shadow_cursor = ${at ? at.toISOString() : null}::timestamptz WHERE company_id = ${companyId}`);
  const cursorOf = async () =>
    ((await db.execute(sql`SELECT shadow_cursor FROM ${settingsTable()} WHERE company_id = ${companyId}`)) as unknown as
      Array<{ shadow_cursor: Date | string | null }>)[0]?.shadow_cursor ?? null;

  it("con trỏ không vượt qua run đã xong mà chưa có nhãn liveness; nhãn tới muộn vẫn được xét", async () => {
    await setCursor(null);
    const late = await addRun({ liveness: null, comment: "RUN-LATE", minutesAgo: 6 });
    const early = await addRun({ liveness: "blocked", comment: "RUN-EARLY", minutesAgo: 3 });
    await runJevShadowSweep(db, new Date());
    expect(await runOf(early)).toMatchObject({ status: "done" });
    const [lateRun] = await db.select().from(heartbeatRuns).where(sql`id = ${late}`);
    expect(new Date((await cursorOf())!).getTime()).toBeLessThanOrEqual(lateRun!.finishedAt!.getTime());

    await db.update(heartbeatRuns).set({ livenessState: "completed", livenessReason: "regex completed" }).where(sql`id = ${late}`);
    received.length = 0;
    await runJevShadowSweep(db, new Date());
    expect(await runOf(late)).toMatchObject({ regex_label: "progress", status: "done" });
    expect(received.some((body) => body.includes("RUN-LATE"))).toBe(true);
  });

  it("bật lại sau thời gian dài: chỉ xét run của một giờ gần nhất", async () => {
    await setCursor(new Date(Date.now() - 14 * 86_400_000));
    const old = await addRun({ liveness: "blocked", comment: "RUN-OLD", minutesAgo: 180 });
    const recent = await addRun({ liveness: "blocked", comment: "RUN-RECENT", minutesAgo: 20 });
    received.length = 0;
    await runJevShadowSweep(db, new Date());
    expect(await runOf(recent)).toMatchObject({ status: "done" });
    expect(await runOf(old)).toBeUndefined();
    expect(received.some((body) => body.includes("RUN-OLD"))).toBe(false);
  });

  it("ghi kết quả lỗi lặp: sau 3 lần thì ghi error/internal và không gọi Jev nữa", async () => {
    const dialect = (db as unknown as { dialect: { sqlToQuery(query: unknown): { sql: string; params: unknown[] } } }).dialect;
    const poisoned = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop !== "execute") return Reflect.get(target, prop, receiver);
        return (query: unknown) => {
          const compiled = dialect.sqlToQuery(query);
          if (compiled.sql.includes("INSERT INTO") && compiled.sql.includes("crew_jev_shadow") && compiled.params.includes("done")) {
            throw Object.assign(new Error("boom with run text RUN-POISON"), { code: "23514" });
          }
          return target.execute(query as never);
        };
      },
    });
    const poison = await addRun({ liveness: "blocked", comment: "RUN-POISON", minutesAgo: 2 });
    const calls = () => received.filter((body) => body.includes("RUN-POISON")).length;
    received.length = 0;
    for (let i = 0; i < 3; i += 1) await runJevShadowSweep(poisoned, new Date());
    expect(calls()).toBe(3);
    expect(await runOf(poison)).toMatchObject({ status: "error", error_code: "internal", input_excerpt: null });
    await runJevShadowSweep(poisoned, new Date());
    expect(calls()).toBe(3);
  });

  it("truy vấn mỗi lượt dùng index sẵn có (kế hoạch EXPLAIN với dữ liệu mẫu)", async () => {
    const agentId = agentIds[companyId]!;
    // Khoảng 21 600 run cũ trải 60 ngày, 20 000 comment trên 200 issue, như company đã chạy lâu.
    await db.execute(sql`INSERT INTO heartbeat_runs (company_id, agent_id, status, liveness_state, created_at, finished_at)
      SELECT ${companyId}, ${agentId}, 'succeeded', 'completed', now() - (g || ' minutes')::interval,
        now() - (g || ' minutes')::interval + interval '1 minute'
      FROM generate_series(120, 86520, 4) g`);
    const extraIssues = (await db.execute(sql`INSERT INTO issues (company_id, title, status, priority)
      SELECT ${companyId}, 'I' || g, 'todo', 'medium' FROM generate_series(1, 200) g RETURNING id`)) as unknown as Array<{ id: string }>;
    await db.execute(sql`INSERT INTO issue_comments (company_id, issue_id, body, created_at)
      SELECT ${companyId}, (${sql.raw(`ARRAY[${extraIssues.map((row) => `'${row.id}'::uuid`).join(",")}]`)})[1 + g % 200],
        'comment ' || g, now() - (g || ' minutes')::interval FROM generate_series(1, 20000) g`);
    await db.execute(sql`ANALYZE heartbeat_runs`);
    await db.execute(sql`ANALYZE issue_comments`);
    const { livenessCandidatesSql, runCommentsSql, livenessWindowStart } = await import("../crew/jev-shadow.js");
    const since = livenessWindowStart(null, new Date());
    const plan = async (query: ReturnType<typeof livenessCandidatesSql>) =>
      ((await db.execute(sql`EXPLAIN ${query}`)) as unknown as Array<{ "QUERY PLAN": string }>).map((row) => row["QUERY PLAN"]).join("\n");
    const runsPlan = await plan(livenessCandidatesSql(companyId, since));
    const commentsPlan = await plan(runCommentsSql(companyId, issueId, randomUUID()));
    // Đặt CREW_JEV_EXPLAIN_OUT=<file> để lưu kế hoạch truy vấn ra file.
    if (process.env.CREW_JEV_EXPLAIN_OUT) {
      writeFileSync(process.env.CREW_JEV_EXPLAIN_OUT, `EXPLAIN heartbeat_runs:\n${runsPlan}\n\nEXPLAIN issue_comments:\n${commentsPlan}\n`);
    }
    // Quét theo khoảng `created_at` trên một index `(company_id, …, created_at)` sẵn có, không quét cả lịch sử.
    expect(runsPlan).toMatch(/Index Scan using heartbeat_runs_company_(liveness|created_at_desc)_idx/);
    expect(runsPlan).toMatch(/Index Cond: .*created_at >=/);
    expect(runsPlan).not.toMatch(/Seq Scan on heartbeat_runs/);
    expect(commentsPlan).toMatch(/Index Scan( Backward)? using (issue_comments_company_issue_created_at_idx|issue_comments_issue_idx)/);
    expect(commentsPlan).not.toMatch(/Seq Scan on issue_comments/);
  });
});

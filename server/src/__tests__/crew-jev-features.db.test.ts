import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import request from "supertest";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agents, assets, companies, companyMemberships, createDb, issueAttachments, issues } from "@paperclipai/db";
import { CREW_POLICY_CONFIG_ENV } from "../crew/issue-policy.js";
import {
  approvalMismatch,
  complexityCandidatesSql,
  decidedLines,
  deterministicReasons,
  inboxCandidatesSql,
  resetJevFeatureRateLimit,
  riskyPaths,
  runJevFeatureSweep,
  stripCode,
} from "../crew/jev-features.js";
import { issueJudgmentsSql, judgmentStatsSql, judgmentsListSql } from "../crew/jev-judgments.js";
import { runJevShadowSweep } from "../crew/jev-shadow.js";
import { crewJevTable } from "../crew/jev-store.js";
import { validatePluginMigrationStatement } from "../services/plugin-database.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

const statements = (file: string) =>
  readFileSync(fileURLToPath(new URL(`../../../packages/crew-plugin/migrations/${file}`, import.meta.url)), "utf8")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);

const support = await getEmbeddedPostgresTestSupport();
const suite = support.supported ? describe.sequential : describe.skip;

const TEST_KEY = `sk-or-test-${"d4".repeat(16)}`;
const LEAKED = `sk-or-test-${"9a".repeat(16)}`;

type Reply = { status?: number; delayMs?: number; choice?: string; noul?: number; confidence?: number };

describe("Crew Jev: luật thuần của bốn tính năng", () => {
  it("bỏ khối code và diff trước khi gửi", () => {
    const text = "Sửa lỗi\n```ts\nconst secret = 1;\n```\ndiff --git a/x b/x\n@@ -1 +1 @@\nxong";
    const out = stripCode(text);
    expect(out).not.toContain("const secret");
    expect(out).not.toContain("diff --git");
    expect(out).toContain("xong");
  });

  it("lệch lời nhắn: chỉ khi Jev chắc và khác hành động; unclear không phải lệch", () => {
    expect(approvalMismatch("approve", { label: "request_changes", escalated: false })).toBe(true);
    expect(approvalMismatch("approve", { label: "approve", escalated: false })).toBe(false);
    expect(approvalMismatch("approve", { label: "unclear", escalated: false })).toBe(false);
    expect(approvalMismatch("approve", { label: "request_changes", escalated: true })).toBe(false);
    expect(approvalMismatch("request_changes", { label: null, escalated: false })).toBe(false);
  });

  it("luật xác định của hộp duyệt", () => {
    const none = "### Đã tự quyết định\n- Không có.\n\n### Cần owner quyết định\n- Không có.\n";
    expect(deterministicReasons(none)).toEqual([]);
    const ask = "### Cần owner quyết định\nQ1. Giữ hay bỏ?\n- a) giữ\n";
    expect(deterministicReasons(ask).map((reason) => reason.kind)).toEqual(["owner_decision"]);
    const risky = "Đã đổi packages/db/src/migrations/0044_x.sql và .github/workflows/ci.yml, pnpm-lock.yaml.";
    expect(riskyPaths(risky).length).toBe(3);
    expect(deterministicReasons(risky).map((reason) => reason.kind)).toEqual(["risky_paths"]);
    expect(riskyPaths("Sửa README và src/button.tsx")).toEqual([]);
    expect(decidedLines("### Đã tự quyết định\n- Chọn A — vì nhanh\n- Không có.\n\n### Khác\n- bỏ")).toEqual(["Chọn A — vì nhanh"]);
  });
});

suite("Crew Jev: bốn tính năng đợt 2", () => {
  let db: ReturnType<typeof createDb>;
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  const dir = mkdtempSync(path.join(tmpdir(), "crew-jev-features-"));
  const configFile = path.join(dir, "crew-policy.json");
  const saved = {
    config: process.env[CREW_POLICY_CONFIG_ENV],
    masterKey: process.env.PAPERCLIP_SECRETS_MASTER_KEY,
    baseUrl: process.env.CREW_JEV_BASE_URL,
  };
  const companyId = randomUUID();
  const otherCompanyId = randomUUID();
  const users = { owner: "f-owner", viewer: "f-viewer", stranger: "f-stranger", otherOwner: "f-other-owner" };
  const roles: Record<string, [string, string]> = {
    [users.owner]: [companyId, "owner"],
    [users.viewer]: [companyId, "viewer"],
    [users.otherOwner]: [otherCompanyId, "owner"],
  };

  let stub: Server;
  const replies: Array<[string, Reply]> = [];
  const received: string[] = [];
  let agentId: string;
  let rootId: string;
  let otherIssueId: string;

  beforeAll(async () => {
    process.env.PAPERCLIP_SECRETS_MASTER_KEY = randomBytes(32).toString("hex");
    stub = createServer((req: IncomingMessage, res) => {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        received.push(body);
        const hit = replies.find(([marker]) => body.includes(marker));
        const reply: Reply = hit?.[1] ?? { choice: "code", noul: 0.1, confidence: 0.9 };
        setTimeout(() => {
          if (reply.status && reply.status !== 200) {
            res.writeHead(reply.status, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: { message: "down" } }));
            return;
          }
          res.writeHead(200, { "content-type": "application/json" });
          const answer = body.includes('"noul"') && !body.includes('"choice"')
            ? { type: "noul", noul: reply.noul ?? 0.1, confidence: reply.confidence ?? 0.9 }
            : { type: "choice", choice: reply.choice ?? "code", confidence: reply.confidence ?? 0.9 };
          res.end(JSON.stringify({ model: "typesafe/jev-1.14-test", answers: { q: answer } }));
        }, reply.delayMs ?? 0);
      });
    });
    await new Promise<void>((resolve) => stub.listen(0, "127.0.0.1", resolve));
    process.env.CREW_JEV_BASE_URL = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;

    temporary = await startEmbeddedPostgresTestDatabase("crew-jev-features-db-");
    db = createDb(temporary.connectionString);
    for (const [id, name] of [[companyId, "Crew"], [otherCompanyId, "Other"]] as const) {
      await db.insert(companies).values({
        id, name, issuePrefix: `F${id.replaceAll("-", "").slice(0, 6).toUpperCase()}`, requireBoardApprovalForNewAgents: false,
      });
    }
    process.env[CREW_POLICY_CONFIG_ENV] = configFile;
    writeFileSync(configFile, JSON.stringify({
      companies: {
        [companyId]: { reviewerAgentId: randomUUID(), integratorAgentId: randomUUID(), ownerUserId: users.owner },
        [otherCompanyId]: { reviewerAgentId: randomUUID(), integratorAgentId: randomUUID(), ownerUserId: users.otherOwner },
      },
    }));
    await db.insert(companyMemberships).values(Object.entries(roles).map(([principalId, [cid, membershipRole]]) => ({
      companyId: cid, principalType: "user", principalId, status: "active", membershipRole,
    })));
    const [agent] = await db.insert(agents).values({ companyId, name: "agent" }).returning();
    agentId = agent!.id;
    const [root] = await db.insert(issues).values({ companyId, title: "Gốc", status: "in_progress", priority: "medium" }).returning();
    rootId = root!.id;
    const [other] = await db.insert(issues).values({ companyId: otherCompanyId, title: "Của công ty khác", status: "todo", priority: "medium" }).returning();
    otherIssueId = other!.id;

    const namespace = crewJevTable("crew_jev_settings").split(".")[0]!;
    await db.execute(sql.raw(`CREATE SCHEMA IF NOT EXISTS ${namespace}`));
    for (const statement of statements("0021_jev_features.sql")) validatePluginMigrationStatement(statement, namespace);
    for (const file of ["0014_machine_pairings.sql", "0020_jev.sql", "0021_jev_features.sql"]) {
      for (const statement of statements(file)) await db.execute(sql.raw(statement));
    }
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

  async function app(actor: Record<string, unknown>) {
    const [{ crewContributionRoutes }, { errorHandler }] = await Promise.all([
      import("../crew/contribution-routes.js"),
      import("../middleware/index.js"),
    ]);
    const server = express();
    server.use(express.json({ limit: "10mb" }));
    server.use((req, _res, next) => {
      req.actor = actor as typeof req.actor;
      next();
    });
    server.use("/api", crewContributionRoutes(db));
    server.use(errorHandler);
    return server;
  }
  const as = (userId: string) => {
    const [cid, role] = roles[userId] ?? [companyId, "viewer"];
    const memberships = roles[userId] ? [{ companyId: cid, membershipRole: role, status: "active" }] : [];
    return app({ type: "board", userId, source: "session", isInstanceAdmin: false, companyIds: [cid], memberships });
  };
  const url = (suffix: string, cid = companyId) => `/api/crew/companies/${cid}/jev${suffix}`;
  const owner = async () => request(await as(users.owner));
  const viewer = async () => request(await as(users.viewer));

  const defaults = { enabled: true, gateMode: "shadow", model: "typesafe/jev-1.14", threshold: 0.5, timeoutMs: 3000, serverShadow: false };
  const putSettings = async (overrides: Record<string, unknown>) => {
    const res = await (await owner()).put(url("/settings")).send({ ...defaults, ...overrides });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res;
  };
  const rows = async (feature?: string) =>
    (await db.execute(sql.raw(`SELECT id::text AS id, company_id::text AS company_id, feature, issue_id::text AS issue_id, mode,
      jev_label, confidence, escalated, error_code, baseline, mismatch, shown, owner_outcome, input_excerpt
      FROM ${crewJevTable("crew_jev_judgments")} ${feature ? `WHERE feature = '${feature}'` : ""} ORDER BY id`))) as unknown as Array<Record<string, unknown>>;
  const waitFor = async (predicate: () => Promise<boolean>) => {
    for (let i = 0; i < 60; i += 1) {
      if (await predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("hết giờ chờ");
  };
  const reset = () => {
    replies.length = 0;
    received.length = 0;
    resetJevFeatureRateLimit();
  };
  const judgeNote = async (body: Record<string, unknown>, caller?: Awaited<ReturnType<typeof owner>>) =>
    (caller ?? (await owner())).post(url("/judge/approval-note")).send({ issueId: rootId, action: "approve", note: "Ổn rồi", ...body });
  const judgeType = async (body: Record<string, unknown> = {}) =>
    (await owner()).post(url("/judge/request-type")).send({ title: "Thêm nút xuất báo cáo", description: "Cần nút xuất báo cáo PDF", ...body });

  it("công tắc chung tắt: settings mặc định đủ bốn khóa shadow, mọi đường im lặng, không gọi Jev, không ghi dòng", async () => {
    reset();
    const settings = await (await owner()).get(url("/settings"));
    expect(settings.body.enabled).toBe(false);
    expect(settings.body.features).toEqual({ complexity: "shadow", approval_note: "shadow", request_type: "shadow", inbox_attention: "shadow" });

    // Có key nhưng công tắc chung tắt (đặt key bằng route thật).
    expect((await (await owner()).put(url("/key")).send({ apiKey: TEST_KEY })).status).toBe(200);
    await db.insert(issues).values({
      companyId, title: "Con", status: "todo", priority: "medium", parentId: rootId, createdByAgentId: agentId,
      description: "crew-model complexity=small model=claude-sonnet-5-5 effort=medium reason=nhỏ\nLàm gì đó",
      createdAt: new Date(Date.now() - 3 * 3_600_000),
    });
    expect((await judgeNote({})).body).toEqual({ ok: false, reason: "disabled" });
    expect((await judgeType()).body).toEqual({ ok: false, reason: "disabled" });
    expect(await runJevFeatureSweep(db)).toEqual({ companies: 0, complexity: 0, inbox: 0 });
    expect(await rows()).toHaveLength(0);
    expect(received).toHaveLength(0);

    // Mac vẫn thấy công tắc tắt qua pull hiện có: `enabled` lấy từ cùng cột.
    const pull = await db.execute(sql.raw(`SELECT enabled FROM ${crewJevTable("crew_jev_settings")}`));
    expect((pull as unknown as Array<{ enabled: boolean }>)[0]!.enabled).toBe(false);
  });

  it("PUT features: gộp từng khóa, kiểm giá trị, owner mới được đọc/ghi", async () => {
    const bad = await (await owner()).put(url("/settings")).send({ ...defaults, features: { complexity: "maybe" } });
    expect(bad.status).toBe(400);
    expect((await (await owner()).put(url("/settings")).send({ ...defaults, features: { other: "on" } })).status).toBe(400);
    const res = await putSettings({ features: { approval_note: "on" } });
    expect(res.body.features).toEqual({ complexity: "shadow", approval_note: "on", request_type: "shadow", inbox_attention: "shadow" });
    const again = await putSettings({ features: { request_type: "off" } });
    expect(again.body.features).toEqual({ complexity: "shadow", approval_note: "on", request_type: "off", inbox_attention: "shadow" });
    // Không gửi features thì giữ nguyên.
    expect((await putSettings({})).body.features).toEqual(again.body.features);
    expect((await (await viewer()).get(url("/settings"))).status).toBe(403);
    expect((await (await viewer()).get(url("/judgments/stats"))).status).toBe(403);
    expect((await (await viewer()).get(url("/judgments"))).status).toBe(403);
    expect((await (await viewer()).get(url("/inbox-attention"))).status).toBe(403);
  });

  it("lời nhắn duyệt (on): lệch, khớp, unclear, redact, người không phải owner vẫn gọi được", async () => {
    reset();
    replies.push(["REWORK", { choice: "request_changes", confidence: 0.9 }], ["LGTM", { choice: "approve", confidence: 0.9 }], ["VAGUE", { choice: "approve", confidence: 0.9 }]);
    const mismatch = await judgeNote({ note: `REWORK làm lại phần này ${LEAKED}\n\`\`\`js\nconst codeSecret = 1\n\`\`\`` });
    expect(mismatch.status).toBe(200);
    expect(mismatch.body).toMatchObject({ ok: true, mode: "on", label: "request_changes", mismatch: true });
    expect(mismatch.body.confidence).toBeGreaterThan(0.5);
    expect(typeof mismatch.body.judgmentId).toBe("string");
    expect(received.join("")).not.toContain(LEAKED);
    expect(received.join("")).not.toContain("codeSecret");

    const match = await judgeNote({ note: "LGTM, duyệt" });
    expect(match.body).toMatchObject({ ok: true, label: "approve", mismatch: false });

    // Jev không chắc: unclear, không lệch.
    replies.unshift(["UNSURE", { choice: "request_changes", confidence: 0.05 }]);
    const unsure = await judgeNote({ note: "UNSURE hmm" });
    expect(unsure.body).toMatchObject({ ok: true, label: "unclear", mismatch: false });

    // Lời nhắn rỗng: không gọi Jev.
    const before = received.length;
    expect((await judgeNote({ note: "   " })).body).toEqual({ ok: false, reason: "empty" });
    expect((await judgeNote({ note: "x", action: "nope" })).body).toEqual({ ok: false, reason: "invalid" });
    expect(received.length).toBe(before);

    // Thành viên không phải owner (viewer) vẫn gọi được, người ngoài company thì không.
    expect((await judgeNote({ note: "LGTM" }, await viewer())).body).toMatchObject({ ok: true });
    expect((await judgeNote({ note: "LGTM" }, request(await as(users.stranger)))).status).toBe(403);

    const logged = await rows("approval_note");
    expect(logged.map((row) => row.mismatch)).toEqual([true, false, false, false]);
    expect(logged[0]).toMatchObject({ mode: "on", shown: true, baseline: "approve", jev_label: "request_changes", issue_id: rootId });
    expect(String(logged[0]!.input_excerpt)).not.toContain(LEAKED);

    // Kết quả owner chọn.
    const outcome = await (await owner()).post(url(`/judgments/${mismatch.body.judgmentId}/outcome`)).send({ outcome: "changed" });
    expect(outcome.body).toEqual({ ok: true });
    expect((await rows("approval_note"))[0]!.owner_outcome).toBe("changed");
    expect((await (await owner()).post(url(`/judgments/${mismatch.body.judgmentId}/outcome`)).send({ outcome: "BAD VALUE" })).body).toEqual({ ok: false, reason: "invalid" });
  });

  it("cách ly company: issue và dòng đo của company khác không dùng được", async () => {
    reset();
    const foreign = await judgeNote({ issueId: otherIssueId, note: "LGTM" });
    expect(foreign.body).toEqual({ ok: false, reason: "not_found" });
    expect(received).toHaveLength(0);
    const [first] = await rows("approval_note");
    const otherOwner = request(await as(users.otherOwner));
    const stolen = await otherOwner.post(url(`/judgments/${first!.id}/outcome`, otherCompanyId)).send({ outcome: "sent" });
    expect(stolen.body).toEqual({ ok: false, reason: "not_found" });
    expect((await otherOwner.get(url("/judgments", otherCompanyId))).body.items).toEqual([]);
    expect((await otherOwner.get(url("/judgments", companyId))).status).toBe(404);
  });

  it("tính năng off: không gọi Jev, không ghi dòng", async () => {
    reset();
    const before = (await rows()).length;
    // request_type đang off từ bước PUT trước.
    expect((await judgeType()).body).toEqual({ ok: false, reason: "off" });
    expect(received).toHaveLength(0);
    expect((await rows()).length).toBe(before);
  });

  it("request_type: on trả nhãn; ngắn/không chắc/lỗi/timeout là ok:false 200 trong hạn", async () => {
    await putSettings({ features: { request_type: "on" } });
    reset();
    replies.push(["NGHIENCUU", { choice: "research", confidence: 0.9 }], ["MOHO", { choice: "docs", confidence: 0.05 }],
      ["HONG", { status: 503 }], ["CHAM", { delayMs: 2500, choice: "bug" }]);
    const ok = await judgeType({ title: "NGHIENCUU so sánh thư viện", current: "code" });
    expect(ok.body).toMatchObject({ ok: true, mode: "on", label: "research" });
    expect(typeof ok.body.judgmentId).toBe("string");
    expect((await judgeType({ title: "a", description: "" })).body).toEqual({ ok: false, reason: "too_short" });
    expect((await judgeType({ title: "MOHO không rõ ràng" })).body).toEqual({ ok: false, reason: "unsure" });
    const down = await judgeType({ title: "HONG dịch vụ" });
    expect(down.status).toBe(200);
    expect(down.body).toEqual({ ok: false, reason: "unreachable" });

    const started = Date.now();
    const slow = await judgeType({ title: "CHAM mô tả dài dài" });
    expect(Date.now() - started).toBeLessThan(1500);
    expect(slow.status).toBe(200);
    expect(slow.body).toEqual({ ok: false, reason: "timeout" });

    const logged = await rows("request_type");
    expect(logged.map((row) => row.error_code)).toEqual([null, null, "unreachable", "timeout"]);
    expect(logged[0]).toMatchObject({ jev_label: "research", baseline: "code", mismatch: true, shown: true });

    // Mất key: im lặng.
    const outcome = await (await owner()).post(url(`/judgments/${ok.body.judgmentId}/outcome`)).send({ outcome: "code" });
    expect(outcome.body).toEqual({ ok: true });
  });

  it("shadow: trả ngay không chờ Jev, ghi dòng ở nền, owner không thấy nhãn", async () => {
    await putSettings({ features: { request_type: "shadow" } });
    reset();
    replies.push(["BONEN", { delayMs: 400, choice: "bug", confidence: 0.9 }]);
    const before = (await rows("request_type")).length;
    const started = Date.now();
    const res = await judgeType({ title: "BONEN sửa lỗi đăng nhập" });
    expect(Date.now() - started).toBeLessThan(300);
    expect(res.body).toEqual({ ok: true, mode: "shadow", label: null, confidence: null, judgmentId: null });
    await waitFor(async () => (await rows("request_type")).length === before + 1);
    expect((await rows("request_type")).at(-1)).toMatchObject({ mode: "shadow", jev_label: "bug", shown: false });
  });

  it("thiếu key: ok:false no_key và không ghi dòng", async () => {
    reset();
    await db.execute(sql.raw(`UPDATE ${crewJevTable("crew_jev_settings")} SET key_secret_id = NULL, key_fingerprint = NULL`));
    const before = (await rows()).length;
    expect((await judgeNote({ note: "LGTM" })).body).toEqual({ ok: false, reason: "no_key" });
    expect(await runJevFeatureSweep(db)).toEqual({ companies: 0, complexity: 0, inbox: 0 });
    expect((await rows()).length).toBe(before);
    expect(received).toHaveLength(0);
    expect((await (await owner()).put(url("/key")).send({ apiKey: TEST_KEY })).status).toBe(200);
  });

  it("độ phức tạp: tạo issue không gọi Jev; worker nền ghi lệch; cờ chỉ hiện khi on; luật ảnh không cần Jev", async () => {
    await putSettings({ features: { complexity: "shadow" } });
    reset();
    replies.push(["BAOMAT", { noul: 0.95, confidence: 0.9 }], ["VANDE", { noul: 0.05, confidence: 0.9 }], ["LON", { noul: 0.95, confidence: 0.9 }]);
    const line = (complexity: string, model = "claude-sonnet-5-5") => `crew-model complexity=${complexity} model=${model} effort=medium reason=thử\n`;
    const [secure, plain, large] = await Promise.all([
      ["BAOMAT đổi phân quyền", "small"], ["VANDE sửa chữ", "small"], ["LON đổi migration", "large"],
    ].map(async ([title, complexity]) => (await db.insert(issues).values({
      companyId, title: title!, status: "todo", priority: "medium", parentId: rootId, createdByAgentId: agentId,
      description: `${line(complexity!)}${title}\n\`\`\`sql\nDROP TABLE x;\n\`\`\``,
    }).returning())[0]!));
    // Issue do người tạo hoặc không có dòng crew-model không bị xét.
    await db.insert(issues).values({ companyId, title: "Người tạo", status: "todo", priority: "medium", parentId: rootId, createdByUserId: "u", description: line("small") });
    await db.insert(issues).values({ companyId, title: "Không dòng", status: "todo", priority: "medium", parentId: rootId, createdByAgentId: agentId, description: "không có" });
    expect(received).toHaveLength(0);

    // Phiên bản opencode không đọc được ảnh + ảnh đính kèm.
    const [vision] = await db.insert(issues).values({
      companyId, title: "Có ảnh", status: "todo", priority: "medium", parentId: rootId, createdByAgentId: agentId,
      description: "crew-model complexity=small model=opencode-go/kimi-k3 effort=default runtime=opencode_local reason=ảnh\nLàm theo ảnh",
    }).returning();
    const [asset] = await db.insert(assets).values({
      companyId, provider: "local", objectKey: `k/${randomUUID()}`, contentType: "image/png", byteSize: 1, sha256: "0".repeat(64),
    }).returning();
    await db.insert(issueAttachments).values({ companyId, issueId: vision!.id, assetId: asset!.id });

    const sweep = await runJevFeatureSweep(db);
    expect(sweep.complexity).toBe(4);
    const logged = await rows("complexity");
    const byIssue = (id: string) => logged.find((row) => row.issue_id === id)!;
    expect(byIssue(secure.id)).toMatchObject({ mismatch: true, jev_label: "yes", baseline: "small", mode: "shadow", shown: false });
    expect(byIssue(plain.id)).toMatchObject({ mismatch: false, jev_label: "no" });
    expect(byIssue(large.id)).toMatchObject({ mismatch: false, jev_label: "yes", baseline: "large" });
    expect(String(byIssue(secure.id).input_excerpt)).not.toContain("DROP TABLE");
    // Lượt sau không hỏi lại.
    const calls = received.length;
    expect((await runJevFeatureSweep(db)).complexity).toBe(0);
    expect(received.length).toBe(calls);

    // Shadow: không có cờ nào lộ ra.
    expect((await (await owner()).get(url(`/issues/${secure.id}/summary`))).body.complexityFlag).toBeNull();
    expect((await (await owner()).get(url(`/requests/${rootId}/map`))).body.complexityFlags).toEqual({});

    await putSettings({ features: { complexity: "on" } });
    const summary = await (await owner()).get(url(`/issues/${secure.id}/summary`));
    expect(summary.body.complexityFlag).toEqual({
      jevSaysLarge: true, declared: "small", kind: "jev", reason: expect.stringContaining("Jev"),
    });
    expect((await (await owner()).get(url(`/issues/${plain.id}/summary`))).body.complexityFlag).toBeNull();
    expect((await (await owner()).get(url(`/issues/${large.id}/summary`))).body.complexityFlag).toBeNull();
    const visionSummary = await (await owner()).get(url(`/issues/${vision!.id}/summary`));
    expect(visionSummary.body.complexityFlag).toMatchObject({ jevSaysLarge: false, kind: "vision", declared: "small" });
    const map = await (await owner()).get(url(`/requests/${rootId}/map`));
    expect(Object.keys(map.body.complexityFlags).sort()).toEqual([secure.id, vision!.id].sort());
    expect(map.body.complexityFlags[secure.id].kind).toBe("jev");

    // Tắt chung: cờ biến mất và worker dừng.
    await putSettings({ enabled: false });
    expect((await (await owner()).get(url(`/issues/${secure.id}/summary`))).body.complexityFlag).toBeNull();
    expect(await runJevFeatureSweep(db)).toEqual({ companies: 0, complexity: 0, inbox: 0 });
    await putSettings({ enabled: true });
  });

  it("độ phức tạp: Jev lỗi chỉ ghi dòng lỗi, worker không ném", async () => {
    reset();
    replies.push(["HONGHET", { status: 503 }]);
    const [broken] = await db.insert(issues).values({
      companyId, title: "HONGHET", status: "todo", priority: "medium", parentId: rootId, createdByAgentId: agentId,
      description: "crew-model complexity=medium model=claude-sonnet-5-5 effort=high reason=x\nHONGHET",
    }).returning();
    await expect(runJevFeatureSweep(db)).resolves.toMatchObject({ complexity: 1 });
    expect((await rows("complexity")).find((row) => row.issue_id === broken!.id)).toMatchObject({
      error_code: "unreachable", mismatch: null, jev_label: null, shown: false,
    });
    expect((await runJevFeatureSweep(db)).complexity).toBe(0);
  });

  it("hộp duyệt: luật xác định, Jev ở nền có cache, chỉ hiện khi on", async () => {
    reset();
    await putSettings({ features: { inbox_attention: "shadow" } });
    const summaryText = (decided: string, ask: string) =>
      `### Đã tự quyết định\n${decided}\n\n### Cần owner quyết định\n${ask}\n`;
    const [quiet, asking, risky, product] = await Promise.all([
      summaryText("- Không có.", "- Không có."),
      summaryText("- Không có.", "Q1. Giữ hay bỏ?\n- a) giữ\n- b) bỏ"),
      `Đã đổi packages/db/src/migrations/0099_x.sql\n${summaryText("- Không có.", "- Không có.")}`,
      summaryText("- SANPHAM đổi giá gói từ 5 lên 9 đô — vì chi phí\n- Đặt tên biến theo camelCase — quy ước", "- Không có."),
    ].map(async (description, index) => (await db.insert(issues).values({
      companyId, title: `Duyệt ${index}`, status: "in_review", priority: "medium", description,
    }).returning())[0]!));
    replies.push(["SANPHAM", { noul: 0.93, confidence: 0.9 }]);

    // Shadow: hộp duyệt không đổi, nhưng worker vẫn đo.
    const ids = [quiet, asking, risky, product].map((issue) => issue.id).join(",");
    expect((await (await owner()).get(url(`/inbox-attention?issueIds=${ids}`))).body).toEqual({ enabled: true, mode: "shadow", items: [] });
    const sweep = await runJevFeatureSweep(db);
    expect(sweep.inbox).toBe(2);
    const logged = await rows("inbox_attention");
    expect(logged).toHaveLength(2);
    expect(logged.find((row) => String(row.input_excerpt).includes("SANPHAM"))).toMatchObject({ jev_label: "yes", mismatch: true, shown: false, baseline: "none" });
    expect(logged.find((row) => String(row.input_excerpt).includes("camelCase"))).toMatchObject({ jev_label: "no", mismatch: false });
    // Cache: không hỏi lại cùng dòng.
    const calls = received.length;
    expect((await runJevFeatureSweep(db)).inbox).toBe(0);
    expect(received.length).toBe(calls);

    await putSettings({ features: { inbox_attention: "on" } });
    const res = await (await owner()).get(url(`/inbox-attention?issueIds=${ids}`));
    expect(res.status).toBe(200);
    const items = Object.fromEntries((res.body.items as Array<{ issueId: string; reasons: Array<{ kind: string; text: string }> }>).map((item) => [item.issueId, item.reasons]));
    expect(Object.keys(items).sort()).toEqual([asking.id, risky.id, product.id].sort());
    expect(items[asking.id]!.map((reason) => reason.kind)).toEqual(["owner_decision"]);
    expect(items[risky.id]!.map((reason) => reason.kind)).toEqual(["risky_paths"]);
    expect(items[product.id]!.every((reason) => reason.kind === "jev_product_decision")).toBe(true);
    expect(res.body).toMatchObject({ enabled: true, mode: "on" });

    // Sửa dòng quyết định thì băm đổi: huy hiệu Jev cũ không còn áp dụng cho dòng mới.
    await db.execute(sql`UPDATE "issues" SET description = ${summaryText("- Dòng mới hoàn toàn", "- Không có.")} WHERE id = ${product.id}`);
    const edited = await (await owner()).get(url(`/inbox-attention?issueIds=${product.id}`));
    expect(edited.body.items).toEqual([]);

    // Tham số sai và issue của company khác.
    expect((await (await owner()).get(url("/inbox-attention?issueIds=abc"))).status).toBe(400);
    expect((await (await owner()).get(url(`/inbox-attention?issueIds=${otherIssueId}`))).body.items).toEqual([]);

    // Tắt chung: im lặng.
    await putSettings({ enabled: false });
    expect((await (await owner()).get(url(`/inbox-attention?issueIds=${ids}`))).body).toEqual({ enabled: false, mode: "off", items: [] });
    await putSettings({ enabled: true });
  });

  it("stats và danh sách: theo tính năng × chế độ, lọc lệch, che secret", async () => {
    const stats = await (await owner()).get(url("/judgments/stats?days=7"));
    expect(stats.status).toBe(200);
    const find = (feature: string, mode: string) => stats.body.rows.find((row: { feature: string; mode: string }) => row.feature === feature && row.mode === mode);
    expect(find("approval_note", "on")).toMatchObject({ total: 4, mismatch: 1, shown: 1, outcomes: { changed: 1 } });
    expect(find("request_type", "on")).toMatchObject({ total: 4, error: 2, outcomes: { code: 1 } });
    expect(find("request_type", "shadow").total).toBeGreaterThanOrEqual(1);
    expect(find("complexity", "shadow").mismatch).toBe(1);
    expect(typeof find("approval_note", "on").p95Ms).toBe("number");

    const list = await (await owner()).get(url("/judgments?feature=approval_note&mismatch=true"));
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({ feature: "approval_note", mismatch: true, baseline: "approve" });
    expect(JSON.stringify(list.body)).not.toContain(LEAKED);
    expect((await (await owner()).get(url("/judgments?feature=nope"))).status).toBe(400);
    expect((await (await owner()).get(url("/judgments?days=1"))).status).toBe(400);
  });

  it("route judge không bao giờ 5xx khi bảng chưa có", async () => {
    // Bảng đo biến mất (plugin chưa nâng cấp): judge và PUT features xử lý êm.
    const table = crewJevTable("crew_jev_judgments");
    await db.execute(sql.raw(`ALTER TABLE ${table} RENAME TO crew_jev_judgments_off`));
    try {
      await putSettings({ features: undefined });
      const res = await judgeNote({ note: "LGTM" });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: false, reason: "unavailable" });
      expect((await (await owner()).put(url("/settings")).send({ ...defaults, features: { complexity: "on" } })).status).toBe(503);
      expect((await runJevFeatureSweep(db)).complexity).toBe(0);
      await expect(runJevShadowSweep(db, new Date(), { forcePurge: true })).resolves.toBeDefined();
    } finally {
      await db.execute(sql.raw(`ALTER TABLE ${table}_off RENAME TO crew_jev_judgments`));
    }
  });

  it("truy vấn mới dùng index (EXPLAIN với dữ liệu mẫu)", async () => {
    const table = crewJevTable("crew_jev_judgments");
    // Company này giữ ~4000 dòng trong 28 ngày; các company khác 40 000 dòng (một phần quá hạn 30 ngày).
    await db.execute(sql.raw(`INSERT INTO ${table} (company_id, feature, issue_id, mode, question_hash, escalated, shown, created_at)
      SELECT '${companyId}', (ARRAY['complexity','approval_note','request_type','inbox_attention'])[1 + g % 4],
        CASE WHEN g % 4 IN (0, 3) THEN gen_random_uuid() ELSE NULL END, 'shadow', 'h' || g, false, false,
        now() - ((g * 10) || ' minutes')::interval
      FROM generate_series(1, 4000) g`));
    await db.execute(sql.raw(`INSERT INTO ${table} (company_id, feature, issue_id, mode, question_hash, escalated, shown, created_at)
      SELECT gen_random_uuid(), 'complexity', gen_random_uuid(), 'shadow', 'z', false, false,
        CASE WHEN g % 400 = 0 THEN now() - interval '60 days' ELSE now() - ((g % 20000) || ' minutes')::interval END
      FROM generate_series(1, 40000) g`));
    await db.execute(sql.raw(`ANALYZE ${table}`));
    await db.execute(sql`INSERT INTO issues (company_id, title, status, priority, parent_id, created_by_agent_id, description, created_at)
      SELECT ${companyId}, 'E' || g, CASE WHEN g % 100 = 0 THEN 'in_review' ELSE 'todo' END, 'medium', NULL, NULL, 'x',
        now() - (g || ' hours')::interval FROM generate_series(1, 30000) g`);
    await db.execute(sql`ANALYZE issues`);
    const explain = async (query: ReturnType<typeof sql>) =>
      ((await db.execute(sql`EXPLAIN ${query}`)) as unknown as Array<{ "QUERY PLAN": string }>).map((row) => row["QUERY PLAN"]).join("\n");

    const stats = await explain(judgmentStatsSql(companyId, 7));
    expect(stats).toMatch(/crew_jev_judgments_feature_idx/);
    expect(stats).not.toMatch(/Seq Scan on crew_jev_judgments/);
    const list = await explain(judgmentsListSql(companyId, { feature: "complexity", mismatch: false }));
    expect(list).toMatch(/crew_jev_judgments_feature_idx/);
    const issueIds = [randomUUID(), randomUUID()];
    const forIssues = await explain(issueJudgmentsSql(companyId, "complexity", issueIds));
    expect(forIssues).toMatch(/crew_jev_judgments_issue_idx/);
    expect(forIssues).not.toMatch(/Seq Scan on crew_jev_judgments/);
    const purge = await explain(sql`DELETE FROM ${sql.raw(table)} WHERE created_at < now() - interval '30 days'`);
    expect(purge).toMatch(/crew_jev_judgments_created_idx/);
    const complexity = await explain(complexityCandidatesSql(companyId, new Date(Date.now() - 7_200_000)));
    expect(complexity).toMatch(/issues_company_created_idx/);
    const inbox = await explain(inboxCandidatesSql(companyId, new Date(Date.now() - 7 * 86_400_000)));
    expect(inbox).toMatch(/issues_company_(status|updated)_idx/);
    expect(inbox).not.toMatch(/Seq Scan on issues/);
  }, 60_000);
});

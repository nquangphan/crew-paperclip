import { readFile } from "node:fs/promises";
import { afterAll, expect, it } from "vitest";
import type { PluginAuthorizationAuditEntry, PluginContext } from "@paperclipai/plugin-sdk";
import postgres from "../../../db/node_modules/postgres";
import { startEmbeddedPostgresTestDatabase } from "../../../db/src/test-embedded-postgres.js";
import { pluginManifestV1Schema } from "../../../shared/src/validators/plugin.js";
import {
  derivePluginDatabaseNamespace,
  validatePluginMigrationStatement,
  validatePluginRuntimeExecute,
  validatePluginRuntimeQuery,
} from "../../../../server/src/services/plugin-database.js";
import manifest from "../manifest.js";
import { registerAttachmentsAudit, runAttachmentsAudit } from "../attachments/audit.js";

const companyId = "10000000-0000-4000-8000-000000000001";
const unconfigured = "10000000-0000-4000-8000-000000000002";
const brokenConfig = "10000000-0000-4000-8000-000000000003";
const issueA = "30000000-0000-4000-8000-000000000001";
const issueB = "30000000-0000-4000-8000-000000000002";
const issueC = "30000000-0000-4000-8000-000000000003";
const issueD = "30000000-0000-4000-8000-000000000004";
const attId = (n: number) => `50000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const ns = derivePluginDatabaseNamespace("crew.core");
const SUFFIX = "Hãy gửi lại dưới dạng ảnh, PDF, DOCX, XLSX, CSV hoặc text.";
let cleanup: (() => Promise<void>) | undefined;
afterAll(async () => { await cleanup?.(); });

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52, 1, 2, 3]);
const MACHO = Buffer.concat([Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0x07, 0, 0, 0x01]), Buffer.alloc(64)]);

type Upload = {
  id: string; issueId: string; name: string | null; type: string; bytes?: Buffer | "throw" | null; at: number;
  /** Activity written by the runner protocol: no file name or content type in its details. */
  bare?: boolean;
};

it("cảnh báo file đính kèm agent sẽ không đọc, mỗi file một lần, không đánh thức assignee", async () => {
  const parsed = pluginManifestV1Schema.parse(manifest);
  for (const capability of ["issue.attachments.read", "jobs.schedule", "authorization.audit.read", "companies.read"]) {
    expect(parsed.capabilities).toContain(capability);
  }
  expect(parsed.jobs).toEqual([{
    jobKey: "attachments-audit", displayName: "Kiểm file đính kèm",
    description: "Cảnh báo file đính kèm agent sẽ không đọc", schedule: "* * * * *",
  }]);

  const database = await startEmbeddedPostgresTestDatabase("crew-attachments-");
  const sql = postgres(database.connectionString, { max: 2, onnotice: () => {} });
  cleanup = async () => { await sql.end(); await database.cleanup(); };
  await sql.unsafe(`CREATE SCHEMA ${ns}`);
  const migration = await readFile(new URL("../../migrations/0005_attachment_audit.sql", import.meta.url), "utf8");
  for (const statement of migration.split(";").map((part) => part.trim()).filter(Boolean)) {
    validatePluginMigrationStatement(statement, ns, manifest.database!.coreReadTables);
    await sql.unsafe(statement);
  }

  const now = new Date();
  const at = (secondsAgo: number) => now.getTime() - secondsAgo * 1000;
  const uploads: Upload[] = [];
  const extraActivities: PluginAuthorizationAuditEntry[] = [];
  const activity = (u: Upload): PluginAuthorizationAuditEntry => ({
    id: `act-${u.id}`, companyId, actorType: "user", actorId: "user-1", action: "issue.attachment_added",
    entityType: "issue", entityId: u.issueId, createdAt: new Date(u.at).toISOString(),
    details: u.bare
      ? { attachmentId: u.id, source: "paperclip_runner_protocol" }
      : { attachmentId: u.id, originalFilename: u.name, contentType: u.type, byteSize: 10 },
  });
  const searches: { companyId: string; offset: number }[] = [];
  const contentReads: string[] = [];
  const comments: unknown[][] = [];
  let failComment: string | null = null;
  const logs: unknown[] = [];
  const record = (level: string) => (message: string, meta?: Record<string, unknown>) => { logs.push({ level, message, meta }); };
  let registered: { key: string; fn: () => Promise<void> } | undefined;

  const ctx = {
    logger: { debug: record("debug"), info: record("info"), warn: record("warn"), error: record("error") },
    jobs: { register: (key: string, fn: () => Promise<void>) => { registered = { key, fn }; } },
    companies: { list: async () => [{ id: companyId }, { id: unconfigured }, { id: brokenConfig }] },
    config: {
      get: async (id: string) => {
        if (id === brokenConfig) throw new Error("company context is required");
        return id === companyId ? { companies: [{ companyId }] } : { companies: [] };
      },
    },
    authorization: {
      audit: {
        search: async (input: { companyId: string; action?: string; limit?: number; offset?: number }) => {
          searches.push({ companyId: input.companyId, offset: input.offset ?? 0 });
          expect(input.action).toBe("issue.attachment_added");
          const all = input.companyId === companyId ? [...uploads.map(activity), ...extraActivities] : [];
          all.sort((a, b) => Date.parse(String(b.createdAt)) - Date.parse(String(a.createdAt)));
          const offset = input.offset ?? 0;
          return all.slice(offset, offset + Math.min(input.limit ?? 50, 100));
        },
      },
    },
    issues: {
      getAttachmentContent: async (id: string, company: string, options?: { maxBytes?: number | null }) => {
        expect(company).toBe(companyId);
        expect(options?.maxBytes).toBe(10 * 1024 * 1024);
        contentReads.push(id);
        const u = uploads.find((candidate) => candidate.id === id);
        if (!u || u.bytes === null || u.bytes === undefined) return null;
        if (u.bytes === "throw") throw new Error(`asset too large: ${u.name}`);
        return { attachmentId: id, contentType: u.type, byteSize: u.bytes.length, sha256: "x", originalFilename: u.name,
          contentBase64: u.bytes.toString("base64") };
      },
      listAttachments: async (issueId: string, company: string) => {
        expect(company).toBe(companyId);
        return uploads.filter((u) => u.issueId === issueId)
          .map((u) => ({ id: u.id, issueId, originalFilename: u.name, contentType: u.type }));
      },
      createComment: async (...args: unknown[]) => {
        if (failComment === args[0]) throw new Error("issue locked");
        comments.push(args);
        return { id: `c${comments.length}` };
      },
    },
    db: {
      namespace: ns,
      query: async <T>(query: string, params: unknown[] = []) => {
        validatePluginRuntimeQuery(query, ns, manifest.database!.coreReadTables);
        return await sql.unsafe<T[]>(query, params as never[]);
      },
      execute: async (query: string, params: unknown[] = []) => {
        validatePluginRuntimeExecute(query, ns);
        return { rowCount: (await sql.unsafe(query, params as never[])).count };
      },
    },
  } as unknown as PluginContext;
  const rows = async () => await sql.unsafe<{ attachment_id: string; issue_id: string; verdict: string; reason: string | null; warned: boolean }[]>(
    `SELECT attachment_id::text, issue_id::text, verdict, reason, warned_at IS NOT NULL AS warned FROM ${ns}.crew_attachment_audit ORDER BY attachment_id`,
  );
  const line = (name: string, reason: string) => `File \`${name}\` không được agent đọc: ${reason}. ${SUFFIX}`;

  // The job is registered under the manifest key and runs the audit.
  registerAttachmentsAudit(ctx);
  expect(registered?.key).toBe("attachments-audit");

  // 1. Three uploads on one issue: one comment with the two blocked files in upload order.
  uploads.push(
    { id: attId(1), issueId: issueA, name: "tool.zip", type: "application/zip", at: at(50) },
    { id: attId(2), issueId: issueA, name: "fake.png", type: "image/png", bytes: MACHO, at: at(40) },
    { id: attId(3), issueId: issueA, name: "ok.png", type: "image/png", bytes: PNG, at: at(30) },
  );
  expect(await runAttachmentsAudit(ctx, now)).toEqual({ checked: 3, warned: 2 });
  expect(comments).toEqual([[issueA, [
    line("tool.zip", "kiểu file không được phép (zip)"),
    line("fake.png", "kiểu file không được phép (exe)"),
  ].join("\n"), companyId]]);
  // 3. No options argument at all, so no actorUserId: a plugin comment wakes nobody.
  expect(comments[0]).toHaveLength(3);
  expect(await rows()).toEqual([
    { attachment_id: attId(1), issue_id: issueA, verdict: "blocked", reason: "kiểu file không được phép (zip)", warned: true },
    { attachment_id: attId(2), issue_id: issueA, verdict: "blocked", reason: "kiểu file không được phép (exe)", warned: true },
    { attachment_id: attId(3), issue_id: issueA, verdict: "allowed", reason: null, warned: false },
  ]);
  // Bytes are read only for the signature-checked names.
  expect(contentReads).toEqual([attId(2), attId(3)]);
  // 6. A company without its own entry in the config (or whose config cannot be read) is never scanned.
  expect(searches.map((s) => s.companyId)).toEqual([companyId]);

  // 2. A second run warns nothing again and reads no bytes again.
  searches.length = 0;
  expect(await runAttachmentsAudit(ctx, now)).toEqual({ checked: 0, warned: 0 });
  expect(comments).toHaveLength(1);
  expect(contentReads).toHaveLength(2);
  expect(searches).toEqual([{ companyId, offset: 0 }]);

  // 4. Content that cannot be read (over maxBytes throws, unknown returns null) is `unreadable`, never warned.
  uploads.push(
    { id: attId(4), issueId: issueB, name: "huge.png", type: "image/png", bytes: "throw", at: at(20) },
    { id: attId(5), issueId: issueB, name: "gone.pdf", type: "application/pdf", bytes: null, at: at(19) },
  );
  expect(await runAttachmentsAudit(ctx, now)).toEqual({ checked: 2, warned: 0 });
  expect(comments).toHaveLength(1);
  expect((await rows()).filter((r) => r.issue_id === issueB).map((r) => r.verdict)).toEqual(["unreadable", "unreadable"]);

  // 8. Activities that are not about an issue or carry no attachment id are skipped.
  extraActivities.push(
    { ...activity({ id: attId(6), issueId: issueB, name: "x.zip", type: "application/zip", at: at(18) }), entityType: "agent" },
    { ...activity({ id: attId(7), issueId: issueB, name: "y.zip", type: "application/zip", at: at(17) }), details: { originalFilename: "y.zip" } },
    { ...activity({ id: attId(8), issueId: issueB, name: "z.zip", type: "application/zip", at: at(16) }),
      details: { attachmentId: "not-a-uuid", originalFilename: "z.zip", contentType: "application/zip" } },
  );
  expect(await runAttachmentsAudit(ctx, now)).toEqual({ checked: 0, warned: 0 });
  expect(await rows()).toHaveLength(5);

  // 5. A first page full of new ids is followed by offset=100; a page with a known id ends the scan.
  for (let i = 0; i < 150; i++) {
    uploads.push({ id: attId(0x100 + i), issueId: issueC, name: `n${i}.md`, type: "text/markdown", at: at(15) + i });
  }
  searches.length = 0;
  expect(await runAttachmentsAudit(ctx, now)).toEqual({ checked: 150, warned: 0 });
  expect(searches.map((s) => s.offset)).toEqual([0, 100]);
  uploads.push({ id: attId(0x300), issueId: issueC, name: "late.md", type: "text/markdown", at: at(1) });
  searches.length = 0;
  expect(await runAttachmentsAudit(ctx, now)).toEqual({ checked: 1, warned: 0 });
  expect(searches.map((s) => s.offset)).toEqual([0]);

  // A failed comment is retried on the next run (the name comes from the attachment list), then never again.
  // Uploads older than the 24 h look-back are ignored, and an activity without name/type is judged from the list.
  const later = new Date(now.getTime() + 5_000);
  uploads.push(
    { id: attId(0x400), issueId: issueD, name: "setup.exe", type: "application/x-msdownload", at: at(-1) },
    { id: attId(0x401), issueId: issueD, name: "old.zip", type: "application/zip", at: at(25 * 3600) },
  );
  uploads.push({
    id: attId(0x402), issueId: issueD, name: "slides.pptx", bare: true, at: at(-2),
    type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  });
  failComment = issueD;
  expect(await runAttachmentsAudit(ctx, later)).toEqual({ checked: 2, warned: 0 });
  expect(comments).toHaveLength(1);
  failComment = null;
  expect(await runAttachmentsAudit(ctx, later)).toEqual({ checked: 0, warned: 2 });
  expect(comments[1]).toEqual([issueD, [
    line("setup.exe", "kiểu file không được phép (exe)"),
    line("slides.pptx", "kiểu file không được phép (pptx)"),
  ].join("\n"), companyId]);
  expect(await runAttachmentsAudit(ctx, later)).toEqual({ checked: 0, warned: 0 });
  expect(comments).toHaveLength(2);
  expect((await rows()).some((r) => r.attachment_id === attId(0x401))).toBe(false);

  // The registered job handler runs the same audit and never throws on a failing company.
  (ctx.authorization.audit as { search: unknown }).search = async () => { throw new Error("db down tool.zip"); };
  await expect(registered!.fn()).resolves.toBeUndefined();

  // 7. Logs carry company ids and counts only: no file name, content type or bytes.
  const logText = JSON.stringify(logs);
  expect(logs.length).toBeGreaterThan(0);
  for (const secret of ["tool.zip", "fake.png", "huge.png", "setup.exe", "slides.pptx", "application/", "image/",
    PNG.toString("base64"), MACHO.toString("base64").slice(0, 12), "asset too large", "issue locked", "db down"]) {
    expect(logText).not.toContain(secret);
  }
  expect(logText).toContain(companyId);
}, 90_000);

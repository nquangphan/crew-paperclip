import type { PluginAuthorizationAuditEntry, PluginContext } from "@paperclipai/plugin-sdk";
import { pluginNamespace, UUID } from "../shared/db.js";
import { type AuditVerdict, judgeBytes, judgeByName, sanitizeFilename } from "./rules.js";

/**
 * Paperclip accepts every attachment type (no upload hook in Crew); `crew-mac files` refuses the forbidden
 * ones when an agent reads them. This job tells the owner within about a minute: it reads new
 * `issue.attachment_added` activity, judges each attachment once and posts one comment per issue for the
 * newly blocked files. The comment carries no `actorUserId`, so it wakes nobody.
 *
 * Bytes are read only for signature-checked names (images, PDF, DOCX, XLSX), to catch an executable
 * renamed to one of them; only the first 16 bytes are decoded and nothing is kept or logged. Logs carry
 * company ids and counts only, never a file name, a content type or bytes.
 *
 * Known limit: the SDK's `getAttachmentContent` has no byte-range or stream option, so each such upload is
 * downloaded whole (up to 10 MB, about 13 MB in base64) to read 16 bytes. Revisit when the SDK offers a range.
 *
 * Failures are retried with a growing delay (1, 2, 4 ... up to 60 minutes) kept in worker memory, so a
 * deleted issue or a broken read does not cost one host call and one log line per minute for 24 hours. A
 * restart of the worker only resets the delays; the audit table stays the source of truth.
 */

const JOB_KEY = "attachments-audit";
const ACTION = "issue.attachment_added";
const PAGE_SIZE = 100;
const MAX_PAGES = 20;
/** Uploads older than this are not audited: bounds the first run after install and the retry of failed comments. */
const LOOKBACK_MS = 24 * 60 * 60 * 1000;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
/** 24 base64 characters decode to 18 bytes, enough for the 16-byte signature check. */
const HEAD_BASE64_CHARS = 24;
/** Failed reads of a file's bytes before it is recorded as `unreadable`. */
const MAX_READ_ATTEMPTS = 3;
const BASE_RETRY_MS = 60_000;
const MAX_RETRY_MS = 60 * 60_000;
const RESEND_HINT = "Hãy gửi lại dưới dạng ảnh, PDF, DOCX, XLSX, CSV hoặc text.";

type Ctx = Pick<PluginContext, "db" | "logger" | "issues" | "authorization" | "companies" | "config">;

interface Upload {
  attachmentId: string;
  issueId: string;
  createdAt: number;
  /** `undefined` when the activity has no file metadata (runner-protocol uploads). */
  filename: string | null | undefined;
  contentType: string | undefined;
}

interface Retry { attempts: number; nextAt: number }
interface RetryState { reads: Map<string, Retry>; comments: Map<string, Retry> }
const retryStates = new WeakMap<object, RetryState>();

function retryStateOf(ctx: Ctx): RetryState {
  let state = retryStates.get(ctx);
  if (!state) { state = { reads: new Map(), comments: new Map() }; retryStates.set(ctx, state); }
  return state;
}

/** Records one more failure for `key` and returns the new attempt count. */
function failed(map: Map<string, Retry>, key: string, now: number): number {
  const attempts = (map.get(key)?.attempts ?? 0) + 1;
  map.set(key, { attempts, nextAt: now + Math.min(BASE_RETRY_MS * 2 ** (attempts - 1), MAX_RETRY_MS) });
  return attempts;
}

const table = (ctx: Ctx) => `${pluginNamespace(ctx)}.crew_attachment_audit`;

/** Postgres array literal of already validated uuids, as in roles/data.ts. */
function uuidArray(ids: string[]): string {
  if (!ids.every((id) => UUID.test(id))) throw new Error("ID không hợp lệ");
  return `{${ids.join(",")}}`;
}

function toUpload(entry: PluginAuthorizationAuditEntry): Upload | null {
  if (entry.entityType !== "issue" || !UUID.test(entry.entityId)) return null;
  const details = entry.details ?? {};
  const attachmentId = details.attachmentId;
  if (typeof attachmentId !== "string" || !UUID.test(attachmentId)) return null;
  const createdAt = new Date(entry.createdAt).getTime();
  if (!Number.isFinite(createdAt)) return null;
  const hasMetadata = "originalFilename" in details || "contentType" in details;
  return {
    attachmentId: attachmentId.toLowerCase(),
    issueId: entry.entityId.toLowerCase(),
    createdAt,
    filename: hasMetadata ? (typeof details.originalFilename === "string" ? details.originalFilename : null) : undefined,
    contentType: hasMetadata ? (typeof details.contentType === "string" ? details.contentType : "") : undefined,
  };
}

/** Companies whose own plugin config lists them; the job never touches any other company. */
async function configuredCompanies(ctx: Ctx): Promise<string[]> {
  const result: string[] = [];
  for (const company of await ctx.companies.list()) {
    const companyId = company.id;
    let config: Record<string, unknown>;
    try { config = await ctx.config.get(companyId); } catch { continue; }
    const entries = Array.isArray(config.companies) ? config.companies : [];
    if (entries.some((item: unknown) =>
      item !== null && typeof item === "object" && (item as Record<string, unknown>).companyId === companyId)) {
      result.push(companyId);
    }
  }
  return result;
}

/** New uploads, oldest first. Pages newest-first and stops at a page holding an already audited id. */
async function newUploads(ctx: Ctx, companyId: string, since: number): Promise<Upload[]> {
  const found = new Map<string, Upload>();
  for (let page = 0; page < MAX_PAGES; page++) {
    const entries = await ctx.authorization.audit.search({ companyId, action: ACTION, limit: PAGE_SIZE, offset: page * PAGE_SIZE });
    const uploads = entries.map(toUpload).filter((u): u is Upload => u !== null && u.createdAt >= since);
    const ids = uploads.map((u) => u.attachmentId);
    const known = ids.length === 0 ? new Set<string>() : new Set((await ctx.db.query<{ attachment_id: string }>(
      `SELECT attachment_id::text FROM ${table(ctx)} WHERE attachment_id = ANY($1::uuid[])`, [uuidArray(ids)],
    )).map((row) => row.attachment_id));
    for (const upload of uploads) {
      if (!known.has(upload.attachmentId) && !found.has(upload.attachmentId)) found.set(upload.attachmentId, upload);
    }
    const reachedOld = entries.some((entry) => new Date(entry.createdAt).getTime() < since);
    if (entries.length < PAGE_SIZE || known.size > 0 || reachedOld) break;
  }
  return [...found.values()].sort((a, b) => a.createdAt - b.createdAt);
}

async function auditCompany(ctx: Ctx, companyId: string, now: Date): Promise<{ checked: number; warned: number }> {
  const since = now.getTime() - LOOKBACK_MS;
  const listed = new Map<string, Promise<Map<string, { filename: string | null; contentType: string }>>>();
  const attachmentsOf = (issueId: string) => {
    let list = listed.get(issueId);
    if (!list) {
      list = ctx.issues.listAttachments(issueId, companyId).then((items) =>
        new Map(items.map((a) => [a.id.toLowerCase(), { filename: a.originalFilename, contentType: a.contentType }])));
      listed.set(issueId, list);
    }
    return list;
  };
  const names = new Map<string, string | null>();

  const retry = retryStateOf(ctx);
  const nowMs = now.getTime();

  /** `"retry"` means a transient failure: nothing is recorded and the file is judged again after a delay. */
  const judge = async (upload: Upload): Promise<AuditVerdict | "retry"> => {
    let { filename, contentType } = upload;
    if (filename === undefined || contentType === undefined) {
      let meta: { filename: string | null; contentType: string } | undefined;
      try { meta = (await attachmentsOf(upload.issueId)).get(upload.attachmentId); } catch { return "retry"; }
      if (!meta) return { verdict: "unreadable" };
      ({ filename, contentType } = meta);
    }
    names.set(upload.attachmentId, filename);
    const byName = judgeByName(filename, contentType);
    if (byName !== "needs-bytes") return byName;
    try {
      const content = await ctx.issues.getAttachmentContent(upload.attachmentId, companyId, { maxBytes: MAX_ATTACHMENT_BYTES });
      if (!content) return { verdict: "unreadable" };
      const head = Buffer.from(content.contentBase64.slice(0, HEAD_BASE64_CHARS), "base64");
      return judgeBytes(sanitizeFilename(filename), head);
    } catch {
      return "retry";
    }
  };

  const uploads = await newUploads(ctx, companyId, since);
  let checked = 0;
  for (const upload of uploads) {
    if ((retry.reads.get(upload.attachmentId)?.nextAt ?? 0) > nowMs) continue;
    let result = await judge(upload);
    if (result === "retry") {
      if (failed(retry.reads, upload.attachmentId, nowMs) < MAX_READ_ATTEMPTS) continue;
      result = { verdict: "unreadable" };
    }
    retry.reads.delete(upload.attachmentId);
    checked++;
    await ctx.db.execute(
      `INSERT INTO ${table(ctx)} (attachment_id, company_id, issue_id, verdict, reason)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (attachment_id) DO NOTHING`,
      [upload.attachmentId, companyId, upload.issueId, result.verdict, result.verdict === "blocked" ? result.reason : null],
    );
  }
  const seen = new Set(uploads.map((upload) => upload.attachmentId));
  for (const id of retry.reads.keys()) if (!seen.has(id)) retry.reads.delete(id);

  // Blocked and not yet warned: this run's files plus any whose comment failed earlier.
  const pending = await ctx.db.query<{ attachment_id: string; issue_id: string; reason: string }>(
    `SELECT attachment_id::text, issue_id::text, reason FROM ${table(ctx)}
     WHERE company_id = $1 AND verdict = 'blocked' AND warned_at IS NULL AND checked_at >= $2
     ORDER BY checked_at, attachment_id`,
    [companyId, new Date(since).toISOString()],
  );
  const byIssue = new Map<string, { attachmentId: string; reason: string }[]>();
  for (const row of pending) {
    const list = byIssue.get(row.issue_id) ?? [];
    list.push({ attachmentId: row.attachment_id, reason: row.reason });
    byIssue.set(row.issue_id, list);
  }

  let warned = 0;
  for (const issueId of retry.comments.keys()) if (!byIssue.has(issueId)) retry.comments.delete(issueId);
  for (const [issueId, files] of byIssue) {
    if ((retry.comments.get(issueId)?.nextAt ?? 0) > nowMs) continue;
    try {
      const lines: string[] = [];
      const ids: string[] = [];
      const deleted: string[] = [];
      for (const file of files) {
        let filename = names.get(file.attachmentId);
        if (filename === undefined) {
          const meta = (await attachmentsOf(issueId)).get(file.attachmentId);
          if (!meta) { deleted.push(file.attachmentId); continue; } // deleted since: nothing left to warn about
          filename = meta.filename;
        }
        lines.push(`File \`${sanitizeFilename(filename)}\` không được agent đọc: ${file.reason}. ${RESEND_HINT}`);
        ids.push(file.attachmentId);
      }
      if (lines.length > 0) await ctx.issues.createComment(issueId, lines.join("\n"), companyId);
      const handled = [...ids, ...deleted];
      if (handled.length > 0) {
        await ctx.db.execute(`UPDATE ${table(ctx)} SET warned_at = now() WHERE attachment_id = ANY($1::uuid[])`, [uuidArray(handled)]);
      }
      retry.comments.delete(issueId);
      warned += ids.length;
    } catch {
      // One warning per failing streak; later attempts stay silent until the issue recovers.
      if (failed(retry.comments, issueId, nowMs) === 1) {
        ctx.logger.warn("crew attachments audit: warning comment failed", { companyId });
      }
    }
  }
  return { checked, warned };
}

export async function runAttachmentsAudit(ctx: Ctx, now: Date): Promise<{ checked: number; warned: number }> {
  let checked = 0;
  let warned = 0;
  for (const companyId of await configuredCompanies(ctx)) {
    try {
      const result = await auditCompany(ctx, companyId, now);
      checked += result.checked;
      warned += result.warned;
      if (result.checked > 0 || result.warned > 0) {
        ctx.logger.info("crew attachments audit", { companyId, checked: result.checked, warned: result.warned });
      }
    } catch {
      ctx.logger.error("crew attachments audit failed", { companyId });
    }
  }
  return { checked, warned };
}

export function registerAttachmentsAudit(ctx: PluginContext): void {
  ctx.jobs.register(JOB_KEY, async () => {
    await runAttachmentsAudit(ctx, new Date());
  });
}

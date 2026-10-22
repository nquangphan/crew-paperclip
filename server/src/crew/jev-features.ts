import { createHash } from "node:crypto";
import { type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";
import { rowsOf } from "./project-roles.js";
import { jevJudge, type JevJudgeResult } from "./jev-client.js";
import {
  isSettled,
  issueJudgments,
  JUDGMENT_MAX_ATTEMPTS,
  JUDGMENT_RETRY_AFTER_MS,
  recordJudgment,
  type JudgmentInput,
} from "./jev-judgments.js";
import { truncateUtf8 } from "./jev-shadow.js";
import {
  crewJevTable,
  getJevSettings,
  type JevFeature,
  type JevFeatureMode,
  jevFeaturesReady,
  type JevSettingsRecord,
  listEnabledJevSettings,
  resolveJevApiKey,
  treeIdsSql,
} from "./jev-store.js";
import { CREW_MODEL_LINE_RE, CREW_RUNTIME_CATALOG, type CrewComplexity, isCrewRuntime } from "./model-policy.js";
import { loadJevUse, type Question } from "./vendor/jev-use.js";

/**
 * Bốn tính năng Jev đợt 2. Bất biến chung:
 * - Công tắc chung là `settings.enabled`: tắt thì không gọi Jev và không ghi dòng nào (`featureMode` trả `off`).
 * - Mỗi tính năng `off | shadow | on`, thiếu khóa là `shadow`. Không chế độ nào chặn hay đổi dữ liệu.
 * - Mọi lỗi (thiếu key, timeout, trả sai dạng, exception) chỉ làm tính năng im lặng; route judge luôn trả 200.
 * - Text gửi Jev đã bỏ khối code/diff, che secret và cắt ≤ 4 KB.
 */

/** Hạn của Jev cho thao tác owner chờ: UI chờ 1500 ms nên server trả lời trước 1200 ms. */
export const JEV_JUDGE_TIMEOUT_MS = 1000;
export const JEV_JUDGE_DEADLINE_MS = 1200;
export const JEV_TEXT_MAX_BYTES = 4 * 1024;
export const JEV_EXCERPT_MAX_BYTES = 1024;
/** Trần số lần hỏi Jev của route judge mỗi company mỗi phút (chống spam từ UI). */
export const JEV_JUDGE_RATE_PER_MINUTE = 60;

export function featureMode(settings: Pick<JevSettingsRecord, "enabled" | "features">, feature: JevFeature): JevFeatureMode {
  return settings.enabled ? settings.features[feature] : "off";
}

const hashOf = (text: string) => createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16);

const DIFF_LINE_RE = /^(diff --git |index [0-9a-f]+\.\.|@@ .* @@|\+\+\+ |--- [ab/])/;
const LIST_ITEM_RE = /^\s*([-*+]|\d+[.)])\s/;

/**
 * Bỏ khối code rào ``` hoặc ~~~, khối thụt lề (4 dấu cách hoặc tab, trừ mục danh sách), code inline và dòng diff; không bao
 * giờ gửi code hay diff cho Jev.
 */
export function stripCode(text: string): string {
  return text
    .replace(/```[\s\S]*?(```|$)/g, "[code omitted]")
    .replace(/~~~[\s\S]*?(~~~|$)/g, "[code omitted]")
    .split("\n")
    .filter((line) => !DIFF_LINE_RE.test(line))
    .map((line) => (/^( {4}|\t)/.test(line) && !LIST_ITEM_RE.test(line) && line.trim() !== "" ? "[code omitted]" : line))
    .filter((line, index, lines) => !(line === "[code omitted]" && lines[index - 1] === "[code omitted]"))
    .join("\n")
    .replace(/`[^`\n]+`/g, "[code]");
}

/** Bỏ code, che secret rồi cắt theo byte. */
export function prepareText(redact: (text: string) => string, raw: string, maxBytes = JEV_TEXT_MAX_BYTES): string {
  return truncateUtf8(redact(stripCode(raw)), maxBytes);
}

/** Key giải mã giữ trong bộ nhớ process tối đa 5 phút, khóa theo (company, secret, vân tay): đổi key là đổi vân tay. */
export const JEV_KEY_CACHE_MS = 5 * 60_000;
const keyCache = new Map<string, { id: string; value: string; expires: number }>();

/** Gọi khi lưu hoặc xóa key để lần gọi sau đọc key mới ngay. */
export function clearJevKeyCache(companyId?: string): void {
  if (companyId) keyCache.delete(companyId);
  else keyCache.clear();
}

/**
 * Key của company cho tính năng đợt 2. Mỗi lần đọc secret ghi một access event và cập nhật hàng secret, nên chỉ đọc lại sau
 * khi cache hết hạn hoặc key đổi.
 */
async function getApiKey(db: Db, settings: JevSettingsRecord, consumerId: string, now = Date.now()): Promise<string | null> {
  if (!settings.keySecretId) return null;
  const id = `${settings.keySecretId}:${settings.keyFingerprint ?? ""}`;
  const hit = keyCache.get(settings.companyId);
  if (hit && hit.id === id && hit.expires > now) return hit.value;
  keyCache.delete(settings.companyId);
  const value = await resolveJevApiKey(db, settings, consumerId);
  if (value) keyCache.set(settings.companyId, { id, value, expires: now + JEV_KEY_CACHE_MS });
  return value;
}

const windows = new Map<string, { start: number; count: number }>();
function allowCall(companyId: string, now = Date.now()): boolean {
  const entry = windows.get(companyId);
  if (!entry || now - entry.start >= 60_000) {
    windows.set(companyId, { start: now, count: 1 });
    return true;
  }
  entry.count += 1;
  return entry.count <= JEV_JUDGE_RATE_PER_MINUTE;
}
/** Chỉ để test. */
export function resetJevFeatureRateLimit(): void {
  windows.clear();
}

interface Asked {
  label: string | null;
  confidence: number | null;
  escalated: boolean;
  errorCode: string | null;
  latencyMs: number;
}

function askedFrom(result: JevJudgeResult, toLabel: (answer: string | number | null) => string | null): Asked {
  if (!result.ok) return { label: null, confidence: null, escalated: false, errorCode: result.errorCode, latencyMs: result.latencyMs };
  const answer = result.answers.q;
  const label = answer ? toLabel(answer.answer) : null;
  if (!answer || label === null) {
    return { label: null, confidence: null, escalated: false, errorCode: "bad_response", latencyMs: result.latencyMs };
  }
  return { label, confidence: answer.confidence, escalated: answer.escalated, errorCode: null, latencyMs: result.latencyMs };
}

/** Hỏi Jev một câu, không bao giờ ném và không chờ quá `deadlineMs`. */
async function ask(
  settings: JevSettingsRecord,
  apiKey: string,
  state: string,
  question: Question,
  toLabel: (answer: string | number | null) => string | null,
  deadlineMs: number,
): Promise<Asked> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<JevJudgeResult>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, errorCode: "timeout", latencyMs: deadlineMs }), deadlineMs);
  });
  try {
    const judged = jevJudge({
      apiKey,
      model: settings.model,
      timeoutMs: Math.min(settings.timeoutMs, deadlineMs),
      confidenceThreshold: settings.threshold,
      state,
      questions: { q: question },
    });
    return askedFrom(await Promise.race([judged, deadline]), toLabel);
  } catch {
    return { label: null, confidence: null, escalated: false, errorCode: "internal", latencyMs: 0 };
  } finally {
    clearTimeout(timer);
  }
}

const choiceLabel = (allowed: readonly string[]) => (answer: string | number | null) =>
  typeof answer === "string" && allowed.includes(answer) ? answer : null;
/** Câu `noul` trả xác suất "có": `unsure` khi Jev không chắc, `yes` từ 0.5. */
const yesNoLabel = (answer: string | number | null) => (typeof answer === "number" ? (answer >= 0.5 ? "yes" : "no") : null);

async function safeRecord(db: Db, input: JudgmentInput): Promise<string | null> {
  try {
    return await recordJudgment(db, { ...input, inputExcerpt: input.inputExcerpt && truncateUtf8(input.inputExcerpt, JEV_EXCERPT_MAX_BYTES) });
  } catch (error) {
    logger.warn({ companyId: input.companyId, feature: input.feature, err: error instanceof Error ? error.name : typeof error }, "crew jev: không ghi được dòng đo");
    return null;
  }
}

async function redactor(): Promise<((text: string) => string) | null> {
  try {
    return (await loadJevUse()).redactSecrets;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Route judge: lời nhắn duyệt và loại yêu cầu
// ---------------------------------------------------------------------------------------------------------------

export type JudgeFailure = { ok: false; reason: string };

/**
 * Kiểm cổng chung của route judge; trả lý do khi không được gọi Jev. Chỉ đọc DB nhẹ: key và hàm che được lấy sau, trong
 * {@link prepare}, để chế độ `shadow` trả lời trước khi động tới secret.
 */
async function gate(
  db: Db,
  companyId: string,
  feature: JevFeature,
): Promise<{ settings: JevSettingsRecord; mode: "shadow" | "on" } | JudgeFailure> {
  const settings = await getJevSettings(db, companyId);
  if (!settings.enabled) return { ok: false, reason: "disabled" };
  const mode = featureMode(settings, feature);
  if (mode === "off") return { ok: false, reason: "off" };
  if (!(await jevFeaturesReady(db))) return { ok: false, reason: "unavailable" };
  if (!settings.keySecretId) return { ok: false, reason: "no_key" };
  if (!allowCall(companyId)) return { ok: false, reason: "rate_limited" };
  return { settings, mode };
}

interface Prepared {
  settings: JevSettingsRecord;
  mode: "shadow" | "on";
  apiKey: string;
  redact: (text: string) => string;
  userId: string;
}

async function prepare(
  db: Db, g: { settings: JevSettingsRecord; mode: "shadow" | "on" }, userId: string,
): Promise<Prepared | JudgeFailure> {
  const redact = await redactor();
  if (!redact) return { ok: false, reason: "internal" };
  const apiKey = await getApiKey(db, g.settings, "crew-jev-feature");
  if (!apiKey) return { ok: false, reason: "no_key" };
  return { ...g, apiKey, redact, userId };
}

/** Tổng hạn cho cả route khi chờ Jev (DB + Jev); quá hạn thì trả `timeout`, việc nền vẫn ghi dòng đo. */
function withDeadline<T>(work: Promise<T | JudgeFailure>): Promise<T | JudgeFailure> {
  work.catch(() => undefined);
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<JudgeFailure>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, reason: "timeout" }), JEV_JUDGE_DEADLINE_MS + 50);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

const runBackground = (work: Promise<unknown>, feature: JevFeature) => {
  work.catch((error: unknown) => {
    logger.warn({ feature, err: error instanceof Error ? error.name : typeof error }, "crew jev: lỗi tác vụ nền");
  });
};

export const APPROVAL_ACTIONS = ["approve", "request_changes"] as const;
export type ApprovalAction = (typeof APPROVAL_ACTIONS)[number];
export const approvalNoteBodySchema = z
  .object({
    issueId: z.string().uuid(),
    action: z.enum(APPROVAL_ACTIONS),
    note: z.string().max(20_000),
  })
  .strict();
export type ApprovalNoteBody = z.infer<typeof approvalNoteBodySchema>;

const APPROVAL_LABELS = ["approve", "request_changes", "unclear"] as const;
const APPROVAL_QUESTION: Question = {
  type: "choice",
  question: "What does the owner's note ask for?",
  options: {
    approve: "The note accepts the work as it is, possibly with small remarks that need no more work.",
    request_changes: "The note asks for changes, fixes, more work, or rejects the work.",
    unclear: "The note is unrelated, empty of meaning, or does not make clear whether to accept or ask for changes.",
  },
};

export interface ApprovalNoteReply {
  ok: true;
  mode: "shadow" | "on";
  label: "approve" | "request_changes" | "unclear" | null;
  confidence: number | null;
  mismatch: boolean;
  judgmentId: string | null;
}

/** Jev khác hành động owner chọn, và chắc chắn (không escalate): `unclear` không bao giờ là lệch. */
export function approvalMismatch(action: ApprovalAction, asked: Pick<Asked, "label" | "escalated">): boolean {
  return !asked.escalated && (asked.label === "approve" || asked.label === "request_changes") && asked.label !== action;
}

async function judgeApproval(
  db: Db, gate0: { settings: JevSettingsRecord; mode: "shadow" | "on" },
  companyId: string, title: string, body: ApprovalNoteBody, userId: string,
): Promise<ApprovalNoteReply | JudgeFailure> {
  const g = await prepare(db, gate0, userId);
  if ("ok" in g) return g;
  const note = prepareText(g.redact, body.note.trim());
  const heading = prepareText(g.redact, title, 300);
  const verb = body.action === "approve" ? "approve" : "request changes on";
  const state = `The owner is about to ${verb} a work item titled "${heading}" and wrote this note (secrets redacted):\n\n${note}`;
  const asked = await ask(g.settings, g.apiKey, state, APPROVAL_QUESTION, choiceLabel(APPROVAL_LABELS), JEV_JUDGE_DEADLINE_MS);
  const mismatch = approvalMismatch(body.action, asked);
  const shown = g.mode === "on" && mismatch;
  const judgmentId = await safeRecord(db, {
    companyId, feature: "approval_note", issueId: body.issueId, mode: g.mode, questionHash: hashOf(`${body.action}\n${note}`),
    inputExcerpt: note, jevLabel: asked.label, confidence: asked.confidence, escalated: asked.escalated,
    errorCode: asked.errorCode, latencyMs: asked.latencyMs, baseline: body.action, mismatch: asked.errorCode ? null : mismatch, shown,
    createdByUserId: g.userId,
  });
  if (asked.errorCode) return { ok: false, reason: asked.errorCode };
  return {
    ok: true, mode: g.mode, label: asked.escalated ? "unclear" : (asked.label as ApprovalNoteReply["label"]),
    confidence: asked.confidence, mismatch, judgmentId,
  };
}

/**
 * `shadow`: trả ngay (không chờ Jev) và hỏi Jev ở nền chỉ để ghi log. `on`: chờ tối đa {@link JEV_JUDGE_DEADLINE_MS}.
 * Mọi lỗi trả `{ ok: false, reason }`.
 */
export async function approvalNoteJudgment(
  db: Db, companyId: string, body: ApprovalNoteBody, userId: string,
): Promise<ApprovalNoteReply | JudgeFailure> {
  try {
    if (body.note.trim() === "") return { ok: false, reason: "empty" };
    const g = await gate(db, companyId, "approval_note");
    if ("ok" in g) return g;
    const [issue] = rowsOf(
      await db.execute(sql`SELECT title FROM "issues" WHERE id = ${body.issueId} AND company_id = ${companyId} LIMIT 1`),
    );
    if (!issue) return { ok: false, reason: "not_found" };
    const work = judgeApproval(db, g, companyId, String(issue.title), body, userId);
    if (g.mode === "shadow") {
      runBackground(work, "approval_note");
      return { ok: true, mode: "shadow", label: null, confidence: null, mismatch: false, judgmentId: null };
    }
    return await withDeadline(work);
  } catch (error) {
    logger.warn({ feature: "approval_note", err: error instanceof Error ? error.name : typeof error }, "crew jev: judge lỗi");
    return { ok: false, reason: "internal" };
  }
}

export const REQUEST_TYPES = ["code", "bug", "research", "docs"] as const;
export type RequestType = (typeof REQUEST_TYPES)[number];
export const requestTypeBodySchema = z
  .object({
    title: z.string().max(2000),
    description: z.string().max(100_000).default(""),
    /** Loại owner đang chọn trên form (nếu có), để tính độ lệch. */
    current: z.enum(REQUEST_TYPES).optional(),
  })
  .strict();
export type RequestTypeBody = z.infer<typeof requestTypeBodySchema>;

const REQUEST_TYPE_QUESTION: Question = {
  type: "choice",
  question: "What kind of work is this request?",
  options: {
    code: "Build or change software: a new feature, an improvement or a refactor.",
    bug: "Fix something that is broken or behaves wrongly.",
    research: "Investigate, compare options or answer a question; the result is a report, not code.",
    docs: "Write or update documentation, guides or other text.",
  },
};

export interface RequestTypeReply {
  ok: true;
  mode: "shadow" | "on";
  label: RequestType | null;
  confidence: number | null;
  judgmentId: string | null;
}

async function judgeRequestType(
  db: Db, gate0: { settings: JevSettingsRecord; mode: "shadow" | "on" },
  companyId: string, body: RequestTypeBody, userId: string,
): Promise<RequestTypeReply | JudgeFailure> {
  const g = await prepare(db, gate0, userId);
  if ("ok" in g) return g;
  const text = prepareText(g.redact, `Title: ${body.title.trim()}\n\n${body.description.trim()}`);
  const asked = await ask(g.settings, g.apiKey, `A new work request (secrets redacted, code removed):\n\n${text}`, REQUEST_TYPE_QUESTION, choiceLabel(REQUEST_TYPES), JEV_JUDGE_DEADLINE_MS);
  const mismatch = body.current && !asked.errorCode ? !asked.escalated && asked.label !== body.current : null;
  const sure = !asked.errorCode && !asked.escalated;
  const judgmentId = await safeRecord(db, {
    companyId, feature: "request_type", issueId: null, mode: g.mode, questionHash: hashOf(text), inputExcerpt: text,
    jevLabel: asked.label, confidence: asked.confidence, escalated: asked.escalated, errorCode: asked.errorCode,
    latencyMs: asked.latencyMs, baseline: body.current ?? null, mismatch, shown: g.mode === "on" && sure,
    createdByUserId: g.userId,
  });
  if (asked.errorCode) return { ok: false, reason: asked.errorCode };
  if (asked.escalated) return { ok: false, reason: "unsure" };
  return { ok: true, mode: g.mode, label: asked.label as RequestType, confidence: asked.confidence, judgmentId };
}

export async function requestTypeJudgment(
  db: Db, companyId: string, body: RequestTypeBody, userId: string,
): Promise<RequestTypeReply | JudgeFailure> {
  try {
    if (body.title.trim().length + body.description.trim().length < 20) return { ok: false, reason: "too_short" };
    const g = await gate(db, companyId, "request_type");
    if ("ok" in g) return g;
    const work = judgeRequestType(db, g, companyId, body, userId);
    if (g.mode === "shadow") {
      runBackground(work, "request_type");
      return { ok: true, mode: "shadow", label: null, confidence: null, judgmentId: null };
    }
    return await withDeadline(work);
  } catch (error) {
    logger.warn({ feature: "request_type", err: error instanceof Error ? error.name : typeof error }, "crew jev: judge lỗi");
    return { ok: false, reason: "internal" };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Độ phức tạp (complexity)
// ---------------------------------------------------------------------------------------------------------------

export interface ComplexityFlag {
  /** Jev nói việc chạm bảo mật/migration/API công khai. `false` khi cờ đến từ luật xác định (ảnh). */
  jevSaysLarge: boolean;
  declared: CrewComplexity;
  reason: string;
  kind: "jev" | "vision";
}

const COMPLEXITY_QUESTION: Question = {
  type: "noul",
  question: "Does this work touch security or permissions, a database migration, or a public API contract?",
};

interface DeclaredModel {
  complexity: CrewComplexity;
  model: string;
  runtime: string;
}

/** Đọc dòng `crew-model` trong mô tả issue con. */
export function declaredModel(description: string | null | undefined): DeclaredModel | null {
  const match = CREW_MODEL_LINE_RE.exec(description ?? "");
  if (!match) return null;
  return { complexity: match[1] as CrewComplexity, model: match[2]!, runtime: match[4] ?? "claude_local" };
}

/** Luật xác định: con có ảnh đính kèm mà model đã chọn không đọc được ảnh. */
export function visionFlag(declared: DeclaredModel | null, hasImage: boolean): ComplexityFlag | null {
  if (!declared || !hasImage || !isCrewRuntime(declared.runtime)) return null;
  const spec = CREW_RUNTIME_CATALOG[declared.runtime].models[declared.model];
  if (!spec || spec.vision) return null;
  return {
    jevSaysLarge: false, declared: declared.complexity, kind: "vision",
    reason: `Việc có ảnh đính kèm nhưng model ${declared.model} không đọc được ảnh.`,
  };
}

const JEV_LARGE_REASON = "Jev thấy việc này chạm bảo mật/phân quyền, migration CSDL hoặc hợp đồng API công khai.";

/** Cờ Jev: dòng đo nói "chạm bảo mật/migration/API" mà mức khai hiện tại (dòng `crew-model` mới nhất) chưa phải `large`. */
function jevFlag(declared: CrewComplexity, row: { mismatch: boolean } | undefined): ComplexityFlag | null {
  if (!row?.mismatch || declared === "large") return null;
  return { jevSaysLarge: true, declared, reason: JEV_LARGE_REASON, kind: "jev" };
}

const imageIssueIdsSql = (companyId: string, issueIds: SQL): SQL => sql`SELECT DISTINCT a.issue_id::text AS issue_id
  FROM "issue_attachments" a JOIN "assets" s ON s.id = a.asset_id
  WHERE a.company_id = ${companyId} AND a.issue_id IN (${issueIds}) AND s.content_type LIKE 'image/%'`;

/** Cờ của một issue (trang chi tiết). Rỗng khi tính năng không ở chế độ `on`. */
export async function complexityFlagForIssue(db: Db, settings: JevSettingsRecord, issueId: string): Promise<ComplexityFlag | null> {
  if (featureMode(settings, "complexity") !== "on") return null;
  const [issue] = rowsOf(
    await db.execute(sql`SELECT description FROM "issues" WHERE id = ${issueId} AND company_id = ${settings.companyId} LIMIT 1`),
  );
  const declared = declaredModel(issue ? (issue.description as string | null) : null);
  if (!declared) return null;
  const rows = await issueJudgments(db, settings.companyId, "complexity", [issueId]);
  const jev = jevFlag(declared.complexity, rows.find((row) => row.errorCode === null));
  if (jev) return jev;
  const images = rowsOf(await db.execute(imageIssueIdsSql(settings.companyId, sql`${issueId}`)));
  return visionFlag(declared, images.length > 0);
}

/** Cờ cho mọi issue con của một cây yêu cầu (bản đồ), khóa là id issue chữ thường. */
export async function complexityFlagsForTree(
  db: Db, settings: JevSettingsRecord, requestId: string,
): Promise<Record<string, ComplexityFlag>> {
  if (featureMode(settings, "complexity") !== "on") return {};
  const companyId = settings.companyId;
  const issues = rowsOf(
    await db.execute(sql`${treeIdsSql(companyId, requestId)}
      SELECT i.id::text AS id, i.description FROM "issues" i JOIN tree_ids t ON t.id = i.id
      WHERE i.company_id = ${companyId} AND i.description LIKE '%crew-model complexity=%'`),
  );
  const declared = new Map<string, DeclaredModel>();
  for (const issue of issues) {
    const parsed = declaredModel(issue.description as string | null);
    if (parsed) declared.set(String(issue.id).toLowerCase(), parsed);
  }
  if (declared.size === 0) return {};
  const ids = [...declared.keys()];
  const judged = new Map<string, { mismatch: boolean }>();
  for (const row of await issueJudgments(db, companyId, "complexity", ids)) {
    if (row.errorCode === null && !judged.has(row.issueId)) judged.set(row.issueId, row);
  }
  const images = new Set(
    rowsOf(await db.execute(imageIssueIdsSql(companyId, sql.join(ids.map((id) => sql`${id}`), sql`, `)))).map((row) =>
      String(row.issue_id).toLowerCase()),
  );
  const flags: Record<string, ComplexityFlag> = {};
  for (const [id, model] of declared) {
    const flag = jevFlag(model.complexity, judged.get(id)) ?? visionFlag(model, images.has(id));
    if (flag) flags[id] = flag;
  }
  return flags;
}

/** Issue con do agent tạo gần đây, có dòng `crew-model`, chưa có dòng đo. Dùng `issues_company_created_idx`. */
export function complexityCandidatesSql(companyId: string, since: Date, retryBefore: Date): SQL {
  return sql`SELECT i.id::text AS id, i.title, i.description FROM "issues" i
    WHERE i.company_id = ${companyId} AND i.created_at >= ${since.toISOString()}::timestamptz
      AND i.parent_id IS NOT NULL
      AND i.description ~ ${CREW_MODEL_LINE_SQL_RE}
      AND NOT EXISTS (SELECT 1 FROM ${judgmentsTable()} j
        WHERE j.company_id = i.company_id AND j.issue_id = i.id AND j.feature = 'complexity'
          AND (j.error_code IS NULL OR j.created_at >= ${retryBefore.toISOString()}::timestamptz))
      AND (SELECT count(*) FROM ${judgmentsTable()} j
        WHERE j.company_id = i.company_id AND j.issue_id = i.id AND j.feature = 'complexity') < ${JUDGMENT_MAX_ATTEMPTS}
    ORDER BY i.created_at LIMIT ${SWEEP_BATCH}`;
}

/** Cùng dạng với `CREW_MODEL_LINE_RE` (dòng sai dạng không vào hàng đợi). */
const CREW_MODEL_LINE_SQL_RE =
  "(^|\n)crew-model complexity=(trivial|small|medium|large) model=[^[:space:]]+ effort=(low|medium|high|default)( runtime=(claude_local|codex_local|opencode_local))? reason=[^\n]+";

const judgmentsTable = () => sql.raw(crewJevTable("crew_jev_judgments"));

export const SWEEP_BATCH = 10;
/** Issue con tạo trước ngưỡng này mà chưa được xét thì bỏ (server ngừng lâu, bật tính năng muộn): không kéo backlog. */
export const COMPLEXITY_LOOKBACK_MS = 2 * 60 * 60_000;

async function sweepComplexity(db: Db, settings: JevSettingsRecord, redact: (t: string) => string, now: Date): Promise<number> {
  const mode = featureMode(settings, "complexity");
  if (mode === "off" || !settings.keySecretId) return 0;
  const rows = rowsOf(
    await db.execute(
      complexityCandidatesSql(
        settings.companyId, new Date(now.getTime() - COMPLEXITY_LOOKBACK_MS), new Date(now.getTime() - JUDGMENT_RETRY_AFTER_MS),
      ),
    ),
  );
  if (rows.length === 0) return 0;
  const apiKey = await getApiKey(db, settings, "crew-jev-complexity");
  if (!apiKey) return 0;
  let done = 0;
  for (const row of rows) {
    const declared = declaredModel(row.description as string | null);
    if (!declared) {
      // Dòng `crew-model` sai dạng: ghi một dòng lỗi để không nằm mãi ở đầu hàng đợi.
      await safeRecord(db, {
        companyId: settings.companyId, feature: "complexity", issueId: String(row.id), mode, questionHash: hashOf(String(row.id)),
        inputExcerpt: null, jevLabel: null, confidence: null, escalated: false, errorCode: "unparsed", latencyMs: null,
        baseline: null, mismatch: null, shown: false,
      });
      continue;
    }
    const text = prepareText(redact, `Title: ${String(row.title)}\n\n${String(row.description ?? "")}`);
    const asked = await ask(settings, apiKey, `A work item for an AI coding agent (secrets redacted, code removed):\n\n${text}`, COMPLEXITY_QUESTION, yesNoLabel, settings.timeoutMs);
    const label = asked.errorCode ? null : asked.escalated ? "unsure" : asked.label;
    const mismatch = asked.errorCode ? null : label === "yes" && declared.complexity !== "large";
    await safeRecord(db, {
      companyId: settings.companyId, feature: "complexity", issueId: String(row.id), mode, questionHash: hashOf(text),
      inputExcerpt: text, jevLabel: label, confidence: asked.confidence, escalated: asked.escalated, errorCode: asked.errorCode,
      latencyMs: asked.latencyMs, baseline: declared.complexity, mismatch, shown: mode === "on" && mismatch === true,
    });
    done += 1;
  }
  return done;
}

// ---------------------------------------------------------------------------------------------------------------
// Hộp duyệt: cần owner để ý (inbox_attention)
// ---------------------------------------------------------------------------------------------------------------

export type AttentionKind = "owner_decision" | "risky_paths" | "jev_product_decision";
export interface AttentionReason {
  kind: AttentionKind;
  text: string;
}

const DECIDED_HEADING = "đã tự quyết định";
const OWNER_HEADING = "cần owner quyết định";
export const ATTENTION_LINES_MAX = 10;
export const ATTENTION_LINE_MAX_CHARS = 500;

/** Các mục `### ...` của tổng kết: tiêu đề chữ thường → dòng không rỗng của mục. */
export function summarySections(description: string | null | undefined): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  let current: string[] | null = null;
  for (const line of (description ?? "").split("\n")) {
    const heading = /^#{1,3}\s+(.+?)\s*$/.exec(line);
    if (heading) {
      current = [];
      sections.set(heading[1]!.toLowerCase(), current);
    } else if (current && line.trim() !== "") {
      current.push(line.trim());
    }
  }
  return sections;
}

const NONE_RE = /^(?:[-*]\s*)?(?:không có|khong co|none|n\/a)[.\s]*$/i;

/** Mục `### Cần owner quyết định` có nội dung khác "Không có". */
export function hasOwnerDecision(description: string | null | undefined): boolean {
  const lines = summarySections(description).get(OWNER_HEADING) ?? [];
  return lines.some((line) => !NONE_RE.test(line));
}

/** Mỗi dòng gạch đầu dòng của mục `### Đã tự quyết định` (bỏ "Không có"), tối đa {@link ATTENTION_LINES_MAX}. */
export function decidedLines(description: string | null | undefined): string[] {
  const lines = summarySections(description).get(DECIDED_HEADING) ?? [];
  return lines
    .filter((line) => /^[-*]\s+/.test(line) && !NONE_RE.test(line))
    .map((line) => line.replace(/^[-*]\s+/, "").slice(0, ATTENTION_LINE_MAX_CHARS))
    .slice(0, ATTENTION_LINES_MAX);
}

const RISKY_PATH_PATTERNS: readonly RegExp[] = [
  /(^|\/)migrations?\//i,
  /\.sql$/i,
  /(^|\/)(auth|authn|authz|permissions?|acl)([\w-]*)(\/|\.\w+$)/i,
  /(^|\/)(package\.json|pnpm-lock\.yaml|package-lock\.json|yarn\.lock|pnpm-workspace\.yaml)$/i,
  /(^|\/)\.github\/workflows\//i,
  /(^|\/)\.gitlab-ci\.ya?ml$/i,
  /(^|\/)Dockerfile$/i,
];

/** Đường dẫn trong tổng kết chạm migration, auth/phân quyền, dependency hoặc CI (khối code đã bị bỏ). */
export function riskyPaths(description: string | null | undefined): string[] {
  const found = new Set<string>();
  for (const token of stripCode(description ?? "").split(/[\s,;()`"']+/)) {
    const path = token.replace(/[.:]+$/, "");
    if (path.length > 2 && RISKY_PATH_PATTERNS.some((pattern) => pattern.test(path))) found.add(path);
  }
  return [...found].slice(0, 3);
}

/** Phần luật xác định của huy hiệu; không cần Jev. */
export function deterministicReasons(description: string | null | undefined): AttentionReason[] {
  const reasons: AttentionReason[] = [];
  if (hasOwnerDecision(description)) {
    reasons.push({ kind: "owner_decision", text: "Tổng kết có điểm cần owner quyết định." });
  }
  const paths = riskyPaths(description);
  if (paths.length > 0) {
    reasons.push({ kind: "risky_paths", text: `Tổng kết nhắc tới file nhạy cảm: ${paths.join(", ")}.` });
  }
  return reasons;
}

export const INBOX_ISSUES_MAX = 200;
export const inboxAttentionQuerySchema = z
  .object({
    issueIds: z
      .string()
      .transform((value) => value.split(",").map((part) => part.trim().toLowerCase()).filter(Boolean))
      .pipe(z.array(z.string().uuid()).max(INBOX_ISSUES_MAX)),
  })
  .strict();

const lineHash = (issueId: string, line: string) => hashOf(`${issueId}\n${line}`);

export interface InboxAttention {
  enabled: boolean;
  mode: JevFeatureMode;
  items: Array<{ issueId: string; reasons: AttentionReason[] }>;
}

/** Huy hiệu cho các issue trong hộp duyệt. Chỉ trả mục khi tính năng `on`; shadow/off trả `items: []`. */
export async function inboxAttention(db: Db, settings: JevSettingsRecord, issueIds: readonly string[]): Promise<InboxAttention> {
  const mode = featureMode(settings, "inbox_attention");
  const base = { enabled: settings.enabled, mode };
  if (mode !== "on" || issueIds.length === 0) return { ...base, items: [] };
  const issues = rowsOf(
    await db.execute(sql`SELECT id::text AS id, description FROM "issues"
      WHERE company_id = ${settings.companyId} AND id IN (${sql.join(issueIds.map((id) => sql`${id}`), sql`, `)})`),
  );
  const judged = (await jevFeaturesReady(db))
    ? (await issueJudgments(db, settings.companyId, "inbox_attention", issueIds)).filter((row) => row.mismatch)
    : [];
  const items: InboxAttention["items"] = [];
  for (const issue of issues) {
    const id = String(issue.id).toLowerCase();
    const description = issue.description as string | null;
    const reasons = deterministicReasons(description);
    const current = new Map(decidedLines(description).map((line) => [lineHash(id, line), line]));
    for (const row of judged) {
      const line = row.issueId === id ? current.get(row.questionHash) : undefined;
      if (line) reasons.push({ kind: "jev_product_decision", text: `Jev thấy đây có thể là quyết định sản phẩm: ${line.slice(0, 160)}` });
    }
    if (reasons.length > 0) items.push({ issueId: id, reasons });
  }
  return { ...base, items };
}

const INBOX_QUESTION: Question = {
  type: "noul",
  question: "Is this a product decision (scope, behaviour users see, cost, or a trade-off) that the product owner should know about, rather than a routine technical choice?",
};
export const INBOX_LOOKBACK_MS = 7 * 24 * 60 * 60_000;
export const INBOX_CALLS_PER_SWEEP = 5;

/** Gốc đang chờ duyệt (`in_review`) có mục `Đã tự quyết định`; dùng `issues_company_status_idx`. */
export function inboxCandidatesSql(companyId: string, since: Date): SQL {
  return sql`SELECT i.id::text AS id, i.description FROM "issues" i
    WHERE i.company_id = ${companyId} AND i.status = 'in_review' AND i.parent_id IS NULL
      AND i.updated_at >= ${since.toISOString()}::timestamptz AND i.description LIKE '%Đã tự quyết định%'
    ORDER BY i.updated_at DESC LIMIT ${INBOX_ISSUES_MAX}`;
}

async function sweepInbox(db: Db, settings: JevSettingsRecord, redact: (t: string) => string, now: Date): Promise<number> {
  const mode = featureMode(settings, "inbox_attention");
  if (mode === "off" || !settings.keySecretId) return 0;
  const issues = rowsOf(await db.execute(inboxCandidatesSql(settings.companyId, new Date(now.getTime() - INBOX_LOOKBACK_MS))));
  if (issues.length === 0) return 0;
  // Một truy vấn cho cả lô: dòng đã đo (theo issue + băm) tra trong bộ nhớ, không hỏi DB từng dòng.
  const attempts = new Map<string, Array<{ errorCode: string | null; createdAt: string | null }>>();
  const ids = issues.map((issue) => String(issue.id).toLowerCase());
  for (const row of await issueJudgments(db, settings.companyId, "inbox_attention", ids)) {
    const key = `${row.issueId}:${row.questionHash}`;
    attempts.set(key, [...(attempts.get(key) ?? []), row]);
  }
  let apiKey: string | null | undefined;
  let calls = 0;
  for (const issue of issues) {
    const id = String(issue.id).toLowerCase();
    const description = issue.description as string | null;
    const baseline = deterministicReasons(description).map((reason) => reason.kind).join(",") || "none";
    for (const line of decidedLines(description)) {
      if (calls >= INBOX_CALLS_PER_SWEEP) return calls;
      const hash = lineHash(id, line);
      if (isSettled(attempts.get(`${id}:${hash}`) ?? [], now)) continue;
      apiKey ??= await getApiKey(db, settings, "crew-jev-inbox");
      if (!apiKey) return calls;
      const text = prepareText(redact, line, 1024);
      calls += 1;
      const asked = await ask(settings, apiKey, `A decision an AI agent took on its own while doing a request (secrets redacted):\n\n${text}`, INBOX_QUESTION, yesNoLabel, settings.timeoutMs);
      const label = asked.errorCode ? null : asked.escalated ? "unsure" : asked.label;
      await safeRecord(db, {
        companyId: settings.companyId, feature: "inbox_attention", issueId: id, mode, questionHash: hash, inputExcerpt: text,
        jevLabel: label, confidence: asked.confidence, escalated: asked.escalated, errorCode: asked.errorCode,
        latencyMs: asked.latencyMs, baseline, mismatch: asked.errorCode ? null : label === "yes", shown: mode === "on" && label === "yes",
      });
    }
  }
  return calls;
}

export interface JevFeatureSweepResult {
  companies: number;
  complexity: number;
  inbox: number;
}

/**
 * Một lượt của worker cho complexity và inbox_attention; export để test. Company tắt chung, tính năng `off`, thiếu key,
 * hoặc chưa áp migration 0021 thì không gọi Jev và không ghi gì. Lỗi một company chỉ ghi log.
 */
export async function runJevFeatureSweep(db: Db, now: Date = new Date()): Promise<JevFeatureSweepResult> {
  const result: JevFeatureSweepResult = { companies: 0, complexity: 0, inbox: 0 };
  const eligible = (await listEnabledJevSettings(db)).filter(
    (settings) => settings.keySecretId && (featureMode(settings, "complexity") !== "off" || featureMode(settings, "inbox_attention") !== "off"),
  );
  if (eligible.length === 0 || !(await jevFeaturesReady(db))) return result;
  const redact = await redactor();
  if (!redact) return result;
  for (const settings of eligible) {
    try {
      result.companies += 1;
      result.complexity += await sweepComplexity(db, settings, redact, now);
      result.inbox += await sweepInbox(db, settings, redact, now);
    } catch (error) {
      logger.warn({ companyId: settings.companyId, err: error instanceof Error ? error.name : typeof error }, "crew jev features: lỗi ở company, chờ lượt sau");
    }
  }
  return result;
}

export const JEV_FEATURE_INTERVAL_MS = 60_000;
let worker: { timer: NodeJS.Timeout; running: boolean } | null = null;

/**
 * Bật worker một lần cho process (bỏ qua khi `NODE_ENV=test`); lượt mới không chạy khi lượt trước chưa xong. Giả định prod
 * chạy đúng một instance server (đã xác nhận): bảng đo không có ràng buộc duy nhất và worker không khóa advisory, nên nhiều
 * instance có thể cùng hỏi Jev và ghi trùng một mục. Khi scale ngang cần thêm `pg_try_advisory_lock` cho mỗi lượt.
 */
export function startJevFeatureWorker(db: Db): void {
  if (worker || process.env.NODE_ENV === "test") return;
  const state = { running: false, timer: undefined as unknown as NodeJS.Timeout };
  state.timer = setInterval(() => {
    if (state.running) return;
    state.running = true;
    runJevFeatureSweep(db)
      .then((result) => {
        if (result.complexity + result.inbox > 0) logger.info(result, "crew jev features sweep");
      })
      .catch((error: unknown) => {
        logger.warn({ err: error instanceof Error ? error.name : typeof error }, "crew jev features sweep failed");
      })
      .finally(() => {
        state.running = false;
      });
  }, JEV_FEATURE_INTERVAL_MS);
  state.timer.unref();
  worker = state;
}

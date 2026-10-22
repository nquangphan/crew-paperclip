import { type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { rowsOf } from "./project-roles.js";
import { crewJevTable, JEV_FEATURES, type JevFeature } from "./jev-store.js";

/**
 * Bảng chung `crew_jev_judgments` (migration 0021): mỗi lần một tính năng mới hỏi Jev ghi một dòng, để trang `/jev` đo
 * độ lệch, escalate, lỗi và độ trễ từng tính năng. `input_excerpt` luôn đã che secret và cắt ≤ 1 KB trước khi ghi. Chỉ
 * server đọc/ghi.
 */

const table = () => sql.raw(crewJevTable("crew_jev_judgments"));
const iso = (value: unknown): string | null =>
  value === null || value === undefined ? null : new Date(value as string | Date).toISOString();
const num = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value));
const str = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));
const int = (value: unknown): number => Number(value ?? 0);

export const JUDGMENT_EXCERPT_MAX_BYTES = 1024;
export const JUDGMENT_PAGE_SIZE = 50;

export interface JudgmentInput {
  companyId: string;
  feature: JevFeature;
  issueId: string | null;
  mode: "shadow" | "on";
  questionHash: string;
  inputExcerpt: string | null;
  jevLabel: string | null;
  confidence: number | null;
  escalated: boolean;
  errorCode: string | null;
  latencyMs: number | null;
  baseline: string | null;
  mismatch: boolean | null;
  shown: boolean;
  /** Người gọi route judge (chỉ họ hoặc owner được ghi kết quả); `null` với dòng do worker ghi. */
  createdByUserId?: string | null;
}

/** Ghi một dòng; trả id (chuỗi số bigint). */
export async function recordJudgment(db: Pick<Db, "execute">, input: JudgmentInput): Promise<string> {
  const rows = rowsOf(
    await db.execute(sql`INSERT INTO ${table()}
      (company_id, feature, issue_id, mode, question_hash, input_excerpt, jev_label, confidence, escalated, error_code,
       latency_ms, baseline, mismatch, shown, created_by_user_id)
      VALUES (${input.companyId}, ${input.feature}, ${input.issueId}, ${input.mode}, ${input.questionHash},
        ${input.inputExcerpt}, ${input.jevLabel}, ${input.confidence}, ${input.escalated}, ${input.errorCode},
        ${input.latencyMs}, ${input.baseline}, ${input.mismatch}, ${input.shown}, ${input.createdByUserId ?? null})
      RETURNING id`),
  );
  return String(rows[0]!.id);
}

/** Kết quả owner chọn được phép theo tính năng. */
export const APPROVAL_OUTCOMES = ["sent", "changed"] as const;
export const REQUEST_TYPE_OUTCOMES = ["code", "bug", "research", "docs"] as const;
export const outcomeBodySchema = z
  .object({ outcome: z.enum([...APPROVAL_OUTCOMES, ...REQUEST_TYPE_OUTCOMES]) })
  .strict();
export const judgmentIdSchema = z
  .string()
  .regex(/^[1-9][0-9]{0,15}$/)
  .transform(Number)
  .refine((value) => Number.isSafeInteger(value));

const inList = (values: readonly string[]) => sql.join(values.map((value) => sql`${value}`), sql`, `);

/**
 * Ghi kết quả owner chọn. Chỉ dòng của company, của hai tính năng có chỗ cho owner chọn, với giá trị hợp lệ của tính năng
 * đó, và chỉ người đã gọi judge (hoặc owner) được ghi.
 */
export async function setJudgmentOutcome(
  db: Pick<Db, "execute">,
  companyId: string,
  id: number,
  outcome: string,
  actor: { userId: string; isOwner: boolean },
): Promise<boolean> {
  const rows = rowsOf(
    await db.execute(sql`UPDATE ${table()} SET owner_outcome = ${outcome}
      WHERE company_id = ${companyId} AND id = ${id}
        AND ((feature = 'approval_note' AND ${outcome} IN (${inList(APPROVAL_OUTCOMES)}))
          OR (feature = 'request_type' AND ${outcome} IN (${inList(REQUEST_TYPE_OUTCOMES)})))
        AND (${actor.isOwner} OR created_by_user_id = ${actor.userId})
      RETURNING id`),
  );
  return rows.length > 0;
}

export interface JudgmentStatRow {
  feature: JevFeature;
  mode: "shadow" | "on";
  total: number;
  mismatch: number;
  escalated: number;
  error: number;
  shown: number;
  p50Ms: number | null;
  p95Ms: number | null;
  /** Số dòng theo kết quả owner chọn (`sent`, `changed`, loại yêu cầu...). */
  outcomes: Record<string, number>;
}

export interface JudgmentStats {
  days: number;
  rows: JudgmentStatRow[];
}

/** Đầu cửa sổ `days` ngày lịch theo giờ Việt Nam. */
const sinceSql = (days: number) => sql`((date_trunc('day', now() AT TIME ZONE 'Asia/Ho_Chi_Minh') - make_interval(days => ${days - 1}))
    AT TIME ZONE 'Asia/Ho_Chi_Minh')`;

/** Truy vấn tổng theo tính năng × chế độ; export để test kiểm kế hoạch. */
export function judgmentStatsSql(companyId: string, days: number): SQL {
  const since = sinceSql(days);
  return sql`SELECT feature, mode,
      count(*)::int AS total,
      count(*) FILTER (WHERE mismatch)::int AS mismatch,
      count(*) FILTER (WHERE escalated)::int AS escalated,
      count(*) FILTER (WHERE error_code IS NOT NULL)::int AS error,
      count(*) FILTER (WHERE shown)::int AS shown,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) AS p50,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95
      FROM ${table()} WHERE company_id = ${companyId} AND created_at >= ${since}
      GROUP BY feature, mode ORDER BY feature, mode`;
}

/** Số liệu `days` ngày lịch gần nhất theo giờ Việt Nam, theo tính năng × chế độ (index `crew_jev_judgments_company_idx`). */
export async function judgmentStats(db: Pick<Db, "execute">, companyId: string, days: number): Promise<JudgmentStats> {
  const since = sinceSql(days);
  const rows = rowsOf(await db.execute(judgmentStatsSql(companyId, days)));
  const outcomeRows = rowsOf(
    await db.execute(sql`SELECT feature, mode, owner_outcome, count(*)::int AS n
      FROM ${table()} WHERE company_id = ${companyId} AND created_at >= ${since} AND owner_outcome IS NOT NULL
      GROUP BY feature, mode, owner_outcome`),
  );
  return {
    days,
    rows: rows.map((row) => ({
      feature: row.feature as JevFeature,
      mode: row.mode === "on" ? "on" : "shadow",
      total: int(row.total),
      mismatch: int(row.mismatch),
      escalated: int(row.escalated),
      error: int(row.error),
      shown: int(row.shown),
      p50Ms: row.p50 === null || row.p50 === undefined ? null : Math.round(Number(row.p50)),
      p95Ms: row.p95 === null || row.p95 === undefined ? null : Math.round(Number(row.p95)),
      outcomes: Object.fromEntries(
        outcomeRows
          .filter((outcome) => outcome.feature === row.feature && outcome.mode === row.mode)
          .map((outcome) => [String(outcome.owner_outcome), int(outcome.n)]),
      ),
    })),
  };
}

export const judgmentsQuerySchema = z
  .object({
    feature: z.enum(JEV_FEATURES).optional(),
    mismatch: z.enum(["true", "false"]).optional().transform((value) => value === "true"),
    before: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  })
  .strict();
export type JudgmentsQuery = z.infer<typeof judgmentsQuerySchema>;

export interface JudgmentRow {
  id: string;
  feature: JevFeature;
  issueId: string | null;
  mode: "shadow" | "on";
  jevLabel: string | null;
  confidence: number | null;
  escalated: boolean;
  errorCode: string | null;
  latencyMs: number | null;
  baseline: string | null;
  mismatch: boolean | null;
  shown: boolean;
  ownerOutcome: string | null;
  inputExcerpt: string | null;
  createdAt: string | null;
}

/** Truy vấn danh sách; export để test kiểm kế hoạch. */
export function judgmentsListSql(companyId: string, query: JudgmentsQuery): SQL {
  const conditions: SQL[] = [sql`company_id = ${companyId}`];
  if (query.feature) conditions.push(sql`feature = ${query.feature}`);
  if (query.mismatch) conditions.push(sql`mismatch`);
  if (query.before) conditions.push(sql`id < ${query.before}`);
  return sql`SELECT * FROM ${table()} WHERE ${sql.join(conditions, sql` AND `)}
      ORDER BY id DESC LIMIT ${JUDGMENT_PAGE_SIZE}`;
}

/** 50 dòng mới nhất; `inputExcerpt` đi qua `redact` lúc đọc (`null` = không nạp được hàm che thì không trả đoạn trích). */
export async function listJudgments(
  db: Pick<Db, "execute">,
  companyId: string,
  query: JudgmentsQuery,
  redact: ((text: string) => string) | null,
): Promise<{ items: JudgmentRow[]; nextBefore: string | null }> {
  const rows = rowsOf(await db.execute(judgmentsListSql(companyId, query)));
  const items = rows.map((row): JudgmentRow => ({
    id: String(row.id),
    feature: row.feature as JevFeature,
    issueId: str(row.issue_id),
    mode: row.mode === "on" ? "on" : "shadow",
    jevLabel: str(row.jev_label),
    confidence: num(row.confidence),
    escalated: row.escalated === true,
    errorCode: str(row.error_code),
    latencyMs: num(row.latency_ms),
    baseline: str(row.baseline),
    mismatch: row.mismatch === null || row.mismatch === undefined ? null : row.mismatch === true,
    shown: row.shown === true,
    ownerOutcome: str(row.owner_outcome),
    inputExcerpt: row.input_excerpt === null || row.input_excerpt === undefined || !redact ? null : redact(String(row.input_excerpt)),
    createdAt: iso(row.created_at),
  }));
  return { items, nextBefore: items.length === JUDGMENT_PAGE_SIZE ? items[items.length - 1]!.id : null };
}

export interface IssueJudgment {
  issueId: string;
  questionHash: string;
  jevLabel: string | null;
  baseline: string | null;
  mismatch: boolean;
  inputExcerpt: string | null;
  errorCode: string | null;
  createdAt: string | null;
}

const idList = (ids: readonly string[]) => sql.join(ids.map((id) => sql`${id}`), sql`, `);

/**
 * Mọi dòng của một tính năng cho các issue này, mới nhất trước (index `crew_jev_judgments_issue_idx`). Export để test kiểm
 * kế hoạch truy vấn.
 */
export function issueJudgmentsSql(companyId: string, feature: JevFeature, issueIds: readonly string[]): SQL {
  return sql`SELECT issue_id, question_hash, jev_label, baseline, mismatch, input_excerpt, error_code, created_at FROM ${table()}
    WHERE company_id = ${companyId} AND feature = ${feature} AND issue_id IN (${idList(issueIds)})
    ORDER BY created_at DESC, id DESC`;
}

export async function issueJudgments(
  db: Pick<Db, "execute">,
  companyId: string,
  feature: JevFeature,
  issueIds: readonly string[],
): Promise<IssueJudgment[]> {
  if (issueIds.length === 0) return [];
  const rows = rowsOf(await db.execute(issueJudgmentsSql(companyId, feature, issueIds)));
  return rows.map((row) => ({
    issueId: String(row.issue_id).toLowerCase(),
    questionHash: String(row.question_hash),
    jevLabel: str(row.jev_label),
    baseline: str(row.baseline),
    mismatch: row.mismatch === true,
    inputExcerpt: str(row.input_excerpt),
    errorCode: str(row.error_code),
    createdAt: iso(row.created_at),
  }));
}

/** Xóa dòng cũ hơn `before` (mọi company; index `crew_jev_judgments_created_idx`). Trả số dòng đã xóa. */
export async function purgeJudgments(db: Pick<Db, "execute">, before: string): Promise<number> {
  const rows = rowsOf(await db.execute(sql`DELETE FROM ${table()} WHERE created_at < ${before}::timestamptz RETURNING id`));
  return rows.length;
}

/** Dòng lỗi được hỏi lại sau chừng này, tối đa {@link JUDGMENT_MAX_ATTEMPTS} lần. */
export const JUDGMENT_RETRY_AFTER_MS = 15 * 60_000;
export const JUDGMENT_MAX_ATTEMPTS = 3;

/**
 * Một mục (issue, hoặc issue + băm) đã "xong" chưa, theo các dòng đo của nó: có một dòng không lỗi, hoặc đã đủ
 * {@link JUDGMENT_MAX_ATTEMPTS} lần lỗi, hoặc lần lỗi gần nhất chưa quá {@link JUDGMENT_RETRY_AFTER_MS}. Chưa có dòng nào thì
 * chưa xong.
 */
export function isSettled(attempts: ReadonlyArray<{ errorCode: string | null; createdAt: string | null }>, now: Date): boolean {
  if (attempts.length === 0) return false;
  if (attempts.some((attempt) => attempt.errorCode === null)) return true;
  if (attempts.length >= JUDGMENT_MAX_ATTEMPTS) return true;
  const latest = Math.max(...attempts.map((attempt) => (attempt.createdAt ? new Date(attempt.createdAt).getTime() : 0)));
  return now.getTime() - latest < JUDGMENT_RETRY_AFTER_MS;
}

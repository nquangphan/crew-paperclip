import { type SQL, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";
import { rowsOf } from "./project-roles.js";
import { jevJudge, type JevJudgeResult } from "./jev-client.js";
import { crewJevTable, type JevSettingsRecord, listEnabledJevSettings, resolveJevApiKey } from "./jev-store.js";
import { loadJevUse, type Question } from "./vendor/jev-use.js";

/**
 * Worker so sánh Jev với regex (chỉ ghi, không quyết định). Mỗi 60 s, với mỗi company bật Jev, bật so sánh ở server và có
 * key:
 * - liveness: run `succeeded` mới có `liveness_state` do regex của `classifyRunLiveness` ghi; text dựng lại từ comment của
 *   run và các trường chữ của `result_json`, che secret, cắt 8 KB; Jev chọn một nhãn; ghi `crew_jev_shadow`.
 * - runtime: dòng `pending` do plugin ghi lúc run hỏng (nhãn của `classifyRuntimeFailure`); Jev chọn nhãn rồi điền kết quả.
 * Quyết định thật (liveness, fallback runtime) vẫn theo regex; worker không đọc lại hay sửa `heartbeat_runs`.
 * Key đọc tối đa một lần mỗi lượt mỗi company, và chỉ khi có việc (lượt rỗng không đọc secret). Cuối lượt xóa dữ liệu
 * Jev cũ hơn 30 ngày.
 */

export const JEV_SHADOW_INTERVAL_MS = 60_000;
export const JEV_SHADOW_BATCH = 50;
export const JEV_SHADOW_TEXT_MAX_BYTES = 8 * 1024;
export const JEV_SHADOW_EXCERPT_MAX = 2000;
export const JEV_RETENTION_DAYS = 30;
/** Cửa sổ xét run không bao giờ sớm hơn một giờ trước: lần đầu bật, bật lại sau khi tắt, hay server ngừng lâu. */
export const JEV_SHADOW_FIRST_LOOKBACK_MS = 60 * 60_000;

/** Nhãn regex của liveness → nhãn so sánh. `empty_response`, `failed` không vào (regex không quyết định chúng). */
export const LIVENESS_SHADOW_LABEL: Readonly<Record<string, "blocked" | "future_work" | "progress">> = {
  blocked: "blocked",
  plan_only: "future_work",
  needs_followup: "future_work",
  advanced: "progress",
  completed: "progress",
};

const LIVENESS_QUESTION: Question = {
  type: "choice",
  question: "How did this AI agent run end, judging only by what it reported?",
  options: {
    blocked: "The agent stopped because something blocks it (missing access, a decision, a dependency) and it needs help.",
    future_work: "The agent only planned or left follow-up work for a later run; the task is not done yet.",
    progress: "The agent made real progress on the task or finished it.",
  },
};

const RUNTIME_QUESTION: Question = {
  type: "choice",
  question: "Why did this AI agent run fail, judging by its error message?",
  options: {
    quota: "The model provider's usage limit, rate limit or quota was hit.",
    auth: "Authentication failed: missing, invalid or expired API key or login.",
    unavailable: "The agent runtime could not start: command not found, missing binary or broken setup.",
    other: "Any other failure: code, tests, timeouts, workflow checks or unknown errors.",
  },
};

const shadowTable = () => sql.raw(crewJevTable("crew_jev_shadow"));

/** Cắt theo byte UTF-8, không để lại nửa ký tự. */
export function truncateUtf8(text: string, maxBytes: number): string {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.byteLength <= maxBytes) return text;
  return bytes.subarray(0, maxBytes).toString("utf8").replace(/�+$/, "");
}

/** Các trường chữ ở tầng đầu của `result_json`, theo thứ tự khóa. */
function resultText(result: unknown): string[] {
  if (!result || typeof result !== "object" || Array.isArray(result)) return [];
  return Object.keys(result as Record<string, unknown>)
    .sort()
    .flatMap((key) => {
      const value = (result as Record<string, unknown>)[key];
      return typeof value === "string" && value.trim() ? [`${key}: ${value.trim()}`] : [];
    });
}

function stateFor(kind: "liveness" | "runtime", text: string): string {
  const heading =
    kind === "liveness"
      ? "Final report of an AI coding agent run (its comments and result fields; secrets redacted, truncated):"
      : "Error message of a failed AI coding agent run (secrets redacted, truncated):";
  return `${heading}\n\n${text}`;
}

interface Evaluation {
  jevLabel: string | null;
  confidence: number | null;
  escalated: boolean | null;
  status: "done" | "error";
  errorCode: string | null;
  latencyMs: number;
}

function evaluationOf(result: JevJudgeResult): Evaluation {
  if (!result.ok) {
    return { jevLabel: null, confidence: null, escalated: null, status: "error", errorCode: result.errorCode, latencyMs: result.latencyMs };
  }
  const answer = result.answers.label;
  return {
    jevLabel: typeof answer?.answer === "string" ? answer.answer : null,
    confidence: answer?.confidence ?? null,
    escalated: answer?.escalated ?? true,
    status: "done",
    errorCode: null,
    latencyMs: result.latencyMs,
  };
}

interface SweepContext {
  db: Db;
  settings: JevSettingsRecord;
  /** Key của company, đọc lần đầu khi có việc rồi giữ cho cả lượt; `null` khi không đọc được. */
  apiKey: () => Promise<string | null>;
  redact: (text: string) => string;
}

async function judge(context: SweepContext, kind: "liveness" | "runtime", text: string): Promise<JevJudgeResult> {
  const apiKey = await context.apiKey();
  if (!apiKey) throw new NoKeyError();
  return jevJudge({
    apiKey,
    model: context.settings.model,
    timeoutMs: context.settings.timeoutMs,
    confidenceThreshold: context.settings.threshold,
    state: stateFor(kind, text),
    questions: { label: kind === "liveness" ? LIVENESS_QUESTION : RUNTIME_QUESTION },
  });
}

/** Run có `created_at` sớm hơn đầu cửa sổ quá chừng này thì bỏ (run dài hơn một ngày rất hiếm). Để dùng index sẵn có. */
export const JEV_SHADOW_MAX_RUN_MS = 24 * 60 * 60_000;
/** Con trỏ lùi lại chừng này: liveness được ghi sau `finished_at` vài lệnh await, run kết thúc trước có thể có nhãn sau. */
export const JEV_SHADOW_CURSOR_LAG_MS = 10 * 60_000;
/** Ghi kết quả lỗi chừng này lần thì đánh dấu `error`/`internal` để không gọi Jev mãi cho cùng một run. */
export const JEV_SHADOW_MAX_ATTEMPTS = 3;

/**
 * Đầu cửa sổ xét run: con trỏ lùi {@link JEV_SHADOW_CURSOR_LAG_MS}, nhưng không sớm hơn một giờ trước. Bật lại sau thời
 * gian tắt (hay server ngừng lâu) chỉ xét run của giờ gần nhất, không kéo backlog.
 */
export function livenessWindowStart(cursor: string | null, now: Date): Date {
  const floor = now.getTime() - JEV_SHADOW_FIRST_LOOKBACK_MS;
  const lagged = cursor ? new Date(cursor).getTime() - JEV_SHADOW_CURSOR_LAG_MS : floor;
  return new Date(Math.max(lagged, floor));
}

/**
 * Run `succeeded` có nhãn liveness và chưa có dòng so sánh, từ `since`. Điều kiện `created_at` giúp Postgres dùng
 * `heartbeat_runs_company_liveness_idx (company_id, liveness_state, created_at)`. Export để test kiểm kế hoạch truy vấn.
 */
export function livenessCandidatesSql(companyId: string, since: Date): SQL {
  const states = Object.keys(LIVENESS_SHADOW_LABEL);
  return sql`SELECT r.id::text AS id, r.finished_at, r.liveness_state, r.result_json,
      r.context_snapshot->>'issueId' AS issue_id
    FROM "heartbeat_runs" r
    WHERE r.company_id = ${companyId} AND r.status = 'succeeded'
      AND r.liveness_state IN (${sql.join(states.map((state) => sql`${state}`), sql`, `)})
      AND r.created_at >= ${new Date(since.getTime() - JEV_SHADOW_MAX_RUN_MS).toISOString()}::timestamptz
      AND r.finished_at >= ${since.toISOString()}::timestamptz
      AND NOT EXISTS (SELECT 1 FROM ${shadowTable()} s WHERE s.run_id = r.id AND s.kind = 'liveness')
    ORDER BY r.finished_at, r.id LIMIT ${JEV_SHADOW_BATCH}`;
}

/**
 * Tối đa 5 comment gần nhất của run trên issue của nó. Lọc theo `issue_id` để dùng
 * `issue_comments_company_issue_created_at_idx` (không có index trên `created_by_run_id`). Export để test kiểm kế hoạch.
 */
export function runCommentsSql(companyId: string, issueId: string, runId: string): SQL {
  return sql`SELECT body FROM "issue_comments"
    WHERE company_id = ${companyId} AND issue_id = ${issueId} AND created_by_run_id = ${runId} AND deleted_at IS NULL
    ORDER BY created_at DESC, id DESC LIMIT 5`;
}

const UUID_RE = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

/** Số lần ghi kết quả lỗi theo `kind:id` (trong process; prod chạy một instance server). */
const failedAttempts = new Map<string, number>();

/** Cắt theo ký tự (code point), không cắt đôi cặp surrogate. */
function excerpt(text: string): string {
  return Array.from(text).slice(0, JEV_SHADOW_EXCERPT_MAX).join("");
}

async function writeLiveness(
  db: Db, companyId: string, runId: string, regexLabel: string, evaluation: Evaluation, text: string | null,
): Promise<void> {
  await db.execute(sql`INSERT INTO ${shadowTable()}
    (company_id, kind, run_id, regex_label, jev_label, confidence, escalated, status, error_code, latency_ms, input_excerpt,
     evaluated_at)
    VALUES (${companyId}, 'liveness', ${runId}, ${regexLabel}, ${evaluation.jevLabel}, ${evaluation.confidence},
      ${evaluation.escalated}, ${evaluation.status}, ${evaluation.errorCode}, ${evaluation.latencyMs},
      ${text === null ? null : excerpt(text)}, now())
    ON CONFLICT (run_id, kind) DO NOTHING`);
}

const INTERNAL_ERROR: Evaluation = {
  jevLabel: null, confidence: null, escalated: null, status: "error", errorCode: "internal", latencyMs: 0,
};

/**
 * Chạy một việc (một run hay một dòng). Lỗi (trừ thiếu key) chỉ ghi log và đếm; tới {@link JEV_SHADOW_MAX_ATTEMPTS} lần thì
 * gọi `giveUp` (ghi `error`/`internal`, không kèm text). Trả `true` khi việc đã xong hoặc đã bỏ hẳn.
 */
async function attempt(
  key: string, companyId: string, work: () => Promise<void>, giveUp: () => Promise<void>,
): Promise<boolean> {
  if ((failedAttempts.get(key) ?? 0) >= JEV_SHADOW_MAX_ATTEMPTS) {
    try {
      await giveUp();
      failedAttempts.delete(key);
    } catch (error) {
      logger.warn({ companyId, item: key, ...errorInfo(error) }, "crew jev shadow: vẫn không ghi được dòng lỗi, bỏ qua");
    }
    return true;
  }
  try {
    await work();
    failedAttempts.delete(key);
    return true;
  } catch (error) {
    if (error instanceof NoKeyError) throw error;
    const count = (failedAttempts.get(key) ?? 0) + 1;
    failedAttempts.set(key, count);
    logger.warn({ companyId, item: key, attempt: count, ...errorInfo(error) }, "crew jev shadow: ghi kết quả lỗi");
    if (count >= JEV_SHADOW_MAX_ATTEMPTS) return attempt(key, companyId, work, giveUp);
    return false;
  }
}

async function sweepLiveness(context: SweepContext, now: Date): Promise<number> {
  const { db, settings } = context;
  const since = livenessWindowStart(settings.shadowCursor, now);
  const runs = rowsOf(await db.execute(livenessCandidatesSql(settings.companyId, since)));
  let latest: Date | null = null;
  let pin: Date | null = null;
  for (const run of runs) {
    const runId = String(run.id);
    const finishedAt = new Date(run.finished_at as string | Date);
    const regexLabel = LIVENESS_SHADOW_LABEL[String(run.liveness_state)]!;
    const done = await attempt(
      `liveness:${runId}`,
      settings.companyId,
      async () => {
        const issueId = typeof run.issue_id === "string" && UUID_RE.test(run.issue_id) ? run.issue_id : null;
        const comments = issueId
          ? rowsOf(await db.execute(runCommentsSql(settings.companyId, issueId, runId))).reverse().map((row) => String(row.body))
          : [];
        const fields = resultText(run.result_json);
        const raw = [
          ...(comments.length > 0 ? ["Comments:", ...comments] : []),
          ...(fields.length > 0 ? ["Result:", ...fields] : []),
        ].join("\n\n");
        const text = truncateUtf8(context.redact(raw), JEV_SHADOW_TEXT_MAX_BYTES);
        const evaluation = evaluationOf(await judge(context, "liveness", text || "(the run reported nothing)"));
        await writeLiveness(db, settings.companyId, runId, regexLabel, evaluation, text);
      },
      () => writeLiveness(db, settings.companyId, runId, regexLabel, INTERNAL_ERROR, null),
    );
    if (done) {
      if (!latest || finishedAt > latest) latest = finishedAt;
    } else if (!pin || finishedAt < pin) {
      pin = finishedAt;
    }
  }
  // Con trỏ không vượt qua run `succeeded` chưa có nhãn liveness (nhãn được ghi sau `finished_at`) hay run vừa lỗi.
  const unlabeled = rowsOf(
    await db.execute(sql`SELECT min(r.finished_at) AS at FROM "heartbeat_runs" r
      WHERE r.company_id = ${settings.companyId} AND r.status = 'succeeded' AND r.liveness_state IS NULL
        AND r.created_at >= ${new Date(since.getTime() - JEV_SHADOW_MAX_RUN_MS).toISOString()}::timestamptz
        AND r.finished_at >= ${since.toISOString()}::timestamptz`),
  )[0]?.at;
  if (unlabeled) {
    const at = new Date(unlabeled as string | Date);
    if (!pin || at < pin) pin = at;
  }
  const next = latest && pin && pin < latest ? pin : latest;
  if (next) {
    await db.execute(sql`UPDATE ${sql.raw(crewJevTable("crew_jev_settings"))}
      SET shadow_cursor = greatest(coalesce(shadow_cursor, '-infinity'::timestamptz), ${next.toISOString()}::timestamptz)
      WHERE company_id = ${settings.companyId}`);
  }
  return runs.length;
}

async function sweepRuntime(context: SweepContext): Promise<number> {
  const { db, settings } = context;
  const rows = rowsOf(
    await db.execute(sql`SELECT id, input_excerpt FROM ${shadowTable()}
      WHERE company_id = ${settings.companyId} AND kind = 'runtime' AND status = 'pending'
      ORDER BY id LIMIT ${JEV_SHADOW_BATCH}`),
  );
  const write = (id: unknown, evaluation: Evaluation, text: string | null) =>
    db.execute(sql`UPDATE ${shadowTable()}
      SET jev_label = ${evaluation.jevLabel}, confidence = ${evaluation.confidence}, escalated = ${evaluation.escalated},
        status = ${evaluation.status}, error_code = ${evaluation.errorCode}, latency_ms = ${evaluation.latencyMs},
        input_excerpt = ${text === null ? null : excerpt(text)}, evaluated_at = now()
      WHERE id = ${id} AND status = 'pending'`);
  for (const row of rows) {
    await attempt(
      `runtime:${String(row.id)}`,
      settings.companyId,
      async () => {
        const text = truncateUtf8(context.redact(String(row.input_excerpt ?? "")), JEV_SHADOW_TEXT_MAX_BYTES);
        const evaluation = evaluationOf(await judge(context, "runtime", text || "(no error message)"));
        await write(row.id, evaluation, text);
      },
      async () => {
        await write(row.id, INTERNAL_ERROR, null);
      },
    );
  }
  return rows.length;
}

/** Dọn mỗi giờ một lần (không phải mỗi lượt): hai câu xóa không có `company_id` nên quét cả bảng. */
export const JEV_PURGE_INTERVAL_MS = 60 * 60_000;
let lastPurgeAt = 0;

/** Xóa dòng gate và dòng so sánh cũ hơn 30 ngày (mọi company). */
async function purgeOld(db: Db, now: Date): Promise<number> {
  const before = new Date(now.getTime() - JEV_RETENTION_DAYS * 86_400_000).toISOString();
  const gate = rowsOf(
    await db.execute(sql`DELETE FROM ${sql.raw(crewJevTable("crew_jev_gate_events"))}
      WHERE occurred_at < ${before}::timestamptz RETURNING id`),
  );
  const shadow = rowsOf(
    await db.execute(sql`DELETE FROM ${shadowTable()} WHERE created_at < ${before}::timestamptz RETURNING id`),
  );
  return gate.length + shadow.length;
}

/** Thông tin lỗi an toàn để log: tên, mã SQLSTATE, tên ràng buộc; không có message (có thể chứa text run). */
function errorInfo(error: unknown): Record<string, string> {
  const info: Record<string, string> = { err: error instanceof Error ? error.name : typeof error };
  const sources = [error, (error as { cause?: unknown } | null)?.cause];
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    const record = source as Record<string, unknown>;
    if (typeof record.code === "string" && !info.code) info.code = record.code;
    if (typeof record.constraint_name === "string" && !info.constraint) info.constraint = record.constraint_name;
    if (typeof record.table_name === "string" && !info.table) info.table = record.table_name;
  }
  return info;
}

/** Secret key không đọc được giữa lượt: dừng company này, không ghi dòng lỗi giả. */
class NoKeyError extends Error {
  override name = "NoKeyError";
}

export interface JevShadowSweepResult {
  companies: number;
  liveness: number;
  runtime: number;
  purged: number;
}


/**
 * Một lượt của worker; export để test. Lỗi của một company chỉ ghi log (tên lỗi, không text run hay key) rồi sang company
 * sau. Không có company nào đủ điều kiện thì không gọi Jev và không đọc secret.
 */
export async function runJevShadowSweep(
  db: Db,
  now: Date = new Date(),
  opts: { forcePurge?: boolean } = {},
): Promise<JevShadowSweepResult> {
  const result: JevShadowSweepResult = { companies: 0, liveness: 0, runtime: 0, purged: 0 };
  const eligible = (await listEnabledJevSettings(db)).filter((settings) => settings.serverShadow && settings.keySecretId);
  if (eligible.length > 0) {
    let redact: ((text: string) => string) | null = null;
    try {
      redact = (await loadJevUse()).redactSecrets;
    } catch (error) {
      logger.warn(errorInfo(error), "crew jev shadow: không nạp được jev-use, bỏ lượt này");
    }
    for (const settings of redact ? eligible : []) {
      try {
        let key: Promise<string | null> | null = null;
        const apiKey = () => (key ??= resolveJevApiKey(db, settings, "crew-jev-shadow"));
        const context: SweepContext = { db, settings, apiKey, redact: redact! };
        result.companies += 1;
        result.liveness += await sweepLiveness(context, now);
        result.runtime += await sweepRuntime(context);
      } catch (error) {
        logger.warn({ companyId: settings.companyId, ...errorInfo(error) }, "crew jev shadow: lỗi ở company, chờ lượt sau");
      }
    }
  }
  if (opts.forcePurge || now.getTime() - lastPurgeAt >= JEV_PURGE_INTERVAL_MS) {
    result.purged = await purgeOld(db, now);
    lastPurgeAt = now.getTime();
  }
  return result;
}

let worker: { timer: NodeJS.Timeout; running: boolean } | null = null;

/**
 * Bật worker một lần cho process (bỏ qua khi `NODE_ENV=test`). Lượt mới không chạy khi lượt trước chưa xong. Giả định prod
 * chạy một instance server: nhiều instance thì mỗi run có thể được gửi Jev nhiều lần (ghi trùng vẫn bị chặn bởi
 * `ON CONFLICT`/`status='pending'`); khi scale cần thêm `pg_try_advisory_lock` cho mỗi lượt.
 */
export function startJevShadowWorker(db: Db): void {
  if (worker || process.env.NODE_ENV === "test") return;
  const state = { running: false, timer: undefined as unknown as NodeJS.Timeout };
  state.timer = setInterval(() => {
    if (state.running) return;
    state.running = true;
    runJevShadowSweep(db)
      .then((result) => {
        if (result.liveness + result.runtime + result.purged > 0) logger.info(result, "crew jev shadow sweep");
      })
      .catch((error: unknown) => {
        logger.warn(errorInfo(error), "crew jev shadow sweep failed");
      })
      .finally(() => {
        state.running = false;
      });
  }, JEV_SHADOW_INTERVAL_MS);
  state.timer.unref();
  worker = state;
}

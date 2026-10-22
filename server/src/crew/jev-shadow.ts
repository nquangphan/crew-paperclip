import { sql } from "drizzle-orm";
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
/** Lần đầu bật (chưa có con trỏ) chỉ xét run kết thúc trong một giờ trước. */
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

async function sweepLiveness(context: SweepContext, now: Date): Promise<number> {
  const { db, settings } = context;
  const cursor = settings.shadowCursor ? new Date(settings.shadowCursor) : new Date(now.getTime() - JEV_SHADOW_FIRST_LOOKBACK_MS);
  const states = Object.keys(LIVENESS_SHADOW_LABEL);
  const runs = rowsOf(
    await db.execute(sql`SELECT r.id::text AS id, r.finished_at, r.liveness_state, r.result_json FROM "heartbeat_runs" r
      WHERE r.company_id = ${settings.companyId} AND r.status = 'succeeded'
        AND r.liveness_state IN (${sql.join(states.map((state) => sql`${state}`), sql`, `)})
        AND r.finished_at >= ${cursor.toISOString()}::timestamptz
        AND NOT EXISTS (SELECT 1 FROM ${shadowTable()} s WHERE s.run_id = r.id AND s.kind = 'liveness')
      ORDER BY r.finished_at, r.id LIMIT ${JEV_SHADOW_BATCH}`),
  );
  let latest: Date | null = null;
  for (const run of runs) {
    const runId = String(run.id);
    const comments = rowsOf(
      await db.execute(sql`SELECT body FROM "issue_comments"
        WHERE company_id = ${settings.companyId} AND created_by_run_id = ${runId} AND deleted_at IS NULL
        ORDER BY created_at DESC, id DESC LIMIT 5`),
    )
      .reverse()
      .map((row) => String(row.body));
    const raw = [
      ...(comments.length > 0 ? ["Comments:", ...comments] : []),
      ...(() => {
        const fields = resultText(run.result_json);
        return fields.length > 0 ? ["Result:", ...fields] : [];
      })(),
    ].join("\n\n");
    const text = truncateUtf8(context.redact(raw), JEV_SHADOW_TEXT_MAX_BYTES);
    const regexLabel = LIVENESS_SHADOW_LABEL[String(run.liveness_state)]!;
    const evaluation = evaluationOf(await judge(context, "liveness", text || "(the run reported nothing)"));
    await db.execute(sql`INSERT INTO ${shadowTable()}
      (company_id, kind, run_id, regex_label, jev_label, confidence, escalated, status, error_code, latency_ms, input_excerpt,
       evaluated_at)
      VALUES (${settings.companyId}, 'liveness', ${runId}, ${regexLabel}, ${evaluation.jevLabel}, ${evaluation.confidence},
        ${evaluation.escalated}, ${evaluation.status}, ${evaluation.errorCode}, ${evaluation.latencyMs},
        ${text.slice(0, JEV_SHADOW_EXCERPT_MAX)}, now())
      ON CONFLICT (run_id, kind) DO NOTHING`);
    const finishedAt = new Date(run.finished_at as string | Date);
    if (!latest || finishedAt > latest) latest = finishedAt;
  }
  if (latest) {
    await db.execute(sql`UPDATE ${sql.raw(crewJevTable("crew_jev_settings"))}
      SET shadow_cursor = greatest(coalesce(shadow_cursor, '-infinity'::timestamptz), ${latest.toISOString()}::timestamptz)
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
  for (const row of rows) {
    const text = truncateUtf8(context.redact(String(row.input_excerpt ?? "")), JEV_SHADOW_TEXT_MAX_BYTES);
    const evaluation = evaluationOf(await judge(context, "runtime", text || "(no error message)"));
    await db.execute(sql`UPDATE ${shadowTable()}
      SET jev_label = ${evaluation.jevLabel}, confidence = ${evaluation.confidence}, escalated = ${evaluation.escalated},
        status = ${evaluation.status}, error_code = ${evaluation.errorCode}, latency_ms = ${evaluation.latencyMs},
        input_excerpt = ${text.slice(0, JEV_SHADOW_EXCERPT_MAX)}, evaluated_at = now()
      WHERE id = ${row.id} AND status = 'pending'`);
  }
  return rows.length;
}

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

const errorName = (error: unknown) => (error instanceof Error ? error.name : typeof error);

/**
 * Một lượt của worker; export để test. Lỗi của một company chỉ ghi log (tên lỗi, không text run hay key) rồi sang company
 * sau. Không có company nào đủ điều kiện thì không gọi Jev và không đọc secret.
 */
export async function runJevShadowSweep(db: Db, now: Date = new Date()): Promise<JevShadowSweepResult> {
  const result: JevShadowSweepResult = { companies: 0, liveness: 0, runtime: 0, purged: 0 };
  const eligible = (await listEnabledJevSettings(db)).filter((settings) => settings.serverShadow && settings.keySecretId);
  if (eligible.length > 0) {
    let redact: ((text: string) => string) | null = null;
    try {
      redact = (await loadJevUse()).redactSecrets;
    } catch (error) {
      logger.warn({ err: errorName(error) }, "crew jev shadow: không nạp được jev-use, bỏ lượt này");
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
        logger.warn({ companyId: settings.companyId, err: errorName(error) }, "crew jev shadow: lỗi ở company, chờ lượt sau");
      }
    }
  }
  result.purged = await purgeOld(db, now);
  return result;
}

let worker: { timer: NodeJS.Timeout; running: boolean } | null = null;

/** Bật worker một lần cho process (bỏ qua khi `NODE_ENV=test`). Lượt mới không chạy khi lượt trước chưa xong. */
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
        logger.warn({ err: errorName(error) }, "crew jev shadow sweep failed");
      })
      .finally(() => {
        state.running = false;
      });
  }, JEV_SHADOW_INTERVAL_MS);
  state.timer.unref();
  worker = state;
}

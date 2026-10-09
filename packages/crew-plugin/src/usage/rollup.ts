/**
 * Usage của một run và phép cộng nhiều run. Thuần, không đọc DB.
 * Số liệu đến từ `cost_events` (token, cent thật) và `heartbeat_runs.usage_json`/`result_json.modelUsage` (USD ước tính
 * của Claude Code). Run không có số liệu nào là `thieu` và không bao giờ được cộng như 0.
 */
export type Completeness = "day_du" | "mot_phan" | "thieu" | "dang_chay";
export type CrewRole = "assistant" | "executor" | "reviewer" | "integrator" | "khac";

export interface UsageTotals {
  runs: number;
  runsWithUsage: number;
  runsMissing: number;
  runsRunning: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  estimatedUsd: number | null;
  estimatedUsdRuns: number;
  billedCents: number;
  completeness: "day_du" | "mot_phan" | "khong_co";
}

export interface UsageRun {
  runId: string;
  issueId: string | null;
  identifier: string | null;
  agentId: string;
  agentName: string;
  role: CrewRole;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  model: string | null;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  estimatedUsd: number | null;
  billingType: string | null;
  usageSource: "per_run" | "session_delta" | null;
  sessionReused: boolean | null;
  completeness: Completeness;
}

export interface ModelUsage {
  model: string;
  source: "model_usage" | "run_model";
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  estimatedUsd: number | null;
}

/** Run kèm phần chỉ dùng nội bộ để cộng: chia theo model và cent thật đã ghi. */
export type RolledRun = UsageRun & { models: ModelUsage[]; billedCents: number };

export interface RawRun {
  runId: string;
  ownerIssueId: string | null;
  identifier: string | null;
  agentId: string;
  agentName: string;
  role: CrewRole;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  costEventCount: number;
  ce: { input: number; cached: number; output: number; cents: number; model: string | null; billingType: string | null } | null;
  usageJson: Record<string, unknown> | null;
  modelUsage: Record<string, unknown> | null;
}

export const USAGE_NOTES: readonly string[] = [
  "USD là ước tính của Claude Code, không phải hóa đơn; gói subscription ghi 0 đồng thực trả.",
  "Token không quy đổi ra phần trăm quota của gói.",
  "Claude Code không báo riêng token suy luận.",
  "Token đầu vào gồm cả token ghi cache; token đọc cache tính riêng.",
];

/** Trạng thái kết thúc của Paperclip; `interrupted` có trên prod (run bị ngắt khi khởi động lại). */
const FINISHED = new Set(["succeeded", "failed", "cancelled", "timed_out", "interrupted"]);
const usd = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
const tok = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);

function perModel(modelUsage: Record<string, unknown>): ModelUsage[] {
  return Object.entries(modelUsage).map(([model, value]) => {
    const e = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
    return {
      model, source: "model_usage" as const,
      inputTokens: (tok(e.inputTokens) ?? 0) + (tok(e.cacheCreationInputTokens) ?? 0),
      cachedInputTokens: tok(e.cacheReadInputTokens) ?? 0,
      outputTokens: tok(e.outputTokens) ?? 0,
      estimatedUsd: usd(e.costUSD),
    };
  }).sort((a, b) => a.model.localeCompare(b.model));
}

export function toUsageRun(raw: RawRun): RolledRun {
  const u = raw.usageJson ?? {};
  const running = raw.finishedAt === null && !FINISHED.has(raw.status);
  const estimate = usd(u.cacheAdjustedCostUsd) ?? usd(u.costUsd);
  let input: number | null = null;
  let cached: number | null = null;
  let output: number | null = null;
  let completeness: Completeness;
  if (raw.ce && raw.costEventCount > 0) {
    input = raw.ce.input;
    cached = raw.ce.cached;
    output = raw.ce.output;
    completeness = estimate === null ? "mot_phan" : "day_du";
  } else if (tok(u.inputTokens) !== null || tok(u.outputTokens) !== null) {
    input = tok(u.inputTokens) ?? 0;
    cached = tok(u.cachedInputTokens) ?? 0;
    output = tok(u.outputTokens) ?? 0;
    completeness = "mot_phan";
  } else {
    completeness = "thieu";
  }
  if (running) completeness = "dang_chay";
  const source = u.usageSource === "per_run" || u.usageSource === "session_delta" ? u.usageSource : null;
  const model = raw.ce?.model ?? (typeof u.model === "string" ? u.model : null);
  const models: ModelUsage[] = source === "per_run" && raw.modelUsage && Object.keys(raw.modelUsage).length > 0
    ? perModel(raw.modelUsage)
    : input !== null && model
      ? [{ model, source: "run_model", inputTokens: input, cachedInputTokens: cached ?? 0, outputTokens: output ?? 0, estimatedUsd: estimate }]
      : [];
  return {
    runId: raw.runId, issueId: raw.ownerIssueId, identifier: raw.identifier, agentId: raw.agentId, agentName: raw.agentName,
    role: raw.role, status: raw.status, startedAt: raw.startedAt, finishedAt: raw.finishedAt, model,
    inputTokens: input, cachedInputTokens: cached, outputTokens: output, estimatedUsd: estimate,
    billingType: raw.ce?.billingType ?? null, usageSource: source,
    sessionReused: typeof u.sessionReused === "boolean" ? u.sessionReused : null, completeness, models,
    billedCents: raw.ce?.cents ?? 0,
  };
}

/** Cộng theo tập run (mỗi `runId` một lần). Run đang chạy và run thiếu chỉ được đếm, không cộng token. */
export function sumRuns(runs: ReadonlyArray<RolledRun>): UsageTotals {
  const unique = [...new Map(runs.map((r) => [r.runId, r])).values()];
  let input = 0, cached = 0, output = 0, est = 0, estRuns = 0, cents = 0, withUsage = 0, missing = 0, running = 0, full = 0;
  for (const r of unique) {
    if (r.completeness === "dang_chay") { running++; continue; }
    if (r.completeness === "thieu") { missing++; continue; }
    withUsage++;
    if (r.completeness === "day_du") full++;
    input += r.inputTokens ?? 0;
    cached += r.cachedInputTokens ?? 0;
    output += r.outputTokens ?? 0;
    cents += r.billedCents;
    if (r.estimatedUsd !== null) { est += r.estimatedUsd; estRuns++; }
  }
  const done = unique.length - running;
  return {
    runs: unique.length, runsWithUsage: withUsage, runsMissing: missing, runsRunning: running,
    inputTokens: input, cachedInputTokens: cached, outputTokens: output,
    estimatedUsd: estRuns > 0 ? Math.round(est * 1e6) / 1e6 : null, estimatedUsdRuns: estRuns, billedCents: cents,
    completeness: withUsage === 0 ? "khong_co" : full === done ? "day_du" : "mot_phan",
  };
}

/** Gộp chia theo model qua nhiều run theo `(model, source)`; USD là `null` khi có một phần không có ước tính. */
export function mergeModels(runs: ReadonlyArray<RolledRun>): ModelUsage[] {
  const merged = new Map<string, ModelUsage>();
  for (const run of new Map(runs.map((r) => [r.runId, r])).values()) {
    if (run.completeness === "dang_chay") continue;
    for (const m of run.models) {
      const key = `${m.source}\u0000${m.model}`;
      const prev = merged.get(key);
      if (!prev) { merged.set(key, { ...m }); continue; }
      prev.inputTokens += m.inputTokens;
      prev.cachedInputTokens += m.cachedInputTokens;
      prev.outputTokens += m.outputTokens;
      prev.estimatedUsd = prev.estimatedUsd === null || m.estimatedUsd === null
        ? null : Math.round((prev.estimatedUsd + m.estimatedUsd) * 1e6) / 1e6;
    }
  }
  return [...merged.values()].sort((a, b) => b.outputTokens - a.outputTokens || a.model.localeCompare(b.model));
}

/** 00:00 Asia/Ho_Chi_Minh (UTC+7, không đổi giờ mùa hè) của ngày đầu cửa sổ `days` ngày kết thúc hôm nay. */
export function vnWindowStart(now: Date, days: number): Date {
  const vn = new Date(now.getTime() + 7 * 3_600_000);
  return new Date(Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate() - (days - 1)) - 7 * 3_600_000);
}

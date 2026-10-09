import { describe, expect, it } from "vitest";
import { mergeModels, sumRuns, toUsageRun, USAGE_NOTES, vnWindowStart } from "../usage/rollup.js";

const raw = (over: Partial<Parameters<typeof toUsageRun>[0]> = {}) => ({
  runId: "r1", ownerIssueId: "i1", identifier: "TPS-1", agentId: "a1", agentName: "Exec", role: "executor" as const,
  status: "succeeded", startedAt: "2026-10-09T01:00:00Z", finishedAt: "2026-10-09T01:10:00Z",
  costEventCount: 1, ce: { input: 100, cached: 1000, output: 50, cents: 0, model: "claude-sonnet-5", billingType: "subscription_included" },
  usageJson: { costUsd: 0.5, cacheAdjustedCostUsd: 0.42, usageSource: "per_run", sessionReused: false, freshSession: true } as Record<string, unknown> | null,
  modelUsage: {
    "claude-sonnet-5": { inputTokens: 60, cacheCreationInputTokens: 30, cacheReadInputTokens: 1000, outputTokens: 40, costUSD: 0.4 },
    "claude-haiku-5": { inputTokens: 10, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, outputTokens: 10, costUSD: 0.02 },
  } as Record<string, unknown> | null,
  ...over,
});
const missing = { costEventCount: 0, ce: null, usageJson: null, modelUsage: null };

describe("toUsageRun", () => {
  it("uses cost_events tokens and the cache-adjusted SDK estimate", () => {
    const run = toUsageRun(raw());
    expect(run).toMatchObject({ inputTokens: 100, cachedInputTokens: 1000, outputTokens: 50, estimatedUsd: 0.42,
      completeness: "day_du", usageSource: "per_run", sessionReused: false, model: "claude-sonnet-5",
      billingType: "subscription_included" });
    expect(run.models).toEqual([
      { model: "claude-haiku-5", source: "model_usage", inputTokens: 10, cachedInputTokens: 0, outputTokens: 10, estimatedUsd: 0.02 },
      { model: "claude-sonnet-5", source: "model_usage", inputTokens: 90, cachedInputTokens: 1000, outputTokens: 40, estimatedUsd: 0.4 },
    ]);
  });
  it("is partial without an estimate, missing without any usage, running when unfinished", () => {
    expect(toUsageRun(raw({ usageJson: { usageSource: "per_run" } })).completeness).toBe("mot_phan");
    expect(toUsageRun(raw({ costEventCount: 0, ce: null, usageJson: { inputTokens: 5, outputTokens: 1, cachedInputTokens: 0 } })))
      .toMatchObject({ completeness: "mot_phan", inputTokens: 5 });
    expect(toUsageRun(raw(missing)))
      .toMatchObject({ completeness: "thieu", inputTokens: null, cachedInputTokens: null, outputTokens: null, estimatedUsd: null, models: [] });
    expect(toUsageRun(raw({ status: "running", finishedAt: null })).completeness).toBe("dang_chay");
    expect(toUsageRun(raw({ status: "queued", startedAt: null, finishedAt: null, ...missing })).completeness).toBe("dang_chay");
  });
  it("treats interrupted runs as finished, not running", () => {
    expect(toUsageRun(raw({ status: "interrupted", finishedAt: null, ...missing })).completeness).toBe("thieu");
  });
  it("uses the run model when usage is not per run", () => {
    const run = toUsageRun(raw({ usageJson: { usageSource: "session_delta", costUsd: 1 } }));
    expect(run.models).toEqual([{ model: "claude-sonnet-5", source: "run_model", inputTokens: 100, cachedInputTokens: 1000, outputTokens: 50, estimatedUsd: 1 }]);
  });
  it("ignores negative, NaN and non-number estimates", () => {
    for (const bad of [-1, Number.NaN, "0.5", null]) {
      expect(toUsageRun(raw({ usageJson: { costUsd: bad, usageSource: "per_run" } })).estimatedUsd).toBeNull();
    }
  });
});

describe("sumRuns", () => {
  it("skips running runs, counts missing, never turns null into 0 silently", () => {
    const runs = [toUsageRun(raw()), toUsageRun(raw({ runId: "r2", ...missing })),
      toUsageRun(raw({ runId: "r3", status: "running", finishedAt: null }))];
    expect(sumRuns(runs)).toEqual({ runs: 3, runsWithUsage: 1, runsMissing: 1, runsRunning: 1, inputTokens: 100,
      cachedInputTokens: 1000, outputTokens: 50, estimatedUsd: 0.42, estimatedUsdRuns: 1, billedCents: 0, completeness: "mot_phan" });
    expect(sumRuns([]).completeness).toBe("khong_co");
    const onlyMissing = sumRuns([toUsageRun(raw(missing))]);
    expect(onlyMissing).toMatchObject({ runsMissing: 1, runsWithUsage: 0, estimatedUsd: null, completeness: "khong_co" });
  });
  it("is complete only when every finished run is complete", () => {
    expect(sumRuns([toUsageRun(raw()), toUsageRun(raw({ runId: "r2" }))]).completeness).toBe("day_du");
  });
  it("counts a run once even if passed twice", () => {
    const run = toUsageRun(raw());
    expect(sumRuns([run, run]).runs).toBe(1);
  });
});

describe("mergeModels", () => {
  it("adds per model across runs, null USD when one part has no estimate, skips running runs", () => {
    const a = toUsageRun(raw());
    const b = toUsageRun(raw({ runId: "r2", modelUsage: { "claude-haiku-5": { inputTokens: 1, outputTokens: 2 } } }));
    const c = toUsageRun(raw({ runId: "r3", status: "running", finishedAt: null }));
    expect(mergeModels([a, b, c, a])).toEqual([
      { model: "claude-sonnet-5", source: "model_usage", inputTokens: 90, cachedInputTokens: 1000, outputTokens: 40, estimatedUsd: 0.4 },
      { model: "claude-haiku-5", source: "model_usage", inputTokens: 11, cachedInputTokens: 0, outputTokens: 12, estimatedUsd: null },
    ]);
  });
});

it("notes are the four fixed sentences", () => {
  expect(USAGE_NOTES).toEqual([
    "USD là ước tính của Claude Code, không phải hóa đơn; gói subscription ghi 0 đồng thực trả.",
    "Token không quy đổi ra phần trăm quota của gói.",
    "Claude Code không báo riêng token suy luận.",
    "Token đầu vào gồm cả token ghi cache; token đọc cache tính riêng.",
  ]);
});

it("window starts at Vietnam midnight", () => {
  expect(vnWindowStart(new Date("2026-10-10T01:30:00Z"), 7).toISOString()).toBe("2026-10-03T17:00:00.000Z");
  expect(vnWindowStart(new Date("2026-10-09T18:30:00Z"), 1).toISOString()).toBe("2026-10-09T17:00:00.000Z");
});

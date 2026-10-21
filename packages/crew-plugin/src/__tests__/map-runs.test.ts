import { describe, expect, it } from "vitest";
import { groupMapRuns, sumMapRuns, toMapRun } from "../handlers/runs.js";
import type { RunRow } from "../usage/data.js";

const I1 = "30000000-0000-4000-8000-000000000001";
const I2 = "30000000-0000-4000-8000-000000000002";

const row = (over: Partial<RunRow> = {}): RunRow => ({
  runId: "r1", agentId: "a1", agentName: "my-money-executor-1", agentModel: "claude-opus-5", status: "succeeded",
  createdAt: "2026-10-21T01:00:00Z", startedAt: "2026-10-21T01:00:00Z", finishedAt: "2026-10-21T01:12:00Z",
  usageJson: { model: "claude-sonnet-5", costUsd: 0.83, billingType: "subscription_included" }, modelUsage: null,
  ctxIssue: I1, ctxProject: null, ceIssue: null, costEventCount: 0, input: null, cached: null, output: null, cents: null,
  model: null, billingType: null,
  ...over,
});

describe("toMapRun", () => {
  it("lấy model và giá quy đổi từ usage_json", () => {
    expect(toMapRun(row())).toEqual({
      id: "r1", status: "succeeded", agentName: "my-money-executor-1", model: "claude-sonnet-5",
      createdAt: "2026-10-21T01:00:00.000Z", startedAt: "2026-10-21T01:00:00.000Z", finishedAt: "2026-10-21T01:12:00.000Z",
      costUsd: 0.83, billingType: "subscription_included",
    });
  });

  it("ưu tiên model và billing của cost_events", () => {
    const run = toMapRun(row({ costEventCount: 1, input: 1, cached: 0, output: 1, cents: 0, model: "claude-haiku-5", billingType: "api" }));
    expect(run).toMatchObject({ model: "claude-haiku-5", billingType: "api", costUsd: 0.83 });
  });

  it("không có costUsd thì lấy cost_cents > 0, không có gì thì null", () => {
    const cents = row({ usageJson: { model: "x" }, costEventCount: 1, input: 1, cached: 0, output: 1, cents: 125, model: "x", billingType: "api" });
    expect(toMapRun(cents).costUsd).toBe(1.25);
    const zero = row({ usageJson: { model: "x" }, costEventCount: 1, input: 1, cached: 0, output: 1, cents: 0, model: "x", billingType: "subscription_included" });
    expect(toMapRun(zero).costUsd).toBeNull();
    expect(toMapRun(row({ usageJson: null })).costUsd).toBeNull();
  });

  it("run chưa xong thiếu model dùng model của agent; run đã xong thiếu model để trống", () => {
    expect(toMapRun(row({ status: "running", finishedAt: null, usageJson: null })).model).toBe("claude-opus-5");
    expect(toMapRun(row({ status: "queued", startedAt: null, finishedAt: null, usageJson: null })).model).toBe("claude-opus-5");
    expect(toMapRun(row({ status: "failed", usageJson: null })).model).toBeNull();
  });
});

describe("groupMapRuns", () => {
  it("gom theo issue chủ, mới nhất trước, cắt danh sách nhưng tổng tính trên mọi run", () => {
    const rows = Array.from({ length: 25 }, (_, i) => row({
      runId: `r${String(i).padStart(2, "0")}`,
      startedAt: new Date(Date.UTC(2026, 9, 21, 1, i)).toISOString(),
      usageJson: { model: "claude-sonnet-5", costUsd: 0.1 },
    }));
    const out = groupMapRuns(rows, [I1]);
    const mine = out.byIssue[I1];
    expect(mine.count).toBe(25);
    expect(mine.runs).toHaveLength(20);
    expect(mine.runs[0].id).toBe("r24");
    expect(mine.costUsd).toBe(2.5);
    expect(mine.subscription).toBe(false);
  });

  it("chủ run là issue của cost_events trước context; issue ngoài tập bị bỏ; tổng cây cộng mọi issue", () => {
    const rows = [
      row({ runId: "a", ctxIssue: I1, usageJson: { costUsd: 1, billingType: "subscription_included" } }),
      row({ runId: "b", ctxIssue: I1, ceIssue: I2.toUpperCase(), costEventCount: 1, input: 1, cached: 0, output: 1, cents: 0,
        model: "claude-sonnet-5", billingType: "subscription_included", usageJson: { costUsd: 0.5 } }),
      row({ runId: "c", ctxIssue: "30000000-0000-4000-8000-000000000099", usageJson: { costUsd: 9 } }),
      row({ runId: "d", ctxIssue: I2, usageJson: null }),
    ];
    const out = groupMapRuns(rows, [I1, I2]);
    expect(out.byIssue[I1].runs.map((r) => r.id)).toEqual(["a"]);
    expect(out.byIssue[I2]).toMatchObject({ count: 2, costUsd: 0.5, subscription: true });
    expect(out.tree).toEqual({ count: 3, costUsd: 1.5, subscription: true });
  });

  it("không run nào có số liệu thì tổng tiền là null, không phải 0", () => {
    expect(sumMapRuns([])).toEqual({ count: 0, costUsd: null, subscription: false });
    expect(groupMapRuns([row({ usageJson: null })], [I1]).tree.costUsd).toBeNull();
  });
});

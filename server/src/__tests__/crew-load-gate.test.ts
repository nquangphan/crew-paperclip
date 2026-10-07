import type { Db } from "@paperclipai/db";
import { describe, expect, it } from "vitest";
import {
  type BeforeClaimDeps,
  type BeforeClaimInput,
  type HostProbe,
  createProbeCache,
  decideGate,
  evaluateBeforeClaim,
  parseLoadAvg,
  readLoadGateSettings,
} from "../crew/load-gate.ts";
import type { RetryProgress } from "../crew/retry-progress.ts";

const SETTINGS = { maxLoad1: 8, maxWaitMinutes: 60 };
// 06:00 UTC = 13:00 Asia/Ho_Chi_Minh, so a 60-minute deadline shows as 14:00.
const T0 = new Date("2026-10-06T06:00:00.000Z");

describe("readLoadGateSettings", () => {
  it("reads crewLoadGate from environment metadata", () => {
    expect(readLoadGateSettings({ crewLoadGate: { maxLoad1: 8, maxWaitMinutes: 30 } })).toEqual({ maxLoad1: 8, maxWaitMinutes: 30 });
    expect(readLoadGateSettings({ crewLoadGate: { maxLoad1: 8 } })).toEqual({ maxLoad1: 8, maxWaitMinutes: 60 });
  });

  it("turns the gate off for missing or invalid settings", () => {
    expect(readLoadGateSettings(null)).toBeNull();
    expect(readLoadGateSettings({})).toBeNull();
    expect(readLoadGateSettings({ crewLoadGate: { maxLoad1: 0 } })).toBeNull();
    expect(readLoadGateSettings({ crewLoadGate: { maxLoad1: 8, maxWaitMinutes: 0.5 } })).toBeNull();
  });
});

describe("parseLoadAvg", () => {
  it("parses macOS sysctl vm.loadavg output", () => {
    expect(parseLoadAvg("{ 1.68 1.69 1.61 }\n")).toBe(1.68);
    expect(parseLoadAvg("")).toBeNull();
  });
});

describe("createProbeCache", () => {
  it("shares one in-flight probe and reuses the result within the TTL", async () => {
    let now = 0;
    let calls = 0;
    const cache = createProbeCache(15_000, () => now);
    const probe = async (): Promise<HostProbe> => {
      calls += 1;
      return { ok: true, load1: 1 };
    };
    await Promise.all([cache.get("env-1", probe), cache.get("env-1", probe)]);
    now = 14_000;
    await cache.get("env-1", probe);
    expect(calls).toBe(1);
    now = 30_000;
    await cache.get("env-1", probe);
    expect(calls).toBe(2);
  });

  it("caches failures too, so an offline Mac costs one probe per TTL", async () => {
    let calls = 0;
    const cache = createProbeCache(15_000, () => 0);
    const probe = async (): Promise<HostProbe> => {
      calls += 1;
      return { ok: false, error: "timeout" };
    };
    await cache.get("env-1", probe);
    await cache.get("env-1", probe);
    expect(calls).toBe(1);
  });
});

describe("decideGate", () => {
  it("claims when the load is at or below the threshold", () => {
    expect(decideGate({ settings: SETTINGS, probe: { ok: true, load1: 8 }, waitingSince: T0, now: T0 })).toEqual({ action: "claim" });
  });

  it("waits while overloaded or unreachable before the deadline", () => {
    expect(decideGate({ settings: SETTINGS, probe: { ok: true, load1: 9.5 }, waitingSince: T0, now: T0 })).toMatchObject({
      action: "wait",
      reason: "overloaded",
    });
    expect(decideGate({ settings: SETTINGS, probe: { ok: false, error: "timeout" }, waitingSince: T0, now: T0 })).toMatchObject({
      action: "wait",
      reason: "unreachable",
    });
  });

  it("expires once maxWaitMinutes has passed", () => {
    const now = new Date(T0.getTime() + 60 * 60_000);
    expect(decideGate({ settings: SETTINGS, probe: { ok: false, error: "x" }, waitingSince: T0, now })).toMatchObject({
      action: "expire",
      reason: "unreachable",
    });
  });
});

function run(overrides: Record<string, unknown> = {}): BeforeClaimInput["run"] {
  return {
    id: "run-1",
    companyId: "company-1",
    agentId: "agent-1",
    status: "queued",
    createdAt: T0,
    contextSnapshot: { issueId: "issue-1" },
    ...overrides,
  } as unknown as BeforeClaimInput["run"];
}

type Notices = Partial<Record<"waiting" | "expired" | "waiting_comment" | "expired_comment", Date>>;

function harness(probe: HostProbe, now: Date, notices: Notices = {}, failComment = false) {
  const events: string[] = [];
  const deps: BeforeClaimDeps = {
    loadTarget: async () => ({ environmentId: "env-1", environmentName: "mac-mini", settings: SETTINGS }),
    probeHost: async () => probe,
    firstNoticeAt: async (_runId, kind) => notices[kind] ?? null,
    recordNotice: async (n) => {
      events.push(`mark:${n.kind}`);
      notices[n.kind] = now;
    },
    postComment: async (n) => {
      if (failComment) throw new Error("comment store down");
      events.push(`${n.kind}:${n.issueId}:${n.body}`);
      notices[`${n.kind}_comment`] = now;
    },
    scheduleCancel: (runId, reason) => {
      events.push(`cancel:${runId}:${reason}`);
    },
    blockIssue: async (issueId) => {
      events.push(`blocked:${issueId}`);
    },
    now: () => now,
    retryChecked: async () => true,
    checkRetryProgress: async () => ({ kind: "none" }),
    recordRetryProgress: async () => {},
  };
  const input: BeforeClaimInput = { db: {} as Db, run: run() };
  return { deps, input, events, notices };
}

function retryHarness(progress: RetryProgress, opts: { checked?: boolean; failRecord?: boolean } = {}) {
  const h = harness({ ok: true, load1: 1 }, T0);
  const recorded: RetryProgress[] = [];
  const checks: string[] = [];
  h.deps.retryChecked = async () => opts.checked ?? false;
  h.deps.checkRetryProgress = async (r) => {
    checks.push(r.id);
    return progress;
  };
  h.deps.recordRetryProgress = async (_run, _issueId, p) => {
    if (opts.failRecord) throw new Error("comment store down");
    recorded.push(p);
  };
  h.input.run = run({ retryOfRunId: "prev-1" });
  return { ...h, recorded, checks };
}

describe("evaluateBeforeClaim", () => {
  it("lets a healthy host claim without notices", async () => {
    const h = harness({ ok: true, load1: 1.7 }, T0);
    expect(await evaluateBeforeClaim(h.input, h.deps)).toBe(false);
    expect(h.events).toEqual([]);
  });

  it("keeps the run queued, records the waiting marker, then posts one waiting comment with the reason and deadline", async () => {
    const h = harness({ ok: true, load1: 9.5 }, T0);
    expect(await evaluateBeforeClaim(h.input, h.deps)).toBe(true);
    expect(h.events).toHaveLength(2);
    expect(h.events[0]).toBe("mark:waiting");
    expect(h.events[1]).toMatch(/^waiting:issue-1:.*mac-mini.*9\.5.*8/);
    expect(h.events[1]).toContain("14:00");
  });

  it("does not repeat the waiting notice", async () => {
    const h = harness({ ok: false, error: "timeout" }, T0, { waiting: T0, waiting_comment: T0 });
    expect(await evaluateBeforeClaim(h.input, h.deps)).toBe(true);
    expect(h.events).toEqual([]);
  });

  it("counts the deadline from the first waiting notice, not from run creation", async () => {
    // The run was queued 70 minutes ago (behind a long run or a scheduled retry) and is blocked now for the first time.
    const now = new Date(T0.getTime() + 70 * 60_000);
    const h = harness({ ok: false, error: "timeout" }, now);
    expect(await evaluateBeforeClaim(h.input, h.deps)).toBe(true);
    expect(h.events).toHaveLength(2);
    expect(h.events[0]).toBe("mark:waiting");
    expect(h.events[1]).toMatch(/^waiting:issue-1:/);
    expect(h.events[1]).toContain("15:10");
  });

  it("after maxWaitMinutes schedules the cancel, records the expiry, blocks the issue and comments, keeping the run queued", async () => {
    const h = harness({ ok: false, error: "timeout" }, new Date(T0.getTime() + 61 * 60_000), { waiting: T0 });
    expect(await evaluateBeforeClaim(h.input, h.deps)).toBe(true);
    expect(h.events[0]).toMatch(/^cancel:run-1:Crew: hết 60 phút chờ máy mac-mini/);
    expect(h.events[1]).toBe("mark:expired");
    expect(h.events[2]).toBe("blocked:issue-1");
    expect(h.events[3]).toMatch(/^expired:issue-1:/);
    expect(h.events).toHaveLength(4);
  });

  it("only retries the cancel once the expiry was already handled", async () => {
    const later = new Date(T0.getTime() + 62 * 60_000);
    const expired = new Date(T0.getTime() + 61 * 60_000);
    const h = harness({ ok: false, error: "timeout" }, later, { waiting: T0, expired, expired_comment: expired });
    expect(await evaluateBeforeClaim(h.input, h.deps)).toBe(true);
    expect(h.events).toHaveLength(1);
    expect(h.events[0]).toMatch(/^cancel:run-1:/);
  });

  it("stays closed after expiry even if the host is healthy again", async () => {
    const later = new Date(T0.getTime() + 62 * 60_000);
    const expired = new Date(T0.getTime() + 61 * 60_000);
    const h = harness({ ok: true, load1: 1 }, later, { waiting: T0, expired, expired_comment: expired });
    expect(await evaluateBeforeClaim(h.input, h.deps)).toBe(true);
    expect(h.events[0]).toMatch(/^cancel:run-1:/);
  });

  it("keeps the run queued when writing the waiting comment fails", async () => {
    const h = harness({ ok: false, error: "timeout" }, T0, {}, true);
    expect(await evaluateBeforeClaim(h.input, h.deps)).toBe(true);
    expect(h.events).toEqual(["mark:waiting"]);
  });

  it("keeps the run queued when writing the waiting marker fails", async () => {
    const h = harness({ ok: false, error: "timeout" }, T0);
    const deps = { ...h.deps, recordNotice: async () => { throw new Error("db down"); } };
    expect(await evaluateBeforeClaim(h.input, deps)).toBe(true);
  });

  it("records the waiting marker before the comment: a comment that keeps failing still expires on time", async () => {
    const notices: Notices = {};
    const first = harness({ ok: false, error: "timeout" }, T0, notices, true);
    expect(await evaluateBeforeClaim(first.input, first.deps)).toBe(true);
    expect(first.events).toEqual(["mark:waiting"]);
    const later = harness({ ok: false, error: "timeout" }, new Date(T0.getTime() + 61 * 60_000), notices, true);
    expect(await evaluateBeforeClaim(later.input, later.deps)).toBe(true);
    expect(later.events.some((e) => e.startsWith("cancel:run-1:"))).toBe(true);
    expect(later.events).toContain("blocked:issue-1");
  });

  it("retries a failed waiting comment on the next tick without moving the marker", async () => {
    const notices: Notices = { waiting: T0 };
    const h = harness({ ok: false, error: "timeout" }, new Date(T0.getTime() + 60_000), notices);
    expect(await evaluateBeforeClaim(h.input, h.deps)).toBe(true);
    expect(h.events).toHaveLength(1);
    expect(h.events[0]).toMatch(/^waiting:issue-1:/);
    expect(notices.waiting).toEqual(T0);
  });

  it("retries a failed expiry comment while retrying the cancel", async () => {
    const later = new Date(T0.getTime() + 62 * 60_000);
    const h = harness({ ok: false, error: "timeout" }, later, { waiting: T0, expired: new Date(T0.getTime() + 61 * 60_000) });
    expect(await evaluateBeforeClaim(h.input, h.deps)).toBe(true);
    expect(h.events).toHaveLength(2);
    expect(h.events[0]).toMatch(/^cancel:run-1:/);
    expect(h.events[1]).toMatch(/^expired:issue-1:.*quá 60 phút/);
    expect(h.events[1]).not.toContain("()");
  });

  it("still schedules the cancel and keeps the run queued when blocking or the notice fails after expiry", async () => {
    const h = harness({ ok: false, error: "timeout" }, new Date(T0.getTime() + 61 * 60_000), { waiting: T0 });
    const deps = {
      ...h.deps,
      blockIssue: async () => { throw new Error("issue locked"); },
      recordNotice: async () => { throw new Error("db down"); },
      postComment: async () => { throw new Error("db down"); },
    };
    expect(await evaluateBeforeClaim(h.input, deps)).toBe(true);
    expect(h.events).toHaveLength(1);
    expect(h.events[0]).toMatch(/^cancel:run-1:/);
  });

  it("is a no-op for runs that are not queued or have no gated environment", async () => {
    const h = harness({ ok: false, error: "x" }, T0);
    expect(await evaluateBeforeClaim({ ...h.input, run: run({ status: "running" }) }, h.deps)).toBe(false);
    expect(await evaluateBeforeClaim(h.input, { ...h.deps, loadTarget: async () => null })).toBe(false);
    expect(h.events).toEqual([]);
  });
});

describe("evaluateBeforeClaim on a retried run", () => {
  it("records the previous run's commits, then lets the retry claim", async () => {
    const progress: RetryProgress = {
      kind: "checked",
      previousRunId: "prev-1",
      previousStartedAt: T0,
      cwd: "/w",
      commits: [{ sha: "c".repeat(40), committedAt: "x", subject: "s" }],
    };
    const h = retryHarness(progress);
    expect(await evaluateBeforeClaim(h.input, h.deps)).toBe(false);
    expect(h.recorded).toEqual([progress]);
    expect(h.events).toEqual([]);
  });

  it("does not check over SSH again once the retry was checked", async () => {
    const h = retryHarness({ kind: "error", error: "must not be called" }, { checked: true });
    expect(await evaluateBeforeClaim(h.input, h.deps)).toBe(false);
    expect(h.checks).toEqual([]);
    expect(h.recorded).toEqual([]);
  });

  it("holds the run and records the waiting marker when git fails on the Mac", async () => {
    const h = retryHarness({ kind: "error", error: "fatal: cannot change to '/w'" });
    expect(await evaluateBeforeClaim(h.input, h.deps)).toBe(true);
    expect(h.events[0]).toBe("mark:waiting");
    expect(h.events[1]).toMatch(/kiểm tiến độ/);
    expect(h.recorded).toEqual([]);
  });

  it("expires a retry whose progress check keeps failing past maxWaitMinutes", async () => {
    const h = retryHarness({ kind: "error", error: "fatal: not a git repository" });
    h.notices.waiting = T0;
    h.notices.waiting_comment = T0;
    h.deps.now = () => new Date(T0.getTime() + 61 * 60_000);
    expect(await evaluateBeforeClaim(h.input, h.deps)).toBe(true);
    expect(h.events[0]).toMatch(/^cancel:run-1:.*kiểm tiến độ/);
    expect(h.events).toContain("mark:expired");
    expect(h.events).toContain("blocked:issue-1");
  });

  it("holds the run to retry when writing the progress comment fails", async () => {
    const h = retryHarness(
      { kind: "checked", previousRunId: "prev-1", previousStartedAt: T0, cwd: "/w", commits: [] },
      { failRecord: true },
    );
    expect(await evaluateBeforeClaim(h.input, h.deps)).toBe(true);
    expect(h.events[0]).toBe("mark:waiting");
  });

  it("does not check progress for a run that is not a retry", async () => {
    const h = retryHarness({ kind: "error", error: "x" });
    h.input.run = run();
    expect(await evaluateBeforeClaim(h.input, h.deps)).toBe(false);
    expect(h.checks).toEqual([]);
  });
});

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

type Notices = { waiting?: Date; expired?: Date };

function harness(probe: HostProbe, now: Date, notices: Notices = {}) {
  const events: string[] = [];
  const deps: BeforeClaimDeps = {
    loadTarget: async () => ({ environmentId: "env-1", environmentName: "mac-mini", settings: SETTINGS }),
    probeHost: async () => probe,
    firstNoticeAt: async (_runId, kind) => notices[kind] ?? null,
    postNotice: async (n) => {
      events.push(`${n.kind}:${n.issueId ?? "-"}:${n.body}`);
    },
    scheduleCancel: (runId, reason) => {
      events.push(`cancel:${runId}:${reason}`);
    },
    blockIssue: async (issueId) => {
      events.push(`blocked:${issueId}`);
    },
    now: () => now,
  };
  const input: BeforeClaimInput = { db: {} as Db, run: run() };
  return { deps, input, events };
}

describe("evaluateBeforeClaim", () => {
  it("lets a healthy host claim without notices", async () => {
    const h = harness({ ok: true, load1: 1.7 }, T0);
    expect(await evaluateBeforeClaim(h.input, h.deps)).toBe(false);
    expect(h.events).toEqual([]);
  });

  it("keeps the run queued and posts one waiting notice with the reason and deadline", async () => {
    const h = harness({ ok: true, load1: 9.5 }, T0);
    expect(await evaluateBeforeClaim(h.input, h.deps)).toBe(true);
    expect(h.events).toHaveLength(1);
    expect(h.events[0]).toMatch(/^waiting:issue-1:.*mac-mini.*9\.5.*8/);
    expect(h.events[0]).toContain("14:00");
  });

  it("does not repeat the waiting notice", async () => {
    const h = harness({ ok: false, error: "timeout" }, T0, { waiting: T0 });
    expect(await evaluateBeforeClaim(h.input, h.deps)).toBe(true);
    expect(h.events).toEqual([]);
  });

  it("counts the deadline from the first waiting notice, not from run creation", async () => {
    // The run was queued 70 minutes ago (behind a long run or a scheduled retry) and is blocked now for the first time.
    const now = new Date(T0.getTime() + 70 * 60_000);
    const h = harness({ ok: false, error: "timeout" }, now);
    expect(await evaluateBeforeClaim(h.input, h.deps)).toBe(true);
    expect(h.events).toHaveLength(1);
    expect(h.events[0]).toMatch(/^waiting:issue-1:/);
    expect(h.events[0]).toContain("15:10");
  });

  it("after maxWaitMinutes blocks the issue, posts the notice, keeps the run queued and schedules the cancel", async () => {
    const h = harness({ ok: false, error: "timeout" }, new Date(T0.getTime() + 61 * 60_000), { waiting: T0 });
    expect(await evaluateBeforeClaim(h.input, h.deps)).toBe(true);
    expect(h.events[0]).toBe("blocked:issue-1");
    expect(h.events[1]).toMatch(/^expired:issue-1:/);
    expect(h.events[2]).toMatch(/^cancel:run-1:Crew: hết 60 phút chờ máy mac-mini/);
    expect(h.events).toHaveLength(3);
  });

  it("only retries the cancel once the expiry was already handled", async () => {
    const later = new Date(T0.getTime() + 62 * 60_000);
    const h = harness({ ok: false, error: "timeout" }, later, { waiting: T0, expired: new Date(T0.getTime() + 61 * 60_000) });
    expect(await evaluateBeforeClaim(h.input, h.deps)).toBe(true);
    expect(h.events).toHaveLength(1);
    expect(h.events[0]).toMatch(/^cancel:run-1:/);
  });

  it("stays closed after expiry even if the host is healthy again", async () => {
    const later = new Date(T0.getTime() + 62 * 60_000);
    const h = harness({ ok: true, load1: 1 }, later, { waiting: T0, expired: new Date(T0.getTime() + 61 * 60_000) });
    expect(await evaluateBeforeClaim(h.input, h.deps)).toBe(true);
    expect(h.events[0]).toMatch(/^cancel:run-1:/);
  });

  it("is a no-op for runs that are not queued or have no gated environment", async () => {
    const h = harness({ ok: false, error: "x" }, T0);
    expect(await evaluateBeforeClaim({ ...h.input, run: run({ status: "running" }) }, h.deps)).toBe(false);
    expect(await evaluateBeforeClaim(h.input, { ...h.deps, loadTarget: async () => null })).toBe(false);
    expect(h.events).toEqual([]);
  });
});

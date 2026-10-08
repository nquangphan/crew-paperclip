import { afterEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@paperclipai/db";
import type { Environment, EnvironmentLease } from "@paperclipai/shared";

const { releaseLease } = vi.hoisted(() => ({
  releaseLease: vi.fn(async (id: string, status: string) => ({ id, status })),
}));

vi.mock("../services/environments.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/environments.ts")>()),
  environmentService: () => ({ releaseLease }),
}));

const { gateCalls } = vi.hoisted(() => ({ gateCalls: [] as unknown[] }));
vi.mock("../crew/issue-gate.ts", () => ({
  crewBeforeIssueWrite: async (input: unknown) => {
    gateCalls.push(input);
  },
}));

import { environmentRuntimeService } from "../services/environment-runtime.ts";
import {
  CREW_RUN_LEASE_RELEASE_HOOK_TIMEOUT_MS,
  crewCoreHooks,
  overrideCrewCoreHooksForTests,
} from "../crew/core-hooks.ts";

let restore: (() => void) | null = null;

afterEach(() => {
  restore?.();
  restore = null;
  vi.clearAllMocks();
});

const environment = { id: "env-1", driver: "ssh", metadata: null } as unknown as Environment;
const lease = { id: "lease-1", companyId: "company-1", provider: "ssh" } as unknown as EnvironmentLease;

const db = { fixture: "db" } as unknown as Db;

function sshDriver() {
  const driver = environmentRuntimeService(db).getDriver("ssh");
  if (!driver) throw new Error("ssh driver missing");
  return driver;
}

describe("crewCoreHooks mặc định", () => {
  it("mặc định không giữ run nào", async () => {
    await expect(
      crewCoreHooks.beforeClaim({ db: {} as Db, run: { id: "run-1", status: "queued" } as never }),
    ).resolves.toBe(false);
    await expect(
      crewCoreHooks.onRunLeaseReleased({ db: {} as Db, environment, lease, status: "released" }),
    ).resolves.toBeUndefined();
  });

  it("override trong test rồi khôi phục được", async () => {
    restore = overrideCrewCoreHooksForTests({ beforeClaim: async () => true });
    await expect(crewCoreHooks.beforeClaim({ db: {} as Db, run: { id: "run-1" } as never })).resolves.toBe(true);
    restore();
    restore = null;
    await expect(crewCoreHooks.beforeClaim({ db: {} as Db, run: { id: "run-1" } as never })).resolves.toBe(false);
  });
});

describe("H2 registry", () => {
  it("chuyển nguyên input cho crewBeforeIssueWrite", async () => {
    const input = {
      tx: {} as Db,
      issueId: "issue-1",
      existing: { id: "issue-1" } as never,
      patch: { status: "done" as const },
      actorAgentId: "agent-1",
      actorUserId: null,
    };
    await crewCoreHooks.beforeIssueWrite(input);
    expect(gateCalls).toEqual([input]);
  });
});

describe("agent mutation registry", () => {
  it("chuyển nguyên input và truyền lỗi guard về router", async () => {
    const blocked = new Error("config blocked");
    const guard = vi.fn(async () => { throw blocked; });
    restore = overrideCrewCoreHooksForTests({ beforeAgentMutation: guard });
    const input = {
      db,
      req: { actor: { type: "agent" }, method: "PATCH", path: "/agents/agent-1" } as never,
      resolveAgentId: async (_req: unknown, reference: string) => reference,
    };
    await expect(crewCoreHooks.beforeAgentMutation(input)).rejects.toBe(blocked);
    expect(guard).toHaveBeenCalledWith(input);
  });

  it("board bỏ qua guard mặc định trước khi đọc DB", async () => {
    await expect(crewCoreHooks.beforeAgentMutation({
      db,
      req: { actor: { type: "board" }, method: "PATCH", path: "/agents/agent-1" } as never,
      resolveAgentId: async () => { throw new Error("unexpected lookup"); },
    })).resolves.toBeUndefined();
  });
});

describe("H3 trong SSH driver", () => {
  it("gọi onRunLeaseReleased với db của driver và nguyên input trước khi trả lease", async () => {
    const order: string[] = [];
    const seen: unknown[] = [];
    restore = overrideCrewCoreHooksForTests({
      onRunLeaseReleased: async (input) => {
        order.push("hook");
        seen.push(input);
      },
    });
    releaseLease.mockImplementationOnce(async (id: string, status: string) => {
      order.push("release");
      return { id, status };
    });
    const input = { environment, lease, status: "failed" as const, cancelActiveWork: true };

    await sshDriver().releaseRunLease(input);

    expect(order).toEqual(["hook", "release"]);
    expect(seen[0]).toEqual({ db, ...input });
    expect((seen[0] as { db: Db }).db).toBe(db);
    expect(releaseLease).toHaveBeenCalledWith("lease-1", "failed");
  });

  it("vẫn trả lease khi implementation ném lỗi", async () => {
    restore = overrideCrewCoreHooksForTests({
      onRunLeaseReleased: async () => {
        throw new Error("ssh timeout");
      },
    });

    await expect(sshDriver().releaseRunLease({ environment, lease, status: "expired" })).resolves.toEqual({
      id: "lease-1",
      status: "expired",
    });
    expect(releaseLease).toHaveBeenCalledWith("lease-1", "expired");
  });

  it("vẫn trả lease khi implementation treo quá thời hạn", async () => {
    vi.useFakeTimers();
    try {
      restore = overrideCrewCoreHooksForTests({
        onRunLeaseReleased: () => new Promise<void>(() => {}),
      });

      const pending = sshDriver().releaseRunLease({ environment, lease, status: "failed", cancelActiveWork: true });
      await vi.advanceTimersByTimeAsync(CREW_RUN_LEASE_RELEASE_HOOK_TIMEOUT_MS - 1);
      expect(releaseLease).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      await expect(pending).resolves.toEqual({ id: "lease-1", status: "failed" });
      expect(releaseLease).toHaveBeenCalledWith("lease-1", "failed");
    } finally {
      vi.useRealTimers();
    }
  });

  it("thời hạn chờ hook là 15 giây", () => {
    expect(CREW_RUN_LEASE_RELEASE_HOOK_TIMEOUT_MS).toBe(15_000);
  });
});

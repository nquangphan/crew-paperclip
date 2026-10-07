import { afterEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@paperclipai/db";
import type { Environment, EnvironmentLease } from "@paperclipai/shared";

// Order of a lease release on the SSH driver: the lease must be marked released before the remote stop
// finishes, otherwise stock admission (getConversationOwnershipBlocker) sees a held lease and skips the
// wake of the next stage participant.
const { events, releaseLease, runSsh, activities } = vi.hoisted(() => {
  const events: string[] = [];
  return {
    events,
    activities: [] as Record<string, unknown>[],
    releaseLease: vi.fn(async (id: string, status: string) => {
      events.push("release");
      return { id, status };
    }),
    runSsh: vi.fn(),
  };
});

vi.mock("../services/environments.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/environments.ts")>()),
  environmentService: () => ({ releaseLease }),
}));
vi.mock("../services/environment-config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/environment-config.js")>()),
  resolveEnvironmentDriverConfigForRuntime: async () => ({ driver: "ssh", config: { host: "mac.example.test" } }),
}));
vi.mock("@paperclipai/adapter-utils/ssh", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@paperclipai/adapter-utils/ssh")>()),
  runSshCommand: runSsh,
}));
vi.mock("../services/activity-log.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/activity-log.js")>()),
  logActivity: async (_db: unknown, entry: Record<string, unknown>) => {
    if (entry.action === "crew.remote_stop.started") events.push("started");
    activities.push(entry);
  },
}));

import { environmentRuntimeService } from "../services/environment-runtime.ts";
import {
  REMOTE_STOP_BACKGROUND_LIMIT_MS,
  isRemoteStopPending,
  settleRemoteStopsForTests,
} from "../crew/remote-stop.ts";

const RUN = "33333333-3333-4333-8333-333333333333";
const environment = { id: "env-stop-1", driver: "ssh", metadata: null } as unknown as Environment;
const lease = {
  id: "lease-1",
  companyId: "company-1",
  issueId: null,
  heartbeatRunId: RUN,
  provider: "ssh",
  metadata: { remoteCwd: "/Users/a/crew-agents/mac-claude" },
} as unknown as EnvironmentLease;
const db = { fixture: "db" } as unknown as Db;

function sshDriver() {
  const driver = environmentRuntimeService(db).getDriver("ssh");
  if (!driver) throw new Error("ssh driver missing");
  return driver;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

afterEach(async () => {
  await settleRemoteStopsForTests();
  events.length = 0;
  activities.length = 0;
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("H3 dừng run sau khi lease đã nhả", () => {
  it("nhả lease trước khi lệnh dừng qua SSH xong, rồi mới ghi kết quả dừng", async () => {
    const ssh = deferred<{ stdout: string }>();
    runSsh.mockImplementation(() => {
      events.push("ssh-start");
      return ssh.promise;
    });

    await sshDriver().releaseRunLease({ environment, lease, status: "failed", cancelActiveWork: true });

    expect(events).toContain("release");
    expect(events).not.toContain("ssh-end");
    // The durable "stop in progress" marker is written before the SSH call and before the lease is released.
    expect(activities[0]).toMatchObject({
      action: "crew.remote_stop.started",
      runId: RUN,
      details: { environmentId: environment.id, runId: RUN },
    });
    expect(events.indexOf("started")).toBeLessThan(events.indexOf("release"));
    await vi.waitFor(() => expect(events).toContain("ssh-start"));
    expect(isRemoteStopPending(environment.id)).toBe(true);

    ssh.resolve({ stdout: "crew-stop matched=2 killed=0 remaining=0\n" });
    await vi.waitFor(() => expect(isRemoteStopPending(environment.id)).toBe(false));
    events.push("ssh-end");
    expect(events.indexOf("release")).toBeLessThan(events.indexOf("ssh-end"));
    expect(activities.slice(1)).toEqual([
      expect.objectContaining({ action: "crew.remote_stop", runId: RUN, details: expect.objectContaining({ outcome: "stopped", matched: 2, environmentId: environment.id }) }),
    ]);
  });

  it("ghi kết quả cả khi không còn process nào để dừng, để dấu đang dừng trong DB được đóng", async () => {
    runSsh.mockResolvedValue({ stdout: "crew-stop matched=0 killed=0 remaining=0 via=fallback\n" });
    await sshDriver().releaseRunLease({ environment, lease, status: "released" });
    await settleRemoteStopsForTests();
    expect(activities.map((a) => a.action)).toEqual(["crew.remote_stop.started", "crew.remote_stop"]);
  });

  it("SSH lỗi thì ghi activity unreachable và bỏ dấu đang dừng", async () => {
    runSsh.mockRejectedValue(Object.assign(new Error("ssh: connect timed out"), { code: 255 }));

    await sshDriver().releaseRunLease({ environment, lease, status: "failed" });

    expect(releaseLease).toHaveBeenCalledWith("lease-1", "failed");
    await vi.waitFor(() => expect(isRemoteStopPending(environment.id)).toBe(false));
    expect(activities.slice(1)).toEqual([
      expect.objectContaining({ action: "crew.remote_stop", details: expect.objectContaining({ outcome: "unreachable" }) }),
    ]);
  });

  it("lệnh dừng treo quá giới hạn thì bỏ dấu đang dừng và ghi activity hết giờ", async () => {
    vi.useFakeTimers();
    runSsh.mockImplementation(() => new Promise(() => {}));

    await sshDriver().releaseRunLease({ environment, lease, status: "failed" });
    await vi.advanceTimersByTimeAsync(REMOTE_STOP_BACKGROUND_LIMIT_MS - 1);
    expect(isRemoteStopPending(environment.id)).toBe(true);

    await vi.advanceTimersByTimeAsync(1);
    expect(isRemoteStopPending(environment.id)).toBe(false);
    expect(activities.slice(1)).toEqual([
      expect.objectContaining({
        action: "crew.remote_stop",
        details: expect.objectContaining({ outcome: "unreachable", error: expect.stringMatching(/20 giây/) }),
      }),
    ]);
  });

  it("giới hạn dừng nền dưới 30 giây hủy run", () => {
    expect(REMOTE_STOP_BACKGROUND_LIMIT_MS).toBe(20_000);
  });

  it("lease không gắn run thì không đánh dấu đang dừng", async () => {
    await sshDriver().releaseRunLease({ environment, lease: { ...lease, heartbeatRunId: null }, status: "released" });
    expect(isRemoteStopPending(environment.id)).toBe(false);
    expect(runSsh).not.toHaveBeenCalled();
  });
});

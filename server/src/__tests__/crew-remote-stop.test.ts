import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import type { Db } from "@paperclipai/db";
import { afterEach, describe, expect, it } from "vitest";
import { CREW_RUN_LEASE_RELEASE_HOOK_TIMEOUT_MS } from "../crew/core-hooks.ts";
import {
  CREW_REMOTE_STOP_SCRIPT,
  REMOTE_STOP_TIMEOUT_MS,
  buildRemoteStopCommand,
  parseRemoteStopOutput,
  stopRemoteRunOnRelease,
  type RunLeaseReleasedInput,
} from "../crew/remote-stop.ts";

// Fixture copy of the crew-mac wrapper (apps/crew-mac/assets/crew-claude-run.sh in the Crew repo).
const WRAPPER = fileURLToPath(new URL("./fixtures/crew-claude-run.sh", import.meta.url));
const RUN_A = "11111111-2222-4333-8444-555555555555";
const RUN_B = "99999999-2222-4333-8444-555555555555";
const roots: string[] = [];
const groups: number[] = [];

function newRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "crew-stop-"));
  roots.push(root);
  return root;
}

/** Starts the wrapper the way the SSH session does: own process group, cwd = worktree. */
function startViaWrapper(root: string, runId: string, shellBody: string): number {
  const child = spawn("/bin/sh", [WRAPPER, "-c", shellBody], {
    cwd: root,
    env: { ...process.env, PAPERCLIP_RUN_ID: runId, CREW_CLAUDE_BIN: "/bin/sh" },
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  groups.push(child.pid as number);
  return child.pid as number;
}

function groupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch {
    return false;
  }
}

/** HOME without ~/.crew/bin/crew-mac, so the script takes its built-in fallback path. */
const NO_LAUNCHER_HOME = mkdtempSync(path.join(tmpdir(), "crew-home-empty-"));

function runScript(runId: string, root: string, home = NO_LAUNCHER_HOME): string {
  return execFileSync("/bin/sh", ["-c", CREW_REMOTE_STOP_SCRIPT, "crew-stop", runId, root], {
    encoding: "utf8",
    env: { ...process.env, HOME: home },
  });
}

/** HOME with a stub crew-mac launcher that records its arguments and answers like stop-run. */
function homeWithLauncher(stdout: string, exitCode: number): { home: string; argsFile: string } {
  const home = newRoot();
  const bin = path.join(home, ".crew", "bin");
  mkdirSync(bin, { recursive: true });
  const argsFile = path.join(home, "args.txt");
  writeFileSync(
    path.join(bin, "crew-mac"),
    `#!/bin/sh\nprintf '%s\\n' "$@" > ${JSON.stringify(argsFile)}\n${stdout ? `echo ${JSON.stringify(stdout)}\n` : ""}echo "stub stderr" >&2\nexit ${exitCode}\n`,
    { mode: 0o755 },
  );
  return { home, argsFile };
}

afterEach(() => {
  for (const pgid of groups.splice(0)) {
    try {
      process.kill(-pgid, "SIGKILL");
    } catch {}
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe.skipIf(process.platform !== "darwin")("crew-claude-run wrapper and stop script on macOS", () => {
  it("records the process group and start time before becoming the agent", async () => {
    const root = newRoot();
    const pgid = startViaWrapper(root, RUN_A, "exec sleep 301");
    await sleep(400);
    const dir = path.join(root, ".paperclip-runtime", "runs", RUN_A);
    expect(readFileSync(path.join(dir, "pgid"), "utf8").trim()).toBe(String(pgid));
    const started = Number(readFileSync(path.join(dir, "started"), "utf8").trim());
    expect(Math.abs(started - Math.floor(Date.now() / 1000))).toBeLessThan(5);
  });

  it("writes nothing when PAPERCLIP_RUN_ID is malformed", () => {
    const root = newRoot();
    execFileSync("/bin/sh", [WRAPPER, "-c", "true"], {
      cwd: root,
      env: { ...process.env, PAPERCLIP_RUN_ID: "../../etc", CREW_CLAUDE_BIN: "/bin/sh" },
    });
    expect(existsSync(path.join(root, ".paperclip-runtime"))).toBe(false);
  });

  it("stops the recorded process group even when ps cannot read its environment", async () => {
    const root = newRoot();
    const pgid = startViaWrapper(root, RUN_A, "sleep 300 & exec sleep 301");
    await sleep(400);
    expect(parseRemoteStopOutput(runScript(RUN_A, root))).toEqual({ matched: 2, killed: 0, remaining: 0, via: "fallback" });
    await sleep(300);
    expect(groupAlive(pgid)).toBe(false);
    expect(existsSync(path.join(root, ".paperclip-runtime", "runs", RUN_A))).toBe(false);
  });

  it("escalates to KILL when the group ignores TERM", async () => {
    const root = newRoot();
    const pgid = startViaWrapper(root, RUN_A, 'trap "" TERM; sleep 300 & sleep 301 & wait');
    await sleep(400);
    const out = parseRemoteStopOutput(runScript(RUN_A, root));
    expect(out?.killed).toBeGreaterThan(0);
    expect(out?.remaining).toBe(0);
    await sleep(300);
    expect(groupAlive(pgid)).toBe(false);
  }, 20_000);

  it("finds a node process by its PAPERCLIP_RUN_ID token when no pgid file exists", async () => {
    const root = newRoot();
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      env: { ...process.env, PAPERCLIP_RUN_ID: RUN_A },
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    groups.push(child.pid as number);
    await sleep(400);
    expect(parseRemoteStopOutput(runScript(RUN_A, root))).toEqual({ matched: 1, killed: 0, remaining: 0, via: "fallback" });
    await sleep(300);
    expect(groupAlive(child.pid as number)).toBe(false);
  });

  it("does not touch another run's group", async () => {
    const root = newRoot();
    const other = startViaWrapper(root, RUN_B, "exec sleep 301");
    await sleep(400);
    expect(parseRemoteStopOutput(runScript(RUN_A, root))).toEqual({ matched: 0, killed: 0, remaining: 0, via: "fallback" });
    expect(groupAlive(other)).toBe(true);
  });

  it("ignores a recorded group whose processes predate the run", async () => {
    const root = newRoot();
    const unrelated = startViaWrapper(root, RUN_B, "exec sleep 301");
    await sleep(400);
    const dir = path.join(root, ".paperclip-runtime", "runs", RUN_A);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "pgid"), `${unrelated}\n`);
    writeFileSync(path.join(dir, "started"), `${Math.floor(Date.now() / 1000) + 120}\n`);
    expect(parseRemoteStopOutput(runScript(RUN_A, root))).toEqual({ matched: 0, killed: 0, remaining: 0, via: "fallback" });
    expect(groupAlive(unrelated)).toBe(true);
  });

  it("ignores a recorded group whose leader started after the run (PGID reused later)", async () => {
    const root = newRoot();
    // An unrelated owner app that happens to get the recorded PGID after the run started.
    const reused = startViaWrapper(root, RUN_B, "sleep 300 & exec sleep 301");
    await sleep(400);
    const dir = path.join(root, ".paperclip-runtime", "runs", RUN_A);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "pgid"), `${reused}\n`);
    writeFileSync(path.join(dir, "started"), `${Math.floor(Date.now() / 1000) - 600}\n`);
    expect(parseRemoteStopOutput(runScript(RUN_A, root))).toEqual({ matched: 0, killed: 0, remaining: 0, via: "fallback" });
    expect(groupAlive(reused)).toBe(true);
  });
});

describe.skipIf(process.platform !== "darwin")("CREW_REMOTE_STOP_SCRIPT launcher selection", () => {
  it("delegates to crew-mac stop-run when the launcher exists and a root is given", () => {
    const root = newRoot();
    const { home, argsFile } = homeWithLauncher("crew-stop matched=4 killed=1 remaining=0", 0);
    const out = runScript(RUN_A, root, home);
    expect(parseRemoteStopOutput(out)).toEqual({ matched: 4, killed: 1, remaining: 0 });
    expect(readFileSync(argsFile, "utf8").trim().split("\n")).toEqual([
      "stop-run",
      "--run-id",
      RUN_A,
      "--root",
      root,
      "--term-wait-seconds",
      "3",
    ]);
  });

  it("passes the launcher's failure exit code through", () => {
    const { home } = homeWithLauncher("", 1);
    const r = spawnSync("/bin/sh", ["-c", CREW_REMOTE_STOP_SCRIPT, "crew-stop", RUN_A, newRoot()], {
      encoding: "utf8",
      env: { ...process.env, HOME: home },
    });
    expect(r.status).toBe(1);
    expect(r.stdout).toBe("");
  });

  it("uses the built-in fallback when the launcher is missing or no root is known", () => {
    const { home, argsFile } = homeWithLauncher("crew-stop matched=9 killed=9 remaining=9", 0);
    expect(runScript(RUN_A, newRoot())).toMatch(/crew-stop matched=0 killed=0 remaining=0 via=fallback/);
    expect(runScript(RUN_A, "", home)).toMatch(/via=fallback/);
    expect(existsSync(argsFile)).toBe(false);
  });

  it("falls back to the built-in script when the launcher cannot run (exit 126 or 127)", () => {
    for (const code of [126, 127]) {
      const { home, argsFile } = homeWithLauncher("", code);
      expect(runScript(RUN_A, newRoot(), home)).toMatch(/^crew-stop matched=0 killed=0 remaining=0 via=fallback$/m);
      expect(existsSync(argsFile)).toBe(true);
    }
  });

  it("validates the run id before choosing a path", () => {
    const { home, argsFile } = homeWithLauncher("crew-stop matched=0 killed=0 remaining=0", 0);
    const r = spawnSync("/bin/sh", ["-c", CREW_REMOTE_STOP_SCRIPT, "crew-stop", "x;id", newRoot()], {
      encoding: "utf8",
      env: { ...process.env, HOME: home },
    });
    expect(r.status).toBe(2);
    expect(existsSync(argsFile)).toBe(false);
  });
});

describe("buildRemoteStopCommand", () => {
  it("passes the run id and the worktree root as quoted positional arguments", () => {
    const command = buildRemoteStopCommand(RUN_A, "/Users/me/crew/worktrees/a b");
    expect(command.startsWith("sh -c '")).toBe(true);
    expect(command.endsWith(` crew-stop '${RUN_A}' '/Users/me/crew/worktrees/a b'`)).toBe(true);
  });

  it("rejects a run id that is not a UUID and a root that is not absolute", () => {
    expect(() => buildRemoteStopCommand("x; rm -rf ~", "/r")).toThrow(/run id/);
    expect(() => buildRemoteStopCommand(RUN_A, "relative/path")).toThrow(/root/);
  });

  it("accepts an empty root (token matching only)", () => {
    expect(buildRemoteStopCommand(RUN_A, "").endsWith(` crew-stop '${RUN_A}' ''`)).toBe(true);
  });
});

describe("parseRemoteStopOutput", () => {
  it("reads only the last line, anchored, with the optional via suffix", () => {
    expect(parseRemoteStopOutput("crew-stop matched=1 killed=0 remaining=0 via=fallback\n")).toEqual({
      matched: 1,
      killed: 0,
      remaining: 0,
      via: "fallback",
    });
    expect(parseRemoteStopOutput("crew-stop matched=1 killed=0 remaining=0\nnoise after\n")).toBeNull();
    expect(parseRemoteStopOutput("xcrew-stop matched=1 killed=0 remaining=0\n")).toBeNull();
    expect(parseRemoteStopOutput("crew-stop matched=1 killed=0 remaining=0 extra\n")).toBeNull();
  });

  it("reads the summary line and ignores noise", () => {
    expect(parseRemoteStopOutput("motd\ncrew-stop matched=3 killed=1 remaining=0\n")).toEqual({
      matched: 3,
      killed: 1,
      remaining: 0,
    });
    expect(parseRemoteStopOutput("garbage")).toBeNull();
  });
});

function releaseInput(overrides: Partial<RunLeaseReleasedInput> = {}): RunLeaseReleasedInput {
  return {
    db: {} as Db,
    status: "expired",
    environment: { id: "env-1", driver: "ssh" } as RunLeaseReleasedInput["environment"],
    lease: {
      id: "lease-1",
      companyId: "company-1",
      issueId: "issue-1",
      heartbeatRunId: RUN_A,
      metadata: { remoteCwd: "/Users/me/crew-spike/worktrees/mac-claude" },
    } as unknown as RunLeaseReleasedInput["lease"],
    ...overrides,
  };
}

describe("stopRemoteRunOnRelease", () => {
  it("bounds its own SSH call below the registry's 15 s wait, so no stale SSH outlives the lease", () => {
    expect(REMOTE_STOP_TIMEOUT_MS).toBeLessThan(CREW_RUN_LEASE_RELEASE_HOOK_TIMEOUT_MS);
  });

  it("runs the stop command for the lease's worktree with the bounded timeout", async () => {
    const calls: Array<{ command: string; timeoutMs: number }> = [];
    const recorded: unknown[] = [];
    const result = await stopRemoteRunOnRelease(releaseInput(), {
      resolveSshConfig: async () => ({ host: "mac" }) as never,
      runSsh: async (_config, command, options) => {
        calls.push({ command, timeoutMs: options.timeoutMs });
        return { stdout: "crew-stop matched=2 killed=0 remaining=0\n" };
      },
      recordActivity: async (_input, r) => {
        recorded.push(r);
      },
    });
    expect(calls).toEqual([
      {
        command: buildRemoteStopCommand(RUN_A, "/Users/me/crew-spike/worktrees/mac-claude"),
        timeoutMs: REMOTE_STOP_TIMEOUT_MS,
      },
    ]);
    expect(result).toEqual({ outcome: "stopped", matched: 2, killed: 0, remaining: 0 });
    expect(recorded).toEqual([result]);
  });

  it("returns at once for leases without a run (probe, device-login, setup-token) and for non-SSH drivers", async () => {
    let touched = 0;
    const deps = {
      resolveSshConfig: async () => {
        touched += 1;
        return { host: "mac" } as never;
      },
      runSsh: async () => {
        touched += 1;
        return { stdout: "" };
      },
      recordActivity: async () => {
        touched += 1;
      },
    };
    const noRun = await stopRemoteRunOnRelease(
      releaseInput({
        lease: { id: "l", companyId: "c", issueId: null, heartbeatRunId: null, metadata: null } as unknown as RunLeaseReleasedInput["lease"],
      }),
      deps,
    );
    const local = await stopRemoteRunOnRelease(
      releaseInput({ environment: { id: "env-2", driver: "local" } as RunLeaseReleasedInput["environment"] }),
      deps,
    );
    expect(noRun.outcome).toBe("skipped");
    expect(local.outcome).toBe("skipped");
    expect(touched).toBe(0);
  });

  it("never throws when the Mac is unreachable or activity logging fails", async () => {
    const result = await stopRemoteRunOnRelease(releaseInput(), {
      resolveSshConfig: async () => ({ host: "mac" }) as never,
      runSsh: async () => {
        throw new Error("Connection timed out during banner exchange");
      },
      recordActivity: async () => {
        throw new Error("db down");
      },
    });
    expect(result.outcome).toBe("unreachable");
    expect(result.error).toContain("banner exchange");
  });

  it("reports failed with the exit code when stop-run exits non-zero, without claiming a stop", async () => {
    const recorded: unknown[] = [];
    const result = await stopRemoteRunOnRelease(releaseInput(), {
      resolveSshConfig: async () => ({ host: "mac" }) as never,
      runSsh: async () => {
        throw Object.assign(new Error("Command failed"), { code: 1, stdout: "", stderr: "crew-mac: ps failed" });
      },
      recordActivity: async (_input, r) => {
        recorded.push(r);
      },
    });
    expect(result).toEqual({ outcome: "failed", exitCode: 1, error: "crew-mac: ps failed" });
    expect(recorded).toEqual([result]);
  });

  it("treats ssh's own exit 255 and a killed ssh as unreachable", async () => {
    for (const err of [
      Object.assign(new Error("Command failed"), { code: 255, stderr: "Connection timed out" }),
      Object.assign(new Error("Command failed"), { code: null, killed: true, signal: "SIGTERM", stderr: "" }),
    ]) {
      const result = await stopRemoteRunOnRelease(releaseInput(), {
        resolveSshConfig: async () => ({ host: "mac" }) as never,
        runSsh: async () => {
          throw err;
        },
        recordActivity: async () => {},
      });
      expect(result.outcome).toBe("unreachable");
    }
  });

  it("reports failed, not stopped, when the output has no valid summary line", async () => {
    const result = await stopRemoteRunOnRelease(releaseInput(), {
      resolveSshConfig: async () => ({ host: "mac" }) as never,
      runSsh: async () => ({ stdout: "something else\n" }),
      recordActivity: async () => {},
    });
    expect(result.outcome).toBe("failed");
  });

  it("keeps the via marker in the result for the activity record", async () => {
    const result = await stopRemoteRunOnRelease(releaseInput(), {
      resolveSshConfig: async () => ({ host: "mac" }) as never,
      runSsh: async () => ({ stdout: "crew-stop matched=2 killed=0 remaining=0 via=fallback\n" }),
      recordActivity: async () => {},
    });
    expect(result).toEqual({ outcome: "stopped", matched: 2, killed: 0, remaining: 0, via: "fallback" });
  });

  it("reports incomplete when processes survive KILL", async () => {
    const result = await stopRemoteRunOnRelease(releaseInput(), {
      resolveSshConfig: async () => ({ host: "mac" }) as never,
      runSsh: async () => ({ stdout: "crew-stop matched=2 killed=2 remaining=1\n" }),
      recordActivity: async () => {},
    });
    expect(result.outcome).toBe("incomplete");
  });
});

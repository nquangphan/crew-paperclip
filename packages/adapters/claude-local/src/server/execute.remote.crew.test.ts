import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RunProcessResult } from "@paperclipai/adapter-utils/server-utils";

const {
  runChildProcess,
  ensureCommandResolvable,
  resolveCommandForLogs,
  prepareWorkspaceForSshExecution,
  restoreWorkspaceFromSshExecution,
  syncDirectoryToSsh,
  startAdapterExecutionTargetPaperclipBridge,
} = vi.hoisted(() => ({
  runChildProcess: vi.fn(async (_runId: string, _command: string, args: string[]): Promise<RunProcessResult> => ({
    exitCode: 0,
    signal: null,
    timedOut: false,
    stdout: args.includes("--version")
      ? "2.1.251 (Claude Code)\n"
      : [
          JSON.stringify({ type: "system", subtype: "init", session_id: "claude-session-1", model: "claude-sonnet" }),
          JSON.stringify({ type: "assistant", session_id: "claude-session-1", message: { content: [{ type: "text", text: "hello" }] } }),
          JSON.stringify({ type: "result", session_id: "claude-session-1", result: "hello", usage: { input_tokens: 1, cache_read_input_tokens: 0, output_tokens: 1 } }),
        ].join("\n"),
    stderr: "",
    pid: 123,
    startedAt: new Date().toISOString(),
  })),
  ensureCommandResolvable: vi.fn(async () => undefined),
  resolveCommandForLogs: vi.fn(async () => "ssh://fixture@127.0.0.1:2222/remote/workspace :: claude"),
  prepareWorkspaceForSshExecution: vi.fn(async () => ({ gitBacked: false })),
  restoreWorkspaceFromSshExecution: vi.fn(async () => undefined),
  syncDirectoryToSsh: vi.fn(async () => undefined),
  startAdapterExecutionTargetPaperclipBridge: vi.fn(async () => ({
    env: {
      PAPERCLIP_API_URL: "http://127.0.0.1:4310",
      PAPERCLIP_API_KEY: "bridge-token",
      PAPERCLIP_API_BRIDGE_MODE: "queue_v1",
    },
    stop: async () => {},
  })),
}));

vi.mock("@paperclipai/adapter-utils/server-utils", async () => {
  const actual = await vi.importActual<typeof import("@paperclipai/adapter-utils/server-utils")>(
    "@paperclipai/adapter-utils/server-utils",
  );
  return { ...actual, ensureCommandResolvable, resolveCommandForLogs, runChildProcess };
});

vi.mock("@paperclipai/adapter-utils/ssh", async () => {
  const actual = await vi.importActual<typeof import("@paperclipai/adapter-utils/ssh")>(
    "@paperclipai/adapter-utils/ssh",
  );
  return { ...actual, prepareWorkspaceForSshExecution, restoreWorkspaceFromSshExecution, syncDirectoryToSsh };
});

vi.mock("@paperclipai/adapter-utils/execution-target", async () => {
  const actual = await vi.importActual<typeof import("@paperclipai/adapter-utils/execution-target")>(
    "@paperclipai/adapter-utils/execution-target",
  );
  return { ...actual, startAdapterExecutionTargetPaperclipBridge };
});

import { execute } from "./execute.js";
import { sessionCodec } from "./index.js";
import { resetClaudeCliCapabilitiesCacheForTests } from "./cli-capabilities.js";

const IN_PLACE_ROOT = "/Users/agent/worktrees/a";

const inPlaceTarget = (remoteCwd: string) => ({
  kind: "remote" as const,
  transport: "ssh" as const,
  remoteCwd,
  workspaceRealization: {
    mode: "in_place" as const,
    authoritativeRoot: IN_PLACE_ROOT,
    pathAliases: [],
    outboundRestorePaths: [],
  },
  spec: {
    host: "127.0.0.1",
    port: 2222,
    username: "fixture",
    remoteWorkspacePath: remoteCwd,
    remoteCwd,
    privateKey: "PRIVATE KEY",
    knownHosts: "[127.0.0.1]:2222 ssh-ed25519 AAAA",
    strictHostKeyChecking: true,
  },
});

const agent = {
  id: "agent-1",
  companyId: "company-1",
  name: "Claude Coder",
  adapterType: "claude_local",
  adapterConfig: {},
};

describe("claude_local in_place on SSH (Crew)", () => {
  const cleanupDirs: string[] = [];

  afterEach(async () => {
    vi.clearAllMocks();
    resetClaudeCliCapabilitiesCacheForTests();
    while (cleanupDirs.length > 0) {
      const dir = cleanupDirs.pop();
      if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  async function workspace(prefix: string) {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), prefix));
    cleanupDirs.push(rootDir);
    const workspaceDir = path.join(rootDir, "workspace");
    await mkdir(workspaceDir, { recursive: true });
    return workspaceDir;
  }

  it("runs in place at the authoritative root without workspace upload or restore", async () => {
    const workspaceDir = await workspace("crew-claude-in-place-");

    await execute({
      runId: "run-in-place",
      agent,
      runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
      config: { engine: "cli", command: "claude" },
      context: { paperclipWorkspace: { cwd: workspaceDir, source: "task_session" } },
      executionTarget: inPlaceTarget("/app"),
      onLog: async () => {},
    });

    expect(prepareWorkspaceForSshExecution).not.toHaveBeenCalled();
    expect(restoreWorkspaceFromSshExecution).not.toHaveBeenCalled();
    expect(syncDirectoryToSsh).toHaveBeenCalledWith(
      expect.objectContaining({ remoteDir: `${IN_PLACE_ROOT}/.paperclip-runtime/claude/skills` }),
    );
    expect(syncDirectoryToSsh).toHaveBeenCalledWith(
      expect.objectContaining({ remoteDir: `${IN_PLACE_ROOT}/.paperclip-runtime/claude/mcp-config` }),
    );
    const call = runChildProcess.mock.calls.find((entry) => !(entry[2] as string[]).includes("--version")) as unknown as
      | [string, string, string[], { env: Record<string, string>; remoteExecution?: { remoteCwd: string } | null }]
      | undefined;
    expect(call?.[3].remoteExecution?.remoteCwd).toBe(IN_PLACE_ROOT);
    expect(call?.[3].env.PAPERCLIP_WORKSPACE_CWD).toBe(IN_PLACE_ROOT);
  });

  async function runResumed(workspaceDir: string, logs: string[]) {
    const sessionId = "12345678-1234-4abc-9def-123456789012";
    const stored = sessionCodec.serialize({
      sessionId,
      cwd: workspaceDir,
      remoteExecution: {
        transport: "ssh",
        host: "127.0.0.1",
        port: 2222,
        username: "fixture",
        remoteCwd: IN_PLACE_ROOT,
      },
    });
    await execute({
      runId: "run-in-place-resume",
      agent,
      runtime: {
        sessionId,
        sessionParams: sessionCodec.deserialize(stored),
        sessionDisplayId: sessionId,
        taskKey: null,
      },
      config: { engine: "cli", command: "claude" },
      context: { paperclipWorkspace: { cwd: workspaceDir, source: "task_session" } },
      executionTarget: inPlaceTarget(IN_PLACE_ROOT),
      onLog: async (_stream: string, chunk: string) => {
        logs.push(chunk);
      },
    });
    return sessionId;
  }

  it("resumes an in-place SSH session whose params went through the session codec", async () => {
    const workspaceDir = await workspace("crew-claude-in-place-resume-");
    const sessionId = await runResumed(workspaceDir, []);
    const call = runChildProcess.mock.calls.find((entry) => !(entry[2] as string[]).includes("--version")) as unknown as
      | [string, string, string[]]
      | undefined;
    expect(call?.[2]).toEqual(expect.arrayContaining(["--resume", sessionId]));
  });

  it("does not log a fresh-session notice when the session is resumed", async () => {
    const workspaceDir = await workspace("crew-claude-in-place-resume-log-");
    const logs: string[] = [];
    await runResumed(workspaceDir, logs);
    expect(logs.join("")).not.toContain("will not be resumed");
  });
});

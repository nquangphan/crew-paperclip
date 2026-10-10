import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  runChildProcess,
  ensureCommandResolvable,
  resolveCommandForLogs,
  prepareWorkspaceForSshExecution,
  restoreWorkspaceFromSshExecution,
  runSshCommand,
  syncDirectoryToSsh,
  startAdapterExecutionTargetPaperclipBridge,
} = vi.hoisted(() => ({
  runChildProcess: vi.fn(async (_runId: string, _command: string, args: string[]) => {
    if (args.includes("models")) {
      return {
        exitCode: 0,
        signal: null,
        timedOut: false,
        stdout: "opencode/gpt-5-nano\nopenai/gpt-4.1\n",
        stderr: "",
        pid: 122,
        startedAt: new Date().toISOString(),
      };
    }
    return {
      exitCode: 0,
      signal: null,
      timedOut: false,
      stdout: [
        JSON.stringify({ type: "step_start", sessionID: "ses_123" }),
        JSON.stringify({ type: "text", sessionID: "ses_123", part: { text: "hello" } }),
        JSON.stringify({
          type: "step_finish",
          sessionID: "ses_123",
          part: { cost: 0.001, tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } } },
        }),
      ].join("\n"),
      stderr: "",
      pid: 123,
      startedAt: new Date().toISOString(),
    };
  }),
  ensureCommandResolvable: vi.fn(async () => undefined),
  resolveCommandForLogs: vi.fn(async () => "ssh://fixture@127.0.0.1:2222/remote/workspace :: opencode"),
  prepareWorkspaceForSshExecution: vi.fn(async () => ({ gitBacked: false })),
  restoreWorkspaceFromSshExecution: vi.fn(async () => undefined),
  runSshCommand: vi.fn(async () => ({ stdout: "/Users/agent", stderr: "", exitCode: 0 })),
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
  return { ...actual, prepareWorkspaceForSshExecution, restoreWorkspaceFromSshExecution, runSshCommand, syncDirectoryToSsh };
});

vi.mock("@paperclipai/adapter-utils/execution-target", async () => {
  const actual = await vi.importActual<typeof import("@paperclipai/adapter-utils/execution-target")>(
    "@paperclipai/adapter-utils/execution-target",
  );
  return { ...actual, startAdapterExecutionTargetPaperclipBridge };
});

import { execute } from "./execute.js";
import { sessionCodec } from "./index.js";

const IN_PLACE_ROOT = "/Users/agent/worktrees/a";

const spec = (remoteCwd: string) => ({
  host: "127.0.0.1",
  port: 2222,
  username: "fixture",
  remoteWorkspacePath: remoteCwd,
  remoteCwd,
  privateKey: "PRIVATE KEY",
  knownHosts: "[127.0.0.1]:2222 ssh-ed25519 AAAA",
  strictHostKeyChecking: true,
});

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
  spec: spec(remoteCwd),
});

const plainSshTarget = (remoteCwd: string) => ({
  kind: "remote" as const,
  transport: "ssh" as const,
  remoteCwd,
  spec: spec(remoteCwd),
});

const agent = {
  id: "agent-1",
  companyId: "company-1",
  name: "OpenCode Builder",
  adapterType: "opencode_local",
  adapterConfig: {},
};

type RunCall = [
  string,
  string,
  string[],
  { env: Record<string, string>; remoteExecution?: { remoteCwd: string } | null },
];

function openCodeRunCall() {
  return runChildProcess.mock.calls.find((entry) => Array.isArray(entry[2]) && entry[2].includes("run")) as
    | RunCall
    | undefined;
}

function shellTraffic() {
  return [...runSshCommand.mock.calls, ...runChildProcess.mock.calls].map((call) => JSON.stringify(call)).join("\n");
}

describe("opencode_local in_place on SSH (Crew)", () => {
  const cleanupDirs: string[] = [];

  beforeEach(async () => {
    const configHome = await mkdtemp(path.join(os.tmpdir(), "crew-opencode-in-place-config-"));
    cleanupDirs.push(configHome);
    vi.stubEnv("XDG_CONFIG_HOME", configHome);
  });

  afterEach(async () => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
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
    return { rootDir, workspaceDir };
  }

  async function run(
    executionTarget: ReturnType<typeof inPlaceTarget> | ReturnType<typeof plainSshTarget>,
    options: { managed?: boolean; runtime?: Record<string, unknown>; logs?: string[] } = {},
  ) {
    const { rootDir, workspaceDir } = await workspace("crew-opencode-in-place-");
    return execute({
      runId: "run-in-place",
      agent,
      runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null, ...options.runtime },
      config: {
        command: "opencode",
        model: "opencode/gpt-5-nano",
        ...(options.managed ? { managedAiConnection: { provider: "openrouter", method: "api_key" } } : {}),
        env: {
          XDG_CONFIG_HOME: path.join(rootDir, "config"),
          ...(options.managed ? { HOME: "/var/folders/qa-managed" } : {}),
        },
      },
      context: { paperclipWorkspace: { cwd: workspaceDir, source: "task_session" } },
      executionTarget,
      onLog: async (_stream: string, chunk: string) => {
        options.logs?.push(chunk);
      },
    } as unknown as Parameters<typeof execute>[0]);
  }

  it("runs at the authoritative root without workspace upload or restore", async () => {
    const result = await run(inPlaceTarget("/app"));

    expect(prepareWorkspaceForSshExecution).not.toHaveBeenCalled();
    expect(restoreWorkspaceFromSshExecution).not.toHaveBeenCalled();
    expect(syncDirectoryToSsh).toHaveBeenCalledWith(
      expect.objectContaining({ remoteDir: `${IN_PLACE_ROOT}/.paperclip-runtime/opencode/skills` }),
    );
    const call = openCodeRunCall();
    expect(call?.[3].remoteExecution?.remoteCwd).toBe(IN_PLACE_ROOT);
    expect(call?.[3].env.PAPERCLIP_WORKSPACE_CWD).toBe(IN_PLACE_ROOT);
    expect(result.sessionParams).toMatchObject({
      sessionId: "ses_123",
      cwd: IN_PLACE_ROOT,
      remoteExecution: { transport: "ssh", host: "127.0.0.1", port: 2222, remoteCwd: IN_PLACE_ROOT },
    });
  });

  it.each([false, true])("sends no shell command that touches $HOME/.claude/skills (managed=%s)", async (managed) => {
    await run(inPlaceTarget(IN_PLACE_ROOT), { managed });

    const shell = shellTraffic();
    expect(shell).not.toMatch(/\.claude\/skills/);
    expect(shell).not.toMatch(/rm -rf/);
    expect(shell).not.toMatch(/cp -a/);
  });

  it("keeps the stock behaviour without in_place: workspace sync and the skills copy", async () => {
    await run(plainSshTarget("/remote/workspace"));

    expect(prepareWorkspaceForSshExecution).toHaveBeenCalledTimes(1);
    expect(restoreWorkspaceFromSshExecution).toHaveBeenCalledTimes(1);
    expect(runSshCommand).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining(".claude/skills"),
      expect.anything(),
    );
  });

  it("resumes an in-place SSH session whose params went through the session codec", async () => {
    const stored = sessionCodec.serialize({
      sessionId: "ses_prev",
      cwd: IN_PLACE_ROOT,
      remoteExecution: { transport: "ssh", host: "127.0.0.1", port: 2222, username: "fixture", remoteCwd: IN_PLACE_ROOT },
    });
    const logs: string[] = [];
    await run(inPlaceTarget(IN_PLACE_ROOT), {
      runtime: { sessionId: "ses_prev", sessionParams: sessionCodec.deserialize(stored), sessionDisplayId: "ses_prev" },
      logs,
    });

    expect(openCodeRunCall()?.[2]).toEqual(expect.arrayContaining(["--session", "ses_prev"]));
    expect(logs.join("")).not.toContain("will not be resumed");
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@paperclipai/db";
import type { Environment, EnvironmentLease, WorkspaceRealizationRequest } from "@paperclipai/shared";

const REMOTE_ROOT = "/Users/agent/worktrees/repo-a-agent";

const { acquireLease, ensureSshWorkspaceReady, resolveEnvironmentDriverConfigForRuntime } = vi.hoisted(() => ({
  acquireLease: vi.fn(async (input: Record<string, unknown>) => ({ id: "lease-1", ...input })),
  ensureSshWorkspaceReady: vi.fn(async () => ({ remoteCwd: "/Users/agent/worktrees/repo-a-agent" })),
  resolveEnvironmentDriverConfigForRuntime: vi.fn(async () => ({
    driver: "ssh",
    config: {
      host: "100.64.0.1",
      port: 2222,
      username: "agent",
      remoteWorkspacePath: "/Users/agent/worktrees/repo-a-agent",
      privateKey: null,
      privateKeySecretRef: null,
      knownHosts: null,
      strictHostKeyChecking: true,
    },
  })),
}));

vi.mock("../services/environments.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/environments.ts")>()),
  environmentService: () => ({ acquireLease }),
}));

vi.mock("../services/environment-config.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/environment-config.ts")>()),
  resolveEnvironmentDriverConfigForRuntime,
}));

vi.mock("@paperclipai/adapter-utils/ssh", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@paperclipai/adapter-utils/ssh")>()),
  ensureSshWorkspaceReady,
}));

import { environmentRuntimeService } from "../services/environment-runtime.ts";
import { buildWorkspaceRealizationRecord } from "../services/workspace-realization.ts";
import { sshLeaseWorkspaceRealization } from "../crew/ssh-in-place.ts";

afterEach(() => {
  vi.clearAllMocks();
});

function sshEnvironment(metadata: Record<string, unknown> | null): Environment {
  return { id: "env-1", driver: "ssh", metadata } as unknown as Environment;
}

function sshLease(environment: Environment): EnvironmentLease {
  return {
    id: "lease-1",
    companyId: "company-1",
    provider: "ssh",
    providerLeaseId: `ssh://agent@100.64.0.1:2222${REMOTE_ROOT}`,
    metadata: {
      driver: "ssh",
      host: "100.64.0.1",
      port: 2222,
      username: "agent",
      remoteWorkspacePath: REMOTE_ROOT,
      remoteCwd: REMOTE_ROOT,
      ...sshLeaseWorkspaceRealization(environment),
    },
  } as unknown as EnvironmentLease;
}

const request = {
  executionWorkspaceId: null,
  requestedMode: null,
  source: {
    kind: "task_session",
    localPath: "/paperclip/agent-home",
    strategy: "project_primary",
    projectId: null,
    projectWorkspaceId: null,
    repoUrl: null,
    repoRef: null,
    branchName: null,
    worktreePath: null,
  },
  additionalSources: [],
  runtimeOverlay: { provisionCommand: null },
} as unknown as WorkspaceRealizationRequest;

describe("SSH workspace realization from environment metadata", () => {
  it("keeps copy mode when the environment does not ask for in_place", () => {
    const environment = sshEnvironment(null);
    expect(sshLeaseWorkspaceRealization(environment)).toEqual({});
    const record = buildWorkspaceRealizationRecord({ environment, lease: sshLease(environment), request });
    expect(record.mode).toBe("copy");
    expect(record.authoritativeRoot).toBe("/paperclip/agent-home");
  });

  it("ignores unknown realization values", () => {
    expect(sshLeaseWorkspaceRealization(sshEnvironment({ workspaceRealizationMode: "mirror" }))).toEqual({});
    expect(sshLeaseWorkspaceRealization(sshEnvironment({ workspaceRealizationMode: ["in_place"] }))).toEqual({});
  });

  it("realizes in place at the remote workspace path when the environment asks for in_place", () => {
    const environment = sshEnvironment({ workspaceRealizationMode: "in_place" });
    expect(sshLeaseWorkspaceRealization(environment)).toEqual({ workspaceRealization: { mode: "in_place" } });
    const record = buildWorkspaceRealizationRecord({ environment, lease: sshLease(environment), request });
    expect(record.mode).toBe("in_place");
    expect(record.authoritativeRoot).toBe(REMOTE_ROOT);
    expect(record.remote.path).toBe(REMOTE_ROOT);
  });
});

describe("SSH driver acquireRunLease", () => {
  async function acquireWith(metadata: Record<string, unknown> | null) {
    const driver = environmentRuntimeService({} as Db).getDriver("ssh");
    if (!driver) throw new Error("ssh driver missing");
    await driver.acquireRunLease({
      companyId: "company-1",
      environment: { id: "env-1", driver: "ssh", status: "active", metadata } as unknown as Environment,
      issueId: null,
      agentId: null,
      heartbeatRunId: null,
      executionWorkspaceId: null,
      executionWorkspaceMode: null,
      executionWorkspaceSettings: null,
      adapterType: null,
      applyCustomImageTemplate: false,
    } as unknown as Parameters<typeof driver.acquireRunLease>[0]);
    expect(acquireLease).toHaveBeenCalledTimes(1);
    return (acquireLease.mock.calls[0]?.[0] as { metadata: Record<string, unknown> }).metadata;
  }

  it("marks the lease in_place when the environment asks for it", async () => {
    const metadata = await acquireWith({ workspaceRealizationMode: "in_place" });
    expect(metadata.remoteCwd).toBe(REMOTE_ROOT);
    expect(metadata.workspaceRealization).toEqual({ mode: "in_place" });
  });

  it("leaves the lease without realization metadata by default", async () => {
    const metadata = await acquireWith(null);
    expect(metadata.remoteCwd).toBe(REMOTE_ROOT);
    expect(metadata).not.toHaveProperty("workspaceRealization");
  });
});

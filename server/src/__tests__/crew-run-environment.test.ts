import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { agents, companies, createDb, environments, heartbeatRuns, issues } from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { overrideCrewCoreHooksForTests, type ResolveRunEnvironmentInput } from "../crew/core-hooks.ts";
import { heartbeatService } from "../services/heartbeat.js";

// Vá lõi C16: ngay trước resolveExecutionWorkspaceEnvironmentId, heartbeat hỏi Crew environment của run.
const { execute, seenDefaults } = vi.hoisted(() => ({ execute: vi.fn(), seenDefaults: [] as (string | null)[] }));
vi.mock("../adapters/index.js", async () => {
  const actual = await vi.importActual<typeof import("../adapters/index.js")>("../adapters/index.js");
  return { ...actual, getServerAdapter: vi.fn(() => ({ supportsLocalAgentJwt: false, execute })) };
});
vi.mock("../services/execution-workspace-policy.js", async () => {
  const actual = await vi.importActual<typeof import("../services/execution-workspace-policy.js")>("../services/execution-workspace-policy.js");
  return {
    ...actual,
    resolveExecutionWorkspaceEnvironmentId: (input: Parameters<typeof actual.resolveExecutionWorkspaceEnvironmentId>[0]) => {
      seenDefaults.push(input.agentDefaultEnvironmentId ?? null);
      // Chạy local như stock để không cần SSH; test chỉ cần biết heartbeat định dùng environment nào.
      return actual.resolveExecutionWorkspaceEnvironmentId({ ...input, agentDefaultEnvironmentId: null });
    },
  };
});

const support = await getEmbeddedPostgresTestSupport();
const suite = support.supported ? describe.sequential : describe.skip;

suite("vá lõi C16: environment của run theo máy đã ghim", () => {
  let db: ReturnType<typeof createDb>;
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let restore: (() => void) | null = null;

  beforeAll(async () => {
    temporary = await startEmbeddedPostgresTestDatabase("crew-run-environment-");
    db = createDb(temporary.connectionString);
  }, 60_000);
  afterEach(() => {
    restore?.();
    restore = null;
    execute.mockReset();
    seenDefaults.length = 0;
  });
  afterAll(async () => {
    await db?.$client.end({ timeout: 0 });
    await temporary?.cleanup();
  });

  async function queuedRun() {
    const companyId = randomUUID(), agentId = randomUUID(), issueId = randomUUID(), runId = randomUUID();
    const defaultEnv = randomUUID(), pinnedEnv = randomUUID();
    await db.insert(companies).values({
      id: companyId, name: "Crew C16", issuePrefix: `E${companyId.replace(/-/g, "").slice(0, 5).toUpperCase()}`, defaultResponsibleUserId: "owner",
    });
    for (const [id, host] of [[defaultEnv, "100.64.0.3"], [pinnedEnv, "100.64.0.2"]] as const) {
      await db.insert(environments).values({
        id, name: `c16-${id.slice(0, 8)}`, driver: "ssh", status: "active",
        config: { host, port: 2222, username: "owner", remoteWorkspacePath: "/Users/owner/crew-agents/x/executor" },
      });
    }
    await db.insert(agents).values({
      id: agentId, companyId, name: "Worker", role: "engineer", status: "idle", adapterType: "process", adapterConfig: {},
      permissions: {}, runtimeConfig: { heartbeat: { enabled: false, wakeOnDemand: true, maxConcurrentRuns: 1 } },
      defaultEnvironmentId: defaultEnv,
    });
    await db.insert(issues).values({ id: issueId, companyId, title: "Việc", status: "todo", assigneeAgentId: agentId, responsibleUserId: "owner" });
    await db.insert(heartbeatRuns).values({
      id: runId, companyId, agentId, status: "queued", invocationSource: "on_demand", responsibleUserId: "owner", contextSnapshot: { issueId },
    });
    return { runId, agentId, companyId, issueId, defaultEnv, pinnedEnv };
  }

  async function drive() {
    execute.mockResolvedValue({ exitCode: 0, signal: null, timedOut: false, summary: "Completed" });
    const heartbeat = heartbeatService(db);
    await heartbeat.resumeQueuedRuns();
    await heartbeat.drainActiveRunExecutions();
  }

  it("Crew trả environment của máy ghim: heartbeat dùng nó thay environment mặc định", async () => {
    const r = await queuedRun();
    const calls: ResolveRunEnvironmentInput[] = [];
    restore = overrideCrewCoreHooksForTests({
      beforeClaim: async () => false,
      resolveRunEnvironment: async (input) => {
        calls.push(input);
        return input.run.id === r.runId ? r.pinnedEnv : null;
      },
    });
    await drive();
    expect(seenDefaults).toContain(r.pinnedEnv);
    const call = calls.find((input) => input.run.id === r.runId)!;
    expect(call).toMatchObject({ issueId: r.issueId, agent: { id: r.agentId, companyId: r.companyId, defaultEnvironmentId: r.defaultEnv } });
  }, 30_000);

  it("Crew trả null: giữ environment mặc định của agent", async () => {
    const r = await queuedRun();
    restore = overrideCrewCoreHooksForTests({ beforeClaim: async () => false, resolveRunEnvironment: async () => null });
    await drive();
    expect(seenDefaults).toContain(r.defaultEnv);
  }, 30_000);

  it("Crew ném lỗi: giữ environment mặc định, run vẫn chạy", async () => {
    const r = await queuedRun();
    restore = overrideCrewCoreHooksForTests({
      beforeClaim: async () => false,
      resolveRunEnvironment: async () => {
        throw new Error("db down");
      },
    });
    await drive();
    expect(seenDefaults).toContain(r.defaultEnv);
    expect(execute.mock.calls.some(([context]) => context.runId === r.runId)).toBe(true);
  }, 30_000);
});

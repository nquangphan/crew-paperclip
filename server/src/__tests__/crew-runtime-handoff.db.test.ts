import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import type { PluginContext } from "@paperclipai/plugin-sdk";
import { agentWakeupRequests, agents, companies, createDb, environments, heartbeatRuns, issueComments, issues, plugins, projects } from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import manifest from "../../../packages/crew-plugin/src/manifest.ts";
import { upsertProjectRoles } from "../../../packages/crew-plugin/src/roles/data.ts";
import { applyFallback, runRuntimeFallbackJob } from "../../../packages/crew-plugin/src/runtimes/fallback.ts";
import { overrideCrewCoreHooksForTests } from "../crew/core-hooks.ts";
import { buildCrewPolicy, CREW_POLICY_CONFIG_ENV } from "../crew/issue-policy.ts";
import { defaultBeforeClaimDeps, evaluateBeforeClaim } from "../crew/load-gate.ts";
import { heartbeatService } from "../services/heartbeat.js";
import { applyIssueExecutionPolicyTransition, normalizeIssueExecutionPolicy } from "../services/issue-execution-policy.js";
import { issueService } from "../services/issues.js";
import { buildHostServices } from "../services/plugin-host-services.js";
import { pluginDatabaseService } from "../services/plugin-database.js";

// Đầu-cuối trên Postgres: plugin crew.core (fallback runtime) chạy qua host services thật, issue service thật (H2) và
// heartbeat thật (H1). Adapter được mock để không run nào chạy CLI thật.
const execute = vi.hoisted(() => vi.fn());
vi.mock("../adapters/index.js", async () => {
  const actual = await vi.importActual<typeof import("../adapters/index.js")>("../adapters/index.js");
  return { ...actual, getServerAdapter: vi.fn(() => ({ supportsLocalAgentJwt: false, execute })) };
});

const support = await getEmbeddedPostgresTestSupport();
const suite = support.supported ? describe : describe.skip;

const OWNER = "owner-1";
const pluginId = randomUUID();
const pluginRoot = fileURLToPath(new URL("../../../packages/crew-plugin", import.meta.url));
const marker = (complexity: string, runtime: string, model: string, effort: string) =>
  `Việc thử\n\ncrew-model complexity=${complexity} model=${model} effort=${effort} runtime=${runtime} reason=thử\n`;

suite("Crew: đổi người làm issue (override theo vai trò, đánh thức sau fallback)", () => {
  let db: ReturnType<typeof createDb>;
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let ctx: PluginContext;
  let restore: (() => void) | null = null;
  const configDir = mkdtempSync(path.join(tmpdir(), "crew-runtime-handoff-config-"));
  const configFile = path.join(configDir, "crew-policy.json");
  const configured: Record<string, unknown> = {};
  const previousEnv = process.env[CREW_POLICY_CONFIG_ENV];
  const writeConfig = () => writeFileSync(configFile, JSON.stringify({ companies: configured }));

  beforeAll(async () => {
    writeConfig();
    process.env[CREW_POLICY_CONFIG_ENV] = configFile;
    temporary = await startEmbeddedPostgresTestDatabase("crew-runtime-handoff-");
    db = createDb(temporary.connectionString);
    await db.insert(plugins).values({
      id: pluginId, pluginKey: manifest.id, packageName: "@crew/paperclip-plugin", version: manifest.version,
      apiVersion: manifest.apiVersion, categories: manifest.categories, manifestJson: manifest, status: "installed",
    });
    const pluginDb = pluginDatabaseService(db);
    await pluginDb.applyMigrations(pluginId, manifest, pluginRoot);
    const namespace = await pluginDb.getRuntimeNamespace(pluginId);
    const host = buildHostServices(db, pluginId, manifest.id, {
      forPlugin: () => ({ emit: async () => {}, subscribe: () => {} }),
    } as never);
    const quiet = () => {};
    ctx = {
      db: {
        namespace,
        query: (statement: string, params?: unknown[]) => pluginDb.query(pluginId, statement, params),
        execute: (statement: string, params?: unknown[]) => pluginDb.execute(pluginId, statement, params),
      },
      config: { get: async (companyId: string) => ({ companies: [{ companyId }] }) },
      logger: { info: quiet, warn: quiet, error: quiet, debug: quiet },
      issues: {
        get: (issueId: string, companyId: string) => host.issues.get({ issueId, companyId }),
        update: (issueId: string, patch: Record<string, unknown>, companyId: string) =>
          host.issues.update({ issueId, patch, companyId }),
        createComment: (issueId: string, body: string, companyId: string) => host.issues.createComment({ issueId, body, companyId }),
        listAttachments: (issueId: string, companyId: string) => host.issues.listAttachments({ issueId, companyId }),
        requestWakeup: (issueId: string, companyId: string, options: Record<string, unknown>) =>
          host.issues.requestWakeup({ issueId, companyId, ...options }),
      },
    } as unknown as PluginContext;
  }, 60_000);
  // Mặc định không run nào được claim (không chạy adapter, không SSH); ca nào cần H1 thật thì tự đặt.
  beforeEach(() => {
    restore = overrideCrewCoreHooksForTests({ beforeClaim: async () => true });
  });
  afterEach(async () => {
    restore?.();
    restore = null;
    await heartbeatService(db).drainActiveRunExecutions();
    execute.mockReset();
  });
  afterAll(async () => {
    if (previousEnv === undefined) delete process.env[CREW_POLICY_CONFIG_ENV];
    else process.env[CREW_POLICY_CONFIG_ENV] = previousEnv;
    rmSync(configDir, { recursive: true, force: true });
    await db?.$client.end({ timeout: 0 });
    await temporary?.cleanup();
  });

  /** Company Crew với project có đủ vai trò: executor Claude, executor Codex, reviewer Claude, reviewer Codex. */
  async function crewCompany() {
    const companyId = randomUUID(), projectId = randomUUID();
    const [assistant, claudeExec, codexExec, reviewer, codexReviewer, integrator] = Array.from({ length: 6 }, () => randomUUID());
    await db.insert(companies).values({
      id: companyId, name: "Crew handoff", issuePrefix: `H${companyId.replace(/-/g, "").slice(0, 5).toUpperCase()}`,
      defaultResponsibleUserId: OWNER,
    });
    // Mọi agent trên cùng một Mac (company một máy): fallback chỉ chuyển trong cùng máy.
    const environmentId = randomUUID(), machineId = randomUUID();
    await db.insert(environments).values({
      id: environmentId, name: `mac-mini-${environmentId.slice(0, 8)}`, driver: "ssh", status: "active",
      config: { host: "mac.example.test", port: 22, username: "agent", remoteWorkspacePath: "/Users/owner/crew-agents" },
    });
    await ctx.db.execute(
      `INSERT INTO ${ctx.db.namespace}.machine_latest (company_id, machine_id, hostname, received_at, sent_at, report)
       VALUES ($1, $2, 'mac-mini', now(), now(), '{}'::jsonb)`,
      [companyId, machineId],
    );
    const agent = (id: string, name: string, adapterType: string) => ({
      id, companyId, name, role: "engineer", status: "idle", adapterType, adapterConfig: {}, permissions: {},
      runtimeConfig: { heartbeat: { enabled: false, wakeOnDemand: true, maxConcurrentRuns: 1 } },
      defaultEnvironmentId: environmentId,
    });
    await db.insert(agents).values([
      agent(assistant, "Trợ Lý", "claude_local"),
      agent(claudeExec, "mac-claude", "claude_local"),
      agent(codexExec, "executor-codex", "codex_local"),
      agent(reviewer, "reviewer", "claude_local"),
      agent(codexReviewer, "reviewer-codex", "codex_local"),
      agent(integrator, "integrator", "claude_local"),
    ]);
    await db.insert(projects).values({ id: projectId, companyId, name: "repo-a" });
    configured[companyId] = { reviewerAgentId: reviewer, integratorAgentId: integrator, ownerUserId: OWNER };
    await ctx.db.execute(`INSERT INTO ${ctx.db.namespace}.crew_companies (company_id, name) VALUES ($1, 'Crew handoff')`, [companyId]);
    writeConfig();
    await upsertProjectRoles(ctx, companyId, projectId, {
      assistantAgentId: assistant, executorAgentIds: [claudeExec], reviewerAgentId: reviewer, integratorAgentId: integrator,
      codexExecutorAgentId: codexExec, opencodeExecutorAgentId: null, codexReviewerAgentId: codexReviewer,
    }, OWNER);
    return { companyId, projectId, assistant, claudeExec, codexExec, reviewer, codexReviewer, integrator };
  }
  type Crew = Awaited<ReturnType<typeof crewCompany>>;

  async function childIssue(c: Crew, values: Partial<typeof issues.$inferInsert> & { codexReviewer?: boolean }) {
    const { codexReviewer, ...fields } = values;
    const id = randomUUID();
    const policy = buildCrewPolicy("child", { reviewerAgentId: c.reviewer, integratorAgentId: c.integrator }, null, {
      codexReviewerAgentId: codexReviewer ? c.codexReviewer : null,
    });
    await db.insert(issues).values({
      id, companyId: c.companyId, projectId: c.projectId, title: "Việc thử", status: "todo", createdByUserId: OWNER,
      responsibleUserId: OWNER, executionPolicy: policy, ...fields,
    });
    return id;
  }

  async function issueRow(issueId: string) {
    const [row] = await db.select().from(issues).where(eq(issues.id, issueId));
    return row!;
  }

  /** Lệnh ghi như route PATCH: transition stock của policy rồi `issueService.update` (H2). */
  async function act(issueId: string, actor: { agentId: string } | { userId: string }, requestedStatus: string) {
    const row = await issueRow(issueId);
    const policy = normalizeIssueExecutionPolicy(row.executionPolicy);
    const agentId = "agentId" in actor ? actor.agentId : null;
    const userId = "userId" in actor ? actor.userId : null;
    const transition = applyIssueExecutionPolicyTransition({
      issue: row as never, policy, previousPolicy: policy, requestedStatus, requestedAssigneePatch: {},
      actor: { agentId, userId }, allowBoardOverride: false, commentBody: "ok",
    });
    if (transition.decision) {
      transition.patch.executionState = { ...(transition.patch.executionState as object), lastDecisionId: randomUUID() };
    }
    await issueService(db).update(issueId, {
      status: requestedStatus as never, ...transition.patch, actorAgentId: agentId, actorUserId: userId,
    });
    return issueRow(issueId);
  }

  const LUNA = { adapterConfig: { model: "gpt-6-luna", modelReasoningEffort: "medium" } };
  const SONNET = { adapterConfig: { model: "claude-sonnet-5", effort: "medium" } };
  const SOL_HIGH = { adapterConfig: { model: "gpt-6-sol", modelReasoningEffort: "high" } };

  describe("override của executor không áp cho reviewer", () => {
    it("executor Codex → reviewer Claude: reviewer chạy theo cấu hình agent; trả về thì executor lấy lại override", async () => {
      const c = await crewCompany();
      const issueId = await childIssue(c, {
        status: "in_progress", assigneeAgentId: c.codexExec, description: marker("small", "codex_local", "gpt-6-luna", "medium"),
        assigneeAdapterOverrides: LUNA,
      });

      const inReview = await act(issueId, { agentId: c.codexExec }, "in_review");
      expect(inReview).toMatchObject({ status: "in_review", assigneeAgentId: c.reviewer, assigneeAdapterOverrides: null });

      const back = await act(issueId, { agentId: c.reviewer }, "in_progress");
      expect(back).toMatchObject({ assigneeAgentId: c.codexExec, assigneeAdapterOverrides: LUNA });

      // Vòng review thứ hai cũng vậy.
      expect(await act(issueId, { agentId: c.codexExec }, "in_review")).toMatchObject({
        assigneeAgentId: c.reviewer, assigneeAdapterOverrides: null,
      });
    });

    it("executor Claude → reviewer Codex: reviewer chạy gpt-6-sol/high; trả về executor Claude với sonnet/medium", async () => {
      const c = await crewCompany();
      const issueId = await childIssue(c, {
        status: "in_progress", assigneeAgentId: c.claudeExec, description: marker("small", "claude_local", "claude-sonnet-5", "medium"),
        assigneeAdapterOverrides: SONNET, codexReviewer: true,
      });

      expect(await act(issueId, { agentId: c.claudeExec }, "in_review")).toMatchObject({
        assigneeAgentId: c.codexReviewer, assigneeAdapterOverrides: SOL_HIGH,
      });
      expect(await act(issueId, { agentId: c.codexReviewer }, "in_progress")).toMatchObject({
        assigneeAgentId: c.claudeExec, assigneeAdapterOverrides: SONNET,
      });
    });

    it("reviewer Codex hỏng → plugin chuyển sang reviewer Claude: reviewer Claude không nhận model Codex", async () => {
      const c = await crewCompany();
      const issueId = await childIssue(c, {
        status: "in_progress", assigneeAgentId: c.claudeExec, description: marker("small", "claude_local", "claude-sonnet-5", "medium"),
        assigneeAdapterOverrides: SONNET, codexReviewer: true,
      });
      expect(await act(issueId, { agentId: c.claudeExec }, "in_review")).toMatchObject({ assigneeAgentId: c.codexReviewer });

      expect(await applyFallback(ctx, { companyId: c.companyId, issueId, runId: null, agentId: c.codexReviewer, trigger: "unavailable" }))
        .toBe("applied");
      expect(await issueRow(issueId)).toMatchObject({ assigneeAgentId: c.reviewer, assigneeAdapterOverrides: null });
      expect(await act(issueId, { agentId: c.reviewer }, "in_progress")).toMatchObject({
        assigneeAgentId: c.claudeExec, assigneeAdapterOverrides: SONNET,
      });
    });

    it("lệnh ghi tự đặt override khi đổi assignee thì giữ nguyên override đó", async () => {
      const c = await crewCompany();
      const issueId = await childIssue(c, { status: "in_progress", assigneeAgentId: c.codexExec, assigneeAdapterOverrides: LUNA });
      await issueService(db).update(issueId, {
        assigneeAgentId: c.claudeExec, assigneeAdapterOverrides: SONNET, actorAgentId: null, actorUserId: OWNER,
      } as never);
      expect(await issueRow(issueId)).toMatchObject({ assigneeAgentId: c.claudeExec, assigneeAdapterOverrides: SONNET });
    });
  });

  describe("fallback executor theo công tắc", () => {
    /** H1 thật (không có cổng tải); run của agent nào trong `held` thì giữ `queued` để không chạy. */
    function realGate(held: Set<string>) {
      restore?.();
      restore = overrideCrewCoreHooksForTests({
        beforeClaim: async (input) => {
          if (held.has(input.run.agentId)) return true;
          return evaluateBeforeClaim(input, { ...defaultBeforeClaimDeps(input.db), loadTarget: async () => null });
        },
      });
    }

    it("agent đích chỉ được đánh thức sau khi H1 hủy run Codex bị giữ: có run, không wake treo, H1 đối chiếu commit", async () => {
      const c = await crewCompany();
      const issueId = await childIssue(c, {
        status: "todo", assigneeAgentId: c.codexExec, description: marker("small", "codex_local", "gpt-6-luna", "medium"),
        assigneeAdapterOverrides: LUNA,
      });
      realGate(new Set([c.claudeExec]));
      const heartbeat = heartbeatService(db);
      const held = await heartbeat.wakeup(c.codexExec, {
        source: "assignment", triggerDetail: "system", reason: "issue_assigned",
        payload: { issueId }, contextSnapshot: { issueId, wakeReason: "issue_assigned" },
      });
      expect(held).not.toBeNull();
      // H1 giữ run vì công tắc Codex tắt và ghi hàng chờ cho job của plugin.
      await heartbeat.resumeQueuedRuns();
      expect((await heartbeat.getRun(held!.id))?.status).toBe("queued");
      await ctx.db.execute(
        `UPDATE ${ctx.db.namespace}.crew_runtime_waits SET first_seen_at = now() - interval '2 minutes' WHERE run_id = $1`, [held!.id],
      );
      const handled = async () => (await ctx.db.query<{ handled_at: unknown }>(
        `SELECT handled_at FROM ${ctx.db.namespace}.crew_runtime_waits WHERE run_id = $1`, [held!.id],
      ))[0]?.handled_at ?? null;
      const targetRuns = async () => (await db.select().from(heartbeatRuns).where(and(
        eq(heartbeatRuns.companyId, c.companyId), eq(heartbeatRuns.agentId, c.claudeExec),
      ))).map((run) => ({ id: run.id, status: run.status, wakeReason: (run.contextSnapshot as Record<string, unknown>).wakeReason }));
      const parked = async () => db.select().from(agentWakeupRequests).where(and(
        eq(agentWakeupRequests.companyId, c.companyId), eq(agentWakeupRequests.status, "deferred_issue_execution"),
      ));

      // Phút 1: job chuyển sang executor Claude, chưa đánh thức vì run Codex còn giữ issue.
      expect(await runRuntimeFallbackJob(ctx, new Date())).toEqual({ handled: 0, applied: 1 });
      expect(await issueRow(issueId)).toMatchObject({ assigneeAgentId: c.claudeExec, assigneeAdapterOverrides: SONNET });
      expect(await targetRuns()).toEqual([]);
      expect(await parked()).toEqual([]);
      expect(await handled()).toBeNull();

      // Lượt claim kế tiếp: H1 hủy run Codex của agent đã bị chuyển đi.
      await heartbeat.resumeQueuedRuns();
      await vi.waitFor(async () => expect((await heartbeat.getRun(held!.id))?.status).toBe("cancelled"), { timeout: 5_000 });

      // Phút 2: run cũ đã hủy, job đánh thức agent đích một lần.
      expect(await runRuntimeFallbackJob(ctx, new Date())).toEqual({ handled: 1, applied: 0 });
      const [target] = await targetRuns();
      expect(await targetRuns()).toEqual([{ id: target!.id, status: "queued", wakeReason: "crew_runtime_fallback" }]);
      expect(await parked()).toEqual([]);
      expect(await handled()).not.toBeNull();
      expect(await runRuntimeFallbackJob(ctx, new Date())).toEqual({ handled: 0, applied: 0 });
      expect(await targetRuns()).toHaveLength(1);

      // H1 trước khi claim run đích: đối chiếu commit của run Codex cũ và comment reconcile.
      const [targetRun] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, target!.id));
      const deps = {
        ...defaultBeforeClaimDeps(db),
        loadTarget: async () => ({ environmentId: "env-1", environmentName: "mac-mini", settings: { maxLoad1: 8, maxWaitMinutes: 60 } }),
        probeHost: async () => ({ ok: true as const, load1: 1 }),
        checkRetryProgress: async (_run: unknown, progressTarget: { previousRunId: string }) => ({
          kind: "checked" as const, previousRunId: progressTarget.previousRunId, previousStartedAt: new Date(), retryReason: null,
          cwd: "/Users/owner/crew-agents/repo-a/executor-codex", truncated: false, detach: "done" as const,
          commits: [{ sha: "c3880d1f".padEnd(40, "0"), committedAt: new Date().toISOString(), branch: "crew/TPS-107", subject: "feat: phần đầu" }],
        }),
      };
      expect(await evaluateBeforeClaim({ db, run: targetRun! }, deps)).toBe(false);
      const comments = await db.select().from(issueComments).where(eq(issueComments.issueId, issueId));
      expect(comments.map((comment) => comment.body)).toContainEqual(
        expect.stringContaining(`Crew: chuyển runtime sau run \`${held!.id}\``),
      );
    }, 30_000);
  });
});

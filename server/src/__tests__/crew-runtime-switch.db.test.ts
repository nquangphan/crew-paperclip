import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { activityLog, agents, companies, createDb, environments, heartbeatRuns, issues } from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { CREW_POLICY_CONFIG_ENV } from "../crew/issue-policy.ts";
import { defaultBeforeClaimDeps, evaluateBeforeClaim } from "../crew/load-gate.ts";
import {
  CREW_OPENCODE_IN_PLACE_PATCH_ENV,
  CREW_RUNTIME_SWITCH_DEFAULTS,
  crewRuntimeSwitchesTable,
  crewRuntimeWaitsTable,
  readRuntimeSwitch,
  resolveAgentMachine,
  resolveMachineForWorkspace,
} from "../crew/runtime-switch.ts";
import { defaultRuntimeGateDeps } from "../crew/runtime-gate.ts";
import { fallbackPreviousRunId } from "../crew/runtime-fallback.ts";

const [mini, studio] = ["50000000-0000-4000-8000-000000000001", "50000000-0000-4000-8000-000000000002"];
const workspace = "/Users/owner/crew-agents/repo-a/executor-codex";
const other = "/Users/owner/crew-agents/repo-a/executor";
const machine = (machineId: string, receivedAt: string, checkouts: string[]) => ({ machineId, receivedAt, checkouts });

// Bảng ca chung với plugin (`packages/crew-plugin/src/__tests__/runtime-machine.test.ts`): cùng luật chọn máy của agent.
const CASES: [string, string | null, ReturnType<typeof machine>[], string | null][] = [
  ["checkout khớp một máy trong hai máy", workspace, [machine(mini, "2026-10-10T05:00:00Z", [other]), machine(studio, "2026-10-10T05:00:00Z", [workspace])], studio],
  ["hai máy cùng có checkout: lấy bản tin mới nhất", workspace, [machine(mini, "2026-10-10T05:01:00Z", [workspace]), machine(studio, "2026-10-10T05:00:00Z", [workspace])], mini],
  ["không khớp, company một máy: lấy máy đó", workspace, [machine(mini, "2026-10-10T05:00:00Z", [other])], mini],
  ["không có workspace, company một máy: lấy máy đó", null, [machine(mini, "2026-10-10T05:00:00Z", [])], mini],
  ["không khớp, hai máy: không xác định", workspace, [machine(mini, "2026-10-10T05:00:00Z", [other]), machine(studio, "2026-10-10T05:00:00Z", [])], null],
  ["không có workspace, hai máy: không xác định", null, [machine(mini, "2026-10-10T05:00:00Z", [workspace]), machine(studio, "2026-10-10T05:00:00Z", [workspace])], null],
  ["chưa có máy nào", workspace, [], null],
];

describe("máy của agent (bảng ca chung với plugin)", () => {
  it.each(CASES)("%s", (_name, path, machines, expected) => {
    expect(resolveMachineForWorkspace(path, machines)).toBe(expected);
  });
});

describe("mặc định công tắc", () => {
  it("Claude bật, Codex và OpenCode tắt", () => {
    expect(CREW_RUNTIME_SWITCH_DEFAULTS).toEqual({ claude_local: true, codex_local: false, opencode_local: false });
  });
});

const migration = (file: string) =>
  readFileSync(fileURLToPath(new URL(`../../../packages/crew-plugin/migrations/${file}`, import.meta.url)), "utf8")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);

const support = await getEmbeddedPostgresTestSupport();
const suite = support.supported ? describe : describe.skip;

suite("công tắc runtime và hàng chờ trên Postgres", () => {
  let db: ReturnType<typeof createDb>;
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  const configDir = mkdtempSync(path.join(tmpdir(), "crew-runtime-switch-config-"));
  const configFile = path.join(configDir, "crew-policy.json");
  const configured: Record<string, unknown> = {};
  const previousConfig = process.env[CREW_POLICY_CONFIG_ENV];
  const previousPatch = process.env[CREW_OPENCODE_IN_PLACE_PATCH_ENV];
  const writeConfig = () => writeFileSync(configFile, JSON.stringify({ companies: configured }));

  beforeAll(async () => {
    writeConfig();
    process.env[CREW_POLICY_CONFIG_ENV] = configFile;
    delete process.env[CREW_OPENCODE_IN_PLACE_PATCH_ENV];
    temporary = await startEmbeddedPostgresTestDatabase("crew-runtime-switch-");
    db = createDb(temporary.connectionString);
  }, 60_000);
  afterEach(() => {
    delete process.env[CREW_OPENCODE_IN_PLACE_PATCH_ENV];
  });
  afterAll(async () => {
    if (previousConfig === undefined) delete process.env[CREW_POLICY_CONFIG_ENV];
    else process.env[CREW_POLICY_CONFIG_ENV] = previousConfig;
    if (previousPatch === undefined) delete process.env[CREW_OPENCODE_IN_PLACE_PATCH_ENV];
    else process.env[CREW_OPENCODE_IN_PLACE_PATCH_ENV] = previousPatch;
    rmSync(configDir, { recursive: true, force: true });
    await db?.$client.end({ timeout: 0 });
    await temporary?.cleanup();
  });

  async function seed(opts: { adapterType?: string; environment?: boolean; crew?: boolean } = {}) {
    const companyId = randomUUID(), agentId = randomUUID(), issueId = randomUUID(), runId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Crew runtime",
      issuePrefix: `S${companyId.replace(/-/g, "").slice(0, 5).toUpperCase()}`,
      defaultResponsibleUserId: "owner",
    });
    let environmentId: string | null = null;
    if (opts.environment !== false) {
      environmentId = randomUUID();
      await db.insert(environments).values({
        id: environmentId,
        name: `repo-a-executor-codex-${environmentId.slice(0, 8)}`,
        driver: "ssh",
        status: "active",
        config: { host: "mac.example.test", port: 22, username: "agent", remoteWorkspacePath: workspace },
      });
    }
    await db.insert(agents).values({
      id: agentId, companyId, name: "Executor Codex", role: "engineer", status: "idle",
      adapterType: opts.adapterType ?? "codex_local", adapterConfig: {}, permissions: {}, runtimeConfig: {},
      defaultEnvironmentId: environmentId,
    });
    await db.insert(issues).values({ id: issueId, companyId, title: "Việc", status: "todo", assigneeAgentId: agentId, responsibleUserId: "owner" });
    const [run] = await db.insert(heartbeatRuns).values({
      id: runId, companyId, agentId, status: "queued", invocationSource: "on_demand", responsibleUserId: "owner",
      contextSnapshot: { issueId },
    }).returning();
    if (opts.crew !== false) {
      configured[companyId] = { reviewerAgentId: randomUUID(), integratorAgentId: randomUUID(), ownerUserId: "owner" };
      writeConfig();
    }
    return { companyId, agentId, issueId, run: run!, environmentId };
  }

  const ns = () => crewRuntimeSwitchesTable().split(".")[0]!;
  const report = (machineId: string, companyId: string, receivedAt: string, checkouts: string[]) =>
    db.execute(sql.raw(`INSERT INTO ${ns()}.machine_latest (company_id, machine_id, hostname, received_at, sent_at, report)
      VALUES ('${companyId}', '${machineId}', 'mac', '${receivedAt}', '${receivedAt}',
      '${JSON.stringify({ checkouts: checkouts.map((p) => ({ path: p })) })}'::jsonb)`));
  const setSwitch = (companyId: string, machineId: string, runtime: string, enabled: boolean) =>
    db.execute(sql.raw(`INSERT INTO ${crewRuntimeSwitchesTable()} (company_id, machine_id, runtime, enabled, updated_by_user_id)
      VALUES ('${companyId}', '${machineId}', '${runtime}', ${enabled}, 'owner')
      ON CONFLICT (company_id, machine_id, runtime) DO UPDATE SET enabled = EXCLUDED.enabled`));

  describe("chưa có bảng plugin", () => {
    it("công tắc theo mặc định, máy không xác định", async () => {
      const s = await seed();
      for (const [runtime, enabled] of Object.entries(CREW_RUNTIME_SWITCH_DEFAULTS)) {
        expect(await readRuntimeSwitch(db, { companyId: s.companyId, machineId: mini, runtime: runtime as never })).toBe(enabled);
      }
      expect(await resolveAgentMachine(db, { companyId: s.companyId, agentId: s.agentId })).toBeNull();
    });

    it("cổng giữ run codex theo mặc định (tắt), ghi activity dù chưa có bảng hàng chờ", async () => {
      const s = await seed();
      expect(await evaluateBeforeClaim({ db, run: s.run }, { ...defaultBeforeClaimDeps(db), loadTarget: async () => null })).toBe(true);
      const marks = await db.select().from(activityLog).where(and(eq(activityLog.runId, s.run.id), eq(activityLog.action, "crew.runtime_gate.waiting")));
      expect(marks).toHaveLength(1);
      expect(marks[0]?.details).toMatchObject({ runtime: "codex_local", machineId: null, issueId: s.issueId });
    });
  });

  describe("bảng plugin đã migrate", () => {
    beforeAll(async () => {
      await db.execute(sql.raw(`CREATE SCHEMA IF NOT EXISTS ${ns()}`));
      const statements = [
        ...migration("0003_machine_latest.sql").filter((s) => s.startsWith(`CREATE TABLE ${ns()}.machine_latest`)),
        ...migration("0012_runtimes.sql").filter((s) => s.startsWith("CREATE")),
      ];
      for (const statement of statements) await db.execute(sql.raw(statement));
    });

    it("đọc dòng công tắc theo máy; máy null dùng mặc định", async () => {
      const s = await seed();
      await setSwitch(s.companyId, mini, "codex_local", true);
      await setSwitch(s.companyId, mini, "claude_local", false);
      expect(await readRuntimeSwitch(db, { companyId: s.companyId, machineId: mini, runtime: "codex_local" })).toBe(true);
      expect(await readRuntimeSwitch(db, { companyId: s.companyId, machineId: mini, runtime: "claude_local" })).toBe(false);
      expect(await readRuntimeSwitch(db, { companyId: s.companyId, machineId: studio, runtime: "codex_local" })).toBe(false);
      expect(await readRuntimeSwitch(db, { companyId: s.companyId, machineId: null, runtime: "codex_local" })).toBe(false);
      expect(await readRuntimeSwitch(db, { companyId: randomUUID(), machineId: mini, runtime: "claude_local" })).toBe(true);
    });

    it("OpenCode bật ở bảng vẫn tắt khi server chưa có vá chạy đúng worktree", async () => {
      const s = await seed();
      await setSwitch(s.companyId, mini, "opencode_local", true);
      expect(await readRuntimeSwitch(db, { companyId: s.companyId, machineId: mini, runtime: "opencode_local" })).toBe(false);
      process.env[CREW_OPENCODE_IN_PLACE_PATCH_ENV] = "1";
      expect(await readRuntimeSwitch(db, { companyId: s.companyId, machineId: mini, runtime: "opencode_local" })).toBe(true);
      process.env[CREW_OPENCODE_IN_PLACE_PATCH_ENV] = "true";
      expect(await readRuntimeSwitch(db, { companyId: s.companyId, machineId: mini, runtime: "opencode_local" })).toBe(false);
    });

    it("máy của agent: checkout khớp workspace của environment, một máy, hai máy không khớp", async () => {
      const s = await seed();
      await report(mini, s.companyId, "2026-10-10T05:00:00Z", [other]);
      await report(studio, s.companyId, "2026-10-10T05:00:00Z", [workspace]);
      expect(await resolveAgentMachine(db, { companyId: s.companyId, agentId: s.agentId })).toBe(studio);

      const single = await seed({ environment: false });
      await report(mini, single.companyId, "2026-10-10T05:00:00Z", []);
      expect(await resolveAgentMachine(db, { companyId: single.companyId, agentId: single.agentId })).toBe(mini);

      const two = await seed();
      await report(mini, two.companyId, "2026-10-10T05:00:00Z", [other]);
      await report(studio, two.companyId, "2026-10-10T05:00:00Z", []);
      expect(await resolveAgentMachine(db, { companyId: two.companyId, agentId: two.agentId })).toBeNull();

      // Agent của company khác không được tra.
      expect(await resolveAgentMachine(db, { companyId: two.companyId, agentId: s.agentId })).toBeNull();
    });

    it("cổng giữ run khi công tắc máy tắt, ghi hàng chờ đúng một dòng; bật thì cho claim", async () => {
      const s = await seed();
      await report(mini, s.companyId, "2026-10-10T05:00:00Z", [workspace]);
      const deps = { ...defaultBeforeClaimDeps(db), loadTarget: async () => null };
      expect(await evaluateBeforeClaim({ db, run: s.run }, deps)).toBe(true);
      const [held] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, s.run.id));
      expect(await evaluateBeforeClaim({ db, run: held! }, deps)).toBe(true);
      const waits = await db.execute(sql.raw(`SELECT company_id::text AS company_id, issue_id::text AS issue_id, agent_id::text AS agent_id,
        machine_id::text AS machine_id, runtime, handled_at FROM ${crewRuntimeWaitsTable()} WHERE run_id = '${s.run.id}'`));
      expect(waits).toEqual([
        { company_id: s.companyId, issue_id: s.issueId, agent_id: s.agentId, machine_id: mini, runtime: "codex_local", handled_at: null },
      ]);
      const marks = await db.select().from(activityLog).where(and(eq(activityLog.runId, s.run.id), eq(activityLog.action, "crew.runtime_gate.waiting")));
      expect(marks).toHaveLength(1);
      expect(marks[0]?.details).toMatchObject({ runtime: "codex_local", machineId: mini, issueId: s.issueId });

      await setSwitch(s.companyId, mini, "codex_local", true);
      const [stillHeld] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, s.run.id));
      expect(await evaluateBeforeClaim({ db, run: stillHeld! }, deps)).toBe(false);
      const [released] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, s.run.id));
      expect((released?.resultJson as Record<string, unknown> | null)?.executionRecovery).toBeUndefined();
    });

    it("không giữ agent ngoài runtime Crew, agent Claude không environment, company không phải Crew", async () => {
      const deps = { ...defaultBeforeClaimDeps(db), loadTarget: async () => null };
      for (const opts of [{ adapterType: "process" }, { adapterType: "claude_local", environment: false }, { crew: false }]) {
        const s = await seed(opts);
        expect(await evaluateBeforeClaim({ db, run: s.run }, deps)).toBe(false);
      }
    });

    it("agent Codex/OpenCode không environment: công tắc mặc định (tắt) dù company một máy đã bật Codex", async () => {
      const deps = { ...defaultBeforeClaimDeps(db), loadTarget: async () => null };
      process.env[CREW_OPENCODE_IN_PLACE_PATCH_ENV] = "1";
      for (const adapterType of ["codex_local", "opencode_local"]) {
        const s = await seed({ adapterType, environment: false });
        await report(mini, s.companyId, "2026-10-10T05:00:00Z", []);
        await setSwitch(s.companyId, mini, adapterType, true);
        expect(await evaluateBeforeClaim({ db, run: s.run }, deps)).toBe(true);
        const marks = await db.select().from(activityLog).where(and(eq(activityLog.runId, s.run.id), eq(activityLog.action, "crew.runtime_gate.waiting")));
        expect(marks[0]?.details).toMatchObject({ runtime: adapterType, machineId: null });
      }
    });

    describe("run của agent đã bị chuyển đi", () => {
      async function fallback(s: Awaited<ReturnType<typeof seed>>, to: string, decidedAt: string) {
        await db.execute(sql.raw(`INSERT INTO ${ns()}.crew_runtime_decisions
          (company_id, issue_id, kind, run_id, from_agent_id, to_agent_id, from_runtime, to_runtime, trigger, reason, decided_at)
          VALUES ('${s.companyId}', '${s.issueId}', 'fallback', '${randomUUID()}', '${s.agentId}', '${to}', 'codex_local', 'claude_local',
          'quota', 'hết quota', '${decidedAt}')`));
      }

      async function newAgent(companyId: string) {
        const id = randomUUID();
        await db.insert(agents).values({
          id, companyId, name: "Executor Claude", role: "engineer", status: "idle", adapterType: "claude_local",
          adapterConfig: {}, permissions: {}, runtimeConfig: {},
        });
        return id;
      }

      it("hủy run queued của agent cũ khi quyết định fallback mới nhất chuyển khỏi nó và issue đã đổi assignee", async () => {
        const s = await seed();
        const target = await newAgent(s.companyId);
        const cancels: string[] = [];
        const deps = defaultRuntimeGateDeps(db, { scheduleCancel: (runId, reason) => cancels.push(`${runId}:${reason}`) });
        expect(await deps.cancelSuperseded(s.run)).toBe(false);
        await fallback(s, target, new Date(Date.now() + 1_000).toISOString());
        // Issue chưa đổi assignee: chưa hủy.
        expect(await deps.cancelSuperseded(s.run)).toBe(false);
        await db.update(issues).set({ assigneeAgentId: target }).where(eq(issues.id, s.issueId));
        expect(await deps.cancelSuperseded(s.run)).toBe(true);
        expect(cancels).toEqual([`${s.run.id}:crew_runtime_fallback`]);
      });

      it("không hủy run tạo sau quyết định (đánh thức mới, hợp lệ) hay khi quyết định mới nhất chuyển từ agent khác", async () => {
        const s = await seed();
        const target = await newAgent(s.companyId);
        await db.update(issues).set({ assigneeAgentId: target }).where(eq(issues.id, s.issueId));
        await fallback(s, target, new Date(Date.now() - 60_000).toISOString());
        const cancels: string[] = [];
        const deps = defaultRuntimeGateDeps(db, { scheduleCancel: (runId) => cancels.push(runId) });
        expect(await deps.cancelSuperseded(s.run)).toBe(false);

        const s2 = await seed();
        const t2 = await newAgent(s2.companyId);
        await db.update(issues).set({ assigneeAgentId: t2 }).where(eq(issues.id, s2.issueId));
        await fallback(s2, t2, new Date(Date.now() + 1_000).toISOString());
        await db.execute(sql.raw(`INSERT INTO ${ns()}.crew_runtime_decisions
          (company_id, issue_id, kind, from_agent_id, to_agent_id, reason, decided_at)
          VALUES ('${s2.companyId}', '${s2.issueId}', 'fallback', '${t2}', '${s2.agentId}', 'ngược lại', '${new Date(Date.now() + 2_000).toISOString()}')`));
        expect(await deps.cancelSuperseded(s2.run)).toBe(false);
        expect(cancels).toEqual([]);
      });

      it("run cũ của run chuyển runtime: quyết định fallback mới nhất tới agent này trên issue", async () => {
        const s = await seed();
        const target = await newAgent(s.companyId);
        const newRun = { ...s.run, id: randomUUID(), agentId: target };
        expect(await fallbackPreviousRunId(db, newRun)).toBeNull();
        const first = randomUUID(), second = randomUUID();
        await db.execute(sql.raw(`INSERT INTO ${ns()}.crew_runtime_decisions
          (company_id, issue_id, kind, run_id, from_agent_id, to_agent_id, reason, decided_at) VALUES
          ('${s.companyId}', '${s.issueId}', 'fallback', '${first}', '${s.agentId}', '${target}', 'a', '2026-10-10T05:00:00Z'),
          ('${s.companyId}', '${s.issueId}', 'fallback', '${second}', '${s.agentId}', '${target}', 'b', '2026-10-10T05:05:00Z'),
          ('${s.companyId}', '${s.issueId}', 'fallback_refused', '${randomUUID()}', '${s.agentId}', '${target}', 'c', '2026-10-10T05:10:00Z')`));
        expect(await fallbackPreviousRunId(db, newRun)).toBe(second);
        expect(await fallbackPreviousRunId(db, { ...newRun, companyId: randomUUID() })).toBeNull();

        // Run cũ đã được run khác kiểm: không kiểm lại; kết quả bẩn thì kiểm lại; dấu của chính run này không tính.
        const mark = (runId: string, details: Record<string, unknown>) => db.insert(activityLog).values({
          companyId: s.companyId, actorType: "system", actorId: "crew", action: "crew.runtime_fallback.checked",
          entityType: "heartbeat_run", entityId: runId, runId, details,
        });
        await mark(s.run.id, { previousRunId: second, detach: "dirty" });
        expect(await fallbackPreviousRunId(db, newRun)).toBe(second);
        expect(await fallbackPreviousRunId(db, { ...newRun, id: s.run.id })).toBe(second);
        await mark(s.run.id, { previousRunId: second, skipped: true });
        expect(await fallbackPreviousRunId(db, newRun)).toBeNull();
        expect(await fallbackPreviousRunId(db, { ...newRun, id: s.run.id })).toBe(second);

        // Quyết định fallback mới nhất trên issue chuyển sang agent khác: run của agent cũ không còn là run chuyển runtime.
        await db.execute(sql.raw(`INSERT INTO ${ns()}.crew_runtime_decisions
          (company_id, issue_id, kind, run_id, from_agent_id, to_agent_id, reason, decided_at) VALUES
          ('${s.companyId}', '${s.issueId}', 'fallback', '${randomUUID()}', '${target}', '${s.agentId}', 'd', now())`));
        expect(await fallbackPreviousRunId(db, { ...newRun, id: randomUUID() })).toBeNull();
      });

      it("run cũ bị giữ trước khi chạy: kiểm run gần nhất đã chạy của agent cũ trên issue", async () => {
        const s = await seed();
        const target = await newAgent(s.companyId);
        const newRun = { ...s.run, id: randomUUID(), agentId: target };
        const ran = randomUUID(), heldRun = randomUUID();
        await db.insert(heartbeatRuns).values([
          { id: ran, companyId: s.companyId, agentId: s.agentId, status: "succeeded", invocationSource: "assignment",
            contextSnapshot: { issueId: s.issueId }, startedAt: new Date(Date.now() - 30 * 60_000) },
          // Run của agent cũ trên issue khác không tính.
          { id: randomUUID(), companyId: s.companyId, agentId: s.agentId, status: "succeeded", invocationSource: "assignment",
            contextSnapshot: { issueId: randomUUID() }, startedAt: new Date(Date.now() - 20 * 60_000) },
          { id: heldRun, companyId: s.companyId, agentId: s.agentId, status: "cancelled", invocationSource: "assignment",
            contextSnapshot: { issueId: s.issueId } },
        ]);
        await db.execute(sql.raw(`INSERT INTO ${ns()}.crew_runtime_decisions
          (company_id, issue_id, kind, run_id, from_agent_id, to_agent_id, reason, decided_at) VALUES
          ('${s.companyId}', '${s.issueId}', 'fallback', '${heldRun}', '${s.agentId}', '${target}', 'tắt', now())`));
        expect(await fallbackPreviousRunId(db, newRun)).toBe(ran);
        await db.update(heartbeatRuns).set({ startedAt: null }).where(eq(heartbeatRuns.id, ran));
        expect(await fallbackPreviousRunId(db, newRun)).toBe(heldRun);
      });
    });
  });
});

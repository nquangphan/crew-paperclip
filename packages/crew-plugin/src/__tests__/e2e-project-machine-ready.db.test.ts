/**
 * E2E (tích hợp trên Postgres nhúng) của TPS-742: máy dựng xong project thì `project_machines` thành `ready`, không kẹt
 * `provisioning` khi agent đã có environment trên máy ghim. Luồng server thật từ đầu tới cuối, không gọi route trang Máy:
 * `startProvisioning` xếp `ensure-project` → máy lấy việc và báo `done` bằng `claimNextJob`/`finishJob` của plugin → cổng claim
 * của H1 (`evaluateMachineGate`) → đọc lại `project_machines` → Bug Finding (`handleIssueUpdated`) chọn máy ghim.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Issue, PluginContext, PluginEvent } from "@paperclipai/plugin-sdk";
import { heartbeatRuns, issues } from "../../../db/src/index.js";
import { handleIssueUpdated } from "../bug-finding/enqueue.js";
import { claimNextJob, finishJob } from "../jobs/data.js";
import { type PluginHost, startPluginHost } from "./plugin-host-db.js";
import {
  MINI, seedAddProjectRun, seedCrewProject, seedEnsureJob, seedPairing, seedReport, seedTemplate, type SeededProject,
} from "../../../../server/src/__tests__/helpers/crew-machine-tables.js";

vi.mock("../../../../server/src/services/secrets.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../server/src/services/secrets.ts")>()),
  secretService: () => ({ replaceSecretRefsForInstanceTarget: async () => undefined, syncEnvBindingsForTarget: async () => undefined }),
}));

import { evaluateMachineGate } from "../../../../server/src/crew/machine-gate.ts";
import { readProjectMachine, startProvisioning, writeProjectRepo } from "../../../../server/src/crew/machine-provision.ts";
import { provisionOtherMachines } from "../../../../server/src/crew/machine-release.ts";
import { readPin, setOwnerPin } from "../../../../server/src/crew/machine-pin.ts";

const REPO = "/Users/owner/crew-agents/my-crew/repo";
const HEAD = "b".repeat(40);
const PR = "https://github.com/nquangphan/my-crew/pull/87";
const ROLES = ["assistant", "executor-1", "reviewer", "integrator"] as const;

let host: PluginHost;

beforeAll(async () => { host = await startPluginHost("crew-e2e-project-machine-"); }, 120_000);
afterAll(async () => { await host?.cleanup(); });

const rows = async <T,>(statement: string, params: unknown[] = []) => (await host.sql.unsafe(statement, params as never[])) as unknown as T[];

/** Project `my-crew` có repo, vai trò, máy Mac mini đã ghép (agent có environment mặc định ở máy này), cây issue và ghim owner. */
async function world() {
  const p = await seedCrewProject(host.db, host.ns, { key: "my-crew", host: MINI.ip });
  await seedPairing(host.db, host.ns, p.companyId, MINI, await seedTemplate(host.db, MINI));
  const now = new Date();
  await seedReport(host.db, host.ns, p.companyId, MINI, { receivedAt: now, load1: 1, cpuCount: 10, memFreePct: 54, pollAt: now });
  await host.sql.unsafe(`UPDATE ${host.ns}.machine_latest SET report = jsonb_set(report, '{jobsAgent,capabilities}', '["bug-finding-review"]'::jsonb)
    WHERE company_id = $1 AND machine_id = $2`, [p.companyId, MINI.machineId]);
  await writeProjectRepo(host.db, { companyId: p.companyId, projectId: p.projectId, userId: "owner",
    repo: { originUrl: "git@github.com:nquangphan/my-crew.git", branch: "main", companions: [] } });
  const [root] = await host.db.insert(issues).values({ companyId: p.companyId, projectId: p.projectId, title: "Ticket tổng", status: "in_review" }).returning();
  const [child] = await host.db.insert(issues).values({ companyId: p.companyId, projectId: p.projectId, parentId: root!.id, title: "Con", status: "todo" }).returning();
  await setOwnerPin(host.db, { companyId: p.companyId, rootIssueId: root!.id, machineId: MINI.machineId });
  return { ...p, root: root!.id, child: child!.id };
}
type World = Awaited<ReturnType<typeof world>>;

/** Owner bấm dựng (một lần) và máy Mac mini lấy việc `ensure-project` rồi báo `done` với `repoPath` và checkout của mọi vai trò. */
async function machineEnsuresProject(w: World) {
  expect(await startProvisioning(host.db, { companyId: w.companyId, projectId: w.projectId, machineId: MINI.machineId, createdBy: "owner" }))
    .toMatchObject({ ok: true });
  const claimed = await claimNextJob(host.ctx as never, w.companyId, MINI.machineId, new Date());
  expect(claimed).toMatchObject({ kind: "ensure-project", status: "claimed" });
  const result = {
    kind: "ensure-project", repoPath: REPO, cloned: true, companions: [],
    checkouts: ROLES.map((role) => ({ role, path: `/Users/owner/crew-agents/my-crew/${role}`, head: "d".repeat(40) })),
  };
  expect(await finishJob(host.ctx as never, w.companyId, claimed!.id, MINI.machineId, { status: "done", result: result as never }, new Date())).toBe(true);
}

async function queuedRun(w: World, agent: SeededProject["agents"][(typeof ROLES)[number]]) {
  const [run] = await host.db.insert(heartbeatRuns).values({
    companyId: w.companyId, agentId: agent.agentId, status: "queued", invocationSource: "on_demand", responsibleUserId: "owner",
    contextSnapshot: { issueId: w.child },
  }).returning();
  return run!;
}

/** Ticket tổng `code-bf` đang ở stage cầu nối với `crew-pr` của integrator; `ctx.issues` đọc từ đúng dữ liệu của `w`. */
function bugFindingCtx(w: World) {
  const stages = [
    { id: "s-merge", type: "review", participants: [{ id: "p1", type: "agent", agentId: w.agents.integrator.agentId }] },
    { id: "s-bridge", type: "review", participants: [{ id: "p2", type: "agent", agentId: w.agents.reviewer.agentId }] },
    { id: "s-owner", type: "approval", participants: [{ id: "p3", type: "user", userId: "owner" }] },
    { id: "s-push", type: "review", participants: [{ id: "p4", type: "agent", agentId: w.agents.integrator.agentId }] },
  ];
  const issue = {
    id: w.root, companyId: w.companyId, projectId: w.projectId, identifier: "TPS-900", status: "in_review", parentId: null,
    assigneeAgentId: w.agents.reviewer.agentId,
    executionPolicy: { mode: "normal", commentRequired: true, maxReviewRounds: 5, stages },
    executionState: {
      status: "pending", currentStageId: "s-bridge", currentStageIndex: 1, currentStageType: "review",
      currentParticipant: { type: "agent", agentId: w.agents.reviewer.agentId, userId: null },
      returnAssignee: { type: "agent", agentId: w.agents.assistant.agentId, userId: null }, reviewRequest: null,
      completedStageIds: ["s-merge"], lastDecisionId: null, lastDecisionOutcome: null,
    },
  } as unknown as Issue;
  const ctx = {
    ...host.ctx,
    issues: {
      get: async (id: string, company: string) => (id === w.root && company === w.companyId ? structuredClone(issue) : null),
      listComments: async () => [{ id: "c-1", issueId: w.root, authorAgentId: w.agents.integrator.agentId, body: `crew-pr sha=${HEAD} pr=${PR}`, createdAt: new Date(Date.now() - 60_000) }],
      createComment: async () => ({ id: "c-new" }),
      requestWakeup: async () => ({ queued: true, runId: null }),
      documents: { upsert: async () => ({ id: "d-1" }) },
      listInteractions: async () => [],
    },
  } as unknown as PluginContext;
  const event: PluginEvent = {
    eventId: `e-${w.root}`, eventType: "issue.updated", occurredAt: new Date().toISOString(), entityId: w.root, entityType: "issue",
    companyId: w.companyId, payload: {},
  };
  return { ctx, event };
}
const bugFindingRuns = (w: World) => rows<{ run: number; state: string; machine_id: string; error: string | null }>(
  `SELECT run, state, machine_id::text AS machine_id, error FROM ${host.ns}.crew_bug_finding_runs WHERE issue_id = $1 ORDER BY run`, [w.root]);
const bugFindingJobs = (w: World) => rows<{ machine_id: string; payload: Record<string, unknown> }>(
  `SELECT machine_id::text AS machine_id, payload FROM ${host.ns}.crew_machine_jobs WHERE company_id = $1 AND kind = 'bug-finding-review'`, [w.companyId]);

describe("máy dựng xong project (ensure-project done) → project_machines ready, Bug Finding chọn được máy ghim", () => {
  it("namespace plugin của host trùng namespace server ghi (cùng một bảng)", async () => {
    const w = await world();
    await startProvisioning(host.db, { companyId: w.companyId, projectId: w.projectId, machineId: MINI.machineId, createdBy: "owner" });
    expect(await rows(`SELECT 1 FROM ${host.ns}.project_machines WHERE company_id = $1`, [w.companyId])).toHaveLength(1);
  });

  it("agent đã có environment trên máy ghim, ensure-project done: cổng claim đưa dòng provisioning thành ready kèm repo_path, không qua route trang Máy", async () => {
    const w = await world();
    await machineEnsuresProject(w);
    expect(await readProjectMachine(host.db, w.companyId, w.projectId, MINI.machineId)).toMatchObject({ status: "provisioning", repoPath: null });

    const run = await queuedRun(w, w.agents["executor-1"]);
    expect(await evaluateMachineGate(host.db, run)).toEqual({ action: "pass", environmentId: w.agents["executor-1"].environmentId });

    expect(await readProjectMachine(host.db, w.companyId, w.projectId, MINI.machineId)).toMatchObject({ status: "ready", error: null, repoPath: REPO });
    expect(await readPin(host.db, w.companyId, w.root)).toMatchObject({ machineId: MINI.machineId, source: "owner" });
  });

  it("Bug Finding chọn được máy ghim sau luồng đó: xếp việc bug-finding-review với repo của máy, không báo máy chưa có repo", async () => {
    const w = await world();
    await machineEnsuresProject(w);
    expect(await evaluateMachineGate(host.db, await queuedRun(w, w.agents.reviewer))).toMatchObject({ action: "pass" });
    expect(await readProjectMachine(host.db, w.companyId, w.projectId, MINI.machineId)).toMatchObject({ status: "ready", repoPath: REPO });

    const { ctx, event } = bugFindingCtx(w);
    await handleIssueUpdated(ctx, event);

    expect(await bugFindingRuns(w)).toEqual([{ run: 1, state: "requested", machine_id: MINI.machineId, error: null }]);
    expect(await bugFindingJobs(w)).toMatchObject([{ machine_id: MINI.machineId, payload: { repoPath: REPO, projectKey: "my-crew", headSha: HEAD, prNumber: 87 } }]);
  });

  it("Bug Finding đến trước cổng claim: dòng còn provisioning nhưng việc done kèm repoPath vẫn chọn được máy ghim (chỉ đọc, dòng không đổi)", async () => {
    const w = await world();
    await machineEnsuresProject(w);
    const { ctx, event } = bugFindingCtx(w);
    await handleIssueUpdated(ctx, event);
    expect(await bugFindingRuns(w)).toEqual([{ run: 1, state: "requested", machine_id: MINI.machineId, error: null }]);
    expect(await readProjectMachine(host.db, w.companyId, w.projectId, MINI.machineId)).toMatchObject({ status: "provisioning", repoPath: null });
  });

  it("dòng ready giữ nguyên qua cổng; dòng failed giữ nguyên và Bug Finding vẫn báo máy ghim chưa có repo", async () => {
    for (const status of ["ready", "failed"] as const) {
      const w = await world();
      await machineEnsuresProject(w);
      const stored = status === "ready" ? "/Users/cu/crew-agents/my-crew/repo" : null;
      await host.sql.unsafe(`UPDATE ${host.ns}.project_machines SET status = $3, repo_path = $4, error = $5 WHERE company_id = $1 AND machine_id = $2`,
        [w.companyId, MINI.machineId, status, stored, status === "failed" ? "Máy không dựng checkout reviewer" : null]);
      const before = await readProjectMachine(host.db, w.companyId, w.projectId, MINI.machineId);

      expect(await evaluateMachineGate(host.db, await queuedRun(w, w.agents.assistant))).toEqual({ action: "pass", environmentId: w.agents.assistant.environmentId });
      expect(await readProjectMachine(host.db, w.companyId, w.projectId, MINI.machineId)).toEqual(before);

      const { ctx, event } = bugFindingCtx(w);
      await handleIssueUpdated(ctx, event);
      if (status === "ready") {
        expect(await bugFindingJobs(w)).toMatchObject([{ payload: { repoPath: stored } }]);
      } else {
        expect(await bugFindingRuns(w)).toMatchObject([{ state: "failed", machine_id: MINI.machineId, error: "Máy đã ghim chưa có repo của project" }]);
      }
    }
  });
});

const NO_REPO_ERROR = "Máy đã ghim chưa có repo của project";
const WIZARD_REPO = "/Users/owner/Projects/my-crew";

/** App thêm project / wizard xong trên máy chính (MINI): server dựng sẵn máy khác và ghi máy chính `ready` (`markPrimaryReady`). */
const markPrimary = (w: World) => provisionOtherMachines(host.db, {
  companyId: w.companyId, projectId: w.projectId, exceptMachineId: MINI.machineId, includeReady: false, repo: null, createdBy: "owner",
});
const primaryRow = async (w: World) => (await rows<{ status: string; repo_path: string | null; error: string | null }>(
  `SELECT status, repo_path, error FROM ${host.ns}.project_machines WHERE company_id = $1 AND machine_id = $2`, [w.companyId, MINI.machineId]))[0] ?? null;
const insertPrimaryRow = (w: World, status: string, repoPath: string | null, error: string | null = null) => host.sql.unsafe(
  `INSERT INTO ${host.ns}.project_machines (company_id, project_id, machine_id, status, repo_path, error) VALUES ($1, $2, $3, $4, $5, $6)`,
  [w.companyId, w.projectId, MINI.machineId, status, repoPath, error]);
const addProjectRun = (w: World, root: string) => seedAddProjectRun(host.db, host.ns, { companyId: w.companyId, projectId: w.projectId, machine: MINI, key: "my-crew", root });

describe("máy chính ghi ready (markPrimaryReady) → dòng có repo_path tuyệt đối, Bug Finding chọn được máy chính", () => {
  it("wizard xong trên máy chính: dòng ready kèm repo gốc của lần thêm project, Bug Finding xếp việc với đúng repo đó", async () => {
    const w = await world();
    await addProjectRun(w, WIZARD_REPO);
    await markPrimary(w);
    expect(await primaryRow(w)).toEqual({ status: "ready", repo_path: WIZARD_REPO, error: null });

    const { ctx, event } = bugFindingCtx(w);
    await handleIssueUpdated(ctx, event);
    expect(await bugFindingRuns(w)).toEqual([{ run: 1, state: "requested", machine_id: MINI.machineId, error: null }]);
    expect(await bugFindingJobs(w)).toMatchObject([{ machine_id: MINI.machineId, payload: { repoPath: WIZARD_REPO, projectKey: "my-crew", headSha: HEAD, prNumber: 87 } }]);
  });

  it("máy chính đã có việc ensure-project done: repoPath của việc được ưu tiên hơn repo gốc của lần thêm project", async () => {
    const w = await world();
    await addProjectRun(w, "/Users/owner/old-root");
    await seedEnsureJob(host.db, host.ns, { companyId: w.companyId, projectId: w.projectId, machine: MINI, status: "done", repoPath: REPO });
    await markPrimary(w);
    expect(await primaryRow(w)).toEqual({ status: "ready", repo_path: REPO, error: null });

    const { ctx, event } = bugFindingCtx(w);
    await handleIssueUpdated(ctx, event);
    expect(await bugFindingJobs(w)).toMatchObject([{ machine_id: MINI.machineId, payload: { repoPath: REPO } }]);
  });

  it("không có nguồn repo nào: dòng không được ghi ready, Bug Finding báo máy chưa có repo và không xếp việc", async () => {
    const w = await world();
    await markPrimary(w);
    expect(await primaryRow(w)).toBeNull();

    const { ctx, event } = bugFindingCtx(w);
    await handleIssueUpdated(ctx, event);
    expect(await bugFindingRuns(w)).toMatchObject([{ state: "failed", error: NO_REPO_ERROR }]);
    expect(await bugFindingJobs(w)).toEqual([]);
  });
});

describe("dòng ready thiếu repo_path (dữ liệu cũ) không làm Bug Finding chọn repo rỗng", () => {
  it("ready NULL và không có nguồn repo nào: lượt failed với lý do rõ ràng, không xếp việc", async () => {
    const w = await world();
    await insertPrimaryRow(w, "ready", null);
    const { ctx, event } = bugFindingCtx(w);
    await handleIssueUpdated(ctx, event);
    expect(await bugFindingRuns(w)).toEqual([{ run: 1, state: "failed", machine_id: MINI.machineId, error: NO_REPO_ERROR }]);
    expect(await bugFindingJobs(w)).toEqual([]);
  });

  it("ready với repo_path rỗng hay tương đối cũng coi là thiếu repo", async () => {
    for (const bad of ["", "relative/repo"]) {
      const w = await world();
      await insertPrimaryRow(w, "ready", bad);
      const { ctx, event } = bugFindingCtx(w);
      await handleIssueUpdated(ctx, event);
      expect(await bugFindingRuns(w)).toMatchObject([{ state: "failed", error: NO_REPO_ERROR }]);
      expect(await bugFindingJobs(w)).toEqual([]);
    }
  });

  it("ready NULL nhưng có repo gốc của lần thêm project: xếp được lượt lên máy ghim với repo đó, dòng không bị ghi đè (chỉ đọc)", async () => {
    const w = await world();
    await insertPrimaryRow(w, "ready", null);
    await addProjectRun(w, WIZARD_REPO);
    const { ctx, event } = bugFindingCtx(w);
    await handleIssueUpdated(ctx, event);
    expect(await bugFindingRuns(w)).toEqual([{ run: 1, state: "requested", machine_id: MINI.machineId, error: null }]);
    expect(await bugFindingJobs(w)).toMatchObject([{ machine_id: MINI.machineId, payload: { repoPath: WIZARD_REPO } }]);
    expect(await primaryRow(w)).toEqual({ status: "ready", repo_path: null, error: null });
  });

  it("ready NULL có việc ensure-project done: dùng repoPath của việc; lần dựng sau của máy chính điền repo_path vào dòng", async () => {
    const w = await world();
    await insertPrimaryRow(w, "ready", null);
    await seedEnsureJob(host.db, host.ns, { companyId: w.companyId, projectId: w.projectId, machine: MINI, status: "done", repoPath: REPO });
    const { ctx, event } = bugFindingCtx(w);
    await handleIssueUpdated(ctx, event);
    expect(await bugFindingJobs(w)).toMatchObject([{ payload: { repoPath: REPO } }]);

    await markPrimary(w);
    expect(await primaryRow(w)).toEqual({ status: "ready", repo_path: REPO, error: null });
  });

  it("dòng failed vẫn không dùng được dù có nguồn repo khác (hành vi cũ)", async () => {
    const w = await world();
    await insertPrimaryRow(w, "failed", null, "Máy không dựng checkout reviewer");
    await addProjectRun(w, WIZARD_REPO);
    const { ctx, event } = bugFindingCtx(w);
    await handleIssueUpdated(ctx, event);
    expect(await bugFindingRuns(w)).toMatchObject([{ state: "failed", error: NO_REPO_ERROR }]);
    expect(await bugFindingJobs(w)).toEqual([]);
  });

  it("dòng ready đã có repo_path tuyệt đối giữ nguyên qua lần dựng sau và Bug Finding dùng đúng repo đó", async () => {
    const w = await world();
    await insertPrimaryRow(w, "ready", "/Users/owner/hand-filled");
    await addProjectRun(w, WIZARD_REPO);
    await markPrimary(w);
    expect(await primaryRow(w)).toEqual({ status: "ready", repo_path: "/Users/owner/hand-filled", error: null });
    const { ctx, event } = bugFindingCtx(w);
    await handleIssueUpdated(ctx, event);
    expect(await bugFindingJobs(w)).toMatchObject([{ payload: { repoPath: "/Users/owner/hand-filled" } }]);
  });
});

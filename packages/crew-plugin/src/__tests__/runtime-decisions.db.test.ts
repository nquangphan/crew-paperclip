import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Issue, PluginContext, PluginEvent } from "@paperclipai/plugin-sdk";
import { upsertProjectRoles } from "../roles/data.js";
import {
  chooseReviewer, handleIssueCreated, insertRuntimeDecision, loadRuntimeDecisions, registerRuntimeDecisions,
} from "../runtimes/decisions.js";
import { type PluginHost, startPluginHost } from "./plugin-host-db.js";

const companyId = "10000000-0000-4000-8000-000000000001";
const otherCompany = "10000000-0000-4000-8000-000000000002";
const projectId = "20000000-0000-4000-8000-000000000001";
const looseProject = "20000000-0000-4000-8000-000000000002";
const mini = "50000000-0000-4000-8000-000000000001";
const env = "80000000-0000-4000-8000-000000000001";
const agent = (n: number) => `40000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const [assistant, executor, codexExec, reviewer, codexReviewer, integrator] = [1, 2, 3, 4, 5, 6].map(agent);
const issueId = (n: number) => `30000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;

let host: PluginHost;
let ctx: PluginContext;
const issues = new Map<string, Issue>();
const reviewStage = (...ids: string[]) => ({ id: "s-review", type: "review", participants: ids.map((id) => ({ id: `p-${id}`, type: "agent", agentId: id })) });
const childPolicy = (...ids: string[]) => ({ mode: "normal", maxReviewRounds: 5, stages: [reviewStage(...ids)] });
const rootPolicy = {
  mode: "normal", maxReviewRounds: 5, stages: [reviewStage(reviewer), reviewStage(integrator),
    { id: "s-owner", type: "approval", participants: [{ id: "p-owner", type: "user", userId: "owner" }] }, reviewStage(integrator)],
};
const MARKER_CLAUDE = "Việc nhỏ\n\ncrew-model complexity=medium model=claude-sonnet-5 effort=high reason=sửa ba file, có test\n";
const MARKER_CODEX = "crew-model complexity=medium model=gpt-6-sol effort=high runtime=codex_local reason=thử Codex";

function addIssue(n: number, fields: Partial<Issue>): string {
  const id = issueId(n);
  issues.set(id, { id, companyId, projectId, status: "todo", description: null, assigneeAgentId: executor, ...fields } as Issue);
  return id;
}
const created = (id: string, company = companyId): PluginEvent => ({
  eventId: `e-${id}`, eventType: "issue.created", occurredAt: new Date().toISOString(), entityId: id, entityType: "issue",
  companyId: company, payload: {},
});
const rows = (id: string) => host.sql.unsafe(
  `SELECT role, kind, to_agent_id::text AS to_agent_id, to_runtime, model, complexity, reason, machine_id::text AS machine_id
   FROM ${host.ns}.crew_runtime_decisions WHERE issue_id = $1 ORDER BY role`, [id]);

beforeAll(async () => {
  host = await startPluginHost("crew-runtime-decisions-");
  const { sql, ns } = host;
  ctx = {
    ...host.ctx,
    config: { get: async () => ({}) },
    issues: { get: async (id: string, company: string) => { const issue = issues.get(id); return issue && issue.companyId === company ? issue : null; } },
  } as unknown as PluginContext;
  await sql`INSERT INTO companies (id,name,issue_prefix) VALUES (${companyId},'Crew','CRE'),(${otherCompany},'Other','OTH')`;
  await sql`INSERT INTO projects (id,company_id,name) VALUES (${projectId},${companyId},'Repo A'),(${looseProject},${companyId},'Không Crew')`;
  await sql`INSERT INTO environments (id,name,driver,config) VALUES (${env},'repo-a','ssh',${sql.json({ remoteWorkspacePath: "/Users/o/crew-agents/repo-a/x" })})`;
  for (const [id, name, adapter] of [[assistant, "Trợ Lý", "claude_local"], [executor, "repo-a-executor", "claude_local"],
    [codexExec, "repo-a-codex", "codex_local"], [reviewer, "Reviewer", "claude_local"], [codexReviewer, "Reviewer Codex", "codex_local"],
    [integrator, "Integrator", "claude_local"]] as const) {
    await sql`INSERT INTO agents (id,company_id,name,adapter_type,default_environment_id) VALUES (${id},${companyId},${name},${adapter},${env})`;
  }
  await upsertProjectRoles(host.ctx, companyId, projectId, {
    assistantAgentId: assistant, executorAgentIds: [executor], reviewerAgentId: reviewer, integratorAgentId: integrator,
    codexExecutorAgentId: codexExec, opencodeExecutorAgentId: null, codexReviewerAgentId: codexReviewer,
  }, "owner");
  // Company chỉ có một máy nên mọi agent có environment chạy trên máy đó.
  await sql.unsafe(`INSERT INTO ${ns}.machine_latest (company_id,machine_id,hostname,received_at,sent_at,report)
    VALUES ($1,$2,'mac-mini',now(),now(),'{}'::jsonb)`, [companyId, mini]);
}, 120_000);
afterAll(async () => { await host?.cleanup(); });
beforeEach(async () => {
  await host.sql.unsafe(`DELETE FROM ${host.ns}.crew_runtime_decisions`);
  await host.sql.unsafe(`DELETE FROM ${host.ns}.crew_runtime_switches`);
  await host.sql`UPDATE agents SET status = 'idle' WHERE company_id = ${companyId}`;
  issues.clear();
  host.logs.length = 0;
});

describe("chooseReviewer (bản chép server)", () => {
  const base = { template: "child" as const, executorRuntime: "claude_local" as const, claudeReviewerAgentId: reviewer,
    codexReviewer: { agentId: codexReviewer, status: "idle" }, codexSwitchOn: true };
  it.each([
    [base, codexReviewer, "executor claude_local, Codex bật → reviewer codex_local"],
    [{ ...base, template: "root" as const }, reviewer, "chỉ issue con được reviewer Codex"],
    [{ ...base, executorRuntime: "codex_local" as const }, reviewer, "executor đã là Codex"],
    [{ ...base, codexReviewer: null }, reviewer, "không có reviewer Codex"],
    [{ ...base, codexReviewer: { agentId: codexReviewer, status: "terminated" } }, reviewer, "không có reviewer Codex"],
    [{ ...base, codexReviewer: { agentId: codexReviewer, status: "paused" } }, reviewer, "reviewer Codex đang pause"],
    [{ ...base, codexSwitchOn: false }, reviewer, "Codex đang tắt trên máy reviewer"],
  ])("ca %#", (input, agentId, reason) => {
    expect(chooseReviewer(input)).toMatchObject({ agentId, reason });
  });
});

describe("dòng select khi có issue mới", () => {
  it("đăng ký data crew.runtimeDecisions và sự kiện issue.created", () => {
    const data: string[] = [];
    const events: string[] = [];
    registerRuntimeDecisions({ ...ctx, data: { register: (key: string) => { data.push(key); } }, events: { on: (name: string) => { events.push(name); } } } as unknown as PluginContext);
    expect(data).toEqual(["crew.runtimeDecisions"]);
    expect(events).toEqual(["issue.created"]);
  });

  it("issue con Claude được reviewer Codex: một dòng executor theo marker, một dòng reviewer; gửi lại sự kiện vẫn hai dòng", async () => {
    const id = addIssue(1, { description: MARKER_CLAUDE, executionPolicy: childPolicy(codexReviewer, reviewer) as never });
    await handleIssueCreated(ctx, created(id));
    await handleIssueCreated(ctx, created(id));
    expect(await rows(id)).toEqual([
      { role: "executor", kind: "select", to_agent_id: executor, to_runtime: "claude_local", model: "claude-sonnet-5",
        complexity: "medium", reason: "sửa ba file, có test", machine_id: mini },
      { role: "reviewer", kind: "select", to_agent_id: codexReviewer, to_runtime: "codex_local", model: "gpt-6-sol",
        complexity: null, reason: "executor claude_local, Codex bật → reviewer codex_local", machine_id: mini },
    ]);
  });

  it("executor Codex theo marker: reviewer Claude vì executor đã là Codex", async () => {
    const id = addIssue(2, { description: MARKER_CODEX, assigneeAgentId: codexExec, executionPolicy: childPolicy(reviewer) as never });
    await handleIssueCreated(ctx, created(id));
    expect(await rows(id)).toEqual([
      expect.objectContaining({ role: "executor", to_agent_id: codexExec, to_runtime: "codex_local", model: "gpt-6-sol", reason: "thử Codex" }),
      expect.objectContaining({ role: "reviewer", to_agent_id: reviewer, to_runtime: "claude_local", model: null, reason: "executor đã là Codex" }),
    ]);
  });

  it("lý do reviewer Claude tính lại theo luật: không marker thì runtime từ assignee; Codex tắt, pause; issue gốc", async () => {
    const off = addIssue(3, { executionPolicy: childPolicy(reviewer) as never });
    await handleIssueCreated(ctx, created(off));
    expect(await rows(off)).toEqual([expect.objectContaining({ role: "reviewer", reason: "Codex đang tắt trên máy reviewer" })]);

    const byAssignee = addIssue(4, { assigneeAgentId: codexExec, executionPolicy: childPolicy(reviewer) as never });
    await handleIssueCreated(ctx, created(byAssignee));
    expect(await rows(byAssignee)).toEqual([expect.objectContaining({ reason: "executor đã là Codex" })]);

    await host.sql`UPDATE agents SET status = 'paused' WHERE id = ${codexReviewer}`;
    const paused = addIssue(5, { executionPolicy: childPolicy(reviewer) as never });
    await handleIssueCreated(ctx, created(paused));
    expect(await rows(paused)).toEqual([expect.objectContaining({ reason: "reviewer Codex đang pause" })]);

    await host.sql`UPDATE agents SET status = 'idle' WHERE id = ${codexReviewer}`;
    await host.sql.unsafe(`INSERT INTO ${host.ns}.crew_runtime_switches (company_id,machine_id,runtime,enabled,updated_by_user_id)
      VALUES ($1,$2,'codex_local',true,'owner')`, [companyId, mini]);
    const root = addIssue(6, { executionPolicy: rootPolicy as never });
    await handleIssueCreated(ctx, created(root));
    expect(await rows(root)).toEqual([expect.objectContaining({ role: "reviewer", to_agent_id: reviewer, reason: "chỉ issue con được reviewer Codex" })]);
    // Codex đang bật mà server vẫn chọn Claude (công tắc vừa đổi, hay server đọc lỗi): không đoán lý do.
    const raced = addIssue(7, { executionPolicy: childPolicy(reviewer) as never });
    await handleIssueCreated(ctx, created(raced));
    expect(await rows(raced)).toEqual([expect.objectContaining({ reason: "reviewer Claude của project" })]);
  });

  it("không ghi: project không phải Crew, issue không có project, company khác, sự kiện không phải issue; lỗi chỉ ghi log", async () => {
    const loose = addIssue(8, { projectId: looseProject, description: MARKER_CLAUDE, executionPolicy: childPolicy(reviewer) as never });
    const noProject = addIssue(9, { projectId: null, description: MARKER_CLAUDE });
    await handleIssueCreated(ctx, created(loose));
    await handleIssueCreated(ctx, created(noProject));
    await handleIssueCreated(ctx, created(loose, otherCompany));
    await handleIssueCreated(ctx, { ...created(loose), entityType: "agent" });
    expect(await host.sql.unsafe(`SELECT count(*)::int AS n FROM ${host.ns}.crew_runtime_decisions`)).toEqual([{ n: 0 }]);
    const id = addIssue(10, { description: MARKER_CLAUDE });
    host.fail.error = new Error("db down");
    await expect(handleIssueCreated(ctx, created(id))).resolves.toBeUndefined();
    host.fail.error = null;
    expect(host.logs).toEqual([expect.objectContaining({ level: "warn", message: "crew runtime decisions: recording the selection failed" })]);
  });
});

describe("data crew.runtimeDecisions", () => {
  it("mới nhất trước, tối đa 50, kèm tên agent, chỉ trong company; id sai thì ném", async () => {
    const id = issueId(20);
    for (let i = 0; i < 55; i++) {
      await insertRuntimeDecision(host.ctx, {
        companyId, issueId: id, role: "executor", kind: "fallback", runId: `60000000-0000-4000-8000-${i.toString().padStart(12, "0")}`,
        fromAgentId: codexExec, toAgentId: executor, fromRuntime: "codex_local", toRuntime: "claude_local",
        model: "claude-sonnet-5", complexity: "medium", trigger: "quota", reason: `lần ${i}`,
      });
    }
    await host.sql.unsafe(`UPDATE ${host.ns}.crew_runtime_decisions SET decided_at = now() - (interval '1 minute' * (100 - id))`);
    const list = await loadRuntimeDecisions(host.ctx, { companyId, issueId: id });
    expect(list).toHaveLength(50);
    expect(list[0]).toEqual({
      id: expect.any(String), role: "executor", kind: "fallback", runId: "60000000-0000-4000-8000-000000000054", machineId: null,
      fromAgentId: codexExec, fromAgentName: "repo-a-codex", toAgentId: executor, toAgentName: "repo-a-executor",
      fromRuntime: "codex_local", toRuntime: "claude_local", model: "claude-sonnet-5", complexity: "medium", trigger: "quota",
      reason: "lần 54", decidedAt: expect.stringMatching(/Z$/),
    });
    expect(list.at(-1)?.reason).toBe("lần 5");
    // Cùng run, cùng kind: một dòng.
    expect(await insertRuntimeDecision(host.ctx, { companyId, issueId: id, role: "executor", kind: "fallback",
      runId: "60000000-0000-4000-8000-000000000000", reason: "lặp" })).toBe(false);
    expect(await loadRuntimeDecisions(host.ctx, { companyId: otherCompany, issueId: id })).toEqual([]);
    await expect(loadRuntimeDecisions(host.ctx, { companyId, issueId: "x" })).rejects.toThrow("ID không hợp lệ");
  });
});

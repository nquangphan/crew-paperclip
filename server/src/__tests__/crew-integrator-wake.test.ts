import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import manifest from "../../../packages/crew-plugin/src/manifest.ts";
import { integratorAgentIdOf, registerIntegratorWake } from "../../../packages/crew-plugin/src/integrator-wake.ts";

const COMPANY = "company-1";
const INTEGRATOR = "agent-integrator";
const REVIEWER = "agent-reviewer";
const COMPLETED = new Date("2026-10-07T03:00:00.000Z");

const rootPolicy = {
  stages: [
    { type: "review", participants: [{ type: "agent", agentId: REVIEWER }] },
    { type: "review", participants: [{ type: "agent", agentId: INTEGRATOR }] },
    { type: "approval", participants: [{ type: "user", userId: "owner-1" }] },
  ],
  maxReviewRounds: 5,
};

async function setup(overrides: Record<string, unknown> = {}) {
  const harness = createTestHarness({
    manifest,
    capabilities: [...manifest.capabilities, "issues.create", "issue.comments.read"],
  });
  const invoked: Array<{ agentId: string; companyId: string; opts: { prompt: string; reason?: string } }> = [];
  const realInvoke = harness.ctx.agents.invoke.bind(harness.ctx.agents);
  harness.ctx.agents.invoke = async (agentId, companyId, opts) => {
    invoked.push({ agentId, companyId, opts });
    return realInvoke(agentId, companyId, opts);
  };
  registerIntegratorWake(harness.ctx);
  const created = await harness.ctx.issues.create({ companyId: COMPANY, title: "yêu cầu gốc" });
  harness.seed({
    issues: [
      {
        ...created,
        status: "done",
        parentId: null,
        identifier: "CREA-9",
        executionPolicy: rootPolicy,
        completedAt: COMPLETED,
        ...overrides,
      } as typeof created,
    ],
    agents: [{ id: INTEGRATOR, companyId: COMPANY, status: "idle" } as never],
  });
  return { harness, invoked, issueId: created.id };
}

const done = { status: "done", identifier: "CREA-9", _previous: { status: "in_review" } };

describe("integratorAgentIdOf", () => {
  it("lấy agent của stage thứ hai ở template gốc", () => {
    expect(integratorAgentIdOf(rootPolicy)).toBe(INTEGRATOR);
  });

  it("bỏ qua policy không phải template gốc", () => {
    expect(integratorAgentIdOf(null)).toBeNull();
    expect(integratorAgentIdOf({ stages: rootPolicy.stages.slice(0, 1) })).toBeNull();
    expect(integratorAgentIdOf({ stages: [rootPolicy.stages[0], rootPolicy.stages[0], rootPolicy.stages[2]] })).toBe(REVIEWER);
    expect(integratorAgentIdOf({ stages: [rootPolicy.stages[0], rootPolicy.stages[2], rootPolicy.stages[2]] })).toBeNull();
  });
});

describe("registerIntegratorWake", () => {
  it("đánh thức đúng integrator một lần khi issue gốc chuyển done", async () => {
    const { harness, invoked, issueId } = await setup();
    await harness.emit("issue.updated", done, { companyId: COMPANY, entityId: issueId });
    expect(invoked).toHaveLength(1);
    expect(invoked[0]).toMatchObject({ agentId: INTEGRATOR, companyId: COMPANY, opts: { reason: "crew_merge" } });
    expect(invoked[0]?.opts.prompt).toContain("crew/req/CREA-9");
    await harness.emit("issue.updated", done, { companyId: COMPANY, entityId: issueId });
    expect(invoked).toHaveLength(1);
  });

  it("đánh thức lại khi issue hoàn tất một vòng mới", async () => {
    const { harness, invoked, issueId } = await setup();
    await harness.emit("issue.updated", done, { companyId: COMPANY, entityId: issueId });
    harness.seed({ issues: [{ ...(await harness.ctx.issues.get(issueId, COMPANY))!, completedAt: new Date("2026-10-07T05:00:00.000Z") }] });
    await harness.emit("issue.updated", done, { companyId: COMPANY, entityId: issueId });
    expect(invoked).toHaveLength(2);
  });

  it("bỏ qua issue con, issue không có template Crew và cập nhật không phải chuyển sang done", async () => {
    const child = await setup({ parentId: "parent-1" });
    await child.harness.emit("issue.updated", done, { companyId: COMPANY, entityId: child.issueId });
    expect(child.invoked).toHaveLength(0);

    const bare = await setup({ executionPolicy: null });
    await bare.harness.emit("issue.updated", done, { companyId: COMPANY, entityId: bare.issueId });
    expect(bare.invoked).toHaveLength(0);

    const other = await setup();
    await other.harness.emit("issue.updated", { status: "in_review" }, { companyId: COMPANY, entityId: other.issueId });
    await other.harness.emit("issue.updated", { status: "done", _previous: { status: "done" } }, { companyId: COMPANY, entityId: other.issueId });
    expect(other.invoked).toHaveLength(0);
  });

  it("issue đã bị mở lại trước khi sự kiện tới thì không đánh thức", async () => {
    const { harness, invoked, issueId } = await setup({ status: "in_progress" });
    await harness.emit("issue.updated", done, { companyId: COMPANY, entityId: issueId });
    expect(invoked).toHaveLength(0);
  });

  it("integrator không gọi được thì để lại comment và cho thử lại ở lần sau", async () => {
    const { harness, invoked, issueId } = await setup();
    harness.seed({ agents: [{ id: INTEGRATOR, companyId: COMPANY, status: "paused" } as never] });
    await harness.emit("issue.updated", done, { companyId: COMPANY, entityId: issueId });
    const comments = await harness.ctx.issues.listComments(issueId, COMPANY);
    expect(comments.some((c) => c.body.includes("không đánh thức được integrator"))).toBe(true);
    harness.seed({ agents: [{ id: INTEGRATOR, companyId: COMPANY, status: "idle" } as never] });
    await harness.emit("issue.updated", done, { companyId: COMPANY, entityId: issueId });
    expect(invoked).toHaveLength(2);
  });
});

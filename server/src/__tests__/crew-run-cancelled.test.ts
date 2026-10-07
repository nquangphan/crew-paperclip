import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import manifest from "../../../packages/crew-plugin/src/manifest.ts";
import { registerRunCancelledHandler } from "../../../packages/crew-plugin/src/run-cancelled.ts";

const COMPANY = "company-1";
const AGENT = "agent-1";

async function setup(overrides: Record<string, unknown> = {}) {
  const harness = createTestHarness({
    manifest,
    // issues.create and issue.comments.read are only for the test itself (seeding and reading comments).
    capabilities: ["events.subscribe", "issues.read", "issues.create", "issues.update", "issue.comments.create", "issue.comments.read"],
  });
  registerRunCancelledHandler(harness.ctx);
  const created = await harness.ctx.issues.create({ companyId: COMPANY, title: "cancelled run moves the issue to blocked" });
  harness.seed({
    issues: [{ ...created, status: "in_progress", assigneeAgentId: AGENT, executionRunId: null, ...overrides }],
  });
  return { harness, issueId: created.id };
}

function cancelled(issueId: string | null, extra: Record<string, unknown> = {}) {
  return {
    runId: "run-1",
    agentId: AGENT,
    status: "cancelled",
    issueId,
    startedAt: "2026-10-06T06:01:11.000Z",
    finishedAt: "2026-10-06T06:01:22.000Z",
    error: null,
    errorCode: null,
    ...extra,
  };
}

describe("registerRunCancelledHandler", () => {
  it("blocks an in_progress issue whose started run was cancelled", async () => {
    const { harness, issueId } = await setup();
    await harness.emit("agent.run.cancelled", cancelled(issueId), { companyId: COMPANY });
    expect((await harness.ctx.issues.get(issueId, COMPANY))?.status).toBe("blocked");
    const comments = await harness.ctx.issues.listComments(issueId, COMPANY);
    expect(comments.at(-1)?.body).toContain("run-1");
  });

  it("blocks when a person or the control plane cancelled the run (errorCode cancelled)", async () => {
    const { harness, issueId } = await setup();
    await harness.emit("agent.run.cancelled", cancelled(issueId, { errorCode: "cancelled" }), { companyId: COMPANY });
    expect((await harness.ctx.issues.get(issueId, COMPANY))?.status).toBe("blocked");
  });

  // Stock cancels the run itself on a handoff or stage change; the issue write that follows decides the status.
  it.each(["issue_reassigned", "lock_released_on_reassignment", "queued_comment_discarded", "issue_execution_lock_changed", "agent_chat_disabled"])(
    "leaves the issue alone when stock cancelled the run with errorCode %s",
    async (errorCode) => {
      const { harness, issueId } = await setup();
      await harness.emit("agent.run.cancelled", cancelled(issueId, { errorCode }), { companyId: COMPANY });
      expect((await harness.ctx.issues.get(issueId, COMPANY))?.status).toBe("in_progress");
      expect(await harness.ctx.issues.listComments(issueId, COMPANY)).toHaveLength(0);
    },
  );

  it("ignores a run cancelled while still queued", async () => {
    const { harness, issueId } = await setup();
    await harness.emit("agent.run.cancelled", cancelled(issueId, { startedAt: null }), { companyId: COMPANY });
    expect((await harness.ctx.issues.get(issueId, COMPANY))?.status).toBe("in_progress");
  });

  it("ignores an issue another run already owns", async () => {
    const { harness, issueId } = await setup({ executionRunId: "run-2" });
    await harness.emit("agent.run.cancelled", cancelled(issueId), { companyId: COMPANY });
    expect((await harness.ctx.issues.get(issueId, COMPANY))?.status).toBe("in_progress");
  });

  it("ignores an issue reassigned to someone else", async () => {
    const { harness, issueId } = await setup({ assigneeAgentId: "agent-2" });
    await harness.emit("agent.run.cancelled", cancelled(issueId), { companyId: COMPANY });
    expect((await harness.ctx.issues.get(issueId, COMPANY))?.status).toBe("in_progress");
  });

  it("ignores runs without an issue", async () => {
    const { harness, issueId } = await setup();
    await harness.emit("agent.run.cancelled", cancelled(null), { companyId: COMPANY });
    expect((await harness.ctx.issues.get(issueId, COMPANY))?.status).toBe("in_progress");
  });

  it("declares the capabilities the handler needs", () => {
    expect(manifest.capabilities).toEqual(
      expect.arrayContaining(["events.subscribe", "issues.read", "issues.update", "issue.comments.create"]),
    );
  });
});

import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { and, asc, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  agents,
  agentWakeupRequests,
  authUsers,
  companies,
  companyMemberships,
  createDb,
  environmentLeases,
  heartbeatRuns,
  issueRecoveryActions,
  issues,
} from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

// TPS-246: executor tự chuyển issue sang in_review trong lúc run còn chạy, wake của reviewer bị hoãn
// (`deferred_issue_execution`) sau run đó. Run kết thúc `failed` (SSH đứt, exit 255) trong khi lease SSH còn giữ, nên
// lần thả issue lúc kết thúc chỉ lên kế hoạch phục hồi, không đẩy hàng đợi. Sau khi dọn lease, wake hoãn của reviewer
// phải được đẩy theo đường admission thường. Adapter được mock để không chạy CLI hay SSH thật.
const execute = vi.hoisted(() => vi.fn());
vi.mock("../adapters/index.js", async () => {
  const actual = await vi.importActual<typeof import("../adapters/index.js")>("../adapters/index.js");
  return { ...actual, getServerAdapter: vi.fn(() => ({ supportsLocalAgentJwt: false, execute })) };
});

const { errorHandler } = await import("../middleware/index.js");
const { issueRoutes } = await import("../routes/issues.js");
const { heartbeatService } = await import("../services/heartbeat.js");
const { normalizeIssueExecutionPolicy } = await import("../services/issue-execution-policy.js");

const support = await getEmbeddedPostgresTestSupport();
const suite = support.supported ? describe.sequential : describe.skip;
if (!support.supported) {
  console.warn(`Bỏ qua test wake review sau run lỗi: ${support.reason ?? "môi trường không hỗ trợ"}`);
}

async function waitFor(condition: () => boolean | Promise<boolean>, timeoutMs = 20_000, intervalMs = 50) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("Hết giờ chờ điều kiện");
}

suite("wake review bị hoãn sau run executor kết thúc lỗi", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("crew-failed-run-deferred-review-");
    db = createDb(tempDb.connectionString);
  }, 120_000);

  afterEach(async () => {
    await heartbeatService(db).drainActiveRunExecutions();
    execute.mockReset();
    await db.execute(sql`TRUNCATE TABLE companies CASCADE`);
  });

  afterAll(async () => {
    await heartbeatService(db).drainActiveRunExecutions();
    await db?.$client?.end?.({ timeout: 0 });
    await tempDb?.cleanup();
  });

  function app(companyId: string, actor: { agentId: string; runId: string }) {
    const testApp = express();
    testApp.use(express.json());
    testApp.use((req, _res, next) => {
      (req as any).actor = { type: "agent", ...actor, companyId, source: "agent_jwt" };
      next();
    });
    testApp.use("/api", issueRoutes(db, {} as any, {}));
    testApp.use(errorHandler);
    return testApp;
  }

  async function seed() {
    const companyId = randomUUID();
    const executorId = randomUUID();
    const reviewerId = randomUUID();
    const issueId = randomUUID();
    const ownerUserId = `owner-${randomUUID()}`;
    const issuePrefix = `R${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
    await db.insert(authUsers).values({
      id: ownerUserId, name: "Owner", email: `${ownerUserId}@example.test`, createdAt: new Date(), updatedAt: new Date(),
    });
    await db.insert(companies).values({
      id: companyId, name: "Review sau lỗi", issuePrefix, requireBoardApprovalForNewAgents: false,
      defaultResponsibleUserId: ownerUserId,
    });
    await db.insert(companyMemberships).values({
      companyId, principalType: "user", principalId: ownerUserId, status: "active", membershipRole: "owner",
    });
    await db.insert(agents).values([executorId, reviewerId].map((id, index) => ({
      id, companyId, name: ["Executor", "Reviewer"][index]!, role: "engineer", status: "idle",
      adapterType: "claude_local", adapterConfig: {}, permissions: {},
      runtimeConfig: { heartbeat: { enabled: false, wakeOnDemand: true, maxConcurrentRuns: 1 } },
    })));
    await db.insert(issues).values({
      id: issueId, companyId, title: "TPS-246", status: "in_progress", priority: "medium",
      responsibleUserId: ownerUserId, assigneeAgentId: executorId, issueNumber: 1, identifier: `${issuePrefix}-1`,
      executionPolicy: normalizeIssueExecutionPolicy({
        stages: [{ type: "review", participants: [{ type: "agent", agentId: reviewerId }] }],
      }),
    });
    return { companyId, executorId, reviewerId, issueId, ownerUserId };
  }

  const runsFor = (agentId: string) =>
    db.select().from(heartbeatRuns).where(eq(heartbeatRuns.agentId, agentId)).orderBy(asc(heartbeatRuns.createdAt));
  const readRun = (runId: string) =>
    db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, runId)).then((rows) => rows[0] ?? null);
  type Seeded = Awaited<ReturnType<typeof seed>>;
  const deferredWakes = (agentId: string) => db.select().from(agentWakeupRequests).where(and(
    eq(agentWakeupRequests.agentId, agentId), eq(agentWakeupRequests.status, "deferred_issue_execution"),
  ));

  /**
   * Chạy run executor tới khi kết thúc `failed` như TPS-246: trong run, executor tự PATCH issue sang in_review, wake
   * của reviewer hoãn sau run vẫn đang giữ issue; Claude báo thành công nhưng tiến trình SSH thoát 255. Lease môi
   * trường của run chỉ được thả ở bước dọn của executeRun, sau lần thả issue lúc kết thúc.
   */
  async function failExecutorAfterHandoff(seeded: Seeded, duringRun?: () => Promise<void>) {
    const observed = { deferredDuringRun: 0, reviewerSawIssueStatus: null as string | null };
    execute.mockImplementation(async (input: { runId: string; agent: { id: string } }) => {
      if (input.agent.id !== seeded.executorId) {
        const [issue] = await db.select().from(issues).where(eq(issues.id, seeded.issueId));
        observed.reviewerSawIssueStatus = issue?.status ?? null;
        return { exitCode: 0, signal: null, timedOut: false, errorMessage: null, summary: "Đã review.", provider: "test", model: "test-model" };
      }
      const res = await request(app(seeded.companyId, { agentId: seeded.executorId, runId: input.runId }))
        .patch(`/api/issues/${seeded.issueId}`)
        .send({ status: "in_review", comment: "Executor: xong, chờ review." });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      // Route đánh thức reviewer sau khi trả lời; wake đó hoãn sau run vẫn đang giữ issue.
      await waitFor(async () => (await deferredWakes(seeded.reviewerId)).length > 0, 10_000).catch(() => undefined);
      observed.deferredDuringRun = (await deferredWakes(seeded.reviewerId)).length;
      await duringRun?.();
      return {
        exitCode: 255, signal: null, timedOut: false, errorMessage: "ssh: connection closed",
        resultJson: { type: "result", subtype: "success", is_error: false },
        provider: "test", model: "test-model",
      };
    });

    const executorRun = await heartbeatService(db).wakeup(seeded.executorId, {
      source: "assignment", triggerDetail: "system", reason: "issue_assigned",
      payload: { issueId: seeded.issueId },
      contextSnapshot: { issueId: seeded.issueId, taskId: seeded.issueId, wakeReason: "issue_assigned" },
      requestedByActorType: "user", requestedByActorId: seeded.ownerUserId,
    });
    expect(executorRun).not.toBeNull();
    await waitFor(async () => !["queued", "running"].includes((await readRun(executorRun!.id))?.status ?? ""));
    await heartbeatService(db).drainActiveRunExecutions();

    const finished = await readRun(executorRun!.id);
    expect(finished).toMatchObject({ status: "failed", errorCode: "adapter_failed", exitCode: 255 });
    expect(finished?.resultJson).toMatchObject({ conversationContinuation: "continue_conversation_v1" });
    expect(observed.deferredDuringRun).toBe(1);
    // Bước dọn đã thả lease của run.
    const leases = await db.select().from(environmentLeases).where(eq(environmentLeases.heartbeatRunId, executorRun!.id));
    expect(leases.length).toBeGreaterThan(0);
    expect(leases.every((lease) => lease.releasedAt !== null)).toBe(true);
    return { finished: finished!, observed };
  }

  it("run executor lỗi khi còn giữ lease: dọn lease xong thì reviewer được chạy", async () => {
    const seeded = await seed();
    const { finished, observed } = await failExecutorAfterHandoff(seeded);

    await waitFor(async () => (await runsFor(seeded.reviewerId)).length > 0, 10_000);
    expect(await deferredWakes(seeded.reviewerId)).toHaveLength(0);
    const [reviewerRun] = await runsFor(seeded.reviewerId);
    expect(reviewerRun.contextSnapshot).toMatchObject({ issueId: seeded.issueId, wakeReason: "execution_review_requested" });
    expect(reviewerRun.createdAt.getTime()).toBeGreaterThanOrEqual(finished.finishedAt!.getTime());
    await waitFor(() => observed.reviewerSawIssueStatus !== null, 10_000);
    expect(observed.reviewerSawIssueStatus).toBe("in_review");
  }, 120_000);

  it("issue còn bị chặn chờ đối soát: wake của reviewer vẫn hoãn", async () => {
    const seeded = await seed();
    await failExecutorAfterHandoff(seeded, async () => {
      await db.insert(issueRecoveryActions).values({
        companyId: seeded.companyId, sourceIssueId: seeded.issueId, kind: "active_run_watchdog", status: "active",
        ownerType: "board", cause: "uncertain_provider_action", fingerprint: randomUUID(),
        evidence: { automaticRecovery: { replay: "blocked" } }, nextAction: "Kiểm tra thao tác chưa chắc chắn trước khi chạy tiếp.",
      });
    });

    expect(await deferredWakes(seeded.reviewerId)).toHaveLength(1);
    expect(await runsFor(seeded.reviewerId)).toHaveLength(0);
  }, 120_000);
});

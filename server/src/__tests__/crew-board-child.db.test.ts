import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  activityLog,
  agentRuntimeState,
  agents,
  agentWakeupRequests,
  companies,
  companyMemberships,
  companySkills,
  createDb,
  heartbeatRunEvents,
  heartbeatRuns,
  issueComments,
  issues,
  projects,
} from "@paperclipai/db";
import { CREW_POLICY_CONFIG_ENV } from "../crew/issue-policy.js";
import { issueService } from "../services/issues.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { drainHeartbeatRunsToQuiescence } from "./helpers/drain-heartbeat-runs.js";
import { runningProcesses } from "../adapters/index.ts";
import { heartbeatService } from "../services/heartbeat.js";

// Run được đánh thức gọi adapter của server; stub để run xong ngay, không mở phiên agent thật.
const mockAdapterExecute = vi.hoisted(() =>
  vi.fn(async () => ({
    exitCode: 0,
    signal: null,
    timedOut: false,
    errorMessage: null,
    summary: "Crew board child test run.",
    provider: "test",
    model: "test-model",
  })),
);

vi.mock("../adapters/index.ts", async () => {
  const actual = await vi.importActual<typeof import("../adapters/index.ts")>("../adapters/index.ts");
  return {
    ...actual,
    getServerAdapter: vi.fn(() => ({ supportsLocalAgentJwt: false, execute: mockAdapterExecute })),
  };
});

const support = await getEmbeddedPostgresTestSupport();
const suite = support.supported ? describe : describe.skip;

/**
 * Nút "Thêm việc con" của web: board tạo việc con chưa giao ai dưới yêu cầu gốc Crew bằng route stock, rồi bình luận
 * trên gốc. Bộ test khóa đường server thật: việc con nhận policy việc con (một stage Reviewer Claude), không đánh thức
 * ai; bình luận đánh thức đúng Trợ Lý trên yêu cầu gốc; Trợ Lý không nộp được gốc khi việc con đó chưa xong, và gắn
 * marker/giao executor ngay trên việc con được.
 */
suite("Crew: việc con do board thêm vào yêu cầu gốc", () => {
  let db!: ReturnType<typeof createDb>;
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  const dir = mkdtempSync(path.join(tmpdir(), "crew-board-child-"));
  const configFile = path.join(dir, "crew-policy.json");
  const previousConfig = process.env[CREW_POLICY_CONFIG_ENV];
  const ownerId = `user-${randomUUID()}`;
  const operatorId = `user-${randomUUID()}`;

  beforeAll(async () => {
    process.env[CREW_POLICY_CONFIG_ENV] = configFile;
    temporary = await startEmbeddedPostgresTestDatabase("crew-board-child-");
    db = createDb(temporary.connectionString);
  }, 60_000);

  afterEach(async () => {
    mockAdapterExecute.mockClear();
    runningProcesses.clear();
    await drainHeartbeatRunsToQuiescence(db, heartbeatService(db));
    await db.delete(activityLog);
    await db.delete(issueComments);
    await db.delete(heartbeatRunEvents);
    await db.delete(heartbeatRuns);
    await db.delete(agentWakeupRequests);
    await db.delete(agentRuntimeState);
    await db.delete(issues);
    await db.delete(projects);
    await db.delete(agents);
    await db.delete(companyMemberships);
    await db.delete(companySkills);
    await db.delete(companies);
  });

  afterAll(async () => {
    if (previousConfig === undefined) delete process.env[CREW_POLICY_CONFIG_ENV];
    else process.env[CREW_POLICY_CONFIG_ENV] = previousConfig;
    await db?.$client.end({ timeout: 0 });
    await temporary?.cleanup();
    rmSync(dir, { recursive: true, force: true });
  });

  async function seed() {
    const companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Crew board child",
      issuePrefix: `B${companyId.replaceAll("-", "").slice(0, 5).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    const agentRow = (name: string) => ({
      id: randomUUID(),
      companyId,
      name,
      role: "engineer",
      status: "idle",
      adapterType: "claude_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    const assistant = agentRow("Trợ Lý");
    const executor = agentRow("Executor");
    const reviewer = agentRow("Reviewer");
    const integrator = agentRow("Integrator");
    await db.insert(agents).values([assistant, executor, reviewer, integrator]);
    const [project] = await db.insert(projects).values({ companyId, name: "repo" }).returning();
    await db.insert(companyMemberships).values([
      { companyId, principalType: "user", principalId: ownerId, status: "active", membershipRole: "owner" },
      { companyId, principalType: "user", principalId: operatorId, status: "active", membershipRole: "operator" },
    ]);
    writeFileSync(
      configFile,
      JSON.stringify({
        companies: {
          [companyId]: { reviewerAgentId: reviewer.id, integratorAgentId: integrator.id, ownerUserId: ownerId },
        },
      }),
    );
    return {
      companyId,
      assistantId: assistant.id,
      executorId: executor.id,
      reviewerId: reviewer.id,
      integratorId: integrator.id,
      projectId: project!.id,
    };
  }
  type Seed = Awaited<ReturnType<typeof seed>>;

  async function app(companyId: string, userId: string, role: "owner" | "operator") {
    const [{ issueRoutes }, { errorHandler }] = await Promise.all([
      import("../routes/issues.js"),
      import("../middleware/index.js"),
    ]);
    const server = express();
    server.use(express.json());
    server.use((req, _res, next) => {
      req.actor = {
        type: "board",
        userId,
        source: "session",
        isInstanceAdmin: false,
        companyIds: [companyId],
        memberships: [{ companyId, membershipRole: role, status: "active" }],
      } as unknown as typeof req.actor;
      next();
    });
    server.use("/api", issueRoutes(db, {} as never));
    server.use(errorHandler);
    return server;
  }

  const wakeupsFor = async (companyId: string, agentId: string) =>
    (
      await db
        .select()
        .from(agentWakeupRequests)
        .where(and(eq(agentWakeupRequests.companyId, companyId), eq(agentWakeupRequests.agentId, agentId)))
    ).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  type Stage = { type: string; participants: { type: string; agentId?: string | null; userId?: string | null }[] };
  type IssueBody = { id: string; identifier: string; status: string; assigneeAgentId: string | null; executionPolicy: { stages: Stage[] } | null };

  /** Yêu cầu gốc do board tạo qua route (nháp để chưa ai chạy), rồi đặt như lúc Trợ Lý đang làm. */
  async function crewRoot(server: express.Express, s: Seed) {
    const created = await request(server)
      .post(`/api/companies/${s.companyId}/issues`)
      .send({ title: "Trang báo cáo", projectId: s.projectId, assigneeAgentId: s.assistantId, status: "backlog" })
      .expect(201);
    const root = created.body as IssueBody;
    expect(root.executionPolicy?.stages.map((stage) => stage.type)).toEqual(["review", "review", "approval", "review"]);
    await db.update(issues).set({ status: "in_progress" }).where(eq(issues.id, root.id));
    return root;
  }

  it.each([
    ["owner", () => ownerId],
    ["operator", () => operatorId],
  ] as const)("%s thêm việc con: policy Reviewer Claude, không đánh thức ai; bình luận trên gốc đánh thức Trợ Lý", async (role, userOf) => {
    const s = await seed();
    const server = await app(s.companyId, userOf(), role);
    const root = await crewRoot(server, s);

    const res = await request(server)
      .post(`/api/companies/${s.companyId}/issues`)
      .send({
        title: "Thêm nút xuất Excel",
        description: "Cột Ngày, Tổng",
        parentId: root.id,
        projectId: s.projectId,
        status: "todo",
        idempotencyKey: `crew-add-child:${root.id}:${randomUUID()}`,
        allowDuplicate: true,
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const child = res.body as IssueBody & { parentId: string; createdByUserId: string | null; createdByAgentId: string | null };
    expect(child).toMatchObject({ parentId: root.id, status: "todo", assigneeAgentId: null, createdByAgentId: null });
    expect(child.createdByUserId).toBe(userOf());
    // Policy việc con của Crew: đúng một stage review của reviewer Claude (gate không từ chối việc con board tạo).
    expect(child.executionPolicy?.stages).toEqual([
      expect.objectContaining({ type: "review", participants: [expect.objectContaining({ type: "agent", agentId: s.reviewerId })] }),
    ]);
    await drainHeartbeatRunsToQuiescence(db, heartbeatService(db));
    for (const agentId of [s.assistantId, s.executorId, s.reviewerId, s.integratorId]) {
      expect(await wakeupsFor(s.companyId, agentId)).toEqual([]);
    }

    await request(server)
      .post(`/api/issues/${root.id}/comments`)
      .send({ body: `Đã thêm việc con ${child.identifier}: Thêm nút xuất Excel` })
      .expect(201);
    // Route bình luận đánh thức không chờ (`void heartbeat.wakeup`): đợi wake xuất hiện rồi mới chạy hết run.
    await vi.waitFor(async () => expect((await wakeupsFor(s.companyId, s.assistantId)).length).toBeGreaterThan(0), {
      timeout: 10_000,
      interval: 50,
    });
    await drainHeartbeatRunsToQuiescence(db, heartbeatService(db));
    const wakes = await wakeupsFor(s.companyId, s.assistantId);
    expect(wakes[0]?.reason).toBe("issue_commented");
    expect((wakes[0]?.payload as { issueId?: string } | null)?.issueId).toBe(root.id);
    const run = wakes[0]?.runId
      ? (await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, wakes[0].runId)))[0]
      : undefined;
    expect(run?.agentId).toBe(s.assistantId);
    expect((run?.contextSnapshot as { issueId?: string } | null)?.issueId).toBe(root.id);
    for (const agentId of [s.executorId, s.reviewerId, s.integratorId]) {
      expect(await wakeupsFor(s.companyId, agentId)).toEqual([]);
    }
    // Việc con chưa giao ai: không có wake nào trên nó cho tới khi Trợ Lý giao executor.
    const all = await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.companyId, s.companyId));
    expect(all.filter((w) => (w.payload as { issueId?: string } | null)?.issueId === child.id)).toEqual([]);
  }, 120_000);

  it("Trợ Lý không nộp được gốc khi việc con board thêm chưa xong; gắn marker và giao executor trên việc con được", async () => {
    const s = await seed();
    const server = await app(s.companyId, ownerId, "owner");
    const root = await crewRoot(server, s);
    const child = (
      await request(server)
        .post(`/api/companies/${s.companyId}/issues`)
        .send({ title: "Thêm nút xuất Excel", parentId: root.id, status: "todo", allowDuplicate: true })
        .expect(201)
    ).body as IssueBody & { description: string | null };
    const svc = issueService(db);

    await expect(svc.update(root.id, { status: "done", actorAgentId: s.assistantId } as never)).rejects.toMatchObject({
      status: 422,
      details: { code: "crew_gate_blocked", violations: ["board_child_open"] },
    });

    const description = [
      "Thêm nút xuất Excel",
      "",
      "crew-bundle id=owner-1 seq=1",
      "crew-model complexity=small model=claude-sonnet-5 effort=medium runtime=claude_local reason=một nút",
      `crew-child key=owner-${child.identifier.toLowerCase()} revision=owner-${child.identifier}`,
      "",
      "Tiêu chí nghiệm thu:",
      "- Có nút Xuất Excel",
    ].join("\n");
    const folded = await svc.update(child.id, {
      description,
      assigneeAgentId: s.executorId,
      assigneeAdapterOverrides: { adapterConfig: { model: "claude-sonnet-5", effort: "medium" } },
      actorAgentId: s.assistantId,
    } as never);
    expect(folded).toMatchObject({ assigneeAgentId: s.executorId, description });
    // Policy ghim lúc tạo không đổi khi Trợ Lý giao executor.
    expect((folded?.executionPolicy as { stages: Stage[] } | null)?.stages).toEqual(child.executionPolicy?.stages);

    // Việc con xong thì luật này không còn chặn (gate vẫn đòi đủ stage như cũ).
    await db.update(issues).set({ status: "done" }).where(eq(issues.id, child.id));
    const outcome = await svc.update(root.id, { status: "done", actorAgentId: s.assistantId } as never).catch((e: unknown) => e);
    expect((outcome as { details?: { violations?: string[] } }).details?.violations ?? []).not.toContain("board_child_open");
  }, 120_000);
});

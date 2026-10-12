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
    summary: "Crew draft start-work test run.",
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
 * Nút "Bắt đầu làm" của web gửi PATCH `{ status: "todo" }` lên yêu cầu nháp (`backlog`). Bộ test khóa đường server
 * thật: cổng Crew cho board đổi `backlog → todo` trên issue gốc có policy Crew, và route stock đánh thức assignee
 * (`issue_status_changed`) như khi tạo thẳng `todo`, không vướng `execution_reconciliation_required`.
 */
suite("Crew: bắt đầu làm yêu cầu nháp", () => {
  let db!: ReturnType<typeof createDb>;
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  const dir = mkdtempSync(path.join(tmpdir(), "crew-draft-start-work-"));
  const configFile = path.join(dir, "crew-policy.json");
  const previousConfig = process.env[CREW_POLICY_CONFIG_ENV];
  const ownerId = `user-${randomUUID()}`;
  const operatorId = `user-${randomUUID()}`;

  beforeAll(async () => {
    process.env[CREW_POLICY_CONFIG_ENV] = configFile;
    temporary = await startEmbeddedPostgresTestDatabase("crew-draft-start-work-");
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
      name: "Crew draft",
      issuePrefix: `Q${companyId.replaceAll("-", "").slice(0, 5).toUpperCase()}`,
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
    const reviewer = agentRow("Reviewer");
    const integrator = agentRow("Integrator");
    await db.insert(agents).values([assistant, reviewer, integrator]);
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
    return { companyId, assistantId: assistant.id, projectId: project!.id };
  }

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

  const wakeupsFor = (companyId: string, agentId: string) =>
    db
      .select()
      .from(agentWakeupRequests)
      .where(and(eq(agentWakeupRequests.companyId, companyId), eq(agentWakeupRequests.agentId, agentId)));

  async function createDraft(server: express.Express, s: Awaited<ReturnType<typeof seed>>) {
    const created = await request(server)
      .post(`/api/companies/${s.companyId}/issues`)
      .send({ title: "Việc để sau", projectId: s.projectId, assigneeAgentId: s.assistantId, status: "backlog" })
      .expect(201);
    await drainHeartbeatRunsToQuiescence(db, heartbeatService(db));
    return created.body as { id: string; status: string; executionPolicy: { stages: unknown[] } | null };
  }

  it.each([
    ["owner", () => ownerId],
    ["operator", () => operatorId],
  ] as const)("%s: nháp không đánh thức ai; PATCH todo đánh thức Trợ Lý và chạy run", async (role, userOf) => {
    const s = await seed();
    const server = await app(s.companyId, userOf(), role);

    const draft = await createDraft(server, s);
    expect(draft.status).toBe("backlog");
    // Issue gốc của board nhận policy Crew, nên đây đúng là đường qua cổng Crew.
    expect(draft.executionPolicy?.stages.length ?? 0).toBeGreaterThan(0);
    expect(await wakeupsFor(s.companyId, s.assistantId)).toHaveLength(0);
    expect(mockAdapterExecute).not.toHaveBeenCalled();

    const res = await request(server).patch(`/api/issues/${draft.id}`).send({ status: "todo" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.status).toBe("todo");
    await drainHeartbeatRunsToQuiescence(db, heartbeatService(db));

    // Wake đầu tiên là của lệnh đổi trạng thái. Run stub kết thúc mà không đổi issue nên stock còn đánh thức tiếp
    // để sửa trạng thái (`issue_disposition_repair`); những wake đó không thuộc phạm vi test này.
    const wakeups = (await wakeupsFor(s.companyId, s.assistantId)).sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );
    expect(wakeups[0]?.reason).toBe("issue_status_changed");
    expect(wakeups.filter((w) => w.reason === "issue_status_changed")).toHaveLength(1);
    expect(wakeups.filter((w) => w.status === "skipped" || w.reason === "execution_reconciliation_required")).toEqual([]);
    const statusRun = wakeups[0]?.runId
      ? (await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, wakeups[0].runId)))[0]
      : undefined;
    expect(statusRun?.agentId).toBe(s.assistantId);
    expect((statusRun?.contextSnapshot as { issueId?: string } | null)?.issueId).toBe(draft.id);
    expect(mockAdapterExecute).toHaveBeenCalled();
  }, 120_000);

  it("PATCH todo lần hai trên yêu cầu đã chạy không đánh thức thêm", async () => {
    const s = await seed();
    const server = await app(s.companyId, ownerId, "owner");
    const draft = await createDraft(server, s);
    await request(server).patch(`/api/issues/${draft.id}`).send({ status: "todo" }).expect(200);
    await drainHeartbeatRunsToQuiescence(db, heartbeatService(db));
    const statusWakes = async () =>
      (await wakeupsFor(s.companyId, s.assistantId)).filter((w) => w.reason === "issue_status_changed").length;
    expect(await statusWakes()).toBe(1);

    const [current] = await db.select({ status: issues.status }).from(issues).where(eq(issues.id, draft.id));
    // Bấm lại từ trang cũ: issue không còn `backlog` nên route không coi là rời nháp.
    await request(server).patch(`/api/issues/${draft.id}`).send({ status: current!.status }).expect(200);
    await drainHeartbeatRunsToQuiescence(db, heartbeatService(db));
    expect(await statusWakes()).toBe(1);
  }, 120_000);
});

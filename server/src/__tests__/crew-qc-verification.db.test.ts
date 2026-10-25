import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import request from "supertest";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  activityLog,
  agents,
  agentWakeupRequests,
  companies,
  companyMemberships,
  createDb,
  issueComments,
  issues,
  projects,
} from "@paperclipai/db";
import { CREW_POLICY_CONFIG_ENV } from "../crew/issue-policy.js";
import { crewContributionsTable } from "../crew/contributions.js";
import { crewQcRoundsTable } from "../crew/qc-verification.js";
import { issueService } from "../services/issues.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

/** Mọi lần stock gọi `heartbeat.wakeup` (vẫn chuyển cho heartbeat thật). */
const wakeCalls = vi.hoisted(() => [] as { agentId: string; reason: string | null }[]);

vi.mock("../services/heartbeat.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/heartbeat.js")>();
  return {
    ...actual,
    heartbeatService: (...args: Parameters<typeof actual.heartbeatService>) => {
      const service = actual.heartbeatService(...args);
      const wakeup = service.wakeup;
      service.wakeup = (async (agentId: string, opts?: { reason?: string | null }) => {
        wakeCalls.push({ agentId, reason: opts?.reason ?? null });
        return wakeup(agentId, opts as never);
      }) as typeof service.wakeup;
      return service;
    },
  };
});

const migration = [
  "0013_contributions.sql",
  "0016_project_access.sql",
  "0018_contributor_department.sql",
  "0019_qc_verification.sql",
]
  .map((file) => readFileSync(fileURLToPath(new URL(`../../../packages/crew-plugin/migrations/${file}`, import.meta.url)), "utf8"))
  .join(";")
  .split(";")
  .map((statement) => statement.trim())
  .filter(Boolean);

const support = await getEmbeddedPostgresTestSupport();
const suite = support.supported ? describe.sequential : describe.skip;

/**
 * Yêu cầu do Phòng QC gửi: xong thì chờ QC duyệt (trạng thái lõi vẫn `done`, không ai bị đánh thức). QC xác nhận chỉ đổi
 * bảng plugin. "Chưa đạt" chờ owner duyệt; owner duyệt thì bình luận lý do mở lại issue cho người làm, rồi lần xong sau
 * mở vòng QC mới.
 */
suite("Crew: Phòng QC duyệt lại yêu cầu của mình", () => {
  let db: ReturnType<typeof createDb>;
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  const dir = mkdtempSync(path.join(tmpdir(), "crew-qc-verification-"));
  const configFile = path.join(dir, "crew-policy.json");
  const previousConfig = process.env[CREW_POLICY_CONFIG_ENV];

  const companyId = randomUUID();
  const users = {
    owner: "user-owner",
    qc: "user-qc",
    qc2: "user-qc-2",
    marketing: "user-marketing",
    viewer: "user-viewer",
  };
  const roles: Record<string, "owner" | "viewer"> = {
    [users.owner]: "owner",
    [users.qc]: "viewer",
    [users.qc2]: "viewer",
    [users.marketing]: "viewer",
    [users.viewer]: "viewer",
  };
  let projectId: string;
  let agentId: string;
  let qcIssueId: string;

  beforeAll(async () => {
    temporary = await startEmbeddedPostgresTestDatabase("crew-qc-verification-db-");
    db = createDb(temporary.connectionString);
    await db.execute(sql.raw("CREATE EXTENSION IF NOT EXISTS pg_trgm"));
    await db.insert(companies).values({
      id: companyId,
      name: "Crew QC",
      issuePrefix: `Q${companyId.replaceAll("-", "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
      defaultResponsibleUserId: users.owner,
    });
    const [agent] = await db.insert(agents).values({
      companyId, name: "Executor", role: "engineer", status: "idle", adapterType: "process", adapterConfig: {},
      permissions: {}, runtimeConfig: { heartbeat: { enabled: false, wakeOnDemand: false } },
    }).returning();
    agentId = agent!.id;
    process.env[CREW_POLICY_CONFIG_ENV] = configFile;
    writeFileSync(configFile, JSON.stringify({
      companies: { [companyId]: { reviewerAgentId: randomUUID(), integratorAgentId: randomUUID(), ownerUserId: users.owner } },
    }));
    const [project] = await db.insert(projects).values({ companyId, name: "App" }).returning();
    projectId = project!.id;
    await db.insert(companyMemberships).values(Object.entries(roles).map(([principalId, membershipRole]) => ({
      companyId, principalType: "user", principalId, status: "active", membershipRole,
    })));
    const namespace = crewContributionsTable().split(".")[0]!;
    await db.execute(sql.raw(`CREATE SCHEMA IF NOT EXISTS ${namespace}`));
    for (const statement of migration) await db.execute(sql.raw(statement));

    const owner = await app(board(users.owner));
    for (const [userId, department] of [[users.qc, "qc"], [users.qc2, "qc"], [users.marketing, "marketing"]] as const) {
      expect((await request(owner).put(crew(`/contributors/${userId}`)).send({ department })).status).toBe(204);
    }
    for (const userId of [users.qc, users.qc2, users.marketing, users.viewer]) {
      expect((await request(owner).put(crew(`/project-access/${userId}`)).send({ projectIds: [projectId] })).status).toBe(200);
    }
  }, 60_000);

  afterAll(async () => {
    // Route stock chạy khối đánh thức best-effort sau khi trả; chờ nó xong trước khi đóng Postgres.
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    if (previousConfig === undefined) delete process.env[CREW_POLICY_CONFIG_ENV];
    else process.env[CREW_POLICY_CONFIG_ENV] = previousConfig;
    await db?.$client.end({ timeout: 0 });
    await temporary?.cleanup();
    rmSync(dir, { recursive: true, force: true });
  });

  function board(userId: string) {
    return {
      type: "board",
      userId,
      source: "session",
      isInstanceAdmin: false,
      companyIds: [companyId],
      memberships: [{ companyId, membershipRole: roles[userId] ?? "viewer", status: "active" }],
    };
  }

  const agentActor = () => ({ type: "agent", agentId, companyId, runId: undefined, source: "agent_key" });

  async function app(actor: Record<string, unknown>) {
    const [{ crewContributionRoutes }, { issueRoutes }, { errorHandler }] = await Promise.all([
      import("../crew/contribution-routes.js"),
      import("../routes/issues.js"),
      import("../middleware/index.js"),
    ]);
    const server = express();
    server.use(express.json());
    server.use((req, _res, next) => {
      req.actor = actor as typeof req.actor;
      next();
    });
    server.use("/api", issueRoutes(db, {} as never));
    server.use("/api", crewContributionRoutes(db));
    server.use(errorHandler);
    return server;
  }

  const crew = (suffix: string) => `/api/crew/companies/${companyId}${suffix}`;
  const as = (userId: string) => app(board(userId));
  const contains = (value: unknown, needle: string) => JSON.stringify(value).includes(needle);
  const rowsOf = (result: unknown) =>
    (Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])) as Record<string, unknown>[];

  /** Góp ý yêu cầu của `author`, owner duyệt qua route stock như trình duyệt owner (gán executor). */
  async function approvedIssueFrom(author: string, title = `Yêu cầu ${randomUUID()}`) {
    const created = await request(await as(author)).post(crew("/contributions")).send({ kind: "issue", projectId, title });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const owner = await as(users.owner);
    const approve = await request(owner).post(crew(`/contributions/${created.body.id}/approve`));
    expect(approve.status, JSON.stringify(approve.body)).toBe(200);
    const { materialize } = approve.body;
    const issue = await request(owner).post(`/api/companies/${companyId}/issues`).send({
      projectId: materialize.projectId, title: materialize.title, status: "todo", priority: "medium",
      assigneeAgentId: agentId, idempotencyKey: materialize.idempotencyKey,
    });
    expect(issue.status, JSON.stringify(issue.body)).toBe(201);
    const complete = await request(owner).post(crew(`/contributions/${created.body.id}/approve/complete`));
    expect(complete.status).toBe(200);
    return issue.body.id as string;
  }

  /**
   * Owner đổi trạng thái qua `issueService.update` (đường của Ép Done và mọi transition stock). Route PATCH của board với
   * `done` sẽ chuyển sang stage review của policy Crew, mà reviewer trong cấu hình test không phải agent thật.
   */
  async function setStatus(issueId: string, status: string) {
    const updated = await issueService(db).update(issueId, { status, actorUserId: users.owner } as never);
    expect(updated?.status).toBe(status);
  }

  async function qcStates(userId: string) {
    const res = await request(await as(userId)).get(crew("/qc"));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.items as {
      issueId: string;
      identifier: string | null;
      title: string;
      roundId: string;
      state: string;
      qcUserId: string;
      reopenRequest: unknown;
    }[];
  }

  async function roundsOf(issueId: string) {
    return rowsOf(await db.execute(sql.raw(`SELECT status, qc_user_id, ended_at IS NULL AS open, verified_by_user_id
      FROM ${crewQcRoundsTable()} WHERE issue_id = '${issueId}' ORDER BY started_at, id`)));
  }

  async function snapshot(issueId: string) {
    const [issue] = await db.select().from(issues).where(eq(issues.id, issueId));
    const comments = await db.select().from(issueComments).where(eq(issueComments.issueId, issueId));
    const wakeups = await db.select().from(agentWakeupRequests);
    const activity = await db.select().from(activityLog).where(eq(activityLog.entityId, issueId));
    return { issue, comments: comments.length, wakeups: wakeups.length, activity: activity.length, wakeCalls: wakeCalls.length };
  }

  it("chỉ yêu cầu của Phòng QC chờ QC duyệt khi xong; trạng thái lõi vẫn done, không đổi người làm", async () => {
    const marketingIssue = await approvedIssueFrom(users.marketing);
    const [ownerIssue] = await db.insert(issues).values({
      companyId, projectId, title: "Owner tự tạo", status: "todo", priority: "medium",
    }).returning();
    qcIssueId = await approvedIssueFrom(users.qc);

    await setStatus(marketingIssue, "done");
    await issueService(db).update(ownerIssue!.id, { status: "done", actorUserId: users.owner } as never);
    await setStatus(qcIssueId, "done");

    expect(await roundsOf(marketingIssue)).toEqual([]);
    expect(await roundsOf(ownerIssue!.id)).toEqual([]);
    expect(await roundsOf(qcIssueId)).toEqual([{ status: "awaiting", qc_user_id: users.qc, open: true, verified_by_user_id: null }]);
    const [row] = await db.select().from(issues).where(eq(issues.id, qcIssueId));
    expect(row).toMatchObject({ status: "done", assigneeAgentId: agentId, assigneeUserId: null });

    for (const userId of [users.owner, users.qc, users.viewer]) {
      const items = await qcStates(userId);
      expect(items.map((item) => item.issueId), userId).toEqual([qcIssueId]);
      expect(items[0]).toMatchObject({ state: "awaiting", qcUserId: users.qc, reopenRequest: null });
      expect(items[0]!.title).toMatch(/^\[App\] Yêu cầu /);
      expect(items[0]!.identifier).toEqual(expect.any(String));
    }
  }, 60_000);

  it("người QC khác, Phòng Marketing, viewer thuần và agent không xác nhận được", async () => {
    const cases: [Record<string, unknown>, number, string][] = [
      [board(users.qc2), 403, "crew_qc_forbidden"],
      [board(users.marketing), 403, "crew_qc_forbidden"],
      [board(users.viewer), 403, "crew_contribution_forbidden"],
      [agentActor(), 403, "crew_contribution_forbidden"],
    ];
    for (const [actor, status, code] of cases) {
      const res = await request(await app(actor)).post(crew(`/qc/issues/${qcIssueId}/verify`));
      expect(res.status, String(actor.userId ?? "agent")).toBe(status);
      expect(res.body.code).toBe(code);
    }
    expect((await request(await app(agentActor())).get(crew("/qc"))).status).toBe(403);
    const missing = await request(await as(users.qc)).post(crew(`/qc/issues/${randomUUID()}/verify`));
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe("crew_qc_not_awaiting");
    expect((await roundsOf(qcIssueId))[0]).toMatchObject({ status: "awaiting" });
  });

  it("QC xác nhận đạt: chỉ đổi vòng QC, không ghi issue, bình luận, activity hay wake; gọi lại vẫn 200", async () => {
    const before = await snapshot(qcIssueId);
    const res = await request(await as(users.qc)).post(crew(`/qc/issues/${qcIssueId}/verify`));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ issueId: qcIssueId, state: "verified", verifiedByUserId: users.qc });
    expect(res.body.verifiedAt).toEqual(expect.any(String));
    const again = await request(await as(users.qc)).post(crew(`/qc/issues/${qcIssueId}/verify`));
    expect(again.status).toBe(200);
    expect(again.body.roundId).toBe(res.body.roundId);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(await snapshot(qcIssueId)).toEqual(before);
    expect((await qcStates(users.qc))[0]).toMatchObject({ state: "verified" });
  });

  it("owner mở lại thì vòng đóng; xong lại mở vòng chờ mới", async () => {
    await setStatus(qcIssueId, "todo");
    expect(await qcStates(users.qc)).toEqual([]);
    await setStatus(qcIssueId, "done");
    const rounds = await roundsOf(qcIssueId);
    expect(rounds.map((round) => [round.status, round.open])).toEqual([["verified", false], ["awaiting", true]]);
  });

  it("Chưa đạt: lý do bắt buộc, chỉ người QC của vòng, một yêu cầu mỗi lúc; agent không thấy và không bị đánh thức", async () => {
    const marker = `crew-qc-${randomUUID()}`;
    const qc = await as(users.qc);
    expect((await request(qc).post(crew("/contributions")).send({ kind: "reopen", issueId: qcIssueId, body: "   " })).status).toBe(400);
    const notMine = await request(await as(users.qc2)).post(crew("/contributions")).send({ kind: "reopen", issueId: qcIssueId, body: "x" });
    expect(notMine.status).toBe(403);
    expect(notMine.body.code).toBe("crew_qc_forbidden");
    const notDone = await request(qc).post(crew("/contributions")).send({ kind: "reopen", issueId: randomUUID(), body: "x" });
    expect(notDone.status).toBe(422);

    const before = await snapshot(qcIssueId);
    const created = await request(qc).post(crew("/contributions")).send({ kind: "reopen", issueId: qcIssueId, body: `Còn lỗi ${marker}` });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body).toMatchObject({ kind: "reopen", status: "pending", targetIssueId: qcIssueId });
    const duplicate = await request(qc).post(crew("/contributions")).send({ kind: "reopen", issueId: qcIssueId, body: "lần hai" });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe("crew_qc_reopen_pending");
    const verify = await request(qc).post(crew(`/qc/issues/${qcIssueId}/verify`));
    expect(verify.status).toBe(409);
    expect(verify.body.code).toBe("crew_qc_reopen_pending");

    const [state] = await qcStates(users.qc);
    expect(state).toMatchObject({ state: "awaiting", reopenRequest: { id: created.body.id, status: "pending" } });
    expect(contains(await qcStates(users.viewer), marker)).toBe(false);
    const summary = await request(await as(users.owner)).get(crew("/contributions/summary"));
    expect(summary.body.pending).toBeGreaterThanOrEqual(1);
    const byIssue = await request(await as(users.owner)).get(crew(`/contributions?kind=reopen&issueId=${qcIssueId}`));
    expect(byIssue.body.items.map((item: { id: string }) => item.id)).toEqual([created.body.id]);

    const agent = await app(agentActor());
    for (const path of [`/api/issues/${qcIssueId}`, `/api/issues/${qcIssueId}/comments`, `/api/companies/${companyId}/issues`]) {
      const res = await request(agent).get(path);
      expect(res.status, path).toBe(200);
      expect(contains(res.body, marker), path).toBe(false);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(await snapshot(qcIssueId)).toEqual(before);

    // Owner từ chối: vẫn chờ QC duyệt, không có yêu cầu đang chờ.
    const rejected = await request(await as(users.owner)).post(crew(`/contributions/${created.body.id}/reject`));
    expect(rejected.body.status).toBe("rejected");
    expect((await qcStates(users.qc))[0]).toMatchObject({ state: "awaiting", reopenRequest: null });
    expect(await snapshot(qcIssueId)).toEqual(before);
  }, 60_000);

  it("owner duyệt Chưa đạt: bình luận lý do mở lại issue cho người làm, đánh thức agent; xong lần sau mở vòng mới", async () => {
    const marker = `crew-qc-approved-${randomUUID()}`;
    const created = await request(await as(users.qc)).post(crew("/contributions")).send({
      kind: "reopen", issueId: qcIssueId, body: `Nút lưu không chạy ${marker}`,
    });
    expect(created.status).toBe(201);
    const owner = await as(users.owner);
    const approve = await request(owner).post(crew(`/contributions/${created.body.id}/approve`));
    expect(approve.status, JSON.stringify(approve.body)).toBe(200);
    const { materialize } = approve.body;
    expect(materialize).toMatchObject({ kind: "reopen", issueId: qcIssueId, clientRequestId: created.body.id });
    expect(materialize.body).toContain(marker);
    expect(materialize.body).toContain("QC báo chưa đạt");

    // Chưa đăng thì complete trả 409 và mục giữ approving.
    expect((await request(owner).post(crew(`/contributions/${created.body.id}/approve/complete`))).status).toBe(409);

    const wakesBefore = wakeCalls.length;
    const posted = await request(owner).post(`/api/issues/${qcIssueId}/comments`).send({
      body: materialize.body, clientRequestId: materialize.clientRequestId, reopen: true,
    });
    expect(posted.status, JSON.stringify(posted.body)).toBe(201);
    const complete = await request(owner).post(crew(`/contributions/${created.body.id}/approve/complete`));
    expect(complete.status).toBe(200);
    expect(complete.body).toMatchObject({ status: "approved", resultCommentId: posted.body.id });

    const [row] = await db.select().from(issues).where(eq(issues.id, qcIssueId));
    expect(row).toMatchObject({ status: "todo", assigneeAgentId: agentId });
    const comments = await request(await app(agentActor())).get(`/api/issues/${qcIssueId}/comments`);
    const matching = (comments.body as { body: string; authorUserId: string }[]).filter((comment) => comment.body.includes(marker));
    expect(matching).toHaveLength(1);
    expect(matching[0]!.authorUserId).toBe(users.owner);
    await vi.waitFor(
      () => expect(wakeCalls.slice(wakesBefore).some((call) => call.agentId === agentId)).toBe(true),
      { timeout: 10_000 },
    );

    expect(await qcStates(users.qc)).toEqual([]);
    expect((await roundsOf(qcIssueId)).map((round) => [round.status, round.open])).toEqual([
      ["verified", false],
      ["reopened", false],
    ]);

    await setStatus(qcIssueId, "done");
    const [fresh] = await qcStates(users.qc);
    expect(fresh).toMatchObject({ issueId: qcIssueId, state: "awaiting", reopenRequest: null });
    expect((await roundsOf(qcIssueId)).filter((round) => round.open)).toHaveLength(1);

    // Owner cũng xác nhận được thay QC.
    const verified = await request(owner).post(crew(`/qc/issues/${qcIssueId}/verify`));
    expect(verified.status).toBe(200);
    expect(verified.body).toMatchObject({ state: "verified", verifiedByUserId: users.owner });
  }, 60_000);

  it("phòng lúc gửi quyết định: QC chuyển sang Marketing sau khi gửi thì yêu cầu vẫn chờ QC duyệt", async () => {
    const issueId = await approvedIssueFrom(users.qc2);
    const owner = await as(users.owner);
    expect((await request(owner).put(crew(`/contributors/${users.qc2}`)).send({ department: "marketing" })).status).toBe(204);
    await setStatus(issueId, "done");
    expect((await roundsOf(issueId)).map((round) => [round.status, round.qc_user_id])).toEqual([["awaiting", users.qc2]]);
  }, 60_000);
});

import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import request from "supertest";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  companies,
  companyMemberships,
  createDb,
  issueComments,
  issueCreateIdempotencyKeys,
  issues,
  projects,
} from "@paperclipai/db";
import { CREW_POLICY_CONFIG_ENV } from "../crew/issue-policy.js";
import { crewContributionsTable } from "../crew/contributions.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

const migration = readFileSync(
  fileURLToPath(new URL("../../../packages/crew-plugin/migrations/0013_contributions.sql", import.meta.url)),
  "utf8",
)
  .split(";")
  .map((statement) => statement.trim())
  .filter(Boolean);

const support = await getEmbeddedPostgresTestSupport();
const suite = support.supported ? describe.sequential : describe.skip;

type Role = "owner" | "admin" | "operator" | "viewer";

suite("Crew: router góp ý chờ duyệt", () => {
  let db: ReturnType<typeof createDb>;
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  const dir = mkdtempSync(path.join(tmpdir(), "crew-contributions-"));
  const configFile = path.join(dir, "crew-policy.json");
  const previousConfig = process.env[CREW_POLICY_CONFIG_ENV];

  const companyId = randomUUID();
  const otherCompanyId = randomUUID();
  const stockCompanyId = randomUUID();
  let projectId: string;
  let archivedProjectId: string;
  let otherProjectId: string;
  let issueId: string;
  let hiddenIssueId: string;
  let otherIssueId: string;
  const users = {
    owner: "user-owner",
    owner2: "user-owner-2",
    admin: "user-admin",
    operator: "user-operator",
    guest: "user-guest",
    guest2: "user-guest-2",
    viewer: "user-viewer",
    stockGuest: "user-stock-guest",
  };
  const roles: Record<string, Role> = {
    [users.owner]: "owner",
    [users.owner2]: "owner",
    [users.admin]: "admin",
    [users.operator]: "operator",
    [users.guest]: "viewer",
    [users.guest2]: "viewer",
    [users.viewer]: "viewer",
  };

  async function insertCompany(id: string, name: string) {
    await db.insert(companies).values({
      id,
      name,
      issuePrefix: `C${id.replaceAll("-", "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
  }

  beforeAll(async () => {
    temporary = await startEmbeddedPostgresTestDatabase("crew-contributions-db-");
    db = createDb(temporary.connectionString);
    await insertCompany(companyId, "Crew company");
    await insertCompany(otherCompanyId, "Crew other company");
    await insertCompany(stockCompanyId, "Stock company");
    const policy = () => ({ reviewerAgentId: randomUUID(), integratorAgentId: randomUUID(), ownerUserId: users.owner });
    process.env[CREW_POLICY_CONFIG_ENV] = configFile;
    writeFileSync(configFile, JSON.stringify({ companies: { [companyId]: policy(), [otherCompanyId]: policy() } }));

    const [project] = await db.insert(projects).values({ companyId, name: "Marketing" }).returning();
    const [archived] = await db.insert(projects).values({ companyId, name: "Old", archivedAt: new Date() }).returning();
    const [otherProject] = await db.insert(projects).values({ companyId: otherCompanyId, name: "Other" }).returning();
    projectId = project!.id;
    archivedProjectId = archived!.id;
    otherProjectId = otherProject!.id;
    const [issue] = await db.insert(issues).values({ companyId, projectId, title: "Base", status: "todo", priority: "medium" }).returning();
    const [hidden] = await db.insert(issues).values({
      companyId, projectId, title: "Hidden", status: "todo", priority: "medium", hiddenAt: new Date(),
    }).returning();
    const [otherIssue] = await db.insert(issues).values({
      companyId: otherCompanyId, projectId: otherProjectId, title: "Other", status: "todo", priority: "medium",
    }).returning();
    issueId = issue!.id;
    hiddenIssueId = hidden!.id;
    otherIssueId = otherIssue!.id;

    await db.insert(companyMemberships).values([
      ...Object.entries(roles).map(([principalId, membershipRole]) => ({
        companyId, principalType: "user", principalId, status: "active", membershipRole,
      })),
      { companyId: stockCompanyId, principalType: "user", principalId: users.stockGuest, status: "active", membershipRole: "viewer" },
    ]);
  }, 60_000);

  afterAll(async () => {
    if (previousConfig === undefined) delete process.env[CREW_POLICY_CONFIG_ENV];
    else process.env[CREW_POLICY_CONFIG_ENV] = previousConfig;
    await db?.$client.end({ timeout: 0 });
    await temporary?.cleanup();
    rmSync(dir, { recursive: true, force: true });
  });

  function board(userId: string, companyIds = [companyId], extra: Record<string, unknown> = {}) {
    return {
      type: "board",
      userId,
      source: "session",
      isInstanceAdmin: false,
      companyIds,
      memberships: companyIds.map((id) => ({ companyId: id, membershipRole: roles[userId] ?? "viewer", status: "active" })),
      ...extra,
    };
  }

  const agentActor = () => ({ type: "agent", agentId: randomUUID(), companyId, runId: randomUUID(), source: "agent_jwt" });

  async function app(actor: Record<string, unknown>) {
    const [{ crewContributionRoutes }, { errorHandler }] = await Promise.all([
      import("../crew/contribution-routes.js"),
      import("../middleware/index.js"),
    ]);
    const server = express();
    server.use(express.json());
    server.use((req, _res, next) => {
      req.actor = actor as typeof req.actor;
      next();
    });
    server.use("/api", crewContributionRoutes(db));
    server.use(errorHandler);
    return server;
  }

  const url = (suffix: string, company = companyId) => `/api/crew/companies/${company}${suffix}`;
  const as = async (userId: string) => app(board(userId));

  async function createIssueContribution(title = `Yêu cầu ${randomUUID()}`, author = users.guest) {
    const res = await request(await as(author)).post(url("/contributions")).send({
      kind: "issue", projectId, title, description: "Mô tả",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body as { id: string; status: string };
  }

  async function createCommentContribution(body = `Bình luận ${randomUUID()}`, author = users.guest) {
    const res = await request(await as(author)).post(url("/contributions")).send({ kind: "comment", issueId, body });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body as { id: string; status: string };
  }

  async function materializeIssue(contributionId: string) {
    const [created] = await db.insert(issues).values({
      companyId, projectId, title: "Materialized", status: "todo", priority: "medium",
    }).returning();
    await db.insert(issueCreateIdempotencyKeys).values({
      companyId, issueId: created!.id, idempotencyKey: `crew-contribution:${contributionId}`,
    });
    return created!.id;
  }

  async function materializeComment(contributionId: string, author = users.owner) {
    const [comment] = await db.insert(issueComments).values({
      companyId, issueId, body: "Materialized", authorUserId: author, clientRequestId: contributionId,
    }).returning();
    return comment!.id;
  }

  describe("chưa có bảng plugin", () => {
    it("mọi endpoint góp ý trả 503, riêng /access vẫn trả quyền", async () => {
      const res = await request(await as(users.owner)).get(url("/contributions"));
      expect(res.status).toBe(503);
      expect(res.body.code).toBe("crew_contributions_unavailable");

      const access = await request(await as(users.guest)).get(url("/access"));
      expect(access.status).toBe(200);
      expect(access.body).toEqual({ userId: users.guest, membershipRole: "viewer", contributor: false, canApprove: false });
    });
  });

  describe("bảng plugin đã migrate", () => {
    beforeAll(async () => {
      const namespace = crewContributionsTable().split(".")[0]!;
      await db.execute(sql.raw(`CREATE SCHEMA IF NOT EXISTS ${namespace}`));
      for (const statement of migration) await db.execute(sql.raw(statement));
      const owner = await as(users.owner);
      for (const userId of [users.guest, users.guest2]) {
        const res = await request(owner).put(url(`/contributors/${userId}`));
        expect(res.status).toBe(204);
      }
    });

    describe("quyền /access", () => {
      it("trả role từ DB, dấu khách góp ý và quyền duyệt", async () => {
        const cases: [string, unknown][] = [
          [users.owner, { membershipRole: "owner", contributor: false, canApprove: true }],
          [users.guest, { membershipRole: "viewer", contributor: true, canApprove: false }],
          [users.viewer, { membershipRole: "viewer", contributor: false, canApprove: false }],
          [users.operator, { membershipRole: "operator", contributor: false, canApprove: false }],
        ];
        for (const [userId, expected] of cases) {
          const res = await request(await as(userId)).get(url("/access"));
          expect(res.status, userId).toBe(200);
          expect(res.body, userId).toEqual({ userId, ...(expected as object) });
        }
      });

      it("instance admin không có membership: membershipRole null, không duyệt được", async () => {
        const server = await app(board("user-instance-admin", [companyId], { isInstanceAdmin: true, memberships: [] }));
        const access = await request(server).get(url("/access"));
        expect(access.status).toBe(200);
        expect(access.body).toEqual({ userId: "user-instance-admin", membershipRole: null, contributor: false, canApprove: false });
        expect((await request(server).get(url("/contributions"))).status).toBe(403);
      });

      it("agent, local_implicit nhận 403; company ngoài phiên hoặc không phải Crew nhận 404", async () => {
        const agent = await request(await app(agentActor())).get(url("/access"));
        expect(agent.status).toBe(403);
        expect(agent.body.code).toBe("crew_contribution_forbidden");
        const local = await request(await app({ type: "board", userId: "local-board", source: "local_implicit" })).get(url("/access"));
        expect(local.status).toBe(403);
        expect((await request(await as(users.owner)).get(url("/access", otherCompanyId))).status).toBe(404);
        const stock = await request(await app(board(users.stockGuest, [stockCompanyId]))).get(url("/access", stockCompanyId));
        expect(stock.status).toBe(404);
      });
    });

    describe("tạo góp ý", () => {
      it("khách tạo yêu cầu và bình luận: 201, pending, không ghi activity", async () => {
        const before = await db.select().from(activityLog);
        const issueItem = await request(await as(users.guest)).post(url("/contributions")).send({
          kind: "issue", projectId, title: "  Cần trang giới thiệu  ", description: "Dòng 1\\nDòng 2",
        });
        expect(issueItem.status).toBe(201);
        expect(issueItem.body).toMatchObject({
          kind: "issue", status: "pending", authorUserId: users.guest, projectId, targetIssueId: null,
          title: "Cần trang giới thiệu", body: "Dòng 1\nDòng 2", decidedAt: null, decidedByUserId: null,
          resultIssueId: null, resultCommentId: null,
        });
        expect(new Date(issueItem.body.createdAt).toISOString()).toBe(issueItem.body.createdAt);

        const comment = await request(await as(users.guest)).post(url("/contributions")).send({ kind: "comment", issueId, body: "Góp ý" });
        expect(comment.status).toBe(201);
        expect(comment.body).toMatchObject({ kind: "comment", status: "pending", targetIssueId: issueId, projectId: null, title: null });

        const noDescription = await request(await as(users.guest)).post(url("/contributions")).send({ kind: "issue", projectId, title: "Chỉ tiêu đề" });
        expect(noDescription.status).toBe(201);
        expect(noDescription.body.body).toBeNull();
        expect(await db.select().from(activityLog)).toHaveLength(before.length);
      });

      it("viewer không dấu, operator, admin, owner, agent đều nhận 403", async () => {
        const body = { kind: "issue", projectId, title: "Không được" };
        for (const userId of [users.viewer, users.operator, users.admin, users.owner]) {
          const res = await request(await as(userId)).post(url("/contributions")).send(body);
          expect(res.status, userId).toBe(403);
          expect(res.body.code, userId).toBe("crew_contribution_forbidden");
        }
        expect((await request(await app(agentActor())).post(url("/contributions")).send(body)).status).toBe(403);
      });

      it("company không phải Crew nhận 404", async () => {
        const res = await request(await app(board(users.stockGuest, [stockCompanyId])))
          .post(url("/contributions", stockCompanyId))
          .send({ kind: "issue", projectId, title: "Stock" });
        expect(res.status).toBe(404);
      });

      it("project/issue của company khác, project lưu trữ, issue ẩn: 422", async () => {
        const guest = await as(users.guest);
        const bodies = [
          { kind: "issue", projectId: otherProjectId, title: "x" },
          { kind: "issue", projectId: archivedProjectId, title: "x" },
          { kind: "comment", issueId: otherIssueId, body: "x" },
          { kind: "comment", issueId: hiddenIssueId, body: "x" },
          { kind: "comment", issueId: randomUUID(), body: "x" },
        ];
        for (const body of bodies) {
          const res = await request(guest).post(url("/contributions")).send(body);
          expect(res.status, JSON.stringify(body)).toBe(422);
          expect(res.body.code).toBe("crew_contribution_invalid_target");
        }
      });

      it("tiêu đề rỗng hoặc dài 241, bình luận rỗng, trường lạ: 400", async () => {
        const guest = await as(users.guest);
        const bodies = [
          { kind: "issue", projectId, title: "   " },
          { kind: "issue", projectId, title: "a".repeat(241) },
          { kind: "issue", projectId, title: "ok", assigneeAgentId: randomUUID() },
          { kind: "issue", projectId, title: "ok", status: "todo" },
          { kind: "comment", issueId, body: "" },
          { kind: "comment", issueId, body: "ok", reopen: true },
          { kind: "other", title: "x" },
        ];
        for (const body of bodies) {
          const res = await request(guest).post(url("/contributions")).send(body);
          expect(res.status, JSON.stringify(body)).toBe(400);
          expect(res.body.code).toBe("crew_contribution_invalid");
        }
        const ok = await request(guest).post(url("/contributions")).send({ kind: "issue", projectId, title: "a".repeat(240) });
        expect(ok.status).toBe(201);
      });
    });

    describe("quyền đọc", () => {
      it("khách chỉ thấy mục của mình; owner thấy tất cả; admin và viewer thuần 403", async () => {
        const mine = await createIssueContribution();
        const theirs = await createIssueContribution(undefined, users.guest2);

        const guestList = await request(await as(users.guest)).get(url("/contributions"));
        expect(guestList.status).toBe(200);
        const guestIds = (guestList.body.items as { id: string; authorUserId: string }[]).map((item) => item.id);
        expect(guestIds).toContain(mine.id);
        expect(guestIds).not.toContain(theirs.id);
        expect(new Set(guestList.body.items.map((item: { authorUserId: string }) => item.authorUserId))).toEqual(new Set([users.guest]));

        const ownerList = await request(await as(users.owner)).get(url("/contributions"));
        const ownerIds = (ownerList.body.items as { id: string }[]).map((item) => item.id);
        expect(ownerIds).toEqual(expect.arrayContaining([mine.id, theirs.id]));

        expect((await request(await as(users.guest)).get(url(`/contributions/${theirs.id}`))).status).toBe(404);
        expect((await request(await as(users.guest)).get(url(`/contributions/${mine.id}`))).status).toBe(200);
        expect((await request(await as(users.owner)).get(url(`/contributions/${theirs.id}`))).status).toBe(200);
        for (const userId of [users.admin, users.viewer, users.operator]) {
          expect((await request(await as(userId)).get(url("/contributions"))).status, userId).toBe(403);
          expect((await request(await as(userId)).get(url("/contributions/summary"))).status, userId).toBe(403);
          expect((await request(await as(userId)).get(url(`/contributions/${mine.id}`))).status, userId).toBe(403);
        }
      });

      it("lọc theo status, kind, issueId; summary đếm pending gồm approving", async () => {
        const comment = await createCommentContribution();
        const owner = await as(users.owner);
        const byIssue = await request(owner).get(url(`/contributions?issueId=${issueId}`));
        expect(byIssue.body.items.every((item: { kind: string; targetIssueId: string }) =>
          item.kind === "comment" && item.targetIssueId === issueId)).toBe(true);
        expect(byIssue.body.items.map((item: { id: string }) => item.id)).toContain(comment.id);

        const before = (await request(owner).get(url("/contributions/summary"))).body.pending as number;
        expect((await request(owner).post(url(`/contributions/${comment.id}/approve`))).status).toBe(200);
        const pending = await request(owner).get(url("/contributions?status=pending&kind=comment"));
        expect(pending.body.items.find((item: { id: string }) => item.id === comment.id)?.status).toBe("approving");
        expect((await request(owner).get(url("/contributions/summary"))).body).toEqual({ pending: before });

        const guestSummary = await request(await as(users.guest2)).get(url("/contributions/summary"));
        expect(guestSummary.status).toBe(200);
        expect(typeof guestSummary.body.pending).toBe("number");
        expect((await request(owner).get(url("/contributions?status=bogus"))).status).toBe(400);
      });
    });

    describe("đổi trạng thái", () => {
      it("approve hai lần cùng owner giữ approving và trả cùng khóa idempotent", async () => {
        const item = await createIssueContribution("Trang giới thiệu");
        const owner = await as(users.owner);
        const first = await request(owner).post(url(`/contributions/${item.id}/approve`));
        expect(first.status).toBe(200);
        expect(first.body.contribution).toMatchObject({ id: item.id, status: "approving", decidedByUserId: users.owner });
        expect(first.body.materialize).toEqual({
          kind: "issue", companyId, projectId, title: "Trang giới thiệu", description: "Mô tả",
          idempotencyKey: `crew-contribution:${item.id}`,
        });
        const second = await request(owner).post(url(`/contributions/${item.id}/approve`));
        expect(second.status).toBe(200);
        expect(second.body.materialize).toEqual(first.body.materialize);
      });

      it("approve bình luận trả clientRequestId là id mục", async () => {
        const item = await createCommentContribution("Nội dung góp ý");
        const res = await request(await as(users.owner)).post(url(`/contributions/${item.id}/approve`));
        expect(res.body.materialize).toEqual({ kind: "comment", issueId, body: "Nội dung góp ý", clientRequestId: item.id });
      });

      it("owner khác trong 10 phút nhận 409 locked, sau 10 phút giành được", async () => {
        const item = await createCommentContribution();
        expect((await request(await as(users.owner)).post(url(`/contributions/${item.id}/approve`))).status).toBe(200);
        const locked = await request(await as(users.owner2)).post(url(`/contributions/${item.id}/approve`));
        expect(locked.status).toBe(409);
        expect(locked.body.code).toBe("crew_contribution_locked");
        const lockedReject = await request(await as(users.owner2)).post(url(`/contributions/${item.id}/reject`));
        expect(lockedReject.status).toBe(409);
        expect(lockedReject.body.code).toBe("crew_contribution_locked");

        await db.execute(sql`UPDATE ${sql.raw(crewContributionsTable())}
          SET approving_at = now() - interval '11 minutes' WHERE id = ${item.id}`);
        const taken = await request(await as(users.owner2)).post(url(`/contributions/${item.id}/approve`));
        expect(taken.status).toBe(200);
        expect(taken.body.contribution).toMatchObject({ status: "approving", decidedByUserId: users.owner2 });
      });

      it("trước khi giành lại, bản ghi do owner trước đăng làm mục thành approved (409 decided)", async () => {
        const item = await createCommentContribution();
        expect((await request(await as(users.owner)).post(url(`/contributions/${item.id}/approve`))).status).toBe(200);
        const commentId = await materializeComment(item.id, users.owner);
        await db.execute(sql`UPDATE ${sql.raw(crewContributionsTable())}
          SET approving_at = now() - interval '11 minutes' WHERE id = ${item.id}`);
        const res = await request(await as(users.owner2)).post(url(`/contributions/${item.id}/approve`));
        expect(res.status).toBe(409);
        expect(res.body.code).toBe("crew_contribution_decided");
        expect(res.body.contribution).toMatchObject({ status: "approved", resultCommentId: commentId, decidedByUserId: users.owner });
      });

      it("complete khi chưa có bản ghi: 409, mục giữ approving", async () => {
        const item = await createIssueContribution();
        const owner = await as(users.owner);
        expect((await request(owner).post(url(`/contributions/${item.id}/approve`))).status).toBe(200);
        const res = await request(owner).post(url(`/contributions/${item.id}/approve/complete`));
        expect(res.status).toBe(409);
        expect(res.body.code).toBe("crew_contribution_not_materialized");
        expect(res.body.error).toBe("Chưa thấy bản ghi đã đăng, hãy bấm Duyệt lại.");
        expect(res.body.contribution.status).toBe("approving");
      });

      it("complete khi có dòng idempotency: approved + result_issue_id; gọi lại vẫn 200", async () => {
        const item = await createIssueContribution();
        const owner = await as(users.owner);
        await request(owner).post(url(`/contributions/${item.id}/approve`));
        const resultIssueId = await materializeIssue(item.id);
        const res = await request(owner).post(url(`/contributions/${item.id}/approve/complete`));
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ status: "approved", resultIssueId, resultCommentId: null, decidedByUserId: users.owner });
        expect(res.body.decidedAt).toEqual(expect.any(String));
        const again = await request(owner).post(url(`/contributions/${item.id}/approve/complete`));
        expect(again.status).toBe(200);
        expect(again.body).toEqual(res.body);
      });

      it("complete khi có bình luận client_request_id = id (tác giả bất kỳ): approved + result_comment_id", async () => {
        const item = await createCommentContribution();
        const owner = await as(users.owner);
        await request(owner).post(url(`/contributions/${item.id}/approve`));
        const commentId = await materializeComment(item.id, users.owner2);
        const res = await request(owner).post(url(`/contributions/${item.id}/approve/complete`));
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ status: "approved", resultCommentId: commentId, resultIssueId: null });
      });

      it("idempotency của company khác không được tính", async () => {
        const item = await createIssueContribution();
        const owner = await as(users.owner);
        await request(owner).post(url(`/contributions/${item.id}/approve`));
        const [foreign] = await db.insert(issues).values({
          companyId: otherCompanyId, projectId: otherProjectId, title: "Foreign", status: "todo", priority: "medium",
        }).returning();
        await db.insert(issueCreateIdempotencyKeys).values({
          companyId: otherCompanyId, issueId: foreign!.id, idempotencyKey: `crew-contribution:${item.id}`,
        });
        expect((await request(owner).post(url(`/contributions/${item.id}/approve/complete`))).status).toBe(409);
      });

      it("complete trên mục pending: 409 not_approving", async () => {
        const item = await createIssueContribution();
        const res = await request(await as(users.owner)).post(url(`/contributions/${item.id}/approve/complete`));
        expect(res.status).toBe(409);
        expect(res.body.code).toBe("crew_contribution_not_approving");
      });

      it("reject pending: rejected; reject lại vẫn rejected; approve sau đó 409", async () => {
        const item = await createCommentContribution();
        const owner = await as(users.owner);
        const res = await request(owner).post(url(`/contributions/${item.id}/reject`));
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ status: "rejected", decidedByUserId: users.owner });
        expect((await request(owner).post(url(`/contributions/${item.id}/reject`))).body.status).toBe("rejected");
        const approve = await request(owner).post(url(`/contributions/${item.id}/approve`));
        expect(approve.status).toBe(409);
        expect(approve.body.code).toBe("crew_contribution_decided");
        expect(approve.body.contribution.status).toBe("rejected");

        const guest = await request(await as(users.guest)).get(url("/contributions?status=rejected"));
        expect(guest.body.items.map((entry: { id: string }) => entry.id)).toContain(item.id);
      });

      it("reject approving không có bản ghi: rejected", async () => {
        const item = await createIssueContribution();
        const owner = await as(users.owner);
        await request(owner).post(url(`/contributions/${item.id}/approve`));
        const res = await request(owner).post(url(`/contributions/${item.id}/reject`));
        expect(res.status).toBe(200);
        expect(res.body.status).toBe("rejected");
      });

      it("reject approving đã có bản ghi: approved + 409; mục cuối không đổi được", async () => {
        const item = await createIssueContribution();
        const owner = await as(users.owner);
        await request(owner).post(url(`/contributions/${item.id}/approve`));
        const resultIssueId = await materializeIssue(item.id);
        const res = await request(owner).post(url(`/contributions/${item.id}/reject`));
        expect(res.status).toBe(409);
        expect(res.body.code).toBe("crew_contribution_already_approved");
        expect(res.body.contribution).toMatchObject({ status: "approved", resultIssueId });

        const again = await request(owner).post(url(`/contributions/${item.id}/reject`));
        expect(again.status).toBe(409);
        const approve = await request(owner).post(url(`/contributions/${item.id}/approve`));
        expect(approve.status).toBe(409);
        expect(approve.body.contribution.status).toBe("approved");
      });

      it("hai owner duyệt cùng lúc: chỉ một người giữ khóa", async () => {
        const item = await createIssueContribution();
        const [a, b] = await Promise.all([
          request(await as(users.owner)).post(url(`/contributions/${item.id}/approve`)),
          request(await as(users.owner2)).post(url(`/contributions/${item.id}/approve`)),
        ]);
        expect([a.status, b.status].sort()).toEqual([200, 409]);
      });

      it("chỉ owner duyệt/từ chối: admin, operator, khách, viewer, agent nhận 403", async () => {
        const item = await createIssueContribution();
        for (const userId of [users.admin, users.operator, users.guest, users.viewer]) {
          for (const action of ["approve", "approve/complete", "reject"]) {
            const res = await request(await as(userId)).post(url(`/contributions/${item.id}/${action}`));
            expect(res.status, `${userId} ${action}`).toBe(403);
          }
        }
        expect((await request(await app(agentActor())).post(url(`/contributions/${item.id}/approve`))).status).toBe(403);
        const row = await request(await as(users.owner)).get(url(`/contributions/${item.id}`));
        expect(row.body.status).toBe("pending");
      });

      it("id không tồn tại hoặc sai định dạng: 404", async () => {
        const owner = await as(users.owner);
        expect((await request(owner).post(url(`/contributions/${randomUUID()}/approve`))).status).toBe(404);
        expect((await request(owner).get(url("/contributions/not-a-uuid"))).status).toBe(404);
      });
    });

    describe("tự lành", () => {
      it("dòng approving đã có bản ghi: GET /contributions và summary trả approved", async () => {
        const item = await createCommentContribution();
        const owner = await as(users.owner);
        await request(owner).post(url(`/contributions/${item.id}/approve`));
        const commentId = await materializeComment(item.id);
        const list = await request(owner).get(url("/contributions?kind=comment"));
        expect(list.body.items.find((entry: { id: string }) => entry.id === item.id)).toMatchObject({
          status: "approved", resultCommentId: commentId,
        });

        const second = await createIssueContribution();
        await request(owner).post(url(`/contributions/${second.id}/approve`));
        const resultIssueId = await materializeIssue(second.id);
        await request(owner).get(url("/contributions/summary"));
        expect((await request(owner).get(url(`/contributions/${second.id}`))).body).toMatchObject({ status: "approved", resultIssueId });
      });
    });

    describe("dấu khách góp ý", () => {
      it("PUT cho viewer 204, cho operator 409; GET liệt kê; DELETE 204 và khách mất quyền tạo", async () => {
        const owner = await as(users.owner);
        const temp = `user-temp-${randomUUID()}`;
        await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: temp, status: "active", membershipRole: "viewer" });
        roles[temp] = "viewer";

        expect((await request(owner).put(url(`/contributors/${temp}`))).status).toBe(204);
        expect((await request(owner).put(url(`/contributors/${temp}`))).status).toBe(204);
        const operator = await request(owner).put(url(`/contributors/${users.operator}`));
        expect(operator.status).toBe(409);
        expect(operator.body.code).toBe("crew_contributor_requires_viewer");
        expect(operator.body.error).toBe("Chỉ bật góp ý cho thành viên viewer đang hoạt động.");
        expect((await request(owner).put(url(`/contributors/user-unknown`))).status).toBe(409);

        const list = await request(owner).get(url("/contributors"));
        expect(list.status).toBe(200);
        expect(list.body.items).toEqual(expect.arrayContaining([
          { userId: temp, grantedAt: expect.any(String), grantedByUserId: users.owner },
        ]));

        const created = await request(await as(temp)).post(url("/contributions")).send({ kind: "comment", issueId, body: "x" });
        expect(created.status).toBe(201);
        expect((await request(owner).delete(url(`/contributors/${temp}`))).status).toBe(204);
        expect((await request(owner).delete(url(`/contributors/${temp}`))).status).toBe(204);
        const after = await request(await as(temp)).post(url("/contributions")).send({ kind: "comment", issueId, body: "x" });
        expect(after.status).toBe(403);
        expect((await request(await as(temp)).get(url("/access"))).body.contributor).toBe(false);
      });

      it("owner nâng khách lên operator thì dấu hết tác dụng", async () => {
        const promoted = `user-promoted-${randomUUID()}`;
        await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: promoted, status: "active", membershipRole: "viewer" });
        roles[promoted] = "viewer";
        expect((await request(await as(users.owner)).put(url(`/contributors/${promoted}`))).status).toBe(204);
        await db.execute(sql`UPDATE "company_memberships" SET membership_role = 'operator' WHERE principal_id = ${promoted}`);
        const res = await request(await as(promoted)).post(url("/contributions")).send({ kind: "comment", issueId, body: "x" });
        expect(res.status).toBe(403);
      });

      it("chỉ owner quản lý dấu", async () => {
        for (const userId of [users.admin, users.operator, users.guest]) {
          const server = await as(userId);
          expect((await request(server).get(url("/contributors"))).status, userId).toBe(403);
          expect((await request(server).put(url(`/contributors/${users.viewer}`))).status, userId).toBe(403);
          expect((await request(server).delete(url(`/contributors/${users.guest}`))).status, userId).toBe(403);
        }
      });
    });
  });
});

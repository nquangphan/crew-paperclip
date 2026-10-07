import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { agents, companies, createDb, issues } from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { decideCreatePolicy } from "../crew/issue-create-policy.ts";
import { issueService } from "../services/issues.js";

const roles = { reviewerAgentId: "r", integratorAgentId: "i" };

describe("decideCreatePolicy", () => {
  it("agent tạo issue gốc bị từ chối", () => {
    expect(decideCreatePolicy({ data: { createdByAgentId: "e" }, roles, ownerUserId: "owner-1" })).toEqual({
      kind: "reject",
      code: "crew_agent_root_issue",
    });
  });
  it("agent tạo issue con: luôn thay bằng template con", () => {
    const d = decideCreatePolicy({
      data: { createdByAgentId: "e", parentId: "p", executionPolicy: { stages: [] } },
      roles,
      ownerUserId: null,
    });
    expect(d).toMatchObject({ kind: "set", template: "child" });
  });
  it("agent giao việc cho reviewer hoặc integrator bị từ chối", () => {
    for (const assigneeAgentId of ["r", "i"]) {
      expect(
        decideCreatePolicy({ data: { createdByAgentId: "e", parentId: "p", assigneeAgentId }, roles, ownerUserId: null }),
      ).toEqual({ kind: "reject", code: "crew_role_assignee" });
    }
  });
  it("agent tạo khi company chưa có vai trò bị từ chối; board thì giữ nguyên", () => {
    expect(
      decideCreatePolicy({ data: { createdByAgentId: "e", parentId: "p" }, roles: null, ownerUserId: null }),
    ).toEqual({ kind: "reject", code: "crew_roles_unconfigured" });
    expect(decideCreatePolicy({ data: { createdByUserId: "owner-1" }, roles: null, ownerUserId: null })).toEqual({
      kind: "keep",
    });
  });
  it("board tạo issue gốc không policy: template gốc với owner là người tạo", () => {
    expect(
      decideCreatePolicy({ data: { createdByUserId: "owner-1" }, roles, ownerUserId: "default-owner" }),
    ).toEqual({ kind: "set", template: "root", ownerUserId: "owner-1" });
  });
  it("board tạo issue con không policy: template con", () => {
    expect(decideCreatePolicy({ data: { createdByUserId: "owner-1", parentId: "p" }, roles, ownerUserId: null })).toEqual(
      { kind: "set", template: "child" },
    );
  });
  it("board gửi policy riêng thì giữ nguyên", () => {
    expect(
      decideCreatePolicy({
        data: { createdByUserId: "owner-1", executionPolicy: { stages: [] } },
        roles,
        ownerUserId: null,
      }),
    ).toEqual({ kind: "keep" });
  });
  it("hệ thống tạo issue gốc: owner mặc định của company, không có thì giữ nguyên", () => {
    expect(decideCreatePolicy({ data: {}, roles, ownerUserId: "default-owner" })).toEqual({
      kind: "set",
      template: "root",
      ownerUserId: "default-owner",
    });
    expect(decideCreatePolicy({ data: {}, roles, ownerUserId: null })).toEqual({ kind: "keep" });
  });
});

// Hook H4 (first line of issueService.create) through the real service: createChild and every
// other caller of create receive the Crew policy template.
const support = await getEmbeddedPostgresTestSupport();
const suite = support.supported ? describe : describe.skip;

suite("crew policy in issueService.create", () => {
  let db: ReturnType<typeof createDb>;
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;

  beforeAll(async () => {
    temporary = await startEmbeddedPostgresTestDatabase("crew-issue-create-policy-");
    db = createDb(temporary.connectionString);
  }, 60_000);
  afterAll(async () => {
    await db?.$client.end({ timeout: 0 });
    await temporary?.cleanup();
  });

  async function seed() {
    const companyId = randomUUID();
    const executorId = randomUUID();
    const reviewerId = randomUUID();
    const integratorId = randomUUID();
    const rootId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Crew create",
      issuePrefix: `C${companyId.replace(/-/g, "").slice(0, 5).toUpperCase()}`,
      defaultResponsibleUserId: "owner-1",
    });
    const agent = (id: string, name: string, metadata: Record<string, unknown> | null) => ({
      id,
      companyId,
      name,
      role: "engineer",
      status: "idle",
      adapterType: "process",
      adapterConfig: {},
      permissions: {},
      metadata,
      runtimeConfig: { heartbeat: { enabled: false, wakeOnDemand: false, maxConcurrentRuns: 1 } },
    });
    await db
      .insert(agents)
      .values([
        agent(executorId, "Executor", null),
        agent(reviewerId, "Reviewer", { crewRole: "reviewer" }),
        agent(integratorId, "Integrator", { crewRole: "integrator" }),
      ]);
    await db.insert(issues).values({
      id: rootId,
      companyId,
      title: "Yêu cầu gốc",
      status: "todo",
      createdByUserId: "owner-1",
      responsibleUserId: "owner-1",
    });
    return { companyId, executorId, reviewerId, integratorId, rootId };
  }

  it("agent tạo issue gốc qua service bị 422", async () => {
    const { companyId, executorId } = await seed();
    await expect(
      issueService(db).create(companyId, { title: "x", createdByAgentId: executorId }),
    ).rejects.toMatchObject({ status: 422, details: { code: "crew_agent_root_issue" } });
  });

  it("agent tạo issue con qua createChild: policy template con, có responsibleUserId để leo thang", async () => {
    const { executorId, reviewerId, rootId } = await seed();
    const { issue } = await issueService(db).createChild(rootId, {
      title: "con",
      createdByAgentId: executorId,
      executionPolicy: { stages: [] },
    } as never);
    const [row] = await db.select().from(issues).where(eq(issues.id, issue.id));
    const policy = row!.executionPolicy as {
      stages: Array<{ type: string; participants: Array<{ agentId: string | null }> }>;
      maxReviewRounds: number;
    };
    expect(policy.stages.map((s) => s.type)).toEqual(["review"]);
    expect(policy.stages[0]!.participants.map((p) => p.agentId)).toEqual([reviewerId]);
    expect(policy.maxReviewRounds).toBe(5);
    expect(row!.responsibleUserId).toBe("owner-1");
  });

  it("agent giao issue con cho reviewer bị 422 crew_role_assignee", async () => {
    const { executorId, reviewerId, rootId } = await seed();
    await expect(
      issueService(db).createChild(rootId, {
        title: "con",
        createdByAgentId: executorId,
        assigneeAgentId: reviewerId,
      } as never),
    ).rejects.toMatchObject({ status: 422, details: { code: "crew_role_assignee" } });
  });

  it("board tạo issue gốc không policy: template ba stage, owner là người tạo", async () => {
    const { companyId, integratorId } = await seed();
    const created = await issueService(db).create(companyId, { title: "yêu cầu", createdByUserId: "owner-1" });
    const policy = created.executionPolicy as {
      stages: Array<{ type: string; participants: Array<{ agentId: string | null; userId: string | null }> }>;
    };
    expect(policy.stages.map((s) => s.type)).toEqual(["review", "review", "approval"]);
    expect(policy.stages[1]!.participants[0]!.agentId).toBe(integratorId);
    expect(policy.stages[2]!.participants[0]!.userId).toBe("owner-1");
  });
});

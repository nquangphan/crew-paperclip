import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { agents, companies, createDb, issues } from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { decideCreatePolicy } from "../crew/issue-create-policy.ts";
import { CREW_POLICY_CONFIG_ENV } from "../crew/issue-policy.ts";
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
  it("agent tạo issue ở trạng thái done, cancelled hoặc in_review bị từ chối", () => {
    for (const status of ["done", "cancelled", "in_review"]) {
      expect(
        decideCreatePolicy({ data: { createdByAgentId: "e", parentId: "p", status }, roles, ownerUserId: "owner-1" }),
      ).toEqual({ kind: "reject", code: "crew_gate_blocked" });
    }
    expect(
      decideCreatePolicy({ data: { createdByAgentId: "e", parentId: "p", status: "todo" }, roles, ownerUserId: null }),
    ).toEqual({ kind: "set", template: "child" });
  });
  it("board tạo issue gốc không policy: template gốc với owner của file cấu hình", () => {
    expect(decideCreatePolicy({ data: { createdByUserId: "board-2" }, roles, ownerUserId: "owner-1" })).toEqual({
      kind: "set",
      template: "root",
      ownerUserId: "owner-1",
    });
  });
  it("board tạo issue con không policy: template con", () => {
    expect(decideCreatePolicy({ data: { createdByUserId: "owner-1", parentId: "p" }, roles, ownerUserId: "owner-1" })).toEqual(
      { kind: "set", template: "child" },
    );
  });
  it("board gửi policy riêng thì giữ nguyên", () => {
    expect(
      decideCreatePolicy({
        data: { createdByUserId: "owner-1", executionPolicy: { stages: [] } },
        roles,
        ownerUserId: "owner-1",
      }),
    ).toEqual({ kind: "keep" });
  });
  it("hệ thống tạo issue (không người tạo) thì giữ hành vi stock", () => {
    expect(decideCreatePolicy({ data: {}, roles, ownerUserId: "owner-1" })).toEqual({ kind: "keep" });
    expect(decideCreatePolicy({ data: { parentId: "p" }, roles, ownerUserId: "owner-1" })).toEqual({ kind: "keep" });
  });
});

// Hook H4 (first line of issueService.create) through the real service: createChild and every
// other caller of create receive the Crew policy template.
const support = await getEmbeddedPostgresTestSupport();
const suite = support.supported ? describe : describe.skip;

suite("crew policy in issueService.create", () => {
  let db: ReturnType<typeof createDb>;
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  const configDir = mkdtempSync(path.join(tmpdir(), "crew-issue-create-config-"));
  const configFile = path.join(configDir, "crew-policy.json");
  const configured: Record<string, unknown> = {};
  const previousEnv = process.env[CREW_POLICY_CONFIG_ENV];
  const writeConfig = () => writeFileSync(configFile, JSON.stringify({ companies: configured }));

  beforeAll(async () => {
    writeConfig();
    process.env[CREW_POLICY_CONFIG_ENV] = configFile;
    temporary = await startEmbeddedPostgresTestDatabase("crew-issue-create-policy-");
    db = createDb(temporary.connectionString);
  }, 60_000);
  afterAll(async () => {
    if (previousEnv === undefined) delete process.env[CREW_POLICY_CONFIG_ENV];
    else process.env[CREW_POLICY_CONFIG_ENV] = previousEnv;
    rmSync(configDir, { recursive: true, force: true });
    await db?.$client.end({ timeout: 0 });
    await temporary?.cleanup();
  });

  async function seed(config: "ok" | "invalid" | "absent" = "ok") {
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
    const agent = (id: string, name: string) => ({
      id,
      companyId,
      name,
      role: "engineer",
      status: "idle",
      adapterType: "process",
      adapterConfig: {},
      permissions: {},
      runtimeConfig: { heartbeat: { enabled: false, wakeOnDemand: false, maxConcurrentRuns: 1 } },
    });
    await db
      .insert(agents)
      .values([agent(executorId, "Executor"), agent(reviewerId, "Reviewer"), agent(integratorId, "Integrator")]);
    if (config === "ok") configured[companyId] = { reviewerAgentId: reviewerId, integratorAgentId: integratorId, ownerUserId: "owner-1" };
    if (config === "invalid") configured[companyId] = { reviewerAgentId: reviewerId, integratorAgentId: reviewerId, ownerUserId: "owner-1" };
    writeConfig();
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

  it("agent tạo issue con thẳng ở done/cancelled/in_review bị 422 crew_gate_blocked", async () => {
    const { executorId, rootId } = await seed();
    for (const status of ["done", "cancelled", "in_review"]) {
      await expect(
        issueService(db).createChild(rootId, { title: `con ${status}`, createdByAgentId: executorId, status } as never),
      ).rejects.toMatchObject({ status: 422, details: { code: "crew_gate_blocked" } });
    }
    const children = await db.select().from(issues).where(eq(issues.parentId, rootId));
    expect(children).toHaveLength(0);
  });

  it("board tạo issue gốc không policy: template ba stage, owner theo file cấu hình", async () => {
    const { companyId, integratorId } = await seed();
    const created = await issueService(db).create(companyId, { title: "yêu cầu", createdByUserId: "board-2" });
    const policy = created.executionPolicy as {
      stages: Array<{ type: string; participants: Array<{ agentId: string | null; userId: string | null }> }>;
    };
    expect(policy.stages.map((s) => s.type)).toEqual(["review", "review", "approval"]);
    expect(policy.stages[1]!.participants[0]!.agentId).toBe(integratorId);
    expect(policy.stages[2]!.participants[0]!.userId).toBe("owner-1");
  });

  it("hệ thống tạo issue phụ (không người tạo): không gắn template và đóng được như stock", async () => {
    const { companyId, rootId } = await seed();
    const created = await issueService(db).create(companyId, { title: "evaluation", parentId: rootId });
    expect(created.executionPolicy).toBeNull();
    expect((await issueService(db).update(created.id, { status: "done" }))?.status).toBe("done");
  });

  it("company không có trong file cấu hình: agent tạo issue gốc như stock", async () => {
    const { companyId, executorId } = await seed("absent");
    const created = await issueService(db).create(companyId, { title: "gốc", createdByAgentId: executorId });
    expect(created.executionPolicy).toBeNull();
  });

  it("cấu hình company lỗi: agent tạo issue con bị 422 crew_roles_unconfigured", async () => {
    const { executorId, rootId } = await seed("invalid");
    await expect(
      issueService(db).createChild(rootId, { title: "con", createdByAgentId: executorId } as never),
    ).rejects.toMatchObject({ status: 422, details: { code: "crew_roles_unconfigured" } });
  });
});

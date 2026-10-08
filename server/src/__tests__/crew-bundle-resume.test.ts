import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  activityLog,
  agentTaskSessions,
  agentWakeupRequests,
  agents,
  companies,
  createDb,
  heartbeatRuns,
  issueRelations,
  issues,
} from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import {
  applyBundleResume,
  applyBundleResumeSafely,
  parseCrewBundle,
  pickBundlePredecessor,
} from "../crew/bundle-resume.ts";
import { heartbeatService } from "../services/heartbeat.js";
import { crewCoreHooks } from "../crew/core-hooks.ts";
import * as loadGate from "../crew/load-gate.ts";
import * as bundleResume from "../crew/bundle-resume.ts";
import * as activity from "../services/activity-log.ts";
import { logger } from "../middleware/logger.js";

const execute = vi.hoisted(() => vi.fn());
vi.mock("../adapters/index.js", async () => {
  const actual = await vi.importActual<typeof import("../adapters/index.js")>("../adapters/index.js");
  return { ...actual, getServerAdapter: vi.fn(() => ({ supportsLocalAgentJwt: false, execute })) };
});

describe("parseCrewBundle", () => {
  it("đọc dòng marker ở giữa mô tả", () => {
    expect(parseCrewBundle("Làm A\ncrew-bundle id=greet seq=2\nAC: …")).toEqual({ id: "greet", seq: 2 });
    expect(parseCrewBundle("x\r\ncrew-bundle id=greet-api seq=10\r\n")).toEqual({ id: "greet-api", seq: 10 });
  });
  it("từ chối id hoa, seq 0, chữ thừa và mô tả rỗng", () => {
    expect(parseCrewBundle("crew-bundle id=Greet seq=1")).toBeNull();
    expect(parseCrewBundle("crew-bundle id=greet seq=0")).toBeNull();
    expect(parseCrewBundle("crew-bundle id=greet seq=1 thêm")).toBeNull();
    expect(parseCrewBundle(null)).toBeNull();
  });
  it("giữ giới hạn marker và lấy dòng hợp lệ đầu tiên", () => {
    expect(parseCrewBundle(`crew-bundle id=${"a".repeat(40)} seq=999`)).toEqual({ id: "a".repeat(40), seq: 999 });
    for (const line of [
      `crew-bundle id=${"a".repeat(41)} seq=1`, "crew-bundle id=a seq=1000",
      "crew-bundle id=a seq=01", " crew-bundle id=a seq=1", "crew-bundle id=a seq=1 ",
    ]) expect(parseCrewBundle(line)).toBeNull();
    expect(parseCrewBundle("crew-bundle id=first seq=2\ncrew-bundle id=second seq=1")).toEqual({ id: "first", seq: 2 });
  });
});

describe("pickBundlePredecessor", () => {
  const session = (lastRunId: string, at: number) => ({
    lastRunId,
    sessionParamsJson: { sessionId: lastRunId },
    sessionDisplayId: lastRunId,
    updatedAt: new Date(at),
  });
  const c = (issueId: string, description: string, status = "done", s = session(`run-${issueId}`, 1)) => ({
    issueId, status, description, session: s,
  });
  it("chọn tiền nhiệm cùng gói, seq lớn nhất nhỏ hơn seq của mình, đã done và có session", () => {
    const picked = pickBundlePredecessor({ id: "greet", seq: 3 }, [
      c("a", "crew-bundle id=greet seq=1"),
      c("b", "crew-bundle id=greet seq=2"),
      c("x", "crew-bundle id=readme seq=2"),
      c("d", "crew-bundle id=greet seq=4"),
    ]);
    expect(picked?.issueId).toBe("b");
  });
  it("bỏ blocker chưa done, không marker, hoặc không có session của agent", () => {
    expect(pickBundlePredecessor({ id: "greet", seq: 2 }, [c("a", "crew-bundle id=greet seq=1", "in_review")])).toBeNull();
    expect(pickBundlePredecessor({ id: "greet", seq: 2 }, [c("a", "không marker")])).toBeNull();
    expect(pickBundlePredecessor({ id: "greet", seq: 2 }, [{ ...c("a", "crew-bundle id=greet seq=1"), session: null }])).toBeNull();
  });
  it("bỏ seq bằng nhau và session thiếu run hoặc params", () => {
    const candidate = c("a", "crew-bundle id=greet seq=1");
    for (const patch of [{ lastRunId: null }, { sessionParamsJson: null }, { sessionParamsJson: {} }]) {
      expect(pickBundlePredecessor({ id: "greet", seq: 2 }, [
        { ...candidate, session: { ...candidate.session, ...patch } },
      ])).toBeNull();
    }
    expect(pickBundlePredecessor({ id: "greet", seq: 1 }, [candidate])).toBeNull();
  });
  it("cùng seq thì chọn session cập nhật mới nhất", () => {
    expect(pickBundlePredecessor({ id: "greet", seq: 3 }, [
      c("a", "crew-bundle id=greet seq=2", "done", session("run-a", 1)),
      c("b", "crew-bundle id=greet seq=2", "done", session("run-b", 2)),
    ])?.issueId).toBe("b");
  });
});

describe("applyBundleResumeSafely", () => {
  it("lỗi DB thì fail open, không ném", async () => {
    const db = { select: () => { throw new Error("db down"); } } as unknown as Db;
    const run = { id: "r", companyId: "c", agentId: "a", status: "queued", contextSnapshot: { issueId: "i" } } as never;
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    try {
      await expect(applyBundleResumeSafely({ db, run })).resolves.toBe("skipped");
      expect(warn).toHaveBeenCalledWith(expect.objectContaining({ runId: "r" }), expect.stringContaining("crew-bundle-resume: failed open"));
    } finally {
      warn.mockRestore();
    }
  });
});

describe("thứ tự cổng tải và nối session", () => {
  afterEach(() => vi.restoreAllMocks());
  it("cổng tải giữ run thì không đọc hoặc ghi resume", async () => {
    vi.spyOn(loadGate, "crewBeforeClaim").mockResolvedValue(true);
    const resume = vi.spyOn(bundleResume, "applyBundleResumeSafely").mockResolvedValue("applied");
    expect(await crewCoreHooks.beforeClaim({ db: {} as Db, run: { status: "queued" } as never })).toBe(true);
    expect(resume).not.toHaveBeenCalled();
  });
  it("cổng tải mở xong mới nối session và cho claim", async () => {
    const order: string[] = [];
    vi.spyOn(loadGate, "crewBeforeClaim").mockImplementation(async () => { order.push("gate"); return false; });
    vi.spyOn(bundleResume, "applyBundleResumeSafely").mockImplementation(async () => { order.push("resume"); return "skipped"; });
    expect(await crewCoreHooks.beforeClaim({ db: {} as Db, run: { status: "queued" } as never })).toBe(false);
    expect(order).toEqual(["gate", "resume"]);
  });
});

describe("nối session trong gói khi claim", () => {
  let db: ReturnType<typeof createDb>;
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;

  beforeAll(async () => {
    const support = await getEmbeddedPostgresTestSupport();
    if (!support.supported) throw new Error(`Embedded PostgreSQL unavailable: ${support.reason}`);
    temporary = await startEmbeddedPostgresTestDatabase("crew-bundle-resume-");
    db = createDb(temporary.connectionString);
  }, 60_000);
  afterEach(() => {
    execute.mockReset();
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await db?.$client.end({ timeout: 0 });
    await temporary?.cleanup();
  });

  type SeedOptions = {
    bDescription?: string;
    aDescription?: string;
    aStatus?: string;
    sessionOwner?: "same" | "other";
    bOwnSession?: boolean;
    wakeReason?: string;
  };

  async function seed(o: SeedOptions = {}) {
    const companyId = randomUUID(), agentId = randomUUID(), otherAgentId = randomUUID();
    const issueA = randomUUID(), issueB = randomUUID(), runA = randomUUID(), runB = randomUUID();
    const parentId = randomUUID();
    const wakeupRequestId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Crew bundle",
      issuePrefix: `B${companyId.replace(/-/g, "").slice(0, 5).toUpperCase()}`,
      defaultResponsibleUserId: "owner",
    });
    const agent = (id: string, name: string) => ({
      id, companyId, name, role: "engineer", status: "idle", adapterType: "process",
      adapterConfig: {}, permissions: {}, runtimeConfig: { heartbeat: { enabled: false, wakeOnDemand: true, maxConcurrentRuns: 1 } },
    });
    await db.insert(agents).values([agent(agentId, "Executor 1"), agent(otherAgentId, "Executor 2")]);
    await db.insert(issues).values({
      id: parentId, companyId, title: "Yêu cầu gốc", status: "backlog", responsibleUserId: "owner",
    });
    await db.insert(issues).values([
      {
        id: issueA, companyId, parentId, title: "A", status: o.aStatus ?? "done", assigneeAgentId: agentId, responsibleUserId: "owner",
        description: o.aDescription ?? "Việc A\ncrew-bundle id=greet seq=1",
      },
      {
        id: issueB, companyId, parentId, title: "B", status: "todo", assigneeAgentId: agentId, responsibleUserId: "owner",
        description: o.bDescription ?? "Việc B\ncrew-bundle id=greet seq=2",
      },
    ]);
    await db.insert(issueRelations).values({ companyId, issueId: issueA, relatedIssueId: issueB, type: "blocks" });
    const sessionAgent = o.sessionOwner === "other" ? otherAgentId : agentId;
    await db.insert(heartbeatRuns).values({
      id: runA, companyId, agentId: sessionAgent, status: "succeeded", invocationSource: "automation",
      responsibleUserId: "owner", contextSnapshot: { issueId: issueA }, sessionIdAfter: "sess-a",
    });
    await db.insert(agentTaskSessions).values({
      companyId, agentId: sessionAgent, adapterType: "process", taskKey: issueA,
      sessionParamsJson: { sessionId: "sess-a" }, sessionDisplayId: "sess-a", lastRunId: runA,
    });
    if (o.bOwnSession) {
      await db.insert(agentTaskSessions).values({
        companyId, agentId, adapterType: "process", taskKey: issueB,
        sessionParamsJson: { sessionId: "sess-b" }, sessionDisplayId: "sess-b", lastRunId: null,
      });
    }
    await db.insert(agentWakeupRequests).values({
      id: wakeupRequestId, companyId, agentId, source: "automation", triggerDetail: "system",
      reason: o.wakeReason ?? "issue_blockers_resolved", payload: { issueId: issueB },
      status: "queued", runId: runB, requestedByActorType: "system",
    });
    await db.insert(heartbeatRuns).values({
      wakeupRequestId, triggerDetail: "system",
      id: runB, companyId, agentId, status: "queued", invocationSource: "automation", responsibleUserId: "owner",
      contextSnapshot: { issueId: issueB, taskKey: issueB, wakeReason: o.wakeReason ?? "issue_blockers_resolved" },
    });
    return { companyId, agentId, otherAgentId, issueA, issueB, runA, runB };
  }

  async function claimAll() {
    execute.mockResolvedValue({ exitCode: 0, signal: null, timedOut: false, summary: "ok" });
    const heartbeat = heartbeatService(db);
    await heartbeat.resumeQueuedRuns();
    await heartbeat.drainActiveRunExecutions();
  }
  async function runtimeOf(runId: string) {
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, runId));
    const diagnostic = JSON.stringify({ runId, status: run?.status, errorCode: run?.errorCode, error: run?.error });
    const calls = execute.mock.calls.filter(([ctx]) => ctx.runId === runId);
    expect(calls, diagnostic).toHaveLength(1);
    expect(run?.status, diagnostic).toBe("succeeded");
    return calls[0]![0].runtime;
  }
  const resumeActivities = (runId: string) =>
    db.select().from(activityLog).where(and(eq(activityLog.entityId, runId), eq(activityLog.action, "crew.bundle_resume")));

  for (const wakeReason of ["issue_blockers_resolved", "issue_assigned"]) {
    it(`cùng gốc và gói, wake ${wakeReason}: run B resume session của A và ghi dấu`, async () => {
      const s = await seed({ wakeReason });
      await claimAll();
      expect(await runtimeOf(s.runB)).toMatchObject({ sessionId: "sess-a" });
      const [row] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, s.runB));
      expect(row!.contextSnapshot).toMatchObject({
        resumeFromRunId: s.runA,
        crewBundleResume: { bundle: "greet", fromIssueId: s.issueA },
      });
      expect(await resumeActivities(s.runB)).toHaveLength(1);
    }, 30_000);
  }

  it("hai gốc dùng cùng tên gói và blocker chéo: B chạy session mới", async () => {
    const s = await seed();
    const otherParentId = randomUUID();
    await db.insert(issues).values({
      id: otherParentId, companyId: s.companyId, title: "Yêu cầu độc lập", status: "backlog", responsibleUserId: "owner",
    });
    await db.update(issues).set({ parentId: otherParentId }).where(eq(issues.id, s.issueB));
    await claimAll();
    expect((await runtimeOf(s.runB)).sessionId ?? null).toBeNull();
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, s.runB));
    expect(run!.contextSnapshot).not.toHaveProperty("resumeFromRunId");
    expect(await resumeActivities(s.runB)).toHaveLength(0);
  }, 30_000);

  it.each(["A", "B", "cả hai"])("%s không phải issue con: không nối", async (root) => {
    const s = await seed();
    if (root !== "B") await db.update(issues).set({ parentId: null }).where(eq(issues.id, s.issueA));
    if (root !== "A") await db.update(issues).set({ parentId: null }).where(eq(issues.id, s.issueB));
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, s.runB));
    expect(await applyBundleResume({ db, run: run! })).toBe("skipped");
    const [after] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, s.runB));
    expect(after!.contextSnapshot).not.toHaveProperty("resumeFromRunId");
    expect(await resumeActivities(s.runB)).toHaveLength(0);
  });

  it("khác gói: không nối", async () => {
    const s = await seed({ bDescription: "crew-bundle id=readme seq=1" });
    await claimAll();
    expect((await runtimeOf(s.runB)).sessionId ?? null).toBeNull();
    expect(await resumeActivities(s.runB)).toHaveLength(0);
  }, 30_000);

  it("B không có marker: không nối", async () => {
    const s = await seed({ bDescription: "Việc B" });
    await claimAll();
    expect((await runtimeOf(s.runB)).sessionId ?? null).toBeNull();
  }, 30_000);

  it("session trên A thuộc agent khác: không nối", async () => {
    const s = await seed({ sessionOwner: "other" });
    await claimAll();
    expect((await runtimeOf(s.runB)).sessionId ?? null).toBeNull();
  }, 30_000);

  it("B đã có session riêng: để stock dùng session của B", async () => {
    const s = await seed({ bOwnSession: true });
    expect(await applyBundleResume({ db, run: (await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, s.runB)))[0]! })).toBe("skipped");
  }, 30_000);

  it("A chưa done: không nối (claim sau đó tự hủy vì còn blocker)", async () => {
    const s = await seed({ aStatus: "in_review" });
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, s.runB));
    expect(await applyBundleResume({ db, run: run! })).toBe("skipped");
  }, 30_000);

  it("run đã có resumeFromRunId (wake tay): giữ nguyên", async () => {
    const s = await seed();
    await db
      .update(heartbeatRuns)
      .set({ contextSnapshot: { issueId: s.issueB, resumeFromRunId: "manual" } })
      .where(eq(heartbeatRuns.id, s.runB));
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, s.runB));
    expect(await applyBundleResume({ db, run: run! })).toBe("skipped");
  }, 30_000);

  it("run không còn queued: không ghi", async () => {
    const s = await seed();
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, s.runB));
    await db.update(heartbeatRuns).set({ status: "cancelled" }).where(eq(heartbeatRuns.id, s.runB));
    expect(await applyBundleResume({ db, run: run! })).toBe("skipped");
    const [after] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, s.runB));
    expect(after!.contextSnapshot).not.toHaveProperty("resumeFromRunId");
  }, 30_000);

  it("ghi cả DB và object run, giữ context khác, chỉ ghi một activity dù gọi lại bằng snapshot cũ", async () => {
    const s = await seed();
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, s.runB));
    const stale = { ...run! };
    await db.update(heartbeatRuns).set({ contextSnapshot: { ...run!.contextSnapshot, retained: "latest" } }).where(eq(heartbeatRuns.id, s.runB));
    expect(await applyBundleResume({ db, run: run! })).toBe("applied");
    expect(run!.contextSnapshot).toMatchObject({
      issueId: s.issueB, retained: "latest", resumeFromRunId: s.runA,
      resumeSessionDisplayId: "sess-a", resumeSessionParams: { sessionId: "sess-a" },
    });
    expect(await applyBundleResume({ db, run: stale })).toBe("skipped");
    const entries = await resumeActivities(s.runB);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      companyId: s.companyId, entityType: "heartbeat_run", entityId: s.runB,
      details: { bundle: "greet", fromIssueId: s.issueA, toIssueId: s.issueB, resumeFromRunId: s.runA },
    });
  });

  it("giữ resume tường minh mới ghi trong DB dù object run đã cũ", async () => {
    const s = await seed();
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, s.runB));
    const context = { ...run!.contextSnapshot, resumeSessionParams: { sessionId: "manual" } };
    await db.update(heartbeatRuns).set({ contextSnapshot: context }).where(eq(heartbeatRuns.id, s.runB));
    expect(await applyBundleResume({ db, run: run! })).toBe("skipped");
    const [after] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, s.runB));
    expect(after!.contextSnapshot).toEqual(context);
    expect(await resumeActivities(s.runB)).toHaveLength(0);
  });

  it("B giao cho agent khác thì bỏ qua", async () => {
    const s = await seed();
    await db.update(issues).set({ assigneeAgentId: s.otherAgentId }).where(eq(issues.id, s.issueB));
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, s.runB));
    expect(await applyBundleResume({ db, run: run! })).toBe("skipped");
  });

  it("quan hệ sai company hoặc trỏ blocker khác company không nối", async () => {
    const s = await seed();
    const foreign = await seed();
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, s.runB));
    await db.update(issueRelations).set({ companyId: foreign.companyId }).where(eq(issueRelations.relatedIssueId, s.issueB));
    expect(await applyBundleResume({ db, run: run! })).toBe("skipped");
    await db.update(issueRelations).set({ companyId: s.companyId }).where(eq(issueRelations.relatedIssueId, s.issueB));
    await db.update(issues).set({ companyId: foreign.companyId }).where(eq(issues.id, s.issueA));
    expect(await applyBundleResume({ db, run: run! })).toBe("skipped");
  });

  it("session khác adapter không nối", async () => {
    const s = await seed();
    await db.update(agentTaskSessions).set({ adapterType: "claude_local" }).where(eq(agentTaskSessions.taskKey, s.issueA));
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, s.runB));
    expect(await applyBundleResume({ db, run: run! })).toBe("skipped");
  });

  it("lỗi ghi activity rollback resume và fail open", async () => {
    const s = await seed();
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, s.runB));
    const original = run!.contextSnapshot;
    vi.spyOn(activity, "persistActivity").mockRejectedValueOnce(new Error("audit write failed"));
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    expect(await applyBundleResumeSafely({ db, run: run! })).toBe("skipped");
    expect(run!.contextSnapshot).toEqual(original);
    const [after] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, s.runB));
    expect(after!.contextSnapshot).toEqual(original);
    expect(await resumeActivities(s.runB)).toHaveLength(0);
  });
});

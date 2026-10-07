import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  activityLog,
  agents,
  companies,
  createDb,
  environmentLeases,
  environments,
  heartbeatRuns,
  issueComments,
  issues,
} from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { defaultBeforeClaimDeps } from "../crew/load-gate.ts";
import {
  buildRetryProgressCommand,
  createRetryProgressChecker,
  parseRetryCommits,
  retryProgressComment,
} from "../crew/retry-progress.ts";

describe("buildRetryProgressCommand", () => {
  it("quote đường dẫn và dùng mốc ISO", () => {
    expect(buildRetryProgressCommand("/Users/a/crew-agents/mac claude", new Date("2026-10-07T09:20:13.000Z"))).toBe(
      "git -C '/Users/a/crew-agents/mac claude' log --since='2026-10-07T09:20:13.000Z' --format='%H%x09%cI%x09%s' -n 20 HEAD",
    );
    expect(buildRetryProgressCommand("/tmp/it's", new Date(0))).toContain("'/tmp/it'\\''s'");
  });

  it("từ chối đường dẫn tương đối", () => {
    expect(() => buildRetryProgressCommand("crew-agents/x", new Date(0))).toThrow();
  });
});

describe("parseRetryCommits", () => {
  it("đọc sha, giờ commit và tiêu đề, bỏ dòng hỏng", () => {
    const sha = "c".repeat(40);
    expect(parseRetryCommits(`${sha}\t2026-10-07T16:20:43+07:00\tfeat: thêm long.txt\nrác\n`)).toEqual([
      { sha, committedAt: "2026-10-07T16:20:43+07:00", subject: "feat: thêm long.txt" },
    ]);
    expect(parseRetryCommits("")).toEqual([]);
  });
});

describe("retryProgressComment", () => {
  it("liệt kê commit và dặn không làm lại", () => {
    const body = retryProgressComment({
      kind: "checked",
      previousRunId: "11111111-1111-4111-8111-111111111111",
      previousStartedAt: new Date("2026-10-07T09:15:00.000Z"),
      cwd: "/Users/a/crew-agents/mac-claude",
      commits: [{ sha: "c".repeat(40), committedAt: "2026-10-07T16:20:43+07:00", subject: "feat: thêm long.txt" }],
    });
    expect(body.startsWith("Crew: lần chạy lại")).toBe(true);
    expect(body).toContain("cccccccc feat: thêm long.txt");
    expect(body).toContain("16:15");
    expect(body).toContain("không làm lại");
  });
});

const support = await getEmbeddedPostgresTestSupport();
const suite = support.supported ? describe : describe.skip;

suite("retry progress against the database", () => {
  let db: ReturnType<typeof createDb>;
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;

  beforeAll(async () => {
    temporary = await startEmbeddedPostgresTestDatabase("crew-retry-progress-");
    db = createDb(temporary.connectionString);
  }, 60_000);
  afterAll(async () => {
    await db?.$client.end({ timeout: 0 });
    await temporary?.cleanup();
  });

  async function seed(options: { lease?: boolean } = {}) {
    const companyId = randomUUID(), agentId = randomUUID(), issueId = randomUUID();
    const environmentId = randomUUID(), previousRunId = randomUUID(), retryRunId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Crew retry",
      issuePrefix: `R${companyId.replace(/-/g, "").slice(0, 5).toUpperCase()}`,
      defaultResponsibleUserId: "owner",
    });
    await db.insert(agents).values({
      id: agentId, companyId, name: "Worker", role: "engineer", status: "idle", adapterType: "process",
      adapterConfig: {}, permissions: {}, runtimeConfig: {},
    });
    await db.insert(issues).values({ id: issueId, companyId, title: "Retry task", status: "todo", assigneeAgentId: agentId, responsibleUserId: "owner" });
    await db.insert(environments).values({
      id: environmentId,
      name: `mac-mini-${environmentId.slice(0, 8)}`,
      driver: "ssh",
      status: "active",
      config: { host: "mac.example.test", port: 22, username: "agent", remoteWorkspacePath: "/Users/a/crew-agents" },
    });
    await db.insert(heartbeatRuns).values({
      id: previousRunId, companyId, agentId, status: "failed", invocationSource: "on_demand", responsibleUserId: "owner",
      contextSnapshot: { issueId }, startedAt: new Date("2026-10-07T09:15:00.000Z"),
    });
    if (options.lease !== false) {
      await db.insert(environmentLeases).values({
        companyId, environmentId, issueId, heartbeatRunId: previousRunId, status: "released",
        metadata: { remoteCwd: "/Users/a/crew-agents/mac-claude" },
      });
    }
    const [retryRun] = await db.insert(heartbeatRuns).values({
      id: retryRunId, companyId, agentId, status: "queued", invocationSource: "on_demand", responsibleUserId: "owner",
      contextSnapshot: { issueId }, retryOfRunId: previousRunId,
    }).returning();
    return { retryRun: retryRun!, issueId, previousRunId };
  }

  it("đọc startedAt và remoteCwd của run trước rồi chạy git log qua SSH", async () => {
    const { retryRun, previousRunId } = await seed();
    const commands: string[] = [];
    const hosts: string[] = [];
    const check = createRetryProgressChecker(db, async (config, command) => {
      hosts.push(config.host);
      commands.push(command);
      return { stdout: `${"c".repeat(40)}\t2026-10-07T16:20:43+07:00\tfeat: x\n` };
    });
    const progress = await check(retryRun);
    expect(hosts).toEqual(["mac.example.test"]);
    expect(commands[0]).toContain("git -C '/Users/a/crew-agents/mac-claude' log --since='2026-10-07T09:14:30.000Z'");
    expect(progress).toMatchObject({ kind: "checked", previousRunId, commits: [{ subject: "feat: x" }] });
  });

  it("trả lỗi kèm stderr khi git trên Mac thoát khác 0", async () => {
    const { retryRun } = await seed();
    const check = createRetryProgressChecker(db, async () => {
      throw Object.assign(new Error("Command failed"), { code: 128, stderr: "fatal: cannot change to '/Users/a/crew-agents/mac-claude'\n" });
    });
    expect(await check(retryRun)).toEqual({ kind: "error", error: "fatal: cannot change to '/Users/a/crew-agents/mac-claude'" });
  });

  it("không kiểm khi run trước không có lease SSH", async () => {
    const { retryRun } = await seed({ lease: false });
    const check = createRetryProgressChecker(db, async () => {
      throw new Error("must not be called");
    });
    expect(await check(retryRun)).toEqual({ kind: "none" });
  });

  it("ghi comment lần chạy lại rồi đánh dấu đã kiểm, một lần mỗi run", async () => {
    const { retryRun, issueId, previousRunId } = await seed();
    const deps = defaultBeforeClaimDeps(db);
    expect(await deps.retryChecked(retryRun.id)).toBe(false);
    await deps.recordRetryProgress(retryRun, issueId, {
      kind: "checked",
      previousRunId,
      previousStartedAt: new Date("2026-10-07T09:15:00.000Z"),
      cwd: "/Users/a/crew-agents/mac-claude",
      commits: [{ sha: "c".repeat(40), committedAt: "2026-10-07T16:20:43+07:00", subject: "feat: x" }],
    });
    expect(await deps.retryChecked(retryRun.id)).toBe(true);
    const comments = await db.select({ body: issueComments.body }).from(issueComments).where(eq(issueComments.issueId, issueId));
    expect(comments).toHaveLength(1);
    expect(comments[0]!.body.startsWith("Crew: lần chạy lại")).toBe(true);
    const [activity] = await db
      .select({ details: activityLog.details })
      .from(activityLog)
      .where(and(eq(activityLog.runId, retryRun.id), eq(activityLog.action, "crew.retry_progress.checked")));
    expect(activity?.details).toMatchObject({ previousRunId, commits: ["c".repeat(40)] });
  });

  it("không comment khi run trước chưa có commit", async () => {
    const { retryRun, issueId, previousRunId } = await seed();
    const deps = defaultBeforeClaimDeps(db);
    await deps.recordRetryProgress(retryRun, issueId, {
      kind: "checked", previousRunId, previousStartedAt: new Date(), cwd: "/w", commits: [],
    });
    expect(await deps.retryChecked(retryRun.id)).toBe(true);
    expect(await db.select().from(issueComments).where(eq(issueComments.issueId, issueId))).toHaveLength(0);
  });
});

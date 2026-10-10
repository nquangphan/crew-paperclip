import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
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
import { buildRemoteStopCommand } from "../crew/remote-stop.ts";
import {
  RETRY_PROGRESS_TIMEOUT_MS,
  buildRetryProgressCommand,
  createRetryProgressChecker,
  parseRetryProgressOutput,
  retryProgressComment,
} from "../crew/retry-progress.ts";

const PREV = "11111111-1111-4111-8111-111111111111";
const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const STARTED = new Date("2026-10-07T09:15:00.000Z");
const S = STARTED.getTime() / 1000;

describe("buildRetryProgressCommand", () => {
  it("dừng run trước, in giờ Mac rồi đọc mọi nhánh local, không dùng --since", () => {
    const command = buildRetryProgressCommand(PREV, "/Users/a/crew-agents/mac claude");
    expect(command.startsWith(`${buildRemoteStopCommand(PREV, "/Users/a/crew-agents/mac claude")} && `)).toBe(true);
    expect(command).toContain(' && echo "crew-retry-clock $(date +%s)" && ');
    expect(command.endsWith(
      "git -C '/Users/a/crew-agents/mac claude' log --branches HEAD --source --format='%H%x09%ct%x09%cI%x09%S%x09%s' -n 50",
    )).toBe(true);
    expect(command).not.toContain("--since");
    expect(buildRetryProgressCommand(PREV, "/tmp/it's")).toContain(`-C '/tmp/it'"'"'s'`);
  });

  it("từ chối đường dẫn tương đối và run id sai", () => {
    expect(() => buildRetryProgressCommand(PREV, "crew-agents/x")).toThrow();
    expect(() => buildRetryProgressCommand("x;id", "/w")).toThrow();
  });

  it("đủ thời gian cho bước dừng và git nhưng dưới 30 giây khóa start", () => {
    expect(RETRY_PROGRESS_TIMEOUT_MS).toBe(17_000);
  });
});

describe("parseRetryProgressOutput", () => {
  const sameClock = { startedAt: STARTED, sentAt: S * 1000 + 600_000, receivedAt: S * 1000 + 600_000 };
  const clock = (offsetSeconds: number) => `crew-retry-clock ${S + 600 + offsetSeconds}`;

  it("đọc sha, giờ, nhánh và tiêu đề, bỏ dòng hỏng và commit cũ hơn cửa sổ", () => {
    const stdout = [
      "crew-stop matched=0 killed=0 remaining=0 via=fallback",
      clock(0),
      `${SHA_A}\t${S + 300}\t2026-10-07T16:20:00+07:00\tcrew/ABC-1\tfeat: thêm long.txt`,
      "rác",
      `${SHA_B}\t${S - 31}\t2026-10-07T16:14:29+07:00\tmain\tcũ`,
      "",
    ].join("\n");
    expect(parseRetryProgressOutput(stdout, sameClock)).toEqual({
      ok: true,
      truncated: false,
      detach: null,
      commits: [{ sha: SHA_A, committedAt: "2026-10-07T16:20:00+07:00", branch: "crew/ABC-1", subject: "feat: thêm long.txt" }],
    });
  });

  it("báo danh sách bị cắt khi đủ 50 commit mà commit cũ nhất vẫn trong cửa sổ", () => {
    const lines = (count: number, oldest: number) =>
      Array.from({ length: count }, (_, i) => {
        const sha = i.toString(16).padStart(40, "0");
        const ct = i === count - 1 ? oldest : S + 500 - i;
        return `${sha}\t${ct}\t2026-10-07T16:20:00+07:00\tcrew/ABC-1\tc${i}`;
      });
    const out = (body: string[]) => ["crew-stop matched=0 killed=0 remaining=0", clock(0), ...body].join("\n");
    expect(parseRetryProgressOutput(out(lines(50, S + 1)), sameClock)).toMatchObject({ ok: true, truncated: true });
    expect(parseRetryProgressOutput(out(lines(50, S - 3600)), sameClock)).toMatchObject({ ok: true, truncated: false });
    expect(parseRetryProgressOutput(out(lines(49, S + 1)), sameClock)).toMatchObject({ ok: true, truncated: false });
  });

  it("bù lệch đồng hồ Mac khi lọc theo giờ commit", () => {
    // The Mac clock is 120 s behind: a commit 10 s after the run started carries Mac time S - 110.
    const stdout = [
      "crew-stop matched=1 killed=0 remaining=0",
      clock(-120),
      `${SHA_A}\t${S - 110}\t2026-10-07T16:13:10+07:00\tcrew/ABC-1\tfeat: x`,
      `${SHA_B}\t${S - 200}\t2026-10-07T16:11:40+07:00\tcrew/ABC-1\tcũ`,
    ].join("\n");
    const result = parseRetryProgressOutput(stdout, sameClock);
    expect(result).toMatchObject({ ok: true, commits: [{ sha: SHA_A }] });
  });

  it("lỗi khi run trước còn process sót", () => {
    const stdout = ["crew-stop matched=2 killed=2 remaining=1", clock(0), `${SHA_A}\t${S}\tx\tmain\ts`].join("\n");
    expect(parseRetryProgressOutput(stdout, sameClock)).toEqual({ ok: false, error: "run trước còn 1 process trên Mac" });
  });

  it("lỗi khi thiếu dòng tổng kết dừng run hoặc dòng giờ Mac", () => {
    expect(parseRetryProgressOutput(`${clock(0)}\n`, sameClock)).toMatchObject({ ok: false });
    expect(parseRetryProgressOutput("crew-stop matched=0 killed=0 remaining=0\n", sameClock)).toMatchObject({ ok: false });
  });
});

describe("retryProgressComment", () => {
  const checked = {
    kind: "checked" as const,
    previousRunId: PREV,
    previousStartedAt: STARTED,
    retryReason: "transient_failure",
    cwd: "/Users/a/crew-agents/mac-claude",
    truncated: false,
    commits: [{ sha: "c".repeat(40), committedAt: "2026-10-07T16:20:43+07:00", branch: "crew/ABC-1", subject: "feat: thêm long.txt" }],
  };

  it("liệt kê commit kèm nhánh, ghi lý do và dặn không làm lại", () => {
    const body = retryProgressComment(checked);
    expect(body.startsWith(`Crew: lần chạy lại sau run \`${PREV}\``)).toBe(true);
    expect(body).toContain("cccccccc (crew/ABC-1) feat: thêm long.txt");
    expect(body).toContain("16:15");
    expect(body).toContain("lý do: lỗi tạm thời hoặc mất process");
    expect(body).toContain("không làm lại");
    expect(body).toContain("1 commit trong worktree kể từ khi run trước bắt đầu");
    expect(body).not.toContain("Run đó đã có");
    expect(body).not.toContain("bị cắt");
  });

  it("nói rõ khi danh sách commit bị cắt", () => {
    const body = retryProgressComment({ ...checked, truncated: true });
    expect(body).toContain("ít nhất 1 commit trong worktree kể từ khi run trước bắt đầu");
    expect(body).toContain("danh sách bị cắt");
  });

  it("ghi mã lý do lạ nguyên văn, không mặc định là mất kết nối", () => {
    expect(retryProgressComment({ ...checked, retryReason: "workspace_validation_failed" })).toContain(
      "lý do: `workspace_validation_failed`",
    );
    const unknown = retryProgressComment({ ...checked, retryReason: null });
    expect(unknown).toContain("lý do: không rõ");
    expect(unknown).not.toContain("mất kết nối");
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
      contextSnapshot: { issueId, retryReason: "transient_failure" }, retryOfRunId: previousRunId,
    }).returning();
    return { retryRun: retryRun!, issueId, previousRunId };
  }

  const CHECK_AT = Date.parse("2026-10-07T09:30:00.000Z");
  const MAC_CLOCK = `crew-retry-clock ${CHECK_AT / 1000}`;
  const COMMIT_LINE = `${"c".repeat(40)}\t${Date.parse("2026-10-07T09:20:43.000Z") / 1000}\t2026-10-07T16:20:43+07:00\tcrew/ABC-1\tfeat: x`;

  it("dừng run trước rồi đọc commit trong remoteCwd của lease run trước qua SSH", async () => {
    const { retryRun, previousRunId } = await seed();
    const calls: { host: string; command: string; timeoutMs: number }[] = [];
    const check = createRetryProgressChecker(
      db,
      async (config, command, options) => {
        calls.push({ host: config.host, command, timeoutMs: options.timeoutMs });
        return { stdout: `crew-stop matched=0 killed=0 remaining=0\n${MAC_CLOCK}\n${COMMIT_LINE}\n` };
      },
      () => CHECK_AT,
    );
    const progress = await check(retryRun);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ host: "mac.example.test", timeoutMs: 17_000 });
    expect(calls[0]!.command).toContain(buildRemoteStopCommand(previousRunId, "/Users/a/crew-agents/mac-claude"));
    expect(calls[0]!.command).toContain("git -C '/Users/a/crew-agents/mac-claude' log --branches");
    expect(progress).toMatchObject({
      kind: "checked",
      previousRunId,
      retryReason: "transient_failure",
      commits: [{ subject: "feat: x", branch: "crew/ABC-1" }],
    });
  });

  it("chuyển runtime: kiểm worktree của run cũ, tách khỏi nhánh crew/<mã issue>", async () => {
    const { retryRun, issueId, previousRunId } = await seed();
    await db.update(issues).set({ identifier: "ABC-7" }).where(eq(issues.id, issueId));
    const fallbackRun = { ...retryRun, retryOfRunId: null };
    const calls: string[] = [];
    const check = createRetryProgressChecker(
      db,
      async (_config, command) => {
        calls.push(command);
        return { stdout: `crew-stop matched=0 killed=0 remaining=0\n${MAC_CLOCK}\n${COMMIT_LINE}\ncrew-retry-detach=dirty\n` };
      },
      () => CHECK_AT,
    );
    expect(await check(fallbackRun, { mode: "fallback", previousRunId })).toMatchObject({ kind: "checked", previousRunId, detach: "dirty" });
    expect(calls[0]).toContain(buildRetryProgressCommand(previousRunId, "/Users/a/crew-agents/mac-claude", { detachBranch: "crew/ABC-7" }));

    const silent = createRetryProgressChecker(db, async () => ({ stdout: `crew-stop matched=0 killed=0 remaining=0\n${MAC_CLOCK}\n` }), () => CHECK_AT);
    expect(await silent(fallbackRun, { mode: "fallback", previousRunId })).toMatchObject({ kind: "error" });
    await db.update(issues).set({ identifier: null }).where(eq(issues.id, issueId));
    expect(await silent(fallbackRun, { mode: "fallback", previousRunId })).toMatchObject({ kind: "error" });
  });

  it("chuyển runtime: marker riêng, worktree bẩn ghi comment câu spec và trạng thái bẩn", async () => {
    const { retryRun, issueId, previousRunId } = await seed();
    const deps = defaultBeforeClaimDeps(db);
    const comment = await deps.recordRetryProgress(retryRun, issueId, {
      kind: "checked", previousRunId, previousStartedAt: new Date(), retryReason: null, cwd: "/w", truncated: false,
      commits: [], detach: "dirty",
    }, "fallback");
    expect(comment).toBe(
      `Crew: chuyển runtime sau run \`${previousRunId}\`: Worktree của run trước còn thay đổi chưa commit; Crew không mang sang. Owner xem rồi chuyển issue về todo.`,
    );
    expect(await deps.retryState(retryRun.id, "retry")).toEqual({ checked: false });
    expect(await deps.retryState(retryRun.id, "fallback")).toEqual({ checked: true, pendingComment: comment, detach: "dirty" });
    await deps.postRetryComment(retryRun, issueId, comment!, "fallback");
    await deps.postRetryComment(retryRun, issueId, comment!, "fallback");
    expect(await deps.retryState(retryRun.id, "fallback")).toEqual({ checked: true, pendingComment: null, detach: "dirty" });
    const comments = await db.select({ body: issueComments.body }).from(issueComments).where(eq(issueComments.issueId, issueId));
    expect(comments.map((c) => c.body)).toEqual([comment]);
  });

  it("trả lỗi khi run trước còn process sót trên Mac", async () => {
    const { retryRun } = await seed();
    const check = createRetryProgressChecker(
      db,
      async () => ({ stdout: `crew-stop matched=3 killed=1 remaining=1\n${MAC_CLOCK}\n${COMMIT_LINE}\n` }),
      () => CHECK_AT,
    );
    expect(await check(retryRun)).toEqual({ kind: "error", error: "run trước còn 1 process trên Mac" });
  });

  it("trả lỗi kèm stderr khi lệnh trên Mac thoát khác 0", async () => {
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

  it("ghi dấu đã kiểm kèm comment trước, comment sau, và không đăng lại comment đã có", async () => {
    const { retryRun, issueId, previousRunId } = await seed();
    const deps = defaultBeforeClaimDeps(db);
    expect(await deps.retryState(retryRun.id, "retry")).toEqual({ checked: false });
    const comment = await deps.recordRetryProgress(retryRun, issueId, {
      kind: "checked",
      previousRunId,
      previousStartedAt: new Date("2026-10-07T09:15:00.000Z"),
      retryReason: "transient_failure",
      cwd: "/Users/a/crew-agents/mac-claude",
      truncated: false,
      commits: [{ sha: "c".repeat(40), committedAt: "2026-10-07T16:20:43+07:00", branch: "crew/ABC-1", subject: "feat: x" }],
      detach: null,
    }, "retry");
    expect(comment?.startsWith("Crew: lần chạy lại")).toBe(true);
    expect(await deps.retryState(retryRun.id, "retry")).toEqual({ checked: true, pendingComment: comment });
    await deps.postRetryComment(retryRun, issueId, comment!, "retry");
    // A second post (marker written but seen as missing, or a racing claim) must not duplicate it.
    await deps.postRetryComment(retryRun, issueId, comment!, "retry");
    expect(await deps.retryState(retryRun.id, "retry")).toEqual({ checked: true, pendingComment: null });
    const comments = await db.select({ body: issueComments.body }).from(issueComments).where(eq(issueComments.issueId, issueId));
    expect(comments.map((c) => c.body)).toEqual([comment]);
    const [activity] = await db
      .select({ details: activityLog.details })
      .from(activityLog)
      .where(and(eq(activityLog.runId, retryRun.id), eq(activityLog.action, "crew.retry_progress.checked")));
    expect(activity?.details).toMatchObject({ previousRunId, commits: [{ sha: "c".repeat(40), branch: "crew/ABC-1" }] });
  });

  it("không có comment khi run trước chưa có commit", async () => {
    const { retryRun, issueId, previousRunId } = await seed();
    const deps = defaultBeforeClaimDeps(db);
    const comment = await deps.recordRetryProgress(retryRun, issueId, {
      kind: "checked", previousRunId, previousStartedAt: new Date(), retryReason: null, cwd: "/w", truncated: false, commits: [],
      detach: null,
    }, "retry");
    expect(comment).toBeNull();
    expect(await deps.retryState(retryRun.id, "retry")).toEqual({ checked: true, pendingComment: null });
    expect(await db.select().from(issueComments).where(eq(issueComments.issueId, issueId))).toHaveLength(0);
  });

  it("chỉ coi comment hệ thống chưa xóa là đã đăng", async () => {
    const { retryRun, issueId, previousRunId } = await seed();
    const deps = defaultBeforeClaimDeps(db);
    const body = `Crew: lần chạy lại sau run \`${previousRunId}\` (giả)`;
    const [company] = await db.select({ id: issues.companyId }).from(issues).where(eq(issues.id, issueId));
    await db.insert(issueComments).values([
      { companyId: company!.id, issueId, body, authorType: "agent", authorAgentId: retryRun.agentId },
      { companyId: company!.id, issueId, body, authorType: "system", deletedAt: new Date() },
    ]);
    await deps.postRetryComment(retryRun, issueId, `${body} thật`, "retry");
    const live = await db
      .select({ body: issueComments.body, authorType: issueComments.authorType })
      .from(issueComments)
      .where(and(eq(issueComments.issueId, issueId), isNull(issueComments.deletedAt)));
    expect(live).toEqual(expect.arrayContaining([{ body: `${body} thật`, authorType: "system" }]));
    expect(live).toHaveLength(2);
  });

  it("comment chờ của cổng tải không bị đăng lại khi đã có trên issue", async () => {
    const { retryRun, issueId } = await seed();
    const deps = defaultBeforeClaimDeps(db);
    const body = `Run \`${retryRun.id}\` đang chờ máy \`mac-mini\`: thử.`;
    await deps.postComment({ run: retryRun, issueId, kind: "waiting", body });
    await deps.postComment({ run: retryRun, issueId, kind: "waiting", body: `${body} lần 2` });
    const comments = await db.select({ body: issueComments.body }).from(issueComments).where(eq(issueComments.issueId, issueId));
    expect(comments.map((c) => c.body)).toEqual([body]);
    expect(await deps.firstNoticeAt(retryRun.id, "waiting_comment")).not.toBeNull();
  });
});

import type { Db } from "@paperclipai/db";
import { describe, expect, it } from "vitest";
import { type BeforeClaimDeps, type BeforeClaimInput, type ProgressMode, evaluateBeforeClaim } from "../crew/load-gate.ts";
import { buildRemoteStopCommand } from "../crew/remote-stop.ts";
import {
  type RetryProgress,
  buildRetryProgressCommand,
  parseRetryProgressOutput,
} from "../crew/retry-progress.ts";
import {
  CREW_RUNTIME_FALLBACK_DIRTY_COMMENT,
  CREW_RUNTIME_FALLBACK_WAKE_REASON,
  fallbackProgressComment,
  fallbackProgressCommentPrefix,
} from "../crew/runtime-fallback.ts";

const PREV = "11111111-1111-4111-8111-111111111111";
const SHA = "c".repeat(40);
const STARTED = new Date("2026-10-07T09:15:00.000Z");
const S = STARTED.getTime() / 1000;
const CWD = "/Users/a/wt";

describe("buildRetryProgressCommand với detachBranch", () => {
  it("thêm bước tách nhánh sau khi đọc commit, chỉ khi worktree sạch và đang ở đúng nhánh", () => {
    const command = buildRetryProgressCommand(PREV, CWD, { detachBranch: "crew/TPS-9" });
    expect(command.startsWith(`${buildRemoteStopCommand(PREV, CWD)} && `)).toBe(true);
    const log = command.indexOf(" log --branches HEAD");
    const detach = command.indexOf("symbolic-ref --short HEAD");
    expect(log).toBeGreaterThan(0);
    expect(detach).toBeGreaterThan(log);
    expect(command).toContain("git -C '/Users/a/wt' symbolic-ref --short HEAD");
    expect(command).toContain("git -C '/Users/a/wt' status --porcelain");
    expect(command).toContain("git -C '/Users/a/wt' switch --detach");
    expect(command).toContain("'crew/TPS-9'");
    for (const outcome of ["done", "dirty", "other-branch"]) expect(command).toContain(`crew-retry-detach=${outcome}`);
  });

  it("không có detachBranch thì giữ nguyên lệnh retry", () => {
    expect(buildRetryProgressCommand(PREV, CWD)).not.toContain("crew-retry-detach");
    expect(buildRetryProgressCommand(PREV, CWD, {})).toBe(buildRetryProgressCommand(PREV, CWD));
  });

  it("từ chối nhánh không đúng mẫu crew/<KEY>-<số>", () => {
    for (const bad of ["main", "crew/tps-9", "crew/TPS-9;id", "crew/TPS-", "crew/TPS-9 x", "crew/TPS-9'"]) {
      expect(() => buildRetryProgressCommand(PREV, CWD, { detachBranch: bad })).toThrow();
    }
  });
});

describe("parseRetryProgressOutput đọc kết quả tách nhánh", () => {
  const window = { startedAt: STARTED, sentAt: S * 1000 + 600_000, receivedAt: S * 1000 + 600_000 };
  const out = (tail: string[]) =>
    ["crew-stop matched=0 killed=0 remaining=0", `crew-retry-clock ${S + 600}`, `${SHA}\t${S + 60}\tx\tcrew/TPS-9\tfeat: a`, ...tail].join("\n");

  it.each([
    ["sạch, đúng nhánh", "crew-retry-detach=done", "done"],
    ["bẩn", "crew-retry-detach=dirty", "dirty"],
    ["nhánh khác", "crew-retry-detach=other-branch", "other-branch"],
  ] as const)("%s", (_name, line, detach) => {
    expect(parseRetryProgressOutput(out([line, ""]), window)).toMatchObject({ ok: true, detach, commits: [{ sha: SHA }] });
  });

  it("không có dòng tách nhánh thì detach = null", () => {
    expect(parseRetryProgressOutput(out([]), window)).toMatchObject({ ok: true, detach: null });
  });
});

describe("comment chuyển runtime", () => {
  it("bắt đầu bằng tiền tố theo run cũ, liệt kê commit và dặn không làm lại", () => {
    const body = fallbackProgressComment({
      kind: "checked",
      previousRunId: PREV,
      previousStartedAt: STARTED,
      retryReason: null,
      cwd: CWD,
      truncated: false,
      detach: "done",
      commits: [{ sha: SHA, committedAt: "x", branch: "crew/TPS-9", subject: "feat: a" }],
    });
    expect(body.startsWith(`Crew: chuyển runtime sau run \`${PREV}\``)).toBe(true);
    expect(body.startsWith(fallbackProgressCommentPrefix(PREV))).toBe(true);
    expect(body).toContain("cccccccc (crew/TPS-9) feat: a");
    expect(body).toContain("không làm lại");
  });

  it("câu worktree bẩn theo spec", () => {
    expect(CREW_RUNTIME_FALLBACK_DIRTY_COMMENT).toBe(
      "Worktree của run trước còn thay đổi chưa commit; Crew không mang sang. Owner xem rồi chuyển issue về todo.",
    );
  });
});

const T0 = new Date("2026-10-06T06:00:00.000Z");
const SETTINGS = { maxLoad1: 8, maxWaitMinutes: 60 };

function fallbackRun(over: Record<string, unknown> = {}) {
  return {
    id: "run-new",
    companyId: "company-1",
    agentId: "agent-claude",
    status: "queued",
    createdAt: T0,
    retryOfRunId: null,
    contextSnapshot: { issueId: "issue-1", wakeReason: CREW_RUNTIME_FALLBACK_WAKE_REASON },
    ...over,
  } as unknown as BeforeClaimInput["run"];
}

const checked = (detach: "done" | "dirty" | "other-branch" | null, commits = 1): RetryProgress => ({
  kind: "checked",
  previousRunId: PREV,
  previousStartedAt: STARTED,
  retryReason: null,
  cwd: CWD,
  truncated: false,
  detach,
  commits: Array.from({ length: commits }, () => ({ sha: SHA, committedAt: "x", branch: "crew/TPS-9", subject: "s" })),
});

type State = Awaited<ReturnType<BeforeClaimDeps["retryState"]>>;

function harness(opts: {
  progress?: RetryProgress;
  state?: State;
  previous?: string | null | Error;
  runtimeHold?: boolean;
} = {}) {
  const events: string[] = [];
  const modes: ProgressMode[] = [];
  const deps: BeforeClaimDeps = {
    loadTarget: async () => ({ environmentId: "env-1", environmentName: "mac-mini", settings: SETTINGS }),
    probeHost: async () => ({ ok: true, load1: 1 }),
    firstNoticeAt: async () => null,
    recordNotice: async (n) => {
      events.push(`mark:${n.kind}`);
    },
    postComment: async (n) => {
      events.push(`${n.kind}-comment`);
    },
    scheduleCancel: (runId, reason) => {
      events.push(`cancel:${runId}:${reason}`);
    },
    blockIssue: async (issueId) => {
      events.push(`blocked:${issueId}`);
    },
    now: () => T0,
    remoteStopPending: async () => false,
    markHeld: async () => {
      events.push("held");
    },
    releaseHeld: async () => "claim",
    runtimeGate: async () => {
      events.push("runtime-gate");
      return opts.runtimeHold ?? false;
    },
    fallbackPreviousRunId: async (r) => {
      events.push(`previous:${r.id}`);
      if (opts.previous instanceof Error) throw opts.previous;
      return opts.previous === undefined ? PREV : opts.previous;
    },
    retryState: async (_runId, mode) => {
      modes.push(mode);
      return opts.state ?? { checked: false };
    },
    checkRetryProgress: async (r, target) => {
      events.push(`check:${r.id}:${target.previousRunId}:${target.mode}`);
      return opts.progress ?? checked("done");
    },
    recordRetryProgress: async (_run, _issueId, p, mode) => {
      events.push(`record:${mode}:${p.kind === "checked" ? p.detach : p.kind}`);
      if (p.kind !== "checked") return null;
      if (p.detach === "dirty") return `${fallbackProgressCommentPrefix(PREV)}: ${CREW_RUNTIME_FALLBACK_DIRTY_COMMENT}`;
      return p.commits.length > 0 ? fallbackProgressComment(p) : null;
    },
    postRetryComment: async (_run, issueId, body, mode) => {
      events.push(`comment:${mode}:${issueId}:${body.slice(0, 40)}`);
    },
  };
  return { deps, events, modes };
}

describe("crewBeforeClaim trước run chuyển runtime", () => {
  it("tìm run cũ qua quyết định fallback, kiểm worktree run cũ, comment rồi cho claim", async () => {
    const h = harness();
    expect(await evaluateBeforeClaim({ db: {} as Db, run: fallbackRun() }, h.deps)).toBe(false);
    expect(h.events).toEqual([
      "runtime-gate",
      "previous:run-new",
      `check:run-new:${PREV}:fallback`,
      "record:fallback:done",
      `comment:fallback:issue-1:${fallbackProgressCommentPrefix(PREV).slice(0, 40)}`,
    ]);
    expect(h.modes).toEqual(["fallback"]);
  });

  it("đã kiểm (marker có rồi) thì không SSH lại", async () => {
    const h = harness({ state: { checked: true, pendingComment: null, detach: "done" } });
    expect(await evaluateBeforeClaim({ db: {} as Db, run: fallbackRun() }, h.deps)).toBe(false);
    expect(h.events.some((e) => e.startsWith("check:"))).toBe(false);
  });

  it("worktree cũ bẩn: comment câu spec, block issue, hủy run mới, giữ queued", async () => {
    const h = harness({ progress: checked("dirty", 0) });
    expect(await evaluateBeforeClaim({ db: {} as Db, run: fallbackRun() }, h.deps)).toBe(true);
    expect(h.events).toEqual([
      "runtime-gate",
      "previous:run-new",
      `check:run-new:${PREV}:fallback`,
      "record:fallback:dirty",
      `comment:fallback:issue-1:${fallbackProgressCommentPrefix(PREV).slice(0, 40)}`,
      "blocked:issue-1",
      "cancel:run-new:crew_runtime_fallback_dirty",
      "held",
    ]);
  });

  it("bẩn đã ghi ở tick trước: không SSH lại, vẫn hủy và giữ", async () => {
    const h = harness({ state: { checked: true, pendingComment: null, detach: "dirty" } });
    expect(await evaluateBeforeClaim({ db: {} as Db, run: fallbackRun() }, h.deps)).toBe(true);
    expect(h.events.some((e) => e.startsWith("check:"))).toBe(false);
    expect(h.events).toContain("cancel:run-new:crew_runtime_fallback_dirty");
  });

  it("nhánh khác hoặc không có commit thì cho claim, không comment", async () => {
    const h = harness({ progress: checked("other-branch", 0) });
    expect(await evaluateBeforeClaim({ db: {} as Db, run: fallbackRun() }, h.deps)).toBe(false);
    expect(h.events.some((e) => e.startsWith("comment:"))).toBe(false);
  });

  it("không có quyết định fallback (run cũ) thì cho claim như run thường", async () => {
    const h = harness({ previous: null });
    expect(await evaluateBeforeClaim({ db: {} as Db, run: fallbackRun() }, h.deps)).toBe(false);
    expect(h.events).toEqual(["runtime-gate", "previous:run-new"]);
  });

  it("kiểm lỗi thì giữ như máy không tới được (marker chờ, comment chờ)", async () => {
    const h = harness({ progress: { kind: "error", error: "ssh timeout" } });
    expect(await evaluateBeforeClaim({ db: {} as Db, run: fallbackRun() }, h.deps)).toBe(true);
    expect(h.events).toContain("mark:waiting");
    const h2 = harness({ previous: new Error("db down") });
    expect(await evaluateBeforeClaim({ db: {} as Db, run: fallbackRun() }, h2.deps)).toBe(true);
    expect(h2.events).toContain("mark:waiting");
  });

  it("đọc quyết định lỗi với run không do plugin đánh thức: không giữ, bỏ qua bước kiểm lần này", async () => {
    const h = harness({ previous: new Error("db down") });
    const run = fallbackRun({ contextSnapshot: { issueId: "issue-1", wakeReason: "issue_assigned" } });
    expect(await evaluateBeforeClaim({ db: {} as Db, run }, h.deps)).toBe(false);
    expect(h.events).toEqual(["runtime-gate", "previous:run-new"]);
  });

  it("run do recovery của lõi đánh thức (không mang lý do chuyển runtime) vẫn tìm và kiểm run cũ theo quyết định", async () => {
    const h = harness();
    const run = fallbackRun({ contextSnapshot: { issueId: "issue-1", wakeReason: "issue_assignment_recovery" } });
    expect(await evaluateBeforeClaim({ db: {} as Db, run }, h.deps)).toBe(false);
    expect(h.events).toEqual([
      "runtime-gate",
      "previous:run-new",
      `check:run-new:${PREV}:fallback`,
      "record:fallback:done",
      `comment:fallback:issue-1:${fallbackProgressCommentPrefix(PREV).slice(0, 40)}`,
    ]);
  });

  it("run retry đi đường retry (retryOfRunId thắng)", async () => {
    const h = harness({ progress: { kind: "none" } });
    expect(await evaluateBeforeClaim({ db: {} as Db, run: fallbackRun({ retryOfRunId: "prev-retry" }) }, h.deps)).toBe(false);
    expect(h.events).toEqual(["runtime-gate", "check:run-new:prev-retry:retry", "record:retry:none"]);
    expect(h.modes).toEqual(["retry"]);
  });

  it("công tắc giữ run thì dừng trước bước kiểm tiến độ và đánh dấu chưa chạy", async () => {
    const h = harness({ runtimeHold: true });
    expect(await evaluateBeforeClaim({ db: {} as Db, run: fallbackRun() }, h.deps)).toBe(true);
    expect(h.events).toEqual(["runtime-gate", "held"]);
  });

  it("cổng tải giữ run thì không hỏi công tắc", async () => {
    const h = harness();
    h.deps.probeHost = async () => ({ ok: true, load1: 99 });
    expect(await evaluateBeforeClaim({ db: {} as Db, run: fallbackRun() }, h.deps)).toBe(true);
    expect(h.events).not.toContain("runtime-gate");
  });

  it("environment không có cổng tải: vẫn hỏi công tắc, giữ thì đánh dấu chưa chạy", async () => {
    const h = harness({ runtimeHold: true });
    h.deps.loadTarget = async () => null;
    expect(await evaluateBeforeClaim({ db: {} as Db, run: fallbackRun() }, h.deps)).toBe(true);
    expect(h.events).toEqual(["runtime-gate", "held"]);
    const open = harness({ runtimeHold: false });
    open.deps.loadTarget = async () => null;
    expect(await evaluateBeforeClaim({ db: {} as Db, run: fallbackRun() }, open.deps)).toBe(false);
    expect(open.events).toEqual(["runtime-gate"]);
  });
});

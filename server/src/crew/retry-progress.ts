import { and, desc, eq } from "drizzle-orm";
import { type Db, environmentLeases, heartbeatRuns, issues } from "@paperclipai/db";
import { runSshCommand, shellQuote } from "@paperclipai/adapter-utils/ssh";
import { resolveEnvironmentDriverConfigForRuntime } from "../services/environment-config.js";
import { environmentService } from "../services/environments.js";
import { REMOTE_STOP_TIMEOUT_MS, buildRemoteStopCommand, parseRemoteStopOutput, readRemoteCwd } from "./remote-stop.js";

/**
 * A retried run (heartbeat_runs.retryOfRunId set: lost process, transient failure, busy workspace…)
 * first looks at the previous run's worktree on the Mac. One SSH command stops whatever is left of
 * the previous run (same script as hook H3), then lists recent commits on every local branch, so the
 * snapshot cannot race a still-running predecessor and a branch switch by another run does not hide
 * them. Commits made since the previous run started are listed in an issue comment so the agent
 * checks and continues instead of redoing them. The window comes from the database (previous run's
 * startedAt) because the run's .paperclip-runtime/runs/<id> directory is removed when it stops; it is
 * shifted by the Mac's clock offset, measured with `date +%s` in the same command.
 */
/** Stop budget plus 5 s for git; stays below the 30 s stale limit of the agent start lock. */
export const RETRY_PROGRESS_TIMEOUT_MS = REMOTE_STOP_TIMEOUT_MS + 5_000;
/** Mac và VPS có thể lệch đồng hồ; sau khi bù lệch vẫn lấy rộng ra 30 giây trước lúc run trước bắt đầu. */
export const RETRY_SINCE_SLACK_MS = 30_000;
const MAX_COMMITS = 50;
const CLOCK_MARK = "crew-retry-clock";
const DETACH_MARK = "crew-retry-detach=";
/** Nhánh issue của Crew (`crew/<identifier>`); chỉ nhánh đúng mẫu này mới được tách khỏi worktree cũ. */
export const CREW_ISSUE_BRANCH_RE = /^crew\/[A-Z][A-Z0-9]*-\d+$/;

/** Kết quả tách worktree của run cũ khỏi nhánh issue (chỉ khi chuyển runtime). */
export type DetachOutcome = "done" | "dirty" | "other-branch";

export interface RetryCommit {
  sha: string;
  committedAt: string;
  branch: string;
  subject: string;
}

export type RetryProgress =
  | { kind: "none" }
  | {
      kind: "checked";
      previousRunId: string;
      previousStartedAt: Date;
      retryReason: string | null;
      cwd: string;
      /** True when git returned the maximum and the oldest one is still inside the window. */
      truncated: boolean;
      commits: RetryCommit[];
      /** `null` khi không yêu cầu tách nhánh (retry thường). */
      detach: DetachOutcome | null;
    }
  | { kind: "error"; error: string };

type Run = typeof heartbeatRuns.$inferSelect;
type SshConfig = Parameters<typeof runSshCommand>[0];
export type RetryProgressSshRunner = (
  config: SshConfig,
  command: string,
  options: { timeoutMs: number },
) => Promise<{ stdout: string }>;

/**
 * Stops the previous run's leftovers, prints the Mac clock, then lists commits on all local branches
 * and HEAD (a detached HEAD, e.g. an interrupted rebase, is on no branch). With `detachBranch` (runtime
 * fallback) it then detaches the old worktree from that branch, only when the worktree is on it and
 * clean, so the new agent's worktree can switch to it; it prints `crew-retry-detach=done|dirty|other-branch`.
 */
export function buildRetryProgressCommand(previousRunId: string, cwd: string, options: { detachBranch?: string } = {}): string {
  if (!cwd.startsWith("/")) throw new Error(`crew retry progress: cwd must be absolute: ${cwd}`);
  const git = `git -C ${shellQuote(cwd)}`;
  const steps = [
    buildRemoteStopCommand(previousRunId, cwd),
    `echo "${CLOCK_MARK} $(date +%s)"`,
    `${git} log --branches HEAD --source --format='%H%x09%ct%x09%cI%x09%S%x09%s' -n ${MAX_COMMITS}`,
  ];
  const branch = options.detachBranch;
  if (branch !== undefined) {
    if (!CREW_ISSUE_BRANCH_RE.test(branch)) throw new Error(`crew retry progress: not a Crew issue branch: ${branch}`);
    steps.push(
      `{ crew_head=$(${git} symbolic-ref --short HEAD 2>/dev/null); crew_dirty=$(${git} status --porcelain) || exit 3; ` +
        `if [ "$crew_head" != ${shellQuote(branch)} ]; then echo ${DETACH_MARK}other-branch; ` +
        `elif [ -n "$crew_dirty" ]; then echo ${DETACH_MARK}dirty; ` +
        `else ${git} switch --detach -q && echo ${DETACH_MARK}done; fi; }`,
    );
  }
  return steps.join(" && ");
}

export type RetryProgressOutput =
  | { ok: true; commits: RetryCommit[]; truncated: boolean; detach: DetachOutcome | null }
  | { ok: false; error: string };

/**
 * `window.sentAt`/`receivedAt` are the VPS clock (ms) around the SSH call; their midpoint is matched
 * with the Mac's `date +%s` to shift `startedAt` onto the Mac clock before filtering by committer time.
 */
export function parseRetryProgressOutput(
  stdout: string,
  window: { startedAt: Date; sentAt: number; receivedAt: number },
): RetryProgressOutput {
  const lines = stdout.split("\n");
  const clockIndex = lines.findIndex((line) => line.startsWith(`${CLOCK_MARK} `));
  if (clockIndex < 0) return { ok: false, error: `unexpected output: ${stdout.slice(-200)}` };
  const stop = parseRemoteStopOutput(lines.slice(0, clockIndex).join("\n"));
  if (!stop) return { ok: false, error: "không đọc được kết quả dừng run trước" };
  if (stop.remaining > 0) return { ok: false, error: `run trước còn ${stop.remaining} process trên Mac` };
  const macNowSeconds = Number(lines[clockIndex]!.slice(CLOCK_MARK.length + 1).trim());
  if (!Number.isInteger(macNowSeconds)) return { ok: false, error: "không đọc được giờ của Mac" };
  const offsetMs = macNowSeconds * 1000 - (window.sentAt + window.receivedAt) / 2;
  const minSeconds = (window.startedAt.getTime() + offsetMs - RETRY_SINCE_SLACK_MS) / 1000;

  const commits: RetryCommit[] = [];
  let listed = 0;
  let oldestInWindow = false;
  let detach: DetachOutcome | null = null;
  for (const line of lines.slice(clockIndex + 1)) {
    if (line.startsWith(DETACH_MARK)) {
      const value = line.slice(DETACH_MARK.length).trim();
      if (value === "done" || value === "dirty" || value === "other-branch") detach = value;
      continue;
    }
    const [sha, ct, committedAt, branch, ...subject] = line.split("\t");
    if (!sha || !/^[0-9a-f]{40}$/.test(sha) || !committedAt || branch === undefined) continue;
    const seconds = Number(ct);
    listed += 1;
    oldestInWindow = Number.isFinite(seconds) && seconds >= minSeconds;
    if (!oldestInWindow) continue;
    commits.push({ sha, committedAt, branch, subject: subject.join("\t").trim() });
  }
  return { ok: true, commits, truncated: listed >= MAX_COMMITS && oldestInWindow, detach };
}

const TIME = new Intl.DateTimeFormat("vi-VN", {
  timeZone: "Asia/Ho_Chi_Minh",
  hour: "2-digit",
  minute: "2-digit",
  day: "2-digit",
  month: "2-digit",
});

const RETRY_REASON_TEXT: Record<string, string> = {
  transient_failure: "lỗi tạm thời hoặc mất process (ví dụ mất kết nối tới Mac)",
  missing_issue_comment: "run trước kết thúc mà chưa comment trên issue",
  workspace_busy: "workspace đang bận",
  ai_connection_busy: "kết nối AI đang bận",
  max_turns_continuation: "run trước hết lượt, chạy tiếp",
  interaction_continuation_infra_retry: "lỗi hạ tầng khi tiếp tục tương tác",
};

export function readRetryReason(contextSnapshot: unknown): string | null {
  if (!contextSnapshot || typeof contextSnapshot !== "object") return null;
  const value = (contextSnapshot as Record<string, unknown>).retryReason;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Start of every retry comment for this previous run; also used to find an already posted comment. */
export function retryProgressCommentPrefix(previousRunId: string): string {
  return `Crew: lần chạy lại sau run \`${previousRunId}\``;
}

export function retryProgressComment(p: Extract<RetryProgress, { kind: "checked" }>): string {
  const reason = p.retryReason ? (RETRY_REASON_TEXT[p.retryReason] ?? `\`${p.retryReason}\``) : "không rõ";
  const list = p.commits.map((c) => `- ${c.sha.slice(0, 8)} (${c.branch}) ${c.subject}`).join("\n");
  return (
    `${retryProgressCommentPrefix(p.previousRunId)} (bắt đầu ${TIME.format(p.previousStartedAt)}), ` +
    `run đó dừng giữa chừng, lý do: ${reason}. ` +
    `Có ${p.truncated ? "ít nhất " : ""}${p.commits.length} commit trong worktree kể từ khi run trước bắt đầu ` +
    `(\`${p.cwd}\`, mọi nhánh local, có thể gồm nhánh của việc khác)` +
    `${p.truncated ? `; danh sách bị cắt ở ${p.commits.length} commit mới nhất, xem thêm bằng \`git log --branches HEAD\`` : ""}:` +
    `\n${list}\n\n` +
    "Kiểm tra các commit trên rồi tiếp tục phần còn thiếu; không làm lại phần đã commit."
  );
}

function describeError(err: unknown): string {
  const e = (err ?? {}) as { stderr?: unknown; message?: unknown };
  const message = typeof e.stderr === "string" && e.stderr.trim() ? e.stderr.trim() : String(e.message ?? err);
  return message.slice(0, 200);
}

/** Run trước cần kiểm: `retry` (retryOfRunId) hoặc `fallback` (run của agent cũ trước khi chuyển runtime). */
export interface ProgressTarget {
  mode: "retry" | "fallback";
  previousRunId: string;
}

function readIssueId(contextSnapshot: unknown): string | null {
  if (!contextSnapshot || typeof contextSnapshot !== "object") return null;
  const value = (contextSnapshot as Record<string, unknown>).issueId;
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Returns `none` when there is nothing to check (not a retry, previous run never started, no SSH
 * lease with a remote cwd), `checked` with the commits found, or `error` when the check itself
 * failed (SSH, stop left processes, git exit code, database) so the caller holds the run instead of
 * rerunning blind. In `fallback` mode the previous run belongs to another agent: its worktree is also
 * detached from the issue branch `crew/<identifier>` (see buildRetryProgressCommand).
 */
export function createRetryProgressChecker(
  db: Db,
  runSsh: RetryProgressSshRunner = (config, command, options) => runSshCommand(config, command, options),
  clock: () => number = Date.now,
): (run: Run, target?: ProgressTarget) => Promise<RetryProgress> {
  return async (run, target) => {
    const mode = target?.mode ?? "retry";
    const previousRunId = target ? target.previousRunId : run.retryOfRunId;
    if (!previousRunId) return { kind: "none" };
    try {
      const [previous] = await db
        .select({ startedAt: heartbeatRuns.startedAt })
        .from(heartbeatRuns)
        .where(eq(heartbeatRuns.id, previousRunId))
        .limit(1);
      if (!previous?.startedAt) return { kind: "none" };
      const [lease] = await db
        .select({ environmentId: environmentLeases.environmentId, metadata: environmentLeases.metadata })
        .from(environmentLeases)
        .where(eq(environmentLeases.heartbeatRunId, previousRunId))
        .orderBy(desc(environmentLeases.createdAt))
        .limit(1);
      const cwd = readRemoteCwd(lease?.metadata ?? null);
      if (!lease?.environmentId || !cwd) return { kind: "none" };
      const environment = await environmentService(db).getById(lease.environmentId);
      if (!environment) return { kind: "none" };
      const parsed = await resolveEnvironmentDriverConfigForRuntime(db, run.companyId, environment, {
        heartbeatRunId: run.id,
      });
      if (parsed.driver !== "ssh") return { kind: "none" };
      let detachBranch: string | undefined;
      if (mode === "fallback") {
        const issueId = readIssueId(run.contextSnapshot);
        const [issue] = issueId
          ? await db
              .select({ identifier: issues.identifier })
              .from(issues)
              .where(and(eq(issues.id, issueId), eq(issues.companyId, run.companyId)))
              .limit(1)
          : [];
        if (!issue?.identifier) return { kind: "error", error: "không đọc được mã issue để tách nhánh của run trước" };
        detachBranch = `crew/${issue.identifier}`;
      }
      const command = buildRetryProgressCommand(previousRunId, cwd, { detachBranch });
      const sentAt = clock();
      const result = await runSsh(parsed.config, command, { timeoutMs: RETRY_PROGRESS_TIMEOUT_MS });
      const output = parseRetryProgressOutput(result.stdout, {
        startedAt: previous.startedAt,
        sentAt,
        receivedAt: clock(),
      });
      if (!output.ok) return { kind: "error", error: output.error };
      if (detachBranch && !output.detach) return { kind: "error", error: "không đọc được kết quả tách nhánh của run trước" };
      return {
        kind: "checked",
        previousRunId,
        previousStartedAt: previous.startedAt,
        retryReason: readRetryReason(run.contextSnapshot),
        cwd,
        truncated: output.truncated,
        commits: output.commits,
        detach: output.detach,
      };
    } catch (err) {
      return { kind: "error", error: describeError(err) };
    }
  };
}

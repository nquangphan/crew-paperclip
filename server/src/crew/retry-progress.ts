import { desc, eq } from "drizzle-orm";
import { type Db, environmentLeases, heartbeatRuns } from "@paperclipai/db";
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
      commits: RetryCommit[];
    }
  | { kind: "error"; error: string };

type Run = typeof heartbeatRuns.$inferSelect;
type SshConfig = Parameters<typeof runSshCommand>[0];
export type RetryProgressSshRunner = (
  config: SshConfig,
  command: string,
  options: { timeoutMs: number },
) => Promise<{ stdout: string }>;

/** Stops the previous run's leftovers, prints the Mac clock, then lists commits on all local branches. */
export function buildRetryProgressCommand(previousRunId: string, cwd: string): string {
  if (!cwd.startsWith("/")) throw new Error(`crew retry progress: cwd must be absolute: ${cwd}`);
  return [
    buildRemoteStopCommand(previousRunId, cwd),
    `echo "${CLOCK_MARK} $(date +%s)"`,
    `git -C ${shellQuote(cwd)} log --branches --source --format='%H%x09%ct%x09%cI%x09%S%x09%s' -n ${MAX_COMMITS}`,
  ].join(" && ");
}

export type RetryProgressOutput = { ok: true; commits: RetryCommit[] } | { ok: false; error: string };

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
  for (const line of lines.slice(clockIndex + 1)) {
    const [sha, ct, committedAt, branch, ...subject] = line.split("\t");
    if (!sha || !/^[0-9a-f]{40}$/.test(sha) || !committedAt || branch === undefined) continue;
    const seconds = Number(ct);
    if (!Number.isFinite(seconds) || seconds < minSeconds) continue;
    commits.push({ sha, committedAt, branch, subject: subject.join("\t").trim() });
  }
  return { ok: true, commits };
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
    `Run đó đã có ${p.commits.length} commit trong \`${p.cwd}\`:\n${list}\n\n` +
    "Kiểm tra các commit trên rồi tiếp tục phần còn thiếu; không làm lại phần đã commit."
  );
}

function describeError(err: unknown): string {
  const e = (err ?? {}) as { stderr?: unknown; message?: unknown };
  const message = typeof e.stderr === "string" && e.stderr.trim() ? e.stderr.trim() : String(e.message ?? err);
  return message.slice(0, 200);
}

/**
 * Returns `none` when there is nothing to check (not a retry, previous run never started, no SSH
 * lease with a remote cwd), `checked` with the commits found, or `error` when the check itself
 * failed (SSH, stop left processes, git exit code, database) so the caller holds the run instead of
 * rerunning blind.
 */
export function createRetryProgressChecker(
  db: Db,
  runSsh: RetryProgressSshRunner = (config, command, options) => runSshCommand(config, command, options),
  clock: () => number = Date.now,
): (run: Run) => Promise<RetryProgress> {
  return async (run) => {
    const previousRunId = run.retryOfRunId;
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
      const command = buildRetryProgressCommand(previousRunId, cwd);
      const sentAt = clock();
      const result = await runSsh(parsed.config, command, { timeoutMs: RETRY_PROGRESS_TIMEOUT_MS });
      const output = parseRetryProgressOutput(result.stdout, {
        startedAt: previous.startedAt,
        sentAt,
        receivedAt: clock(),
      });
      if (!output.ok) return { kind: "error", error: output.error };
      return {
        kind: "checked",
        previousRunId,
        previousStartedAt: previous.startedAt,
        retryReason: readRetryReason(run.contextSnapshot),
        cwd,
        commits: output.commits,
      };
    } catch (err) {
      return { kind: "error", error: describeError(err) };
    }
  };
}

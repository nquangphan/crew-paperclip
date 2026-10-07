import { desc, eq } from "drizzle-orm";
import { type Db, environmentLeases, heartbeatRuns } from "@paperclipai/db";
import { runSshCommand } from "@paperclipai/adapter-utils/ssh";
import { resolveEnvironmentDriverConfigForRuntime } from "../services/environment-config.js";
import { environmentService } from "../services/environments.js";
import { readRemoteCwd } from "./remote-stop.js";

/**
 * A retried run (heartbeat_runs.retryOfRunId set, e.g. after the Mac lost its connection) first
 * looks at the previous run's worktree on the Mac: commits made since that run started are listed
 * in an issue comment so the agent checks and continues instead of redoing them. The time window
 * comes from the database (previous run's startedAt), because the run's .paperclip-runtime/runs/<id>
 * directory is removed when the run is stopped.
 */
export const RETRY_PROGRESS_TIMEOUT_MS = 5_000;
/** Mac và VPS có thể lệch đồng hồ vài giây; lấy rộng ra 30 giây trước lúc run trước bắt đầu. */
export const RETRY_SINCE_SLACK_MS = 30_000;
const MAX_COMMITS = 20;

export interface RetryCommit {
  sha: string;
  committedAt: string;
  subject: string;
}

export type RetryProgress =
  | { kind: "none" }
  | { kind: "checked"; previousRunId: string; previousStartedAt: Date; cwd: string; commits: RetryCommit[] }
  | { kind: "error"; error: string };

type Run = typeof heartbeatRuns.$inferSelect;
type SshConfig = Parameters<typeof runSshCommand>[0];
export type RetryProgressSshRunner = (
  config: SshConfig,
  command: string,
  options: { timeoutMs: number },
) => Promise<{ stdout: string }>;

function quote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function buildRetryProgressCommand(cwd: string, since: Date): string {
  if (!cwd.startsWith("/") || /[\n\r]/.test(cwd)) {
    throw new Error(`crew retry progress: cwd must be an absolute single-line path: ${cwd}`);
  }
  return `git -C ${quote(cwd)} log --since=${quote(since.toISOString())} --format='%H%x09%cI%x09%s' -n ${MAX_COMMITS} HEAD`;
}

export function parseRetryCommits(stdout: string): RetryCommit[] {
  const commits: RetryCommit[] = [];
  for (const line of stdout.split("\n")) {
    const [sha, committedAt, ...subject] = line.split("\t");
    if (!sha || !/^[0-9a-f]{40}$/.test(sha) || !committedAt) continue;
    commits.push({ sha, committedAt, subject: subject.join("\t").trim() });
  }
  return commits;
}

const TIME = new Intl.DateTimeFormat("vi-VN", {
  timeZone: "Asia/Ho_Chi_Minh",
  hour: "2-digit",
  minute: "2-digit",
  day: "2-digit",
  month: "2-digit",
});

export function retryProgressComment(p: Extract<RetryProgress, { kind: "checked" }>): string {
  const list = p.commits.map((c) => `- ${c.sha.slice(0, 8)} ${c.subject}`).join("\n");
  return (
    `Crew: lần chạy lại sau khi run \`${p.previousRunId}\` (bắt đầu ${TIME.format(p.previousStartedAt)}) mất kết nối. ` +
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
 * failed (SSH, git exit code, database) so the caller can hold the run instead of rerunning blind.
 */
export function createRetryProgressChecker(
  db: Db,
  runSsh: RetryProgressSshRunner = (config, command, options) => runSshCommand(config, command, options),
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
      const since = new Date(previous.startedAt.getTime() - RETRY_SINCE_SLACK_MS);
      const result = await runSsh(parsed.config, buildRetryProgressCommand(cwd, since), {
        timeoutMs: RETRY_PROGRESS_TIMEOUT_MS,
      });
      return {
        kind: "checked",
        previousRunId,
        previousStartedAt: previous.startedAt,
        cwd,
        commits: parseRetryCommits(result.stdout),
      };
    } catch (err) {
      return { kind: "error", error: describeError(err) };
    }
  };
}

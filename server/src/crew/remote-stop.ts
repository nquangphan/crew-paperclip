import type { Db } from "@paperclipai/db";
import { runSshCommand, shellQuote } from "@paperclipai/adapter-utils/ssh";
import { logger } from "../middleware/logger.js";
import { logActivity } from "../services/activity-log.js";
import { resolveEnvironmentDriverConfigForRuntime } from "../services/environment-config.js";
import type { EnvironmentDriverReleaseInput } from "../services/environment-runtime.js";

/** Same shape as RunLeaseReleasedInput in core-hooks.ts (not imported: implementations must not import the registry). */
export type RunLeaseReleasedInput = EnvironmentDriverReleaseInput & { db: Db };
type SshConfig = Parameters<typeof runSshCommand>[0];

const RUN_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Upper bound for the whole SSH stop command. It stays below the registry's 15 s wait
 * (CREW_RUN_LEASE_RELEASE_HOOK_TIMEOUT_MS) so the ssh client is killed by its own timeout
 * before the registry gives up, and no stale stop command keeps running next to a new lease.
 * Budget: ssh ConnectTimeout 10 s is the worst case; on Tailscale the connect takes ~1 s and the
 * remote script needs at most ~5 s (4 s TERM grace, KILL, final check).
 */
export const REMOTE_STOP_TIMEOUT_MS = 12_000;

// Runs on the Mac with macOS /bin/sh. $1 = run id, $2 = worktree root ("" = token only).
// When crew-mac is installed (~/.crew/bin/crew-mac) and the root is known, the script runs
// `crew-mac stop-run --run-id <id> --root <root> --term-wait-seconds 3`, which prints the same
// summary line (exit 0) or fails with exit 1 (internal) / 2 (bad input). Otherwise it uses the
// built-in fallback below, whose summary line ends with "via=fallback". A launcher that refuses the
// input (exit 2) or cannot run (exit 126/127) also falls through to the fallback in the same SSH command.
// started = birth time of the wrapper process (epoch seconds), so the leader check below allows ±2 s.
// Targets: (a) the process group recorded by crew-claude-run in
// $2/.paperclip-runtime/runs/$1/pgid, limited to processes started at or after the
// recorded start time minus 2 s, and skipped entirely when the group's live leader (pid == pgid)
// did not start within 2 s of the recorded time (guards against PGID reuse before or after the run
// started; the wrapper execs into claude, so the real leader keeps the recorded PID); (b) any process whose
// environment, as shown by `ps -E`, has the exact token PAPERCLIP_RUN_ID=$1 (ps -E cannot
// read the environment of Apple binaries such as zsh or sleep, so (a) is the main path).
// Zombies are skipped (already dead, waiting for their parent to reap them).
// Sends TERM to the groups and pids, waits up to 4 s, then KILLs survivors.
// Prints: crew-stop matched=N killed=N remaining=N
export const CREW_REMOTE_STOP_SCRIPT = [
  'run_id="$1"; root="$2"',
  'case "$run_id" in ""|*[!0-9a-fA-F-]*) echo "crew-stop: invalid run id" >&2; exit 2;; esac',
  'launcher="$HOME/.crew/bin/crew-mac"',
  'if [ -n "$root" ] && [ -x "$launcher" ]; then',
  '  "$launcher" stop-run --run-id "$run_id" --root "$root" --term-wait-seconds 3; rc=$?',
  '  # 2: crew-mac refused the input (root outside its worktree root, or not set up yet) - the fallback',
  '  # still finds the run by its pgid file and PAPERCLIP_RUN_ID. 126/127: the launcher could not run.',
  '  if [ "$rc" -ne 2 ] && [ "$rc" -ne 126 ] && [ "$rc" -ne 127 ]; then exit "$rc"; fi',
  "fi",
  'self_pgid=$(ps -o pgid= -p $$ | tr -d " ")',
  'dir="$root/.paperclip-runtime/runs/$run_id"',
  'file_pg=""; started=0',
  'if [ -n "$root" ] && [ -r "$dir/pgid" ]; then',
  '  file_pg=$(tr -dc "0-9" < "$dir/pgid")',
  '  started=$(tr -dc "0-9" < "$dir/started" 2>/dev/null)',
  '  [ -n "$started" ] || started=0',
  "fi",
  "list() {",
  '  ps -E -ww -U "$(id -u)" -o pid= -o pgid= -o stat= -o etime= -o command= | awk -v tag="PAPERCLIP_RUN_ID=$run_id" -v selfpg="$self_pgid" -v fpg="$file_pg" -v started="$started" -v now="$(date +%s)" \'',
  '    function secs(e,  a, n, d) { d = 0; if (index(e, "-")) { split(e, a, "-"); d = a[1]; e = a[2] } n = split(e, a, ":"); return d * 86400 + (n == 3 ? a[1] * 3600 + a[2] * 60 + a[3] : a[1] * 60 + a[2]) }',
  "    $2 == selfpg || $3 ~ /^Z/ { next }",
  '    fpg != "" && fpg > 1 && $1 == fpg { leader = now - secs($4) }',
  '    fpg != "" && fpg > 1 && $2 == fpg && now - secs($4) >= started - 2 { group[$1] = $2; next }',
  "    { for (i = 5; i <= NF; i++) if ($i == tag) { print $1, $2; break } }",
  "    END {",
  "      # A live leader (pid == pgid) that did not start with the run means the PGID was reused.",
  '      if (leader != "" && (leader - started > 2 || started - leader > 2)) exit',
  "      for (p in group) print p, group[p]",
  "    }'",
  "}",
  "signal_all() {",
  '  for pg in $(printf "%s\\n" "$1" | awk \'{print $2}\' | sort -u); do',
  '    if [ "$pg" -gt 1 ]; then kill -s "$2" -- "-$pg" 2>/dev/null || true; fi',
  "  done",
  '  for p in $(printf "%s\\n" "$1" | awk \'{print $1}\'); do kill -s "$2" "$p" 2>/dev/null || true; done',
  "}",
  "targets=$(list)",
  'if [ -z "$targets" ]; then echo "crew-stop matched=0 killed=0 remaining=0 via=fallback"; exit 0; fi',
  'matched=$(printf "%s\\n" "$targets" | wc -l | tr -d " ")',
  'signal_all "$targets" TERM',
  'left="$targets"; i=0',
  'while [ -n "$left" ] && [ "$i" -lt 8 ]; do sleep 0.5; left=$(list); i=$((i + 1)); done',
  "killed=0",
  'if [ -n "$left" ]; then killed=$(printf "%s\\n" "$left" | wc -l | tr -d " "); signal_all "$left" KILL; sleep 0.5; fi',
  "remaining=$(list | grep -c . || true)",
  'if [ "$remaining" = 0 ] && [ -n "$root" ] && [ -d "$dir" ]; then rm -rf "$dir"; fi',
  'echo "crew-stop matched=$matched killed=$killed remaining=$remaining via=fallback"',
].join("\n");

export function buildRemoteStopCommand(runId: string, root: string): string {
  if (!RUN_ID_RE.test(runId)) throw new Error(`crew remote stop: invalid run id "${runId}"`);
  if (root !== "" && (!root.startsWith("/") || /[\n\r]/.test(root))) {
    throw new Error(`crew remote stop: invalid worktree root "${root}"`);
  }
  return `sh -c ${shellQuote(CREW_REMOTE_STOP_SCRIPT)} crew-stop ${shellQuote(runId)} ${shellQuote(root)}`;
}

/** Reads the last non-empty line only; it must be exactly the summary line (optional `via=` suffix). */
export function parseRemoteStopOutput(
  stdout: string,
): { matched: number; killed: number; remaining: number; via?: string } | null {
  const last = stdout.split("\n").map((line) => line.trim()).filter(Boolean).at(-1) ?? "";
  const match = /^crew-stop matched=(\d+) killed=(\d+) remaining=(\d+)(?: via=(\w+))?$/.exec(last);
  if (!match) return null;
  return {
    matched: Number(match[1]),
    killed: Number(match[2]),
    remaining: Number(match[3]),
    ...(match[4] ? { via: match[4] } : {}),
  };
}

export type RemoteStopResult = {
  /** failed: the stop command ran on the Mac but exited non-zero, so nothing is known to be stopped. */
  outcome: "skipped" | "stopped" | "incomplete" | "unreachable" | "failed";
  exitCode?: number;
  /** "fallback" when the built-in script answered instead of crew-mac stop-run. */
  via?: string;
  matched?: number;
  killed?: number;
  remaining?: number;
  error?: string;
};

export interface RemoteStopDeps {
  resolveSshConfig(input: RunLeaseReleasedInput): Promise<SshConfig | null>;
  runSsh(config: SshConfig, command: string, options: { timeoutMs: number }): Promise<{ stdout: string }>;
  recordActivity(input: RunLeaseReleasedInput, result: RemoteStopResult): Promise<void>;
}

const defaultDeps: RemoteStopDeps = {
  async resolveSshConfig(input) {
    const parsed = await resolveEnvironmentDriverConfigForRuntime(input.db, input.lease.companyId, input.environment, {
      issueId: input.lease.issueId,
      heartbeatRunId: input.lease.heartbeatRunId,
    });
    return parsed.driver === "ssh" ? parsed.config : null;
  },
  async runSsh(config, command, options) {
    // runSshCommand passes timeoutMs to execFile, which kills the ssh client when it expires.
    return await runSshCommand(config, command, { timeoutMs: options.timeoutMs });
  },
  async recordActivity(input, result) {
    if (result.outcome === "stopped" && (result.matched ?? 0) === 0) return;
    await logActivity(input.db, {
      companyId: input.lease.companyId,
      actorType: "system",
      actorId: "crew",
      action: "crew.remote_stop",
      entityType: "heartbeat_run",
      entityId: input.lease.heartbeatRunId as string,
      runId: input.lease.heartbeatRunId,
      issueId: input.lease.issueId,
      details: { ...result, leaseStatus: input.status, environmentId: input.environment.id },
    });
  },
};

/** ssh exits 255 on its own failures and is killed on timeout; any other exit code came from the Mac side. */
function classifyStopError(err: unknown): RemoteStopResult {
  const e = (err ?? {}) as { code?: unknown; stderr?: unknown; message?: unknown };
  const stderr = typeof e.stderr === "string" ? e.stderr.trim() : "";
  const message = stderr || (typeof e.message === "string" ? e.message : String(err));
  if (typeof e.code === "number" && e.code !== 255) {
    return { outcome: "failed", exitCode: e.code, error: message.slice(0, 300) };
  }
  return { outcome: "unreachable", error: message.slice(0, 300) };
}

export function readRemoteCwd(metadata: Record<string, unknown> | null | undefined): string {
  const value = metadata?.remoteCwd;
  return typeof value === "string" ? value.trim() : "";
}

/**
 * H3 implementation: stops the run's processes on the SSH host when its lease is released
 * (run finished, cancelled, reaped after restart, or failed). Returns at once for leases that
 * are not tied to a run (probe, device-login, setup-token) and for non-SSH drivers. Never throws.
 */
export async function stopRemoteRunOnRelease(
  input: RunLeaseReleasedInput,
  deps: Partial<RemoteStopDeps> = {},
): Promise<RemoteStopResult> {
  const runId = input.lease.heartbeatRunId;
  if (runId === null || runId === undefined || input.environment.driver !== "ssh") return { outcome: "skipped" };
  const d: RemoteStopDeps = { ...defaultDeps, ...deps };

  let result: RemoteStopResult;
  try {
    const config = await d.resolveSshConfig(input);
    if (!config) return { outcome: "skipped" };
    const command = buildRemoteStopCommand(runId, readRemoteCwd(input.lease.metadata));
    const { stdout } = await d.runSsh(config, command, { timeoutMs: REMOTE_STOP_TIMEOUT_MS });
    const parsed = parseRemoteStopOutput(stdout);
    result = parsed
      ? { outcome: parsed.remaining > 0 ? "incomplete" : "stopped", ...parsed }
      : { outcome: "failed", error: `unexpected output: ${stdout.slice(-200)}` };
  } catch (err) {
    result = classifyStopError(err);
  }

  const fields = { runId, leaseStatus: input.status, ...result };
  if (result.outcome === "stopped") logger.info(fields, "crew: remote stop on lease release");
  else logger.warn(fields, "crew: remote stop on lease release");
  try {
    await d.recordActivity(input, result);
  } catch (err) {
    logger.warn({ err, runId }, "crew: failed to record remote stop activity");
  }
  return result;
}

/**
 * Upper bound for a stop started in the background. It stays below the 30 s cancel contract and above
 * the SSH budget (REMOTE_STOP_TIMEOUT_MS) plus SSH config resolution, so a normal stop always finishes
 * first; past it the stop is reported as unreachable and no longer holds claims on the host.
 */
export const REMOTE_STOP_BACKGROUND_LIMIT_MS = 20_000;

const pendingStops = new Map<symbol, { environmentId: string; done: Promise<void> }>();

/** True while a stop started by a lease release is still running on this environment's host. */
export function isRemoteStopPending(environmentId: string): boolean {
  for (const stop of pendingStops.values()) if (stop.environmentId === environmentId) return true;
  return false;
}

/**
 * H3 entry point: starts the remote stop and returns at once, so the lease is marked released right
 * away. Stock admission treats a lease that is not released yet as a live execution owner and skips
 * the wake of the next participant, so the SSH round trip must not happen before the release. While
 * the stop runs, the load gate keeps claims on the same environment queued (no new run next to the
 * old processes). The stop records its own `crew.remote_stop` activity; a stop that exceeds
 * REMOTE_STOP_BACKGROUND_LIMIT_MS is recorded as unreachable. Never throws.
 */
export function startRemoteStopOnRelease(
  input: RunLeaseReleasedInput,
  stop: (input: RunLeaseReleasedInput) => Promise<RemoteStopResult> = stopRemoteRunOnRelease,
): void {
  if (!input.lease.heartbeatRunId || input.environment.driver !== "ssh") return;
  const key = Symbol(input.lease.heartbeatRunId);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), REMOTE_STOP_BACKGROUND_LIMIT_MS);
  });
  const done = Promise.race([
    Promise.resolve()
      .then(() => stop(input))
      .then(() => "done" as const),
    limit,
  ])
    .then(async (outcome) => {
      if (outcome !== "timeout") return;
      logger.warn({ runId: input.lease.heartbeatRunId }, "crew: remote stop exceeded its background limit");
      await defaultDeps.recordActivity(input, {
        outcome: "unreachable",
        error: `lệnh dừng chưa xong sau ${REMOTE_STOP_BACKGROUND_LIMIT_MS / 1000} giây`,
      });
    })
    .catch((err) => {
      logger.warn({ err, runId: input.lease.heartbeatRunId }, "crew: background remote stop failed");
    })
    .finally(() => {
      clearTimeout(timer);
      pendingStops.delete(key);
    });
  pendingStops.set(key, { environmentId: input.environment.id, done });
}

/** Waits for every background stop (tests only; the server never awaits them). */
export async function settleRemoteStopsForTests(): Promise<void> {
  await Promise.all([...pendingStops.values()].map((stop) => stop.done));
}

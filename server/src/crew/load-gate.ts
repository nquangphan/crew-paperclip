import { and, asc, eq } from "drizzle-orm";
import { activityLog, agents, type Db, type heartbeatRuns } from "@paperclipai/db";
import { runSshCommand } from "@paperclipai/adapter-utils/ssh";
import { logger } from "../middleware/logger.js";
import { logActivity } from "../services/activity-log.js";
import { resolveEnvironmentDriverConfigForRuntime } from "../services/environment-config.js";
import { environmentService } from "../services/environments.js";
import { issueService } from "../services/issues.js";
import { type RetryProgress, createRetryProgressChecker, retryProgressComment } from "./retry-progress.js";

/** Same shape as BeforeClaimInput in core-hooks.ts (not imported: implementations must not import the registry). */
export interface BeforeClaimInput {
  db: Db;
  run: typeof heartbeatRuns.$inferSelect;
}

export const LOAD_GATE_PROBE_TTL_MS = 15_000;
export const LOAD_GATE_PROBE_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_WAIT_MINUTES = 60;

export interface LoadGateSettings {
  maxLoad1: number;
  maxWaitMinutes: number;
}

export function readLoadGateSettings(metadata: Record<string, unknown> | null | undefined): LoadGateSettings | null {
  const raw = metadata?.crewLoadGate;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const maxLoad1 = Number(record.maxLoad1);
  const maxWaitMinutes = record.maxWaitMinutes === undefined ? DEFAULT_MAX_WAIT_MINUTES : Number(record.maxWaitMinutes);
  if (!Number.isFinite(maxLoad1) || maxLoad1 <= 0) return null;
  if (!Number.isInteger(maxWaitMinutes) || maxWaitMinutes < 1) return null;
  return { maxLoad1, maxWaitMinutes };
}

export function parseLoadAvg(stdout: string): number | null {
  const first = stdout.replace(/[{}]/g, " ").trim().split(/\s+/)[0];
  const value = Number(first);
  return first && Number.isFinite(value) ? value : null;
}

export type HostProbe = { ok: true; load1: number } | { ok: false; error: string };

export function createProbeCache(ttlMs: number, now: () => number = Date.now) {
  const entries = new Map<string, { expiresAt: number; value: Promise<HostProbe> }>();
  return {
    get(key: string, probe: () => Promise<HostProbe>): Promise<HostProbe> {
      const cached = entries.get(key);
      if (cached && cached.expiresAt > now()) return cached.value;
      const entry = { expiresAt: Number.POSITIVE_INFINITY, value: probe() };
      entries.set(key, entry);
      void entry.value.finally(() => {
        entry.expiresAt = now() + ttlMs;
      });
      return entry.value;
    },
  };
}

export type GateDecision =
  | { action: "claim" }
  | { action: "wait"; reason: "overloaded" | "unreachable"; detail: string; deadline: Date }
  | { action: "expire"; reason: "overloaded" | "unreachable"; detail: string };

export function decideGate(input: {
  settings: LoadGateSettings;
  probe: HostProbe;
  /** When the run first had to wait (first waiting notice), or now when it is waiting for the first time. */
  waitingSince: Date;
  now: Date;
}): GateDecision {
  const { settings, probe } = input;
  if (probe.ok && probe.load1 <= settings.maxLoad1) return { action: "claim" };
  const reason = probe.ok ? "overloaded" : "unreachable";
  const detail = probe.ok
    ? `tải 1 phút ${probe.load1} vượt ngưỡng ${settings.maxLoad1}`
    : `không kết nối được (${probe.error.slice(0, 160)})`;
  const deadline = new Date(input.waitingSince.getTime() + settings.maxWaitMinutes * 60_000);
  if (input.now.getTime() >= deadline.getTime()) return { action: "expire", reason, detail };
  return { action: "wait", reason, detail, deadline };
}

const TIME_FORMAT = new Intl.DateTimeFormat("vi-VN", {
  timeZone: "Asia/Ho_Chi_Minh",
  hour: "2-digit",
  minute: "2-digit",
  day: "2-digit",
  month: "2-digit",
});

/** Activity `crew.load_gate.<kind>`: the bare kinds are the durable markers, `_comment` marks a posted comment. */
export type NoticeKind = "waiting" | "expired" | "waiting_comment" | "expired_comment";

export interface BeforeClaimDeps {
  loadTarget(run: BeforeClaimInput["run"]): Promise<{
    environmentId: string;
    environmentName: string;
    settings: LoadGateSettings;
  } | null>;
  probeHost(environmentId: string, run: BeforeClaimInput["run"]): Promise<HostProbe>;
  /** Time of the first activity of this kind for the run (persisted, survives restarts), or null. */
  firstNoticeAt(runId: string, kind: NoticeKind): Promise<Date | null>;
  /** Persists the durable marker `crew.load_gate.<kind>`; the wait deadline is counted from the first one. */
  recordNotice(notice: {
    run: BeforeClaimInput["run"];
    issueId: string | null;
    kind: "waiting" | "expired";
    details: Record<string, unknown>;
  }): Promise<void>;
  /** Comments on the issue, then persists `crew.load_gate.<kind>_comment`. A failure is retried next tick. */
  postComment(notice: {
    run: BeforeClaimInput["run"];
    issueId: string;
    kind: "waiting" | "expired";
    body: string;
  }): Promise<void>;
  /**
   * Cancels the run after the current claim has returned. claimQueuedRun runs under the agent start
   * lock and cancelling re-enters that lock, so the cancel must not be awaited from inside the hook.
   * Failures are only logged; the gate stays closed for the run either way.
   */
  scheduleCancel(runId: string, reason: string): void;
  blockIssue(issueId: string): Promise<void>;
  now(): Date;
  /** True once `crew.retry_progress.checked` exists for this run (the check runs once per run). */
  retryChecked(runId: string): Promise<boolean>;
  checkRetryProgress(run: BeforeClaimInput["run"]): Promise<RetryProgress>;
  /** Comments the previous run's commits (when there are any), then persists `crew.retry_progress.checked`. */
  recordRetryProgress(run: BeforeClaimInput["run"], issueId: string | null, progress: RetryProgress): Promise<void>;
}

function readIssueId(contextSnapshot: unknown): string | null {
  if (!contextSnapshot || typeof contextSnapshot !== "object") return null;
  const value = (contextSnapshot as Record<string, unknown>).issueId;
  return typeof value === "string" && value.length > 0 ? value : null;
}

type GateTarget = NonNullable<Awaited<ReturnType<BeforeClaimDeps["loadTarget"]>>>;

function waitingBody(runId: string, target: GateTarget, decision: Extract<GateDecision, { action: "wait" }>): string {
  return (
    `Run \`${runId}\` đang chờ máy \`${target.environmentName}\`: ${decision.detail}. ` +
    `Run sẽ tự chạy khi máy ổn. Nếu tới ${TIME_FORMAT.format(decision.deadline)} vẫn chưa chạy được, ` +
    "Crew sẽ hủy run và chuyển issue sang `blocked`."
  );
}

function expiredBody(runId: string, target: GateTarget, detail?: string): string {
  return (
    `Run \`${runId}\` đã chờ máy \`${target.environmentName}\` quá ${target.settings.maxWaitMinutes} phút` +
    `${detail ? ` (${detail})` : ""}. Crew hủy run và chuyển issue sang \`blocked\`. ` +
    "Kiểm máy bằng `crew-mac doctor`, rồi chuyển issue về `todo` để chạy lại."
  );
}

export async function evaluateBeforeClaim(input: BeforeClaimInput, deps: BeforeClaimDeps): Promise<boolean> {
  const { run } = input;
  if (run.status !== "queued") return false;
  const target = await deps.loadTarget(run);
  if (!target) return false;
  const expiredReason = `Crew: hết ${target.settings.maxWaitMinutes} phút chờ máy ${target.environmentName}`;

  // Once the wait expired the run is on its way out: keep it queued, retry the cancel and a missing comment.
  if (await deps.firstNoticeAt(run.id, "expired")) {
    deps.scheduleCancel(run.id, expiredReason);
    const issueId = readIssueId(run.contextSnapshot);
    if (issueId) {
      await logFailure(run.id, "expired comment", async () => {
        if (await deps.firstNoticeAt(run.id, "expired_comment")) return;
        await deps.postComment({ run, issueId, kind: "expired", body: expiredBody(run.id, target) });
      });
    }
    return true;
  }

  const probe = await deps.probeHost(target.environmentId, run);
  const now = deps.now();
  const waitingSince = (await deps.firstNoticeAt(run.id, "waiting")) ?? null;
  let decision = decideGate({ settings: target.settings, probe, waitingSince: waitingSince ?? now, now });
  const issueId = readIssueId(run.contextSnapshot);
  if (decision.action === "claim") {
    // A retry first learns what its lost predecessor already committed. When that cannot be checked
    // the run is held like an unreachable host (same deadline), never rerun blind.
    if (!run.retryOfRunId || (await deps.retryChecked(run.id))) return false;
    const progress = await deps.checkRetryProgress(run);
    let failure = progress.kind === "error" ? progress.error : null;
    if (!failure) {
      try {
        await deps.recordRetryProgress(run, issueId, progress);
        return false;
      } catch (err) {
        failure = err instanceof Error ? err.message : String(err);
      }
    }
    decision = decideGate({
      settings: target.settings,
      probe: { ok: false, error: `kiểm tiến độ lần chạy trước lỗi: ${failure}` },
      waitingSince: waitingSince ?? now,
      now,
    });
    if (decision.action === "claim") return false; // unreachable: a failed probe never claims
  }

  const details = { environmentId: target.environmentId, reason: decision.reason, detail: decision.detail };

  // From here on the run is held: a failed marker, comment or issue update is logged, never a reason
  // to open the gate. The marker is written before the comment so a failing comment cannot keep the
  // deadline moving; the comment has its own marker and is retried on the next tick.
  if (decision.action === "wait") {
    if (!waitingSince) {
      await logFailure(run.id, "waiting marker", () =>
        deps.recordNotice({ run, issueId, kind: "waiting", details: { ...details, deadline: decision.deadline.toISOString() } }),
      );
    }
    if (issueId) {
      await logFailure(run.id, "waiting comment", async () => {
        if (await deps.firstNoticeAt(run.id, "waiting_comment")) return;
        await deps.postComment({ run, issueId, kind: "waiting", body: waitingBody(run.id, target, decision) });
      });
    }
    return true;
  }

  deps.scheduleCancel(run.id, `${expiredReason} (${decision.detail})`);
  await logFailure(run.id, "expired marker", () => deps.recordNotice({ run, issueId, kind: "expired", details }));
  if (issueId) {
    await logFailure(run.id, "block issue", () => deps.blockIssue(issueId));
    await logFailure(run.id, "expired comment", () =>
      deps.postComment({ run, issueId, kind: "expired", body: expiredBody(run.id, target, decision.detail) }),
    );
  }
  return true;
}

async function logFailure(runId: string, what: string, action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (err) {
    logger.warn({ err, runId }, `crew-load-gate: ${what} failed; the run stays held`);
  }
}

const probeCache = createProbeCache(LOAD_GATE_PROBE_TTL_MS);

export function defaultBeforeClaimDeps(db: Db): BeforeClaimDeps {
  return {
    async loadTarget(run) {
      const [agent] = await db
        .select({ defaultEnvironmentId: agents.defaultEnvironmentId })
        .from(agents)
        .where(eq(agents.id, run.agentId))
        .limit(1);
      if (!agent?.defaultEnvironmentId) return null;
      const environment = await environmentService(db).getById(agent.defaultEnvironmentId);
      if (!environment || environment.driver !== "ssh" || environment.status !== "active") return null;
      const settings = readLoadGateSettings(environment.metadata as Record<string, unknown> | null);
      if (!settings) return null;
      return { environmentId: environment.id, environmentName: environment.name, settings };
    },
    probeHost(environmentId, run) {
      return probeCache.get(environmentId, async () => {
        try {
          const environment = await environmentService(db).getById(environmentId);
          if (!environment) return { ok: false, error: "environment not found" };
          const parsed = await resolveEnvironmentDriverConfigForRuntime(db, run.companyId, environment, {
            heartbeatRunId: run.id,
          });
          if (parsed.driver !== "ssh") return { ok: false, error: "not an ssh environment" };
          const result = await runSshCommand(parsed.config, "sysctl -n vm.loadavg", {
            timeoutMs: LOAD_GATE_PROBE_TIMEOUT_MS,
          });
          const load1 = parseLoadAvg(result.stdout);
          return load1 === null ? { ok: false, error: "cannot parse vm.loadavg" } : { ok: true, load1 };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      });
    },
    async firstNoticeAt(runId, kind) {
      const [row] = await db
        .select({ createdAt: activityLog.createdAt })
        .from(activityLog)
        .where(and(eq(activityLog.runId, runId), eq(activityLog.action, `crew.load_gate.${kind}`)))
        .orderBy(asc(activityLog.createdAt))
        .limit(1);
      return row?.createdAt ?? null;
    },
    async recordNotice(notice) {
      await logActivity(db, {
        companyId: notice.run.companyId,
        actorType: "system",
        actorId: "crew",
        action: `crew.load_gate.${notice.kind}`,
        entityType: "heartbeat_run",
        entityId: notice.run.id,
        agentId: notice.run.agentId,
        runId: notice.run.id,
        issueId: notice.issueId,
        details: notice.details,
      });
    },
    async postComment(notice) {
      await issueService(db).addComment(notice.issueId, notice.body, {}, { authorType: "system" });
      await logActivity(db, {
        companyId: notice.run.companyId,
        actorType: "system",
        actorId: "crew",
        action: `crew.load_gate.${notice.kind}_comment`,
        entityType: "heartbeat_run",
        entityId: notice.run.id,
        agentId: notice.run.agentId,
        runId: notice.run.id,
        issueId: notice.issueId,
        details: {},
      });
    },
    scheduleCancel(runId, reason) {
      setImmediate(() => {
        void import("../services/heartbeat.js")
          .then(({ heartbeatService }) => heartbeatService(db).cancelRun(runId, reason))
          .catch((err) => logger.warn({ err, runId }, "crew-load-gate: cancelling an expired run failed; retried next tick"));
      });
    },
    async blockIssue(issueId) {
      await issueService(db).update(issueId, { status: "blocked" });
    },
    now: () => new Date(),
    async retryChecked(runId) {
      const [row] = await db
        .select({ id: activityLog.id })
        .from(activityLog)
        .where(and(eq(activityLog.runId, runId), eq(activityLog.action, "crew.retry_progress.checked")))
        .limit(1);
      return Boolean(row);
    },
    checkRetryProgress: createRetryProgressChecker(db),
    async recordRetryProgress(run, issueId, progress) {
      if (progress.kind === "checked" && progress.commits.length > 0 && issueId) {
        await issueService(db).addComment(issueId, retryProgressComment(progress), {}, { authorType: "system" });
      }
      await logActivity(db, {
        companyId: run.companyId,
        actorType: "system",
        actorId: "crew",
        action: "crew.retry_progress.checked",
        entityType: "heartbeat_run",
        entityId: run.id,
        agentId: run.agentId,
        runId: run.id,
        issueId,
        details:
          progress.kind === "checked"
            ? { previousRunId: progress.previousRunId, cwd: progress.cwd, commits: progress.commits.map((c) => c.sha) }
            : { previousRunId: run.retryOfRunId, skipped: true },
      });
    },
  };
}

export async function crewBeforeClaim(input: BeforeClaimInput): Promise<boolean> {
  try {
    return await evaluateBeforeClaim(input, defaultBeforeClaimDeps(input.db));
  } catch (err) {
    logger.warn({ err, runId: input.run.id }, "crew-load-gate: failed open, run may be claimed");
    return false;
  }
}

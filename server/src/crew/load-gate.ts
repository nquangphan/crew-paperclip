import { and, asc, eq } from "drizzle-orm";
import { activityLog, agents, type Db, type heartbeatRuns } from "@paperclipai/db";
import { runSshCommand } from "@paperclipai/adapter-utils/ssh";
import { logger } from "../middleware/logger.js";
import { logActivity } from "../services/activity-log.js";
import { resolveEnvironmentDriverConfigForRuntime } from "../services/environment-config.js";
import { environmentService } from "../services/environments.js";
import { issueService } from "../services/issues.js";

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

export interface BeforeClaimDeps {
  loadTarget(run: BeforeClaimInput["run"]): Promise<{
    environmentId: string;
    environmentName: string;
    settings: LoadGateSettings;
  } | null>;
  probeHost(environmentId: string, run: BeforeClaimInput["run"]): Promise<HostProbe>;
  /** Time of the first notice of this kind for the run (persisted, survives restarts), or null. */
  firstNoticeAt(runId: string, kind: "waiting" | "expired"): Promise<Date | null>;
  postNotice(notice: {
    run: BeforeClaimInput["run"];
    issueId: string | null;
    kind: "waiting" | "expired";
    body: string;
    details: Record<string, unknown>;
  }): Promise<void>;
  /**
   * Cancels the run after the current claim has returned. claimQueuedRun runs under the agent start
   * lock and cancelling re-enters that lock, so the cancel must not be awaited from inside the hook.
   * Failures are only logged; the gate stays closed for the run either way.
   */
  scheduleCancel(runId: string, reason: string): void;
  blockIssue(issueId: string): Promise<void>;
  now(): Date;
}

function readIssueId(contextSnapshot: unknown): string | null {
  if (!contextSnapshot || typeof contextSnapshot !== "object") return null;
  const value = (contextSnapshot as Record<string, unknown>).issueId;
  return typeof value === "string" && value.length > 0 ? value : null;
}

export async function evaluateBeforeClaim(input: BeforeClaimInput, deps: BeforeClaimDeps): Promise<boolean> {
  const { run } = input;
  if (run.status !== "queued") return false;
  const target = await deps.loadTarget(run);
  if (!target) return false;
  const expiredReason = `Crew: hết ${target.settings.maxWaitMinutes} phút chờ máy ${target.environmentName}`;

  // Once the wait expired the run is on its way out: keep it queued and retry the cancel.
  if (await deps.firstNoticeAt(run.id, "expired")) {
    deps.scheduleCancel(run.id, expiredReason);
    return true;
  }

  const probe = await deps.probeHost(target.environmentId, run);
  const now = deps.now();
  const waitingSince = (await deps.firstNoticeAt(run.id, "waiting")) ?? null;
  const decision = decideGate({ settings: target.settings, probe, waitingSince: waitingSince ?? now, now });
  if (decision.action === "claim") return false;

  const issueId = readIssueId(run.contextSnapshot);
  const details = { environmentId: target.environmentId, reason: decision.reason, detail: decision.detail };

  // From here on the run is held: a failed notice or issue update is logged, never a reason to open the gate.
  if (decision.action === "wait") {
    if (!waitingSince) {
      await logFailure(run.id, "waiting notice", () => deps.postNotice({
        run,
        issueId,
        kind: "waiting",
        body:
          `Run \`${run.id}\` đang chờ máy \`${target.environmentName}\`: ${decision.detail}. ` +
          `Run sẽ tự chạy khi máy ổn. Nếu tới ${TIME_FORMAT.format(decision.deadline)} vẫn chưa chạy được, ` +
          "Crew sẽ hủy run và chuyển issue sang `blocked`.",
        details: { ...details, deadline: decision.deadline.toISOString() },
      }));
    }
    return true;
  }

  deps.scheduleCancel(run.id, `${expiredReason} (${decision.detail})`);
  if (issueId) await logFailure(run.id, "block issue", () => deps.blockIssue(issueId));
  await logFailure(run.id, "expired notice", () => deps.postNotice({
    run,
    issueId,
    kind: "expired",
    body:
      `Run \`${run.id}\` đã chờ máy \`${target.environmentName}\` quá ${target.settings.maxWaitMinutes} phút ` +
      `(${decision.detail}). Crew hủy run và chuyển issue sang \`blocked\`. ` +
      "Kiểm máy bằng `crew-mac doctor`, rồi chuyển issue về `todo` để chạy lại.",
    details,
  }));
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
    async postNotice(notice) {
      // Comment first: the activity row is what marks the notice as done, so a failed comment is retried.
      if (notice.issueId) {
        await issueService(db).addComment(notice.issueId, notice.body, {}, { authorType: "system" });
      }
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

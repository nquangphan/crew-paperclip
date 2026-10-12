import { and, asc, desc, eq, gte, inArray, isNull, lte, notInArray, or, sql } from "drizzle-orm";
import { activityLog, agentWakeupRequests, type Db, heartbeatRuns, issues } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";
import { logActivity } from "../services/activity-log.js";
import { getExecutionBlocker } from "../services/execution-blocker.js";

/**
 * Replays wakes stock skipped because the previous run of the issue still held its environment lease.
 *
 * On a stage handoff the route cancels the executor's run and wakes the next participant at once,
 * but the run's lease is only released when executeRun unwinds. The participant's wake meets
 * getConversationOwnershipBlocker ("has not released its environment lease"), is recorded as
 * `skipped` / `execution_reconciliation_required`, and stock never retries a system wake.
 *
 * Two entry points:
 * - `rewakeAfterLeaseRelease`, called right after Crew released the lease in the SSH release hook (H3), so the
 *   replay is ordered after the release, not timed;
 * - `replayStrandedSkippedWakes`, run on every heartbeat scheduler tick (core patch C10). The lease is not always
 *   released through H3: when the run's lease is older than the reaper's staleness, the reaper tick can move it to
 *   `pending_cleanup` (orphaned active lease of a terminal run) and release it through the SSH cleanup retry (P8)
 *   while executeRun is still unwinding; executeRun then finds no active lease and H3 never runs (TPS-133). Stock
 *   review recovery does not cover it either: it only retries a review participant whose own run ended.
 */
export const HANDOFF_REWAKE_ACTION = "crew.handoff_rewake";
export const HANDOFF_REWAKE_FAILED_ACTION = "crew.handoff_rewake.failed";
/** Issue states a person or the policy set on purpose; no replay into them. */
const NO_REWAKE_ISSUE_STATUSES = ["done", "cancelled", "blocked"];
const SKIPPED_REASON = "execution_reconciliation_required";
/** The sweep leaves fresh skips to the H3 replay, which settles them within seconds of the release. */
export const HANDOFF_REWAKE_SWEEP_MIN_AGE_MS = 60_000;
/** Older skips are history, not a stalled handoff. */
export const HANDOFF_REWAKE_SWEEP_LOOKBACK_MS = 7 * 24 * 60 * 60_000;
const HANDOFF_REWAKE_SWEEP_PAGE_SIZE = 50;

type WakeRow = typeof agentWakeupRequests.$inferSelect;

/** Wake reason the route used, recovered from the stored payload (the skip overwrote `reason`). */
export function replayedWakeReason(wake: Pick<WakeRow, "source" | "payload">): string {
  const stage = (wake.payload as Record<string, unknown> | null)?.executionStage as Record<string, unknown> | undefined;
  if (stage?.wakeRole === "reviewer") return "execution_review_requested";
  if (stage?.wakeRole === "approver") return "execution_approval_requested";
  if (stage?.wakeRole === "executor") return "execution_changes_requested";
  return wake.source === "assignment" ? "issue_assigned" : "crew_handoff_rewake";
}

export interface HandoffRewakeInput {
  db: Db;
  companyId: string;
  /** The run whose lease was just released. */
  runId: string;
  issueId: string | null;
}

type HeartbeatWakeupOptions = NonNullable<Parameters<ReturnType<typeof import("../services/heartbeat.js")["heartbeatService"]>["wakeup"]>[1]>;
export type WakeupFn = (agentId: string, opts: HeartbeatWakeupOptions) => Promise<unknown>;

/** Stock wakeup (imported lazily: heartbeat imports the Crew hooks). */
function stockWakeup(db: Db): WakeupFn {
  return async (agentId, opts) => {
    const { heartbeatService } = await import("../services/heartbeat.js");
    return heartbeatService(db).wakeup(agentId, opts);
  };
}

/** Skipped wakes being replayed in this process; the H3 replay and the sweep never replay the same wake twice. */
const replaying = new Set<string>();

interface ReplayInput {
  db: Db;
  companyId: string;
  issueId: string;
  skipped: WakeRow;
  /** The run whose lease release triggered the replay; null for the sweep. */
  previousRunId: string | null;
  source: "lease_release" | "sweep";
}

/**
 * Replays one skipped wake for its agent once: no earlier replay marker, no queued or running work of the agent on
 * the issue, and no execution blocker left on the issue. Returns 1 when stock accepted the wake. Never throws.
 */
async function replaySkippedWake(input: ReplayInput, wakeup?: WakeupFn): Promise<number> {
  const { db, companyId, issueId, skipped, previousRunId, source } = input;
  const agentId = skipped.agentId;
  if (replaying.has(skipped.id)) return 0;
  replaying.add(skipped.id);
  try {
    const [done] = await db
      .select({ id: activityLog.id })
      .from(activityLog)
      .where(
        and(
          eq(activityLog.companyId, companyId),
          eq(activityLog.entityType, "agent_wakeup_request"),
          eq(activityLog.entityId, skipped.id),
          eq(activityLog.action, HANDOFF_REWAKE_ACTION),
        ),
      )
      .limit(1);
    if (done) return 0;

    // The agent already has work on this issue: nothing was lost.
    const [active] = await db
      .select({ id: heartbeatRuns.id })
      .from(heartbeatRuns)
      .where(
        and(
          eq(heartbeatRuns.companyId, companyId),
          eq(heartbeatRuns.agentId, agentId),
          inArray(heartbeatRuns.status, ["queued", "running", "scheduled_retry"]),
          or(eq(heartbeatRuns.nativeIssueId, issueId), sql`${heartbeatRuns.contextSnapshot}->>'issueId' = ${issueId}`),
        ),
      )
      .limit(1);
    if (active) return 0;

    // Only replay when the hold that skipped it is gone (the released lease was the only owner).
    if (await getExecutionBlocker(db, companyId, issueId)) return 0;

    const reason = replayedWakeReason(skipped);
    const payload = { ...((skipped.payload as Record<string, unknown> | null) ?? {}) };
    delete payload.executionWait;
    const marker = { skippedWakeId: skipped.id, previousRunId, source };
    const activity = (action: string, details: Record<string, unknown>) =>
      logActivity(db, {
        companyId,
        actorType: "system",
        actorId: "crew",
        action,
        entityType: "agent_wakeup_request",
        entityId: skipped.id,
        agentId,
        runId: previousRunId,
        issueId,
        details: { ...marker, reason, ...details },
      });
    // The marker is written only after the wake was accepted: a failed replay leaves no marker, so the
    // next release of a lease for this issue, or the next sweep, tries again.
    try {
      await (wakeup ?? stockWakeup(db))(agentId, {
        source: skipped.source as HeartbeatWakeupOptions["source"],
        triggerDetail: (skipped.triggerDetail ?? "system") as HeartbeatWakeupOptions["triggerDetail"],
        reason,
        payload: { ...payload, issueId, crewHandoffRewake: marker },
        requestedByActorType: (skipped.requestedByActorType ?? "system") as HeartbeatWakeupOptions["requestedByActorType"],
        requestedByActorId: skipped.requestedByActorId ?? "crew",
        contextSnapshot: {
          issueId,
          taskId: issueId,
          wakeReason: reason,
          source: "crew.handoff_rewake",
          ...(payload.executionStage ? { executionStage: payload.executionStage } : {}),
          crewHandoffRewake: marker,
        },
      });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.warn({ err, previousRunId, skippedWakeId: skipped.id }, "crew: replaying a skipped wake failed; retried later");
      await activity(HANDOFF_REWAKE_FAILED_ACTION, { error: error.slice(0, 300) }).catch(() => undefined);
      return 0;
    }
    await activity(HANDOFF_REWAKE_ACTION, {});
    return 1;
  } finally {
    replaying.delete(skipped.id);
  }
}

/** Returns the number of wakes replayed. Never throws. */
export async function rewakeAfterLeaseRelease(input: HandoffRewakeInput, wakeup?: WakeupFn): Promise<number> {
  const { db, companyId, runId } = input;
  try {
    const [run] = await db
      .select({ issueId: heartbeatRuns.nativeIssueId, context: heartbeatRuns.contextSnapshot, createdAt: heartbeatRuns.createdAt, agentId: heartbeatRuns.agentId })
      .from(heartbeatRuns)
      .where(and(eq(heartbeatRuns.id, runId), eq(heartbeatRuns.companyId, companyId)))
      .limit(1);
    if (!run) return 0;
    const contextIssueId = typeof run.context?.issueId === "string" ? run.context.issueId : null;
    const issueId = input.issueId ?? run.issueId ?? contextIssueId;
    if (!issueId) return 0;

    const [issue] = await db
      .select({ status: issues.status, assigneeAgentId: issues.assigneeAgentId })
      .from(issues)
      .where(and(eq(issues.id, issueId), eq(issues.companyId, companyId)))
      .limit(1);
    const assignee = issue?.assigneeAgentId ?? null;
    if (!issue || !assignee || assignee === run.agentId || NO_REWAKE_ISSUE_STATUSES.includes(issue.status)) return 0;

    // The latest wake for the current assignee that stock skipped while this run was the owner.
    const [skipped] = await db
      .select()
      .from(agentWakeupRequests)
      .where(
        and(
          eq(agentWakeupRequests.companyId, companyId),
          eq(agentWakeupRequests.agentId, assignee),
          eq(agentWakeupRequests.status, "skipped"),
          eq(agentWakeupRequests.reason, SKIPPED_REASON),
          sql`${agentWakeupRequests.payload}->>'issueId' = ${issueId}`,
          gte(agentWakeupRequests.createdAt, run.createdAt),
        ),
      )
      .orderBy(desc(agentWakeupRequests.createdAt))
      .limit(1);
    if (!skipped) return 0;

    return await replaySkippedWake({ db, companyId, issueId, skipped, previousRunId: runId, source: "lease_release" }, wakeup);
  } catch (err) {
    logger.warn({ err, runId }, "crew: replaying a wake skipped while the lease was held failed");
    return 0;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * A stage wake still matches the issue only while that stage is pending with the woken agent as its participant.
 * Wakes without an execution stage (plain assignment) only need the assignee check done by the query.
 */
export function stageWakeStillCurrent(payload: unknown, executionState: unknown, agentId: string): boolean {
  const stage = record(record(payload)?.executionStage);
  if (!stage) return true;
  const state = record(executionState);
  if (state?.status !== "pending") return false;
  if (record(state.currentParticipant)?.agentId !== agentId) return false;
  return typeof stage.stageId !== "string" || stage.stageId === state.currentStageId;
}

/**
 * Scheduler-tick fallback for skips the H3 replay never saw. Replays, at most once each, the latest wake that stock
 * skipped as `execution_reconciliation_required` for an issue's current assignee when:
 * - the skip came from the execution-owner hold (`executionWait.recoveryActionId` is null; skips held by a recovery
 *   action are delivered by stock recovery), is older than HANDOFF_REWAKE_SWEEP_MIN_AGE_MS and younger than
 *   HANDOFF_REWAKE_SWEEP_LOOKBACK_MS;
 * - the issue is visible and not done, cancelled or blocked, and a stage wake still matches the pending stage;
 * - the agent got no wake and no run on the issue since the skip;
 * - and, checked by the replay itself, the issue has no execution blocker left.
 * Issues that stalled before this sweep existed (TPS-133) recover on its first tick. Returns the number of wakes
 * replayed. Never throws.
 */
export async function replayStrandedSkippedWakes(db: Db, opts: { wakeup?: WakeupFn; now?: Date } = {}): Promise<number> {
  const now = opts.now ?? new Date();
  let replayed = 0;
  try {
    const later = sql`exists (
      select 1 from ${agentWakeupRequests} as later
      where later.company_id = ${agentWakeupRequests.companyId}
        and later.agent_id = ${agentWakeupRequests.agentId}
        and later.payload->>'issueId' = ${agentWakeupRequests.payload}->>'issueId'
        and later.created_at > ${agentWakeupRequests.createdAt}
    )`;
    const ranSince = sql`exists (
      select 1 from ${heartbeatRuns}
      where ${heartbeatRuns.companyId} = ${agentWakeupRequests.companyId}
        and ${heartbeatRuns.agentId} = ${agentWakeupRequests.agentId}
        and coalesce(${heartbeatRuns.nativeIssueId}::text, ${heartbeatRuns.contextSnapshot}->>'issueId') = ${agentWakeupRequests.payload}->>'issueId'
        and ${heartbeatRuns.createdAt} > ${agentWakeupRequests.createdAt}
    )`;
    const replayedBefore = sql`exists (
      select 1 from ${activityLog}
      where ${activityLog.companyId} = ${agentWakeupRequests.companyId}
        and ${activityLog.entityType} = 'agent_wakeup_request'
        and ${activityLog.entityId} = ${agentWakeupRequests.id}::text
        and ${activityLog.action} = ${HANDOFF_REWAKE_ACTION}
    )`;
    const rows = await db
      .select({ wake: agentWakeupRequests, issueId: issues.id, executionState: issues.executionState })
      .from(agentWakeupRequests)
      .innerJoin(
        issues,
        and(
          eq(issues.companyId, agentWakeupRequests.companyId),
          sql`${issues.id}::text = ${agentWakeupRequests.payload}->>'issueId'`,
          eq(issues.assigneeAgentId, agentWakeupRequests.agentId),
        ),
      )
      .where(
        and(
          eq(agentWakeupRequests.status, "skipped"),
          eq(agentWakeupRequests.reason, SKIPPED_REASON),
          sql`${agentWakeupRequests.payload}->'executionWait'->>'recoveryActionId' is null`,
          gte(agentWakeupRequests.createdAt, new Date(now.getTime() - HANDOFF_REWAKE_SWEEP_LOOKBACK_MS)),
          lte(agentWakeupRequests.createdAt, new Date(now.getTime() - HANDOFF_REWAKE_SWEEP_MIN_AGE_MS)),
          notInArray(issues.status, NO_REWAKE_ISSUE_STATUSES),
          isNull(issues.hiddenAt),
          sql`not ${later}`,
          sql`not ${ranSince}`,
          sql`not ${replayedBefore}`,
        ),
      )
      .orderBy(asc(agentWakeupRequests.createdAt))
      .limit(HANDOFF_REWAKE_SWEEP_PAGE_SIZE);

    for (const { wake, issueId, executionState } of rows) {
      if (!stageWakeStillCurrent(wake.payload, executionState, wake.agentId)) continue;
      try {
        const count = await replaySkippedWake(
          { db, companyId: wake.companyId, issueId, skipped: wake, previousRunId: null, source: "sweep" },
          opts.wakeup,
        );
        if (count > 0) logger.info({ issueId, agentId: wake.agentId, skippedWakeId: wake.id }, "crew: replayed a stranded skipped wake");
        replayed += count;
      } catch (err) {
        logger.warn({ err, skippedWakeId: wake.id }, "crew: replaying a stranded skipped wake failed");
      }
    }
  } catch (err) {
    logger.warn({ err }, "crew: sweep of stranded skipped wakes failed");
  }
  return replayed;
}

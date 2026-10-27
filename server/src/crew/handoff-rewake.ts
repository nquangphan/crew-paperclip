import { and, asc, desc, eq, gte, inArray, isNull, lte, notInArray, or, sql } from "drizzle-orm";
import {
  activityLog, agentWakeupRequests, type Db, environmentLeases, heartbeatRuns, issueRecoveryActions, issues,
} from "@paperclipai/db";
import { logger } from "../middleware/logger.js";
import { type ActivityPublication, logActivity, publishActivity } from "../services/activity-log.js";
import { executionBlockerPredicate, getExecutionBlocker } from "../services/execution-blocker.js";
import { legacyRunNeverLaunched } from "./remote-termination.js";

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
  const payload = wake.payload as Record<string, unknown> | null;
  const stage = payload?.executionStage as Record<string, unknown> | undefined;
  if (stage?.wakeRole === "reviewer") return "execution_review_requested";
  if (stage?.wakeRole === "approver") return "execution_approval_requested";
  if (stage?.wakeRole === "executor") return "execution_changes_requested";
  // Dependency wakes (stock route, finalize backstop and periodic backstop) keep their own payload shape.
  if (payload?.resolvedBlockerIssueId !== undefined) return "issue_blockers_resolved";
  if (payload?.completedChildIssueId !== undefined) return "issue_children_completed";
  return wake.source === "assignment" ? "issue_assigned" : "crew_handoff_rewake";
}

/** Payload fields of a dependency wake that stock also carries in the run context. */
const DEPENDENCY_CONTEXT_KEYS = [
  "resolvedBlockerIssueId", "blockerIssueIds", "completedChildIssueId", "childIssueIds", "childIssueSummaries",
  "childIssueSummaryTruncated",
] as const;

/**
 * Idempotency key the skipped dependency wake asked for (kept by the skip under `executionWait`). Reusing it lets the
 * stock dependency backstop see the ready state as delivered and not wake the agent a second time.
 */
function replayedIdempotencyKey(payload: Record<string, unknown>): string | undefined {
  const key = (payload.executionWait as Record<string, unknown> | undefined)?.requestedIdempotencyKey;
  return typeof key === "string" && /^(issue_blockers_resolved|issue_children_completed):/.test(key) ? key : undefined;
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
    const idempotencyKey = replayedIdempotencyKey(payload);
    delete payload.executionWait;
    const dependencyContext = Object.fromEntries(
      DEPENDENCY_CONTEXT_KEYS.filter((key) => payload[key] !== undefined).map((key) => [key, payload[key]]),
    );
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
        ...(idempotencyKey ? { idempotencyKey } : {}),
        requestedByActorType: (skipped.requestedByActorType ?? "system") as HeartbeatWakeupOptions["requestedByActorType"],
        requestedByActorId: skipped.requestedByActorId ?? "crew",
        contextSnapshot: {
          issueId,
          taskId: issueId,
          wakeReason: reason,
          source: "crew.handoff_rewake",
          ...dependencyContext,
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

export const RECOVERY_HOLD_RELEASED_ACTION = "crew.recovery_hold_released";
const LEGACY_RECOVERY_CAUSE = "legacy_execution_requires_reconciliation";
/** Cancellation codes stock writes inside the dispatch gate, right before the adapter would be called. */
const PRE_DISPATCH_HOLD_CODES = ["legacy_disposition_repair_suppressed"];
const RECOVERY_HOLD_RELEASE_PAGE_SIZE = 25;
const RECOVERY_HOLD_RELEASE_NOTE =
  "Run sửa disposition bị chặn trước khi gọi adapter, không có hành động nào cần đối soát. Crew gỡ giữ chỗ.";

/**
 * Releases the execution hold stock puts on an issue for a run that never reached its adapter.
 *
 * Stock disposition repair queues a repair run when an agent's run ends without recording a disposition. When the
 * disposition is recorded meanwhile (typically: the repair itself moved the issue to `blocked` behind its children),
 * the dispatch gate cancels that run with `legacy_disposition_repair_suppressed` just before the adapter call. The
 * cancellation goes through `terminalizeLegacyExecution`, which treats it like a failed provider attempt: it opens a
 * `legacy_execution_requires_reconciliation` recovery action, and the automatic disposition then settles it as a
 * permanent no-replay hold. Every later system wake of the issue is skipped (`execution_reconciliation_required`),
 * including the dependency wake when the last child is done; only a user comment ever cleared it (TPS-508, TPS-495,
 * TPS-264).
 *
 * The hold protects actions with unverified outcomes; a run that never invoked its adapter has none. This settles the
 * hold the way stock settles an interrupted bootstrap that never started a provider (`settleInterruptedNativeBootstrap`):
 * the action becomes `resolved` / `false_positive` with `automaticRecovery.replay = "allowed"`, and the run carries
 * `executionRecovery.providerWorkStarted = false`, so stock's periodic checks never open the hold again. Only when:
 * - the action is a live hold (`executionBlockerPredicate`) of cause `legacy_execution_requires_reconciliation`, with no
 *   operator reconciliation and no unsafe-workspace evidence, on an issue that is not done or cancelled;
 * - its run is the issue's, was cancelled by the dispatch gate (PRE_DISPATCH_HOLD_CODES), and `legacyRunNeverLaunched`
 *   proves no adapter process was started; and none of its leases is still unreleased.
 * The issue status, its blockers and every other hold stay as they are. Returns the number of holds released. Never
 * throws.
 */
export async function releaseNeverLaunchedRecoveryHolds(db: Db, now = new Date()): Promise<number> {
  let released = 0;
  try {
    const rows = await db
      .select({ action: issueRecoveryActions, runId: heartbeatRuns.id, agentId: heartbeatRuns.agentId, errorCode: heartbeatRuns.errorCode })
      .from(issueRecoveryActions)
      .innerJoin(issues, and(eq(issues.companyId, issueRecoveryActions.companyId), eq(issues.id, issueRecoveryActions.sourceIssueId)))
      .innerJoin(
        heartbeatRuns,
        and(
          eq(heartbeatRuns.companyId, issueRecoveryActions.companyId),
          sql`${heartbeatRuns.id}::text = ${issueRecoveryActions.evidence}->>'runId'`,
          sql`coalesce(${heartbeatRuns.nativeIssueId}::text, ${heartbeatRuns.contextSnapshot}->>'issueId') = ${issueRecoveryActions.sourceIssueId}::text`,
        ),
      )
      .where(
        and(
          eq(issueRecoveryActions.cause, LEGACY_RECOVERY_CAUSE),
          executionBlockerPredicate(),
          sql`not (${issueRecoveryActions.evidence} ? 'executionReconciliation')`,
          sql`coalesce(${issueRecoveryActions.evidence}->>'workspaceRestoreFailure', '') = ''`,
          inArray(heartbeatRuns.errorCode, PRE_DISPATCH_HOLD_CODES),
          notInArray(issues.status, ["done", "cancelled"]),
        ),
      )
      .orderBy(asc(issueRecoveryActions.createdAt))
      .limit(RECOVERY_HOLD_RELEASE_PAGE_SIZE);

    for (const { action, runId, agentId, errorCode } of rows) {
      try {
        if (!(await legacyRunNeverLaunched(db, action.companyId, runId))) continue;
        const [heldLease] = await db
          .select({ id: environmentLeases.id })
          .from(environmentLeases)
          .where(and(eq(environmentLeases.companyId, action.companyId), eq(environmentLeases.heartbeatRunId, runId), isNull(environmentLeases.releasedAt)))
          .limit(1);
        if (heldLease) continue;

        const release = { runId, proof: "never_started", originalFailureCode: errorCode, releasedAt: now.toISOString() };
        const publications: ActivityPublication[] = [];
        const done = await db.transaction(async (tx) => {
          // Fenced on the hold still being live: a concurrent user continuation or reconciliation wins.
          const [updated] = await tx
            .update(issueRecoveryActions)
            .set({
              status: "resolved",
              outcome: "false_positive",
              resolvedAt: now,
              updatedAt: now,
              nextAction: RECOVERY_HOLD_RELEASE_NOTE,
              resolutionNote: RECOVERY_HOLD_RELEASE_NOTE,
              wakePolicy: null,
              monitorPolicy: null,
              evidence: sql`jsonb_set(${issueRecoveryActions.evidence}, '{automaticRecovery,replay}', '"allowed"'::jsonb, false)
                || ${JSON.stringify({ crewRecoveryHoldRelease: release })}::jsonb`,
            })
            .where(and(eq(issueRecoveryActions.id, action.id), eq(issueRecoveryActions.companyId, action.companyId), executionBlockerPredicate()))
            .returning({ id: issueRecoveryActions.id });
          if (!updated) return false;
          await tx
            .update(heartbeatRuns)
            .set({
              resultJson: sql`coalesce(${heartbeatRuns.resultJson}, '{}'::jsonb) || ${JSON.stringify({
                executionRecovery: { kind: "bootstrap", providerWorkStarted: false, crewProof: "never_started" },
              })}::jsonb`,
              updatedAt: now,
            })
            .where(and(eq(heartbeatRuns.id, runId), eq(heartbeatRuns.companyId, action.companyId)));
          await logActivity(tx as unknown as Db, {
            companyId: action.companyId,
            actorType: "system",
            actorId: "crew",
            action: RECOVERY_HOLD_RELEASED_ACTION,
            entityType: "issue",
            entityId: action.sourceIssueId,
            agentId,
            runId,
            details: { recoveryActionId: action.id, ...release },
          }, publications);
          return true;
        });
        if (!done) continue;
        publications.forEach(publishActivity);
        logger.info({ issueId: action.sourceIssueId, recoveryActionId: action.id, runId }, "crew: released the recovery hold of a run that never launched");
        released += 1;
      } catch (err) {
        logger.warn({ err, recoveryActionId: action.id }, "crew: releasing a recovery hold failed; retried next tick");
      }
    }
  } catch (err) {
    logger.warn({ err }, "crew: sweep of recovery holds from never-launched runs failed");
  }
  return released;
}

/**
 * A `blocked` issue is only woken again when stock itself would wake it: it still has blockers and every one is
 * resolved (stock dependency readiness, so cancelled blockers and unfinished workspace finalization keep it waiting).
 * An issue blocked by hand, without blockers, waits for its owner.
 */
async function blockedIssueReady(db: Db, companyId: string, issueId: string): Promise<boolean> {
  const { issueService } = await import("../services/issues.js");
  const readiness = (await issueService(db).listDependencyReadiness(companyId, [issueId])).get(issueId);
  return Boolean(readiness?.isDependencyReady && readiness.blockerIssueIds.length > 0);
}

/**
 * Scheduler-tick fallback for skips the H3 replay never saw. First releases recovery holds of runs that never
 * launched (`releaseNeverLaunchedRecoveryHolds`). Then replays, at most once each, the latest wake that stock skipped
 * as `execution_reconciliation_required` for an issue's current assignee when:
 * - the skip came from the execution-owner hold (`executionWait.recoveryActionId` is null), or from a recovery hold
 *   this sweep released (skips held by any other recovery action are delivered by stock recovery);
 * - the skip is older than HANDOFF_REWAKE_SWEEP_MIN_AGE_MS and younger than HANDOFF_REWAKE_SWEEP_LOOKBACK_MS;
 * - the issue is visible and not done or cancelled, a stage wake still matches the pending stage, and the issue is not
 *   `blocked` — except, for a released hold, a `blocked` issue whose blockers are all resolved (`blockedIssueReady`);
 * - the agent got no wake and no run on the issue since the skip;
 * - and, checked by the replay itself, the issue has no execution blocker left.
 * Issues that stalled before this sweep existed (TPS-133) recover on its first tick. Returns the number of wakes
 * replayed. Never throws.
 */
export async function replayStrandedSkippedWakes(db: Db, opts: { wakeup?: WakeupFn; now?: Date } = {}): Promise<number> {
  const now = opts.now ?? new Date();
  let replayed = 0;
  await releaseNeverLaunchedRecoveryHolds(db, now);
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
    const heldRecoveryActionId = sql`${agentWakeupRequests.payload}->'executionWait'->>'recoveryActionId'`;
    const holdReleasedByCrew = sql`exists (
      select 1 from ${issueRecoveryActions}
      where ${issueRecoveryActions.companyId} = ${agentWakeupRequests.companyId}
        and ${issueRecoveryActions.id}::text = ${heldRecoveryActionId}
        and ${issueRecoveryActions.evidence} ? 'crewRecoveryHoldRelease'
    )`;
    const rows = await db
      .select({ wake: agentWakeupRequests, issueId: issues.id, issueStatus: issues.status, executionState: issues.executionState })
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
          or(sql`${heldRecoveryActionId} is null`, holdReleasedByCrew),
          gte(agentWakeupRequests.createdAt, new Date(now.getTime() - HANDOFF_REWAKE_SWEEP_LOOKBACK_MS)),
          lte(agentWakeupRequests.createdAt, new Date(now.getTime() - HANDOFF_REWAKE_SWEEP_MIN_AGE_MS)),
          notInArray(issues.status, ["done", "cancelled"]),
          or(sql`${issues.status} <> 'blocked'`, and(sql`${heldRecoveryActionId} is not null`, holdReleasedByCrew)),
          isNull(issues.hiddenAt),
          sql`not ${later}`,
          sql`not ${ranSince}`,
          sql`not ${replayedBefore}`,
        ),
      )
      .orderBy(asc(agentWakeupRequests.createdAt))
      .limit(HANDOFF_REWAKE_SWEEP_PAGE_SIZE);

    for (const { wake, issueId, issueStatus, executionState } of rows) {
      if (!stageWakeStillCurrent(wake.payload, executionState, wake.agentId)) continue;
      try {
        if (issueStatus === "blocked" && !(await blockedIssueReady(db, wake.companyId, issueId))) continue;
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

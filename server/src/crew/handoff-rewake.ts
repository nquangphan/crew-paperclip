import { and, desc, eq, gte, inArray, or, sql } from "drizzle-orm";
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
 * `skipped` / `execution_reconciliation_required`, and stock never retries a system wake. Called
 * right after Crew released the lease, so the replay is ordered after the release, not timed.
 */
export const HANDOFF_REWAKE_ACTION = "crew.handoff_rewake";
/** Issue states a person or the policy set on purpose; no replay into them. */
const NO_REWAKE_ISSUE_STATUSES = ["done", "cancelled", "blocked"];
const SKIPPED_REASON = "execution_reconciliation_required";

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

    // The assignee already has work on this issue: nothing was lost.
    const [active] = await db
      .select({ id: heartbeatRuns.id })
      .from(heartbeatRuns)
      .where(
        and(
          eq(heartbeatRuns.companyId, companyId),
          eq(heartbeatRuns.agentId, assignee),
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
    const marker = { skippedWakeId: skipped.id, previousRunId: runId };
    await logActivity(db, {
      companyId,
      actorType: "system",
      actorId: "crew",
      action: HANDOFF_REWAKE_ACTION,
      entityType: "agent_wakeup_request",
      entityId: skipped.id,
      agentId: assignee,
      runId,
      issueId,
      details: { ...marker, reason },
    });
    await (wakeup ?? stockWakeup(db))(assignee, {
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
    return 1;
  } catch (err) {
    logger.warn({ err, runId }, "crew: replaying a wake skipped while the lease was held failed");
    return 0;
  }
}

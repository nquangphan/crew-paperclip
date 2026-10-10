import type { PluginApiRequestInput, PluginApiResponse, PluginContext } from "@paperclipai/plugin-sdk";
import { UUID } from "../shared/db.js";

type Ctx = Pick<PluginContext, "issues" | "activity" | "logger">;
type Issue = NonNullable<Awaited<ReturnType<PluginContext["issues"]["get"]>>>;

export type ForceDoneWarning = "comment_failed" | "wakeup_failed" | "activity_failed" | "violations_unread";

const TERMINAL = new Set(["done", "cancelled"]);
/** Parent states the host refuses to wake (`requestWakeup`); skipping them is not a failure. */
const UNWAKEABLE_PARENT = new Set(["backlog", "done", "cancelled"]);
/** Host `requestWakeup` refusal for a parent with unresolved blockers: expected, not a failure. */
const BLOCKED_PARENT = /blocked by unresolved blockers/i;
/** Control characters other than tab, line feed and carriage return (C0, DEL, C1). */
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;

const fail = (status: number, error: string, extra: Record<string, unknown> = {}): PluginApiResponse =>
  ({ status, body: { error, ...extra } });

/** Trimmed reason when it is 10–1000 characters without control characters, otherwise null. */
function parseReason(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const reason = value.trim();
  return reason.length >= 10 && reason.length <= 1000 && !CONTROL.test(reason) ? reason : null;
}

function bodyValid(body: unknown, companyId: string): body is { companyId: string; reason: unknown } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const value = body as Record<string, unknown>;
  if (Object.keys(value).some((key) => key !== "companyId" && key !== "reason")) return false;
  return typeof value.companyId === "string" && value.companyId.toLowerCase() === companyId.toLowerCase();
}

const errText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Board-only "force done": closes an issue whatever stage it waits on, without the stock route transition that
 * would turn `done` into an approval or start the workflow. `ctx.issues.update` goes straight to the issue
 * service, so the gate still runs and records its own `board_override`; this handler adds the owner's reason.
 */
export async function handleIssuesApi(ctx: Ctx, input: PluginApiRequestInput): Promise<PluginApiResponse> {
  if (input.routeKey !== "issues.force-done") return fail(404, "Route không tồn tại");
  // The host already requires board auth; checked again so a host rule change cannot let an agent close its own gate.
  if (input.actor.actorType !== "user") return fail(403, "board_only");
  const actorUserId = input.actor.userId ?? input.actor.actorId;
  const companyId = input.companyId;
  if (!bodyValid(input.body, companyId)) return fail(400, "body_invalid");
  const reason = parseReason(input.body.reason);
  if (!reason) return fail(400, "reason_invalid");
  const issueId = input.params.issueId;
  if (typeof issueId !== "string" || !UUID.test(issueId)) return fail(404, "issue_not_found");

  const issue = await ctx.issues.get(issueId, companyId);
  if (!issue || issue.companyId !== companyId) return fail(404, "issue_not_found");
  if (TERMINAL.has(issue.status)) return fail(409, "issue_terminal", { status: issue.status });

  let updated: Issue;
  try {
    updated = await ctx.issues.update(issue.id, { status: "done" }, companyId, { actorUserId });
  } catch (error) {
    ctx.logger.error("crew force done update failed", { issueId: issue.id, companyId, err: errText(error) });
    return fail(500, "update_failed");
  }

  // The gate's `board_override` activity is not readable from a plugin (no activity read API, activity_log is
  // not a core read table), so the skipped gates are left to the issue history.
  const violations: string[] = [];
  const warnings: ForceDoneWarning[] = ["violations_unread"];
  const attempt = async (warning: ForceDoneWarning, step: string, run: () => Promise<unknown>) => {
    try {
      await run();
    } catch (error) {
      warnings.push(warning);
      ctx.logger.warn(`crew force done ${step} failed`, { issueId: issue.id, companyId, err: errText(error) });
    }
  };

  await attempt("comment_failed", "comment", () =>
    ctx.issues.createComment(issue.id, `**Ép Done** — ${reason}`, companyId, { actorUserId }));
  const state = issue.executionState;
  await attempt("activity_failed", "activity", () => ctx.activity.log({
    companyId, message: "crew.issue.force_done", entityType: "issue", entityId: issue.id,
    metadata: {
      reason, fromStatus: issue.status, fromStageId: state?.currentStageId ?? null,
      fromStageType: state?.currentStageType ?? null, violations, actorUserId,
    },
  }));
  if (issue.parentId) {
    await attempt("wakeup_failed", "parent wakeup", () => wakeParentIfLastChild(ctx, issue, companyId, actorUserId));
  }
  return { status: 200, body: { issue: updated, violations, warnings } };
}

/**
 * The stock route wakes the parent's agent when its last open child closes; the issue service does not, so a close
 * through the plugin has to do it. Only direct children count, as in the stock rule.
 */
async function wakeParentIfLastChild(ctx: Ctx, issue: Issue, companyId: string, actorUserId: string): Promise<void> {
  const parentId = issue.parentId!;
  const parent = await ctx.issues.get(parentId, companyId);
  // Stock rule: a conversation issue is never woken by its children.
  if (!parent?.assigneeAgentId || parent.conversationAgentId || UNWAKEABLE_PARENT.has(parent.status)) return;
  const subtree = await ctx.issues.getSubtree(parentId, companyId, { includeRoot: false });
  const open = subtree.issues.some((child) =>
    child.parentId === parentId && child.id !== issue.id && !TERMINAL.has(child.status));
  if (open) return;
  try {
    await ctx.issues.requestWakeup(parentId, companyId, {
      reason: "issue_children_completed", idempotencyKey: `force-done:${issue.id}`, actorUserId,
    });
  } catch (error) {
    // The host refuses to wake a parent that still has unresolved blockers; it will be woken when they clear.
    if (!BLOCKED_PARENT.test(errText(error))) throw error;
  }
}

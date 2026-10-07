import type { PluginContext } from "@paperclipai/plugin-sdk";

type RunCancelledPayload = {
  runId?: string;
  agentId?: string;
  issueId?: string | null;
  startedAt?: string | null;
  errorCode?: string | null;
};

/**
 * `cancelRunInternal` (server/src/services/heartbeat.ts) records `errorCode: "cancelled"` for a cancel requested
 * by a person or the control plane. Stock gives every automatic cancel its own code: issue_reassigned (handoff
 * and stage change, routes/issues.ts), lock_released_on_reassignment, queued_comment_discarded,
 * agent_chat_disabled, and so on. Those are followed by the write that moves the issue, so stepping in
 * with `blocked` would race it. Only the plain cancel (or an event without a code) is handled.
 */
function isRequestedCancel(errorCode: string | null | undefined): boolean {
  return errorCode == null || errorCode === "cancelled";
}

const TIME_FORMAT = new Intl.DateTimeFormat("vi-VN", {
  timeZone: "Asia/Ho_Chi_Minh",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  day: "2-digit",
  month: "2-digit",
});

/**
 * Stock Paperclip deliberately leaves an issue untouched after a board cancel (recovery stands
 * down), so the issue stays `in_progress` with no live run. Move it to `blocked` with a note.
 * `blocked`, not `todo`: a `todo` issue assigned to an agent is re-dispatched by the stranded-issue
 * reconciler, which would restart the work the board just stopped. Plugin issue updates and
 * plugin comments without `actorUserId` do not wake the agent.
 */
export function registerRunCancelledHandler(ctx: PluginContext): void {
  ctx.events.on("agent.run.cancelled", async (event) => {
    const payload = (event.payload ?? {}) as RunCancelledPayload;
    const companyId = event.companyId;
    if (!companyId || !payload.issueId || !payload.runId || !payload.startedAt) return;
    if (!isRequestedCancel(payload.errorCode)) return;

    const issue = await ctx.issues.get(payload.issueId, companyId);
    if (!issue || issue.status !== "in_progress") return;
    if (issue.assigneeAgentId !== payload.agentId) return;
    if (issue.executionRunId && issue.executionRunId !== payload.runId) return;

    await ctx.issues.update(issue.id, { status: "blocked" }, companyId);
    await ctx.issues.createComment(
      issue.id,
      [
        `Run \`${payload.runId}\` đã bị hủy lúc ${TIME_FORMAT.format(new Date(event.occurredAt))}.`,
        "Crew chuyển issue sang `blocked` để không kẹt ở `in_progress`.",
        "Muốn chạy tiếp: chuyển issue về `todo` hoặc để comment cho agent.",
      ].join(" "),
      companyId,
    );
  });
}

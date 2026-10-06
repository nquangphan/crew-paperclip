import type { PluginContext } from "@paperclipai/plugin-sdk";

type RunCancelledPayload = {
  runId?: string;
  agentId?: string;
  issueId?: string | null;
  startedAt?: string | null;
};

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

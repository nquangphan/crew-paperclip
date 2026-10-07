import type { PluginContext } from "@paperclipai/plugin-sdk";

type IssueUpdatedPayload = {
  status?: string;
  identifier?: string;
  _previous?: { status?: string } | null;
};

type Participant = { type?: string; agentId?: string };
type Stage = { type?: string; participants?: Participant[] };

/**
 * The integrator of a root issue is the agent in its second stage. Crew root issues carry the template
 * `[review: reviewer, review: integrator, approval: owner]` and the server locks that policy against agent
 * edits, so the issue itself is the trusted source: the plugin worker gets a minimal env (no policy config
 * file path), and an issue without the template (company not configured for Crew) is simply skipped.
 */
export function integratorAgentIdOf(policy: unknown): string | null {
  const stages = (policy as { stages?: Stage[] } | null)?.stages;
  if (!Array.isArray(stages) || stages.length !== 3) return null;
  const [, integrator, owner] = stages;
  if (integrator?.type !== "review" || owner?.type !== "approval") return null;
  const participants = integrator.participants ?? [];
  const agent = participants.length === 1 ? participants[0] : null;
  return agent?.type === "agent" && typeof agent.agentId === "string" ? agent.agentId : null;
}

/**
 * Stock Paperclip does not wake anyone when a root issue reaches `done`. After the owner approves, the
 * integrator must merge and push, so wake it once per completion of the issue.
 */
export function registerIntegratorWake(ctx: PluginContext): void {
  ctx.events.on("issue.updated", async (event) => {
    const payload = (event.payload ?? {}) as IssueUpdatedPayload;
    const companyId = event.companyId;
    if (!companyId || !event.entityId || payload.status !== "done") return;
    // Only a real transition counts: a PATCH `done` on an issue that is already done carries no `_previous.status`
    // yet still refreshes `completedAt`, which would otherwise pass the once-per-completion guard.
    const from = payload._previous?.status;
    if (typeof from !== "string" || from === "done") return;

    const issue = await ctx.issues.get(event.entityId, companyId);
    if (!issue || issue.status !== "done" || issue.parentId) return;
    const integratorAgentId = integratorAgentIdOf(issue.executionPolicy);
    if (!integratorAgentId) return;

    // One wake per completion: a reopened and re-approved issue completes again with a new timestamp.
    const round = new Date(issue.completedAt ?? issue.updatedAt).toISOString();
    const key = { scopeKind: "issue" as const, scopeId: issue.id, stateKey: "integrator-wake" };
    if ((await ctx.state.get(key)) === round) return;

    const label = issue.identifier ?? issue.id;
    try {
      await ctx.agents.invoke(integratorAgentId, companyId, {
        // `invoke` has no issue-context field, so the issue is named in the prompt.
        prompt: `Issue ${label} (id ${issue.id}) đã được owner duyệt: merge crew/req/${label} vào nhánh mặc định và push theo instructions.`,
        reason: "crew_merge",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.logger.error("crew: không đánh thức được integrator", { issueId: issue.id, integratorAgentId, message });
      try {
        await ctx.issues.createComment(
          issue.id,
          `Crew: không đánh thức được integrator để merge (${message}). Cần đánh thức tay hoặc mention integrator.`,
          companyId,
        );
      } catch (commentError) {
        ctx.logger.error("crew: không ghi được comment báo lỗi đánh thức integrator", {
          issueId: issue.id,
          message: commentError instanceof Error ? commentError.message : String(commentError),
        });
      }
      return;
    }
    // The integrator is already awake: a failed marker write only risks a duplicate wake on a later event.
    try {
      await ctx.state.set(key, round);
    } catch (error) {
      ctx.logger.error("crew: không ghi được mốc đánh thức integrator, có thể gọi trùng", {
        issueId: issue.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

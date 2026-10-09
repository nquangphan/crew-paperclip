import type { PluginContext, PluginEvent } from "@paperclipai/plugin-sdk";
import { loadCrewCompanies } from "../companies/data.js";

type Ctx = Pick<PluginContext, "agents" | "activity" | "companies" | "config" | "logger">;

/** Sự kiện project mà agent không được gây ra trong company Crew (route lõi chưa chặn agent). */
export const PROJECT_EVENTS = [
  "project.created",
  "project.updated",
  "project.workspace_created",
  "project.workspace_updated",
  "project.workspace_deleted",
] as const;
export const GOAL_EVENTS = ["goal.created", "goal.updated"] as const;

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

async function isCrewCompany(ctx: Ctx, companyId: string): Promise<boolean> {
  return (await loadCrewCompanies(ctx, { companyId })).length > 0;
}

/** Pause agent; trả `false` (kèm cảnh báo server) khi host từ chối, ví dụ agent đã terminated. */
async function pauseAgent(ctx: Ctx, agentId: string, companyId: string): Promise<boolean> {
  try {
    await ctx.agents.pause(agentId, companyId);
    return true;
  } catch (error) {
    ctx.logger.warn("crew security: pause agent failed", { agentId, companyId, err: message(error) });
    return false;
  }
}

function actingAgentId(event: PluginEvent): string | null {
  if (event.actorType !== "agent") return null;
  const payloadAgent = (event.payload as { agentId?: unknown } | null)?.agentId;
  if (typeof event.actorId === "string" && event.actorId) return event.actorId;
  return typeof payloadAgent === "string" && payloadAgent ? payloadAgent : null;
}

/**
 * Agent mới không do board tạo (agent, hệ thống hay plugin) trong company Crew: pause rồi ghi
 * `crew.security.agent_paused`. Board xem và resume nếu đúng ý.
 */
export async function onAgentCreated(ctx: Ctx, event: PluginEvent): Promise<void> {
  if (event.actorType === "user" || !event.entityId) return;
  if (!(await isCrewCompany(ctx, event.companyId))) return;
  const paused = await pauseAgent(ctx, event.entityId, event.companyId);
  await ctx.activity.log({
    companyId: event.companyId,
    message: "crew.security.agent_paused",
    entityType: "agent",
    entityId: event.entityId,
    metadata: {
      agentId: event.entityId,
      reason: "created_by_non_board",
      actorType: event.actorType ?? null,
      actorId: event.actorId ?? null,
      ...(paused ? {} : { pauseFailed: true }),
    },
  });
}

/**
 * Company Crew không dùng agent role `ceo` (role này vượt mọi kiểm quyền tạo agent và quản lý quyền). Onboarding
 * seed tạo agent `ceo` mà không phát sự kiện `agent.created`, nên chặn ở run đầu tiên của nó: pause agent.
 */
export async function onRunStarted(ctx: Ctx, event: PluginEvent): Promise<void> {
  const payload = (event.payload ?? {}) as { agentId?: unknown; runId?: unknown };
  const agentId = typeof payload.agentId === "string" ? payload.agentId : null;
  if (!agentId) return;
  const agent = await ctx.agents.get(agentId, event.companyId);
  if (!agent || agent.role !== "ceo" || agent.status === "paused" || agent.status === "terminated") return;
  if (!(await isCrewCompany(ctx, event.companyId))) return;
  const paused = await pauseAgent(ctx, agentId, event.companyId);
  await ctx.activity.log({
    companyId: event.companyId,
    message: "crew.security.agent_paused",
    entityType: "agent",
    entityId: agentId,
    metadata: {
      agentId,
      reason: "ceo_role",
      runId: typeof payload.runId === "string" ? payload.runId : null,
      ...(paused ? {} : { pauseFailed: true }),
    },
  });
}

/** Project/workspace do agent tạo, sửa, xóa trong company Crew: ghi log và pause agent đó; board tự archive. */
export async function onProjectChanged(ctx: Ctx, event: PluginEvent): Promise<void> {
  const agentId = actingAgentId(event);
  if (!agentId) return;
  if (!(await isCrewCompany(ctx, event.companyId))) return;
  const agentPaused = await pauseAgent(ctx, agentId, event.companyId);
  await ctx.activity.log({
    companyId: event.companyId,
    message: "crew.security.project_changed",
    entityType: "project",
    entityId: event.entityId,
    metadata: { projectId: event.entityId ?? null, agentId, eventType: event.eventType, agentPaused },
  });
}

/** Goal do agent tạo/sửa trong company Crew: chỉ ghi log (goal không tham gia cổng Crew). */
export async function onGoalChanged(ctx: Ctx, event: PluginEvent): Promise<void> {
  const agentId = actingAgentId(event);
  if (!agentId) return;
  if (!(await isCrewCompany(ctx, event.companyId))) return;
  await ctx.activity.log({
    companyId: event.companyId,
    message: "crew.security.goal_changed",
    entityType: "goal",
    entityId: event.entityId,
    metadata: { goalId: event.entityId ?? null, agentId, eventType: event.eventType },
  });
}

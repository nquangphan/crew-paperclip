import type { PluginContext } from "@paperclipai/plugin-sdk";
import { GOAL_EVENTS, onAgentCreated, onGoalChanged, onProjectChanged, onRunStarted, PROJECT_EVENTS } from "./guards.js";

/**
 * Phát hiện rồi xử lý các thao tác agent mà route lõi chưa chặn trong company Crew: agent mới không do board tạo,
 * agent role ceo bắt đầu chạy, project/workspace và goal do agent đổi.
 */
export function registerSecurityGuards(ctx: PluginContext): void {
  ctx.events.on("agent.created", (event) => onAgentCreated(ctx, event));
  ctx.events.on("agent.run.started", (event) => onRunStarted(ctx, event));
  for (const name of PROJECT_EVENTS) ctx.events.on(name, (event) => onProjectChanged(ctx, event));
  for (const name of GOAL_EVENTS) ctx.events.on(name, (event) => onGoalChanged(ctx, event));
}

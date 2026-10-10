import type { Request } from "express";
import { conflict, forbidden } from "../errors.js";
import { loadCrewCompanyConfig } from "./issue-policy.js";

/**
 * Company Crew của actor agent, hoặc `null` khi actor không phải agent hay company không có trong file cấu hình
 * Crew (giữ hành vi gốc). File cấu hình có company nhưng lỗi vẫn tính là company Crew (đóng khi lỗi, như guard
 * cấu hình agent).
 */
async function crewAgentCompany(req: Request): Promise<string | null> {
  if (req.actor.type !== "agent" || !req.actor.companyId) return null;
  const config = await loadCrewCompanyConfig(req.actor.companyId);
  return config.kind === "absent" ? null : req.actor.companyId;
}

export type CrewBoardOnlyAction = "project_write" | "issue_delete" | "execution_workspace_update";

const MESSAGES: Record<CrewBoardOnlyAction, string> = {
  project_write: "Crew: agent không được tạo, sửa, archive hay xóa project và workspace của project; việc này chỉ board làm.",
  issue_delete: "Crew: agent không được xóa issue; việc này chỉ board làm.",
  execution_workspace_update: "Crew: agent không được sửa execution workspace; việc này chỉ board làm.",
};

/** Ném 403 `crew_board_only` khi actor là agent của company Crew. Board và company ngoài cấu hình giữ hành vi gốc. */
export async function crewAssertBoardOnly(req: Request, action: CrewBoardOnlyAction): Promise<void> {
  if (!(await crewAgentCompany(req))) return;
  throw forbidden(MESSAGES[action], { code: "crew_board_only", action });
}

const PROJECT_WRITE_ROUTES: [method: string, path: RegExp][] = [
  ["POST", /^\/companies\/[^/]+\/projects\/?$/i],
  ["PATCH", /^\/projects\/[^/]+\/?$/i],
  ["DELETE", /^\/projects\/[^/]+\/?$/i],
  ["POST", /^\/projects\/[^/]+\/workspaces\/?$/i],
  ["PATCH", /^\/projects\/[^/]+\/workspaces\/[^/]+\/?$/i],
  ["DELETE", /^\/projects\/[^/]+\/workspaces\/[^/]+\/?$/i],
];

/**
 * Middleware của router project: agent Crew không tạo/sửa/archive/xóa project hay workspace của project (gồm cả MCP
 * `create_project`, vốn gọi lại `POST /companies/:id/projects` bằng token của agent). Điều khiển runtime service của
 * workspace không thuộc nhóm này.
 */
export async function crewBeforeProjectMutation(req: Request): Promise<void> {
  if (!PROJECT_WRITE_ROUTES.some(([method, path]) => req.method === method && path.test(req.path))) return;
  await crewAssertBoardOnly(req, "project_write");
}

/**
 * Agent Crew chỉ checkout issue chưa giao ai hoặc đã giao chính mình: không giành issue đang giao agent khác hay
 * đang chờ người (owner duyệt). Board checkout hộ agent giữ hành vi gốc.
 */
export async function crewBeforeAgentCheckout(
  req: Request,
  issue: { assigneeAgentId: string | null; assigneeUserId: string | null },
): Promise<void> {
  if (!(await crewAgentCompany(req))) return;
  const self = req.actor.agentId ?? null;
  const unassigned = !issue.assigneeAgentId && !issue.assigneeUserId;
  if (unassigned || (self !== null && issue.assigneeAgentId === self)) return;
  throw conflict("Crew: agent chỉ checkout issue chưa giao ai hoặc đã giao chính mình.", {
    code: "crew_checkout_forbidden",
    assigneeAgentId: issue.assigneeAgentId,
    assigneeUserId: issue.assigneeUserId,
  });
}

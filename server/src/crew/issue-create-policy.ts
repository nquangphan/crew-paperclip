import type { Db } from "@paperclipai/db";
import { unprocessable } from "../errors.js";
import { buildCrewPolicy, type CrewRoles, loadCrewCompanyConfig } from "./issue-policy.js";

/** Cùng shape với IssueCreateLike trong core-hooks.ts (không import registry). */
export interface IssueCreateFields {
  parentId?: string | null;
  createdByAgentId?: string | null;
  createdByUserId?: string | null;
  assigneeAgentId?: string | null;
  status?: string | null;
  executionPolicy?: unknown;
}

export type CreatePolicyDecision =
  | { kind: "keep" }
  | {
      kind: "reject";
      code: "crew_agent_root_issue" | "crew_roles_unconfigured" | "crew_role_assignee" | "crew_gate_blocked";
    }
  | { kind: "set"; template: "child" }
  | { kind: "set"; template: "root"; ownerUserId: string };

/** Agent không được tạo issue ở trạng thái đã kết thúc hoặc đang review (bỏ qua gate). */
const AGENT_CREATE_FORBIDDEN_STATUSES = new Set(["done", "cancelled", "in_review"]);

/**
 * Chỉ gọi cho company có trong file cấu hình Crew (`roles` null = cấu hình lỗi).
 * Agent chỉ tạo được issue con và luôn nhận template con (mọi policy agent gửi bị thay). Board gửi policy riêng
 * thì giữ; không gửi thì nhận template theo loại issue, owner của template gốc lấy từ file cấu hình.
 * Hệ thống (không người tạo: watchdog, recovery, evaluation) giữ hành vi stock.
 */
export function decideCreatePolicy(input: {
  data: IssueCreateFields;
  roles: CrewRoles | null;
  ownerUserId: string | null;
}): CreatePolicyDecision {
  const { data, roles } = input;
  if (data.createdByAgentId) {
    if (!roles) return { kind: "reject", code: "crew_roles_unconfigured" };
    if (!data.parentId) return { kind: "reject", code: "crew_agent_root_issue" };
    if (data.status && AGENT_CREATE_FORBIDDEN_STATUSES.has(data.status)) {
      return { kind: "reject", code: "crew_gate_blocked" };
    }
    if (data.assigneeAgentId && [roles.reviewerAgentId, roles.integratorAgentId].includes(data.assigneeAgentId)) {
      return { kind: "reject", code: "crew_role_assignee" };
    }
    return { kind: "set", template: "child" };
  }
  if (!data.createdByUserId?.trim()) return { kind: "keep" };
  if (data.executionPolicy != null || !roles) return { kind: "keep" };
  if (data.parentId) return { kind: "set", template: "child" };
  return input.ownerUserId ? { kind: "set", template: "root", ownerUserId: input.ownerUserId } : { kind: "keep" };
}

const MESSAGES: Record<Extract<CreatePolicyDecision, { kind: "reject" }>["code"], string> = {
  crew_agent_root_issue: "Crew: agent chỉ được tạo issue con (cần parentId).",
  crew_roles_unconfigured: "Crew: company chưa có đúng một agent reviewer và một agent integrator.",
  crew_role_assignee: "Crew: không giao việc thực thi cho agent reviewer hoặc integrator.",
  crew_gate_blocked: "Crew: agent không được tạo issue ở trạng thái done, cancelled hoặc in_review.",
};

export async function crewBeforeIssueCreate<T extends IssueCreateFields>(input: {
  db: Db;
  companyId: string;
  data: T;
}): Promise<T> {
  const config = await loadCrewCompanyConfig(input.companyId);
  if (config.kind === "absent") return input.data;
  const roles = config.kind === "ok" ? config.roles : null;
  const ownerUserId = config.kind === "ok" ? config.ownerUserId : null;
  const decision = decideCreatePolicy({ data: input.data, roles, ownerUserId });
  if (decision.kind === "keep") return input.data;
  if (decision.kind === "reject") throw unprocessable(MESSAGES[decision.code], { code: decision.code });
  // `roles` khác null ở mọi nhánh `set` của decideCreatePolicy.
  const policy =
    decision.template === "child"
      ? buildCrewPolicy("child", roles as CrewRoles)
      : buildCrewPolicy("root", roles as CrewRoles, decision.ownerUserId);
  return { ...input.data, executionPolicy: policy };
}

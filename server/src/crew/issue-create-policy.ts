import type { Db } from "@paperclipai/db";
import { unprocessable } from "../errors.js";
import { buildCrewPolicy, type CrewRoles, loadCompanyOwnerUserId, loadCrewRoles } from "./issue-policy.js";

/** Cùng shape với IssueCreateLike trong core-hooks.ts (không import registry). */
export interface IssueCreateFields {
  parentId?: string | null;
  createdByAgentId?: string | null;
  createdByUserId?: string | null;
  assigneeAgentId?: string | null;
  executionPolicy?: unknown;
}

export type CreatePolicyDecision =
  | { kind: "keep" }
  | { kind: "reject"; code: "crew_agent_root_issue" | "crew_roles_unconfigured" | "crew_role_assignee" }
  | { kind: "set"; template: "child" }
  | { kind: "set"; template: "root"; ownerUserId: string };

/**
 * Agent chỉ tạo được issue con và luôn nhận template con (mọi policy agent gửi bị thay). Board/hệ thống gửi
 * policy riêng thì giữ; không gửi thì nhận template theo loại issue (gốc cần owner).
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
    if (data.assigneeAgentId && [roles.reviewerAgentId, roles.integratorAgentId].includes(data.assigneeAgentId)) {
      return { kind: "reject", code: "crew_role_assignee" };
    }
    return { kind: "set", template: "child" };
  }
  if (data.executionPolicy != null || !roles) return { kind: "keep" };
  if (data.parentId) return { kind: "set", template: "child" };
  const owner = data.createdByUserId?.trim() || input.ownerUserId;
  return owner ? { kind: "set", template: "root", ownerUserId: owner } : { kind: "keep" };
}

const MESSAGES: Record<Extract<CreatePolicyDecision, { kind: "reject" }>["code"], string> = {
  crew_agent_root_issue: "Crew: agent chỉ được tạo issue con (cần parentId).",
  crew_roles_unconfigured: "Crew: company chưa có đúng một agent reviewer và một agent integrator.",
  crew_role_assignee: "Crew: không giao việc thực thi cho agent reviewer hoặc integrator.",
};

export async function crewBeforeIssueCreate<T extends IssueCreateFields>(input: {
  db: Db;
  companyId: string;
  data: T;
}): Promise<T> {
  const roles = await loadCrewRoles(input.db, input.companyId);
  const needsOwner = !input.data.createdByAgentId && !input.data.parentId && !input.data.createdByUserId?.trim();
  const ownerUserId = needsOwner ? await loadCompanyOwnerUserId(input.db, input.companyId) : null;
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

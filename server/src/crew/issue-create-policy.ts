import { issues, labels, type Db } from "@paperclipai/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { unprocessable } from "../errors.js";
import { CREW_OVERRIDE_FORBIDDEN_MESSAGE, checkAgentAdapterOverrides } from "./model-policy.js";
import {
  buildCrewPolicy,
  CREW_RESEARCH_LABEL,
  type CrewRoles,
  housekeepingSourceIssueId,
  isCrewHousekeepingOrigin,
  isTrackingProject,
  loadSourceExecutorAgentIds,
} from "./issue-policy.js";
import { loadCompanyRoleAgentIds, loadCrewRoles } from "./project-roles.js";

/** Cùng shape với IssueCreateLike trong core-hooks.ts (không import registry). */
export interface IssueCreateFields {
  parentId?: string | null;
  createdByAgentId?: string | null;
  createdByUserId?: string | null;
  assigneeAgentId?: string | null;
  status?: string | null;
  originKind?: string | null;
  originId?: string | null;
  executionPolicy?: unknown;
  assigneeAdapterOverrides?: unknown;
  labelIds?: readonly string[] | null;
  projectId?: string | null;
  inheritExecutionWorkspaceFromIssueId?: string | null;
  skipExecutionWorkspaceInheritance?: boolean;
}

export type CreatePolicyDecision =
  | { kind: "keep" }
  | {
      kind: "reject";
      code: "crew_agent_root_issue" | "crew_roles_unconfigured" | "crew_role_assignee" | "crew_gate_blocked" | "crew_override_forbidden";
      violations?: string[];
    }
  | { kind: "set"; template: "child" }
  | { kind: "set"; template: "root" | "research"; ownerUserId: string };

/** Agent không được tạo issue ở trạng thái đã kết thúc hoặc đang review (bỏ qua gate). */
const AGENT_CREATE_FORBIDDEN_STATUSES = new Set(["done", "cancelled", "in_review"]);

/**
 * Chỉ gọi cho company có trong file cấu hình Crew (`roles` null = cấu hình lỗi).
 * Agent chỉ tạo được issue con và luôn nhận template con (mọi policy agent gửi bị thay). Board gửi policy riêng
 * thì giữ; không gửi thì nhận template theo loại issue, owner của template gốc lấy từ file cấu hình.
 * Board tạo issue gốc có nhãn research nhận template reviewer rồi owner. Issue gốc trong project theo dõi
 * (`trackingProjectIds`) không nhận policy; policy chốt lúc tạo, đổi project sau đó không đổi gì.
 * Hệ thống (không người tạo): issue watchdog/recovery giữ hành vi stock, trừ khi giao lại cho agent đang làm issue
 * nguồn (khi đó nhận template con); routine và mọi nguồn khác (kể cả không nhận diện được) nhận template con nếu có
 * `parentId`, template gốc (owner từ file cấu hình) nếu không.
 */
export function decideCreatePolicy(input: {
  data: IssueCreateFields;
  roles: CrewRoles | null;
  ownerUserId: string | null;
  /** Agent đang làm issue nguồn (assignee, `returnAssignee`) của issue watchdog/recovery. */
  sourceExecutorAgentIds?: readonly string[];
  researchLabel?: boolean;
  /** Issue thuộc project theo dõi của company: board tạo issue gốc ở đây không nhận policy Crew. */
  trackingProject?: boolean;
  /** Mọi agent reviewer/integrator của company (file ∪ vai trò theo project); không truyền thì dùng `roles`. */
  roleAgentIds?: ReadonlySet<string>;
}): CreatePolicyDecision {
  const { data, roles } = input;
  if (data.createdByAgentId) {
    if (!roles) return { kind: "reject", code: "crew_roles_unconfigured" };
    if (!data.parentId) return { kind: "reject", code: "crew_agent_root_issue" };
    if (data.status && AGENT_CREATE_FORBIDDEN_STATUSES.has(data.status)) {
      return { kind: "reject", code: "crew_gate_blocked" };
    }
    const roleAgentIds = input.roleAgentIds ?? new Set([roles.reviewerAgentId, roles.integratorAgentId]);
    if (data.assigneeAgentId && roleAgentIds.has(data.assigneeAgentId.toLowerCase())) {
      return { kind: "reject", code: "crew_role_assignee" };
    }
    const violations = checkAgentAdapterOverrides(data.assigneeAdapterOverrides);
    if (violations.length > 0) return { kind: "reject", code: "crew_override_forbidden", violations };
    return { kind: "set", template: "child" };
  }
  if (!data.createdByUserId?.trim()) {
    const handedBackToExecutor =
      !!data.assigneeAgentId && (input.sourceExecutorAgentIds ?? []).includes(data.assigneeAgentId);
    if (isCrewHousekeepingOrigin(data.originKind) && !handedBackToExecutor) return { kind: "keep" };
    if (!roles) return { kind: "reject", code: "crew_roles_unconfigured" };
    if (data.parentId || !input.ownerUserId) return { kind: "set", template: "child" };
    return { kind: "set", template: "root", ownerUserId: input.ownerUserId };
  }
  if (data.executionPolicy != null || !roles) return { kind: "keep" };
  if (data.parentId) return { kind: "set", template: "child" };
  if (input.trackingProject) return { kind: "keep" };
  return input.ownerUserId
    ? { kind: "set", template: input.researchLabel ? "research" : "root", ownerUserId: input.ownerUserId }
    : { kind: "keep" };
}

async function hasResearchLabel(db: Db, companyId: string, labelIds: readonly string[] | null | undefined): Promise<boolean> {
  if (!labelIds?.length) return false;
  const rows = await db
    .select({ id: labels.id })
    .from(labels)
    .where(and(
      eq(labels.companyId, companyId),
      inArray(labels.id, [...labelIds]),
      sql`lower(${labels.name}) = ${CREW_RESEARCH_LABEL}`,
    ))
    .limit(1);
  return rows.length > 0;
}

/**
 * Project mà lõi sẽ gán cho issue (`issueService.create`): project ghi rõ; không có thì project của issue nguồn
 * workspace (`inheritExecutionWorkspaceFromIssueId ?? parentId`, cùng company), trừ khi
 * `skipExecutionWorkspaceInheritance`. Nguồn không tìm thấy thì lõi tự báo 404, ở đây trả null.
 */
async function resolveIssueProjectId(db: Db, companyId: string, data: IssueCreateFields): Promise<string | null> {
  if (data.projectId != null) return data.projectId;
  if (data.skipExecutionWorkspaceInheritance) return null;
  const sourceId = data.inheritExecutionWorkspaceFromIssueId ?? data.parentId;
  if (!sourceId) return null;
  const [source] = await db
    .select({ projectId: issues.projectId })
    .from(issues)
    .where(and(eq(issues.id, sourceId), eq(issues.companyId, companyId)))
    .limit(1);
  return source?.projectId ?? null;
}

const MESSAGES: Record<Extract<CreatePolicyDecision, { kind: "reject" }>["code"], string> = {
  crew_agent_root_issue: "Crew: agent chỉ được tạo issue con (cần parentId).",
  crew_roles_unconfigured: "Crew: company chưa có đúng một agent reviewer và một agent integrator.",
  crew_role_assignee: "Crew: không giao việc thực thi cho agent reviewer hoặc integrator.",
  crew_gate_blocked: "Crew: agent không được tạo issue ở trạng thái done, cancelled hoặc in_review.",
  crew_override_forbidden: CREW_OVERRIDE_FORBIDDEN_MESSAGE,
};

/**
 * `db` là handle chung của `issueService(db)`, không phải transaction của bên gọi (dòng hook không nhận `dbOrTx`):
 * issue nguồn được đọc ở bản đã commit. Một đường stock đổi assignee của issue nguồn rồi tạo issue recovery trong
 * cùng transaction sẽ được so với assignee cũ; H2 vẫn so lại lúc `done` bằng transaction của lệnh ghi.
 */
export async function crewBeforeIssueCreate<T extends IssueCreateFields>(input: {
  db: Db;
  companyId: string;
  data: T;
}): Promise<T> {
  const { data } = input;
  const projectId = await resolveIssueProjectId(input.db, input.companyId, data);
  const config = await loadCrewRoles({ db: input.db, companyId: input.companyId, projectId, onReadError: "throw" });
  if (config.kind === "absent") return input.data;
  const roles = config.kind === "ok" ? config.roles : null;
  const ownerUserId = config.kind === "ok" ? config.ownerUserId : null;
  const roleAgentIds =
    data.createdByAgentId && data.assigneeAgentId
      ? await loadCompanyRoleAgentIds({ db: input.db, companyId: input.companyId })
      : undefined;
  const needsSource =
    !data.createdByAgentId && !data.createdByUserId?.trim() && !!data.assigneeAgentId && isCrewHousekeepingOrigin(data.originKind);
  const sourceExecutorAgentIds = needsSource
    ? await loadSourceExecutorAgentIds(input.db, housekeepingSourceIssueId(data))
    : [];
  const boardRoot = !data.createdByAgentId && !!data.createdByUserId?.trim() && !data.parentId && data.executionPolicy == null;
  const researchLabel = boardRoot ? await hasResearchLabel(input.db, input.companyId, data.labelIds) : false;
  const trackingProject = isTrackingProject(config, data.projectId);
  const decision = decideCreatePolicy({
    data,
    roles,
    ownerUserId,
    sourceExecutorAgentIds,
    researchLabel,
    trackingProject,
    roleAgentIds,
  });
  if (decision.kind === "keep") return input.data;
  if (decision.kind === "reject") throw unprocessable(MESSAGES[decision.code], {
    code: decision.code,
    ...(decision.violations ? { violations: decision.violations } : {}),
  });
  // `roles` khác null ở mọi nhánh `set` của decideCreatePolicy.
  const policy =
    decision.template === "child"
      ? buildCrewPolicy("child", roles as CrewRoles)
      : buildCrewPolicy(decision.template, roles as CrewRoles, decision.ownerUserId);
  return { ...input.data, executionPolicy: policy };
}

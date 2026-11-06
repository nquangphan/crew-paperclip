import { agents, issues, labels, projects, routines, routineTriggers, type Db } from "@paperclipai/db";
import { and, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { unprocessable } from "../errors.js";
import {
  CREW_MODEL_LINE_RE,
  CREW_OVERRIDE_FORBIDDEN_MESSAGE,
  checkAgentAdapterOverrides,
  chooseReviewer,
  type CrewRuntime,
  isCrewRuntime,
  type ReviewerChoice,
} from "./model-policy.js";
import {
  buildCrewPolicy,
  CREW_RESEARCH_LABEL,
  type CrewRoles,
  housekeepingSourceIssueId,
  isCrewHousekeepingOrigin,
  isTrackingProject,
  loadSourceExecutorAgentIds,
} from "./issue-policy.js";
import {
  agentAssignmentAllowed,
  loadCompanyRoleAgentIds,
  loadCrewRoles,
  loadProjectAgentRoles,
  type ProjectAgentRoles,
  rowsOf,
} from "./project-roles.js";
import { loadModelSettings } from "./model-settings.js";
import { readRuntimeSwitch, resolveAgentMachine } from "./runtime-switch.js";
import { crewTableSql } from "./machine-pin.js";
import { logger } from "../middleware/logger.js";

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
  description?: string | null;
  title?: string | null;
}

/** Dòng riêng trong mô tả issue con do agent tạo: issue lập epic/story bằng BMAD, cần owner duyệt sau reviewer. */
export const CREW_BMAD_KIND_RE = /^crew-kind bmad[ \t]*$/m;
/** Dòng riêng trong mô tả issue con do agent tạo: issue làm mockup giao diện, cần owner duyệt sau reviewer. */
export const CREW_DESIGN_KIND_RE = /^crew-kind design[ \t]*$/m;

export type CreatePolicyDecision =
  | { kind: "keep" }
  | {
      kind: "reject";
      code:
        | "crew_agent_root_issue"
        | "crew_roles_unconfigured"
        | "crew_role_assignee"
        | "crew_assignment_forbidden"
        | "crew_project_outside_parent"
        | "crew_routine_issue_forbidden"
        | "crew_gate_blocked"
        | "crew_override_forbidden";
      violations?: string[];
    }
  | { kind: "set"; template: "child" }
  | { kind: "set"; template: "root" | "root-bf" | "research" | "bmad" | "design"; ownerUserId: string };

/** Agent không được tạo issue ở trạng thái đã kết thúc hoặc đang review (bỏ qua gate). */
const AGENT_CREATE_FORBIDDEN_STATUSES = new Set(["done", "cancelled", "in_review"]);

/**
 * Chỉ gọi cho company có trong file cấu hình Crew (`roles` null = cấu hình lỗi).
 * Agent chỉ tạo được issue con và luôn nhận template con (mọi policy agent gửi bị thay), trừ con có dòng
 * `crew-kind bmad` hay `crew-kind design` trong mô tả: nhận template bmad/design (reviewer rồi owner duyệt). Board gửi policy riêng
 * thì giữ; không gửi thì nhận template theo loại issue, owner của template gốc lấy từ file cấu hình.
 * Board tạo issue gốc có nhãn research nhận template reviewer rồi owner. Board tạo ticket tổng code/bug (không nhãn
 * research/docs/plan) khi company bật `bugFinding.enabled` và project có origin GitHub hoặc GitLab (`originProvider`) nhận
 * `root-bf`; còn lại `root`.
 * Issue gốc trong project theo dõi
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
  /** Issue gốc có nhãn research, docs hoặc plan: không phải ticket tổng code/bug, không nhận `root-bf`. */
  nonCodeLabel?: boolean;
  /** Company bật `bugFinding.enabled` trong file cấu hình Crew. */
  bugFindingEnabled?: boolean;
  /** Provider của origin project trong `project_repos` (`originProvider`); `null`/không truyền: không GitHub, không GitLab. */
  originProvider?: OriginProvider | null;
  /** Issue thuộc project theo dõi của company: board tạo issue gốc ở đây không nhận policy Crew. */
  trackingProject?: boolean;
  /** Mọi agent reviewer/integrator của company (file ∪ vai trò theo project); không truyền thì dùng `roles`. */
  roleAgentIds?: ReadonlySet<string>;
  /** Trợ Lý/executor theo dòng vai trò crew.core của project; `null`/không truyền: project dùng vai trò file. */
  projectAgentRoles?: ProjectAgentRoles | null;
  /** Issue do routine sinh ra mà routine (hoặc trigger của nó) do agent tạo/sửa. */
  agentRoutine?: boolean;
  /** Project lõi sẽ gán cho issue con khác project của issue cha (kể cả không project). */
  projectOutsideParent?: boolean;
  /** `adapterType` của assignee: override của agent kiểm theo runtime này; không truyền thì luật Claude. */
  assigneeAdapterType?: string | null;
  /** Catalog hiện hành của cài đặt model; không truyền thì bảng mặc định. */
  catalog?: Parameters<typeof checkAgentAdapterOverrides>[2];
}): CreatePolicyDecision {
  const { data, roles } = input;
  if (data.createdByAgentId) {
    if (!roles) return { kind: "reject", code: "crew_roles_unconfigured" };
    if (!data.parentId) return { kind: "reject", code: "crew_agent_root_issue" };
    // Con ở project khác cha thì luật giao việc đọc vai trò của project đó (có thể không có dòng nào): chặn để agent
    // không lách luật giao việc của project cha.
    if (input.projectOutsideParent) return { kind: "reject", code: "crew_project_outside_parent" };
    if (data.status && AGENT_CREATE_FORBIDDEN_STATUSES.has(data.status)) {
      return { kind: "reject", code: "crew_gate_blocked" };
    }
    const roleAgentIds =
      input.roleAgentIds ??
      new Set([roles.reviewerAgentId, roles.integratorAgentId, roles.codexReviewerAgentId ?? ""].filter(Boolean));
    if (data.assigneeAgentId && roleAgentIds.has(data.assigneeAgentId.toLowerCase())) {
      return { kind: "reject", code: "crew_role_assignee" };
    }
    if (
      data.assigneeAgentId &&
      !agentAssignmentAllowed({
        actorAgentId: data.createdByAgentId,
        targetAgentId: data.assigneeAgentId,
        roles: input.projectAgentRoles ?? null,
      })
    ) {
      return { kind: "reject", code: "crew_assignment_forbidden" };
    }
    const violations = checkAgentAdapterOverrides(data.assigneeAdapterOverrides, input.assigneeAdapterType, input.catalog);
    if (violations.length > 0) return { kind: "reject", code: "crew_override_forbidden", violations };
    if (CREW_BMAD_KIND_RE.test(data.description ?? "")) {
      if (!input.ownerUserId) return { kind: "reject", code: "crew_roles_unconfigured" };
      return { kind: "set", template: "bmad", ownerUserId: input.ownerUserId };
    }
    if (CREW_DESIGN_KIND_RE.test(data.description ?? "")) {
      if (!input.ownerUserId) return { kind: "reject", code: "crew_roles_unconfigured" };
      return { kind: "set", template: "design", ownerUserId: input.ownerUserId };
    }
    return { kind: "set", template: "child" };
  }
  if (!data.createdByUserId?.trim()) {
    // Routine do agent tạo/sửa sinh issue theo lịch hay webhook mà không qua Trợ Lý: từ chối.
    if (input.agentRoutine) return { kind: "reject", code: "crew_routine_issue_forbidden" };
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
  if (!input.ownerUserId) return { kind: "keep" };
  if (input.researchLabel) return { kind: "set", template: "research", ownerUserId: input.ownerUserId };
  const bugFinding = !input.nonCodeLabel && !!input.bugFindingEnabled && !!input.originProvider;
  return { kind: "set", template: bugFinding ? "root-bf" : "root", ownerUserId: input.ownerUserId };
}

/** Nhãn của issue gốc khiến nó không phải ticket tổng code/bug (luồng cũ, không Bug Finding). */
export const CREW_NON_CODE_LABELS: readonly string[] = [CREW_RESEARCH_LABEL, "docs", "plan"];

export type OriginProvider = "github" | "gitlab";

/** Host (chữ thường) của origin `git@<host>:…`, `ssh://git@<host>[:port]/…` hoặc `https://<host>/…`; dạng khác trả `null`. */
function originHost(originUrl: string | null | undefined): string | null {
  const url = originUrl?.trim() ?? "";
  const scp = /^[^@/\s]+@([^:/\s]+):/.exec(url);
  if (scp && !url.includes("://")) return scp[1]!.toLowerCase();
  try {
    const parsed = new URL(url);
    return ["https:", "http:", "ssh:"].includes(parsed.protocol) && parsed.hostname ? parsed.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * Provider của origin: `github` khi host là github.com, `gitlab` khi host là gitlab.com hoặc nằm trong `gitlabHosts`
 * (`bugFinding.gitlabHosts` của file cấu hình Crew, chữ thường); còn lại `null`. So host chính xác (không phân biệt hoa
 * thường), không đoán theo chữ "gitlab" trong host, nên `github.com.khac.vn` hay `gitlab.corp.vn` chưa khai báo không tính.
 */
export function originProvider(originUrl: string | null | undefined, gitlabHosts: readonly string[]): OriginProvider | null {
  const host = originHost(originUrl);
  if (!host) return null;
  if (host === "github.com") return "github";
  if (host === "gitlab.com" || gitlabHosts.includes(host)) return "gitlab";
  return null;
}

/** Tên nhãn (chữ thường) trong `CREW_NON_CODE_LABELS` mà issue mang, chỉ nhãn cùng company. */
async function nonCodeLabelNames(db: Db, companyId: string, labelIds: readonly string[] | null | undefined): Promise<Set<string>> {
  if (!labelIds?.length) return new Set();
  const rows = await db
    .select({ name: sql<string>`lower(${labels.name})` })
    .from(labels)
    .where(and(
      eq(labels.companyId, companyId),
      inArray(labels.id, [...labelIds]),
      inArray(sql`lower(${labels.name})`, [...CREW_NON_CODE_LABELS]),
    ));
  return new Set(rows.map((row) => row.name));
}

/**
 * Provider origin của project trong `project_repos` của plugin crew.core. Chỉ gọi khi company bật Bug Finding; đọc lỗi
 * (plugin chưa cài, bảng chưa có) thì coi như không GitHub/GitLab: ticket tổng giữ luồng cũ, không chặn tạo issue.
 */
async function projectOriginProvider(
  db: Db,
  companyId: string,
  projectId: string | null,
  gitlabHosts: readonly string[],
): Promise<OriginProvider | null> {
  if (!projectId || !UUID_RE.test(projectId)) return null;
  try {
    const rows = rowsOf(await db.execute(sql`SELECT origin_url FROM ${crewTableSql("project_repos")}
      WHERE company_id = ${companyId} AND project_id = ${projectId} LIMIT 1`));
    return originProvider(typeof rows[0]?.origin_url === "string" ? rows[0].origin_url : null, gitlabHosts);
  } catch (err) {
    logger.warn({ err, companyId, projectId }, "crew: reading project_repos failed; root issue keeps the root policy");
    return null;
  }
}

/**
 * Project mà lõi sẽ gán cho issue (`issueService.create`): project ghi rõ; không có thì project của issue nguồn
 * workspace (`inheritExecutionWorkspaceFromIssueId ?? parentId`, cùng company), trừ khi
 * `skipExecutionWorkspaceInheritance`. Nguồn không tìm thấy thì lõi tự báo 404, ở đây trả null.
 */
async function resolveIssueProjectId(db: Db, companyId: string, data: IssueCreateFields): Promise<string | null> {
  if (data.projectId != null) return data.projectId;
  if (data.skipExecutionWorkspaceInheritance) return null;
  return (await issueProjectId(db, companyId, data.inheritExecutionWorkspaceFromIssueId ?? data.parentId)) ?? null;
}

/** Project của một issue cùng company; `undefined` khi không có id hoặc không tìm thấy issue (lõi tự báo 404). */
async function issueProjectId(db: Db, companyId: string, issueId: string | null | undefined): Promise<string | null | undefined> {
  if (!issueId) return undefined;
  const [row] = await db
    .select({ projectId: issues.projectId })
    .from(issues)
    .where(and(eq(issues.id, issueId), eq(issues.companyId, companyId)))
    .limit(1);
  return row ? row.projectId : undefined;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Title có tag `[tên project]` ở đầu (issue mới của company có cấu hình Crew, gắn trong `crewBeforeIssueCreate`). Title đã mở đầu bằng tag đó (không phân biệt hoa thường) thì giữ; title trống
 * (lõi tự sinh từ mô tả) hoặc project không tên thì giữ nguyên.
 */
export function withProjectTag<T extends string | null | undefined>(title: T, projectName: string | null | undefined): T {
  const name = projectName?.trim();
  const trimmed = title?.trim();
  if (!name || !trimmed) return title;
  const tag = `[${name}]`;
  if (trimmed.toLowerCase().startsWith(tag.toLowerCase())) return title;
  return `${tag} ${trimmed}` as T;
}

async function projectName(db: Db, companyId: string, projectId: string | null): Promise<string | null> {
  if (!projectId || !UUID_RE.test(projectId)) return null;
  const [row] = await db
    .select({ name: projects.name })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.companyId, companyId)))
    .limit(1);
  return row?.name ?? null;
}

/**
 * `adapterType` của agent cùng company (assignee của issue), để kiểm override theo runtime. Không có id hoặc không
 * tìm thấy thì `null` (luật Claude; lõi tự báo assignee lạ).
 */
export async function loadAssigneeAdapterType(
  db: Db,
  companyId: string,
  agentId: string | null | undefined,
): Promise<string | null> {
  if (!agentId || !UUID_RE.test(agentId)) return null;
  const [row] = await db
    .select({ adapterType: agents.adapterType })
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.companyId, companyId)))
    .limit(1);
  return row?.adapterType ?? null;
}

/**
 * Runtime của executor issue con: marker `crew-model … runtime=<r>` trong mô tả (marker không có `runtime=` là Claude),
 * không có marker thì `adapterType` của assignee; agent ngoài ba runtime hay chưa giao ai coi như Claude.
 */
export function executorRuntimeOf(description: string | null | undefined, assigneeAdapterType: string | null): CrewRuntime {
  const marker = CREW_MODEL_LINE_RE.exec(description ?? "");
  if (marker) return (marker[4] as CrewRuntime | undefined) ?? "claude_local";
  return isCrewRuntime(assigneeAdapterType) ? assigneeAdapterType : "claude_local";
}

/**
 * Việc con board (owner, thành viên) thêm vào yêu cầu mà chưa giao ai và chưa có marker `crew-model`: Trợ Lý chọn
 * executor (mọi runtime) sau khi tạo, còn policy đã ghim lúc tạo và agent không đổi được. Ghim reviewer Codex lúc này có
 * thể thành Codex review chính code Codex, nên việc con loại này luôn nhận reviewer Claude.
 */
export function boardChildAwaitingExecutor(data: IssueCreateFields): boolean {
  return (
    !data.createdByAgentId &&
    !!data.createdByUserId?.trim() &&
    !!data.parentId &&
    !data.assigneeAgentId &&
    !CREW_MODEL_LINE_RE.test(data.description ?? "")
  );
}

/**
 * Reviewer của issue con code (H4): reviewer Codex của project khi `chooseReviewer` cho phép, công tắc `codex_local` đọc
 * trên máy của reviewer Codex. Reviewer Codex không có environment thì không xác định máy (công tắc mặc định, tắt), như
 * cổng H1. Đọc trạng thái/máy/công tắc lỗi thì reviewer Claude (không chặn tạo issue vì một ô tùy chọn). Việc con board
 * thêm mà chưa có executor (`boardChildAwaitingExecutor`) luôn nhận reviewer Claude.
 */
async function chooseChildReviewer(
  db: Db,
  companyId: string,
  roles: CrewRoles,
  data: IssueCreateFields,
): Promise<ReviewerChoice | null> {
  const codexReviewerAgentId = roles.codexReviewerAgentId;
  if (!codexReviewerAgentId) return null;
  if (boardChildAwaitingExecutor(data)) return null;
  try {
    const [codex] = await db
      .select({ status: agents.status, defaultEnvironmentId: agents.defaultEnvironmentId })
      .from(agents)
      .where(and(eq(agents.id, codexReviewerAgentId), eq(agents.companyId, companyId)))
      .limit(1);
    const marker = CREW_MODEL_LINE_RE.test(data.description ?? "");
    const assigneeAdapterType = marker ? null : await loadAssigneeAdapterType(db, companyId, data.assigneeAgentId);
    const base = {
      template: "child" as const,
      executorRuntime: executorRuntimeOf(data.description, assigneeAdapterType),
      claudeReviewerAgentId: roles.reviewerAgentId,
      codexReviewer: codex ? { agentId: codexReviewerAgentId, status: codex.status } : null,
    };
    // Chỉ đọc công tắc khi các điều kiện khác đã cho reviewer Codex.
    if (chooseReviewer({ ...base, codexSwitchOn: true }).runtime !== "codex_local") return chooseReviewer({ ...base, codexSwitchOn: false });
    const machineId = codex?.defaultEnvironmentId
      ? await resolveAgentMachine(db, { companyId, agentId: codexReviewerAgentId, issueId: data.parentId ?? null })
      : null;
    const codexSwitchOn = await readRuntimeSwitch(db, { companyId, machineId, runtime: "codex_local" });
    return chooseReviewer({ ...base, codexSwitchOn });
  } catch (err) {
    logger.warn({ err, companyId, codexReviewerAgentId }, "crew: choosing the Codex reviewer failed; using the Claude reviewer");
    return null;
  }
}

/** `originKind` của issue do routine sinh ra (`services/routines.ts`); `originId` là id routine. */
export const CREW_ROUTINE_ORIGIN_KIND = "routine_execution";

/**
 * Routine (cùng company) do agent tạo hoặc sửa lần cuối, hoặc có trigger do agent tạo/sửa. Đọc bằng `db` chung:
 * dòng routine/trigger đã commit trước lần dispatch (run routine mới chèn trong transaction của dispatch thì chưa
 * thấy, nên không dựa vào `originRunId`).
 */
async function isAgentAuthoredRoutine(db: Db, companyId: string, routineId: string | null | undefined): Promise<boolean> {
  if (!routineId || !UUID_RE.test(routineId)) return false;
  const [routine] = await db
    .select({ id: routines.id })
    .from(routines)
    .where(and(
      eq(routines.id, routineId),
      eq(routines.companyId, companyId),
      or(isNotNull(routines.createdByAgentId), isNotNull(routines.updatedByAgentId)),
    ))
    .limit(1);
  if (routine) return true;
  const [trigger] = await db
    .select({ id: routineTriggers.id })
    .from(routineTriggers)
    .where(and(
      eq(routineTriggers.routineId, routineId),
      eq(routineTriggers.companyId, companyId),
      or(isNotNull(routineTriggers.createdByAgentId), isNotNull(routineTriggers.updatedByAgentId)),
    ))
    .limit(1);
  return Boolean(trigger);
}

const MESSAGES: Record<Extract<CreatePolicyDecision, { kind: "reject" }>["code"], string> = {
  crew_agent_root_issue: "Crew: agent chỉ được tạo issue con (cần parentId).",
  crew_roles_unconfigured: "Crew: company chưa có đúng một agent reviewer và một agent integrator.",
  crew_role_assignee: "Crew: không giao việc thực thi cho agent reviewer hoặc integrator.",
  crew_assignment_forbidden:
    "Crew: chỉ Trợ Lý của project giao việc cho agent khác; agent khác chỉ giao cho executor của project.",
  crew_project_outside_parent: "Crew: agent chỉ tạo issue con trong cùng project với issue cha.",
  crew_routine_issue_forbidden: "Crew: routine do agent tạo hoặc sửa không được sinh issue; chỉ board tạo routine.",
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
  const projectId = await resolveIssueProjectId(input.db, input.companyId, input.data);
  const config = await loadCrewRoles({ db: input.db, companyId: input.companyId, projectId, onReadError: "throw" });
  if (config.kind === "absent") return input.data;
  const title = withProjectTag(input.data.title, await projectName(input.db, input.companyId, projectId));
  const data = title === input.data.title ? input.data : { ...input.data, title };
  const parentProjectId =
    data.createdByAgentId && data.parentId ? await issueProjectId(input.db, input.companyId, data.parentId) : undefined;
  const projectOutsideParent = parentProjectId !== undefined && projectId !== parentProjectId;
  const roles = config.kind === "ok" ? config.roles : null;
  const ownerUserId = config.kind === "ok" ? config.ownerUserId : null;
  const roleAgentIds =
    data.createdByAgentId && data.assigneeAgentId
      ? await loadCompanyRoleAgentIds({ db: input.db, companyId: input.companyId, onReadError: "throw" })
      : undefined;
  const projectAgentRoles =
    data.createdByAgentId && data.assigneeAgentId
      ? await loadProjectAgentRoles({ db: input.db, companyId: input.companyId, projectId, onReadError: "throw" })
      : null;
  const agentRoutine =
    !data.createdByAgentId && !data.createdByUserId?.trim() && data.originKind === CREW_ROUTINE_ORIGIN_KIND
      ? await isAgentAuthoredRoutine(input.db, input.companyId, data.originId)
      : false;
  const needsSource =
    !data.createdByAgentId && !data.createdByUserId?.trim() && !!data.assigneeAgentId && isCrewHousekeepingOrigin(data.originKind);
  const sourceExecutorAgentIds = needsSource
    ? await loadSourceExecutorAgentIds(input.db, housekeepingSourceIssueId(data))
    : [];
  const boardRoot = !data.createdByAgentId && !!data.createdByUserId?.trim() && !data.parentId && data.executionPolicy == null;
  const rootLabels = boardRoot ? await nonCodeLabelNames(input.db, input.companyId, data.labelIds) : new Set<string>();
  const researchLabel = rootLabels.has(CREW_RESEARCH_LABEL);
  const nonCodeLabel = rootLabels.size > 0;
  const trackingProject = isTrackingProject(config, data.projectId);
  const bugFindingEnabled = config.kind === "ok" && config.bugFinding.enabled;
  const repoProvider =
    config.kind === "ok" && boardRoot && bugFindingEnabled && !nonCodeLabel && !trackingProject
      ? await projectOriginProvider(input.db, input.companyId, projectId, config.bugFinding.gitlabHosts)
      : null;
  const checksOverrides = !!data.createdByAgentId && data.assigneeAdapterOverrides != null;
  const assigneeAdapterType = checksOverrides
    ? await loadAssigneeAdapterType(input.db, input.companyId, data.assigneeAgentId)
    : null;
  const catalog = checksOverrides ? (await loadModelSettings(input.db)).catalog : undefined;
  const decision = decideCreatePolicy({
    data,
    roles,
    ownerUserId,
    sourceExecutorAgentIds,
    researchLabel,
    nonCodeLabel,
    bugFindingEnabled,
    originProvider: repoProvider,
    trackingProject,
    roleAgentIds,
    projectAgentRoles,
    agentRoutine,
    projectOutsideParent,
    assigneeAdapterType,
    catalog,
  });
  if (decision.kind === "keep") return data;
  if (decision.kind === "reject") throw unprocessable(MESSAGES[decision.code], {
    code: decision.code,
    ...(decision.violations ? { violations: decision.violations } : {}),
  });
  // `roles` khác null ở mọi nhánh `set` của decideCreatePolicy.
  let policy;
  if (decision.template === "child") {
    const reviewer = await chooseChildReviewer(input.db, input.companyId, roles as CrewRoles, data);
    policy = buildCrewPolicy("child", roles as CrewRoles, null, {
      codexReviewerAgentId: reviewer?.runtime === "codex_local" ? reviewer.agentId : null,
    });
  } else {
    policy = buildCrewPolicy(decision.template, roles as CrewRoles, decision.ownerUserId);
  }
  return { ...data, executionPolicy: policy };
}

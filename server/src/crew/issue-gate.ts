import { isDeepStrictEqual } from "node:util";
import { and, desc, eq, inArray, isNotNull, isNull, like, notInArray, sql } from "drizzle-orm";
import {
  activityLog,
  agents,
  chatConversations,
  type Db,
  issueComments,
  issueExecutionDecisions,
  issues,
  issueThreadInteractions,
} from "@paperclipai/db";
import type { IssueExecutionPolicy, IssueExecutionStage, IssueExecutionStagePrincipal } from "@paperclipai/shared";
import { unprocessable } from "../errors.js";
import { logger } from "../middleware/logger.js";
import { persistActivity } from "../services/activity-log.js";
import { normalizeIssueExecutionPolicy, parseIssueExecutionState } from "../services/issue-execution-policy.js";
import { loadAssigneeAdapterType, loadProjectOriginUrl, prUrlMatchesOrigin } from "./issue-create-policy.js";
import { CREW_OVERRIDE_FORBIDDEN_MESSAGE, checkAgentAdapterOverrides } from "./model-policy.js";
import { codexReviewerOverrides, loadModelSettings, rootReviewerOverrides } from "./model-settings.js";
import {
  type CrewMergeEvidence,
  type CrewPrEvidence,
  type CrewRoles,
  type DocsCheckEvidence,
  housekeepingSourceIssueId,
  isCrewHousekeepingIssue,
  isTrackingProject,
  loadCrewCompanyConfig,
  loadSourceExecutorAgentIds,
  parseBugFindingTriage,
  parseCrewMergeEvidence,
  parseCrewPrEvidence,
  parseDocsCheckEvidence,
  policyGateFingerprint,
} from "./issue-policy.js";
import { bumpBugFindingRound, readBugFindingRuns } from "./bug-finding-runs.js";
import {
  agentAssignmentAllowed,
  loadCompanyRoleAgentIds,
  loadCrewRoles,
  loadProjectAgentRoles,
  type ProjectAgentRoles,
} from "./project-roles.js";

/** Cùng shape với BeforeIssueWriteInput trong core-hooks.ts (không import registry). */
export interface IssueWriteHookInput {
  tx: Db;
  issueId: string;
  existing: typeof issues.$inferSelect;
  /**
   * Chỉ được sửa bốn chỗ: `executionState = null` (kèm trả việc cho executor) khi issue Crew rời `done`/`cancelled`,
   * `executionState = null` khi board ép issue vào `done` mà lệnh ghi không tự đặt `executionState`, `executionState`
   * yêu cầu sửa ở stage owner (`restartAfterOwnerChanges`), và `assigneeAdapterOverrides` khi issue Crew đổi giữa
   * executor và agent của stage (`routeAssigneeOverrides`).
   */
  patch: Partial<typeof issues.$inferInsert>;
  actorAgentId: string | null | undefined;
  actorUserId: string | null | undefined;
}

export type GateActor = { kind: "agent"; agentId: string } | { kind: "board"; userId: string } | { kind: "system" };

export interface IssueGateFacts {
  locked: {
    status: string;
    executionPolicy: unknown;
    executionState: unknown;
    assigneeAgentId: string | null;
    assigneeUserId: string | null;
    /** Project hiện tại của issue; agent không được đổi (luật giao việc đọc vai trò theo project). */
    projectId?: string | null;
    /** Issue watchdog/recovery do hệ thống tạo (`isCrewHousekeepingIssue`). */
    housekeeping?: boolean;
    /** Issue không có policy nằm trong project theo dõi của company (`trackingProjectIds`): không áp cổng Crew. */
    tracking?: boolean;
  };
  patch: Readonly<Record<string, unknown>>;
  actor: GateActor;
  /** Vai trò của issue (theo project, không có thì theo file); `null` khi cấu hình lỗi (fail closed). */
  roles: CrewRoles | null;
  /**
   * Mọi agent reviewer/integrator của company (file ∪ vai trò theo project), cho luật giao việc.
   * Không truyền thì dùng `roles`.
   */
  roleAgentIds?: ReadonlySet<string>;
  /**
   * Trợ Lý/executor theo dòng vai trò crew.core của project của issue (agent không đổi được project), cho luật
   * giao việc giữa agent. Rỗng hoặc không truyền: project không có dòng vai trò, giữ hành vi cũ.
   */
  projectAgentRoles?: ReadonlyArray<ProjectAgentRoles>;
  /** Decision `approved` đã lưu của issue. */
  approvals: ReadonlyArray<{ stageId: string; actorAgentId: string | null; actorUserId: string | null; createdAt: Date }>;
  /** Lần gần nhất issue rời `done`/`cancelled` (activity `crew.gate.cycle_reset`); approval/bằng chứng cũ hơn không tính. */
  cycleStartedAt: Date | null;
  /**
   * Lần gần nhất stage docs phải chạy lại: yêu cầu sửa ở stage docs hoặc stage trước nó, hoặc lần owner yêu cầu sửa
   * làm issue chạy lại từ stage đầu (activity `crew.gate.owner_changes_restart`). Yêu cầu sửa ở stage push, và yêu cầu
   * sửa ở stage owner chưa có activity đó (issue đang dở từ trước luật chạy lại), không tính: stock nộp lại về đúng
   * stage đó chứ không về stage docs.
   */
  lastChangesRequestedAt: Date | null;
  /** Comment `crew-docs-check` mới nhất (chưa xóa) của participant stage docs. */
  docsEvidence: { evidence: DocsCheckEvidence; createdAt: Date } | null;
  /** Comment `crew-merge … pushed=yes|pr|merged` mới nhất (chưa xóa) của participant stage push. */
  pushEvidence: (CrewMergeEvidence & { createdAt: Date }) | null;
  /** Ticket tổng Bug Finding: comment `crew-pr` mới nhất (chưa xóa) của participant stage gộp. */
  prEvidence?: (CrewPrEvidence & { createdAt: Date }) | null;
  /**
   * Origin của project (`project_repos`, `null` khi chưa có) và `bugFinding.gitlabHosts` của company, để đối chiếu host URL
   * của `crew-pr`/`crew-merge` (`prUrlMatchesOrigin`). Không truyền là origin chưa biết.
   */
  projectOrigin?: { originUrl: string | null; gitlabHosts: readonly string[] };
  /** Ticket tổng Bug Finding: các lượt Bug Finding của issue (`BugFindingRunReader`). Không truyền là chưa có lượt. */
  bugFindingRuns?: ReadonlyArray<BugFindingRunFact>;
  /**
   * Ticket tổng Bug Finding: số con chưa xong của lô `bf-fix-<k>` mới nhất theo comment `crew-bf-triage` của agent đang
   * ghi; chỉ đếm khi agent ghi lên issue gốc. Không truyền là 0.
   */
  openBugFindingBatchChildren?: number;
  /** Ticket tổng Bug Finding: số thẻ `ask_user_questions` có `idempotencyKey` `crew-bf:…` còn chờ trả lời. */
  openBugFindingQuestions?: number;
  /**
   * Số việc con chưa xong (không `done`/`cancelled`) do board (owner, thành viên) tạo dưới issue gốc này; chỉ đếm khi
   * agent ghi lên issue gốc. Không truyền là 0.
   */
  openBoardChildren?: number;
}

export type IssueGateVerdict =
  | { kind: "allow"; notes: string[] }
  | { kind: "override"; violations: string[] }
  | {
      kind: "block";
      code:
        | "crew_policy_locked"
        | "crew_project_locked"
        | "crew_gate_blocked"
        | "crew_role_assignee"
        | "crew_assignment_forbidden";
      violations: string[];
    };

export const CREW_CYCLE_RESET_ACTION = "crew.gate.cycle_reset";
/** Owner yêu cầu sửa ở stage owner và issue gốc sẽ chạy lại từ stage đầu (`restartAfterOwnerChanges`). */
export const CREW_OWNER_CHANGES_RESTART_ACTION = "crew.gate.owner_changes_restart";
/** Reviewer cầu nối yêu cầu sửa ở stage Bug Finding của ticket tổng Bug Finding, issue chạy lại từ stage gộp. */
export const CREW_BUG_FINDING_RESTART_ACTION = "crew.gate.bug_finding_restart";
const TERMINAL_STATUSES = new Set(["done", "cancelled"]);

function has(patch: Readonly<Record<string, unknown>>, key: string): boolean {
  return Object.hasOwn(patch, key) && patch[key] !== undefined;
}

function safePolicy(value: unknown): IssueExecutionPolicy | null {
  try {
    return normalizeIssueExecutionPolicy(value);
  } catch {
    return null;
  }
}

function roundsOf(policy: unknown): number | null {
  const value = (policy as { maxReviewRounds?: unknown } | null)?.maxReviewRounds;
  return typeof value === "number" ? value : null;
}

function actorIs(principal: IssueExecutionStagePrincipal | null | undefined, actor: GateActor): boolean {
  if (!principal) return false;
  if (principal.type === "agent") return actor.kind === "agent" && actor.agentId === principal.agentId;
  return actor.kind === "board" && actor.userId === principal.userId;
}

function signedBy(
  principal: IssueExecutionStagePrincipal | null | undefined,
  a: { actorAgentId: string | null; actorUserId: string | null },
): boolean {
  if (!principal) return false;
  return principal.type === "agent"
    ? principal.agentId != null && a.actorAgentId === principal.agentId
    : principal.userId != null && a.actorUserId === principal.userId;
}

/** Policy sau lệnh ghi: policy trong patch nếu có, ngược lại policy đang lưu. */
export function effectivePolicy(
  locked: { executionPolicy: unknown },
  patch: Readonly<Record<string, unknown>>,
): IssueExecutionPolicy | null {
  const patched = Object.hasOwn(patch, "executionPolicy") && patch.executionPolicy !== undefined;
  return safePolicy(patched ? (patch.executionPolicy ?? null) : locked.executionPolicy);
}

function firstApprovalIndex(policy: IssueExecutionPolicy): number {
  const index = policy.stages.findIndex((s) => s.type === "approval");
  return index === -1 ? policy.stages.length : index;
}

/**
 * Policy đã ghim của ticket tổng Bug Finding (template `root-bf`): đúng 4 stage `review`, `review`, `approval`, `review`,
 * mỗi stage một participant, stage 0 và 3 cùng một agent (integrator), stage 1 là agent khác (reviewer cầu nối), stage 2
 * là user (owner). Cùng cách nhận biết `code-bf` với plugin (`crewPolicyKind`), trừ `maxReviewRounds` (không thuộc gate).
 */
export function isBugFindingRootPolicy(policy: IssueExecutionPolicy | null): boolean {
  if (policy?.stages.length !== 4) return false;
  const only = (index: number, type: "review" | "approval", principal: "agent" | "user") => {
    const stage = policy.stages[index]!;
    const participant = stage.participants[0];
    if (stage.type !== type || stage.participants.length !== 1 || participant?.type !== principal) return null;
    return (principal === "agent" ? participant.agentId : participant.userId) || null;
  };
  const merge = only(0, "review", "agent");
  const bridge = only(1, "review", "agent");
  const land = only(3, "review", "agent");
  return !!merge && !!bridge && !!only(2, "approval", "user") && merge === land && bridge !== land;
}

function bugFindingStage(policy: IssueExecutionPolicy | null, index: 0 | 1): IssueExecutionStage[] {
  return policy && isBugFindingRootPolicy(policy) ? [policy.stages[index] as IssueExecutionStage] : [];
}

/**
 * Stage cần bằng chứng docs: stage `review` thứ hai, đứng trước stage `approval` đầu (template gốc: stage 2,
 * integrator merge + docs); ticket tổng Bug Finding là stage 0 (integrator gộp + docs + PR). Xác định theo policy đã
 * ghim trên issue, không theo vai trò trong file cấu hình.
 */
export function docsGateStages(policy: IssueExecutionPolicy | null): IssueExecutionStage[] {
  if (!policy) return [];
  if (isBugFindingRootPolicy(policy)) return bugFindingStage(policy, 0);
  const beforeApproval = firstApprovalIndex(policy);
  const reviews = policy.stages.filter((s, index) => s.type === "review" && index < beforeApproval);
  return reviews.length >= 2 ? [reviews[1] as IssueExecutionStage] : [];
}

/** Stage push: mọi stage `review` đứng sau stage `approval` đầu (template gốc: stage 4, integrator push). */
export function pushGateStages(policy: IssueExecutionPolicy | null): IssueExecutionStage[] {
  if (!policy) return [];
  const afterApproval = firstApprovalIndex(policy);
  return policy.stages.filter((s, index) => s.type === "review" && index > afterApproval);
}

/** Stage cần bằng chứng `crew-pr` (ticket tổng Bug Finding: stage 0, cùng stage docs); loại khác không có. */
export function prGateStages(policy: IssueExecutionPolicy | null): IssueExecutionStage[] {
  return bugFindingStage(policy, 0);
}

/** Stage cần lượt Bug Finding cho head PR (ticket tổng Bug Finding: stage 1, reviewer cầu nối); loại khác không có. */
export function bugFindingGateStages(policy: IssueExecutionPolicy | null): IssueExecutionStage[] {
  return bugFindingStage(policy, 1);
}

/**
 * Stage cầu nối Bug Finding chạy lại từ đầu khi reviewer yêu cầu sửa: lô sửa finding của Trợ Lý có code mới, nên
 * integrator phải gộp lại, kiểm docs và cập nhật PR (stage 0) trước khi Bug Finding chạy lại cho head mới.
 */
export function bugFindingRestartStages(policy: IssueExecutionPolicy | null): IssueExecutionStage[] {
  return bugFindingStage(policy, 1);
}

/** Lượt Bug Finding của issue (bảng `crew_bug_finding_runs` của plugin). */
export interface BugFindingRunFact {
  headSha: string;
  /** `queued`, `running`, `succeeded`, `failed`, `timeout`, `skipped`. */
  state: string;
}

export type BugFindingRunReader = (input: { db: Db; companyId: string; issueId: string }) => Promise<BugFindingRunFact[]>;

let bugFindingRunReader: BugFindingRunReader = readBugFindingRuns;

/**
 * Thay nơi H2 đọc lượt Bug Finding (test); `null` trả về mặc định là bảng `crew_bug_finding_runs` của plugin
 * (`readBugFindingRuns`). Bảng chưa có thì như chưa có lượt nào, nên stage cầu nối không qua được.
 */
export function setBugFindingRunReader(reader: BugFindingRunReader | null): void {
  bugFindingRunReader = reader ?? readBugFindingRuns;
}

const BUG_FINDING_PASSED_STATES = new Set(["succeeded", "skipped"]);

/**
 * Stage owner chạy lại từ đầu khi bị yêu cầu sửa: stage `approval` đứng sau stage docs (template gốc: stage 3). Stock
 * nộp lại về đúng stage đã yêu cầu sửa và giữ các stage đã xong, nên code mới của con sửa sẽ không được reviewer xem ở
 * cấp gốc, không được integrator gộp và kiểm docs, rồi pull request giao commit cũ. Research và việc con không có stage
 * docs nên không đổi.
 */
export function ownerRestartStages(policy: IssueExecutionPolicy | null): IssueExecutionStage[] {
  const docsStage = docsGateStages(policy)[0];
  if (!policy || !docsStage) return [];
  const docsIndex = policy.stages.findIndex((s) => s.id === docsStage.id);
  return policy.stages.filter((s, index) => s.type === "approval" && index > docsIndex);
}

/**
 * State thay cho state yêu cầu sửa stock vừa dựng ở stage owner (hay stage cầu nối Bug Finding của ticket tổng Bug
 * Finding, `bugFindingRestartStages`), hoặc `null` khi lệnh ghi không phải yêu cầu sửa ở các stage đó. Xóa `completedStageIds` và stage hiện tại để lần nộp lại của Trợ Lý (stock `nextPendingStage`) bắt đầu
 * từ stage đầu: reviewer, integrator gộp và kiểm docs, owner duyệt lại, rồi stage push. Giữ `currentStageType`,
 * `currentParticipant` (owner đã yêu cầu sửa) và `lastDecisionId` để giao diện và Trợ Lý đọc đúng quyết định.
 * Luôn chạy lại, kể cả khi không có code mới: server không biết lần sửa có code hay không, còn bỏ sót code chưa
 * review thì đắt hơn một vòng reviewer và integrator không có gì mới.
 */
export function restartAfterOwnerChanges(
  policy: IssueExecutionPolicy | null,
  lockedExecutionState: unknown,
  nextExecutionState: unknown,
): Record<string, unknown> | null {
  const lockedState = parseIssueExecutionState(lockedExecutionState);
  const nextState = parseIssueExecutionState(nextExecutionState);
  if (lockedState?.status !== "pending" || nextState?.status !== "changes_requested") return null;
  if (!lockedState.currentStageId || nextState.currentStageId !== lockedState.currentStageId) return null;
  const restartStages = [...ownerRestartStages(policy), ...bugFindingRestartStages(policy)];
  if (!restartStages.some((s) => s.id === lockedState.currentStageId)) return null;
  return {
    ...(nextExecutionState as Record<string, unknown>),
    currentStageId: null,
    currentStageIndex: null,
    completedStageIds: [],
  };
}

export const CODEX_REVIEWER_FALLBACK_NOTE = "codex_reviewer_fallback";

type ParsedState = NonNullable<ReturnType<typeof parseIssueExecutionState>>;

/** So hai state bỏ qua `currentParticipant`; vòng JSON để key `undefined` và thứ tự key không làm lệch. */
function sameStateExceptParticipant(a: ParsedState, b: ParsedState): boolean {
  const strip = (state: ParsedState) => JSON.parse(JSON.stringify({ ...state, currentParticipant: null })) as unknown;
  return isDeepStrictEqual(strip(a), strip(b));
}

/**
 * Lệnh ghi đổi agent đang chờ ở cùng một stage `pending` (participant cũ là thành viên stage, mới là agent khác). Stock
 * không làm việc này cho actor agent/hệ thống (leo thang sang owner là user, sửa thành viên stage chỉ khi participant cũ
 * không còn trong stage), nên mọi lệnh như vậy ngoài board phải đúng phép chuyển reviewer Codex → reviewer Claude.
 */
function pendingAgentSwap(
  lockedState: ParsedState | null,
  nextState: ParsedState | null,
  policy: IssueExecutionPolicy | null,
): boolean {
  if (lockedState?.status !== "pending" || nextState?.status !== "pending") return false;
  if (!lockedState.currentStageId || lockedState.currentStageId !== nextState.currentStageId) return false;
  const from = lockedState.currentParticipant;
  const to = nextState.currentParticipant;
  if (from?.type !== "agent" || to?.type !== "agent" || !to.agentId || from.agentId === to.agentId) return false;
  const stage = policy?.stages.find((s) => s.id === lockedState.currentStageId);
  return !!stage?.participants.some((p) => p.type === "agent" && p.agentId === from.agentId);
}

/**
 * Phép chuyển reviewer Codex → reviewer Claude (plugin gọi khi reviewer Codex lỗi hay công tắc Codex bị tắt): lệnh của
 * hệ thống, issue đang `in_review` và ở lại `in_review`, stage `review` đang chờ reviewer Codex của project, reviewer
 * Claude của project có trong stage, state mới chỉ khác `currentParticipant` (→ reviewer Claude) và assignee mới là
 * reviewer Claude. Policy không đổi (đã khóa riêng), số vòng giữ nguyên, không mở lại vòng, không board override.
 */
function codexReviewerSwapAllowed(f: IssueGateFacts, lockedState: ParsedState, nextState: ParsedState, policy: IssueExecutionPolicy | null): boolean {
  const from = f.roles?.codexReviewerAgentId;
  const to = f.roles?.reviewerAgentId;
  if (f.actor.kind !== "system" || !from || !to || from === to) return false;
  if (f.locked.status !== "in_review" || (has(f.patch, "status") && f.patch.status !== "in_review")) return false;
  if (lockedState.currentStageType !== "review" || lockedState.currentParticipant?.agentId !== from) return false;
  if (nextState.currentParticipant?.agentId !== to || (nextState.currentParticipant.userId ?? null) !== null) return false;
  const stage = policy?.stages.find((s) => s.id === lockedState.currentStageId);
  if (!stage?.participants.some((p) => p.type === "agent" && p.agentId === to)) return false;
  if (!has(f.patch, "assigneeAgentId") || f.patch.assigneeAgentId !== to) return false;
  if (has(f.patch, "assigneeUserId") && f.patch.assigneeUserId !== null) return false;
  return sameStateExceptParticipant(lockedState, nextState);
}

export function evaluateIssueGate(f: IssueGateFacts): IssueGateVerdict {
  const notes: string[] = [];
  // Agent không chuyển issue sang project khác (kể cả về không project): luật giao việc đọc vai trò theo project, nên
  // chuyển sang project không có dòng vai trò rồi đổi assignee sẽ lách được luật. Board chuyển project như stock.
  if (f.actor.kind === "agent" && has(f.patch, "projectId") && (f.patch.projectId ?? null) !== (f.locked.projectId ?? null)) {
    return { kind: "block", code: "crew_project_locked", violations: ["project_changed"] };
  }
  // Tiến trình nền stock (watchdog, recovery, evaluation) trên issue không có policy Crew: giữ hành vi gốc.
  if (f.actor.kind === "system" && policyGateFingerprint(f.locked.executionPolicy) === "none") {
    return { kind: "allow", notes };
  }

  // Issue theo dõi (không policy, trong project theo dõi): giữ hành vi stock, trừ khi lần ghi này gắn policy vào.
  if (f.locked.tracking && policyGateFingerprint(f.locked.executionPolicy) === "none" && !(f.patch.executionPolicy ?? null)) {
    return { kind: "allow", notes };
  }

  const policyPatched = Object.hasOwn(f.patch, "executionPolicy") && f.patch.executionPolicy !== undefined;
  if (policyPatched && f.actor.kind !== "board") {
    const next = f.patch.executionPolicy ?? null;
    const raised = roundsOf(next) !== null && roundsOf(next) !== roundsOf(f.locked.executionPolicy);
    const nextFingerprint = policyGateFingerprint(next);
    if (nextFingerprint !== policyGateFingerprint(f.locked.executionPolicy) || raised) {
      return { kind: "block", code: "crew_policy_locked", violations: ["policy_changed"] };
    }
  }

  const nextStatus = has(f.patch, "status") ? String(f.patch.status) : f.locked.status;
  // Chỉ board được hủy việc; agent muốn bỏ việc thì chuyển `blocked` kèm lý do.
  if (f.actor.kind === "agent" && nextStatus === "cancelled" && f.locked.status !== "cancelled") {
    return { kind: "block", code: "crew_gate_blocked", violations: ["agent_cancel_forbidden"] };
  }

  const policy = effectivePolicy(f.locked, f.patch);
  const lockedState = parseIssueExecutionState(f.locked.executionState);
  const nextState = has(f.patch, "executionState")
    ? parseIssueExecutionState(f.patch.executionState)
    : Object.hasOwn(f.patch, "executionState") && f.patch.executionState === null
      ? null
      : lockedState;

  if (f.actor.kind !== "board" && pendingAgentSwap(lockedState, nextState, policy)) {
    if (!codexReviewerSwapAllowed(f, lockedState as ParsedState, nextState as ParsedState, policy)) {
      return { kind: "block", code: "crew_policy_locked", violations: ["participant_changed"] };
    }
    notes.push(CODEX_REVIEWER_FALLBACK_NOTE);
  }

  // Agent không tự giao việc cho reviewer/integrator; workflow stock giao cho participant stage thì được.
  const roleAgentIds =
    f.roleAgentIds ??
    new Set(f.roles ? [f.roles.reviewerAgentId, f.roles.integratorAgentId, f.roles.codexReviewerAgentId ?? ""].filter(Boolean) : []);
  if (f.actor.kind === "agent" && has(f.patch, "assigneeAgentId")) {
    const target = f.patch.assigneeAgentId as string | null;
    const workflowHandoff =
      nextState?.status === "pending" &&
      nextState.currentParticipant?.type === "agent" &&
      nextState.currentParticipant.agentId === target;
    const roleAgent = target !== null && roleAgentIds.has(target.toLowerCase());
    if (roleAgent && target !== f.locked.assigneeAgentId && !workflowHandoff) {
      return { kind: "block", code: "crew_role_assignee", violations: ["role_assignee"] };
    }
    // Giao việc giữa agent đi qua Trợ Lý: stock trả việc về người làm (returnAssignee) hay giao cho participant
    // của stage thì vẫn được.
    const returnAgents = [lockedState?.returnAssignee, nextState?.returnAssignee].flatMap((p) =>
      p?.type === "agent" && p.agentId ? [p.agentId] : [],
    );
    const actorAgentId = f.actor.agentId;
    if (
      target !== null &&
      target !== f.locked.assigneeAgentId &&
      !workflowHandoff &&
      !returnAgents.includes(target) &&
      (f.projectAgentRoles ?? []).some(
        (roles) =>
          !agentAssignmentAllowed({
            actorAgentId,
            targetAgentId: target,
            roles,
            currentAssigneeAgentId: f.locked.assigneeAgentId,
          }),
      )
    ) {
      return { kind: "block", code: "crew_assignment_forbidden", violations: ["assignment_forbidden"] };
    }
  }

  // Việc nội bộ của hệ thống (watchdog, recovery) không có policy: agent được giao đóng được như stock.
  if (f.locked.housekeeping && !policy?.stages.length) return { kind: "allow", notes };

  // Agent nộp việc (không phải participant đang duyệt một stage): route đã gộp transition stock nên `done` của người làm
  // tới đây thành state `pending` của stage đầu (hoặc `done` khi không còn stage). Còn việc con board thêm chưa xong thì
  // chặn, để Trợ Lý nhận việc đó vào kế hoạch trước khi yêu cầu gốc sang Reviewer.
  const submitting =
    f.actor.kind === "agent" &&
    lockedState?.status !== "pending" &&
    (nextState?.status === "pending" || (nextStatus === "done" && f.locked.status !== "done"));
  if (submitting && (f.openBoardChildren ?? 0) > 0) {
    return { kind: "block", code: "crew_gate_blocked", violations: ["board_child_open"] };
  }
  // Ticket tổng Bug Finding: Trợ Lý chỉ nộp lại khi mọi con của lô sửa finding mới nhất đã xong và thẻ hỏi owner đã trả
  // lời, để Bug Finding chạy lại một lần cho cả lô.
  if (submitting && isBugFindingRootPolicy(effectivePolicy(f.locked, f.patch))) {
    const open = [
      ...((f.openBugFindingBatchChildren ?? 0) > 0 ? ["bf_batch_open"] : []),
      ...((f.openBugFindingQuestions ?? 0) > 0 ? ["bf_questions_open"] : []),
    ];
    if (open.length > 0) return { kind: "block", code: "crew_gate_blocked", violations: open };
  }

  const enteringDone = nextStatus === "done" && f.locked.status !== "done";
  const newlyCompleted = (stage: IssueExecutionStage) =>
    (nextState?.completedStageIds ?? []).includes(stage.id) &&
    !(lockedState?.completedStageIds ?? []).includes(stage.id);
  const docsStages = docsGateStages(policy);
  const pushStages = pushGateStages(policy);
  const completingDocsStage = docsStages.some(newlyCompleted);
  const completingPushStage = pushStages.some(newlyCompleted);
  const bugFindingStages = bugFindingGateStages(policy);
  const completingBugFindingStage = bugFindingStages.some(newlyCompleted);
  if (!enteringDone && !completingDocsStage && !completingPushStage && !completingBugFindingStage) {
    return { kind: "allow", notes };
  }

  const violations: string[] = [];
  if (!f.roles) violations.push("roles_unconfigured");
  if (!policy || policy.stages.length === 0) violations.push("policy_missing");

  // Người làm việc của vòng hiện tại không ký duyệt cho chính mình. Assignee hiện tại chỉ được coi là participant
  // (không bị loại) khi workflow đang chờ đúng nó ở một stage, ví dụ integrator ở stage push.
  const assignee: IssueExecutionStagePrincipal | null = f.locked.assigneeAgentId
    ? { type: "agent", agentId: f.locked.assigneeAgentId }
    : f.locked.assigneeUserId
      ? { type: "user", userId: f.locked.assigneeUserId }
      : null;
  const assigneeIsPendingParticipant =
    lockedState?.status === "pending" &&
    !!assignee &&
    !!lockedState.currentParticipant &&
    lockedState.currentParticipant.type === assignee.type &&
    (assignee.type === "agent"
      ? lockedState.currentParticipant.agentId === assignee.agentId
      : lockedState.currentParticipant.userId === assignee.userId);
  const workers: IssueExecutionStagePrincipal[] = [
    lockedState?.returnAssignee,
    nextState?.returnAssignee,
    assigneeIsPendingParticipant ? null : assignee,
  ].filter((p): p is IssueExecutionStagePrincipal => Boolean(p));
  const returnAssignees = [lockedState?.returnAssignee, nextState?.returnAssignee];
  const cycleStart = f.cycleStartedAt?.getTime() ?? null;

  const approvedInThisWrite = (stage: IssueExecutionStage) =>
    lockedState?.status === "pending" &&
    lockedState.currentStageId === stage.id &&
    nextState?.lastDecisionOutcome === "approved" &&
    (nextState.completedStageIds ?? []).includes(stage.id) &&
    actorIs(lockedState.currentParticipant, f.actor) &&
    !returnAssignees.some((p) => actorIs(p, f.actor));

  const stagesToCheck = enteringDone
    ? (policy?.stages ?? [])
    : [
        ...(completingDocsStage ? docsStages : []),
        ...(completingBugFindingStage ? bugFindingStages : []),
        ...(completingPushStage ? pushStages : []),
      ];
  for (const stage of stagesToCheck) {
    const stored = f.approvals.some(
      (a) =>
        a.stageId === stage.id &&
        (cycleStart === null || a.createdAt.getTime() > cycleStart) &&
        !workers.some((p) => signedBy(p, a)),
    );
    if (!stored && !approvedInThisWrite(stage)) violations.push(`stage_unapproved:${stage.id}`);
  }

  const checkDocs = docsStages.length > 0 && (enteringDone || completingDocsStage);
  if (checkDocs) {
    const docs = f.docsEvidence;
    const freshAfter = Math.max(cycleStart ?? -Infinity, f.lastChangesRequestedAt?.getTime() ?? -Infinity);
    if (!docs) violations.push("docs_missing");
    else if (docs.createdAt.getTime() <= freshAfter) violations.push("docs_stale");
    else if (docs.evidence.exit === 3) notes.push("docs_uninitialized");
    else if (docs.evidence.exit !== 0) violations.push(`docs_failed:${docs.evidence.exit}`);
  }

  // URL PR/MR của integrator phải thuộc origin của project (host, provider), không chỉ đúng định dạng.
  const prUrlOk = (url: string) =>
    prUrlMatchesOrigin(url, f.projectOrigin?.originUrl ?? null, f.projectOrigin?.gitlabHosts ?? []);
  // Ticket tổng Bug Finding, stage gộp: PR phải mở/cập nhật sau bằng chứng docs và đúng merged commit của nó.
  const bugFindingRoot = bugFindingStages.length > 0;
  if (bugFindingRoot && checkDocs) {
    const pr = f.prEvidence;
    if (!pr || (f.docsEvidence && pr.createdAt.getTime() <= f.docsEvidence.createdAt.getTime())) violations.push("pr_missing");
    else if (f.docsEvidence && pr.sha !== f.docsEvidence.evidence.commit) violations.push("pr_sha_mismatch");
    else if (!prUrlOk(pr.pr)) violations.push("pr_origin_mismatch");
  }
  // Stage cầu nối: cần lượt Bug Finding `succeeded` (hay `skipped` do owner cho bỏ qua) cho đúng head PR hiện tại.
  if (bugFindingRoot && (enteringDone || completingBugFindingStage)) {
    const head = f.prEvidence?.sha;
    const passed = !!head && (f.bugFindingRuns ?? []).some((run) => run.headSha === head && BUG_FINDING_PASSED_STATES.has(run.state));
    if (!passed) violations.push("bf_missing");
  }

  if (pushStages.length > 0 && (enteringDone || completingPushStage)) {
    // Push phải sau quyết định duyệt của owner (cùng vòng) và đúng merged commit của bằng chứng docs.
    const pushStageIndex = policy?.stages.findIndex((s) => s.id === pushStages[0]?.id) ?? -1;
    const ownerStageIds = new Set(
      (policy?.stages ?? []).filter((s, index) => s.type === "approval" && index < pushStageIndex).map((s) => s.id),
    );
    const ownerApprovedAt = f.approvals
      .filter((a) => ownerStageIds.has(a.stageId) && (cycleStart === null || a.createdAt.getTime() > cycleStart))
      .reduce<number | null>((latest, a) => Math.max(latest ?? -Infinity, a.createdAt.getTime()), null);
    const push = f.pushEvidence;
    const fresh = !!push && ownerApprovedAt !== null && push.createdAt.getTime() > ownerApprovedAt;
    if (bugFindingRoot) {
      // Ticket tổng Bug Finding: integrator tự merge PR, `pushed=pr` (PR còn mở) không đủ; PR merge phải đúng PR của `crew-pr`.
      if (!push || !fresh || !push.merge || !push.pr) violations.push("merge_missing");
      else if (push.sha !== f.docsEvidence?.evidence.commit) violations.push("push_sha_mismatch");
      else {
        if (!prUrlOk(push.pr)) violations.push("push_origin_mismatch");
        // Không có `crew-pr` thì `pr_missing` đã chặn; chỉ so khi có.
        if (f.prEvidence && push.pr !== f.prEvidence.pr) violations.push("merge_pr_mismatch");
      }
    } else if (!push) violations.push("push_missing");
    else if (!fresh) violations.push("push_stale");
    else if (push.sha !== f.docsEvidence?.evidence.commit) violations.push("push_sha_mismatch");
    else if (push.pr && !prUrlOk(push.pr)) violations.push("push_origin_mismatch");
  }

  if (violations.length === 0) return { kind: "allow", notes };
  if (f.actor.kind === "board") return { kind: "override", violations };
  return { kind: "block", code: "crew_gate_blocked", violations };
}

const GATE_KEYS = ["status", "executionPolicy", "executionState", "assigneeAgentId", "projectId"] as const;

function actorOf(input: IssueWriteHookInput): GateActor {
  if (input.actorAgentId) return { kind: "agent", agentId: input.actorAgentId };
  if (input.actorUserId) return { kind: "board", userId: input.actorUserId };
  return { kind: "system" };
}

const BLOCK_MESSAGES: Record<string, string> = {
  crew_policy_locked: "Crew: agent và tiến trình nền không được sửa stage của executionPolicy.",
  crew_project_locked: "Crew: agent không được chuyển issue sang project khác; việc này chỉ board làm.",
  crew_role_assignee: "Crew: agent không được giao việc cho agent reviewer hoặc integrator.",
  crew_assignment_forbidden:
    "Crew: chỉ Trợ Lý của project giao việc cho agent khác; agent khác chỉ giao cho executor của project.",
  agent_cancel_forbidden: "Crew: chỉ board được hủy issue; agent muốn bỏ việc thì chuyển blocked kèm lý do.",
  participant_changed:
    "Crew: chỉ board đổi người đang review; hệ thống chỉ được chuyển reviewer Codex sang reviewer Claude của project.",
  pr_origin_mismatch:
    "Crew: URL trong crew-pr không thuộc origin của project (host khác origin, hoặc host GitLab chưa khai báo trong bugFinding.gitlabHosts).",
  push_origin_mismatch:
    "Crew: URL trong crew-merge không thuộc origin của project (host khác origin, hoặc host GitLab chưa khai báo trong bugFinding.gitlabHosts).",
  merge_pr_mismatch: "Crew: URL trong crew-merge pushed=merged phải trùng URL của crew-pr mới nhất.",
  board_child_open:
    "Crew: yêu cầu còn việc con do owner hoặc thành viên thêm chưa xong; nhận việc đó vào kế hoạch và chờ nó xong rồi mới nộp.",
};

export async function crewBeforeIssueWrite(input: IssueWriteHookInput): Promise<void> {
  const patch = input.patch as Readonly<Record<string, unknown>>;
  if (input.actorAgentId && Object.hasOwn(patch, "assigneeAdapterOverrides")) {
    // Override kiểm theo runtime của assignee sau lệnh ghi (patch có `assigneeAgentId` thì lấy nó, kể cả null).
    const assigneeAgentId = Object.hasOwn(patch, "assigneeAgentId")
      ? (patch.assigneeAgentId as string | null | undefined)
      : input.existing.assigneeAgentId;
    const adapterType =
      patch.assigneeAdapterOverrides != null
        ? await loadAssigneeAdapterType(input.tx, input.existing.companyId, assigneeAgentId)
        : null;
    const catalog = patch.assigneeAdapterOverrides != null ? (await loadModelSettings(input.tx)).catalog : undefined;
    const violations = checkAgentAdapterOverrides(patch.assigneeAdapterOverrides, adapterType, catalog);
    if (violations.length > 0) {
      const config = await loadCrewCompanyConfig(input.existing.companyId);
      if (config.kind !== "absent") {
        throw unprocessable(CREW_OVERRIDE_FORBIDDEN_MESSAGE, { code: "crew_override_forbidden", violations });
      }
    }
  }
  if (!GATE_KEYS.some((key) => Object.hasOwn(patch, key))) return;
  const { tx, issueId } = input;
  const [locked] = await tx.select().from(issues).where(eq(issues.id, issueId)).for("update");
  if (!locked) return;
  const actor = actorOf(input);
  // Actor agent: không đọc được bảng vai trò thì từ chối (503, thử lại) như H4, không rơi về vai trò file.
  const onReadError = actor.kind === "agent" ? "throw" : "fallback";
  const config = await loadCrewRoles({ db: tx, companyId: locked.companyId, projectId: locked.projectId, onReadError });
  if (config.kind === "absent") return;
  const roles = config.kind === "ok" ? config.roles : null;
  const roleAgentIds =
    actor.kind === "agent" && has(patch, "assigneeAgentId")
      ? await loadCompanyRoleAgentIds({ db: tx, companyId: locked.companyId, onReadError })
      : undefined;
  const projectAgentRoles: ProjectAgentRoles[] = [];
  if (actor.kind === "agent" && has(patch, "assigneeAgentId") && patch.assigneeAgentId !== null) {
    const rolesOfProject = await loadProjectAgentRoles({
      db: tx,
      companyId: locked.companyId,
      projectId: locked.projectId,
      onReadError,
    });
    if (rolesOfProject) projectAgentRoles.push(rolesOfProject);
  }

  const decisions = await tx
    .select({
      stageId: issueExecutionDecisions.stageId,
      outcome: issueExecutionDecisions.outcome,
      actorAgentId: issueExecutionDecisions.actorAgentId,
      actorUserId: issueExecutionDecisions.actorUserId,
      createdAt: issueExecutionDecisions.createdAt,
    })
    .from(issueExecutionDecisions)
    .where(eq(issueExecutionDecisions.issueId, issueId));

  const latestActivity = async (action: string) => {
    const [row] = await tx
      .select({ createdAt: activityLog.createdAt })
      .from(activityLog)
      .where(and(eq(activityLog.entityType, "issue"), eq(activityLog.entityId, issueId), eq(activityLog.action, action)))
      .orderBy(desc(activityLog.createdAt))
      .limit(1);
    return row ?? null;
  };
  const cycle = await latestActivity(CREW_CYCLE_RESET_ACTION);
  const ownerRestart = await latestActivity(CREW_OWNER_CHANGES_RESTART_ACTION);
  const bugFindingRestart = await latestActivity(CREW_BUG_FINDING_RESTART_ACTION);

  const pinnedPolicy = effectivePolicy(locked, patch);
  // Bằng chứng docs chỉ cũ đi khi stage docs chạy lại: yêu cầu sửa ở stage docs hay trước nó (stock nộp lại về đúng
  // stage đó), hoặc owner yêu cầu sửa và issue chạy lại từ stage đầu (activity restart, ghi cùng lệnh ghi đó). Yêu cầu
  // sửa ở stage sau stage docs tự nó không tính: stage push được nộp lại về đúng stage push, và yêu cầu sửa ở stage
  // owner từ trước luật chạy lại được nộp lại về stage owner. Stage push vẫn phải giao đúng commit của bằng chứng docs
  // (`push_sha_mismatch`) và sau lần duyệt mới nhất của owner (`push_stale`).
  const docsStageIndex = pinnedPolicy?.stages.findIndex((s) => s.id === docsGateStages(pinnedPolicy)[0]?.id) ?? -1;
  const afterDocsStageIds = new Set(
    docsStageIndex < 0 ? [] : (pinnedPolicy?.stages.slice(docsStageIndex + 1).map((s) => s.id) ?? []),
  );
  const changes = decisions
    .filter((d) => d.outcome === "changes_requested" && !afterDocsStageIds.has(d.stageId))
    .map((d) => d.createdAt.getTime());
  if (ownerRestart) changes.push(ownerRestart.createdAt.getTime());
  if (bugFindingRestart) changes.push(bugFindingRestart.createdAt.getTime());
  const agentsOf = (stages: IssueExecutionStage[]) => [
    ...new Set(stages.flatMap((stage) => stage.participants.flatMap((p) => (p.type === "agent" && p.agentId ? [p.agentId] : [])))),
  ];
  // Comment mới nhất (chưa xóa) của các tác giả, dòng đầu bắt đầu bằng `prefix`.
  const latestComment = async (authors: string[], prefix: string) => {
    if (authors.length === 0) return null;
    const [comment] = await tx
      .select({ body: issueComments.body, createdAt: issueComments.createdAt })
      .from(issueComments)
      .where(
        and(
          eq(issueComments.issueId, issueId),
          inArray(issueComments.authorAgentId, authors),
          isNull(issueComments.deletedAt),
          like(issueComments.body, `${prefix} %`),
        ),
      )
      .orderBy(desc(issueComments.createdAt))
      .limit(1);
    return comment ?? null;
  };
  let docsEvidence: IssueGateFacts["docsEvidence"] = null;
  const docsComment = await latestComment(agentsOf(docsGateStages(pinnedPolicy)), "crew-docs-check");
  const docsParsed = docsComment ? parseDocsCheckEvidence(docsComment.body) : null;
  if (docsComment && docsParsed) docsEvidence = { evidence: docsParsed, createdAt: docsComment.createdAt };
  let pushEvidence: IssueGateFacts["pushEvidence"] = null;
  const pushComment = await latestComment(agentsOf(pushGateStages(pinnedPolicy)), "crew-merge");
  const pushParsed = pushComment ? parseCrewMergeEvidence(pushComment.body) : null;
  if (pushComment && pushParsed) pushEvidence = { ...pushParsed, createdAt: pushComment.createdAt };

  // Ticket tổng Bug Finding: PR của stage gộp, lượt Bug Finding (chỉ khi lệnh ghi đổi trạng thái/state).
  const bugFindingRoot = isBugFindingRootPolicy(pinnedPolicy);
  const writesState = has(patch, "status") || has(patch, "executionState");
  let prEvidence: IssueGateFacts["prEvidence"] = null;
  let bugFindingRuns: BugFindingRunFact[] = [];
  if (bugFindingRoot) {
    const prComment = await latestComment(agentsOf(prGateStages(pinnedPolicy)), "crew-pr");
    const prParsed = prComment ? parseCrewPrEvidence(prComment.body) : null;
    if (prComment && prParsed) prEvidence = { ...prParsed, createdAt: prComment.createdAt };
    if (writesState) bugFindingRuns = await bugFindingRunReader({ db: tx, companyId: locked.companyId, issueId });
  }

  // Origin của project chỉ cần khi có URL PR/MR để đối chiếu. Đọc lỗi (plugin chưa cài, bảng chưa có): origin chưa biết,
  // nên MR GitLab bị chặn còn PR GitHub giữ luật cũ.
  let projectOrigin: IssueGateFacts["projectOrigin"];
  if (prEvidence || pushEvidence?.pr) {
    let originUrl: string | null = null;
    try {
      originUrl = await loadProjectOriginUrl(tx, locked.companyId, locked.projectId);
    } catch (err) {
      logger.warn({ err, companyId: locked.companyId, projectId: locked.projectId }, "crew: reading project_repos failed; PR origin unknown");
    }
    projectOrigin = { originUrl, gitlabHosts: config.kind === "ok" ? config.bugFinding.gitlabHosts : [] };
  }

  // Việc con board thêm dưới issue gốc, chưa xong: chỉ cần khi agent đổi trạng thái/state của issue gốc. Đọc trong
  // transaction của lệnh ghi.
  let openBoardChildren = 0;
  if (actor.kind === "agent" && !locked.parentId && (has(patch, "status") || has(patch, "executionState"))) {
    const [row] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(issues)
      .where(
        and(
          eq(issues.companyId, locked.companyId),
          eq(issues.parentId, issueId),
          isNotNull(issues.createdByUserId),
          isNull(issues.createdByAgentId),
          notInArray(issues.status, [...TERMINAL_STATUSES]),
        ),
      );
    openBoardChildren = row?.count ?? 0;
  }

  // Ticket tổng Bug Finding, agent ghi lên gốc: con chưa xong của lô `bf-fix-<k>` mới nhất (theo `crew-bf-triage` của
  // chính agent đó; con thuộc lô khi mô tả có `crew-child … revision=bf-fix-<k>` hoặc `crew-bf finding=… run=<n>`) và
  // thẻ hỏi `crew-bf:` còn chờ.
  let openBugFindingBatchChildren = 0;
  let openBugFindingQuestions = 0;
  if (bugFindingRoot && actor.kind === "agent" && !locked.parentId && writesState) {
    const triageComment = await latestComment([actor.agentId], "crew-bf-triage");
    const triage = triageComment ? parseBugFindingTriage(triageComment.body) : null;
    if (triage) {
      const batchLine = String.raw`(^|\n)crew-child key=\S+ revision=bf-fix-${triage.batch}[ \t\r]*(\n|$)`;
      const findingLine = String.raw`(^|\n)crew-bf finding=\S+ run=${triage.run}([ \t\r]|\n|$)`;
      const [row] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(issues)
        .where(
          and(
            eq(issues.companyId, locked.companyId),
            eq(issues.parentId, issueId),
            notInArray(issues.status, [...TERMINAL_STATUSES]),
            sql`(${issues.description} ~ ${batchLine} OR ${issues.description} ~ ${findingLine})`,
          ),
        );
      openBugFindingBatchChildren = row?.count ?? 0;
    }
    const [questions] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(issueThreadInteractions)
      .where(
        and(
          eq(issueThreadInteractions.companyId, locked.companyId),
          eq(issueThreadInteractions.issueId, issueId),
          eq(issueThreadInteractions.kind, "ask_user_questions"),
          eq(issueThreadInteractions.status, "pending"),
          like(issueThreadInteractions.idempotencyKey, "crew-bf:%"),
        ),
      );
    openBugFindingQuestions = questions?.count ?? 0;
  }

  // Issue watchdog/recovery chỉ được miễn khi người ghi không phải agent đang làm issue nguồn.
  let housekeeping = isCrewHousekeepingIssue(locked);
  if (housekeeping && actor.kind === "agent") {
    const sourceExecutors = await loadSourceExecutorAgentIds(tx, housekeepingSourceIssueId(locked));
    housekeeping = !sourceExecutors.includes(actor.agentId);
  }

  const verdict = evaluateIssueGate({
    locked: {
      status: locked.status,
      executionPolicy: locked.executionPolicy,
      executionState: locked.executionState,
      assigneeAgentId: locked.assigneeAgentId,
      assigneeUserId: locked.assigneeUserId,
      projectId: locked.projectId,
      housekeeping,
      tracking: isTrackingProject(config, locked.projectId),
    },
    patch,
    actor,
    roles,
    roleAgentIds,
    projectAgentRoles,
    approvals: decisions.filter((d) => d.outcome === "approved"),
    cycleStartedAt: cycle?.createdAt ?? null,
    lastChangesRequestedAt: changes.length > 0 ? new Date(Math.max(...changes)) : null,
    docsEvidence,
    pushEvidence,
    prEvidence,
    projectOrigin,
    bugFindingRuns,
    openBoardChildren,
    openBugFindingBatchChildren,
    openBugFindingQuestions,
  });
  if (verdict.kind === "block") {
    const message =
      BLOCK_MESSAGES[verdict.violations[0] ?? ""] ??
      BLOCK_MESSAGES[verdict.code] ??
      `Crew: chưa đủ điều kiện để hoàn tất: ${verdict.violations.join(", ")}.`;
    throw unprocessable(message, { code: verdict.code, violations: verdict.violations });
  }

  const actorFields =
    actor.kind === "board"
      ? { actorType: "user" as const, actorId: actor.userId }
      : actor.kind === "agent"
        ? { actorType: "agent" as const, actorId: actor.agentId, agentId: actor.agentId }
        : { actorType: "system" as const, actorId: "crew" };
  const activity = (action: string, details: Record<string, unknown>) =>
    persistActivity(tx, {
      companyId: locked.companyId,
      ...actorFields,
      action,
      entityType: "issue",
      entityId: issueId,
      issueId,
      details,
    });

  const nextStatus = has(patch, "status") ? String(patch.status) : locked.status;
  if (TERMINAL_STATUSES.has(locked.status) && !TERMINAL_STATUSES.has(nextStatus)) {
    // Mở lại issue Crew: xóa state cũ để stock chạy lại các stage của policy đã ghim từ đầu ở lần done sau.
    const crewIssue = policyGateFingerprint(pinnedPolicy) !== "none";
    let handBack: ReopenHandBack = { kind: "none" };
    if (crewIssue) {
      input.patch.executionState = null;
      handBack = await reopenHandBack(tx, locked, patch, pinnedPolicy);
      if (handBack.kind === "executor") {
        input.patch.assigneeAgentId = handBack.agentId;
        // Như runUpdate làm khi đổi owner: vô hiệu phiên bản handoff đã quan sát.
        input.patch.statusVersion ??= sql`${issues.statusVersion} + 1` as unknown as number;
      }
    }
    await activity(CREW_CYCLE_RESET_ACTION, {
      fromStatus: locked.status,
      toStatus: nextStatus,
      executionStateCleared: crewIssue,
      ...(handBack.kind === "executor"
        ? { reassignedFromAgentId: locked.assigneeAgentId, reassignedToAgentId: handBack.agentId }
        : {}),
    });
    if (handBack.kind === "unknown") {
      await activity("crew.gate.reopen_executor_unknown", {
        assigneeAgentId: locked.assigneeAgentId,
        reason: handBack.reason,
      });
    }
  }
  const restarted = has(patch, "executionState")
    ? restartAfterOwnerChanges(pinnedPolicy, locked.executionState, patch.executionState)
    : null;
  if (restarted) {
    input.patch.executionState = restarted as typeof input.patch.executionState;
    const lockedState = parseIssueExecutionState(locked.executionState);
    const bugFindingStage = bugFindingRestartStages(pinnedPolicy).some((s) => s.id === lockedState?.currentStageId);
    await activity(bugFindingStage ? CREW_BUG_FINDING_RESTART_ACTION : CREW_OWNER_CHANGES_RESTART_ACTION, {
      stageId: lockedState?.currentStageId ?? null,
      decisionId: restarted.lastDecisionId ?? null,
      clearedStageIds: lockedState?.completedStageIds ?? [],
    });
    if (!bugFindingStage && isBugFindingRootPolicy(pinnedPolicy)) await bumpBugFindingRound(tx, locked.companyId, issueId);
  }
  if (verdict.kind === "override") {
    // Board ép vào `done` mà không qua transition stock (ví dụ plugin gọi thẳng service): không để stage `pending`
    // treo trên issue đã đóng. Cùng kết quả với stock khi board ép issue đang chờ stage.
    if (nextStatus === "done" && locked.status !== "done" && !has(patch, "executionState")) {
      input.patch.executionState = null;
    }
    await activity("crew.policy.board_override", { violations: verdict.violations, toStatus: patch.status ?? null });
  }
  if (verdict.kind === "allow" && verdict.notes.includes(CODEX_REVIEWER_FALLBACK_NOTE)) {
    await activity("crew.gate.codex_reviewer_fallback", {
      fromAgentId: roles?.codexReviewerAgentId ?? null,
      toAgentId: roles?.reviewerAgentId ?? null,
    });
  }
  if (verdict.kind === "allow" && verdict.notes.includes("docs_uninitialized")) {
    await activity("crew.docs_gate.uninitialized", { note: "repo chưa crew-docs init; docs gate cho qua" });
  }
  await routeAssigneeOverrides(tx, locked, input.patch, pinnedPolicy, roles);
}

/** Activity của hệ thống ghi override khi issue Crew đổi người làm; `executorOverrides` là override executor để lại. */
export const CREW_ASSIGNEE_OVERRIDES_ACTION = "crew.assignee_overrides.handoff";

/**
 * `assigneeAdapterOverrides` là một cột trên issue và lõi áp nó cho bất kỳ agent nào đang là assignee, nên override
 * Trợ Lý (hay fallback) đặt cho executor sẽ theo issue sang reviewer khi stock chuyển stage. Trên issue có policy Crew,
 * khi assignee đổi mà lệnh ghi không tự đặt override:
 * - giao cho agent của stage (reviewer, reviewer Codex, integrator): override theo vai trò của cài đặt model, reviewer
 *   Codex theo vai `reviewer-codex`, reviewer chạy `claude_local` trên issue gốc (trừ gốc research) theo vai
 *   `reviewer-root`, còn lại `null` (chạy theo cấu hình agent); issue con và gốc research theo cấu hình agent;
 * - giao cho executor: override executor đó để lại lần trước (activity hệ thống), nếu còn hợp với runtime của nó;
 *   không có mà vừa rời agent của stage thì `null`; executor sang executor khác thì giữ như stock.
 * Executor rời issue thì override của nó được ghi lại (kể cả `null`), để vòng sau trả về đúng override.
 */
async function routeAssigneeOverrides(
  tx: Db,
  locked: typeof issues.$inferSelect,
  patch: Partial<typeof issues.$inferInsert>,
  policy: IssueExecutionPolicy | null,
  roles: CrewRoles | null,
): Promise<void> {
  if (!policy || policyGateFingerprint(policy) === "none") return;
  if (!Object.hasOwn(patch, "assigneeAgentId") || patch.assigneeAgentId === undefined) return;
  const from = locked.assigneeAgentId?.toLowerCase() ?? null;
  const to = patch.assigneeAgentId?.toLowerCase() ?? null;
  if (from === to) return;
  const participants = new Set(
    [
      ...policy.stages.flatMap((s) => s.participants.flatMap((p) => (p.type === "agent" && p.agentId ? [p.agentId] : []))),
      roles?.reviewerAgentId,
      roles?.integratorAgentId,
      roles?.codexReviewerAgentId,
    ].flatMap((id) => (id ? [id.toLowerCase()] : [])),
  );
  const executorLeaving = from !== null && !participants.has(from);
  const explicit = Object.hasOwn(patch, "assigneeAdapterOverrides") && patch.assigneeAdapterOverrides !== undefined;

  let next: Record<string, unknown> | null | undefined;
  if (!explicit && to !== null) {
    if (participants.has(to)) {
      if (to === roles?.codexReviewerAgentId?.toLowerCase()) next = codexReviewerOverrides(await loadModelSettings(tx));
      else if (
        to === roles?.reviewerAgentId?.toLowerCase() &&
        locked.parentId === null &&
        !isResearchRootPolicy(policy) &&
        (await loadAssigneeAdapterType(tx, locked.companyId, to)) === "claude_local"
      ) {
        next = rootReviewerOverrides(await loadModelSettings(tx));
      } else next = null;
    } else {
      const stashed = await lastExecutorOverrides(tx, locked, to);
      if (stashed !== undefined) {
        const adapterType = stashed === null ? null : await loadAssigneeAdapterType(tx, locked.companyId, to);
        next =
          stashed === null || checkAgentAdapterOverrides(stashed, adapterType, (await loadModelSettings(tx)).catalog).length === 0
            ? stashed
            : null;
      } else if (from !== null && participants.has(from)) {
        next = null;
      }
    }
  }
  if (next !== undefined) patch.assigneeAdapterOverrides = next;
  if (!executorLeaving && next === undefined) return;
  await persistActivity(tx, {
    companyId: locked.companyId,
    actorType: "system",
    actorId: "crew",
    action: CREW_ASSIGNEE_OVERRIDES_ACTION,
    entityType: "issue",
    entityId: locked.id,
    issueId: locked.id,
    details: {
      fromAgentId: from,
      toAgentId: to,
      ...(executorLeaving ? { executorOverrides: locked.assigneeAdapterOverrides ?? null } : {}),
      // Giá trị cột sau lệnh ghi: `next === null` là override bị xóa, chỉ `undefined` mới giữ giá trị cũ.
      assigneeAdapterOverrides: explicit
        ? (patch.assigneeAdapterOverrides ?? null)
        : next !== undefined
          ? next
          : (locked.assigneeAdapterOverrides ?? null),
    },
  });
}

/**
 * Policy đã ghim của gốc yêu cầu research: đúng 2 stage `review` rồi `approval` (template `research`, server ghim khi
 * board tạo gốc có nhãn `research`). Cùng cách nhận biết với Trợ Lý và plugin (`crewPolicyKind`); đọc policy chứ không
 * đọc nhãn vì nhãn có thể bị gỡ sau khi tạo, còn policy quyết định luồng review.
 */
function isResearchRootPolicy(policy: IssueExecutionPolicy): boolean {
  return policy.stages.length === 2 && policy.stages[0]!.type === "review" && policy.stages[1]!.type === "approval";
}

/** Override executor `agentId` để lại lần gần nhất rời issue; `undefined` khi chưa từng rời (activity chỉ hệ thống ghi). */
async function lastExecutorOverrides(
  tx: Db,
  locked: typeof issues.$inferSelect,
  agentId: string,
): Promise<Record<string, unknown> | null | undefined> {
  const [row] = await tx
    .select({ details: activityLog.details })
    .from(activityLog)
    .where(
      and(
        eq(activityLog.companyId, locked.companyId),
        eq(activityLog.entityType, "issue"),
        eq(activityLog.entityId, locked.id),
        eq(activityLog.action, CREW_ASSIGNEE_OVERRIDES_ACTION),
        eq(activityLog.actorType, "system"),
        eq(activityLog.actorId, "crew"),
        sql`${activityLog.details}->>'fromAgentId' = ${agentId}`,
        sql`jsonb_exists(${activityLog.details}, 'executorOverrides')`,
      ),
    )
    .orderBy(desc(activityLog.createdAt), desc(activityLog.id))
    .limit(1);
  if (!row) return undefined;
  const value = row.details?.executorOverrides;
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

type ReopenHandBack = { kind: "none" } | { kind: "executor"; agentId: string } | { kind: "unknown"; reason: string };

/** Trạng thái agent mà stock không cho nhận việc (`agent-assignability.ts`); `paused` được chấp nhận theo ruling. */
const UNASSIGNABLE_AGENT_STATUSES = new Set(["terminated", "pending_approval"]);

/**
 * Issue Crew mở lại mà assignee là participant agent của một stage (reviewer/integrator): giao lại cho executor
 * của vòng trước để vòng mới chạy đủ các stage. Executor chỉ lấy từ `returnAssignee` của state cũ (do transition
 * stock ghi); không lấy từ comment, vì agent bất kỳ viết được comment.
 */
async function reopenHandBack(
  tx: Db,
  locked: typeof issues.$inferSelect,
  patch: Readonly<Record<string, unknown>>,
  policy: IssueExecutionPolicy | null,
): Promise<ReopenHandBack> {
  if (has(patch, "assigneeAgentId") || has(patch, "assigneeUserId")) return { kind: "none" };
  const current = locked.assigneeAgentId;
  if (!current || !policy) return { kind: "none" };
  const participantAgents = new Set(
    policy.stages.flatMap((s) => s.participants.flatMap((p) => (p.type === "agent" && p.agentId ? [p.agentId] : []))),
  );
  if (!participantAgents.has(current)) return { kind: "none" };

  const returnAssignee = parseIssueExecutionState(locked.executionState)?.returnAssignee;
  const candidate = returnAssignee?.type === "agent" ? (returnAssignee.agentId ?? null) : null;
  if (!candidate) return { kind: "unknown", reason: "no_return_assignee" };
  if (participantAgents.has(candidate)) return { kind: "unknown", reason: "executor_is_stage_participant" };

  // Stock cấm đổi agent khi task gắn kênh ngoài (`chat_binding_agent_locked` trong issueService.update).
  const [binding] = await tx
    .select({ id: chatConversations.id })
    .from(chatConversations)
    .where(and(eq(chatConversations.companyId, locked.companyId), eq(chatConversations.issueId, locked.id)))
    .limit(1);
  if (binding) return { kind: "unknown", reason: "chat_bound" };

  const [agent] = await tx
    .select({ status: agents.status })
    .from(agents)
    .where(and(eq(agents.id, candidate), eq(agents.companyId, locked.companyId)))
    .limit(1);
  if (!agent || UNASSIGNABLE_AGENT_STATUSES.has(agent.status)) return { kind: "unknown", reason: "executor_unavailable" };
  return { kind: "executor", agentId: candidate };
}

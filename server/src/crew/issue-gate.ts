import { and, desc, eq, inArray, isNull, like, sql } from "drizzle-orm";
import {
  activityLog,
  agents,
  chatConversations,
  type Db,
  issueComments,
  issueExecutionDecisions,
  issues,
} from "@paperclipai/db";
import type { IssueExecutionPolicy, IssueExecutionStage, IssueExecutionStagePrincipal } from "@paperclipai/shared";
import { unprocessable } from "../errors.js";
import { persistActivity } from "../services/activity-log.js";
import { normalizeIssueExecutionPolicy, parseIssueExecutionState } from "../services/issue-execution-policy.js";
import { loadAssigneeAdapterType } from "./issue-create-policy.js";
import { CREW_OVERRIDE_FORBIDDEN_MESSAGE, checkAgentAdapterOverrides } from "./model-policy.js";
import {
  type CrewMergeEvidence,
  type CrewRoles,
  type DocsCheckEvidence,
  housekeepingSourceIssueId,
  isCrewHousekeepingIssue,
  isTrackingProject,
  loadCrewCompanyConfig,
  loadSourceExecutorAgentIds,
  parseCrewMergeEvidence,
  parseDocsCheckEvidence,
  policyGateFingerprint,
} from "./issue-policy.js";
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
   * Chỉ được sửa hai chỗ: `executionState = null` (kèm trả việc cho executor) khi issue Crew rời `done`/`cancelled`,
   * và `executionState = null` khi board ép issue vào `done` mà lệnh ghi không tự đặt `executionState`.
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
  lastChangesRequestedAt: Date | null;
  /** Comment `crew-docs-check` mới nhất (chưa xóa) của participant stage docs. */
  docsEvidence: { evidence: DocsCheckEvidence; createdAt: Date } | null;
  /** Comment `crew-merge … pushed=yes` mới nhất (chưa xóa) của participant stage push. */
  pushEvidence: (CrewMergeEvidence & { createdAt: Date }) | null;
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
 * Stage cần bằng chứng docs: stage `review` thứ hai, đứng trước stage `approval` đầu (template gốc: stage 2,
 * integrator merge + docs). Xác định theo policy đã ghim trên issue, không theo vai trò trong file cấu hình.
 */
export function docsGateStages(policy: IssueExecutionPolicy | null): IssueExecutionStage[] {
  if (!policy) return [];
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

export const CODEX_REVIEWER_FALLBACK_NOTE = "codex_reviewer_fallback";

/**
 * Dấu vân tay policy sau khi đổi reviewer Codex của project sang reviewer Claude (cùng project) ở mọi stage `review`;
 * `null` khi project không có reviewer Codex hoặc policy không có participant đó. Plugin dùng khi reviewer Codex lỗi
 * hay công tắc Codex bị tắt: lệnh ghi của hệ thống mang đúng policy này được qua cổng khóa policy, không thành
 * board override. Mọi thay đổi khác của stage vẫn bị khóa.
 */
export function codexReviewerFallbackFingerprint(policy: unknown, roles: CrewRoles | null): string | null {
  const from = roles?.codexReviewerAgentId;
  const to = roles?.reviewerAgentId;
  const stages = (policy as { stages?: unknown } | null)?.stages;
  if (!from || !to || from === to || !Array.isArray(stages)) return null;
  let swapped = false;
  const next = stages.map((raw) => {
    const stage = raw as { type?: unknown; participants?: unknown };
    if (stage.type !== "review" || !Array.isArray(stage.participants)) return raw;
    return {
      ...stage,
      participants: stage.participants.map((p: { type?: unknown; agentId?: unknown }) => {
        if (p?.type !== "agent" || p.agentId !== from) return p;
        swapped = true;
        return { ...p, agentId: to };
      }),
    };
  });
  return swapped ? policyGateFingerprint({ stages: next }) : null;
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
      const fallback =
        f.actor.kind === "system" &&
        !raised &&
        nextFingerprint === codexReviewerFallbackFingerprint(f.locked.executionPolicy, f.roles);
      if (!fallback) return { kind: "block", code: "crew_policy_locked", violations: ["policy_changed"] };
      notes.push(CODEX_REVIEWER_FALLBACK_NOTE);
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

  // Agent không tự giao việc cho reviewer/integrator; workflow stock giao cho participant stage thì được.
  const roleAgentIds =
    f.roleAgentIds ?? new Set(f.roles ? [f.roles.reviewerAgentId, f.roles.integratorAgentId] : []);
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

  const enteringDone = nextStatus === "done" && f.locked.status !== "done";
  const newlyCompleted = (stage: IssueExecutionStage) =>
    (nextState?.completedStageIds ?? []).includes(stage.id) &&
    !(lockedState?.completedStageIds ?? []).includes(stage.id);
  const docsStages = docsGateStages(policy);
  const pushStages = pushGateStages(policy);
  const completingDocsStage = docsStages.some(newlyCompleted);
  const completingPushStage = pushStages.some(newlyCompleted);
  if (!enteringDone && !completingDocsStage && !completingPushStage) return { kind: "allow", notes };

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
    : [...(completingDocsStage ? docsStages : []), ...(completingPushStage ? pushStages : [])];
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
    if (!push) violations.push("push_missing");
    else if (ownerApprovedAt === null || push.createdAt.getTime() <= ownerApprovedAt) violations.push("push_stale");
    else if (push.sha !== f.docsEvidence?.evidence.commit) violations.push("push_sha_mismatch");
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
    const violations = checkAgentAdapterOverrides(patch.assigneeAdapterOverrides, adapterType);
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
  const changes = decisions.filter((d) => d.outcome === "changes_requested").map((d) => d.createdAt.getTime());

  const [cycle] = await tx
    .select({ createdAt: activityLog.createdAt })
    .from(activityLog)
    .where(
      and(
        eq(activityLog.entityType, "issue"),
        eq(activityLog.entityId, issueId),
        eq(activityLog.action, CREW_CYCLE_RESET_ACTION),
      ),
    )
    .orderBy(desc(activityLog.createdAt))
    .limit(1);

  const pinnedPolicy = effectivePolicy(locked, patch);
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
  });
  if (verdict.kind === "block") {
    const message =
      BLOCK_MESSAGES[verdict.code] ??
      BLOCK_MESSAGES[verdict.violations[0] ?? ""] ??
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

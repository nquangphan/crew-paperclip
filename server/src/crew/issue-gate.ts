import { and, desc, eq, inArray, isNull, like } from "drizzle-orm";
import { activityLog, type Db, issueComments, issueExecutionDecisions, issues } from "@paperclipai/db";
import type { IssueExecutionPolicy, IssueExecutionStage, IssueExecutionStagePrincipal } from "@paperclipai/shared";
import { unprocessable } from "../errors.js";
import { persistActivity } from "../services/activity-log.js";
import { normalizeIssueExecutionPolicy, parseIssueExecutionState } from "../services/issue-execution-policy.js";
import {
  type CrewRoles,
  type DocsCheckEvidence,
  loadCrewCompanyConfig,
  parseDocsCheckEvidence,
  policyGateFingerprint,
} from "./issue-policy.js";

/** Cùng shape với BeforeIssueWriteInput trong core-hooks.ts (không import registry). */
export interface IssueWriteHookInput {
  tx: Db;
  issueId: string;
  existing: typeof issues.$inferSelect;
  patch: Readonly<Partial<typeof issues.$inferInsert>>;
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
  };
  patch: Readonly<Record<string, unknown>>;
  actor: GateActor;
  /** Vai trò từ file cấu hình; `null` khi cấu hình của company lỗi (fail closed). */
  roles: CrewRoles | null;
  /** Decision `approved` đã lưu của issue. */
  approvals: ReadonlyArray<{ stageId: string; actorAgentId: string | null; actorUserId: string | null; createdAt: Date }>;
  /** Lần gần nhất issue rời `done`/`cancelled` (activity `crew.gate.cycle_reset`); approval/bằng chứng cũ hơn không tính. */
  cycleStartedAt: Date | null;
  lastChangesRequestedAt: Date | null;
  /** Comment `crew-docs-check` mới nhất (chưa xóa) của participant stage integrator. */
  docsEvidence: { evidence: DocsCheckEvidence; createdAt: Date } | null;
}

export type IssueGateVerdict =
  | { kind: "allow"; notes: string[] }
  | { kind: "override"; violations: string[] }
  | { kind: "block"; code: "crew_policy_locked" | "crew_gate_blocked" | "crew_role_assignee"; violations: string[] };

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

/**
 * Stage cần bằng chứng docs: mọi stage `review` trừ stage `review` đầu tiên (template gốc: stage integrator).
 * Xác định theo policy đã ghim trên issue, không theo vai trò hiện tại trong file cấu hình.
 */
export function docsGateStages(policy: IssueExecutionPolicy | null): IssueExecutionStage[] {
  if (!policy) return [];
  const firstReview = policy.stages.findIndex((s) => s.type === "review");
  return policy.stages.filter((s, index) => s.type === "review" && index !== firstReview);
}

export function evaluateIssueGate(f: IssueGateFacts): IssueGateVerdict {
  const notes: string[] = [];
  // Tiến trình nền stock (watchdog, recovery, evaluation) trên issue không có policy Crew: giữ hành vi gốc.
  if (f.actor.kind === "system" && policyGateFingerprint(f.locked.executionPolicy) === "none") {
    return { kind: "allow", notes };
  }

  const policyPatched = Object.hasOwn(f.patch, "executionPolicy") && f.patch.executionPolicy !== undefined;
  if (policyPatched && f.actor.kind !== "board") {
    const next = f.patch.executionPolicy ?? null;
    const raised = roundsOf(next) !== null && roundsOf(next) !== roundsOf(f.locked.executionPolicy);
    if (policyGateFingerprint(next) !== policyGateFingerprint(f.locked.executionPolicy) || raised) {
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

  // Agent không tự giao việc cho reviewer/integrator; workflow stock giao cho participant stage thì được.
  if (f.actor.kind === "agent" && f.roles && has(f.patch, "assigneeAgentId")) {
    const target = f.patch.assigneeAgentId as string | null;
    const roleAgent = target === f.roles.reviewerAgentId || target === f.roles.integratorAgentId;
    const workflowHandoff =
      nextState?.status === "pending" &&
      nextState.currentParticipant?.type === "agent" &&
      nextState.currentParticipant.agentId === target;
    if (roleAgent && target !== f.locked.assigneeAgentId && !workflowHandoff) {
      return { kind: "block", code: "crew_role_assignee", violations: ["role_assignee"] };
    }
  }

  const enteringDone = nextStatus === "done" && f.locked.status !== "done";
  const docsStages = docsGateStages(policy);
  const completingDocsStage = docsStages.some(
    (stage) =>
      (nextState?.completedStageIds ?? []).includes(stage.id) &&
      !(lockedState?.completedStageIds ?? []).includes(stage.id),
  );
  if (!enteringDone && !completingDocsStage) return { kind: "allow", notes };

  const violations: string[] = [];
  if (!f.roles) violations.push("roles_unconfigured");
  if (!policy || policy.stages.length === 0) violations.push("policy_missing");

  // Người làm việc của vòng hiện tại không ký duyệt cho chính mình.
  const workers: IssueExecutionStagePrincipal[] = [
    lockedState?.returnAssignee,
    nextState?.returnAssignee,
    f.locked.assigneeAgentId ? { type: "agent", agentId: f.locked.assigneeAgentId } : null,
    f.locked.assigneeUserId ? { type: "user", userId: f.locked.assigneeUserId } : null,
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

  const stagesToCheck = enteringDone ? (policy?.stages ?? []) : docsStages;
  for (const stage of stagesToCheck) {
    const stored = f.approvals.some(
      (a) =>
        a.stageId === stage.id &&
        (cycleStart === null || a.createdAt.getTime() > cycleStart) &&
        !workers.some((p) => signedBy(p, a)),
    );
    if (!stored && !approvedInThisWrite(stage)) violations.push(`stage_unapproved:${stage.id}`);
  }

  if (docsStages.length > 0) {
    const docs = f.docsEvidence;
    const freshAfter = Math.max(cycleStart ?? -Infinity, f.lastChangesRequestedAt?.getTime() ?? -Infinity);
    if (!docs) violations.push("docs_missing");
    else if (docs.createdAt.getTime() <= freshAfter) violations.push("docs_stale");
    else if (docs.evidence.exit === 3) notes.push("docs_uninitialized");
    else if (docs.evidence.exit !== 0) violations.push(`docs_failed:${docs.evidence.exit}`);
  }

  if (violations.length === 0) return { kind: "allow", notes };
  if (f.actor.kind === "board") return { kind: "override", violations };
  return { kind: "block", code: "crew_gate_blocked", violations };
}

const GATE_KEYS = ["status", "executionPolicy", "executionState", "assigneeAgentId"] as const;

function actorOf(input: IssueWriteHookInput): GateActor {
  if (input.actorAgentId) return { kind: "agent", agentId: input.actorAgentId };
  if (input.actorUserId) return { kind: "board", userId: input.actorUserId };
  return { kind: "system" };
}

const BLOCK_MESSAGES: Record<string, string> = {
  crew_policy_locked: "Crew: agent và tiến trình nền không được sửa stage của executionPolicy.",
  crew_role_assignee: "Crew: agent không được giao việc cho agent reviewer hoặc integrator.",
  agent_cancel_forbidden: "Crew: chỉ board được hủy issue; agent muốn bỏ việc thì chuyển blocked kèm lý do.",
};

export async function crewBeforeIssueWrite(input: IssueWriteHookInput): Promise<void> {
  const patch = input.patch as Readonly<Record<string, unknown>>;
  if (!GATE_KEYS.some((key) => Object.hasOwn(patch, key))) return;
  const { tx, issueId } = input;
  const [locked] = await tx.select().from(issues).where(eq(issues.id, issueId)).for("update");
  if (!locked) return;
  const config = await loadCrewCompanyConfig(locked.companyId);
  if (config.kind === "absent") return;
  const roles = config.kind === "ok" ? config.roles : null;
  const actor = actorOf(input);

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

  const docsAuthors = [
    ...new Set(
      docsGateStages(effectivePolicy(locked, patch)).flatMap((stage) =>
        stage.participants.flatMap((p) => (p.type === "agent" && p.agentId ? [p.agentId] : [])),
      ),
    ),
  ];
  let docsEvidence: IssueGateFacts["docsEvidence"] = null;
  if (docsAuthors.length > 0) {
    const [comment] = await tx
      .select({ body: issueComments.body, createdAt: issueComments.createdAt })
      .from(issueComments)
      .where(
        and(
          eq(issueComments.issueId, issueId),
          inArray(issueComments.authorAgentId, docsAuthors),
          isNull(issueComments.deletedAt),
          like(issueComments.body, "crew-docs-check %"),
        ),
      )
      .orderBy(desc(issueComments.createdAt))
      .limit(1);
    const evidence = comment ? parseDocsCheckEvidence(comment.body) : null;
    if (comment && evidence) docsEvidence = { evidence, createdAt: comment.createdAt };
  }

  const verdict = evaluateIssueGate({
    locked: {
      status: locked.status,
      executionPolicy: locked.executionPolicy,
      executionState: locked.executionState,
      assigneeAgentId: locked.assigneeAgentId,
      assigneeUserId: locked.assigneeUserId,
    },
    patch,
    actor,
    roles,
    approvals: decisions.filter((d) => d.outcome === "approved"),
    cycleStartedAt: cycle?.createdAt ?? null,
    lastChangesRequestedAt: changes.length > 0 ? new Date(Math.max(...changes)) : null,
    docsEvidence,
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
    await activity(CREW_CYCLE_RESET_ACTION, { fromStatus: locked.status, toStatus: nextStatus });
  }
  if (verdict.kind === "override") {
    await activity("crew.policy.board_override", { violations: verdict.violations, toStatus: patch.status ?? null });
  }
  if (verdict.kind === "allow" && verdict.notes.includes("docs_uninitialized")) {
    await activity("crew.docs_gate.uninitialized", { note: "repo chưa crew-docs init; docs gate cho qua" });
  }
}

import { and, desc, eq, isNull, like } from "drizzle-orm";
import { type Db, issueComments, issueExecutionDecisions, issues } from "@paperclipai/db";
import type { IssueExecutionPolicy, IssueExecutionStage, IssueExecutionStagePrincipal } from "@paperclipai/shared";
import { unprocessable } from "../errors.js";
import { persistActivity } from "../services/activity-log.js";
import { normalizeIssueExecutionPolicy, parseIssueExecutionState } from "../services/issue-execution-policy.js";
import {
  type CrewRoles,
  type DocsCheckEvidence,
  loadCrewRoles,
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
  locked: { status: string; executionPolicy: unknown; executionState: unknown };
  patch: Readonly<Record<string, unknown>>;
  actor: GateActor;
  roles: CrewRoles | null;
  /** Decision `approved` đã lưu của issue. */
  approvals: ReadonlyArray<{ stageId: string; actorAgentId: string | null; actorUserId: string | null }>;
  lastChangesRequestedAt: Date | null;
  /** Comment `crew-docs-check` mới nhất (chưa xóa) của agent integrator. */
  docsEvidence: { evidence: DocsCheckEvidence; createdAt: Date } | null;
}

export type IssueGateVerdict =
  | { kind: "allow"; notes: string[] }
  | { kind: "override"; violations: string[] }
  | { kind: "block"; code: "crew_policy_locked" | "crew_gate_blocked"; violations: string[] };

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
  return principal.type === "agent" ? a.actorAgentId === principal.agentId : a.actorUserId === principal.userId;
}

export function evaluateIssueGate(f: IssueGateFacts): IssueGateVerdict {
  const notes: string[] = [];
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

  const policy = safePolicy(policyPatched ? (f.patch.executionPolicy ?? null) : f.locked.executionPolicy);
  const lockedState = parseIssueExecutionState(f.locked.executionState);
  const nextState = has(f.patch, "executionState")
    ? parseIssueExecutionState(f.patch.executionState)
    : Object.hasOwn(f.patch, "executionState") && f.patch.executionState === null
      ? null
      : lockedState;
  const enteringDone = nextStatus === "done" && f.locked.status !== "done";

  const integratorStage: IssueExecutionStage | null =
    policy && f.roles
      ? (policy.stages.find((s) =>
          s.participants.some((p) => p.type === "agent" && p.agentId === f.roles?.integratorAgentId),
        ) ?? null)
      : null;
  const completingIntegrator =
    integratorStage !== null &&
    (nextState?.completedStageIds ?? []).includes(integratorStage.id) &&
    !(lockedState?.completedStageIds ?? []).includes(integratorStage.id);
  if (!enteringDone && !completingIntegrator) return { kind: "allow", notes };

  const violations: string[] = [];
  if (!f.roles) violations.push("roles_unconfigured");
  if (!policy || policy.stages.length === 0) violations.push("policy_missing");

  const executor = lockedState?.returnAssignee ?? null;
  const approvedInThisWrite = (stage: IssueExecutionStage) =>
    lockedState?.status === "pending" &&
    lockedState.currentStageId === stage.id &&
    nextState?.lastDecisionOutcome === "approved" &&
    (nextState.completedStageIds ?? []).includes(stage.id) &&
    actorIs(lockedState.currentParticipant, f.actor) &&
    !actorIs(executor, f.actor);

  const stagesToCheck = enteringDone ? (policy?.stages ?? []) : integratorStage ? [integratorStage] : [];
  for (const stage of stagesToCheck) {
    const stored = f.approvals.some((a) => a.stageId === stage.id && !signedBy(executor, a));
    if (!stored && !approvedInThisWrite(stage)) violations.push(`stage_unapproved:${stage.id}`);
  }

  if (integratorStage) {
    const docs = f.docsEvidence;
    if (!docs) violations.push("docs_missing");
    else if (f.lastChangesRequestedAt && docs.createdAt.getTime() <= f.lastChangesRequestedAt.getTime())
      violations.push("docs_stale");
    else if (docs.evidence.exit === 3) notes.push("docs_uninitialized");
    else if (docs.evidence.exit !== 0) violations.push(`docs_failed:${docs.evidence.exit}`);
  }

  if (violations.length === 0) return { kind: "allow", notes };
  if (f.actor.kind === "board") return { kind: "override", violations };
  return { kind: "block", code: "crew_gate_blocked", violations };
}

const GATE_KEYS = ["status", "executionPolicy", "executionState"] as const;

function actorOf(input: IssueWriteHookInput): GateActor {
  if (input.actorAgentId) return { kind: "agent", agentId: input.actorAgentId };
  if (input.actorUserId) return { kind: "board", userId: input.actorUserId };
  return { kind: "system" };
}

export async function crewBeforeIssueWrite(input: IssueWriteHookInput): Promise<void> {
  const patch = input.patch as Readonly<Record<string, unknown>>;
  if (!GATE_KEYS.some((key) => Object.hasOwn(patch, key))) return;
  const { tx, issueId } = input;
  const [locked] = await tx.select().from(issues).where(eq(issues.id, issueId)).for("update");
  if (!locked) return;
  const actor = actorOf(input);
  const roles = await loadCrewRoles(tx, locked.companyId);
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
  let docsEvidence: IssueGateFacts["docsEvidence"] = null;
  if (roles) {
    const [comment] = await tx
      .select({ body: issueComments.body, createdAt: issueComments.createdAt })
      .from(issueComments)
      .where(
        and(
          eq(issueComments.issueId, issueId),
          eq(issueComments.authorAgentId, roles.integratorAgentId),
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
    locked: { status: locked.status, executionPolicy: locked.executionPolicy, executionState: locked.executionState },
    patch,
    actor,
    roles,
    approvals: decisions.filter((d) => d.outcome === "approved"),
    lastChangesRequestedAt: changes.length > 0 ? new Date(Math.max(...changes)) : null,
    docsEvidence,
  });
  if (verdict.kind === "block") {
    const message =
      verdict.code === "crew_policy_locked"
        ? "Crew: agent và tiến trình nền không được sửa stage của executionPolicy."
        : verdict.violations.includes("agent_cancel_forbidden")
          ? "Crew: chỉ board được hủy issue; agent muốn bỏ việc thì chuyển blocked kèm lý do."
          : `Crew: chưa đủ điều kiện để hoàn tất: ${verdict.violations.join(", ")}.`;
    throw unprocessable(message, { code: verdict.code, violations: verdict.violations });
  }
  const actorFields =
    actor.kind === "board"
      ? { actorType: "user" as const, actorId: actor.userId }
      : actor.kind === "agent"
        ? { actorType: "agent" as const, actorId: actor.agentId, agentId: actor.agentId }
        : { actorType: "system" as const, actorId: "crew" };
  if (verdict.kind === "override") {
    await persistActivity(tx, {
      companyId: locked.companyId,
      ...actorFields,
      action: "crew.policy.board_override",
      entityType: "issue",
      entityId: issueId,
      issueId,
      details: { violations: verdict.violations, toStatus: patch.status ?? null },
    });
  }
  if (verdict.kind === "allow" && verdict.notes.includes("docs_uninitialized")) {
    await persistActivity(tx, {
      companyId: locked.companyId,
      ...actorFields,
      action: "crew.docs_gate.uninitialized",
      entityType: "issue",
      entityId: issueId,
      issueId,
      details: { note: "repo chưa crew-docs init; docs gate cho qua" },
    });
  }
}

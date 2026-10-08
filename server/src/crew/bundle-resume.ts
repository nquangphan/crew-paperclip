import { and, eq, inArray, sql } from "drizzle-orm";
import { agentTaskSessions, agents, type Db, heartbeatRuns, issueRelations, issues } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";
import { persistActivity, publishActivity } from "../services/activity-log.js";

/** Dòng marker gói trong mô tả issue con, do Trợ Lý ghi. */
export const CREW_BUNDLE_RE = /^crew-bundle id=([a-z0-9][a-z0-9-]{0,39}) seq=([1-9][0-9]{0,2})$/m;

export interface CrewBundle {
  id: string;
  seq: number;
}

export function parseCrewBundle(description: string | null | undefined): CrewBundle | null {
  if (!description) return null;
  const match = CREW_BUNDLE_RE.exec(description.replace(/\r\n/g, "\n"));
  return match ? { id: match[1]!, seq: Number(match[2]) } : null;
}

export interface BundleSession {
  lastRunId: string | null;
  sessionParamsJson: Record<string, unknown> | null;
  sessionDisplayId: string | null;
  updatedAt: Date;
}

export interface BundlePredecessorCandidate {
  issueId: string;
  status: string;
  description: string | null;
  /** Task session của chính agent của run trên issue này (null nếu agent chưa làm issue đó). */
  session: BundleSession | null;
}

export type BundlePredecessor = BundlePredecessorCandidate & { seq: number; session: BundleSession & { lastRunId: string } };

/** Tiền nhiệm: blocker trực tiếp cùng gói, seq nhỏ hơn, đã `done`, agent có session trên đó; seq lớn nhất thắng. */
export function pickBundlePredecessor(
  own: CrewBundle,
  candidates: readonly BundlePredecessorCandidate[],
): BundlePredecessor | null {
  const eligible: BundlePredecessor[] = [];
  for (const candidate of candidates) {
    const bundle = parseCrewBundle(candidate.description);
    const session = candidate.session;
    if (!bundle || bundle.id !== own.id || bundle.seq >= own.seq) continue;
    if (candidate.status !== "done" || !session?.lastRunId || !session.sessionParamsJson || Object.keys(session.sessionParamsJson).length === 0) continue;
    eligible.push({ ...candidate, seq: bundle.seq, session: { ...session, lastRunId: session.lastRunId } });
  }
  eligible.sort((a, b) => b.seq - a.seq || b.session.updatedAt.getTime() - a.session.updatedAt.getTime());
  return eligible[0] ?? null;
}

export interface BundleResumeTarget {
  bundle: CrewBundle;
  predecessor: BundlePredecessor;
}

/**
 * Tìm session để issue `issueId` của agent nối tiếp. Null khi issue không giao cho agent, không có marker gói,
 * agent đã có session riêng trên issue này, hoặc không có tiền nhiệm hợp lệ là con cùng parent.
 */
export async function findBundlePredecessor(
  db: Db,
  input: { companyId: string; agentId: string; issueId: string },
): Promise<BundleResumeTarget | null> {
  const [issue] = await db
    .select({ assigneeAgentId: issues.assigneeAgentId, description: issues.description, parentId: issues.parentId })
    .from(issues)
    .where(and(eq(issues.id, input.issueId), eq(issues.companyId, input.companyId)));
  if (!issue || issue.parentId === null || issue.assigneeAgentId !== input.agentId) return null;
  const bundle = parseCrewBundle(issue.description);
  if (!bundle) return null;
  const [agent] = await db.select({ adapterType: agents.adapterType }).from(agents).where(and(eq(agents.id, input.agentId), eq(agents.companyId, input.companyId)));
  if (!agent) return null;
  const sessionScope = and(
    eq(agentTaskSessions.companyId, input.companyId),
    eq(agentTaskSessions.agentId, input.agentId),
    eq(agentTaskSessions.adapterType, agent.adapterType),
  );
  const own = await db
    .select({ id: agentTaskSessions.id })
    .from(agentTaskSessions)
    .where(and(sessionScope, eq(agentTaskSessions.taskKey, input.issueId)))
    .limit(1);
  if (own.length > 0) return null;
  const blockers = await db
    .select({ issueId: issues.id, status: issues.status, description: issues.description })
    .from(issueRelations)
    .innerJoin(issues, eq(issueRelations.issueId, issues.id))
    .where(
      and(
        eq(issueRelations.companyId, input.companyId),
        eq(issues.companyId, input.companyId),
        eq(issues.parentId, issue.parentId),
        eq(issueRelations.type, "blocks"),
        eq(issueRelations.relatedIssueId, input.issueId),
      ),
    );
  if (blockers.length === 0) return null;
  const sessions = await db
    .select({
      taskKey: agentTaskSessions.taskKey,
      lastRunId: agentTaskSessions.lastRunId,
      sessionParamsJson: agentTaskSessions.sessionParamsJson,
      sessionDisplayId: agentTaskSessions.sessionDisplayId,
      updatedAt: agentTaskSessions.updatedAt,
    })
    .from(agentTaskSessions)
    .where(and(sessionScope, inArray(agentTaskSessions.taskKey, blockers.map((b) => b.issueId))));
  const byKey = new Map(sessions.map((s) => [s.taskKey, s]));
  const predecessor = pickBundlePredecessor(
    bundle,
    blockers.map((b) => ({ ...b, session: byKey.get(b.issueId) ?? null })),
  );
  return predecessor ? { bundle, predecessor } : null;
}

/**
 * Chạy sau khi cổng tải cho claim. Ghi tham số resume giống `payload.resumeFromRunId` của stock vào
 * `contextSnapshot` của run (DB, có điều kiện còn `queued`, và object `run` mà `claimQueuedRun` đọc tiếp).
 * `executeRun` ưu tiên tham số tường minh này hơn việc reset session của wake `issue_assigned`.
 */
export async function applyBundleResume(input: {
  db: Db;
  run: typeof heartbeatRuns.$inferSelect;
}): Promise<"applied" | "skipped"> {
  const { db, run } = input;
  if (run.status !== "queued") return "skipped";
  const context = (run.contextSnapshot ?? {}) as Record<string, unknown>;
  const issueId = typeof context.issueId === "string" && context.issueId ? context.issueId : null;
  if (!issueId || context.resumeFromRunId != null || context.resumeSessionParams != null) return "skipped";
  const target = await findBundlePredecessor(db, { companyId: run.companyId, agentId: run.agentId, issueId });
  if (!target) return "skipped";
  const { bundle, predecessor } = target;
  const patch = {
    resumeFromRunId: predecessor.session.lastRunId,
    resumeSessionDisplayId: predecessor.session.sessionDisplayId,
    resumeSessionParams: predecessor.session.sessionParamsJson,
    crewBundleResume: { bundle: bundle.id, fromIssueId: predecessor.issueId },
  };
  // Resume và audit cùng commit; lỗi DB không để lại một nửa thay đổi.
  const result = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(heartbeatRuns)
      .set({
        contextSnapshot: sql`coalesce(${heartbeatRuns.contextSnapshot}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`,
        updatedAt: new Date(),
      })
      .where(and(
        eq(heartbeatRuns.id, run.id),
        eq(heartbeatRuns.companyId, run.companyId),
        eq(heartbeatRuns.agentId, run.agentId),
        eq(heartbeatRuns.status, "queued"),
        sql`${heartbeatRuns.contextSnapshot}->>'issueId' = ${issueId}`,
        sql`(${heartbeatRuns.contextSnapshot}->'resumeFromRunId' is null or ${heartbeatRuns.contextSnapshot}->'resumeFromRunId' = 'null'::jsonb)`,
        sql`(${heartbeatRuns.contextSnapshot}->'resumeSessionParams' is null or ${heartbeatRuns.contextSnapshot}->'resumeSessionParams' = 'null'::jsonb)`,
      ))
      .returning({ contextSnapshot: heartbeatRuns.contextSnapshot });
    if (!updated) return null;
    const { publication } = await persistActivity(tx as unknown as Db, {
      companyId: run.companyId,
      actorType: "system",
      actorId: "crew",
      action: "crew.bundle_resume",
      entityType: "heartbeat_run",
      entityId: run.id,
      agentId: run.agentId,
      runId: run.id,
      issueId,
      details: { bundle: bundle.id, fromIssueId: predecessor.issueId, toIssueId: issueId, resumeFromRunId: predecessor.session.lastRunId },
    });
    return { ...updated, publication };
  });
  if (!result) return "skipped";
  run.contextSnapshot = result.contextSnapshot;
  try {
    publishActivity(result.publication);
  } catch (err) {
    // DB đã commit; lỗi thông báo không thay đổi kết quả nối session.
    logger.warn({ err, runId: run.id }, "crew-bundle-resume: activity publication failed");
  }
  return "applied";
}

/** Lỗi bất kỳ: run chạy session mới như stock (không giữ run, không ném). */
export async function applyBundleResumeSafely(input: {
  db: Db;
  run: typeof heartbeatRuns.$inferSelect;
}): Promise<"applied" | "skipped"> {
  try {
    return await applyBundleResume(input);
  } catch (err) {
    logger.warn({ err, runId: input.run.id }, "crew-bundle-resume: failed open");
    return "skipped";
  }
}

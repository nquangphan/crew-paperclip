import { Router } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { agentWakeupRequests, type Db, type heartbeatRuns, issueComments, issues } from "@paperclipai/db";
import { extractAgentMentionIds } from "@paperclipai/shared";
import { badRequest, conflict, forbidden, notFound, unprocessable } from "../errors.js";
import { logger } from "../middleware/logger.js";
import { logActivity } from "../services/activity-log.js";
import { isUuid, requireOwner, resolveContributionActor } from "./contributions.js";
import { loadProjectAgentRoles, rowsOf } from "./project-roles.js";

/**
 * Owner gọi Trợ Lý bằng tag trong bình luận (flow `run-handoff`). Mention `agent://` của lõi không đánh thức ai nữa
 * (`enqueueWakeup` bỏ mọi wake `issue_comment_mentioned`), nên crew-web gửi bình luận rồi gọi route này với id bình luận.
 * Route kiểm bình luận rồi đánh thức Trợ Lý của project bằng reason riêng `crew_assistant_called`.
 *
 * Wake không mang `issueId`, chỉ `taskId` (adapter vẫn đặt `PAPERCLIP_TASK_ID`): lõi hủy mọi run có `issueId` của agent
 * không phải assignee trước khi chạy (`decideQueuedRunStaleness` → `issue_assignee_changed`), trừ wake tương tác của lõi.
 * Vì không có khóa issue của lõi, H1 (`holdAssistantCallRun`) tự giữ run `queued` khi task đang có run `running` của
 * agent khác; scheduler thử claim lại mỗi tick nên run chạy ngay sau khi run kia xong. Giữ không giới hạn, không đổi issue.
 */

export const ASSISTANT_CALL_REASON = "crew_assistant_called";
export const ASSISTANT_CALL_ACTION = "crew.assistant_called";
export const ASSISTANT_CALL_ERRORS = {
  invalid: "crew_assistant_call_invalid",
  closed: "crew_assistant_call_closed",
  commentNotFound: "crew_assistant_call_comment_not_found",
  notAuthor: "crew_assistant_call_not_author",
  missing: "crew_assistant_missing",
  notMentioned: "crew_assistant_not_mentioned",
} as const;

const CLOSED_STATUSES = new Set(["done", "cancelled"]);
const bodySchema = z.object({ commentId: z.string().uuid() }).strict();

/** Id issue của run gọi Trợ Lý bằng tag (`taskId` trong context), hoặc `null` với mọi run khác. */
export function assistantCallTaskId(contextSnapshot: unknown): string | null {
  if (!contextSnapshot || typeof contextSnapshot !== "object") return null;
  const context = contextSnapshot as Record<string, unknown>;
  if (context.wakeReason !== ASSISTANT_CALL_REASON) return null;
  return isUuid(context.taskId) ? context.taskId.toLowerCase() : null;
}

/** Task có run `running` của agent khác (theo issue trong context, `native_issue_id` hay `execution_run_id` của issue). */
export async function otherAgentRunHoldsTask(
  db: Db,
  input: { companyId: string; agentId: string; taskId: string },
): Promise<boolean> {
  const rows = rowsOf(await db.execute(sql`SELECT 1 AS held FROM heartbeat_runs r
    WHERE r.company_id = ${input.companyId} AND r.status = 'running' AND r.agent_id <> ${input.agentId}
      AND (r.context_snapshot->>'issueId' = ${input.taskId} OR r.native_issue_id::text = ${input.taskId}
        OR r.id = (SELECT i.execution_run_id FROM issues i WHERE i.id = ${input.taskId} AND i.company_id = ${input.companyId}))
    LIMIT 1`));
  return rows.length > 0;
}

/**
 * Phần H1 cho run gọi Trợ Lý bằng tag: `true` = giữ run ở `queued` vì task đang có run `running` của agent khác. Run khác
 * (không phải `crew_assistant_called`, hay không còn `queued`) trả `false` và đi đúng đường cũ. Đọc lỗi thì giữ (thử lại
 * tick sau), để Trợ Lý không chạy song song với run đang giữ issue.
 */
export async function holdAssistantCallRun(input: { db: Db; run: typeof heartbeatRuns.$inferSelect }): Promise<boolean> {
  const { db, run } = input;
  if (run.status !== "queued") return false;
  const taskId = assistantCallTaskId(run.contextSnapshot);
  if (!taskId) return false;
  try {
    return await otherAgentRunHoldsTask(db, { companyId: run.companyId, agentId: run.agentId, taskId });
  } catch (err) {
    logger.warn({ err, runId: run.id }, "crew assistant call: hold check failed, run stays queued");
    return true;
  }
}

export const assistantCallIdempotencyKey = (commentId: string) => `crew-assistant-call:${commentId.toLowerCase()}`;

export type AssistantCallStatus = "queued" | "deferred" | "skipped";

/** Dòng wake → kết quả trả cho web: không có dòng hay `skipped` là bị bỏ; còn lại là đã nhận (hoãn nếu đang bị giữ). */
function statusOf(row: { status: string } | undefined, held: boolean): AssistantCallStatus {
  if (!row || row.status === "skipped" || row.status === "cancelled") return "skipped";
  return held ? "deferred" : "queued";
}

type HeartbeatWakeupOptions = NonNullable<
  Parameters<ReturnType<typeof import("../services/heartbeat.js")["heartbeatService"]>["wakeup"]>[1]
>;

/** Wake stock, nhập lười như `handoff-rewake.ts`: heartbeat nhập các hook Crew. */
async function stockWakeup(db: Db, agentId: string, opts: HeartbeatWakeupOptions): Promise<void> {
  const { heartbeatService } = await import("../services/heartbeat.js");
  await heartbeatService(db).wakeup(agentId, opts);
}

async function findWake(db: Db, agentId: string, idempotencyKey: string) {
  const [row] = await db
    .select({
      id: agentWakeupRequests.id,
      status: agentWakeupRequests.status,
      reason: agentWakeupRequests.reason,
      runId: agentWakeupRequests.runId,
    })
    .from(agentWakeupRequests)
    .where(and(eq(agentWakeupRequests.agentId, agentId), eq(agentWakeupRequests.idempotencyKey, idempotencyKey)))
    .orderBy(desc(agentWakeupRequests.requestedAt))
    .limit(1);
  return row;
}

/** Khóa đang xử lý trong process (server Crew chạy một process): hai lệnh gọi cùng bình luận không tạo hai wake. */
const inFlight = new Set<string>();

/**
 * `POST /crew/companies/:companyId/issues/:issueId/assistant-call` `{ commentId }`. Chỉ owner (phiên trình duyệt), chỉ
 * bình luận chưa xóa của chính người gọi trên issue chưa đóng, bình luận phải có link `agent://` tới Trợ Lý của project.
 * Gọi lại cùng bình luận trả `200 { status: "already" }`; lần đầu trả `202 { status, runId, skipReason? }`.
 */
export function crewAssistantCallRoutes(db: Db): Router {
  const router = Router();

  router.post("/crew/companies/:companyId/issues/:issueId/assistant-call", async (req, res) => {
    const actor = await resolveContributionActor(db, req, req.params.companyId, { requireTables: false });
    requireOwner(actor);
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw badRequest("Body phải là { commentId } với commentId là uuid.", { code: ASSISTANT_CALL_ERRORS.invalid });
    }
    const commentId = parsed.data.commentId.toLowerCase();
    const issueId = req.params.issueId;
    if (!isUuid(issueId)) throw notFound("Không tìm thấy issue.");

    const [issue] = await db
      .select({ id: issues.id, status: issues.status, projectId: issues.projectId })
      .from(issues)
      .where(and(eq(issues.id, issueId), eq(issues.companyId, actor.companyId)))
      .limit(1);
    if (!issue) throw notFound("Không tìm thấy issue.");
    if (CLOSED_STATUSES.has(issue.status)) {
      throw conflict("Issue đã đóng, không gọi Trợ Lý được.", { code: ASSISTANT_CALL_ERRORS.closed });
    }

    const [comment] = await db
      .select({ authorUserId: issueComments.authorUserId, body: issueComments.body, deletedAt: issueComments.deletedAt })
      .from(issueComments)
      .where(
        and(
          eq(issueComments.id, commentId),
          eq(issueComments.issueId, issue.id),
          eq(issueComments.companyId, actor.companyId),
        ),
      )
      .limit(1);
    if (!comment || comment.deletedAt) {
      throw notFound("Không tìm thấy bình luận.", { code: ASSISTANT_CALL_ERRORS.commentNotFound });
    }
    if (comment.authorUserId !== actor.userId) {
      throw forbidden("Chỉ gọi Trợ Lý được từ bình luận của chính bạn.", { code: ASSISTANT_CALL_ERRORS.notAuthor });
    }

    const roles = await loadProjectAgentRoles({
      db,
      companyId: actor.companyId,
      projectId: issue.projectId,
      onReadError: "throw",
    });
    const assistantAgentId = roles?.assistantAgentId;
    if (!assistantAgentId) {
      throw conflict("Project này chưa có Trợ Lý.", { code: ASSISTANT_CALL_ERRORS.missing });
    }
    const mentioned = extractAgentMentionIds(comment.body).map((id) => id.toLowerCase());
    if (!mentioned.includes(assistantAgentId)) {
      throw unprocessable("Bình luận không có link tới Trợ Lý của project.", { code: ASSISTANT_CALL_ERRORS.notMentioned });
    }

    const idempotencyKey = assistantCallIdempotencyKey(commentId);
    if (inFlight.has(idempotencyKey)) {
      res.status(200).json({ status: "already" });
      return;
    }
    // Giữ khóa trước lần đọc đầu tiên: lệnh gọi thứ hai tới trong lúc đọc thấy khóa và trả `already`.
    inFlight.add(idempotencyKey);
    try {
      if (await findWake(db, assistantAgentId, idempotencyKey)) {
        res.status(200).json({ status: "already" });
        return;
      }
      await stockWakeup(db, assistantAgentId, {
        source: "automation",
        triggerDetail: "system",
        reason: ASSISTANT_CALL_REASON,
        payload: { crewAssistantCall: { issueId: issue.id, commentId } },
        idempotencyKey,
        requestedByActorType: "user",
        requestedByActorId: actor.userId,
        contextSnapshot: {
          taskId: issue.id,
          wakeReason: ASSISTANT_CALL_REASON,
          wakeCommentId: commentId,
          source: "crew.assistant_call",
          crewAssistantCall: { issueId: issue.id, commentId },
        },
      });
      const wake = await findWake(db, assistantAgentId, idempotencyKey);
      const held = wake?.status === "queued" || wake?.status === "claimed"
        ? await otherAgentRunHoldsTask(db, { companyId: actor.companyId, agentId: assistantAgentId, taskId: issue.id })
        : false;
      const status = statusOf(wake, held);
      await logActivity(db, {
        companyId: actor.companyId,
        actorType: "user",
        actorId: actor.userId,
        action: ASSISTANT_CALL_ACTION,
        entityType: "issue",
        entityId: issue.id,
        issueId: issue.id,
        agentId: assistantAgentId,
        details: { commentId, assistantAgentId, status },
      });
      logger.info({ companyId: actor.companyId, issueId: issue.id, commentId, status }, "crew assistant called");
      res.status(202).json({
        status,
        runId: wake?.runId ?? null,
        ...(status === "skipped" ? { skipReason: wake?.reason ?? null } : {}),
      });
    } finally {
      inFlight.delete(idempotencyKey);
    }
  });

  return router;
}

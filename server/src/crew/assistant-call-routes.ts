import { Router } from "express";
import { and, desc, eq, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { agentWakeupRequests, type Db, type heartbeatRuns, issueComments, issues } from "@paperclipai/db";
import { extractAgentMentionIds } from "@paperclipai/shared";
import { badRequest, conflict, forbidden, HttpError, notFound, unprocessable } from "../errors.js";
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
 *
 * Mỗi lần gọi có run riêng (`allowRunCoalescing: false`): lõi không gộp wake này vào run đang chờ cùng task, vì bản gộp chỉ
 * giữ `wakeCommentId` mới nhất và adapter chỉ xuất biến đó, nên bình luận gọi trước sẽ mất. Wake của lõi có `issueId` đi
 * nhánh issue và không bao giờ nhắm tới run này (run không có `issueId`), nên chiều ngược lại cũng không ghi đè.
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
  skipped: "crew_assistant_call_skipped",
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

export type AssistantCallStatus = "queued" | "deferred";

/** Dòng wake lõi đã bỏ: không tính là đã gọi, lần gọi sau cùng bình luận thử lại được. */
const DROPPED_WAKE_STATUSES = ["skipped", "cancelled"];

const SKIP_LABELS: Record<string, string> = {
  "budget.blocked": "Trợ Lý đã hết ngân sách",
  "agent.not_invokable": "Trợ Lý đang tạm dừng hoặc không chạy được",
  "heartbeat.wakeOnDemand.disabled": "Trợ Lý đang tắt đánh thức theo yêu cầu",
  "heartbeat.daily_run_limit": "Trợ Lý đã chạm trần số run trong ngày",
  "heartbeat.daily_cost_limit": "Trợ Lý đã chạm trần chi phí trong ngày",
};

/** Lỗi 409 khi lõi không nhận wake (Trợ Lý pause, hết ngân sách, chạm trần ngày…); web hiện `message`. */
export function assistantCallSkipped(reason: string | null) {
  const label = (reason && SKIP_LABELS[reason]) ?? "Máy chủ chưa nhận lời gọi";
  return conflict(`${label}. Bình luận đã lưu; xử lý xong thì gọi lại.`, {
    code: ASSISTANT_CALL_ERRORS.skipped,
    skipReason: reason,
  });
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
    .where(and(
      eq(agentWakeupRequests.agentId, agentId),
      eq(agentWakeupRequests.idempotencyKey, idempotencyKey),
      notInArray(agentWakeupRequests.status, DROPPED_WAKE_STATUSES),
    ))
    .orderBy(desc(agentWakeupRequests.requestedAt))
    .limit(1);
  return row;
}

/** Dòng wake `skipped` mới nhất cho khóa này (lõi ghi lý do bỏ vào cột `reason`). */
async function findSkipped(db: Db, agentId: string, idempotencyKey: string) {
  const [row] = await db
    .select({ id: agentWakeupRequests.id, reason: agentWakeupRequests.reason })
    .from(agentWakeupRequests)
    .where(and(
      eq(agentWakeupRequests.agentId, agentId),
      eq(agentWakeupRequests.idempotencyKey, idempotencyKey),
      eq(agentWakeupRequests.status, "skipped"),
    ))
    .orderBy(desc(agentWakeupRequests.requestedAt))
    .limit(1);
  return row;
}

/** Khóa đang xử lý trong process (server Crew chạy một process): hai lệnh gọi cùng bình luận không tạo hai wake. */
const inFlight = new Set<string>();

/**
 * `POST /crew/companies/:companyId/issues/:issueId/assistant-call` `{ commentId }`. Chỉ owner (phiên trình duyệt), chỉ
 * bình luận chưa xóa của chính người gọi trên issue chưa đóng, bình luận phải có link `agent://` tới Trợ Lý của project.
 * Gọi lại cùng bình luận trả `200 { status: "already" }`; lần đầu trả `202 { status, runId }`. Lõi không nhận wake thì trả
 * `409 crew_assistant_call_skipped` và không khóa bình luận: gọi lại sau khi bật lại Trợ Lý sẽ đánh thức thật.
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
      // Dòng `skipped` của lần gọi trước (nếu có) không phải lý do của lần này.
      const skippedBefore = (await findSkipped(db, assistantAgentId, idempotencyKey))?.id ?? null;
      const skippedNow = async () => {
        const row = await findSkipped(db, assistantAgentId, idempotencyKey);
        return row && row.id !== skippedBefore ? row.reason : null;
      };
      try {
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
          allowRunCoalescing: false,
        });
      } catch (err) {
        // Hết ngân sách (kèm dòng `skipped`, details có `scopeType`) hay Trợ Lý pause/không chạy được: lõi ném 409.
        if (err instanceof HttpError && err.status === 409) {
          const details = (err.details ?? {}) as { scopeType?: unknown };
          throw assistantCallSkipped((await skippedNow()) ?? (details.scopeType ? "budget.blocked" : "agent.not_invokable"));
        }
        throw err;
      }
      const wake = await findWake(db, assistantAgentId, idempotencyKey);
      if (!wake) throw assistantCallSkipped(await skippedNow());
      const held = wake.status === "queued" || wake.status === "claimed"
        ? await otherAgentRunHoldsTask(db, { companyId: actor.companyId, agentId: assistantAgentId, taskId: issue.id })
        : false;
      const status: AssistantCallStatus = held ? "deferred" : "queued";
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
      res.status(202).json({ status, runId: wake.runId ?? null });
    } finally {
      inFlight.delete(idempotencyKey);
    }
  });

  return router;
}

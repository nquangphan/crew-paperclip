import type { PluginContext } from "@paperclipai/plugin-sdk";
import { storedVerifiedCrewCompanies } from "../companies/data.js";
import { checkedId, pluginNamespace } from "../shared/db.js";

/**
 * Issue `large` chỉ chạy Claude, nên run Claude hỏng vì đăng nhập (`claude_auth_required`) hay runtime không chạy được
 * thì Crew không chuyển runtime mà chờ Claude chạy lại. Stock KHÔNG chạy lại các run này: lỗi đăng nhập được gắn thẻ sửa
 * đăng nhập (`connection_intent`) và run thành `liveness_state = blocked`, nên recovery coi là `non_retryable` và chờ người
 * bấm thẻ; `adapter_engine_unavailable` cũng nằm trong danh sách không chạy lại. Lỗi này thường thoáng qua (máy vẫn chạy
 * được run Claude khác), nên Crew tự đánh thức lại assignee theo backoff 5, 15, 30, 60 phút; hết 4 lần thì comment rõ và
 * chuyển issue sang `blocked`. Trạng thái giữ ở `crew_runtime_retries`, một dòng mỗi issue.
 */

/** Phút chờ trước lần đánh thức thứ 1, 2, 3, 4. */
export const CLAUDE_RETRY_BACKOFF_MINUTES = [5, 15, 30, 60] as const;
export const CLAUDE_RETRY_MAX = CLAUDE_RETRY_BACKOFF_MINUTES.length;
export const CLAUDE_RETRY_WAKE_REASON = "crew_claude_retry";
/** Gọi đánh thức lỗi (issue bị chặn, hết budget…) thì thử lại sau chừng này, không tính là một lần. */
const WAKE_ERROR_DELAY_MS = 5 * 60_000;
const BATCH = 50;
/** Chỉ đánh thức executor khi issue còn ở trạng thái làm việc; đã đóng hay owner chuyển trạng thái khác thì thôi. */
const WAKEABLE_STATUSES = new Set(["todo", "in_progress"]);

type Ctx = Pick<PluginContext, "db" | "issues" | "logger">;
const table = (ctx: Pick<PluginContext, "db">) => `${pluginNamespace(ctx)}.crew_runtime_retries`;
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

export type ClaudeRetrySchedule = { kind: "scheduled"; attempt: number; delayMinutes: number } | { kind: "gave_up"; attempts: number };

/**
 * Hẹn đánh thức lại assignee sau run hỏng `runId`. Số lần đã đánh thức giữ qua các run hỏng liên tiếp của cùng agent trên
 * issue (run đánh thức lại hỏng tiếp thì lần sau chờ lâu hơn), về 0 khi issue có run thành công hay đổi người. Đã đủ
 * `CLAUDE_RETRY_MAX` lần thì xóa dòng và trả `gave_up` để nơi gọi comment và chặn issue.
 */
export async function scheduleClaudeRetry(
  ctx: Pick<PluginContext, "db">, input: { companyId: string; issueId: string; agentId: string; runId: string }, now = new Date(),
): Promise<ClaudeRetrySchedule> {
  const companyId = checkedId(input.companyId).toLowerCase();
  const issueId = checkedId(input.issueId).toLowerCase();
  const agentId = checkedId(input.agentId).toLowerCase();
  const runId = checkedId(input.runId).toLowerCase();
  const rows = await ctx.db.query<{ agent_id: string; attempts: number }>(
    `SELECT agent_id::text AS agent_id, attempts FROM ${table(ctx)} WHERE company_id = $1 AND issue_id = $2`, [companyId, issueId],
  );
  const attempts = rows[0]?.agent_id === agentId ? Number(rows[0].attempts) : 0;
  if (attempts >= CLAUDE_RETRY_MAX) {
    await ctx.db.execute(`DELETE FROM ${table(ctx)} WHERE company_id = $1 AND issue_id = $2`, [companyId, issueId]);
    return { kind: "gave_up", attempts };
  }
  const delayMinutes = CLAUDE_RETRY_BACKOFF_MINUTES[attempts]!;
  await ctx.db.execute(
    `INSERT INTO ${table(ctx)} (company_id, issue_id, agent_id, run_id, attempts, next_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (company_id, issue_id) DO UPDATE SET agent_id = EXCLUDED.agent_id, run_id = EXCLUDED.run_id,
       attempts = EXCLUDED.attempts, next_at = EXCLUDED.next_at, updated_at = now()`,
    [companyId, issueId, agentId, runId, attempts, new Date(now.getTime() + delayMinutes * 60_000).toISOString()],
  );
  return { kind: "scheduled", attempt: attempts + 1, delayMinutes };
}

type RetryRow = { issue_id: string; agent_id: string; run_id: string; attempts: number; next_at: string | Date | null; later_status: string | null };

/**
 * Job mỗi phút. Dòng tới hạn: issue còn mở, còn giao đúng agent và chưa có run nào sau run hỏng thì đánh thức (một lần
 * mỗi run hỏng, khóa `crew_claude_retry:<run>`), rồi chờ kết quả (`next_at` rỗng). Đã có run sau run hỏng (ai đó đã đánh
 * thức) thì cũng chỉ chờ kết quả. Run sau đó thành công, issue đóng, đổi người hay rời `todo`/`in_progress` thì xóa dòng.
 * Run đánh thức lại hỏng vì đăng nhập thì `agent.run.failed` hẹn lần kế (`scheduleClaudeRetry`).
 */
export async function runClaudeRetryJob(
  ctx: Ctx & Pick<PluginContext, "companies" | "config">, now: Date,
): Promise<{ woken: number; cleared: number }> {
  let woken = 0;
  let cleared = 0;
  for (const company of await storedVerifiedCrewCompanies(ctx)) {
    const companyId = company.id.toLowerCase();
    let rows: RetryRow[];
    try {
      rows = await ctx.db.query<RetryRow>(
        `SELECT r.issue_id::text AS issue_id, r.agent_id::text AS agent_id, r.run_id::text AS run_id, r.attempts, r.next_at,
           (SELECT x.status FROM public.heartbeat_runs x
             WHERE x.company_id = r.company_id AND x.context_snapshot->>'issueId' = r.issue_id::text AND x.id <> r.run_id
               AND x.created_at > COALESCE((SELECT f.created_at FROM public.heartbeat_runs f WHERE f.id = r.run_id), r.updated_at)
             ORDER BY x.created_at DESC LIMIT 1) AS later_status
         FROM ${table(ctx)} r WHERE r.company_id = $1 AND (r.next_at IS NULL OR r.next_at <= $2)
         ORDER BY (r.next_at IS NULL), r.next_at, r.issue_id LIMIT ${BATCH}`,
        [companyId, now.toISOString()],
      );
    } catch (error) {
      ctx.logger.error("crew claude retry job: reading retries failed", { companyId, err: errorText(error) });
      continue;
    }
    for (const row of rows) {
      try {
        const issue = await ctx.issues.get(row.issue_id, companyId);
        const stale = !issue || !WAKEABLE_STATUSES.has(issue.status)
          || issue.assigneeAgentId?.toLowerCase() !== row.agent_id || row.later_status === "succeeded";
        if (stale) {
          await ctx.db.execute(`DELETE FROM ${table(ctx)} WHERE company_id = $1 AND issue_id = $2`, [companyId, row.issue_id]);
          cleared++;
          continue;
        }
        if (row.next_at === null) continue;
        if (row.later_status !== null) {
          await setNextAt(ctx, companyId, row.issue_id, null);
          continue;
        }
        try {
          await ctx.issues.requestWakeup(row.issue_id, companyId, {
            reason: CLAUDE_RETRY_WAKE_REASON, idempotencyKey: `${CLAUDE_RETRY_WAKE_REASON}:${row.run_id}`,
          });
        } catch (error) {
          ctx.logger.warn("crew claude retry job: wakeup failed, trying again later", { companyId, issueId: row.issue_id, err: errorText(error) });
          await setNextAt(ctx, companyId, row.issue_id, new Date(now.getTime() + WAKE_ERROR_DELAY_MS));
          continue;
        }
        await ctx.db.execute(
          `UPDATE ${table(ctx)} SET attempts = attempts + 1, next_at = NULL, updated_at = now() WHERE company_id = $1 AND issue_id = $2`,
          [companyId, row.issue_id],
        );
        woken++;
        ctx.logger.info("crew claude retry: assignee woken", { companyId, issueId: row.issue_id, runId: row.run_id, attempt: Number(row.attempts) + 1 });
      } catch (error) {
        ctx.logger.warn("crew claude retry job: issue left for the next minute", { companyId, issueId: row.issue_id, err: errorText(error) });
      }
    }
  }
  return { woken, cleared };
}

async function setNextAt(ctx: Pick<PluginContext, "db">, companyId: string, issueId: string, nextAt: Date | null): Promise<void> {
  await ctx.db.execute(`UPDATE ${table(ctx)} SET next_at = $3, updated_at = now() WHERE company_id = $1 AND issue_id = $2`,
    [companyId, issueId, nextAt?.toISOString() ?? null]);
}

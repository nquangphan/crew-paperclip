import { sql } from "drizzle-orm";
import type { heartbeatRuns } from "@paperclipai/db";
import type { CrewRolesDb } from "./project-roles.js";
import type { RetryProgress } from "./retry-progress.js";
import { crewRuntimeDecisionsTable, readPluginRows } from "./runtime-switch.js";

/**
 * Plugin chuyển issue sang runtime khác (fallback cùng máy) rồi đánh thức agent đích với lý do này. Cũng là lý do hủy run
 * `queued` của agent cũ. Bước kiểm run cũ của H1 không dựa vào lý do này (xem fallbackPreviousRunId).
 */
export const CREW_RUNTIME_FALLBACK_WAKE_REASON = "crew_runtime_fallback";
export const CREW_RUNTIME_FALLBACK_DIRTY_CANCEL_REASON = "crew_runtime_fallback_dirty";
export const CREW_RUNTIME_FALLBACK_DIRTY_COMMENT =
  "Worktree của run trước còn thay đổi chưa commit; Crew không mang sang. Owner xem rồi chuyển issue về todo.";
/** Activity H1 ghi sau khi kiểm run cũ của một lần chuyển runtime; `details.previousRunId` là run đã kiểm. */
export const CREW_RUNTIME_FALLBACK_CHECKED_ACTION = "crew.runtime_fallback.checked";

type Run = typeof heartbeatRuns.$inferSelect;

/** Run do plugin đánh thức sau fallback: chắc chắn có run cũ cần kiểm. */
export function isRuntimeFallbackWake(contextSnapshot: unknown): boolean {
  if (!contextSnapshot || typeof contextSnapshot !== "object") return false;
  return (contextSnapshot as Record<string, unknown>).wakeReason === CREW_RUNTIME_FALLBACK_WAKE_REASON;
}

/**
 * Run cũ H1 cần kiểm trước khi claim `run`, quyết định theo dữ liệu chứ không theo lý do đánh thức (agent đích có thể
 * được recovery của lõi đánh thức trước plugin):
 * - quyết định `fallback` mới nhất trên issue của run phải chuyển sang agent của run và có `run_id`;
 * - run cũ là `run_id` đó nếu nó đã bắt đầu; nếu nó bị giữ trước khi chạy thì là run gần nhất đã bắt đầu của agent cũ
 *   trên issue (worktree đó có thể còn giữ nhánh `crew/<issue>`); không có thì vẫn là `run_id` (H1 chỉ ghi activity);
 * - `null` khi run cũ đã được run khác kiểm (activity `crew.runtime_fallback.checked`, trừ kết quả worktree bẩn: owner
 *   dọn xong chuyển về todo thì kiểm lại), hoặc khi bảng quyết định chưa có.
 */
export async function fallbackPreviousRunId(db: CrewRolesDb, run: Run): Promise<string | null> {
  const snapshot = run.contextSnapshot as Record<string, unknown> | null;
  const issueId = typeof snapshot?.issueId === "string" ? snapshot.issueId : null;
  if (!issueId) return null;
  const rows = await readPluginRows(
    db,
    crewRuntimeDecisionsTable(),
    (table) => sql`WITH decision AS (
        SELECT run_id, from_agent_id, to_agent_id, decided_at FROM ${table}
        WHERE company_id = ${run.companyId} AND issue_id = ${issueId} AND kind = 'fallback'
        ORDER BY decided_at DESC, id DESC LIMIT 1
      ), previous AS (
        SELECT d.decided_at, coalesce(
          (SELECT r.id FROM heartbeat_runs r WHERE r.id = d.run_id AND r.started_at IS NOT NULL),
          (SELECT r.id FROM heartbeat_runs r
            WHERE r.company_id = ${run.companyId} AND r.agent_id = d.from_agent_id
              AND r.context_snapshot ->> 'issueId' = ${issueId}
              AND r.started_at IS NOT NULL AND r.started_at <= d.decided_at
            ORDER BY r.started_at DESC LIMIT 1),
          d.run_id) AS run_id
        FROM decision d WHERE d.to_agent_id = ${run.agentId} AND d.run_id IS NOT NULL
      )
      SELECT p.run_id::text AS run_id FROM previous p
      WHERE NOT EXISTS (
        SELECT 1 FROM activity_log a
        WHERE a.company_id = ${run.companyId} AND a.created_at >= p.decided_at
          AND a.action = ${CREW_RUNTIME_FALLBACK_CHECKED_ACTION}
          AND a.details ->> 'previousRunId' = p.run_id::text
          AND a.run_id IS DISTINCT FROM ${run.id}
          AND coalesce(a.details ->> 'detach', '') <> 'dirty'
      )`,
  );
  const runId = rows?.[0]?.run_id;
  return typeof runId === "string" ? runId : null;
}

/** Đầu mọi comment chuyển runtime cho run cũ này; cũng dùng để tìm comment đã đăng. */
export function fallbackProgressCommentPrefix(previousRunId: string): string {
  return `Crew: chuyển runtime sau run \`${previousRunId}\``;
}

export function fallbackDirtyComment(previousRunId: string): string {
  return `${fallbackProgressCommentPrefix(previousRunId)}: ${CREW_RUNTIME_FALLBACK_DIRTY_COMMENT}`;
}

const TIME = new Intl.DateTimeFormat("vi-VN", {
  timeZone: "Asia/Ho_Chi_Minh",
  hour: "2-digit",
  minute: "2-digit",
  day: "2-digit",
  month: "2-digit",
});

/** Cùng dạng comment retry-progress, để executor đã biết cách xử lý. */
export function fallbackProgressComment(p: Extract<RetryProgress, { kind: "checked" }>): string {
  const list = p.commits.map((c) => `- ${c.sha.slice(0, 8)} (${c.branch}) ${c.subject}`).join("\n");
  return (
    `${fallbackProgressCommentPrefix(p.previousRunId)} (bắt đầu ${TIME.format(p.previousStartedAt)}). ` +
    `Có ${p.truncated ? "ít nhất " : ""}${p.commits.length} commit trong worktree của run trước kể từ khi run đó bắt đầu ` +
    `(\`${p.cwd}\`, mọi nhánh local, có thể gồm nhánh của việc khác)` +
    `${p.truncated ? `; danh sách bị cắt ở ${p.commits.length} commit mới nhất, xem thêm bằng \`git log --branches HEAD\`` : ""}:` +
    `\n${list}\n\n` +
    "Nhánh và commit của run trước được giữ. Kiểm tra các commit trên rồi tiếp tục phần còn thiếu; không làm lại phần đã commit."
  );
}

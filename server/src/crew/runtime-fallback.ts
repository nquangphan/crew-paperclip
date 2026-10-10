import { sql } from "drizzle-orm";
import type { heartbeatRuns } from "@paperclipai/db";
import type { CrewRolesDb } from "./project-roles.js";
import type { RetryProgress } from "./retry-progress.js";
import { crewRuntimeDecisionsTable, readPluginRows } from "./runtime-switch.js";

/**
 * Plugin chuyển issue sang runtime khác (fallback cùng máy) rồi đánh thức agent đích với lý do này. Trước khi run đó
 * được claim, H1 dừng phần còn lại của run cũ, liệt kê commit của nó và tách worktree cũ khỏi nhánh `crew/<issue>` để
 * worktree mới `git switch` được. Cũng là lý do hủy run `queued` của agent cũ.
 */
export const CREW_RUNTIME_FALLBACK_WAKE_REASON = "crew_runtime_fallback";
export const CREW_RUNTIME_FALLBACK_DIRTY_CANCEL_REASON = "crew_runtime_fallback_dirty";
export const CREW_RUNTIME_FALLBACK_DIRTY_COMMENT =
  "Worktree của run trước còn thay đổi chưa commit; Crew không mang sang. Owner xem rồi chuyển issue về todo.";

type Run = typeof heartbeatRuns.$inferSelect;

export function isRuntimeFallbackWake(contextSnapshot: unknown): boolean {
  if (!contextSnapshot || typeof contextSnapshot !== "object") return false;
  return (contextSnapshot as Record<string, unknown>).wakeReason === CREW_RUNTIME_FALLBACK_WAKE_REASON;
}

/**
 * Run cũ của run chuyển runtime: `run_id` của quyết định `fallback` mới nhất trên issue của run có `to_agent_id` là agent
 * của run. Bảng chưa có hoặc không có quyết định → `null`.
 */
export async function fallbackPreviousRunId(db: CrewRolesDb, run: Run): Promise<string | null> {
  const snapshot = run.contextSnapshot as Record<string, unknown> | null;
  const issueId = typeof snapshot?.issueId === "string" ? snapshot.issueId : null;
  if (!issueId) return null;
  const rows = await readPluginRows(
    db,
    crewRuntimeDecisionsTable(),
    (table) => sql`SELECT run_id::text AS run_id FROM ${table}
      WHERE company_id = ${run.companyId} AND issue_id = ${issueId} AND kind = 'fallback'
        AND to_agent_id = ${run.agentId} AND run_id IS NOT NULL
      ORDER BY decided_at DESC, id DESC LIMIT 1`,
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

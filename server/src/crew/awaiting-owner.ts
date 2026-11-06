import { Router } from "express";
import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { contributionForbidden, resolveContributionActor } from "./contributions.js";
import { visibleProjectsFor } from "./project-access.js";
import { rowsOf } from "./project-roles.js";

/**
 * Yêu cầu đang chờ owner trả lời một thẻ câu hỏi/xác nhận (flow `issues-web`). Danh sách lõi chỉ tính thẻ chờ trả lời
 * cho issue `in_review` (`reviewAttention`), nên issue `in_progress` hay `blocked` có thẻ chờ owner vẫn hiện "Đang làm"
 * hoặc "Đang bị chặn". Route này chỉ đọc; UI Crew dùng nó để hiện trạng thái hiển thị "Chờ owner trả lời" và đưa issue
 * vào tab "Chờ tôi duyệt" của Hộp thư. Không đổi trạng thái thật của issue: `in_review`/`blocked` kích hoạt stage và
 * người duyệt của execution policy.
 */

type Sql = Pick<Db, "execute">;

const BASE = "/crew/companies/:companyId";

/** Loại thẻ owner phải trả lời (cùng các thẻ UI Crew vẽ ở chi tiết issue). */
export const AWAITING_OWNER_KINDS = ["ask_user_questions", "request_confirmation", "request_checkbox_confirmation"] as const;

export interface AwaitingOwnerItem {
  issueId: string;
  /** Thẻ chờ lâu nhất của issue. */
  interactionId: string;
  kind: (typeof AWAITING_OWNER_KINDS)[number];
  createdAt: string;
}

/**
 * Issue chưa đóng (không `done`/`cancelled`, không ẩn) có thẻ chờ trả lời gửi cho người (không gửi cho agent), trong
 * các project người xem thấy được (owner thấy mọi issue, kể cả issue không thuộc project). Mỗi issue một dòng: thẻ cũ
 * nhất, mới chờ trước.
 */
export async function listAwaitingOwner(db: Sql, input: { companyId: string; userId: string }): Promise<AwaitingOwnerItem[]> {
  const visible = await visibleProjectsFor(db, input.companyId, input.userId);
  if (!visible.all && visible.projectIds.length === 0) return [];
  const projectFilter = visible.all
    ? sql``
    : sql`AND i.project_id IN (${sql.join(visible.projectIds.map((id) => sql`${id}::uuid`), sql`, `)})`;
  const kinds = sql.join(AWAITING_OWNER_KINDS.map((kind) => sql`${kind}`), sql`, `);
  const rows = rowsOf(
    await db.execute(sql`SELECT * FROM (
        SELECT DISTINCT ON (t.issue_id) t.issue_id::text AS issue_id, t.id::text AS interaction_id, t.kind, t.created_at
        FROM "issue_thread_interactions" t
        JOIN "issues" i ON i.id = t.issue_id AND i.company_id = t.company_id
        WHERE t.company_id = ${input.companyId} AND t.status = 'pending' AND t.kind IN (${kinds})
          AND t.addressee_agent_id IS NULL
          AND i.status NOT IN ('done', 'cancelled') AND i.hidden_at IS NULL
          ${projectFilter}
        ORDER BY t.issue_id, t.created_at ASC, t.id ASC
      ) first_card
      ORDER BY created_at ASC, issue_id ASC`),
  );
  return rows.map((row) => ({
    issueId: String(row.issue_id),
    interactionId: String(row.interaction_id),
    kind: row.kind as AwaitingOwnerItem["kind"],
    createdAt: new Date(row.created_at as string | Date).toISOString(),
  }));
}

/**
 * `GET …/awaiting-owner`: `{ items: AwaitingOwnerItem[] }`. Cùng luật người gọi với `…/qc`: actor board bằng phiên
 * trình duyệt, mọi thành viên người của company (role đọc từ DB), lọc theo quyền xem project.
 */
export function crewAwaitingOwnerRoutes(db: Db): Router {
  const router = Router();
  router.get(`${BASE}/awaiting-owner`, async (req, res) => {
    const actor = await resolveContributionActor(db, req, req.params.companyId, { requireTables: false });
    if (actor.membershipRole === null) throw contributionForbidden();
    res.json({ items: await listAwaitingOwner(db, { companyId: actor.companyId, userId: actor.userId }) });
  });
  return router;
}

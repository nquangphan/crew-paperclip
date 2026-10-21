import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { conflict, HttpError, notFound } from "../errors.js";
import { derivePluginDatabaseNamespace } from "../services/plugin-database.js";
import { canSeeProject, visibleProjectsFor } from "./project-access.js";
import { CREW_PLUGIN_KEY, rowsOf } from "./project-roles.js";

/**
 * Phòng QC duyệt lại yêu cầu do chính họ tạo (bảng plugin `crew_qc_rounds`, migration `0019_qc_verification.sql`).
 *
 * - Issue "của QC": issue lõi tạo ra khi owner duyệt một góp ý `kind = 'issue'` mà người gửi thuộc Phòng QC lúc gửi
 *   (cột `submitted_department` chụp lúc gửi, nên đổi phòng về sau không ảnh hưởng). Issue nhận ra qua `result_issue_id`
 *   hoặc khóa idempotent `crew-contribution:<id>` mà trình duyệt owner dùng để tạo issue.
 * - Mỗi lần issue như thế vào `done` (mọi đường đi qua `issueService.update`, kể cả board ép xong), Crew mở một vòng
 *   "Chờ QC duyệt" giao cho người QC đã gửi. Trạng thái lõi vẫn là `done`: agent coi là xong, không ai bị đánh thức, và
 *   không có cột lõi nào bị ghi thêm. Người được giao chỉ nằm ở bảng plugin (không đặt `assigneeUserId` lõi, xem báo cáo
 *   thiết kế: đổi assignee lõi làm mất executor mà luồng mở lại dựa vào và đánh dấu việc đổi chủ trong lõi).
 * - Issue rời `done` thì vòng đang mở đóng lại; vào `done` lần sau mở vòng mới.
 * - QC (hoặc owner) "Xác nhận đạt" chỉ đổi vòng sang `verified`. "Chưa đạt" là góp ý `kind = 'reopen'` chờ owner duyệt
 *   (xem `contributions.ts`): agent không thấy lý do cho tới khi owner duyệt và đăng bình luận mở lại.
 */

type Sql = Pick<Db, "execute">;
type Tx = Sql & Pick<Db, "transaction">;
type Row = Record<string, unknown>;

export const QC_ROUND_STATUSES = ["awaiting", "verified", "reopened"] as const;
export type QcRoundStatus = (typeof QC_ROUND_STATUSES)[number];
/** Trạng thái hiển thị của vòng đang mở (issue đang `done`). */
export type QcOpenState = Exclude<QcRoundStatus, "reopened">;

export const QC_ERRORS = {
  notAwaiting: "crew_qc_not_awaiting",
  reopenPending: "crew_qc_reopen_pending",
  forbidden: "crew_qc_forbidden",
} as const;

/** Tiền tố khóa idempotent của issue tạo từ góp ý (cùng giá trị với `contributionIdempotencyKey`). */
const CONTRIBUTION_KEY_PREFIX = "crew-contribution:";

export function crewQcRoundsTable(): string {
  return `${derivePluginDatabaseNamespace(CREW_PLUGIN_KEY)}.crew_qc_rounds`;
}

const roundsTable = () => sql.raw(crewQcRoundsTable());
const contributionsTable = () => sql.raw(`${derivePluginDatabaseNamespace(CREW_PLUGIN_KEY)}.crew_contributions`);

/** Bảng vòng QC đã có (plugin đã áp 0019; 0019 cũng thêm cột `submitted_department` và kind `reopen`). */
export async function qcTablesReady(db: Sql): Promise<boolean> {
  const rows = rowsOf(await db.execute(sql`SELECT to_regclass(${crewQcRoundsTable()}) IS NOT NULL AS ok`));
  return rows[0]?.ok === true;
}

export interface QcOrigin {
  contributionId: string;
  qcUserId: string;
}

/** Góp ý Phòng QC đã tạo ra issue này, hoặc `null` khi issue không do QC gửi. */
export async function loadQcOrigin(db: Sql, companyId: string, issueId: string): Promise<QcOrigin | null> {
  const rows = rowsOf(
    await db.execute(sql`SELECT c.id::text AS id, c.author_user_id FROM ${contributionsTable()} c
      WHERE c.company_id = ${companyId} AND c.kind = 'issue' AND c.submitted_department = 'qc'
        AND (c.result_issue_id = ${issueId}
          OR c.id::text IN (SELECT substr(k.idempotency_key, ${CONTRIBUTION_KEY_PREFIX.length + 1})
            FROM "issue_create_idempotency_keys" k
            WHERE k.company_id = ${companyId} AND k.issue_id = ${issueId}
              AND k.idempotency_key LIKE ${`${CONTRIBUTION_KEY_PREFIX}%`}))
      ORDER BY c.created_at ASC
      LIMIT 1`),
  );
  const row = rows[0];
  return row ? { contributionId: String(row.id), qcUserId: String(row.author_user_id) } : null;
}

export interface QcStatusChange {
  tx: Sql;
  issueId: string;
  companyId: string;
  fromStatus: string;
  toStatus: string;
}

/**
 * Ghi vòng QC theo lần đổi trạng thái của issue, trong cùng transaction với lệnh ghi issue (lệnh ghi lỗi thì vòng cũng
 * rollback). Rời `done`: đóng vòng đang mở (`awaiting` → `reopened`, `verified` giữ nguyên). Vào `done`: issue của QC
 * thì mở vòng `awaiting` mới. Bảng chưa có (plugin chưa áp 0019) thì bỏ qua.
 */
export async function recordQcStatusChange(input: QcStatusChange): Promise<void> {
  const { tx, issueId, companyId, fromStatus, toStatus } = input;
  if (fromStatus === toStatus) return;
  const leaving = fromStatus === "done";
  const entering = toStatus === "done";
  if (!leaving && !entering) return;
  if (!(await qcTablesReady(tx))) return;
  if (leaving) {
    await tx.execute(sql`UPDATE ${roundsTable()}
      SET ended_at = now(), status = CASE WHEN status = 'awaiting' THEN 'reopened' ELSE status END
      WHERE issue_id = ${issueId} AND ended_at IS NULL`);
  }
  if (entering) {
    const origin = await loadQcOrigin(tx, companyId, issueId);
    if (!origin) return;
    await tx.execute(sql`INSERT INTO ${roundsTable()} (company_id, issue_id, qc_user_id, source_contribution_id)
      VALUES (${companyId}, ${issueId}, ${origin.qcUserId}, ${origin.contributionId})
      ON CONFLICT (issue_id) WHERE ended_at IS NULL DO NOTHING`);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Đọc trạng thái
// ---------------------------------------------------------------------------------------------------------------

export interface QcIssueState {
  issueId: string;
  /** Mã và tiêu đề của issue, để mục "Cần tôi duyệt" hiện được mà không đọc thêm. */
  identifier: string | null;
  title: string;
  roundId: string;
  state: QcOpenState;
  /** Người QC được giao duyệt (người đã gửi yêu cầu). */
  qcUserId: string;
  startedAt: string;
  verifiedAt: string | null;
  verifiedByUserId: string | null;
  /** Yêu cầu mở lại đang chờ owner duyệt (không kèm lý do: lý do chỉ owner và người gửi đọc qua router góp ý). */
  reopenRequest: { id: string; status: "pending" | "approving" } | null;
}

const iso = (value: unknown): string | null => {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
};

const STATE_COLUMNS = sql.raw(`r.id::text AS round_id, r.issue_id::text AS issue_id, i.identifier, i.title,
  r.status, r.qc_user_id,
  r.started_at, r.verified_at, r.verified_by_user_id,
  (SELECT c.id::text FROM ${derivePluginDatabaseNamespace(CREW_PLUGIN_KEY)}.crew_contributions c
    WHERE c.target_issue_id = r.issue_id AND c.kind = 'reopen' AND c.status IN ('pending','approving') LIMIT 1) AS reopen_id,
  (SELECT c.status FROM ${derivePluginDatabaseNamespace(CREW_PLUGIN_KEY)}.crew_contributions c
    WHERE c.target_issue_id = r.issue_id AND c.kind = 'reopen' AND c.status IN ('pending','approving') LIMIT 1) AS reopen_status`);

function toState(row: Row): QcIssueState {
  const reopenId = row.reopen_id == null ? null : String(row.reopen_id);
  return {
    issueId: String(row.issue_id),
    identifier: row.identifier == null ? null : String(row.identifier),
    title: String(row.title ?? ""),
    roundId: String(row.round_id),
    state: row.status === "verified" ? "verified" : "awaiting",
    qcUserId: String(row.qc_user_id),
    startedAt: iso(row.started_at) ?? "",
    verifiedAt: iso(row.verified_at),
    verifiedByUserId: row.verified_by_user_id == null ? null : String(row.verified_by_user_id),
    reopenRequest: reopenId ? { id: reopenId, status: row.reopen_status === "approving" ? "approving" : "pending" } : null,
  };
}

/**
 * Vòng QC đang mở của các issue `done` mà user thấy được: owner thấy tất cả, người khác chỉ issue thuộc project được
 * cấp. Bảng chưa có thì rỗng.
 */
export async function listQcStates(db: Sql, input: { companyId: string; userId: string }): Promise<QcIssueState[]> {
  if (!(await qcTablesReady(db))) return [];
  const visible = await visibleProjectsFor(db, input.companyId, input.userId);
  if (!visible.all && visible.projectIds.length === 0) return [];
  const projectFilter = visible.all
    ? sql``
    : sql`AND i.project_id IN (${sql.join(visible.projectIds.map((id) => sql`${id}::uuid`), sql`, `)})`;
  const rows = rowsOf(
    await db.execute(sql`SELECT ${STATE_COLUMNS} FROM ${roundsTable()} r
      JOIN "issues" i ON i.id = r.issue_id AND i.company_id = r.company_id
      WHERE r.company_id = ${input.companyId} AND r.ended_at IS NULL AND i.status = 'done' AND i.hidden_at IS NULL
        ${projectFilter}
      ORDER BY r.started_at DESC, r.id DESC`),
  );
  return rows.map(toState);
}

async function openRound(db: Sql, companyId: string, issueId: string, lock: boolean): Promise<QcIssueState | null> {
  const rows = rowsOf(
    await db.execute(sql`SELECT ${STATE_COLUMNS} FROM ${roundsTable()} r
      JOIN "issues" i ON i.id = r.issue_id AND i.company_id = r.company_id
      WHERE r.company_id = ${companyId} AND r.issue_id = ${issueId} AND r.ended_at IS NULL AND i.status = 'done'
      ${lock ? sql`FOR UPDATE OF r` : sql``}`),
  );
  return rows[0] ? toState(rows[0]) : null;
}

function notAwaiting(): HttpError {
  return notFound("Issue này không chờ QC duyệt.", { code: QC_ERRORS.notAwaiting });
}

function qcForbidden(): HttpError {
  return new HttpError(403, "Crew: chỉ người QC đã gửi yêu cầu này hoặc owner được duyệt.", { code: QC_ERRORS.forbidden });
}

export interface QcActor {
  companyId: string;
  userId: string;
  isOwner: boolean;
  /** Viewer còn dấu góp ý (Phòng Marketing hoặc Phòng QC). */
  contributor: boolean;
}

/** Owner, hoặc người QC được giao vòng này (còn dấu góp ý và còn quyền xem project của issue). */
async function assertCanDecide(db: Sql, actor: QcActor, round: QcIssueState): Promise<void> {
  if (actor.isOwner) return;
  if (!actor.contributor || round.qcUserId !== actor.userId) throw qcForbidden();
  const projectRows = rowsOf(
    await db.execute(sql`SELECT project_id::text AS project_id FROM "issues"
      WHERE id = ${round.issueId} AND company_id = ${actor.companyId} LIMIT 1`),
  );
  const projectId = typeof projectRows[0]?.project_id === "string" ? projectRows[0].project_id : null;
  if (!(await canSeeProject(db, actor.companyId, actor.userId, projectId))) throw qcForbidden();
}

/**
 * QC "Xác nhận đạt": vòng `awaiting` → `verified`. Chỉ đổi bảng plugin: không ghi issue lõi, không bình luận, không
 * đánh thức ai. Đã `verified` thì trả lại như cũ. Đang có yêu cầu mở lại chờ owner thì `409`.
 */
export async function verifyQcRound(db: Tx, actor: QcActor, issueId: string): Promise<QcIssueState> {
  if (!(await qcTablesReady(db))) throw notAwaiting();
  return db.transaction(async (tx) => {
    const round = await openRound(tx, actor.companyId, issueId, true);
    if (!round) throw notAwaiting();
    await assertCanDecide(tx, actor, round);
    if (round.state === "verified") return round;
    if (round.reopenRequest) {
      throw conflict("Đang có yêu cầu mở lại chờ owner duyệt.", { code: QC_ERRORS.reopenPending });
    }
    await tx.execute(sql`UPDATE ${roundsTable()}
      SET status = 'verified', verified_by_user_id = ${actor.userId}, verified_at = now()
      WHERE id = ${round.roundId} AND status = 'awaiting' AND ended_at IS NULL`);
    return (await openRound(tx, actor.companyId, issueId, false)) ?? round;
  });
}

/**
 * Điều kiện gửi "Chưa đạt" (góp ý `reopen`): người gửi là người QC của vòng đang mở, vòng còn `awaiting`, chưa có yêu
 * cầu mở lại đang chờ. Quyền xem project kiểm ở nơi gọi (như mọi góp ý).
 */
export async function assertCanRequestReopen(db: Sql, input: { companyId: string; userId: string; issueId: string }): Promise<void> {
  if (!(await qcTablesReady(db))) throw notAwaiting();
  const round = await openRound(db, input.companyId, input.issueId, false);
  if (!round || round.state !== "awaiting") throw notAwaiting();
  if (round.qcUserId !== input.userId) throw qcForbidden();
  if (round.reopenRequest) {
    throw conflict("Đang có yêu cầu mở lại chờ owner duyệt.", { code: QC_ERRORS.reopenPending });
  }
}

/** Bình luận owner đăng khi duyệt "Chưa đạt": agent đọc lý do của QC kèm lời mở lại. */
export function reopenCommentBody(reason: string): string {
  return `QC báo chưa đạt, mở lại để làm tiếp.\n\nLý do của QC:\n\n${reason}`;
}

/**
 * Phần QC của hook H2 (`beforeIssueWrite`), chạy sau cổng Crew trong cùng transaction: đọc trạng thái hiện tại dưới khóa
 * dòng và ghi vòng QC theo `patch.status` (chính object lõi sẽ ghi).
 */
export async function crewQcBeforeIssueWrite(input: {
  tx: Sql;
  issueId: string;
  patch: Readonly<Record<string, unknown>>;
}): Promise<void> {
  const next = input.patch.status;
  if (typeof next !== "string") return;
  const rows = rowsOf(
    await input.tx.execute(sql`SELECT status, company_id::text AS company_id FROM "issues"
      WHERE id = ${input.issueId} FOR UPDATE`),
  );
  const locked = rows[0];
  if (!locked) return;
  await recordQcStatusChange({
    tx: input.tx,
    issueId: input.issueId,
    companyId: String(locked.company_id),
    fromStatus: String(locked.status),
    toStatus: next,
  });
}

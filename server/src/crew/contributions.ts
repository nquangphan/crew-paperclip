import { sql } from "drizzle-orm";
import type { Request } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { multilineTextSchema } from "@paperclipai/shared/validators/text";
import { badRequest, forbidden, HttpError, notFound, unprocessable } from "../errors.js";
import { hasCompanyAccess } from "../routes/authz.js";
import { derivePluginDatabaseNamespace } from "../services/plugin-database.js";
import { loadCrewCompanyConfig } from "./issue-policy.js";
import { CREW_PLUGIN_KEY, rowsOf } from "./project-roles.js";

/**
 * Góp ý chờ owner duyệt của thành viên "Phòng Marketing" (khóa `contributor`).
 *
 * Nội dung chờ nằm ở hai bảng plugin `crew_contributions`/`crew_contributors` (migration `0013_contributions.sql` của
 * `crew.core`), không bao giờ ở bảng lõi, nên mọi đường đọc của agent không thấy. Chỉ server (router Crew) đọc/ghi hai
 * bảng này. Không ghi activity, không phát event: dấu vết nằm ngay trong dòng góp ý.
 */

/** `db` hoặc `tx`; mọi câu ở đây là SQL thô. */
type Sql = Pick<Db, "execute">;
type Row = Record<string, unknown>;

export const CONTRIBUTION_KINDS = ["issue", "comment"] as const;
export const CONTRIBUTION_STATUSES = ["pending", "approving", "approved", "rejected"] as const;
export type ContributionKind = (typeof CONTRIBUTION_KINDS)[number];
export type ContributionStatus = (typeof CONTRIBUTION_STATUSES)[number];

/** Owner khác chỉ giành lại một mục `approving` khi người đang duyệt đã giữ khóa quá lâu. */
export const APPROVING_LOCK_MINUTES = 10;
const LOCK_INTERVAL = sql.raw(`interval '${APPROVING_LOCK_MINUTES} minutes'`);
/** Số mục tối đa mỗi lần đọc danh sách. */
export const CONTRIBUTION_LIST_LIMIT = 200;
/** Khóa idempotent của route tạo issue stock cho một mục góp ý. */
export const contributionIdempotencyKey = (id: string) => `crew-contribution:${id}`;

export function crewContributionsTable(): string {
  return `${derivePluginDatabaseNamespace(CREW_PLUGIN_KEY)}.crew_contributions`;
}

export function crewContributorsTable(): string {
  return `${derivePluginDatabaseNamespace(CREW_PLUGIN_KEY)}.crew_contributors`;
}

const contributionsTable = () => sql.raw(crewContributionsTable());
const contributorsTable = () => sql.raw(crewContributorsTable());

export interface Contribution {
  id: string;
  kind: ContributionKind;
  status: ContributionStatus;
  authorUserId: string;
  projectId: string | null;
  targetIssueId: string | null;
  title: string | null;
  body: string | null;
  createdAt: string;
  decidedAt: string | null;
  decidedByUserId: string | null;
  resultIssueId: string | null;
  resultCommentId: string | null;
}

/** Dòng đọc từ bảng, thêm `companyId` và `approvingAt` (không trả ra API). */
export interface ContributionRecord extends Contribution {
  companyId: string;
  approvingAt: string | null;
}

export type Materialize =
  | {
      kind: "issue";
      companyId: string;
      projectId: string;
      title: string;
      description: string | null;
      idempotencyKey: string;
    }
  | { kind: "comment"; issueId: string; body: string; clientRequestId: string };

// ---------------------------------------------------------------------------------------------------------------
// Lỗi
// ---------------------------------------------------------------------------------------------------------------

export const CONTRIBUTION_ERRORS = {
  forbidden: "crew_contribution_forbidden",
  unavailable: "crew_contributions_unavailable",
  invalid: "crew_contribution_invalid",
  invalidTarget: "crew_contribution_invalid_target",
  notMaterialized: "crew_contribution_not_materialized",
  notApproving: "crew_contribution_not_approving",
  decided: "crew_contribution_decided",
  alreadyApproved: "crew_contribution_already_approved",
  locked: "crew_contribution_locked",
  requiresViewer: "crew_contributor_requires_viewer",
} as const;

export function contributionForbidden(message = "Crew: bạn không có quyền với góp ý này."): HttpError {
  return forbidden(message, { code: CONTRIBUTION_ERRORS.forbidden });
}

function companyNotFound(): HttpError {
  return notFound("Không tìm thấy company.");
}

export function contributionNotFound(): HttpError {
  return notFound("Không tìm thấy mục góp ý.");
}

function contributionsUnavailable(): HttpError {
  return new HttpError(503, "Crew: chưa có bảng góp ý (plugin crew.core chưa nâng cấp), hãy thử lại sau.", {
    code: CONTRIBUTION_ERRORS.unavailable,
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Người gọi
// ---------------------------------------------------------------------------------------------------------------

export interface ContributionActor {
  companyId: string;
  userId: string;
  /** Role membership `active` của user trong company, đọc từ DB; `null` khi không có membership. */
  membershipRole: string | null;
  /** Viewer có dấu khách góp ý (Phòng Marketing). */
  contributor: boolean;
  /** Owner của chính company: người duy nhất được duyệt/từ chối và bật/gỡ dấu. */
  isOwner: boolean;
  /** Hai bảng góp ý đã có (plugin đã áp migration). */
  tablesReady: boolean;
}

const uuidSchema = z.string().uuid();
export const isUuid = (value: unknown): value is string => uuidSchema.safeParse(value).success;

/**
 * Xác định người gọi router Crew góp ý. Thứ tự (luật chung của spec):
 * 1. Chỉ actor board có `userId` thật (không phải `local_implicit`); agent và mọi actor khác → `403`.
 * 2. Company không thuộc phiên hoặc không có trong cấu hình Crew → `404`.
 * 3. Role đọc trực tiếp từ DB (membership `active`, `principal_type='user'`), không tin cache phiên. Không có membership
 *    (vd. instance admin) thì `membershipRole = null`: `/access` vẫn trả, mọi endpoint khác nhận `403` ở bước xét role.
 * 4. `requireTables`: hai bảng plugin chưa có → `503 crew_contributions_unavailable`.
 *
 * Không gọi `assertCompanyAccess`, vì hàm đó chặn mọi lệnh ghi của viewer; quyền của router tự xét theo role ở DB.
 */
export async function resolveContributionActor(
  db: Sql,
  req: Request,
  companyIdParam: unknown,
  opts: { requireTables: boolean },
): Promise<ContributionActor> {
  const actor = req.actor;
  if (actor?.type !== "board" || actor.source === "local_implicit") throw contributionForbidden();
  const userId = typeof actor.userId === "string" ? actor.userId.trim() : "";
  if (!userId) throw contributionForbidden();

  if (!isUuid(companyIdParam) || !hasCompanyAccess(req, companyIdParam)) throw companyNotFound();
  const companyId = companyIdParam;
  const config = await loadCrewCompanyConfig(companyId);
  if (config.kind === "absent") throw companyNotFound();

  const membership = rowsOf(
    await db.execute(sql`SELECT membership_role FROM "company_memberships"
      WHERE company_id = ${companyId} AND principal_type = 'user' AND principal_id = ${userId} AND status = 'active'
      LIMIT 1`),
  )[0];
  const membershipRole = typeof membership?.membership_role === "string" ? membership.membership_role : null;

  const tablesReady = await contributionTablesReady(db);
  if (opts.requireTables && !tablesReady) throw contributionsUnavailable();
  const contributor = membershipRole === "viewer" && tablesReady && (await isContributorFlagged(db, companyId, userId));
  return { companyId, userId, membershipRole, contributor, isOwner: membershipRole === "owner", tablesReady };
}

export function requireOwner(actor: ContributionActor): void {
  if (!actor.isOwner) throw contributionForbidden("Crew: chỉ owner của company được làm việc này.");
}

export function requireContributor(actor: ContributionActor): void {
  if (!actor.contributor) throw contributionForbidden("Crew: chỉ thành viên Phòng Marketing được gửi góp ý.");
}

export function requireOwnerOrContributor(actor: ContributionActor): void {
  if (!actor.isOwner && !actor.contributor) throw contributionForbidden();
}

// ---------------------------------------------------------------------------------------------------------------
// Bảng plugin
// ---------------------------------------------------------------------------------------------------------------

export async function contributionTablesReady(db: Sql): Promise<boolean> {
  const rows = rowsOf(
    await db.execute(sql`SELECT (to_regclass(${crewContributionsTable()}) IS NOT NULL
      AND to_regclass(${crewContributorsTable()}) IS NOT NULL) AS ok`),
  );
  return rows[0]?.ok === true;
}

export async function isContributorFlagged(db: Sql, companyId: string, userId: string): Promise<boolean> {
  const rows = rowsOf(
    await db.execute(sql`SELECT 1 AS ok FROM ${contributorsTable()} WHERE company_id = ${companyId} AND user_id = ${userId} LIMIT 1`),
  );
  return rows.length > 0;
}

const text = (value: unknown): string | null => (value == null ? null : String(value));
const iso = (value: unknown): string | null => {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
};

function toRecord(row: Row): ContributionRecord {
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    kind: row.kind as ContributionKind,
    status: row.status as ContributionStatus,
    authorUserId: String(row.author_user_id),
    projectId: text(row.project_id),
    targetIssueId: text(row.target_issue_id),
    title: text(row.title),
    body: text(row.body),
    createdAt: iso(row.created_at) ?? "",
    decidedAt: iso(row.decided_at),
    decidedByUserId: text(row.decided_by_user_id),
    resultIssueId: text(row.result_issue_id),
    resultCommentId: text(row.result_comment_id),
    approvingAt: iso(row.approving_at),
  };
}

/** Hình dạng trả ra API (spec §5): bỏ `companyId`, `approvingAt`. */
export function toContribution(record: ContributionRecord): Contribution {
  const { companyId: _companyId, approvingAt: _approvingAt, ...contribution } = record;
  return contribution;
}

const COLUMNS = sql.raw(`id::text AS id, company_id::text AS company_id, kind, status, author_user_id,
  project_id::text AS project_id, target_issue_id::text AS target_issue_id, title, body, decided_by_user_id,
  approving_at, decided_at, result_issue_id::text AS result_issue_id, result_comment_id::text AS result_comment_id,
  created_at`);

async function selectOne(db: Sql, companyId: string, id: string, lock: boolean): Promise<ContributionRecord | null> {
  if (!isUuid(id)) return null;
  const rows = rowsOf(
    await db.execute(sql`SELECT ${COLUMNS} FROM ${contributionsTable()}
      WHERE company_id = ${companyId} AND id = ${id} ${lock ? sql`FOR UPDATE` : sql``}`),
  );
  return rows[0] ? toRecord(rows[0]) : null;
}

export async function getContribution(db: Sql, companyId: string, id: string): Promise<ContributionRecord | null> {
  return selectOne(db, companyId, id, false);
}

/** Owner thấy mọi mục; người khác chỉ mục của chính mình. Không thấy thì `404` (không lộ việc mục có tồn tại). */
export function assertCanRead(actor: ContributionActor, record: ContributionRecord | null): ContributionRecord {
  if (!record) throw contributionNotFound();
  if (actor.isOwner) return record;
  if (actor.contributor && record.authorUserId === actor.userId) return record;
  throw contributionNotFound();
}

export const listQuerySchema = z.object({
  /** `pending` gồm cả `approving` (đang duyệt dở vẫn là chờ duyệt với người dùng). */
  status: z.enum(CONTRIBUTION_STATUSES).optional(),
  kind: z.enum(CONTRIBUTION_KINDS).optional(),
  issueId: z.string().uuid().optional(),
});
export type ListQuery = z.infer<typeof listQuerySchema>;

export async function listContributions(
  db: Sql,
  input: { companyId: string; authorUserId: string | null; query: ListQuery },
): Promise<Contribution[]> {
  const { companyId, authorUserId, query } = input;
  const statuses: ContributionStatus[] | null =
    query.status === "pending" ? ["pending", "approving"] : query.status ? [query.status] : null;
  const filters = [sql`company_id = ${companyId}`];
  if (authorUserId) filters.push(sql`author_user_id = ${authorUserId}`);
  if (statuses) filters.push(sql`status IN (${sql.join(statuses.map((status) => sql`${status}`), sql`, `)})`);
  if (query.kind) filters.push(sql`kind = ${query.kind}`);
  if (query.issueId) filters.push(sql`kind = 'comment' AND target_issue_id = ${query.issueId}`);
  const rows = rowsOf(
    await db.execute(sql`SELECT ${COLUMNS} FROM ${contributionsTable()}
      WHERE ${sql.join(filters, sql` AND `)}
      ORDER BY created_at DESC, id DESC
      LIMIT ${CONTRIBUTION_LIST_LIMIT}`),
  );
  return rows.map((row) => toContribution(toRecord(row)));
}

export async function countPending(db: Sql, companyId: string, authorUserId: string | null): Promise<number> {
  const rows = rowsOf(
    await db.execute(sql`SELECT count(*)::int AS n FROM ${contributionsTable()}
      WHERE company_id = ${companyId} AND status IN ('pending', 'approving')
      ${authorUserId ? sql`AND author_user_id = ${authorUserId}` : sql``}`),
  );
  return Number(rows[0]?.n ?? 0);
}

// ---------------------------------------------------------------------------------------------------------------
// Tạo
// ---------------------------------------------------------------------------------------------------------------

const optionalDescription = multilineTextSchema
  .optional()
  .nullable()
  .transform((value) => (value == null || value.trim().length === 0 ? null : value));

export const createContributionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("issue"),
      projectId: z.string().uuid(),
      // Như `setIssueTitleSchema` của shared.
      title: z.string().trim().min(1).max(240),
      description: optionalDescription,
    })
    .strict(),
  z
    .object({
      kind: z.literal("comment"),
      issueId: z.string().uuid(),
      // Như `addIssueCommentSchema.body` của shared.
      body: multilineTextSchema.pipe(z.string().min(1)),
    })
    .strict(),
]);
export type CreateContributionInput = z.infer<typeof createContributionSchema>;

export function parseCreateBody(body: unknown): CreateContributionInput {
  const parsed = createContributionSchema.safeParse(body);
  if (!parsed.success) {
    throw badRequest("Dữ liệu góp ý không hợp lệ.", { code: CONTRIBUTION_ERRORS.invalid, issues: parsed.error.issues });
  }
  return parsed.data;
}

function invalidTarget(message: string): HttpError {
  return unprocessable(message, { code: CONTRIBUTION_ERRORS.invalidTarget });
}

export async function createContribution(
  db: Sql,
  input: { companyId: string; authorUserId: string; data: CreateContributionInput },
): Promise<Contribution> {
  const { companyId, authorUserId, data } = input;
  if (data.kind === "issue") {
    const project = rowsOf(
      await db.execute(sql`SELECT 1 AS ok FROM "projects"
        WHERE id = ${data.projectId} AND company_id = ${companyId} AND archived_at IS NULL LIMIT 1`),
    );
    if (project.length === 0) throw invalidTarget("Project không có trong company hoặc đã lưu trữ.");
    const rows = rowsOf(
      await db.execute(sql`INSERT INTO ${contributionsTable()} (company_id, kind, author_user_id, project_id, title, body)
        VALUES (${companyId}, 'issue', ${authorUserId}, ${data.projectId}, ${data.title}, ${data.description})
        RETURNING ${COLUMNS}`),
    );
    return toContribution(toRecord(rows[0]!));
  }
  const issue = rowsOf(
    await db.execute(sql`SELECT 1 AS ok FROM "issues"
      WHERE id = ${data.issueId} AND company_id = ${companyId} AND hidden_at IS NULL LIMIT 1`),
  );
  if (issue.length === 0) throw invalidTarget("Issue không có trong company, đã xóa hoặc đã ẩn.");
  const rows = rowsOf(
    await db.execute(sql`INSERT INTO ${contributionsTable()} (company_id, kind, author_user_id, target_issue_id, body)
      VALUES (${companyId}, 'comment', ${authorUserId}, ${data.issueId}, ${data.body})
      RETURNING ${COLUMNS}`),
  );
  return toContribution(toRecord(rows[0]!));
}

// ---------------------------------------------------------------------------------------------------------------
// Bản ghi đã tạo ở bảng lõi và đổi trạng thái
// ---------------------------------------------------------------------------------------------------------------

export type MaterializedResult = { resultIssueId: string } | { resultCommentId: string };

/**
 * Tìm bản ghi lõi mà bước đăng của trình duyệt owner đã tạo (spec §5.3). Không tin id do client gửi:
 * - issue: dòng `issue_create_idempotency_keys` với khóa `crew-contribution:<id>`, issue cùng company;
 * - bình luận: `issue_comments` của issue đích có `client_request_id = <id>`, mọi tác giả (bắt cả trường hợp owner
 *   khác đã đăng trước khi giành lại khóa).
 */
export async function findMaterialized(db: Sql, record: ContributionRecord): Promise<MaterializedResult | null> {
  if (record.kind === "issue") {
    const rows = rowsOf(
      await db.execute(sql`SELECT k.issue_id::text AS id FROM "issue_create_idempotency_keys" k
        JOIN "issues" i ON i.id = k.issue_id AND i.company_id = k.company_id
        WHERE k.company_id = ${record.companyId} AND k.idempotency_key = ${contributionIdempotencyKey(record.id)}
        LIMIT 1`),
    );
    return rows[0] ? { resultIssueId: String(rows[0].id) } : null;
  }
  if (!record.targetIssueId) return null;
  const rows = rowsOf(
    await db.execute(sql`SELECT id::text AS id FROM "issue_comments"
      WHERE issue_id = ${record.targetIssueId} AND company_id = ${record.companyId} AND client_request_id = ${record.id}
      ORDER BY created_at ASC
      LIMIT 1`),
  );
  return rows[0] ? { resultCommentId: String(rows[0].id) } : null;
}

/** `approving` → `approved` có điều kiện; giữ `decided_by_user_id` của người đã bắt đầu duyệt. */
async function markApproved(db: Sql, record: ContributionRecord, result: MaterializedResult): Promise<ContributionRecord | null> {
  const issueId = "resultIssueId" in result ? result.resultIssueId : null;
  const commentId = "resultCommentId" in result ? result.resultCommentId : null;
  const rows = rowsOf(
    await db.execute(sql`UPDATE ${contributionsTable()}
      SET status = 'approved', decided_at = now(), result_issue_id = ${issueId}, result_comment_id = ${commentId}
      WHERE id = ${record.id} AND company_id = ${record.companyId} AND status = 'approving'
      RETURNING ${COLUMNS}`),
  );
  return rows[0] ? toRecord(rows[0]) : null;
}

/**
 * Tự lành: mọi dòng `approving` của company đã có bản ghi lõi thì thành `approved`. Chạy trước khi đọc danh sách và
 * đếm, nên tab owner đóng giữa bước đăng và bước `complete` vẫn không để mục treo.
 */
export async function selfHeal(db: Sql, companyId: string): Promise<number> {
  const rows = rowsOf(
    await db.execute(sql`SELECT ${COLUMNS} FROM ${contributionsTable()}
      WHERE company_id = ${companyId} AND status = 'approving'
      ORDER BY approving_at ASC NULLS FIRST
      LIMIT ${CONTRIBUTION_LIST_LIMIT}`),
  );
  let healed = 0;
  for (const record of rows.map(toRecord)) {
    const found = await findMaterialized(db, record);
    if (found && (await markApproved(db, record, found))) healed += 1;
  }
  return healed;
}

export function materializeOf(record: ContributionRecord): Materialize {
  if (record.kind === "issue") {
    return {
      kind: "issue",
      companyId: record.companyId,
      projectId: record.projectId!,
      title: record.title!,
      description: record.body,
      idempotencyKey: contributionIdempotencyKey(record.id),
    };
  }
  return { kind: "comment", issueId: record.targetIssueId!, body: record.body!, clientRequestId: record.id };
}

type Tx = Sql & Pick<Db, "transaction">;

export type ApproveOutcome =
  | { outcome: "approving"; contribution: Contribution; materialize: Materialize }
  /** Mục đã ở trạng thái cuối (kể cả vừa tìm thấy bản ghi lõi và chuyển `approved`). */
  | { outcome: "decided"; contribution: Contribution }
  /** Owner khác đang duyệt, khóa chưa quá hạn. */
  | { outcome: "locked"; contribution: Contribution };

/**
 * `pending` → `approving` (khóa), hoặc `approving` → `approving` khi cùng người hay khóa đã quá
 * {@link APPROVING_LOCK_MINUTES} phút. Trước khi giành lại luôn tìm bản ghi lõi đã tạo. Dòng được khóa `FOR UPDATE`
 * trong transaction, và mỗi lần đổi là một `UPDATE … WHERE status = …` có điều kiện.
 */
export async function approveContribution(
  db: Tx,
  input: { companyId: string; id: string; userId: string },
): Promise<ApproveOutcome> {
  return db.transaction(async (tx) => {
    const record = await selectOne(tx, input.companyId, input.id, true);
    if (!record) throw contributionNotFound();
    if (record.status === "approved" || record.status === "rejected") {
      return { outcome: "decided", contribution: toContribution(record) };
    }
    if (record.status === "approving") {
      const found = await findMaterialized(tx, record);
      if (found) {
        const approved = await markApproved(tx, record, found);
        return { outcome: "decided", contribution: toContribution(approved ?? record) };
      }
    }
    const rows = rowsOf(
      await tx.execute(
        record.status === "pending"
          ? sql`UPDATE ${contributionsTable()}
              SET status = 'approving', decided_by_user_id = ${input.userId}, approving_at = now()
              WHERE id = ${record.id} AND company_id = ${record.companyId} AND status = 'pending'
              RETURNING ${COLUMNS}`
          : sql`UPDATE ${contributionsTable()}
              SET decided_by_user_id = ${input.userId}, approving_at = now()
              WHERE id = ${record.id} AND company_id = ${record.companyId} AND status = 'approving'
                AND (decided_by_user_id = ${input.userId}
                  OR approving_at IS NULL
                  OR approving_at <= now() - ${LOCK_INTERVAL})
              RETURNING ${COLUMNS}`,
      ),
    );
    const updated = rows[0] ? toRecord(rows[0]) : null;
    if (!updated) return { outcome: "locked", contribution: toContribution(record) };
    return { outcome: "approving", contribution: toContribution(updated), materialize: materializeOf(updated) };
  });
}

export type CompleteOutcome =
  | { outcome: "approved"; contribution: Contribution }
  | { outcome: "not_materialized"; contribution: Contribution }
  | { outcome: "not_approving"; contribution: Contribution };

/** Bước 3: server tự tìm bản ghi lõi; thấy thì `approved`, đã `approved` thì trả lại như cũ (gọi lại an toàn). */
export async function completeContribution(db: Tx, input: { companyId: string; id: string }): Promise<CompleteOutcome> {
  return db.transaction(async (tx) => {
    const record = await selectOne(tx, input.companyId, input.id, true);
    if (!record) throw contributionNotFound();
    if (record.status === "approved") return { outcome: "approved", contribution: toContribution(record) };
    if (record.status !== "approving") return { outcome: "not_approving", contribution: toContribution(record) };
    const found = await findMaterialized(tx, record);
    const approved = found ? await markApproved(tx, record, found) : null;
    return approved
      ? { outcome: "approved", contribution: toContribution(approved) }
      : { outcome: "not_materialized", contribution: toContribution(record) };
  });
}

export type RejectOutcome =
  | { outcome: "rejected"; contribution: Contribution }
  /** Đã có bản ghi lõi (mục chuyển `approved`) hoặc mục đã duyệt từ trước. */
  | { outcome: "approved"; contribution: Contribution }
  | { outcome: "locked"; contribution: Contribution };

/**
 * `pending`/`approving` → `rejected`. Mục `approving` mà bản ghi lõi đã có thì chuyển `approved` thay vì từ chối. Mục
 * `approving` của owner khác còn trong hạn khóa thì không từ chối (người đó có thể đang đăng). Đã `rejected` thì trả lại
 * như cũ.
 */
export async function rejectContribution(
  db: Tx,
  input: { companyId: string; id: string; userId: string },
): Promise<RejectOutcome> {
  return db.transaction(async (tx) => {
    const record = await selectOne(tx, input.companyId, input.id, true);
    if (!record) throw contributionNotFound();
    if (record.status === "rejected") return { outcome: "rejected", contribution: toContribution(record) };
    if (record.status === "approved") return { outcome: "approved", contribution: toContribution(record) };
    if (record.status === "approving") {
      const found = await findMaterialized(tx, record);
      if (found) {
        const approved = await markApproved(tx, record, found);
        return { outcome: "approved", contribution: toContribution(approved ?? record) };
      }
    }
    const rows = rowsOf(
      await tx.execute(sql`UPDATE ${contributionsTable()}
        SET status = 'rejected', decided_by_user_id = ${input.userId}, decided_at = now()
        WHERE id = ${record.id} AND company_id = ${record.companyId}
          AND (status = 'pending'
            OR (status = 'approving' AND (decided_by_user_id = ${input.userId}
              OR approving_at IS NULL
              OR approving_at <= now() - ${LOCK_INTERVAL})))
        RETURNING ${COLUMNS}`),
    );
    const updated = rows[0] ? toRecord(rows[0]) : null;
    if (!updated) return { outcome: "locked", contribution: toContribution(record) };
    return { outcome: "rejected", contribution: toContribution(updated) };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Dấu khách góp ý
// ---------------------------------------------------------------------------------------------------------------

export interface ContributorGrant {
  userId: string;
  grantedAt: string;
  grantedByUserId: string;
}

export const contributorUserIdSchema = z.string().trim().min(1).max(255);

export async function listContributors(db: Sql, companyId: string): Promise<ContributorGrant[]> {
  const rows = rowsOf(
    await db.execute(sql`SELECT user_id, granted_at, granted_by_user_id FROM ${contributorsTable()}
      WHERE company_id = ${companyId} ORDER BY granted_at ASC, user_id ASC`),
  );
  return rows.map((row) => ({
    userId: String(row.user_id),
    grantedAt: iso(row.granted_at) ?? "",
    grantedByUserId: String(row.granted_by_user_id),
  }));
}

/** Bật dấu cho user là viewer `active` của company; trả `false` khi user không phải viewer như thế. */
export async function grantContributor(
  db: Sql,
  input: { companyId: string; userId: string; grantedByUserId: string },
): Promise<boolean> {
  const viewer = rowsOf(
    await db.execute(sql`SELECT 1 AS ok FROM "company_memberships"
      WHERE company_id = ${input.companyId} AND principal_type = 'user' AND principal_id = ${input.userId}
        AND status = 'active' AND membership_role = 'viewer'
      LIMIT 1`),
  );
  if (viewer.length === 0) return false;
  await db.execute(sql`INSERT INTO ${contributorsTable()} (company_id, user_id, granted_by_user_id)
    VALUES (${input.companyId}, ${input.userId}, ${input.grantedByUserId})
    ON CONFLICT (company_id, user_id) DO NOTHING`);
  return true;
}

export async function revokeContributor(db: Sql, input: { companyId: string; userId: string }): Promise<void> {
  await db.execute(sql`DELETE FROM ${contributorsTable()} WHERE company_id = ${input.companyId} AND user_id = ${input.userId}`);
}

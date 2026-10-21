import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { forbidden, type HttpError } from "../errors.js";
import { derivePluginDatabaseNamespace } from "../services/plugin-database.js";
import { CREW_PLUGIN_KEY, rowsOf } from "./project-roles.js";

/**
 * Quyền xem project theo từng thành viên (bảng plugin `crew_project_access`, migration `0016_project_access.sql` của
 * `crew.core`). Owner của company thấy mọi project; mọi thành viên người khác (admin, operator, viewer, Phòng
 * Marketing, Phòng QC) chỉ thấy project owner đã cấp, mặc định không thấy gì, và không thấy issue không thuộc project nào.
 * Agent không bị ảnh hưởng.
 *
 * Chỉ UI Crew và router Crew áp luật này; API lõi của Paperclip không đổi (đọc thẳng API lõi vẫn thấy).
 * Bảng chưa có (plugin chưa nâng cấp) thì người bị giới hạn không thấy project nào (đóng khi lỗi).
 */

type Sql = Pick<Db, "execute">;

export const PROJECT_ACCESS_ERRORS = {
  notVisible: "crew_project_not_visible",
  unavailable: "crew_project_access_unavailable",
  invalid: "crew_project_access_invalid",
  notMember: "crew_project_access_not_member",
} as const;

/** Số project tối đa trong một lần đặt quyền. */
export const PROJECT_ACCESS_MAX = 500;

export function crewProjectAccessTable(): string {
  return `${derivePluginDatabaseNamespace(CREW_PLUGIN_KEY)}.crew_project_access`;
}

const accessTable = () => sql.raw(crewProjectAccessTable());

export function projectNotVisible(): HttpError {
  return forbidden("Crew: bạn chưa được owner cấp quyền xem project này.", { code: PROJECT_ACCESS_ERRORS.notVisible });
}

export async function projectAccessTableReady(db: Sql): Promise<boolean> {
  const rows = rowsOf(await db.execute(sql`SELECT to_regclass(${crewProjectAccessTable()}) IS NOT NULL AS ok`));
  return rows[0]?.ok === true;
}

async function isActiveOwner(db: Sql, companyId: string, userId: string): Promise<boolean> {
  const rows = rowsOf(
    await db.execute(sql`SELECT 1 AS ok FROM "company_memberships"
      WHERE company_id = ${companyId} AND principal_type = 'user' AND principal_id = ${userId}
        AND status = 'active' AND membership_role = 'owner' LIMIT 1`),
  );
  return rows.length > 0;
}

/** Project của company mà user (không phải owner) được cấp; bảng chưa có thì rỗng. */
export async function grantedProjectIds(db: Sql, companyId: string, userId: string): Promise<string[]> {
  if (!(await projectAccessTableReady(db))) return [];
  const rows = rowsOf(
    await db.execute(sql`SELECT a.project_id::text AS project_id FROM ${accessTable()} a
      JOIN "projects" p ON p.id = a.project_id AND p.company_id = a.company_id
      WHERE a.company_id = ${companyId} AND a.user_id = ${userId}
      ORDER BY a.project_id`),
  );
  return rows.map((row) => String(row.project_id));
}

export type VisibleProjects = { all: true; projectIds: [] } | { all: false; projectIds: string[] };

/** Project user thấy được: owner thấy tất cả, người khác chỉ project đã được cấp. */
export async function visibleProjectsFor(db: Sql, companyId: string, userId: string): Promise<VisibleProjects> {
  if (await isActiveOwner(db, companyId, userId)) return { all: true, projectIds: [] };
  return { all: false, projectIds: await grantedProjectIds(db, companyId, userId) };
}

/** User thấy project này không. Issue không thuộc project nào (`projectId = null`) chỉ owner thấy. */
export async function canSeeProject(db: Sql, companyId: string, userId: string, projectId: string | null): Promise<boolean> {
  const visible = await visibleProjectsFor(db, companyId, userId);
  if (visible.all) return true;
  return projectId !== null && visible.projectIds.includes(projectId);
}

export async function assertProjectVisible(db: Sql, companyId: string, userId: string, projectId: string | null): Promise<void> {
  if (!(await canSeeProject(db, companyId, userId, projectId))) throw projectNotVisible();
}

/** Project của issue (cùng company), `null` khi issue không thuộc project nào hoặc không có. */
export async function issueProjectId(db: Sql, companyId: string, issueId: string): Promise<string | null> {
  const rows = rowsOf(
    await db.execute(sql`SELECT project_id::text AS project_id FROM "issues"
      WHERE id = ${issueId} AND company_id = ${companyId} LIMIT 1`),
  );
  const value = rows[0]?.project_id;
  return typeof value === "string" ? value : null;
}

export interface MemberProjectAccess {
  userId: string;
  /** `true`: owner, thấy mọi project. */
  all: boolean;
  projectIds: string[];
}

/** Quyền xem của mọi thành viên người đang hoạt động (chỉ owner gọi). */
export async function listProjectAccess(db: Sql, companyId: string): Promise<MemberProjectAccess[]> {
  const ready = await projectAccessTableReady(db);
  const members = rowsOf(
    await db.execute(sql`SELECT principal_id, membership_role FROM "company_memberships"
      WHERE company_id = ${companyId} AND principal_type = 'user' AND status = 'active'
      ORDER BY principal_id`),
  );
  const grants = ready
    ? rowsOf(
        await db.execute(sql`SELECT a.user_id, a.project_id::text AS project_id FROM ${accessTable()} a
          JOIN "projects" p ON p.id = a.project_id AND p.company_id = a.company_id
          WHERE a.company_id = ${companyId} ORDER BY a.user_id, a.project_id`),
      )
    : [];
  const byUser = new Map<string, string[]>();
  for (const row of grants) {
    const userId = String(row.user_id);
    byUser.set(userId, [...(byUser.get(userId) ?? []), String(row.project_id)]);
  }
  return members.map((row) => {
    const userId = String(row.principal_id);
    const all = row.membership_role === "owner";
    return { userId, all, projectIds: all ? [] : (byUser.get(userId) ?? []) };
  });
}

export const setProjectAccessSchema = z
  .object({ projectIds: z.array(z.string().uuid()).max(PROJECT_ACCESS_MAX) })
  .strict();

type Tx = Sql & Pick<Db, "transaction">;

export type SetProjectAccessOutcome =
  | { outcome: "ok"; projectIds: string[] }
  | { outcome: "not_member" }
  | { outcome: "owner" }
  | { outcome: "unknown_projects"; projectIds: string[] };

/**
 * Thay toàn bộ danh sách project user được xem. Chỉ cho thành viên người đang hoạt động, không phải owner (owner luôn
 * thấy tất cả). Mọi project phải thuộc company; project đã lưu trữ vẫn cấp được.
 */
export async function setProjectAccess(
  db: Tx,
  input: { companyId: string; userId: string; projectIds: string[]; grantedByUserId: string },
): Promise<SetProjectAccessOutcome> {
  const projectIds = [...new Set(input.projectIds)].sort();
  return db.transaction(async (tx) => {
    const membership = rowsOf(
      await tx.execute(sql`SELECT membership_role FROM "company_memberships"
        WHERE company_id = ${input.companyId} AND principal_type = 'user' AND principal_id = ${input.userId}
          AND status = 'active' LIMIT 1`),
    )[0];
    if (!membership) return { outcome: "not_member" };
    if (membership.membership_role === "owner") return { outcome: "owner" };
    if (projectIds.length > 0) {
      const known = rowsOf(
        await tx.execute(sql`SELECT id::text AS id FROM "projects"
          WHERE company_id = ${input.companyId}
            AND id IN (${sql.join(projectIds.map((id) => sql`${id}::uuid`), sql`, `)})`),
      ).map((row) => String(row.id));
      const unknown = projectIds.filter((id) => !known.includes(id));
      if (unknown.length > 0) return { outcome: "unknown_projects", projectIds: unknown };
    }
    await tx.execute(sql`DELETE FROM ${accessTable()} WHERE company_id = ${input.companyId} AND user_id = ${input.userId}
      ${projectIds.length > 0 ? sql`AND project_id NOT IN (${sql.join(projectIds.map((id) => sql`${id}::uuid`), sql`, `)})` : sql``}`);
    for (const projectId of projectIds) {
      await tx.execute(sql`INSERT INTO ${accessTable()} (company_id, user_id, project_id, granted_by_user_id)
        VALUES (${input.companyId}, ${input.userId}, ${projectId}, ${input.grantedByUserId})
        ON CONFLICT (company_id, user_id, project_id) DO NOTHING`);
    }
    return { outcome: "ok", projectIds };
  });
}

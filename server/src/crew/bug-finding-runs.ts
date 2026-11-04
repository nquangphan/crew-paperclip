import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import type { BugFindingRunFact, BugFindingRunReader } from "./issue-gate.js";
import { crewTable, crewTableSql } from "./machine-pin.js";
import { rowsOf } from "./project-roles.js";

/**
 * Lượt Bug Finding của issue trong bảng `crew_bug_finding_runs` của plugin `crew.core` (migration `0025_bug_finding.sql`),
 * mới nhất trước. Bảng chưa có (plugin chưa nâng cấp) thì như chưa có lượt nào. Đọc qua handle transaction của lệnh ghi.
 */
export const readBugFindingRuns: BugFindingRunReader = async ({ db, companyId, issueId }) => {
  const ready = rowsOf(await db.execute(sql`SELECT to_regclass(${crewTable("crew_bug_finding_runs")}) IS NOT NULL AS ok`));
  if (ready[0]?.ok !== true) return [];
  const rows = rowsOf(await db.execute(sql`SELECT head_sha, state FROM ${crewTableSql("crew_bug_finding_runs")}
    WHERE company_id = ${companyId} AND issue_id = ${issueId} ORDER BY created_at DESC`));
  return rows.map((row): BugFindingRunFact => ({ headSha: String(row.head_sha), state: String(row.state) }));
};

/**
 * Owner yêu cầu sửa ticket tổng Bug Finding ở stage duyệt: sang vòng duyệt mới (bảng `crew_bug_finding_rounds` của plugin),
 * để plugin đếm lại lượt Bug Finding và lô sửa tự động từ đầu. Bảng chưa có thì bỏ qua. Ghi trong transaction của lệnh ghi.
 */
export async function bumpBugFindingRound(db: Db, companyId: string, issueId: string): Promise<void> {
  const ready = rowsOf(await db.execute(sql`SELECT to_regclass(${crewTable("crew_bug_finding_rounds")}) IS NOT NULL AS ok`));
  if (ready[0]?.ok !== true) return;
  await db.execute(sql`INSERT INTO ${crewTableSql("crew_bug_finding_rounds")} (company_id, issue_id, round)
    VALUES (${companyId}, ${issueId}, 1)
    ON CONFLICT (company_id, issue_id) DO UPDATE SET round = ${crewTableSql("crew_bug_finding_rounds")}.round + 1, updated_at = now()`);
}

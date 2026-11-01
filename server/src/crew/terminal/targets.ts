import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { crewTableSql } from "../machine-pin.js";
import { projectLayout } from "../machine-provision.js";
import { rowsOf } from "../project-roles.js";

export type TerminalTarget = {
  machineId: string;
  hostname: string;
  projectId: string;
  projectName: string;
  projectKey: string;
  /** Nhánh trong `project_repos`; `null` khi project chưa ghi origin (dựng từ `origin/HEAD` trên máy). */
  branch: string | null;
};

/** Khóa project nằm trong đường dẫn checkout `…/crew-agents/<khóa>/repo`. */
const REPO_PATH_RE = /\/crew-agents\/([a-z][a-z0-9-]{1,30})\/repo\/?$/;

/**
 * Khóa thư mục `~/crew-agents/<khóa>` của project: lấy từ checkout của agent vai trò (đúng cho cả project dùng bản
 * clone sẵn của owner, khi `repo_path` nằm ngoài `crew-agents`), không có thì từ `repo_path` của project Crew tự clone.
 */
function projectKeyOf(layoutKey: string | null, row: Record<string, unknown>): string | null {
  if (layoutKey) return layoutKey;
  return (typeof row.repo_path === "string" ? REPO_PATH_RE.exec(row.repo_path)?.[1] : undefined) ?? null;
}

function toTarget(row: Record<string, unknown>, key: string | null): TerminalTarget | null {
  if (!key) return null;
  return {
    machineId: String(row.machine_id),
    hostname: String(row.hostname),
    projectId: String(row.project_id),
    projectName: String(row.project_name),
    projectKey: key,
    branch: typeof row.branch === "string" && row.branch ? row.branch : null,
  };
}

/** Các project đã dựng xong (`ready`) trên máy còn ghép, theo hostname rồi tên project; có thể thu hẹp theo máy và project. */
async function queryTargets(db: Db, companyId: string, only?: { machineId: string; projectId: string }): Promise<TerminalTarget[]> {
  const filter = only
    ? sql`AND pm.machine_id = ${only.machineId} AND pm.project_id = ${only.projectId}`
    : sql``;
  const rows = rowsOf(await db.execute(sql`SELECT pm.machine_id, mp.hostname, pm.project_id, p.name AS project_name,
      pm.repo_path, pr.branch
    FROM ${crewTableSql("project_machines")} pm
    JOIN ${crewTableSql("machine_pairings")} mp ON mp.company_id = pm.company_id AND mp.machine_id = pm.machine_id
      AND mp.revoked_at IS NULL
    JOIN projects p ON p.id = pm.project_id AND p.company_id = pm.company_id
    LEFT JOIN ${crewTableSql("project_repos")} pr ON pr.company_id = pm.company_id AND pr.project_id = pm.project_id
    WHERE pm.company_id = ${companyId} AND pm.status = 'ready' ${filter}
    ORDER BY mp.hostname, p.name`));
  const layoutKeys = new Map<string, Promise<string | null>>();
  const layoutKeyOf = (projectId: string) => {
    if (!layoutKeys.has(projectId))
      layoutKeys.set(projectId, projectLayout(db, companyId, projectId).then((layout) => layout?.projectKey ?? null));
    return layoutKeys.get(projectId)!;
  };
  const targets = await Promise.all(
    rows.map(async (row) => toTarget(row, projectKeyOf(await layoutKeyOf(String(row.project_id)), row))),
  );
  return targets.filter((target): target is TerminalTarget => target !== null);
}

export const listTerminalTargets = (db: Db, companyId: string): Promise<TerminalTarget[]> => queryTargets(db, companyId);

export async function resolveTerminalTarget(
  db: Db, companyId: string, machineId: string, projectId: string,
): Promise<TerminalTarget | null> {
  return (await queryTargets(db, companyId, { machineId, projectId }))[0] ?? null;
}

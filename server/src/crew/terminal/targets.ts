import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { crewTableSql } from "../machine-pin.js";
import { rowsOf } from "../project-roles.js";

export type TerminalTarget = {
  machineId: string;
  hostname: string;
  projectId: string;
  projectName: string;
  projectKey: string;
  branch: string;
};

/** Khóa project nằm trong đường dẫn checkout `…/crew-agents/<khóa>/repo`. */
const REPO_PATH_RE = /\/crew-agents\/([a-z][a-z0-9-]{1,30})\/repo\/?$/;

function toTarget(row: Record<string, unknown>): TerminalTarget | null {
  const key = typeof row.repo_path === "string" ? REPO_PATH_RE.exec(row.repo_path)?.[1] : undefined;
  if (!key) return null;
  return {
    machineId: String(row.machine_id),
    hostname: String(row.hostname),
    projectId: String(row.project_id),
    projectName: String(row.project_name),
    projectKey: key,
    branch: String(row.branch),
  };
}

/** Các project đã dựng xong (`ready`) trên máy đã ghép, theo hostname rồi tên project. */
export async function listTerminalTargets(db: Db, companyId: string): Promise<TerminalTarget[]> {
  const rows = rowsOf(await db.execute(sql`SELECT pm.machine_id, mp.hostname, pm.project_id, p.name AS project_name,
      pm.repo_path, pr.branch
    FROM ${crewTableSql("project_machines")} pm
    JOIN ${crewTableSql("machine_pairings")} mp ON mp.company_id = pm.company_id AND mp.machine_id = pm.machine_id
    JOIN projects p ON p.id = pm.project_id AND p.company_id = pm.company_id
    JOIN ${crewTableSql("project_repos")} pr ON pr.company_id = pm.company_id AND pr.project_id = pm.project_id
    WHERE pm.company_id = ${companyId} AND pm.status = 'ready'
    ORDER BY mp.hostname, p.name`));
  return rows.flatMap((row) => toTarget(row) ?? []);
}

export async function resolveTerminalTarget(
  db: Db, companyId: string, machineId: string, projectId: string,
): Promise<TerminalTarget | null> {
  return (await listTerminalTargets(db, companyId)).find((t) => t.machineId === machineId && t.projectId === projectId) ?? null;
}

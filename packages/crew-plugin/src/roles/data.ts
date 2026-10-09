import type { PluginContext } from "@paperclipai/plugin-sdk";
import { pluginNamespace, UUID } from "../shared/db.js";

/** Agent roles of one project. Every id is a lowercase agent uuid of the project's company. */
export interface ProjectRoles {
  assistantAgentId: string;
  executorAgentIds: string[];
  reviewerAgentId: string;
  integratorAgentId: string;
}

type Ctx = Pick<PluginContext, "db">;
const table = (ctx: Ctx) => `${pluginNamespace(ctx)}.crew_project_roles`;

/** Postgres array literal of already validated uuids; avoids driver-specific array binding. */
function uuidArray(ids: string[]): string {
  if (!ids.every((id) => UUID.test(id))) throw new Error("ID không hợp lệ");
  return `{${ids.join(",")}}`;
}

export async function readProjectRoles(ctx: Ctx, companyId: string, projectId: string): Promise<ProjectRoles | null> {
  const rows = await ctx.db.query<{
    assistant_agent_id: string; executor_agent_ids: string; reviewer_agent_id: string; integrator_agent_id: string;
  }>(
    `SELECT assistant_agent_id::text, array_to_string(executor_agent_ids, ',') AS executor_agent_ids,
      reviewer_agent_id::text, integrator_agent_id::text
     FROM ${table(ctx)} WHERE company_id = $1 AND project_id = $2`,
    [companyId, projectId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    assistantAgentId: row.assistant_agent_id,
    executorAgentIds: row.executor_agent_ids.split(","),
    reviewerAgentId: row.reviewer_agent_id,
    integratorAgentId: row.integrator_agent_id,
  };
}

export async function upsertProjectRoles(
  ctx: Ctx, companyId: string, projectId: string, roles: ProjectRoles, userId: string,
): Promise<void> {
  const target = table(ctx);
  await ctx.db.execute(
    `INSERT INTO ${target} (company_id,project_id,assistant_agent_id,executor_agent_ids,reviewer_agent_id,integrator_agent_id,updated_at,updated_by_user_id)
     VALUES ($1,$2,$3,$4::uuid[],$5,$6,now(),$7)
     ON CONFLICT (company_id,project_id) DO UPDATE SET assistant_agent_id=EXCLUDED.assistant_agent_id,
       executor_agent_ids=EXCLUDED.executor_agent_ids,reviewer_agent_id=EXCLUDED.reviewer_agent_id,
       integrator_agent_id=EXCLUDED.integrator_agent_id,updated_at=EXCLUDED.updated_at,
       updated_by_user_id=EXCLUDED.updated_by_user_id`,
    [companyId, projectId, roles.assistantAgentId, uuidArray(roles.executorAgentIds), roles.reviewerAgentId,
      roles.integratorAgentId, userId],
  );
}

export async function deleteProjectRoles(ctx: Ctx, companyId: string, projectId: string): Promise<boolean> {
  const result = await ctx.db.execute(`DELETE FROM ${table(ctx)} WHERE company_id = $1 AND project_id = $2`, [companyId, projectId]);
  return result.rowCount > 0;
}

/** Ids from `agentIds` that are not agents of `companyId`, in input order. */
export async function agentsOutsideCompany(ctx: Ctx, companyId: string, agentIds: string[]): Promise<string[]> {
  const rows = await ctx.db.query<{ id: string }>(
    "SELECT id::text FROM public.agents WHERE company_id = $1 AND id = ANY($2::uuid[])",
    [companyId, uuidArray(agentIds)],
  );
  const found = new Set(rows.map((row) => row.id.toLowerCase()));
  return agentIds.filter((id) => !found.has(id));
}

export async function projectInCompany(ctx: Ctx, companyId: string, projectId: string): Promise<boolean> {
  const rows = await ctx.db.query("SELECT id FROM public.projects WHERE id = $1 AND company_id = $2", [projectId, companyId]);
  return rows.length > 0;
}

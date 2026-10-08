import type { PluginContext } from "@paperclipai/plugin-sdk";
import { isCrewRoot } from "./map.js";

export interface CrewRoot {
  id: string;
  identifier: string;
  title: string;
  status: string;
  updatedAt: string;
  doneChildren: number;
  totalChildren: number;
  stage: { currentStageId: string | null; currentType: string | null; completed: string[] } | null;
}

type RootRow = {
  id: string; identifier: string | null; title: string; status: string;
  updated_at: string | Date; execution_policy: unknown; execution_state: unknown;
  done_children: number | string; total_children: number | string;
};

function jsonObject(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { return null; }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export async function loadCrewRoots(ctx: Pick<PluginContext, "db">, companyId: string, status?: string): Promise<CrewRoot[]> {
  if (!/^[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$/.test(companyId)) {
    throw new Error("companyId không hợp lệ");
  }
  const rows = await ctx.db.query<RootRow>(`
    SELECT i.id, i.identifier, i.title, i.status, i.updated_at, i.execution_policy, i.execution_state,
           count(c.id)::int AS total_children,
           count(c.id) FILTER (WHERE c.status = 'done')::int AS done_children
    FROM public.issues i
    LEFT JOIN public.issues c ON c.parent_id = i.id AND c.company_id = i.company_id
    WHERE i.company_id = $1 AND i.parent_id IS NULL
      AND ($2::text IS NULL OR ($2 = 'open' AND i.status NOT IN ('done', 'cancelled')) OR i.status = $2)
    GROUP BY i.id
    ORDER BY i.updated_at DESC, i.id DESC
  `, [companyId, status ?? null]);
  return rows.filter(isCrewRoot).map((row) => {
    const state = jsonObject(row.execution_state);
    return {
      id: row.id, identifier: row.identifier ?? row.id, title: row.title, status: row.status,
      updatedAt: new Date(row.updated_at).toISOString(),
      doneChildren: Number(row.done_children), totalChildren: Number(row.total_children),
      stage: state ? {
        currentStageId: typeof state.currentStageId === "string" ? state.currentStageId : null,
        currentType: typeof state.currentStageType === "string" ? state.currentStageType : null,
        completed: Array.isArray(state.completedStageIds)
          ? state.completedStageIds.filter((id): id is string => typeof id === "string") : [],
      } : null,
    };
  });
}

export function registerRootsFeature(ctx: PluginContext): void {
  ctx.data.register("crew.roots", async (params) => loadCrewRoots(ctx, String(params.companyId ?? ""),
    typeof params.status === "string" ? params.status : undefined));
}

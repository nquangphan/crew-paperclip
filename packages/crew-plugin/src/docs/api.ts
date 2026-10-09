import type { PluginApiRequestInput, PluginApiResponse, PluginContext } from "@paperclipai/plugin-sdk";
import { UUID } from "../shared/db.js";
import { loadDocsGraph } from "./graph-data.js";

const one = (value: unknown): unknown => (Array.isArray(value) ? value[0] : value);
const text = (value: unknown) => (typeof value === "string" && value !== "" ? value : undefined);

/**
 * Agent and board route for the docs graph. The host resolved the company from the actor; a `companyId` query
 * that disagrees with it is refused, and the project must still belong to that company.
 * Returns null when the route is not a docs route.
 */
export async function handleDocsApi(
  ctx: Pick<PluginContext, "db" | "logger">, input: PluginApiRequestInput,
): Promise<PluginApiResponse | null> {
  if (input.routeKey !== "docs.graph") return null;
  const query = input.query ?? {};
  const companyId = String(one(query.companyId) ?? input.companyId ?? "");
  const projectId = String(one(query.projectId) ?? "");
  if (!UUID.test(companyId) || !UUID.test(projectId)) return { status: 400, body: { error: "companyId/projectId không hợp lệ" } };
  if (input.companyId && input.companyId.toLowerCase() !== companyId.toLowerCase()) {
    return { status: 400, body: { error: "companyId không khớp company hiện tại" } };
  }
  try {
    const graph = await loadDocsGraph(ctx as PluginContext, companyId, projectId, {
      snapshotId: text(one(query.snapshotId)), flowId: text(one(query.flowId)),
    });
    return graph ? { status: 200, body: graph } : { status: 404, body: { error: "Dự án chưa có tài liệu" } };
  } catch (error) {
    ctx.logger.warn("crew docs graph request failed", { err: error instanceof Error ? error.message : String(error) });
    return { status: 400, body: { error: String((error as Error)?.message ?? error).slice(0, 200) } };
  }
}

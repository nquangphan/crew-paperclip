import type { PluginApiRequestInput, PluginApiResponse, PluginContext } from "@paperclipai/plugin-sdk";
import { UUID } from "../shared/db.js";
import { loadDocsGraph } from "./graph-data.js";

const one = (value: unknown): unknown => (Array.isArray(value) ? value[0] : value);
const text = (value: unknown) => (typeof value === "string" && value !== "" ? value : undefined);
/** Errors this route raises on bad input or scope; anything else is internal (may carry SQL) and stays in the log. */
const CALLER_ERRORS = new Set(["ID không hợp lệ", "flowId không hợp lệ", "Snapshot không thuộc dự án", "Dự án không thuộc company hiện tại"]);

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
    const message = error instanceof Error ? error.message : String(error);
    if (CALLER_ERRORS.has(message)) return { status: 400, body: { error: message } };
    ctx.logger.warn("crew docs graph request failed", { err: message });
    return { status: 500, body: { error: "Không đọc được đồ thị docs" } };
  }
}

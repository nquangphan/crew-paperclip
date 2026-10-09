import type { Request } from "express";
import { and, eq } from "drizzle-orm";
import { agents, type Db } from "@paperclipai/db";
import { notFound, unprocessable } from "../errors.js";
import { loadCrewCompanyConfig } from "./issue-policy.js";

export interface AgentMutationInput {
  db: Db;
  req: Request;
  /** Dùng resolver stock để UUID, shortname và company query có cùng hợp đồng với route. */
  resolveAgentId: (req: Request, reference: string) => Promise<string>;
}

const PROTECTED_ADAPTER_KEYS = ["command", "extraArgs", "env", "model"] as const;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function decodeReference(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    // Express tự trả lỗi URL sai; không đổi lỗi đó thành lỗi cấu hình Crew.
    return null;
  }
}

const AGENT_SUBRESOURCE_WRITE_RE =
  /^\/agents\/([^/]+)\/(?:skills\/sync|instructions-path|instructions-bundle(?:\/.*)?)\/?$/i;
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Guard mọi lệnh ghi cấu hình agent của actor agent trong company Crew (file cấu hình có company, kể cả lỗi):
 * - tạo agent (`agents`, `agent-hires`) và chạy thử adapter với cấu hình tùy ý: `crew_agent_create_forbidden`,
 *   bất kể body và quyền `canCreateAgents`;
 * - `PATCH /agents/:id` (mọi body: role, reportsTo, runtimeConfig, budget, adapterConfig...), đồng bộ skill,
 *   hướng dẫn (`instructions-bundle*`, `instructions-path`) và rollback revision: `crew_agent_config_forbidden`.
 * Agent Crew không tự sửa agent nào; mọi đổi cấu hình đi qua board. Board và company ngoài cấu hình giữ stock.
 */
export async function crewBeforeAgentMutation({ db, req, resolveAgentId }: AgentMutationInput): Promise<void> {
  if (req.actor.type !== "agent" || !req.actor.companyId) return;
  if (!WRITE_METHODS.has(req.method)) return;
  const create = req.method === "POST"
    ? /^\/companies\/([^/]+)\/(?:agents|agent-hires|adapters\/[^/]+\/test-environment)\/?$/i.exec(req.path)
    : null;
  const patch = req.method === "PATCH" ? /^\/agents\/([^/]+)\/?$/i.exec(req.path) : null;
  const rollback = req.method === "POST"
    ? /^\/agents\/([^/]+)\/config-revisions\/[^/]+\/rollback\/?$/i.exec(req.path)
    : null;
  const subresource = AGENT_SUBRESOURCE_WRITE_RE.exec(req.path);
  if (!create && !patch && !rollback && !subresource) return;

  const companyId = req.actor.companyId;
  if (create && decodeReference(create[1]!) !== companyId) return;
  const config = await loadCrewCompanyConfig(companyId);
  if (config.kind === "absent") return;

  if (create) {
    throw unprocessable("Crew: agent không được tạo agent hay chạy thử adapter; việc này chỉ board làm.", {
      code: "crew_agent_create_forbidden",
    });
  }

  const target = patch ?? rollback ?? subresource;
  const reference = decodeReference(target![1]!);
  if (reference === null) return;
  const agentId = await resolveAgentId(req, reference);
  const [agent] = await db.select({ id: agents.id }).from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.companyId, companyId))).limit(1);
  if (!agent) throw notFound("Agent not found");

  const body = record(req.body);
  const adapterConfig = record(body?.adapterConfig);
  let keys: string[];
  if (rollback) {
    // Rollback thay toàn bộ snapshot: key bị bỏ khỏi snapshot cũng xóa ghim.
    keys = PROTECTED_ADAPTER_KEYS.map((key) => `adapterConfig.${key}`);
  } else if (patch) {
    keys = PROTECTED_ADAPTER_KEYS
      .filter((key) => adapterConfig && Object.hasOwn(adapterConfig, key))
      .map((key) => `adapterConfig.${key}`);
    // Cả thay adapter và thay toàn bộ object đều có thể xóa ghim mà không gửi key được bảo vệ.
    if (body && Object.hasOwn(body, "adapterType")) keys.push("adapterType");
    if (adapterConfig && body?.replaceAdapterConfig === true) keys.push("replaceAdapterConfig");
    if (keys.length === 0) keys = Object.keys(body ?? {});
  } else {
    keys = [req.path.replace(/^\/agents\/[^/]+\//i, "").replace(/\/$/, "")];
  }
  throw unprocessable("Crew: agent không được sửa cấu hình, skill hay hướng dẫn của agent; việc này chỉ board làm.", {
    code: "crew_agent_config_forbidden",
    keys,
  });
}

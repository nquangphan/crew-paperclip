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

/** Guard request trước mọi mutation trong create, hire, PATCH và rollback agent. */
export async function crewBeforeAgentMutation({ db, req, resolveAgentId }: AgentMutationInput): Promise<void> {
  if (req.actor.type !== "agent" || !req.actor.companyId) return;
  const create = req.method === "POST"
    ? /^\/companies\/([^/]+)\/(?:agents|agent-hires)\/?$/i.exec(req.path)
    : null;
  const patch = req.method === "PATCH" ? /^\/agents\/([^/]+)\/?$/i.exec(req.path) : null;
  const rollback = req.method === "POST"
    ? /^\/agents\/([^/]+)\/config-revisions\/[^/]+\/rollback\/?$/i.exec(req.path)
    : null;
  if (!create && !patch && !rollback) return;

  const body = record(req.body);
  const adapterConfig = record(body?.adapterConfig);
  const keys = PROTECTED_ADAPTER_KEYS
    .filter((key) => rollback || (adapterConfig && Object.hasOwn(adapterConfig, key)))
    .map((key) => `adapterConfig.${key}`);
  // Cả thay adapter và thay toàn bộ object đều có thể xóa ghim mà không gửi key được bảo vệ.
  if (patch && body && Object.hasOwn(body, "adapterType")) keys.push("adapterType");
  if (patch && adapterConfig && body?.replaceAdapterConfig === true) keys.push("replaceAdapterConfig");
  if (keys.length === 0) return;

  const companyId = req.actor.companyId;
  if (create && decodeReference(create[1]!) !== companyId) return;
  const config = await loadCrewCompanyConfig(companyId);
  if (config.kind === "absent") return;

  const target = patch ?? rollback;
  if (target) {
    const reference = decodeReference(target[1]!);
    if (reference === null) return;
    const agentId = await resolveAgentId(req, reference);
    const [agent] = await db.select({ id: agents.id }).from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.companyId, companyId))).limit(1);
    if (!agent) throw notFound("Agent not found");
  }

  // Rollback thay toàn bộ snapshot: key bị bỏ khỏi snapshot cũng xóa ghim. Chỉ board được rollback.
  throw unprocessable("Crew: agent không được sửa cấu hình thực thi đã ghim của agent.", {
    code: "crew_agent_config_forbidden",
    keys,
  });
}

import type { PluginApiRequestInput, PluginApiResponse, PluginContext } from "@paperclipai/plugin-sdk";
import { UUID } from "../shared/db.js";
import {
  agentsOutsideCompany, deleteProjectRoles, projectInCompany, type ProjectRoles, readProjectRoles, upsertProjectRoles,
} from "./data.js";

const BODY_KEYS = ["companyId", "assistantAgentId", "executorAgentIds", "reviewerAgentId", "integratorAgentId"];

const bad = (error: string): PluginApiResponse => ({ status: 400, body: { error } });
const uuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

/** Validates the POST body shape and role rules without touching the database. */
function parseRolesBody(body: unknown, companyId: string): ProjectRoles | string {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "body phải là object";
  const value = body as Record<string, unknown>;
  const unknownKey = Object.keys(value).find((key) => !BODY_KEYS.includes(key));
  if (unknownKey) return `trường ${unknownKey} không được hỗ trợ`;
  if (!uuid(value.companyId) || value.companyId.toLowerCase() !== companyId) return "companyId không hợp lệ";
  for (const key of ["assistantAgentId", "reviewerAgentId", "integratorAgentId"]) {
    if (!uuid(value[key])) return `${key} phải là uuid`;
  }
  const executors = value.executorAgentIds;
  if (!Array.isArray(executors) || !executors.every(uuid)) return "executorAgentIds phải là mảng uuid";
  if (executors.length < 1 || executors.length > 2) return "executorAgentIds phải có 1 hoặc 2 agent";
  const roles: ProjectRoles = {
    assistantAgentId: String(value.assistantAgentId).toLowerCase(),
    executorAgentIds: executors.map((id) => id.toLowerCase()),
    reviewerAgentId: String(value.reviewerAgentId).toLowerCase(),
    integratorAgentId: String(value.integratorAgentId).toLowerCase(),
  };
  if (roles.reviewerAgentId === roles.integratorAgentId) return "reviewer và integrator phải là hai agent khác nhau";
  const all = [roles.assistantAgentId, ...roles.executorAgentIds, roles.reviewerAgentId, roles.integratorAgentId];
  if (new Set(all).size !== all.length) return "mỗi agent chỉ giữ một vai trò trong project";
  return roles;
}

/**
 * Scoped API for project roles. The host already enforced board auth and company access;
 * the agent check stays here so a host rule change cannot let agents rewrite their own gate.
 */
export async function handleRolesApi(
  ctx: Pick<PluginContext, "db">, input: PluginApiRequestInput,
): Promise<PluginApiResponse> {
  if (input.actor.actorType !== "user") return { status: 403, body: { error: "Chỉ board được đổi vai trò project" } };
  if (!["roles.get", "roles.set", "roles.delete"].includes(input.routeKey)) {
    return { status: 404, body: { error: "Route không tồn tại" } };
  }
  const projectId = input.params.projectId;
  if (!uuid(projectId)) return bad("projectId phải là uuid");
  if (!uuid(input.companyId)) return bad("companyId phải là uuid");
  const project = projectId.toLowerCase();
  const company = input.companyId.toLowerCase();

  if (input.routeKey === "roles.get") {
    return { status: 200, body: { roles: await readProjectRoles(ctx, company, project) } };
  }
  if (input.routeKey === "roles.delete") {
    return { status: 200, body: { deleted: await deleteProjectRoles(ctx, company, project) } };
  }

  const roles = parseRolesBody(input.body, company);
  if (typeof roles === "string") return bad(roles);
  if (!await projectInCompany(ctx, company, project)) return bad(`project ${project} không thuộc company`);
  const outside = await agentsOutsideCompany(ctx, company, [
    roles.assistantAgentId, ...roles.executorAgentIds, roles.reviewerAgentId, roles.integratorAgentId,
  ]);
  if (outside.length > 0) return bad(`agent ${outside[0]} không thuộc company`);
  await upsertProjectRoles(ctx, company, project, roles, input.actor.userId ?? input.actor.actorId);
  return { status: 200, body: { roles: await readProjectRoles(ctx, company, project) } };
}

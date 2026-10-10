import type { PluginApiRequestInput, PluginApiResponse, PluginContext } from "@paperclipai/plugin-sdk";
import { UUID } from "../shared/db.js";
import {
  agentAdapterTypes, deleteProjectRoles, firstUnusableAgent, otherProjectRoles, projectInCompany, type ProjectRoles, readProjectRoles,
  RUNTIME_SLOT_KEYS, type RuntimeSlotKey, upsertProjectRoles,
} from "./data.js";

const BODY_KEYS = ["companyId", "assistantAgentId", "executorAgentIds", "reviewerAgentId", "integratorAgentId", ...RUNTIME_SLOT_KEYS];
/** Ô runtime và adapter mà agent của ô phải chạy. */
const RUNTIME_SLOTS: Record<RuntimeSlotKey, { slot: string; adapterType: string }> = {
  codexExecutorAgentId: { slot: "executor-codex", adapterType: "codex_local" },
  opencodeExecutorAgentId: { slot: "executor-opencode", adapterType: "opencode_local" },
  codexReviewerAgentId: { slot: "reviewer-codex", adapterType: "codex_local" },
};
/** Runtime ngoài Claude chỉ ngồi ô riêng của nó; ô Claude nhận mọi adapter khác (như trước). */
const RUNTIME_ONLY_ADAPTERS = new Set(["codex_local", "opencode_local"]);

/** Body đã kiểm dạng; ô runtime `undefined` = không gửi, giữ giá trị đang lưu. */
type RolesInput = Omit<ProjectRoles, RuntimeSlotKey> & Partial<Pick<ProjectRoles, RuntimeSlotKey>>;

const bad = (error: string): PluginApiResponse => ({ status: 400, body: { error } });
const uuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

/** Validates the POST body shape and role rules without touching the database. */
function parseRolesBody(body: unknown, companyId: string): RolesInput | string {
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
  const roles: RolesInput = {
    assistantAgentId: String(value.assistantAgentId).toLowerCase(),
    executorAgentIds: executors.map((id) => id.toLowerCase()),
    reviewerAgentId: String(value.reviewerAgentId).toLowerCase(),
    integratorAgentId: String(value.integratorAgentId).toLowerCase(),
  };
  for (const key of RUNTIME_SLOT_KEYS) {
    const slot = value[key];
    if (slot === undefined) continue;
    if (slot !== null && !uuid(slot)) return `${key} phải là uuid hoặc null`;
    roles[key] = slot === null ? null : slot.toLowerCase();
  }
  if (roles.reviewerAgentId === roles.integratorAgentId) return "reviewer và integrator phải là hai agent khác nhau";
  return duplicateError(roles) ?? roles;
}

function duplicateError(roles: RolesInput): string | null {
  const all = [roles.assistantAgentId, ...roles.executorAgentIds, roles.reviewerAgentId, roles.integratorAgentId,
    ...RUNTIME_SLOT_KEYS.map((key) => roles[key] ?? null).filter((id): id is string => id !== null)];
  return new Set(all).size === all.length ? null : "mỗi agent chỉ giữ một vai trò trong project";
}

/** Agent id của mọi ô đang có người. */
const allAgents = (roles: ProjectRoles) => [...workers(roles), ...gates(roles)];
/** Người làm: assistant, executor Claude và executor runtime. */
const workers = (roles: ProjectRoles) => [roles.assistantAgentId, ...roles.executorAgentIds,
  ...[roles.codexExecutorAgentId, roles.opencodeExecutorAgentId].filter((id): id is string => id !== null)];
/** Cổng duyệt: reviewer, integrator và reviewer Codex. */
const gates = (roles: ProjectRoles) => [roles.reviewerAgentId, roles.integratorAgentId,
  ...(roles.codexReviewerAgentId ? [roles.codexReviewerAgentId] : [])];

/** Ô quyết định runtime: ô runtime cần đúng adapter, ô Claude không nhận agent Codex/OpenCode. */
function adapterError(roles: ProjectRoles, adapters: Map<string, string>): string | null {
  for (const key of RUNTIME_SLOT_KEYS) {
    const id = roles[key];
    if (id === null) continue;
    const { slot, adapterType } = RUNTIME_SLOTS[key];
    const actual = adapters.get(id) ?? "";
    if (actual !== adapterType) return `agent ${id} chạy ${actual}, ô ${slot} cần ${adapterType}`;
  }
  const claudeSlots: [string, string][] = [
    ["assistant", roles.assistantAgentId], ...roles.executorAgentIds.map((id, i): [string, string] => [i === 0 ? "executor" : "executor-2", id]),
    ["reviewer", roles.reviewerAgentId], ["integrator", roles.integratorAgentId],
  ];
  for (const [slot, id] of claudeSlots) {
    const actual = adapters.get(id) ?? "";
    if (RUNTIME_ONLY_ADAPTERS.has(actual)) return `agent ${id} chạy ${actual}, ô ${slot} không nhận runtime ngoài Claude`;
  }
  return null;
}

/**
 * The gate forbids agents from assigning work to any reviewer/integrator of the company, whatever the project.
 * So across the company's projects an agent is either a worker (assistant/executor) or a gate role, never both.
 */
function crossProjectConflict(roles: ProjectRoles, others: { projectName: string; roles: ProjectRoles }[]): string | null {
  for (const other of others) {
    const asGate = workers(roles).find((id) => gates(other.roles).includes(id));
    if (asGate) return `agent ${asGate} đang là reviewer/integrator ở project "${other.projectName}", không thể làm assistant/executor`;
    const asWorker = gates(roles).find((id) => workers(other.roles).includes(id));
    if (asWorker) return `agent ${asWorker} đang là assistant/executor ở project "${other.projectName}", không thể làm reviewer/integrator`;
  }
  return null;
}

const ROLES_ERROR = "Không đọc/ghi được vai trò project";

/**
 * Audit trail for gate changes. The plugin SDK can write host activity (`ctx.activity.log`), but that needs the
 * `activity.log.write` capability in the manifest; until it is granted, a structured log line carries who changed
 * which project's roles, with the values before and after.
 */
function auditRoles(
  ctx: Pick<PluginContext, "logger">,
  entry: { action: "set" | "delete"; actorUserId: string; companyId: string; projectId: string; before: ProjectRoles | null; after: ProjectRoles | null },
): void {
  ctx.logger.info("crew project roles changed", entry);
}

/**
 * Scoped API for project roles. The host already enforced board auth and company access;
 * the agent check stays here so a host rule change cannot let agents rewrite their own gate.
 * Database failures never reach the board as SQL text: the detail goes to the server log only.
 */
export async function handleRolesApi(
  ctx: Pick<PluginContext, "db" | "logger">, input: PluginApiRequestInput,
): Promise<PluginApiResponse> {
  try {
    return await routeRolesApi(ctx, input);
  } catch (error) {
    ctx.logger.error("crew project roles request failed", {
      routeKey: input.routeKey, companyId: input.companyId, projectId: input.params.projectId,
      err: error instanceof Error ? error.message : String(error),
    });
    return { status: 500, body: { error: ROLES_ERROR } };
  }
}

async function routeRolesApi(
  ctx: Pick<PluginContext, "db" | "logger">, input: PluginApiRequestInput,
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
  const actorUserId = input.actor.userId ?? input.actor.actorId;
  if (input.routeKey === "roles.delete") {
    const before = await readProjectRoles(ctx, company, project);
    const deleted = await deleteProjectRoles(ctx, company, project);
    if (deleted) auditRoles(ctx, { action: "delete", actorUserId, companyId: company, projectId: project, before, after: null });
    return { status: 200, body: { deleted } };
  }

  const parsed = parseRolesBody(input.body, company);
  if (typeof parsed === "string") return bad(parsed);
  if (!await projectInCompany(ctx, company, project)) return bad(`project ${project} không thuộc company`);
  const before = await readProjectRoles(ctx, company, project);
  // Client cũ không gửi ô runtime: giữ ô đang lưu thay vì xóa.
  const roles: ProjectRoles = {
    ...parsed,
    codexExecutorAgentId: parsed.codexExecutorAgentId !== undefined ? parsed.codexExecutorAgentId : before?.codexExecutorAgentId ?? null,
    opencodeExecutorAgentId: parsed.opencodeExecutorAgentId !== undefined ? parsed.opencodeExecutorAgentId : before?.opencodeExecutorAgentId ?? null,
    codexReviewerAgentId: parsed.codexReviewerAgentId !== undefined ? parsed.codexReviewerAgentId : before?.codexReviewerAgentId ?? null,
  };
  const duplicate = duplicateError(roles);
  if (duplicate) return bad(duplicate);
  const unusable = await firstUnusableAgent(ctx, company, allAgents(roles));
  if (unusable) {
    return bad(`agent ${unusable.id} ${unusable.reason === "terminated" ? "đã terminated" : "không thuộc company"}`);
  }
  const mismatch = adapterError(roles, await agentAdapterTypes(ctx, company, allAgents(roles)));
  if (mismatch) return bad(mismatch);
  const conflict = crossProjectConflict(roles, await otherProjectRoles(ctx, company, project));
  if (conflict) return bad(conflict);
  await upsertProjectRoles(ctx, company, project, roles, actorUserId);
  auditRoles(ctx, { action: "set", actorUserId, companyId: company, projectId: project, before, after: roles });
  return { status: 200, body: { roles: await readProjectRoles(ctx, company, project) } };
}

import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { HttpError } from "../errors.js";
import { logger } from "../middleware/logger.js";
import { derivePluginDatabaseNamespace } from "../services/plugin-database.js";
import { type CrewCompanyConfig, loadCrewCompanyConfig } from "./issue-policy.js";

/** Plugin sở hữu bảng vai trò theo project (migration `0004_project_roles.sql` của plugin). */
export const CREW_PLUGIN_KEY = "crew.core";

export function crewRolesTable(): string {
  return `${derivePluginDatabaseNamespace(CREW_PLUGIN_KEY)}.crew_project_roles`;
}

/** `tx` của H2 hoặc `db` của H4. Mọi câu đọc chạy trong transaction lồng (savepoint trong `tx`). */
export type CrewRolesDb = Pick<Db, "execute" | "transaction">;

type Row = Record<string, unknown>;

export function rowsOf(result: unknown): Row[] {
  if (Array.isArray(result)) return result as Row[];
  const rows = (result as { rows?: unknown } | null)?.rows;
  return Array.isArray(rows) ? (rows as Row[]) : [];
}

const WARN_INTERVAL_MS = 60_000;
const lastWarnAt = new Map<string, number>();

export function warnOncePerMinute(companyId: string, kind: string, details: Record<string, unknown>, message: string): void {
  const key = `${companyId}\0${kind}`;
  const now = Date.now();
  const last = lastWarnAt.get(key);
  if (last !== undefined && now - last < WARN_INTERVAL_MS) return;
  lastWarnAt.set(key, now);
  logger.warn({ companyId, ...details }, message);
}

/**
 * Đọc trong transaction lồng: trong `tx` của H2 đây là savepoint, câu SQL lỗi chỉ rollback savepoint chứ không
 * abort transaction ghi issue. Bảng chỉ có sau khi plugin áp migration; kiểm `to_regclass` trước khi đọc.
 * Trả `null` khi bảng chưa có.
 */
async function readRoleRows(db: CrewRolesDb, query: (table: string) => ReturnType<typeof sql>): Promise<Row[] | null> {
  const table = crewRolesTable();
  return db.transaction(async (tx) => {
    const exists = rowsOf(await tx.execute(sql`SELECT to_regclass(${table}) IS NOT NULL AS ok`));
    if (exists[0]?.ok !== true) return null;
    return rowsOf(await tx.execute(query(table)));
  });
}

const lower = (value: unknown) => String(value).toLowerCase();

/**
 * Cột ô runtime (migration `0012_runtimes.sql`: `codex_executor_agent_id`, `opencode_executor_agent_id`,
 * `codex_reviewer_agent_id`) đọc qua `to_jsonb(r)`: plugin chưa áp 0012 thì cột chưa có và giá trị là NULL, như cũ.
 */
const optionalColumn = (column: string) => sql.raw(`(to_jsonb(r) ->> '${column}')`);

/** Dòng của project đã xóa (bảng plugin không có FK tới `projects`) coi như không có. */
const LIVE_PROJECT_JOIN = sql`JOIN "projects" p ON p.id = r.project_id AND p.company_id = r.company_id`;

/** Mã lỗi tạm của H4 khi không đọc được vai trò theo project; bên gọi thử lại sau. */
export const CREW_ROLES_UNAVAILABLE = "crew_roles_unavailable";

function rolesUnavailable(): HttpError {
  return new HttpError(503, "Crew: tạm thời không đọc được vai trò của project, hãy thử lại.", {
    code: CREW_ROLES_UNAVAILABLE,
  });
}

/**
 * Cấu hình Crew cho một issue: vai trò reviewer/integrator theo project từ bảng plugin, còn lại theo file.
 * - File `absent`/`invalid`, `projectId` trống, bảng chưa có, project không có dòng: như `loadCrewCompanyConfig`.
 * - Lỗi đọc khác: như `loadCrewCompanyConfig`, cảnh báo tối đa một lần mỗi phút cho mỗi company. Với
 *   `onReadError: "throw"` (H4: policy ghim vĩnh viễn lúc tạo) thì ném `503 crew_roles_unavailable` để bên gọi thử
 *   lại, không ghim reviewer/integrator file vốn có thể không có checkout repo của project này.
 * - Dòng trỏ agent không còn trong company (đã xóa, đã chuyển company) hoặc đã `terminated`: `invalid`
 *   (fail closed như cấu hình lỗi). Không rơi về vai trò file, vì đó là reviewer/integrator của project khác.
 */
export async function loadCrewRoles(input: {
  db: CrewRolesDb;
  companyId: string;
  projectId: string | null | undefined;
  /** `fallback` (mặc định; H2 của board/hệ thống): lỗi đọc thì dùng vai trò file. `throw` (H4; H2 của agent): ném 503. */
  onReadError?: "fallback" | "throw";
}): Promise<CrewCompanyConfig> {
  const config = await loadCrewCompanyConfig(input.companyId);
  if (config.kind !== "ok" || !input.projectId) return config;
  const { companyId, projectId } = input;
  let rows: Row[] | null;
  try {
    rows = await readRoleRows(
      input.db,
      (table) => sql`SELECT r.reviewer_agent_id::text AS reviewer_agent_id,
          r.integrator_agent_id::text AS integrator_agent_id,
          ra.status AS reviewer_status,
          ia.status AS integrator_status,
          ca.id::text AS codex_reviewer_agent_id
        FROM ${sql.raw(table)} r
        ${LIVE_PROJECT_JOIN}
        LEFT JOIN "agents" ra ON ra.id = r.reviewer_agent_id AND ra.company_id = r.company_id
        LEFT JOIN "agents" ia ON ia.id = r.integrator_agent_id AND ia.company_id = r.company_id
        LEFT JOIN "agents" ca ON ca.id::text = ${optionalColumn("codex_reviewer_agent_id")} AND ca.company_id = r.company_id
        WHERE r.company_id = ${companyId} AND r.project_id = ${projectId}
        LIMIT 1`,
    );
  } catch (error) {
    warnOncePerMinute(
      companyId,
      "read",
      { projectId, err: error },
      input.onReadError === "throw"
        ? "crew project roles unreadable; rejecting the issue write so the caller retries"
        : "crew project roles unreadable; using company roles from CREW_POLICY_CONFIG",
    );
    if (input.onReadError === "throw") throw rolesUnavailable();
    return config;
  }
  const row = rows?.[0];
  if (!row) return config;
  const roles = { reviewerAgentId: lower(row.reviewer_agent_id), integratorAgentId: lower(row.integrator_agent_id) };
  const gone = [
    [roles.reviewerAgentId, row.reviewer_status],
    [roles.integratorAgentId, row.integrator_status],
  ].filter(([, status]) => status == null || status === "terminated").map(([id]) => id as string);
  if (gone.length > 0) {
    const reason = `vai trò của project ${projectId} trỏ agent không còn hoạt động trong company: ${gone.join(", ")}`;
    warnOncePerMinute(companyId, "stale", { projectId, agentIds: gone }, "crew project roles point at missing agents; Crew gates fail closed for this project");
    return { kind: "invalid", reason };
  }
  // Reviewer Codex là ô tùy chọn: agent không còn trong company thì coi như project không có; agent `paused`/`terminated`
  // vẫn giữ id để hệ thống chuyển được participant của nó sang reviewer Claude (H2), H4 tự xét trạng thái.
  const codexReviewerAgentId = row.codex_reviewer_agent_id == null ? null : lower(row.codex_reviewer_agent_id);
  return { ...config, roles: { ...roles, codexReviewerAgentId } };
}

/**
 * Mọi agent reviewer/integrator của company: vai trò trong file ∪ mọi dòng vai trò theo project còn tồn tại (gồm
 * reviewer Codex).
 * Dùng cho luật "agent không giao việc cho reviewer/integrator" (bất kể project của issue). Lỗi đọc: `fallback`
 * (mặc định) chỉ dùng vai trò file và cảnh báo; `throw` (actor agent) ném `503 crew_roles_unavailable`.
 */
export async function loadCompanyRoleAgentIds(input: {
  db: CrewRolesDb;
  companyId: string;
  onReadError?: "fallback" | "throw";
}): Promise<Set<string>> {
  const config = await loadCrewCompanyConfig(input.companyId);
  const ids = new Set<string>();
  if (config.kind === "absent") return ids;
  if (config.kind === "ok") {
    ids.add(config.roles.reviewerAgentId);
    ids.add(config.roles.integratorAgentId);
  }
  try {
    const rows = await readRoleRows(
      input.db,
      (table) => sql`SELECT r.reviewer_agent_id::text AS reviewer_agent_id, r.integrator_agent_id::text AS integrator_agent_id,
          ${optionalColumn("codex_reviewer_agent_id")} AS codex_reviewer_agent_id
        FROM ${sql.raw(table)} r ${LIVE_PROJECT_JOIN} WHERE r.company_id = ${input.companyId}`,
    );
    for (const row of rows ?? []) {
      ids.add(lower(row.reviewer_agent_id));
      ids.add(lower(row.integrator_agent_id));
      if (row.codex_reviewer_agent_id != null) ids.add(lower(row.codex_reviewer_agent_id));
    }
  } catch (error) {
    warnOncePerMinute(
      input.companyId,
      "read",
      { err: error },
      input.onReadError === "throw"
        ? "crew project roles unreadable; rejecting the issue write so the caller retries"
        : "crew project roles unreadable; using company roles from CREW_POLICY_CONFIG",
    );
    if (input.onReadError === "throw") throw rolesUnavailable();
  }
  return ids;
}

/** Trợ Lý và executor (mọi runtime) của một project theo bảng vai trò crew.core (cho luật giao việc giữa agent). */
export interface ProjectAgentRoles {
  assistantAgentId: string;
  executorAgentIds: string[];
}

/**
 * Trợ Lý và executor của project. `null` khi không có project, bảng chưa có hoặc project không có dòng vai trò
 * (project dùng vai trò file): bên gọi giữ hành vi cũ. Lỗi đọc khác: như `loadCrewRoles` — `fallback` trả `null` và
 * cảnh báo, `throw` (H4, H2 của agent) ném `503 crew_roles_unavailable` để bên gọi thử lại.
 */
export async function loadProjectAgentRoles(input: {
  db: CrewRolesDb;
  companyId: string;
  projectId: string | null | undefined;
  onReadError: "fallback" | "throw";
}): Promise<ProjectAgentRoles | null> {
  const { companyId, projectId } = input;
  if (!projectId) return null;
  let rows: Row[] | null;
  try {
    rows = await readRoleRows(
      input.db,
      (table) => sql`SELECT r.assistant_agent_id::text AS assistant_agent_id,
          array_to_string(r.executor_agent_ids, ',') AS executor_agent_ids,
          ${optionalColumn("codex_executor_agent_id")} AS codex_executor_agent_id,
          ${optionalColumn("opencode_executor_agent_id")} AS opencode_executor_agent_id
        FROM ${sql.raw(table)} r
        ${LIVE_PROJECT_JOIN}
        WHERE r.company_id = ${companyId} AND r.project_id = ${projectId}
        LIMIT 1`,
    );
  } catch (error) {
    warnOncePerMinute(
      companyId,
      "read",
      { projectId, err: error },
      input.onReadError === "throw"
        ? "crew project roles unreadable; rejecting the issue write so the caller retries"
        : "crew project roles unreadable; agent assignment uses company roles only",
    );
    if (input.onReadError === "fallback") return null;
    throw rolesUnavailable();
  }
  const row = rows?.[0];
  if (!row) return null;
  return {
    assistantAgentId: lower(row.assistant_agent_id),
    // Executor của project = ô Claude (`executor_agent_ids`) ∪ executor Codex ∪ executor OpenCode.
    executorAgentIds: [
      ...String(row.executor_agent_ids ?? "").split(",").filter(Boolean),
      row.codex_executor_agent_id,
      row.opencode_executor_agent_id,
    ]
      .filter((id): id is string => typeof id === "string" && id.length > 0)
      .map(lower),
  };
}

/**
 * Luật giao việc giữa agent trong project có vai trò: Trợ Lý giao cho agent bất kỳ (luật reviewer/integrator xét
 * riêng); agent khác giao cho executor của project, hoặc tự nhận khi issue chưa giao agent nào (không tự lấy việc
 * đang giao Trợ Lý hay executor khác, kể cả khi mình là executor). Không có dòng vai trò thì cho qua.
 */
export function agentAssignmentAllowed(input: {
  actorAgentId: string;
  targetAgentId: string;
  roles: ProjectAgentRoles | null;
  /** Assignee agent hiện tại của issue (H2); tạo mới (H4) thì không có. */
  currentAssigneeAgentId?: string | null;
}): boolean {
  if (!input.roles) return true;
  const actor = input.actorAgentId.toLowerCase();
  const target = input.targetAgentId.toLowerCase();
  if (actor === input.roles.assistantAgentId) return true;
  if (target === actor) {
    const current = input.currentAssigneeAgentId?.toLowerCase() ?? null;
    return current === null || current === actor;
  }
  return input.roles.executorAgentIds.includes(target);
}

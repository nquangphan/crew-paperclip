import { type Request, type Response, Router } from "express";
import { and, eq, inArray, ne, notInArray, sql } from "drizzle-orm";
import { agents, type Db, issues } from "@paperclipai/db";
import { unauthorized } from "../errors.js";
import { logger } from "../middleware/logger.js";
import { type ActivityPublication, logActivity, publishActivity } from "../services/activity-log.js";
import { agentService } from "../services/agents.js";
import { type CrewRuntime, isCrewRuntime } from "./model-policy.js";
import {
  applyUpgradeToSettings,
  CREW_MODEL_ID_RE,
  CREW_MODEL_ROLE_RUNTIME,
  CREW_MODEL_ROLES,
  CREW_MODEL_SETTINGS_DEFAULT,
  type CrewModelRole,
  type CrewModelSettings,
  type CrewRoleModel,
  crewModelSettingsTable,
  type ModelSettingsIssue,
  readModelSettingsRow,
  rememberModelSettings,
  validateModelSettings,
} from "./model-settings.js";
import { crewRolesTable, rowsOf } from "./project-roles.js";

export const MODEL_SETTINGS_ERRORS = {
  invalid: "crew_model_settings_invalid",
  inUse: "crew_model_in_use",
  stale: "crew_model_settings_stale",
  forbidden: "crew_model_settings_forbidden",
  unavailable: "crew_model_settings_unavailable",
} as const;

/** Activity của mỗi agent bị đổi model khi lưu hay nâng hàng loạt. */
export const CREW_MODEL_SETTINGS_AGENT_ACTION = "crew.model_settings.agent_model";
/** Activity của mỗi issue đang mở bị đổi model trong override khi nâng hàng loạt. */
export const CREW_MODEL_SETTINGS_ISSUE_ACTION = "crew.model_settings.issue_override_model";
/** `source` của revision cấu hình agent do cài đặt model ghi. */
export const CREW_MODEL_SETTINGS_REVISION_SOURCE = "crew_model_settings";

/** Đoạn đường dẫn trong `extraArgs` nhận ra agent BMAD (bản ghim workflow, như `apply-roles.sh`). */
const BMAD_PIN_FRAGMENT = "/.crew/workflows/bmad/";
/**
 * Đoạn key skill trong `adapterConfig.paperclipSkillSync` nhận ra agent UIUX (vai `designer`): skill công ty
 * `ui-ux-pro-max` được gắn qua `POST /api/agents/:id/skills/sync`. Chỉ xét agent `claude_local`.
 */
const DESIGNER_SKILL_FRAGMENT = "ui-ux-pro-max";
const CLOSED_ISSUE_STATUSES = ["done", "cancelled"];

/** Lỗi trả thẳng thành `{ error, code, ...extra }` (không lồng trong `details` như `HttpError`). */
class ModelSettingsError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

const invalid = (status: 400 | 422, issues: ModelSettingsIssue[]) =>
  new ModelSettingsError(status, MODEL_SETTINGS_ERRORS.invalid, "Bảng cài đặt model không hợp lệ.", { issues });

/** Rollback transaction của bản xem trước mà vẫn mang kết quả ra ngoài. */
class DryRunRollback<T> extends Error {
  constructor(readonly result: T) {
    super("dry run");
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Người gọi
// ---------------------------------------------------------------------------------------------------------------

/**
 * Owner = actor board đăng nhập bằng phiên trình duyệt và là instance admin (middleware auth tính lại cờ từ
 * `instance_user_roles` ở mỗi request). `local_implicit`, board API key và agent không phải owner.
 */
function ownerUserId(req: Request): string | null {
  const actor = req.actor;
  if (actor?.type !== "board" || actor.source !== "session" || actor.isInstanceAdmin !== true) return null;
  const userId = typeof actor.userId === "string" ? actor.userId.trim() : "";
  return userId || null;
}

function requireOwner(req: Request): string {
  const userId = ownerUserId(req);
  if (!userId) {
    throw new ModelSettingsError(403, MODEL_SETTINGS_ERRORS.forbidden, "Chỉ owner (instance admin) sửa được cài đặt model.");
  }
  return userId;
}

// ---------------------------------------------------------------------------------------------------------------
// Body
// ---------------------------------------------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function envelope(body: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!isRecord(body)) throw invalid(400, [{ path: "", message: "Body phải là JSON object." }]);
  const issues: ModelSettingsIssue[] = Object.keys(body)
    .filter((key) => !allowed.includes(key))
    .map((path) => ({ path, message: "Trường không được phép." }));
  const base = body.baseRevision;
  if (typeof base !== "number" || !Number.isInteger(base) || base < 0) {
    issues.push({ path: "baseRevision", message: "baseRevision phải là số nguyên ≥ 0." });
  }
  if (body.dryRun !== undefined && typeof body.dryRun !== "boolean") {
    issues.push({ path: "dryRun", message: "dryRun phải là true hoặc false." });
  }
  if (issues.length > 0) throw invalid(400, issues);
  return body;
}

interface UpgradeBody {
  baseRevision: number;
  runtime: CrewRuntime;
  fromModel: string;
  toModel: string;
  vision?: boolean;
  dryRun: boolean;
}

function parseUpgradeBody(raw: unknown): UpgradeBody {
  const body = envelope(raw, ["baseRevision", "runtime", "fromModel", "toModel", "vision", "dryRun"]);
  const issues: ModelSettingsIssue[] = [];
  if (!isCrewRuntime(body.runtime)) issues.push({ path: "runtime", message: "Runtime không hợp lệ." });
  if (typeof body.fromModel !== "string") issues.push({ path: "fromModel", message: "Thiếu model cũ." });
  if (typeof body.toModel !== "string") issues.push({ path: "toModel", message: "Thiếu model mới." });
  if (body.vision !== undefined && typeof body.vision !== "boolean") {
    issues.push({ path: "vision", message: "vision phải là true hoặc false." });
  }
  if (issues.length > 0) throw invalid(400, issues);
  return {
    baseRevision: body.baseRevision as number,
    runtime: body.runtime as CrewRuntime,
    fromModel: body.fromModel as string,
    toModel: body.toModel as string,
    ...(body.vision !== undefined ? { vision: body.vision as boolean } : {}),
    dryRun: body.dryRun === true,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Đọc trong transaction
// ---------------------------------------------------------------------------------------------------------------

async function tableExists(db: Pick<Db, "execute">, table: string): Promise<boolean> {
  return rowsOf(await db.execute(sql`SELECT to_regclass(${table}) IS NOT NULL AS ok`))[0]?.ok === true;
}

const unavailable = () =>
  new ModelSettingsError(
    503,
    MODEL_SETTINGS_ERRORS.unavailable,
    "Crew: chưa có bảng cài đặt model (plugin crew.core chưa nâng cấp), hãy thử lại sau.",
  );

/** Bản hiện hành trong `tx`. Dòng sai dạng thì không lưu tiếp được trên nó (409 sẽ không gỡ được) nên coi như mặc định. */
async function currentInTx(tx: Db): Promise<{ revision: number; settings: Readonly<CrewModelSettings> }> {
  const row = await readModelSettingsRow(tx);
  if (row === undefined) throw unavailable();
  if (row === null) return { revision: 0, settings: CREW_MODEL_SETTINGS_DEFAULT };
  return { revision: row.revision, settings: row.settings ?? CREW_MODEL_SETTINGS_DEFAULT };
}

function assertBase(baseRevision: number, currentRevision: number): void {
  if (baseRevision !== currentRevision) {
    throw new ModelSettingsError(409, MODEL_SETTINGS_ERRORS.stale, "Bảng cài đặt model vừa được lưu ở bản khác.", {
      currentRevision,
    });
  }
}

const ROLE_COLUMNS: readonly [string, CrewModelRole][] = [
  ["assistant_agent_id", "assistant"],
  ["reviewer_agent_id", "reviewer"],
  ["integrator_agent_id", "integrator"],
  ["codex_executor_agent_id", "executor-codex"],
  ["opencode_executor_agent_id", "executor-opencode"],
  ["codex_reviewer_agent_id", "reviewer-codex"],
];

/** Company Crew: company có dòng trong `crew_project_roles`. */
async function crewCompanyIds(tx: Db): Promise<string[]> {
  if (!(await tableExists(tx, crewRolesTable()))) return [];
  const rows = rowsOf(await tx.execute(sql`SELECT DISTINCT company_id::text AS company_id FROM ${sql.raw(crewRolesTable())}`));
  return rows.map((row) => String(row.company_id));
}

/**
 * Vai của từng agent theo `crew_project_roles` của mọi company, cộng agent BMAD (bản ghim workflow trong `extraArgs`) và
 * agent UIUX (skill `ui-ux-pro-max` trong `paperclipSkillSync`).
 */
async function roleAgents(tx: Db): Promise<Map<string, Set<CrewModelRole>>> {
  const map = new Map<string, Set<CrewModelRole>>();
  const add = (agentId: unknown, role: CrewModelRole) => {
    if (typeof agentId !== "string" || !agentId) return;
    const id = agentId.toLowerCase();
    const roles = map.get(id) ?? new Set<CrewModelRole>();
    roles.add(role);
    map.set(id, roles);
  };
  const companyIds = await crewCompanyIds(tx);
  if (companyIds.length === 0) return map;
  // `to_jsonb(r)`: cột ô runtime chỉ có từ migration 0012; thiếu thì là NULL.
  const rows = rowsOf(await tx.execute(sql`SELECT to_jsonb(r) AS row FROM ${sql.raw(crewRolesTable())} r`));
  for (const { row } of rows) {
    if (!isRecord(row)) continue;
    for (const [column, role] of ROLE_COLUMNS) add(row[column], role);
    if (Array.isArray(row.executor_agent_ids)) for (const id of row.executor_agent_ids) add(id, "executor");
  }
  const bmad = await tx
    .select({ id: agents.id })
    .from(agents)
    .where(
      and(
        inArray(agents.companyId, companyIds),
        sql`(${agents.adapterConfig}->'extraArgs')::text LIKE ${`%${BMAD_PIN_FRAGMENT}%`}`,
      ),
    );
  for (const { id } of bmad) add(id, "bmad");
  const designers = await tx
    .select({ id: agents.id })
    .from(agents)
    .where(
      and(
        inArray(agents.companyId, companyIds),
        eq(agents.adapterType, "claude_local"),
        sql`(${agents.adapterConfig}->'paperclipSkillSync')::text LIKE ${`%${DESIGNER_SKILL_FRAGMENT}%`}`,
      ),
    );
  for (const { id } of designers) add(id, "designer");
  return map;
}

type AgentRow = Pick<typeof agents.$inferSelect, "id" | "companyId" | "name" | "status" | "adapterType" | "adapterConfig">;
const AGENT_COLUMNS = {
  id: agents.id,
  companyId: agents.companyId,
  name: agents.name,
  status: agents.status,
  adapterType: agents.adapterType,
  adapterConfig: agents.adapterConfig,
};

function configOf(row: AgentRow): Record<string, unknown> {
  return isRecord(row.adapterConfig) ? row.adapterConfig : {};
}

function agentModelOf(row: AgentRow, settings: Readonly<CrewModelSettings>, runtime: CrewRuntime): CrewRoleModel {
  const config = configOf(row);
  const effortKey = settings.catalog[runtime].effortKey;
  const effort = effortKey ? config[effortKey] : null;
  return {
    model: typeof config.model === "string" ? config.model : "",
    effort: typeof effort === "string" ? (effort as CrewRoleModel["effort"]) : null,
  };
}

/** Số agent và issue đang mở của company Crew còn dùng các model bị gỡ (luật 6). */
async function modelsInUse(
  tx: Db,
  removed: { runtime: CrewRuntime; model: string }[],
): Promise<{ runtime: CrewRuntime; model: string; agents: number; issues: number }[]> {
  if (removed.length === 0) return [];
  const companyIds = await crewCompanyIds(tx);
  if (companyIds.length === 0) return [];
  const found: { runtime: CrewRuntime; model: string; agents: number; issues: number }[] = [];
  for (const { runtime, model } of removed) {
    const [agentCount] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(agents)
      .where(
        and(
          inArray(agents.companyId, companyIds),
          eq(agents.adapterType, runtime),
          ne(agents.status, "terminated"),
          sql`${agents.adapterConfig}->>'model' = ${model}`,
        ),
      );
    const [issueCount] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(issues)
      .where(
        and(
          inArray(issues.companyId, companyIds),
          notInArray(issues.status, CLOSED_ISSUE_STATUSES),
          sql`${issues.assigneeAdapterOverrides}->'adapterConfig'->>'model' = ${model}`,
        ),
      );
    const counts = { agents: Number(agentCount?.n ?? 0), issues: Number(issueCount?.n ?? 0) };
    if (counts.agents > 0 || counts.issues > 0) found.push({ runtime, model, ...counts });
  }
  return found;
}

// ---------------------------------------------------------------------------------------------------------------
// Áp dụng
// ---------------------------------------------------------------------------------------------------------------

export interface AppliedAgent {
  agentId: string;
  companyId: string;
  name: string;
  role: CrewModelRole | null;
  from: CrewRoleModel;
  to: CrewRoleModel;
}

export interface SkippedAgent {
  agentId: string;
  companyId: string;
  name: string;
  role: CrewModelRole | null;
  reason: "manual" | "pending_approval" | "multi_role";
}

interface ApplyContext {
  tx: Db;
  userId: string;
  revision: number;
  settings: Readonly<CrewModelSettings>;
  publications: ActivityPublication[];
}

async function insertRevision(ctx: ApplyContext, change: Record<string, unknown>): Promise<void> {
  await ctx.tx.execute(sql`INSERT INTO ${sql.raw(crewModelSettingsTable())} (revision, settings, change, created_by_user_id)
    VALUES (${ctx.revision}, ${JSON.stringify(ctx.settings)}::jsonb, ${JSON.stringify(change)}::jsonb, ${ctx.userId})`);
}

/** Đổi model/effort của agent qua service lõi (ghi revision cấu hình) và ghi activity; live event phát sau commit. */
async function applyAgent(
  ctx: ApplyContext,
  row: AgentRow,
  runtime: CrewRuntime,
  change: Omit<AppliedAgent, "agentId" | "companyId" | "name">,
  cause: "role_default" | "bulk_upgrade",
): Promise<AppliedAgent> {
  const effortKey = ctx.settings.catalog[runtime].effortKey;
  const adapterConfig: Record<string, unknown> = { ...configOf(row), model: change.to.model };
  if (effortKey) {
    if (change.to.effort === null) delete adapterConfig[effortKey];
    else adapterConfig[effortKey] = change.to.effort;
  }
  await agentService(ctx.tx).update(
    row.id,
    { adapterConfig },
    { recordRevision: { createdByUserId: ctx.userId, source: CREW_MODEL_SETTINGS_REVISION_SOURCE } },
  );
  await logActivity(
    ctx.tx,
    {
      companyId: row.companyId,
      actorType: "user",
      actorId: ctx.userId,
      action: CREW_MODEL_SETTINGS_AGENT_ACTION,
      entityType: "agent",
      entityId: row.id,
      details: { revision: ctx.revision, cause, role: change.role, from: change.from, to: change.to },
    },
    ctx.publications,
  );
  return { agentId: row.id, companyId: row.companyId, name: row.name, ...change };
}

const sameModel = (a: CrewRoleModel, b: CrewRoleModel) => a.model === b.model && a.effort === b.effort;
const byName = (a: AgentRow, b: AgentRow) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

type RoleAgentPlan =
  | { kind: "apply"; row: AgentRow; runtime: CrewRuntime; role: CrewModelRole; from: CrewRoleModel; to: CrewRoleModel }
  | { kind: "skip"; skipped: SkippedAgent };

/**
 * Agent của các vai có mặc định đổi: chỉ agent đang chạy đúng mặc định cũ (model, và effort khi effort đổi) mới đổi;
 * agent chỉnh tay, `pending_approval` hay thuộc nhiều vai có mặc định khác nhau được liệt kê là bỏ qua.
 */
async function planRoleAgents(
  tx: Db,
  before: Readonly<CrewModelSettings>,
  after: Readonly<CrewModelSettings>,
): Promise<RoleAgentPlan[]> {
  const changed = CREW_MODEL_ROLES.filter(
    (role) => role !== "reviewer-root" && !sameModel(before.roles[role], after.roles[role]),
  );
  if (changed.length === 0) return [];
  const roleMap = await roleAgents(tx);
  const candidates = [...roleMap].filter(([, roles]) => changed.some((role) => roles.has(role))).map(([id]) => id);
  if (candidates.length === 0) return [];
  const rows = (await tx.select(AGENT_COLUMNS).from(agents).where(inArray(agents.id, candidates)).for("update")).sort(byName);
  const plans: RoleAgentPlan[] = [];
  for (const row of rows) {
    const roles = [...(roleMap.get(row.id.toLowerCase()) ?? [])];
    const role = changed.find((name) => roles.includes(name))!;
    const runtime = CREW_MODEL_ROLE_RUNTIME[role];
    if (row.status === "terminated" || row.adapterType !== runtime) continue;
    const skip = (reason: SkippedAgent["reason"]): RoleAgentPlan => ({
      kind: "skip",
      skipped: { agentId: row.id, companyId: row.companyId, name: row.name, role, reason },
    });
    const conflicting = roles.some(
      (other) => !sameModel(before.roles[other], before.roles[role]) || !sameModel(after.roles[other], after.roles[role]),
    );
    if (conflicting) {
      plans.push(skip("multi_role"));
      continue;
    }
    const old = before.roles[role];
    const next = after.roles[role];
    const from = agentModelOf(row, before, runtime);
    if (from.model !== old.model) {
      plans.push(skip("manual"));
      continue;
    }
    if (row.status === "pending_approval") {
      plans.push(skip("pending_approval"));
      continue;
    }
    const to: CrewRoleModel = {
      model: next.model,
      effort: old.effort !== next.effort && from.effort === old.effort ? next.effort : from.effort,
    };
    if (sameModel(from, to)) {
      plans.push(skip("manual"));
      continue;
    }
    plans.push({ kind: "apply", row, runtime, role, from, to });
  }
  return plans;
}

/** Chạy `work` trong một transaction; bản xem trước rollback sau khi chạy hết đường áp dụng. */
async function runApply<T>(db: Db, dryRun: boolean, work: (tx: Db, publications: ActivityPublication[]) => Promise<T>): Promise<T> {
  const publications: ActivityPublication[] = [];
  try {
    const result = await db.transaction(async (tx) => {
      const value = await work(tx as unknown as Db, publications);
      if (dryRun) throw new DryRunRollback(value);
      return value;
    });
    for (const publication of publications) publishActivity(publication);
    return result;
  } catch (error) {
    if (error instanceof DryRunRollback) return error.result as T;
    // Hai lần lưu cùng `baseRevision`: lần sau đụng khóa chính của revision.
    if (isUniqueViolation(error)) assertBase(-1, (await readModelSettingsRow(db))?.revision ?? 0);
    throw error;
  }
}

function isUniqueViolation(error: unknown): boolean {
  for (let current: unknown = error, depth = 0; current && depth < 5; depth += 1) {
    if ((current as { code?: unknown }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export interface SaveResult {
  revision: number;
  settings: CrewModelSettings;
  applied: { agents: AppliedAgent[]; skipped: SkippedAgent[] };
  dryRun: boolean;
}

/** `PUT`: kiểm luật, thêm revision, đổi agent của vai có mặc định đổi; mọi bước trong một transaction (spec §8). */
export async function saveModelSettings(
  db: Db,
  input: { userId: string; baseRevision: number; settings: unknown; dryRun: boolean },
): Promise<SaveResult> {
  const result = await runApply(db, input.dryRun, async (tx, publications) => {
    const current = await currentInTx(tx);
    assertBase(input.baseRevision, current.revision);
    const parsed = validateModelSettings(input.settings);
    if (!parsed.ok) throw invalid(422, parsed.issues);
    const settings = parsed.settings;
    const removed = Object.entries(current.settings.catalog).flatMap(([runtime, spec]) =>
      Object.keys(spec.models)
        .filter((model) => !Object.hasOwn(settings.catalog[runtime as CrewRuntime].models, model))
        .map((model) => ({ runtime: runtime as CrewRuntime, model })),
    );
    const inUse = await modelsInUse(tx, removed);
    if (inUse.length > 0) {
      throw new ModelSettingsError(422, MODEL_SETTINGS_ERRORS.inUse, "Còn agent hoặc issue đang mở dùng model bị gỡ; hãy dùng Nâng model.", {
        inUse,
      });
    }
    const plans = await planRoleAgents(tx, current.settings, settings);
    const ctx: ApplyContext = { tx, userId: input.userId, revision: current.revision + 1, settings, publications };
    const toApply = plans.filter((plan) => plan.kind === "apply");
    await insertRevision(ctx, { kind: "save", agents: toApply.length });
    const applied: AppliedAgent[] = [];
    for (const plan of toApply) {
      applied.push(await applyAgent(ctx, plan.row, plan.runtime, { role: plan.role, from: plan.from, to: plan.to }, "role_default"));
    }
    const skipped = plans.flatMap((plan) => (plan.kind === "skip" ? [plan.skipped] : []));
    return { revision: ctx.revision, settings, applied: { agents: applied, skipped }, dryRun: input.dryRun };
  });
  if (!input.dryRun) rememberModelSettings(result.revision, result.settings);
  return result;
}

export interface UpgradeResult {
  revision: number;
  settings: CrewModelSettings;
  changes: {
    catalog: "renamed" | "merged";
    cells: { level: string }[];
    roles: CrewModelRole[];
    agents: AppliedAgent[];
    skipped: SkippedAgent[];
    issues: { issueId: string; identifier: string | null; companyId: string }[];
  };
  dryRun: boolean;
}

/** `POST /upgrade`: X→Y trong bảng, mọi agent và override của issue đang mở của company Crew (spec §9). */
export async function upgradeModel(db: Db, input: UpgradeBody & { userId: string }): Promise<UpgradeResult> {
  const result = await runApply(db, input.dryRun, async (tx, publications) => {
    const current = await currentInTx(tx);
    assertBase(input.baseRevision, current.revision);
    const issuesFound: ModelSettingsIssue[] = [];
    if (!Object.hasOwn(current.settings.catalog[input.runtime].models, input.fromModel)) {
      issuesFound.push({ path: "fromModel", message: `Model ${input.fromModel} không có trong ${input.runtime}.` });
    }
    if (!CREW_MODEL_ID_RE.test(input.toModel)) issuesFound.push({ path: "toModel", message: "Id model không hợp lệ." });
    else if (input.toModel === input.fromModel) issuesFound.push({ path: "toModel", message: "Model mới trùng model cũ." });
    if (issuesFound.length > 0) throw invalid(422, issuesFound);

    const table = applyUpgradeToSettings(current.settings, input);
    const parsed = validateModelSettings(table.settings);
    if (!parsed.ok) throw invalid(422, parsed.issues);
    const settings = parsed.settings;
    const ctx: ApplyContext = { tx, userId: input.userId, revision: current.revision + 1, settings, publications };

    const companyIds = await crewCompanyIds(tx);
    const roleMap = companyIds.length > 0 ? await roleAgents(tx) : new Map<string, Set<CrewModelRole>>();
    const rows =
      companyIds.length === 0
        ? []
        : (
            await tx
              .select(AGENT_COLUMNS)
              .from(agents)
              .where(
                and(
                  inArray(agents.companyId, companyIds),
                  eq(agents.adapterType, input.runtime),
                  ne(agents.status, "terminated"),
                  sql`${agents.adapterConfig}->>'model' = ${input.fromModel}`,
                ),
              )
              .for("update")
          ).sort(byName);
    const openIssues =
      companyIds.length === 0
        ? []
        : await tx
            .select({ issueId: issues.id, identifier: issues.identifier, companyId: issues.companyId })
            .from(issues)
            .where(
              and(
                inArray(issues.companyId, companyIds),
                notInArray(issues.status, CLOSED_ISSUE_STATUSES),
                sql`${issues.assigneeAdapterOverrides}->'adapterConfig'->>'model' = ${input.fromModel}`,
              ),
            )
            .orderBy(issues.identifier)
            .for("update");
    const roleOf = (row: AgentRow) => [...(roleMap.get(row.id.toLowerCase()) ?? [])][0] ?? null;
    const skipped: SkippedAgent[] = rows
      .filter((row) => row.status === "pending_approval")
      .map((row) => ({ agentId: row.id, companyId: row.companyId, name: row.name, role: roleOf(row), reason: "pending_approval" }));
    const movable = rows.filter((row) => row.status !== "pending_approval");

    await insertRevision(ctx, {
      kind: "upgrade",
      runtime: input.runtime,
      from: input.fromModel,
      to: input.toModel,
      agents: movable.length,
      issues: openIssues.length,
    });
    const applied: AppliedAgent[] = [];
    for (const row of movable) {
      const from = agentModelOf(row, current.settings, input.runtime);
      applied.push(
        await applyAgent(ctx, row, input.runtime, { role: roleOf(row), from, to: { ...from, model: input.toModel } }, "bulk_upgrade"),
      );
    }
    // Ghi thẳng DB (không qua issueService): không chạy H2, không đánh thức run.
    for (const issue of openIssues) {
      await tx.execute(sql`UPDATE "issues"
        SET assignee_adapter_overrides = jsonb_set(assignee_adapter_overrides, '{adapterConfig,model}', to_jsonb(${input.toModel}::text))
        WHERE id = ${issue.issueId}`);
      await logActivity(
        tx,
        {
          companyId: issue.companyId,
          actorType: "user",
          actorId: input.userId,
          action: CREW_MODEL_SETTINGS_ISSUE_ACTION,
          entityType: "issue",
          entityId: issue.issueId,
          issueId: issue.issueId,
          details: { revision: ctx.revision, runtime: input.runtime, from: input.fromModel, to: input.toModel },
        },
        publications,
      );
    }
    return {
      revision: ctx.revision,
      settings,
      changes: { catalog: table.catalog, cells: table.cells, roles: table.roles, agents: applied, skipped, issues: openIssues },
      dryRun: input.dryRun,
    };
  });
  if (!input.dryRun) rememberModelSettings(result.revision, result.settings);
  return result;
}

// ---------------------------------------------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------------------------------------------

function sendError(res: Response, error: ModelSettingsError): void {
  res.status(error.status).json({ error: error.message, code: error.code, ...error.extra });
}

/**
 * Router cài đặt model (flow `model-settings`), gắn trong router góp ý (vá C7) nên không cần vá lõi riêng. Dùng chung
 * toàn instance, không có `:companyId`.
 *
 * - `GET  /crew/model-settings`: mọi actor đã xác thực (board mọi nguồn, agent); `canEdit` chỉ đúng với owner.
 * - `PUT  /crew/model-settings` `{ baseRevision, settings, dryRun? }`: owner lưu bản mới, áp ngay cho agent theo vai.
 * - `POST /crew/model-settings/upgrade` `{ baseRevision, runtime, fromModel, toModel, vision?, dryRun? }`: owner nâng
 *   model hàng loạt.
 *
 * Lỗi trả `{ error, code, ...}` phẳng: `400`/`422 crew_model_settings_invalid` (`issues: [{ path, message }]`), `422
 * crew_model_in_use` (`inUse`), `409 crew_model_settings_stale` (`currentRevision`), `403 crew_model_settings_forbidden`,
 * `503 crew_model_settings_unavailable`.
 */
export function crewModelSettingsRoutes(db: Db): Router {
  const router = Router();
  const handle =
    (work: (req: Request, res: Response) => Promise<void>) =>
    async (req: Request, res: Response): Promise<void> => {
      try {
        await work(req, res);
      } catch (error) {
        if (error instanceof ModelSettingsError) sendError(res, error);
        else throw error;
      }
    };

  router.get(
    "/crew/model-settings",
    handle(async (req, res) => {
      if (req.actor?.type !== "board" && req.actor?.type !== "agent") throw unauthorized();
      const row = await readModelSettingsRow(db);
      const settings = row?.settings ?? CREW_MODEL_SETTINGS_DEFAULT;
      if (row?.settings) rememberModelSettings(row.revision, row.settings);
      res.json({
        revision: row?.revision ?? 0,
        updatedAt: row?.updatedAt ?? null,
        updatedByUserId: row?.updatedByUserId ?? null,
        settings,
        canEdit: ownerUserId(req) !== null,
      });
    }),
  );

  router.put(
    "/crew/model-settings",
    handle(async (req, res) => {
      const userId = requireOwner(req);
      const body = envelope(req.body, ["baseRevision", "settings", "dryRun"]);
      const result = await saveModelSettings(db, {
        userId,
        baseRevision: body.baseRevision as number,
        settings: body.settings,
        dryRun: body.dryRun === true,
      });
      if (!result.dryRun) {
        logger.info({ revision: result.revision, agents: result.applied.agents.length }, "crew model settings saved");
      }
      res.json(result);
    }),
  );

  router.post(
    "/crew/model-settings/upgrade",
    handle(async (req, res) => {
      const userId = requireOwner(req);
      const body = parseUpgradeBody(req.body);
      const result = await upgradeModel(db, { ...body, userId });
      if (!result.dryRun) {
        logger.info(
          {
            revision: result.revision,
            runtime: body.runtime,
            from: body.fromModel,
            to: body.toModel,
            agents: result.changes.agents.length,
            issues: result.changes.issues.length,
          },
          "crew model upgraded",
        );
      }
      res.json(result);
    }),
  );

  return router;
}

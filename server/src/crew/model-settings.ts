import { sql } from "drizzle-orm";
import { derivePluginDatabaseNamespace } from "../services/plugin-database.js";
import {
  CREW_ALLOWED_EFFORTS,
  CREW_CODEX_REVIEWER_MODEL,
  CREW_RUNTIME_CATALOG,
  CREW_RUNTIME_ORDER,
  CREW_RUNTIMES,
  type CrewComplexity,
  type CrewEffort,
  type CrewRuntime,
  type CrewRuntimeSpec,
  isCrewRuntime,
} from "./model-policy.js";
import { CREW_PLUGIN_KEY, type CrewRolesDb, warnOncePerMinute } from "./project-roles.js";
import { readPluginRows } from "./runtime-switch.js";

/**
 * Cài đặt model toàn instance (flow `model-settings`): catalog model của ba runtime, bảng độ khó và model mặc định của
 * từng vai. Owner lưu qua `PUT /api/crew/model-settings`; mỗi lần lưu thêm một dòng revision vào bảng plugin
 * `crew_model_settings` (migration `0023_model_settings.sql`). Chưa có dòng nào thì dùng mặc định = hằng số hôm nay.
 */

export type CrewModelRole =
  | "assistant"
  | "executor"
  | "reviewer"
  | "integrator"
  | "bmad"
  | "executor-codex"
  | "executor-opencode"
  | "reviewer-codex"
  | "reviewer-root";

/** Runtime cố định của từng vai. `reviewer-root` không phải agent: là override khi reviewer Claude duyệt issue gốc. */
export const CREW_MODEL_ROLE_RUNTIME: Readonly<Record<CrewModelRole, CrewRuntime>> = Object.freeze({
  assistant: "claude_local",
  executor: "claude_local",
  reviewer: "claude_local",
  integrator: "claude_local",
  bmad: "claude_local",
  "executor-codex": "codex_local",
  "executor-opencode": "opencode_local",
  "reviewer-codex": "codex_local",
  "reviewer-root": "claude_local",
});
export const CREW_MODEL_ROLES = Object.freeze(Object.keys(CREW_MODEL_ROLE_RUNTIME) as CrewModelRole[]);
/** Vai mà cấu hình agent và override hiện tại luôn có effort. */
const ROLES_REQUIRING_EFFORT: ReadonlySet<CrewModelRole> = new Set(["executor-codex", "reviewer-codex", "reviewer-root"]);
export const CREW_COMPLEXITIES: readonly CrewComplexity[] = Object.freeze(["trivial", "small", "medium", "large"]);

export interface CrewRoleModel {
  model: string;
  effort: CrewEffort | null;
}

export interface CrewModelSettings {
  catalog: Record<CrewRuntime, CrewRuntimeSpec>;
  order: Record<CrewComplexity, CrewRuntime[]>;
  roles: Record<CrewModelRole, CrewRoleModel>;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

const smallCell = (runtime: CrewRuntime): CrewRoleModel => {
  const cell = CREW_RUNTIME_CATALOG[runtime].byComplexity.small!;
  return { model: cell.model, effort: cell.effort };
};

/**
 * Mặc định = đúng giá trị prod trước khi có cài đặt model. Catalog và thứ tự lấy từ `model-policy.ts`. Vai Claude theo
 * `ROLE_MODELS` của crew-web (Trợ Lý opus, còn lại sonnet), BMAD theo agent BMAD trên prod (opus, đọc 27/10/2026),
 * executor Codex/OpenCode theo hàng `small` của bảng như wizard, reviewer Codex theo `CREW_CODEX_REVIEWER_MODEL`, reviewer
 * gốc theo override cũ của `issue-gate.ts` (opus, high).
 */
export const CREW_MODEL_SETTINGS_DEFAULT: Readonly<CrewModelSettings> = deepFreeze({
  catalog: structuredClone(CREW_RUNTIME_CATALOG) as Record<CrewRuntime, CrewRuntimeSpec>,
  order: structuredClone(CREW_RUNTIME_ORDER) as Record<CrewComplexity, CrewRuntime[]>,
  roles: {
    assistant: { model: "claude-opus-5-5", effort: null },
    executor: { model: "claude-sonnet-5-5", effort: null },
    reviewer: { model: "claude-sonnet-5-5", effort: null },
    integrator: { model: "claude-sonnet-5-5", effort: null },
    bmad: { model: "claude-opus-5-5", effort: null },
    "executor-codex": smallCell("codex_local"),
    "executor-opencode": smallCell("opencode_local"),
    "reviewer-codex": { model: CREW_CODEX_REVIEWER_MODEL.model, effort: CREW_CODEX_REVIEWER_MODEL.effort },
    "reviewer-root": { model: "claude-opus-5-5", effort: "high" },
  },
});

// ---------------------------------------------------------------------------------------------------------------
// Luật hợp lệ
// ---------------------------------------------------------------------------------------------------------------

export const CREW_MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/;
export const CREW_MODELS_PER_RUNTIME_MAX = 20;
const EFFORT_KEYS: ReadonlySet<unknown> = new Set(["effort", "modelReasoningEffort", null]);

export interface ModelSettingsIssue {
  /** Đường dẫn trường lỗi, nối bằng dấu chấm (id model giữ nguyên, có thể chứa `.` hay `/`); `""` là cả bảng. */
  path: string;
  message: string;
}

export type ModelSettingsValidation =
  | { ok: true; settings: CrewModelSettings }
  | { ok: false; issues: ModelSettingsIssue[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const join = (...parts: string[]) => parts.join(".");

/** Key có giá trị `undefined` coi như không có (bản nháp trong bộ nhớ); JSON không mang `undefined`. */
const presentKeys = (value: Record<string, unknown>) => Object.keys(value).filter((key) => value[key] !== undefined);

function checkKeys(value: Record<string, unknown>, allowed: readonly string[], path: string, issues: ModelSettingsIssue[]) {
  for (const key of presentKeys(value)) {
    if (!allowed.includes(key)) issues.push({ path: path ? join(path, key) : key, message: "Trường không được phép." });
  }
  for (const key of allowed) {
    if (value[key] === undefined) issues.push({ path: path ? join(path, key) : key, message: "Thiếu trường bắt buộc." });
  }
}

const isEffort = (value: unknown): value is CrewEffort => typeof value === "string" && CREW_ALLOWED_EFFORTS.has(value);

/**
 * Kiểm luật của bảng cài đặt model (spec §5) và trả bản sạch (chép sâu, chỉ các trường đã biết). Luật 6 (không gỡ
 * model đang dùng) cần đọc DB nên nằm ở bên lưu.
 */
export function validateModelSettings(value: unknown): ModelSettingsValidation {
  const issues: ModelSettingsIssue[] = [];
  if (!isRecord(value)) return { ok: false, issues: [{ path: "", message: "Bảng cài đặt phải là object." }] };
  checkKeys(value, ["catalog", "order", "roles"], "", issues);
  const { catalog, order, roles } = value;
  if (catalog !== undefined && !isRecord(catalog)) issues.push({ path: "catalog", message: "Phải là object." });
  if (order !== undefined && !isRecord(order)) issues.push({ path: "order", message: "Phải là object." });
  if (roles !== undefined && !isRecord(roles)) issues.push({ path: "roles", message: "Phải là object." });
  if (issues.length > 0) return { ok: false, issues };
  const catalogIn = catalog as Record<string, unknown>;
  const orderIn = order as Record<string, unknown>;
  const rolesIn = roles as Record<string, unknown>;

  // Luật 2: thứ tự.
  checkKeys(orderIn, CREW_COMPLEXITIES, "order", issues);
  const cleanOrder = {} as Record<CrewComplexity, CrewRuntime[]>;
  for (const level of CREW_COMPLEXITIES) {
    const list = orderIn[level];
    if (list === undefined) continue;
    const path = join("order", level);
    if (!Array.isArray(list) || list.length === 0) {
      issues.push({ path, message: "Thứ tự runtime phải là danh sách không rỗng." });
      continue;
    }
    if (!list.every(isCrewRuntime)) {
      issues.push({ path, message: `Chỉ gồm ${CREW_RUNTIMES.join(", ")}.` });
      continue;
    }
    if (new Set(list).size !== list.length) {
      issues.push({ path, message: "Runtime bị trùng." });
      continue;
    }
    if (level === "large" && !(list.length === 1 && list[0] === "claude_local")) {
      issues.push({ path, message: "Mức large chỉ chạy claude_local." });
      continue;
    }
    cleanOrder[level] = [...list];
  }

  // Luật 1 và 3: catalog và ô bảng độ khó.
  checkKeys(catalogIn, CREW_RUNTIMES, "catalog", issues);
  const cleanCatalog = {} as Record<CrewRuntime, CrewRuntimeSpec>;
  for (const runtime of CREW_RUNTIMES) {
    const spec = catalogIn[runtime];
    const base = join("catalog", runtime);
    if (spec === undefined) continue;
    if (!isRecord(spec)) {
      issues.push({ path: base, message: "Phải là object." });
      continue;
    }
    checkKeys(spec, ["effortKey", "models", "byComplexity"], base, issues);
    const effortKey = spec.effortKey;
    const effortKeyOk = EFFORT_KEYS.has(effortKey);
    if (spec.effortKey !== undefined && !effortKeyOk) {
      issues.push({ path: join(base, "effortKey"), message: "Chỉ nhận effort, modelReasoningEffort hoặc null." });
    }
    const models: Record<string, { vision: boolean }> = {};
    if (spec.models !== undefined) {
      if (!isRecord(spec.models)) {
        issues.push({ path: join(base, "models"), message: "Phải là object." });
      } else {
        const ids = presentKeys(spec.models);
        if (ids.length < 1 || ids.length > CREW_MODELS_PER_RUNTIME_MAX) {
          issues.push({ path: join(base, "models"), message: `Mỗi runtime có từ 1 đến ${CREW_MODELS_PER_RUNTIME_MAX} model.` });
        }
        for (const id of ids) {
          const entry = spec.models[id];
          const path = join(base, "models", id);
          if (!CREW_MODEL_ID_RE.test(id)) {
            issues.push({ path, message: "Id model không hợp lệ." });
            continue;
          }
          if (!isRecord(entry)) {
            issues.push({ path, message: "Phải là object { vision }." });
            continue;
          }
          checkKeys(entry, ["vision"], path, issues);
          if (entry.vision !== undefined && typeof entry.vision !== "boolean") {
            issues.push({ path: join(path, "vision"), message: "vision phải là true hoặc false." });
            continue;
          }
          models[id] = { vision: entry.vision === true };
        }
      }
    }
    const byComplexity: Partial<Record<CrewComplexity, { model: string; effort: CrewEffort | null }>> = {};
    if (spec.byComplexity !== undefined) {
      if (!isRecord(spec.byComplexity)) {
        issues.push({ path: join(base, "byComplexity"), message: "Phải là object." });
      } else {
        const cells = spec.byComplexity;
        for (const key of presentKeys(cells)) {
          if (!(CREW_COMPLEXITIES as readonly string[]).includes(key)) {
            issues.push({ path: join(base, "byComplexity", key), message: "Mức độ khó không hợp lệ." });
          }
        }
        for (const level of CREW_COMPLEXITIES) {
          const cell = cells[level];
          const path = join(base, "byComplexity", level);
          const inOrder = cleanOrder[level]?.includes(runtime);
          if (cleanOrder[level] === undefined) continue;
          if (cell === undefined) {
            if (inOrder) issues.push({ path, message: `Thiếu ô vì ${runtime} nằm trong thứ tự của ${level}.` });
            continue;
          }
          if (!inOrder) {
            issues.push({ path, message: `Có ô nhưng ${runtime} không nằm trong thứ tự của ${level}.` });
            continue;
          }
          if (!isRecord(cell)) {
            issues.push({ path, message: "Phải là object { model, effort }." });
            continue;
          }
          checkKeys(cell, ["model", "effort"], path, issues);
          let ok = true;
          if (typeof cell.model !== "string" || !Object.hasOwn(models, cell.model)) {
            issues.push({ path: join(path, "model"), message: `Model phải có trong danh sách model của ${runtime}.` });
            ok = false;
          } else if (level === "large" && !models[cell.model]!.vision) {
            issues.push({ path: join(path, "model"), message: "Mức large chỉ dùng model đọc được ảnh." });
            ok = false;
          }
          if (effortKeyOk && !effortMatchesKey(cell.effort, effortKey)) {
            issues.push({ path: join(path, "effort"), message: effortMessage(effortKey) });
            ok = false;
          }
          if (ok) byComplexity[level] = { model: cell.model as string, effort: (cell.effort ?? null) as CrewEffort | null };
        }
      }
    }
    cleanCatalog[runtime] = { effortKey: effortKey as CrewRuntimeSpec["effortKey"], models, byComplexity };
  }

  // Luật 5: vai.
  checkKeys(rolesIn, CREW_MODEL_ROLES, "roles", issues);
  const cleanRoles = {} as Record<CrewModelRole, CrewRoleModel>;
  for (const role of CREW_MODEL_ROLES) {
    const entry = rolesIn[role];
    const path = join("roles", role);
    if (entry === undefined) continue;
    if (!isRecord(entry)) {
      issues.push({ path, message: "Phải là object { model, effort }." });
      continue;
    }
    checkKeys(entry, ["model", "effort"], path, issues);
    const runtime = CREW_MODEL_ROLE_RUNTIME[role];
    const spec = cleanCatalog[runtime];
    if (typeof entry.model !== "string" || !spec || !Object.hasOwn(spec.models, entry.model)) {
      issues.push({ path: join(path, "model"), message: `Model phải có trong danh sách model của ${runtime}.` });
    }
    const effort = entry.effort ?? null;
    if (effort !== null && !isEffort(effort)) {
      issues.push({ path: join(path, "effort"), message: "effort chỉ nhận low, medium, high hoặc null." });
    } else if (spec && spec.effortKey === null && effort !== null) {
      issues.push({ path: join(path, "effort"), message: `${runtime} không nhận effort.` });
    } else if (effort === null && ROLES_REQUIRING_EFFORT.has(role)) {
      issues.push({ path: join(path, "effort"), message: "Vai này bắt buộc có effort." });
    }
    cleanRoles[role] = { model: String(entry.model), effort: effort as CrewEffort | null };
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, settings: { catalog: cleanCatalog, order: cleanOrder, roles: cleanRoles } };
}

function effortMatchesKey(effort: unknown, effortKey: unknown): boolean {
  if (effortKey === null) return effort === null || effort === undefined;
  return isEffort(effort);
}

function effortMessage(effortKey: unknown): string {
  return effortKey === null ? "Runtime không có key effort nên effort phải là null." : "effort chỉ nhận low, medium hoặc high.";
}

// ---------------------------------------------------------------------------------------------------------------
// Override reviewer theo vai
// ---------------------------------------------------------------------------------------------------------------

function roleOverrides(settings: Readonly<CrewModelSettings>, role: CrewModelRole): { adapterConfig: Record<string, string> } {
  const { model, effort } = settings.roles[role];
  const effortKey = settings.catalog[CREW_MODEL_ROLE_RUNTIME[role]].effortKey;
  return { adapterConfig: { model, ...(effortKey && effort ? { [effortKey]: effort } : {}) } };
}

/** Override của reviewer Codex: vai `reviewer-codex`, key effort của `codex_local`. */
export function codexReviewerOverrides(settings: Readonly<CrewModelSettings>) {
  return roleOverrides(settings, "reviewer-codex");
}

/** Override của reviewer Claude trên issue gốc của yêu cầu code hay viết tài liệu: vai `reviewer-root`. */
export function rootReviewerOverrides(settings: Readonly<CrewModelSettings>) {
  return roleOverrides(settings, "reviewer-root");
}

// ---------------------------------------------------------------------------------------------------------------
// Nâng model hàng loạt (phần bảng; phần agent và issue ở `model-settings-routes.ts`)
// ---------------------------------------------------------------------------------------------------------------

export interface ModelUpgradeInput {
  runtime: CrewRuntime;
  fromModel: string;
  toModel: string;
  /** Chỉ dùng khi `toModel` là id mới; thiếu thì lấy theo `fromModel`. */
  vision?: boolean;
}

export interface ModelUpgradeTableChanges {
  settings: CrewModelSettings;
  catalog: "renamed" | "merged";
  cells: { level: CrewComplexity }[];
  roles: CrewModelRole[];
}

/**
 * Đổi X thành Y trong bảng: Y chưa có thì đổi tên X tại chỗ (`renamed`), Y đã có thì gỡ X (`merged`); ô bảng độ khó và
 * vai của runtime đang trỏ X chuyển sang Y, giữ effort. Bên gọi kiểm `fromModel` có trong catalog và kiểm luật trên kết quả.
 */
export function applyUpgradeToSettings(current: Readonly<CrewModelSettings>, input: ModelUpgradeInput): ModelUpgradeTableChanges {
  const settings = structuredClone(current) as CrewModelSettings;
  const spec = settings.catalog[input.runtime];
  const merged = Object.hasOwn(spec.models, input.toModel);
  const models: Record<string, { vision: boolean }> = {};
  for (const [id, entry] of Object.entries(spec.models)) {
    if (id !== input.fromModel) models[id] = entry;
    else if (!merged) models[input.toModel] = { vision: input.vision ?? entry.vision };
  }
  const cells: { level: CrewComplexity }[] = [];
  const byComplexity = { ...spec.byComplexity };
  for (const level of CREW_COMPLEXITIES) {
    const cell = byComplexity[level];
    if (cell?.model === input.fromModel) {
      byComplexity[level] = { ...cell, model: input.toModel };
      cells.push({ level });
    }
  }
  settings.catalog[input.runtime] = { ...spec, models, byComplexity };
  const roles: CrewModelRole[] = [];
  for (const role of CREW_MODEL_ROLES) {
    if (CREW_MODEL_ROLE_RUNTIME[role] === input.runtime && settings.roles[role].model === input.fromModel) {
      settings.roles[role] = { ...settings.roles[role], model: input.toModel };
      roles.push(role);
    }
  }
  return { settings, catalog: merged ? "merged" : "renamed", cells, roles };
}

// ---------------------------------------------------------------------------------------------------------------
// Đọc bảng
// ---------------------------------------------------------------------------------------------------------------

export const crewModelSettingsTable = () => `${derivePluginDatabaseNamespace(CREW_PLUGIN_KEY)}.crew_model_settings`;

export interface ModelSettingsRow {
  revision: number;
  updatedAt: string;
  updatedByUserId: string;
  /** `null` khi dòng sai dạng (sửa SQL tay): bên đọc dùng cache hoặc mặc định. */
  settings: CrewModelSettings | null;
}

/** Cảnh báo theo instance (bảng không có company): khóa `warnOncePerMinute` cố định. */
const WARN_SCOPE = "instance";

/**
 * Dòng hiện hành (revision lớn nhất), đọc trong savepoint. `undefined` khi bảng chưa có (plugin chưa áp `0023`),
 * `null` khi chưa có dòng nào. Lỗi SQL được ném cho bên gọi.
 */
export async function readModelSettingsRow(db: CrewRolesDb): Promise<ModelSettingsRow | null | undefined> {
  const rows = await readPluginRows(
    db,
    crewModelSettingsTable(),
    (table) => sql`SELECT revision, settings, created_by_user_id, created_at FROM ${table} ORDER BY revision DESC LIMIT 1`,
  );
  if (rows === null) return undefined;
  const row = rows[0];
  if (!row) return null;
  const parsed = validateModelSettings(typeof row.settings === "string" ? JSON.parse(row.settings) : row.settings);
  if (!parsed.ok) {
    warnOncePerMinute(WARN_SCOPE, "model-settings-invalid", { revision: row.revision, issues: parsed.issues.slice(0, 5) },
      "crew model settings row is invalid; using the last good settings");
  }
  return {
    revision: Number(row.revision),
    updatedAt: new Date(row.created_at as string | Date).toISOString(),
    updatedByUserId: String(row.created_by_user_id),
    settings: parsed.ok ? parsed.settings : null,
  };
}

/** TTL của cache trong process; lưu qua route ghi đè cache ngay, TTL chỉ để bắt sửa SQL tay. */
export const MODEL_SETTINGS_CACHE_TTL_MS = 60_000;
let cache: { settings: Readonly<CrewModelSettings>; revision: number; loadedAt: number } | null = null;

/** Ghi cache sau khi lưu thành công (server chỉ có một process). */
export function rememberModelSettings(revision: number, settings: Readonly<CrewModelSettings>): void {
  cache = { settings, revision, loadedAt: Date.now() };
}

/** Xóa cache (test). */
export function clearModelSettingsCache(): void {
  cache = null;
}

/**
 * Bảng hiện hành cho H2/H4 và route. Dùng cache 60 giây. Bảng chưa có hay chưa có dòng thì dùng mặc định. Đọc lỗi
 * (savepoint, không làm hỏng transaction của bên gọi) hoặc dòng sai dạng thì dùng bản cache gần nhất, chưa có thì mặc định.
 */
export async function loadModelSettings(db: CrewRolesDb): Promise<Readonly<CrewModelSettings>> {
  if (cache && Date.now() - cache.loadedAt < MODEL_SETTINGS_CACHE_TTL_MS) return cache.settings;
  try {
    const row = await readModelSettingsRow(db);
    if (row === undefined || row === null) {
      rememberModelSettings(0, CREW_MODEL_SETTINGS_DEFAULT);
      return CREW_MODEL_SETTINGS_DEFAULT;
    }
    if (row.settings === null) return cache?.settings ?? CREW_MODEL_SETTINGS_DEFAULT;
    rememberModelSettings(row.revision, row.settings);
    return row.settings;
  } catch (error) {
    warnOncePerMinute(WARN_SCOPE, "model-settings-read", { err: error }, "crew model settings unreadable; using the last good settings");
    return cache?.settings ?? CREW_MODEL_SETTINGS_DEFAULT;
  }
}

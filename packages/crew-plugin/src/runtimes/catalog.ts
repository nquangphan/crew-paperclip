import type { PluginContext } from "@paperclipai/plugin-sdk";
import { jsonObject, pluginNamespace } from "../shared/db.js";

/**
 * Bản chép bảng runtime/model mặc định của server (`server/src/crew/model-policy.ts`). Test `runtimes-catalog` so nguyên
 * văn với bảng chung và với bản server. Bảng hiện hành do owner sửa nằm ở `crew_model_settings` (`readModelSettings`);
 * các hằng ở đây là giá trị khi chưa có dòng nào hoặc dòng sai dạng.
 */
export type CrewRuntime = "claude_local" | "codex_local" | "opencode_local";
export const CREW_RUNTIMES: readonly CrewRuntime[] = Object.freeze(["claude_local", "codex_local", "opencode_local"]);
export type CrewComplexity = "trivial" | "small" | "medium" | "large";
export type CrewEffort = "low" | "medium" | "high";

export interface CrewRuntimeSpec {
  /** Key effort trong `adapterConfig` của runtime; `null` = runtime không nhận effort (marker ghi `effort=default`). */
  effortKey: "effort" | "modelReasoningEffort" | null;
  models: Readonly<Record<string, { vision: boolean }>>;
  byComplexity: Readonly<Partial<Record<CrewComplexity, { model: string; effort: CrewEffort | null }>>>;
}

export const CREW_RUNTIME_CATALOG: Readonly<Record<CrewRuntime, CrewRuntimeSpec>> = Object.freeze({
  claude_local: {
    effortKey: "effort",
    // Giữ hai id cũ chỉ để chấp nhận override/agent cũ; không đưa vào byComplexity. Giữ một bản để rollout, gỡ ở bản sau.
    models: {
      "claude-sonnet-5-5": { vision: true },
      "claude-opus-5-5": { vision: true },
      "claude-sonnet-5": { vision: true },
      "claude-opus-5": { vision: true },
    },
    byComplexity: {
      trivial: { model: "claude-sonnet-5-5", effort: "low" },
      small: { model: "claude-sonnet-5-5", effort: "medium" },
      medium: { model: "claude-sonnet-5-5", effort: "high" },
      large: { model: "claude-opus-5-5", effort: "high" },
    },
  },
  codex_local: {
    effortKey: "modelReasoningEffort",
    models: { "gpt-6-luna": { vision: true }, "gpt-6-sol": { vision: true } },
    byComplexity: {
      trivial: { model: "gpt-6-luna", effort: "low" },
      small: { model: "gpt-6-luna", effort: "medium" },
      medium: { model: "gpt-6-sol", effort: "high" },
    },
  },
  opencode_local: {
    effortKey: null,
    // Giá trị giả định, kiểm khi có key OpenCode (`opencode models opencode-go --verbose`).
    models: {
      "opencode-go/deepseek-v4-flash": { vision: false },
      "opencode-go/kimi-k3": { vision: false },
      "opencode-go/glm-5.3": { vision: false },
    },
    byComplexity: {
      trivial: { model: "opencode-go/deepseek-v4-flash", effort: null },
      small: { model: "opencode-go/kimi-k3", effort: null },
      medium: { model: "opencode-go/glm-5.3", effort: null },
    },
  },
});

/** Thứ tự runtime khi chọn và khi fallback theo độ phức tạp; `large` chỉ chạy Claude. */
export const CREW_RUNTIME_ORDER: Readonly<Record<CrewComplexity, readonly CrewRuntime[]>> = Object.freeze({
  trivial: ["opencode_local", "claude_local", "codex_local"],
  small: ["opencode_local", "claude_local", "codex_local"],
  medium: ["claude_local", "codex_local", "opencode_local"],
  large: ["claude_local"],
});

/**
 * Dòng `crew-model` trong mô tả issue con. `runtime=` đứng sau `effort=`; marker không có `runtime=` là `claude_local`.
 */
export const CREW_MODEL_LINE_RE =
  /^crew-model complexity=(trivial|small|medium|large) model=(\S+) effort=(low|medium|high|default)(?: runtime=(claude_local|codex_local|opencode_local))? reason=(.+)$/m;

/** Runtime được làm reviewer; OpenCode chỉ làm executor. */
export const CREW_REVIEWER_RUNTIMES: readonly CrewRuntime[] = Object.freeze(["claude_local", "codex_local"]);
/** Reviewer Codex chạy model cố định, không có override theo issue. */
export const CREW_CODEX_REVIEWER_MODEL = Object.freeze({ model: "gpt-6-sol", effort: "high" } as const);

export function isCrewRuntime(value: unknown): value is CrewRuntime {
  return typeof value === "string" && (CREW_RUNTIMES as readonly string[]).includes(value);
}

export const CREW_COMPLEXITIES: readonly CrewComplexity[] = Object.freeze(["trivial", "small", "medium", "large"]);
const EFFORTS: readonly string[] = ["low", "medium", "high"];
const EFFORT_KEYS: readonly unknown[] = ["effort", "modelReasoningEffort", null];

export const CREW_MODEL_ROLES = Object.freeze([
  "assistant", "executor", "reviewer", "integrator", "bmad", "executor-codex", "executor-opencode", "reviewer-codex", "reviewer-root",
] as const);
export type CrewModelRole = (typeof CREW_MODEL_ROLES)[number];

/** Bảng cài đặt model (dạng `settings` của `crew_model_settings`); bản mặc định là các hằng ở trên. */
export interface CrewModelSettings {
  catalog: Readonly<Record<CrewRuntime, CrewRuntimeSpec>>;
  order: Readonly<Record<CrewComplexity, readonly CrewRuntime[]>>;
  roles: Readonly<Record<CrewModelRole, { model: string; effort: CrewEffort | null }>>;
}

export const CREW_MODEL_SETTINGS_DEFAULT: Readonly<CrewModelSettings> = Object.freeze({
  catalog: CREW_RUNTIME_CATALOG,
  order: CREW_RUNTIME_ORDER,
  roles: Object.freeze({
    assistant: { model: "claude-opus-5-5", effort: null },
    executor: { model: "claude-sonnet-5-5", effort: null },
    reviewer: { model: "claude-sonnet-5-5", effort: null },
    integrator: { model: "claude-sonnet-5-5", effort: null },
    bmad: { model: "claude-opus-5-5", effort: null },
    "executor-codex": { model: "gpt-6-luna", effort: "medium" },
    "executor-opencode": { model: "opencode-go/kimi-k3", effort: null },
    "reviewer-codex": CREW_CODEX_REVIEWER_MODEL,
    "reviewer-root": { model: "claude-opus-5-5", effort: "high" },
  } as const),
});

/**
 * Kiểm dạng đủ để plugin dùng an toàn (server đã kiểm luật trước khi ghi): ba runtime, mỗi ô độ khó trỏ tới model có
 * trong runtime, thứ tự không rỗng/không trùng, đủ 9 vai. Trả `null` khi sai dạng.
 */
export function parseModelSettings(value: unknown): CrewModelSettings | null {
  const root = jsonObject(value);
  const catalog = jsonObject(root?.catalog);
  const order = jsonObject(root?.order);
  const roles = jsonObject(root?.roles);
  if (!catalog || !order || !roles) return null;
  for (const runtime of CREW_RUNTIMES) {
    const spec = jsonObject(catalog[runtime]);
    const models = jsonObject(spec?.models);
    const cells = jsonObject(spec?.byComplexity);
    if (!spec || !models || !cells || !EFFORT_KEYS.includes(spec.effortKey)) return null;
    if (!Object.values(models).every((m) => typeof jsonObject(m)?.vision === "boolean")) return null;
    for (const [level, raw] of Object.entries(cells)) {
      const cell = jsonObject(raw);
      if (!(CREW_COMPLEXITIES as readonly string[]).includes(level) || !cell || typeof cell.model !== "string"
        || !Object.hasOwn(models, cell.model) || !(cell.effort === null || EFFORTS.includes(cell.effort as string))) return null;
    }
  }
  for (const level of CREW_COMPLEXITIES) {
    const list = order[level];
    if (!Array.isArray(list) || list.length === 0 || !list.every(isCrewRuntime) || new Set(list).size !== list.length) return null;
  }
  for (const role of CREW_MODEL_ROLES) {
    const entry = jsonObject(roles[role]);
    if (!entry || typeof entry.model !== "string" || !(entry.effort === null || EFFORTS.includes(entry.effort as string))) return null;
  }
  return root as unknown as CrewModelSettings;
}

/**
 * Bảng hiện hành: dòng `revision` lớn nhất của `crew_model_settings`. Chưa có bảng, chưa có dòng, đọc lỗi hoặc sai dạng
 * thì dùng mặc định (không ném lỗi). Không cache vì fallback và ghi quyết định hiếm.
 */
export async function readModelSettings(ctx: Pick<PluginContext, "db">): Promise<CrewModelSettings> {
  try {
    const rows = await ctx.db.query<{ settings: unknown }>(
      `SELECT settings FROM ${pluginNamespace(ctx)}.crew_model_settings ORDER BY revision DESC LIMIT 1`,
    );
    return rows.length === 0 ? CREW_MODEL_SETTINGS_DEFAULT : parseModelSettings(rows[0]!.settings) ?? CREW_MODEL_SETTINGS_DEFAULT;
  } catch {
    return CREW_MODEL_SETTINGS_DEFAULT;
  }
}

/**
 * Bản chép bảng runtime/model của server (`server/src/crew/model-policy.ts`). Test `runtimes-catalog` so nguyên văn
 * với bảng chung và với bản server; đổi bảng thì đổi cả hai nơi.
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
    models: { "claude-sonnet-5": { vision: true }, "claude-opus-5": { vision: true } },
    byComplexity: {
      trivial: { model: "claude-sonnet-5", effort: "low" },
      small: { model: "claude-sonnet-5", effort: "medium" },
      medium: { model: "claude-sonnet-5", effort: "high" },
      large: { model: "claude-opus-5", effort: "high" },
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

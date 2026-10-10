/** Model được phép cho issue do agent tạo theo độ phức tạp đã đánh giá và runtime của assignee. */
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

/** Bảng chép ở plugin (`src/runtimes/catalog.ts`), crew-web và `assistant.md`; mỗi bản có test so khớp nguyên văn. */
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

/** Cột `claude_local` của bảng; crew-web và code cũ import theo nghĩa này. */
export const CREW_COMPLEXITY_MODEL: Readonly<Record<CrewComplexity, { model: string; effort: CrewEffort }>> = Object.freeze({
  trivial: { model: "claude-sonnet-5", effort: "low" },
  small: { model: "claude-sonnet-5", effort: "medium" },
  medium: { model: "claude-sonnet-5", effort: "high" },
  large: { model: "claude-opus-5", effort: "high" },
});

export const CREW_ALLOWED_MODELS: ReadonlySet<string> = new Set(Object.values(CREW_COMPLEXITY_MODEL).map((entry) => entry.model));
export const CREW_ALLOWED_EFFORTS: ReadonlySet<string> = new Set<CrewEffort>(["low", "medium", "high"]);
export const CREW_OVERRIDE_FORBIDDEN_MESSAGE =
  "Crew: agent chỉ được đặt model và effort trong assigneeAdapterOverrides.";

/**
 * Dòng `crew-model` trong mô tả issue con do Trợ Lý viết. `runtime=` đứng sau `effort=` để parser cũ của crew-web vẫn
 * khớp; marker không có `runtime=` là `claude_local`.
 */
export const CREW_MODEL_LINE_RE =
  /^crew-model complexity=(trivial|small|medium|large) model=(\S+) effort=(low|medium|high|default)(?: runtime=(claude_local|codex_local|opencode_local))? reason=(.+)$/m;

export function isCrewRuntime(value: unknown): value is CrewRuntime {
  return typeof value === "string" && (CREW_RUNTIMES as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Override merge nông vào cấu hình chạy; mọi key ngoài model và key effort của runtime đều có thể đổi lệnh hoặc môi
 * trường. `adapterType` là adapter của assignee: một trong ba runtime thì model phải thuộc cột runtime đó (vi phạm ghi
 * `@<runtime>`) và key effort phải là key của runtime; thiếu hoặc adapter khác thì giữ luật Claude cũ.
 */
export function checkAgentAdapterOverrides(value: unknown, adapterType?: string | null): string[] {
  if (value === undefined || value === null) return [];
  if (!isRecord(value)) return ["shape"];
  const runtime = isCrewRuntime(adapterType) ? adapterType : null;
  const spec = CREW_RUNTIME_CATALOG[runtime ?? "claude_local"];
  const violations: string[] = [];
  for (const [key, inner] of Object.entries(value)) {
    if (key !== "adapterConfig") {
      violations.push(key);
      continue;
    }
    if (inner === undefined) continue;
    if (!isRecord(inner)) {
      violations.push("adapterConfig");
      continue;
    }
    for (const [configKey, configValue] of Object.entries(inner)) {
      if (configKey === "model") {
        if (typeof configValue !== "string" || !Object.hasOwn(spec.models, configValue)) {
          violations.push(`adapterConfig.model:${String(configValue)}${runtime ? `@${runtime}` : ""}`);
        }
      } else if (spec.effortKey !== null && configKey === spec.effortKey) {
        if (typeof configValue !== "string" || !CREW_ALLOWED_EFFORTS.has(configValue)) {
          violations.push(`adapterConfig.${configKey}:${String(configValue)}`);
        }
      } else {
        violations.push(`adapterConfig.${configKey}`);
      }
    }
  }
  return violations;
}

/** Runtime được làm reviewer; OpenCode chỉ làm executor. */
export const CREW_REVIEWER_RUNTIMES: readonly CrewRuntime[] = Object.freeze(["claude_local", "codex_local"]);
/** Reviewer Codex chạy model cố định, không có override theo issue. */
export const CREW_CODEX_REVIEWER_MODEL = Object.freeze({ model: "gpt-6-sol", effort: "high" } as const);
export type CrewIssueTemplate = "child" | "root" | "research" | "bmad";
export interface ReviewerChoice {
  agentId: string;
  runtime: "claude_local" | "codex_local";
  reason: string;
}

/** Agent ở trạng thái này không nhận việc (`agent-eligibility`): coi như project không có reviewer Codex. */
const CODEX_REVIEWER_ABSENT_STATUSES = new Set(["terminated", "pending_approval"]);

/**
 * Participant stage review của issue mới: chỉ issue con code có executor không chạy Codex mới được reviewer Codex,
 * khi project có reviewer Codex nhận việc được, không pause và công tắc `codex_local` trên máy của nó đang bật.
 * Còn lại là reviewer Claude bắt buộc của project. Hàm thuần; bên gọi đọc công tắc và trạng thái agent.
 */
export function chooseReviewer(input: {
  template: CrewIssueTemplate;
  executorRuntime: CrewRuntime;
  claudeReviewerAgentId: string;
  codexReviewer: { agentId: string; status: string } | null;
  codexSwitchOn: boolean;
}): ReviewerChoice {
  const claude = (reason: string): ReviewerChoice => ({ agentId: input.claudeReviewerAgentId, runtime: "claude_local", reason });
  if (input.template !== "child") return claude("chỉ issue con được reviewer Codex");
  if (input.executorRuntime === "codex_local") return claude("executor đã là Codex");
  const codex = input.codexReviewer;
  if (!codex || CODEX_REVIEWER_ABSENT_STATUSES.has(codex.status)) return claude("không có reviewer Codex");
  if (codex.status === "paused") return claude("reviewer Codex đang pause");
  if (!input.codexSwitchOn) return claude("Codex đang tắt trên máy reviewer");
  return {
    agentId: codex.agentId,
    runtime: "codex_local",
    reason: `executor ${input.executorRuntime}, Codex bật → reviewer codex_local`,
  };
}

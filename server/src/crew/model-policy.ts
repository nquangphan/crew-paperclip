/** Model được phép cho issue do agent tạo theo độ phức tạp đã đánh giá. */
export type CrewComplexity = "trivial" | "small" | "medium" | "large";
export type CrewEffort = "low" | "medium" | "high";

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Override merge nông vào cấu hình chạy; mọi key ngoài model và effort đều có thể đổi lệnh hoặc môi trường. */
export function checkAgentAdapterOverrides(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!isRecord(value)) return ["shape"];
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
        if (typeof configValue !== "string" || !CREW_ALLOWED_MODELS.has(configValue)) {
          violations.push(`adapterConfig.model:${String(configValue)}`);
        }
      } else if (configKey === "effort") {
        if (typeof configValue !== "string" || !CREW_ALLOWED_EFFORTS.has(configValue)) {
          violations.push(`adapterConfig.effort:${String(configValue)}`);
        }
      } else {
        violations.push(`adapterConfig.${configKey}`);
      }
    }
  }
  return violations;
}

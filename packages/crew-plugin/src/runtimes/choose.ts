import { jsonObject } from "../shared/db.js";
import {
  CREW_RUNTIME_CATALOG, CREW_RUNTIME_ORDER, type CrewComplexity, type CrewEffort, type CrewRuntime,
} from "./catalog.js";

export type FallbackTrigger = "quota" | "auth" | "unavailable" | "switch_off";
export interface FallbackCandidate { agentId: string; name: string; runtime: CrewRuntime; machineId: string | null; status: string }
/** Từ bản tin máy mới nhất (`runtimeHealthOf`); không có thì coi như dùng được. */
export interface RuntimeHealth { usable: boolean }
export const MAX_FALLBACKS_PER_ISSUE = 2;

export type FallbackChoice =
  | { kind: "fallback"; toAgentId: string; toAgentName: string; toRuntime: CrewRuntime; model: string; effort: CrewEffort | null; reason: string }
  | { kind: "refused"; reason: string };

/** Lý do chuyển (câu tiếng Việt cố định), theo trigger. */
export const FALLBACK_TRIGGER_REASON: Readonly<Record<FallbackTrigger, string>> = Object.freeze({
  quota: "hết quota",
  auth: "chưa đăng nhập hoặc thiếu key",
  unavailable: "runtime không chạy được trên máy",
  switch_off: "runtime đang tắt trên máy",
});

export const REFUSED_LARGE = "mức large chỉ chạy Claude";
export const REFUSED_CAP = `đã chuyển ${MAX_FALLBACKS_PER_ISSUE} lần`;
export const REFUSED_NONE = "không còn runtime nào bật, đã đăng nhập và đủ quota trên máy này";
export const REFUSED_IMAGES = "issue có ảnh, không còn model đọc được ảnh";

/** Agent ở trạng thái này không nhận việc. */
const UNAVAILABLE_STATUSES = new Set(["paused", "terminated", "pending_approval"]);

/**
 * Đích chuyển runtime của executor (hàm thuần): executor khác của project trên cùng máy (máy không xác định không ghép
 * với máy nào), agent nhận việc được, công tắc runtime bật, bản tin máy không báo hỏng, theo thứ tự của độ khó, bỏ
 * runtime đã chạy issue này. `large` chỉ chạy Claude; tối đa 2 lần mỗi issue; issue có ảnh chỉ model đọc được ảnh.
 */
export function chooseFallback(input: {
  complexity: CrewComplexity; hasImages: boolean; trigger: FallbackTrigger;
  from: { agentId: string; runtime: CrewRuntime; machineId: string | null };
  candidates: readonly FallbackCandidate[];
  switches: Readonly<Record<CrewRuntime, boolean>>;
  health: Readonly<Partial<Record<CrewRuntime, RuntimeHealth>>>;
  tried: readonly CrewRuntime[];
  fallbacksSoFar: number;
}): FallbackChoice {
  if (input.complexity === "large") return { kind: "refused", reason: REFUSED_LARGE };
  if (input.fallbacksSoFar >= MAX_FALLBACKS_PER_ISSUE) return { kind: "refused", reason: REFUSED_CAP };
  let blockedByImages = false;
  for (const runtime of CREW_RUNTIME_ORDER[input.complexity]) {
    if (runtime === input.from.runtime || input.tried.includes(runtime)) continue;
    if (!input.switches[runtime] || input.health[runtime]?.usable === false) continue;
    const target = input.candidates.find((c) => c.runtime === runtime && c.agentId !== input.from.agentId
      && input.from.machineId !== null && c.machineId === input.from.machineId && !UNAVAILABLE_STATUSES.has(c.status));
    const spec = CREW_RUNTIME_CATALOG[runtime].byComplexity[input.complexity];
    if (!target || !spec) continue;
    if (input.hasImages && !CREW_RUNTIME_CATALOG[runtime].models[spec.model]?.vision) { blockedByImages = true; continue; }
    return { kind: "fallback", toAgentId: target.agentId, toAgentName: target.name, toRuntime: runtime, model: spec.model,
      effort: spec.effort, reason: FALLBACK_TRIGGER_REASON[input.trigger] };
  }
  return { kind: "refused", reason: blockedByImages ? REFUSED_IMAGES : REFUSED_NONE };
}

/** Ngưỡng coi runtime là hết quota theo bản tin máy (OpenCode Go: $12/ngày, $30/tuần, $60/tháng). */
const CODEX_QUOTA_STOP_PCT = 99;
const OPENCODE_COST_LIMITS = { costDay: 12, costWeek: 30, costMonth: 60 } as const;
const num = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : 0;

/**
 * Runtime dùng được theo bản tin máy mới nhất: chưa đăng nhập, thiếu key, quota/chi phí chạm ngưỡng thì không dùng được;
 * trường thiếu hoặc `null` (không đọc được) coi như dùng được.
 */
export function runtimeHealthOf(report: unknown): Partial<Record<CrewRuntime, RuntimeHealth>> {
  const value = jsonObject(report);
  if (!value) return {};
  const health: Partial<Record<CrewRuntime, RuntimeHealth>> = {
    claude_local: { usable: jsonObject(value.claude)?.loggedIn !== false },
  };
  const runtimes = jsonObject(value.runtimes);
  const codex = jsonObject(runtimes?.codex);
  if (codex) health.codex_local = { usable: codex.loggedIn !== false && num(codex.primaryUsedPct) < CODEX_QUOTA_STOP_PCT };
  const opencode = jsonObject(runtimes?.opencode);
  if (opencode) {
    health.opencode_local = { usable: opencode.keyPresent !== false
      && (Object.keys(OPENCODE_COST_LIMITS) as (keyof typeof OPENCODE_COST_LIMITS)[]).every((key) => num(opencode[key]) < OPENCODE_COST_LIMITS[key]) };
  }
  return health;
}

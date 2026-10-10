/**
 * Phân loại run hỏng để quyết định có chuyển runtime không. Chỉ `quota`, `auth`, `unavailable` mới chuyển; mọi lỗi khác
 * (code, test, timeout, 422, `crew-workflow blocked`) là `other` và để stock/Crew xử lý như cũ.
 */
export type FailureClass = "quota" | "auth" | "unavailable" | "other";

/**
 * Câu lỗi quota của OpenCode Go: "Go usage limit exceeded" (log thật), "<tên> usage limit reached" (GoUsageLimitError),
 * "Free usage exceeded", "Quota exceeded" (insufficient_quota của API OpenAI-compatible).
 * Giá trị giả định, kiểm khi có key OpenCode.
 */
export const OPENCODE_QUOTA_RE =
  /\b(429|rate[ _-]?limit|quota|usage limit|insufficient[ _-]?(credit|balance|funds)|exceeded|GoUsageLimitError|FreeUsageLimitError|limit reached)\b/i;
/**
 * Câu lỗi đăng nhập/key của OpenCode: AI SDK "<Provider> API key is missing", `ProviderAuthError`, `LoadAPIKeyError`,
 * hoặc server trả 401/403 khi key rỗng. Giá trị giả định, kiểm khi có key OpenCode.
 */
export const OPENCODE_AUTH_RE =
  /\b(401|403|unauthori[sz]ed|invalid[ _-]?api[ _-]?key|missing[ _-]?api[ _-]?key|no api key|api key is missing|ProviderAuthError|LoadAPIKeyError)\b/i;

/** Wrapper trên Mac (`crew-codex-run`, `crew-opencode-run`) thoát 78 với dòng này khi thiếu key hay chưa đăng nhập. */
const WRAPPER_AUTH_RE = /crew-runtime blocked: (thiếu key|Codex chưa đăng nhập)/;
const WRAPPER_UNAVAILABLE_RE = /crew-runtime blocked: không tạo được auth\.json|opencode-in-place/;
const WORKFLOW_BLOCKED_RE = /crew-workflow blocked:/;
const UNAVAILABLE_MESSAGE_RE = /command not found|\bENOENT\b/;
/** Cùng tập mã lỗi đăng nhập của server (`ai-auth-failure.ts`). */
const AUTH_CODES = new Set(["adapter_auth_missing", "authentication_required", "auth_required", "refresh_token_reused",
  "refresh_token_expired", "refresh_token_invalidated"]);
const isAuthCode = (code: string | null) => !!code && (/_auth_required$|_auth_failed$/.test(code) || AUTH_CODES.has(code));

export function classifyRuntimeFailure(input: {
  adapterType: string; errorCode: string | null; errorFamily: string | null; message: string | null;
}): FailureClass {
  const { adapterType, errorCode, errorFamily } = input;
  const message = input.message ?? "";
  // Workflow-check từ chối là lỗi quy trình của chính run, không phải runtime hỏng.
  if (WORKFLOW_BLOCKED_RE.test(message)) return "other";
  const opencode = adapterType === "opencode_local";
  if (errorFamily === "provider_quota" || errorCode === "provider_quota" || (opencode && OPENCODE_QUOTA_RE.test(message))) return "quota";
  if (isAuthCode(errorCode) || isAuthCode(errorFamily) || WRAPPER_AUTH_RE.test(message) || (opencode && OPENCODE_AUTH_RE.test(message))) {
    return "auth";
  }
  if (errorCode === "adapter_engine_unavailable" || errorFamily === "configuration_incomplete"
    || WRAPPER_UNAVAILABLE_RE.test(message) || UNAVAILABLE_MESSAGE_RE.test(message)) return "unavailable";
  return "other";
}

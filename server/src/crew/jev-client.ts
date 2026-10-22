import {
  type BackendRequest,
  type BackendResponse,
  type JevBackend,
  type JevUseModule,
  loadJevUse,
  type QuestionMap,
  type State,
  type Verdict,
} from "./vendor/jev-use.js";

/**
 * Gọi Jev (TypeSafe, qua OpenRouter `/api/alpha/decisions`) từ server Crew. Dùng cho nút kiểm key và worker so sánh với
 * regex. Không bao giờ ném: lỗi trả `{ ok: false, errorCode }`, không kèm message của provider (message có thể lặp lại
 * phần đầu request) và không bao giờ chứa key. Bản jev-use vendored được nạp lười: nạp hỏng thì `internal`.
 *
 * `auth`: provider trả 401/403 (key sai hoặc bị thu hồi), tách khỏi `unreachable` (mạng, 408/429/5xx, 4xx khác).
 */

export type JevErrorCode = "no_key" | "auth" | "timeout" | "unreachable" | "bad_response" | "internal";

export interface JevJudgeInput {
  apiKey: string;
  model: string;
  timeoutMs: number;
  state: State;
  questions: QuestionMap;
  /** Ngưỡng escalate; bỏ trống thì theo mặc định của jev-use. */
  confidenceThreshold?: number;
}

export interface JevAnswer {
  answer: string | number | null;
  confidence: number;
  escalated: boolean;
  /** Lý do escalate của jev-use (`unsure`, `oversized`, ...), không có text tự do. */
  reason: string | null;
}

export type JevJudgeResult =
  | { ok: true; answers: Record<string, JevAnswer>; model: string | null; latencyMs: number }
  | { ok: false; errorCode: JevErrorCode; latencyMs: number };

/** Gốc API thật; `CREW_JEV_BASE_URL` chỉ để test trỏ vào stub cục bộ. */
function baseUrl(): string | undefined {
  const value = process.env.CREW_JEV_BASE_URL?.trim();
  return value ? value : undefined;
}

function errorCodeOf(jevUse: JevUseModule, error: unknown): JevErrorCode {
  if (error instanceof jevUse.BackendError) {
    if (error.status === 401 || error.status === 403) return "auth";
    if (error.status !== undefined) return "unreachable";
    if (/timed out/i.test(error.message)) return "timeout";
    // HTTP 2xx mà body không phải JSON: jev-use gói thành "network error" kèm SyntaxError.
    if (error.cause instanceof SyntaxError) return "bad_response";
    if (error.cause !== undefined) return "unreachable";
    return "bad_response";
  }
  return "internal";
}

/**
 * Bọc backend để giữ lại loại lỗi: engine của jev-use nuốt lỗi backend thành verdict `unreachable` kèm hint có message
 * của provider, nên phải bắt lỗi ở đây mới phân biệt được timeout, mạng và trả sai dạng.
 */
class RecordingBackend implements JevBackend {
  readonly name: string;
  failure: JevErrorCode | null = null;

  constructor(
    private readonly jevUse: JevUseModule,
    private readonly inner: JevBackend,
  ) {
    this.name = inner.name;
  }

  async judge(request: BackendRequest): Promise<BackendResponse> {
    try {
      return await this.inner.judge(request);
    } catch (error) {
      this.failure = errorCodeOf(this.jevUse, error);
      throw error;
    }
  }
}

function toAnswer(verdict: Verdict | undefined): JevAnswer {
  return {
    answer: verdict?.answer ?? null,
    confidence: typeof verdict?.confidence === "number" ? verdict.confidence : 0,
    escalated: verdict?.escalate ?? true,
    reason: verdict?.reason ?? null,
  };
}

export async function jevJudge(input: JevJudgeInput): Promise<JevJudgeResult> {
  const started = Date.now();
  const elapsed = () => Date.now() - started;
  if (typeof input.apiKey !== "string" || input.apiKey.trim() === "") {
    return { ok: false, errorCode: "no_key", latencyMs: 0 };
  }
  let jevUse: JevUseModule;
  try {
    jevUse = await loadJevUse();
  } catch {
    return { ok: false, errorCode: "internal", latencyMs: elapsed() };
  }
  try {
    const backend = new RecordingBackend(
      jevUse,
      new jevUse.OpenRouterBackend({ apiKey: input.apiKey, timeoutMs: input.timeoutMs, maxRetries: 0, baseUrl: baseUrl() }),
    );
    const jev = new jevUse.Jev({ backend, model: input.model, confidenceThreshold: input.confidenceThreshold });
    const result = await jev.judge(input.state, input.questions);
    if (backend.failure) return { ok: false, errorCode: backend.failure, latencyMs: elapsed() };
    const answers: Record<string, JevAnswer> = {};
    for (const key of Object.keys(input.questions)) answers[key] = toAnswer(result.answers[key]);
    return { ok: true, answers, model: result.model ?? null, latencyMs: result.latencyMs ?? elapsed() };
  } catch (error) {
    return { ok: false, errorCode: errorCodeOf(jevUse, error), latencyMs: elapsed() };
  }
}

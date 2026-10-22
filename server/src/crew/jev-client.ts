import { OpenRouterBackend } from "jev-use/dist/backends/openrouter.js";
import { BackendError, type BackendRequest, type BackendResponse, type JevBackend } from "jev-use/dist/backends/types.js";
import { Jev, type QuestionMap } from "jev-use/dist/jev.js";
import type { State, Verdict } from "jev-use/dist/protocol.js";

/**
 * Gọi Jev (TypeSafe, qua OpenRouter `/api/alpha/decisions`) từ server Crew. Dùng cho nút kiểm key và worker so sánh với
 * regex. Không bao giờ ném: lỗi trả `{ ok: false, errorCode }`, không kèm message của provider (message có thể lặp lại
 * phần đầu request) và không bao giờ chứa key.
 */

export type JevErrorCode = "no_key" | "timeout" | "unreachable" | "bad_response" | "internal";

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

function errorCodeOf(error: unknown): JevErrorCode {
  if (error instanceof BackendError) {
    if (error.status !== undefined) return "unreachable";
    if (/timed out/i.test(error.message)) return "timeout";
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

  constructor(private readonly inner: JevBackend) {
    this.name = inner.name;
  }

  async judge(request: BackendRequest): Promise<BackendResponse> {
    try {
      return await this.inner.judge(request);
    } catch (error) {
      this.failure = errorCodeOf(error);
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
  try {
    const backend = new RecordingBackend(
      new OpenRouterBackend({ apiKey: input.apiKey, timeoutMs: input.timeoutMs, maxRetries: 0, baseUrl: baseUrl() }),
    );
    const jev = new Jev({ backend, model: input.model, confidenceThreshold: input.confidenceThreshold });
    const result = await jev.judge(input.state, input.questions);
    if (backend.failure) return { ok: false, errorCode: backend.failure, latencyMs: elapsed() };
    const answers: Record<string, JevAnswer> = {};
    for (const key of Object.keys(input.questions)) answers[key] = toAnswer(result.answers[key]);
    return { ok: true, answers, model: result.model ?? null, latencyMs: result.latencyMs ?? elapsed() };
  } catch (error) {
    return { ok: false, errorCode: errorCodeOf(error), latencyMs: elapsed() };
  }
}

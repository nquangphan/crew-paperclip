/**
 * Kiểu và bộ nạp cho bản vendored của `jev-use@0.8.0` (`./jev-use-0.8.0.ts`, tạo bằng `crew/release/vendor-jev-use.mjs`).
 *
 * Server không có dependency npm `jev-use`: overlay prod chỉ chép file `.ts` của `server/src`, không cài gói. Bundle được
 * nạp lười bằng `import()`, nên nếu file hỏng thì chỉ Jev báo lỗi, server vẫn khởi động. Kiểu dưới đây chép đúng phần
 * public của jev-use 0.8.0 mà Crew dùng.
 */

export type State = string | Record<string, unknown> | unknown[];
export type QuestionType = "noul" | "choice" | "score";
export type EscalationReason = "writing" | "open_ended" | "oversized" | "unsure" | "unreachable";

export interface Question {
  id?: string;
  type: QuestionType;
  question: string;
  options?: string[] | Record<string, string>;
  levels?: string[];
  criteria?: { true: string; false: string };
}
export type QuestionMap = Record<string, Question>;

export interface Verdict {
  id: string;
  type: QuestionType;
  answer: number | string | null;
  distribution?: Record<string, number>;
  confidence: number;
  confidenceFrom?: "reported" | "estimated";
  escalate: boolean;
  reason?: EscalationReason;
  hint?: string;
}

export interface JudgeResult {
  verdicts: Verdict[];
  escalated: boolean;
  backend: string;
  model?: string;
  latencyMs?: number;
}

export interface BackendRequest {
  state: State;
  questions: (Question & { id: string })[];
  model?: string;
}
export interface BackendResponse {
  answers: unknown[];
  model?: string;
  latencyMs?: number;
}
export interface JevBackend {
  readonly name: string;
  judge(request: BackendRequest): Promise<BackendResponse>;
}

export interface BackendErrorInstance extends Error {
  readonly backend: string;
  readonly status?: number;
  readonly cause?: unknown;
}

export interface JevInstance {
  judge(
    state: State,
    questions: QuestionMap,
    options?: { confidenceThreshold?: number; model?: string },
  ): Promise<JudgeResult & { answers: Record<string, Verdict> }>;
}

export interface JevUseModule {
  Jev: new (options: { backend: JevBackend; confidenceThreshold?: number; model?: string }) => JevInstance;
  OpenRouterBackend: new (options: {
    apiKey: string;
    baseUrl?: string;
    defaultModel?: string;
    timeoutMs?: number;
    maxRetries?: number;
  }) => JevBackend;
  BackendError: new (backend: string, message: string, status?: number, cause?: unknown) => BackendErrorInstance;
  check(question: string, criteria?: { true: string; false: string }): Question;
  pick(question: string, options: string[] | Record<string, string>): Question;
  rate(question: string, levels: string[]): Question;
  redactSecrets(text: string): string;
  REDACTED: string;
}

let loading: Promise<JevUseModule> | null = null;

/** Nạp bundle một lần; lỗi nạp không được cache, lần sau thử lại. */
export function loadJevUse(): Promise<JevUseModule> {
  loading ??= (import("./jev-use-0.8.0.js") as Promise<unknown>).then(
    (mod) => mod as JevUseModule,
    (error: unknown) => {
      loading = null;
      throw error;
    },
  );
  return loading;
}

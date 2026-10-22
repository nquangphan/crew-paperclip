// @ts-nocheck
// Mã vendored, KHÔNG sửa tay. Nguồn: npm jev-use@0.8.0 (https://github.com/shitianfang/jev-use),
// tarball sha256 7f10aceabd51adfbca0482fab110f8531408c0c587d3a63cd1c26527f1468d1a, sha512-nHOS52eGinSdH90lluFAGTGzP0YuOyLSrkn67VXA75kbo7usVweBF99lr+YXcZNOAhgLqukD5ezIQVU3Mcxz3w==.
// Tạo lại bằng: node crew/release/vendor-jev-use.mjs. Kiểu dùng ở server: ./jev-use.ts.
//
// MIT License
//
// Copyright (c) 2026 shitianfang
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

// ../../../../../private/var/folders/wr/3y_dzgm55m3fy0gtp5sznlnh0000gn/T/vendor-jev-use-YUAVIa/x/package/dist/protocol.js
var REPORTED_CONFIDENCE_THRESHOLD = 0.5;
var ESTIMATED_CONFIDENCE_THRESHOLD = 0.4;
function confidenceThresholdFor(source) {
  return source === "reported" ? REPORTED_CONFIDENCE_THRESHOLD : ESTIMATED_CONFIDENCE_THRESHOLD;
}
var DEFAULT_MAX_STATE_TOKENS = 3e4;
function defaultQuestionId(index) {
  return `q${index}`;
}
function optionEntries(options) {
  return Array.isArray(options) ? options.map((label) => [label, ""]) : Object.entries(options);
}
function estimateTokens(state) {
  const text = typeof state === "string" ? state : JSON.stringify(state);
  return Math.ceil(text.length / 4);
}
function serializeState(state) {
  return typeof state === "string" ? state : JSON.stringify(state);
}
function check(question, criteria) {
  return criteria ? { type: "noul", question, criteria } : { type: "noul", question };
}
function pick(question, options) {
  return { type: "choice", question, options };
}
function rate(question, levels) {
  return { type: "score", question, levels };
}

// ../../../../../private/var/folders/wr/3y_dzgm55m3fy0gtp5sznlnh0000gn/T/vendor-jev-use-YUAVIa/x/package/dist/backends/mock.js
var MockBackend = class {
  script;
  name = "mock";
  constructor(script = {}) {
    this.script = script;
  }
  async judge(request) {
    const started = Date.now();
    const answers = request.questions.map((question, index) => this.script[question.id] ?? synthesize(request, question, index));
    return {
      answers,
      model: "jev-mock",
      latencyMs: Date.now() - started
    };
  }
};
function synthesize(request, question, index) {
  const seed = hash(`${serializeState(request.state)}|${question.question}|${index}`);
  switch (question.type) {
    case "noul": {
      const probability = seed % 1e3 / 1e3 * 0.98 + 0.01;
      return { answer: round3(probability) };
    }
    case "choice": {
      const labels = optionEntries(question.options ?? []).map(([label]) => label);
      const winner = seed % labels.length;
      const rest = labels.length > 1 ? 0.15 / (labels.length - 1) : 0;
      const distribution = {};
      labels.forEach((label, position) => {
        distribution[label] = round3(position === winner ? 0.85 : rest);
      });
      return { answer: labels[winner], distribution, confidence: 0.85 };
    }
    case "score": {
      const levels = question.levels ?? [];
      const winner = seed % levels.length;
      const rest = levels.length > 1 ? 0.15 / (levels.length - 1) : 0;
      const distribution = {};
      levels.forEach((_, position) => {
        distribution[String(position)] = round3(position === winner ? 0.85 : rest);
      });
      return {
        answer: winner,
        distribution,
        legend: Object.fromEntries(levels.map((level, position) => [String(position), level])),
        confidence: 0.8
      };
    }
  }
}
function hash(text) {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}
function round3(value) {
  return Math.round(value * 1e3) / 1e3;
}

// ../../../../../private/var/folders/wr/3y_dzgm55m3fy0gtp5sznlnh0000gn/T/vendor-jev-use-YUAVIa/x/package/dist/backends/types.js
var BackendError = class extends Error {
  backend;
  status;
  cause;
  /** Provider-requested retry delay, when the response carried one. */
  retryAfterMs;
  constructor(backend, message, status, cause) {
    super(`[${backend}] ${message}`);
    this.backend = backend;
    this.status = status;
    this.cause = cause;
    this.name = "BackendError";
  }
};

// ../../../../../private/var/folders/wr/3y_dzgm55m3fy0gtp5sznlnh0000gn/T/vendor-jev-use-YUAVIa/x/package/dist/backends/native.js
function toNativeQuestion(question) {
  switch (question.type) {
    case "noul":
      return {
        type: "noul",
        instructions: question.question,
        ...question.criteria ? { criteria: question.criteria } : {}
      };
    case "choice":
      return {
        type: "choice",
        instructions: question.question,
        // Label-only options get the label as its own description.
        criteria: Object.fromEntries(optionEntries(question.options ?? []).map(([label, meaning]) => [
          label,
          meaning || label
        ]))
      };
    case "score":
      return {
        type: "score",
        instructions: question.question,
        criteria: question.levels ?? []
      };
  }
}
function toNativeBody(state, questions, model) {
  return {
    model,
    state,
    questions: Object.fromEntries(questions.map((question) => [question.id, toNativeQuestion(question)]))
  };
}
function parseNativeAnswers(backend, answers, questions) {
  if (!answers || typeof answers !== "object") {
    throw new BackendError(backend, "response has no answers object");
  }
  const byId = answers;
  return questions.map((question) => {
    const answer = byId[question.id];
    if (!answer) {
      throw new BackendError(backend, `response missing answer for question "${question.id}"`);
    }
    switch (question.type) {
      case "noul":
        return {
          answer: numberOrThrow(backend, question.id, answer.noul),
          confidence: answer.confidence
        };
      case "choice":
        return {
          answer: stringOrThrow(backend, question.id, answer.choice),
          confidence: answer.confidence,
          distribution: answer.probabilities
        };
      case "score":
        return {
          answer: numberOrThrow(backend, question.id, answer.score),
          confidence: answer.confidence,
          distribution: answer.probabilities,
          legend: answer.legend
        };
    }
  });
}
function numberOrThrow(backend, id, value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new BackendError(backend, `answer "${id}" has no numeric value`);
  }
  return value;
}
function stringOrThrow(backend, id, value) {
  if (typeof value !== "string" || !value) {
    throw new BackendError(backend, `answer "${id}" has no choice value`);
  }
  return value;
}

// ../../../../../private/var/folders/wr/3y_dzgm55m3fy0gtp5sznlnh0000gn/T/vendor-jev-use-YUAVIa/x/package/dist/backends/http.js
var DEFAULT_TIMEOUT_MS = 1e4;
var DEFAULT_MAX_RETRIES = 2;
var RETRY_BASE_MS = 500;
var RETRY_MAX_MS = 5e3;
async function postJson(backend, url, headers, body, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      await sleep(retryDelay(attempt, lastError));
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...headers
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      if (response.ok) {
        return await response.json();
      }
      const message = await extractErrorMessage(response);
      lastError = new BackendError(backend, `HTTP ${response.status}: ${message}`, response.status);
      lastError.retryAfterMs = parseRetryAfter(response);
      if (!isRetryable(response.status) || attempt === maxRetries)
        throw lastError;
    } catch (error) {
      if (error instanceof BackendError) {
        if (attempt === maxRetries || !isRetryable(error.status))
          throw error;
        continue;
      }
      const aborted = error?.name === "AbortError";
      lastError = new BackendError(backend, aborted ? `request timed out after ${timeoutMs}ms` : `network error: ${String(error)}`, void 0, error);
      if (attempt === maxRetries)
        throw lastError;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError ?? new BackendError(backend, "unreachable");
}
function isRetryable(status) {
  if (status === void 0)
    return true;
  return status === 408 || status === 429 || status >= 500;
}
function retryDelay(attempt, lastError) {
  if (lastError?.retryAfterMs !== void 0) {
    return Math.min(lastError.retryAfterMs, 6e4);
  }
  const base = Math.min(RETRY_BASE_MS * 2 ** (attempt - 1), RETRY_MAX_MS);
  return base * (1 + Math.random() * 0.25);
}
function parseRetryAfter(response) {
  const milliseconds = response.headers.get("retry-after-ms");
  if (milliseconds && Number.isFinite(Number(milliseconds))) {
    return Number(milliseconds);
  }
  const seconds = response.headers.get("retry-after");
  if (seconds && Number.isFinite(Number(seconds)))
    return Number(seconds) * 1e3;
  return void 0;
}
async function extractErrorMessage(response) {
  try {
    const data = await response.json();
    for (const key of ["error", "message", "detail"]) {
      const value = data[key];
      if (typeof value === "string")
        return value;
      if (value && typeof value === "object") {
        const message = value.message;
        if (typeof message === "string")
          return message;
      }
      if (Array.isArray(value) && value.length > 0) {
        const first = value[0];
        if (typeof first?.msg === "string")
          return first.msg;
      }
    }
    return JSON.stringify(data).slice(0, 300);
  } catch {
    return response.statusText || "request failed";
  }
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ../../../../../private/var/folders/wr/3y_dzgm55m3fy0gtp5sznlnh0000gn/T/vendor-jev-use-YUAVIa/x/package/dist/backends/openrouter.js
var OPENROUTER_BASE_URL = "https://openrouter.ai";
var OPENROUTER_DEFAULT_MODEL = "typesafe/jev-latest";
var OpenRouterBackend = class {
  options;
  name = "openrouter";
  constructor(options) {
    this.options = options;
  }
  async judge(request) {
    const model = request.model ?? this.options.defaultModel ?? OPENROUTER_DEFAULT_MODEL;
    const body = toNativeBody(request.state, request.questions, model);
    const started = Date.now();
    const response = await postJson(this.name, `${this.options.baseUrl ?? OPENROUTER_BASE_URL}/api/alpha/decisions`, { Authorization: `Bearer ${this.options.apiKey}` }, body, this.options);
    return {
      answers: parseNativeAnswers(this.name, response.answers, request.questions),
      model: response.model ?? model,
      latencyMs: Date.now() - started,
      usage: {
        inputTokens: response.usage?.input_tokens,
        outputTokens: response.usage?.output_tokens
      }
    };
  }
};

// ../../../../../private/var/folders/wr/3y_dzgm55m3fy0gtp5sznlnh0000gn/T/vendor-jev-use-YUAVIa/x/package/dist/backends/typesafe.js
var TYPESAFE_BASE_URL = "https://api.typesafe.ai";
var TYPESAFE_DEFAULT_MODEL = "jev-latest";
var TypeSafeBackend = class {
  options;
  name = "typesafe";
  constructor(options) {
    this.options = options;
  }
  async judge(request) {
    const model = request.model ?? this.options.defaultModel ?? TYPESAFE_DEFAULT_MODEL;
    const body = toNativeBody(request.state, request.questions, model);
    const started = Date.now();
    const response = await postJson(this.name, `${this.options.baseUrl ?? TYPESAFE_BASE_URL}/v1/systemone`, { Authorization: `Bearer ${this.options.apiKey}` }, body, this.options);
    return {
      answers: parseNativeAnswers(this.name, response.answers, request.questions),
      model: response.model ?? model,
      latencyMs: Date.now() - started,
      usage: {
        inputTokens: response.usage?.input_tokens,
        outputTokens: response.usage?.output_tokens
      }
    };
  }
};

// ../../../../../private/var/folders/wr/3y_dzgm55m3fy0gtp5sznlnh0000gn/T/vendor-jev-use-YUAVIa/x/package/dist/backends/vercel.js
var VERCEL_BASE_URL = "https://ai-gateway.vercel.sh";
var VERCEL_DEFAULT_MODEL = "typesafe-ai/jev";
function toGatewayQuestion(question) {
  switch (question.type) {
    case "noul":
      return {
        type: "boolean",
        instructions: question.question,
        ...question.criteria ? { criteria: question.criteria } : {}
      };
    case "choice":
      return {
        type: "choice",
        instructions: question.question,
        criteria: Object.fromEntries(optionEntries(question.options ?? []).map(([label, meaning]) => [
          label,
          meaning || label
        ]))
      };
    case "score":
      return {
        type: "score",
        instructions: question.question,
        criteria: question.levels ?? []
      };
  }
}
var VercelBackend = class {
  options;
  name = "vercel";
  constructor(options) {
    this.options = options;
  }
  async judge(request) {
    const model = request.model ?? this.options.defaultModel ?? VERCEL_DEFAULT_MODEL;
    const body = {
      state: request.state,
      questions: Object.fromEntries(request.questions.map((question) => [question.id, toGatewayQuestion(question)]))
    };
    const started = Date.now();
    const response = await postJson(this.name, `${this.options.baseUrl ?? VERCEL_BASE_URL}/v4/ai/evaluation-model`, {
      Authorization: `Bearer ${this.options.apiKey}`,
      "ai-gateway-protocol-version": "0.0.1",
      "ai-evaluation-model-specification-version": "4",
      "ai-model-id": model
    }, body, this.options);
    const reported = response.providerMetadata?.typesafe?.confidence ?? {};
    const confidenceOf2 = (id) => typeof reported[id] === "number" ? reported[id] : void 0;
    const answers = request.questions.map((question) => {
      const answer = response.answers?.[question.id];
      if (!answer) {
        throw new BackendError(this.name, `response missing answer for question "${question.id}"`);
      }
      switch (question.type) {
        case "noul":
          if (typeof answer.probability !== "number") {
            throw new BackendError(this.name, `answer "${question.id}" has no probability`);
          }
          return { answer: answer.probability };
        case "choice":
          if (typeof answer.choice !== "string") {
            throw new BackendError(this.name, `answer "${question.id}" has no choice`);
          }
          return {
            answer: answer.choice,
            distribution: answer.probabilities,
            confidence: confidenceOf2(question.id)
          };
        case "score":
          if (typeof answer.score !== "number") {
            throw new BackendError(this.name, `answer "${question.id}" has no score`);
          }
          return {
            answer: answer.score,
            distribution: answer.probabilities,
            confidence: confidenceOf2(question.id)
          };
      }
    });
    return {
      answers,
      model,
      latencyMs: Date.now() - started,
      usage: {
        inputTokens: response.usage?.inputTokens,
        outputTokens: response.usage?.outputTokens
      }
    };
  }
};

// ../../../../../private/var/folders/wr/3y_dzgm55m3fy0gtp5sznlnh0000gn/T/vendor-jev-use-YUAVIa/x/package/dist/backends/index.js
function createBackend(name, env = process.env) {
  const requested = (name ?? env.JEV_BACKEND)?.toLowerCase();
  switch (requested) {
    case void 0:
    case "":
    case "auto":
      break;
    case "typesafe":
      return { backend: typesafe(env), via: "explicit: typesafe" };
    case "openrouter":
      return { backend: openrouter(env), via: "explicit: openrouter" };
    case "vercel":
      return { backend: vercel(env), via: "explicit: vercel" };
    case "mock":
      return {
        backend: new MockBackend(),
        via: "explicit: mock (no real Jev calls)"
      };
    default:
      throw new Error(`Unknown backend "${requested}". Valid: typesafe | openrouter | vercel | mock.`);
  }
  if (env.TYPESAFE_API_KEY || env.TYPESAFE_AI_API_KEY) {
    return { backend: typesafe(env), via: "auto: TYPESAFE_API_KEY found" };
  }
  if (env.OPENROUTER_API_KEY) {
    return { backend: openrouter(env), via: "auto: OPENROUTER_API_KEY found" };
  }
  if (env.AI_GATEWAY_API_KEY) {
    return { backend: vercel(env), via: "auto: AI_GATEWAY_API_KEY found" };
  }
  throw new Error("No Jev credentials found. Set one of TYPESAFE_API_KEY (direct), OPENROUTER_API_KEY, or AI_GATEWAY_API_KEY (Vercel AI Gateway) \u2014 or run with JEV_BACKEND=mock for a keyless dry run.");
}
function typesafe(env) {
  const apiKey = env.TYPESAFE_API_KEY ?? env.TYPESAFE_AI_API_KEY;
  if (!apiKey)
    throw new Error("JEV_BACKEND=typesafe needs TYPESAFE_API_KEY.");
  return new TypeSafeBackend({
    apiKey,
    baseUrl: env.TYPESAFE_BASE_URL,
    defaultModel: env.JEV_MODEL ?? env.TYPESAFE_DEFAULT_MODEL
  });
}
function openrouter(env) {
  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey)
    throw new Error("JEV_BACKEND=openrouter needs OPENROUTER_API_KEY.");
  return new OpenRouterBackend({
    apiKey,
    baseUrl: env.OPENROUTER_BASE_URL,
    defaultModel: env.JEV_MODEL
  });
}
function vercel(env) {
  const apiKey = env.AI_GATEWAY_API_KEY;
  if (!apiKey)
    throw new Error("JEV_BACKEND=vercel needs AI_GATEWAY_API_KEY.");
  return new VercelBackend({
    apiKey,
    baseUrl: env.AI_GATEWAY_BASE_URL,
    defaultModel: env.JEV_MODEL
  });
}

// ../../../../../private/var/folders/wr/3y_dzgm55m3fy0gtp5sznlnh0000gn/T/vendor-jev-use-YUAVIa/x/package/dist/dispatch.js
function handBack(question, index, reason, hint) {
  return {
    index,
    verdict: {
      id: question.id,
      type: question.type,
      answer: null,
      confidence: 0,
      escalate: true,
      reason,
      hint
    }
  };
}
function screenQuestions(state, questions, limits = {}) {
  const identified = questions.map((question, index) => ({
    ...question,
    id: question.id ?? defaultQuestionId(index)
  }));
  const maxStateTokens = limits.maxStateTokens ?? DEFAULT_MAX_STATE_TOKENS;
  if (estimateTokens(state) > maxStateTokens) {
    return {
      sendable: [],
      handedBack: identified.map((question, index) => handBack(question, index, "oversized", `State exceeds ~${maxStateTokens} tokens; shrink it (summarize, drop stale entries) or take the question over yourself.`)),
      oversized: true
    };
  }
  const sendable = [];
  const handedBack = [];
  const seenIds = /* @__PURE__ */ new Set();
  identified.forEach((question, index) => {
    if (seenIds.has(question.id)) {
      handedBack.push(handBack(question, index, "open_ended", `Duplicate question id "${question.id}" \u2014 ids key the batch and must be unique.`));
      return;
    }
    seenIds.add(question.id);
    const problem = whyUnaskable(question);
    if (problem) {
      handedBack.push(handBack(question, index, "open_ended", problem));
    } else {
      sendable.push({ index, question });
    }
  });
  return { sendable, handedBack };
}
function whyUnaskable(question) {
  if (!question.question || !question.question.trim()) {
    return "Empty question text.";
  }
  switch (question.type) {
    case "noul": {
      const criteria = question.criteria;
      if (criteria && (!criteria.true?.trim() || !criteria.false?.trim())) {
        return "noul criteria needs BOTH `true` and `false` meanings (or neither).";
      }
      return null;
    }
    case "choice": {
      if (!question.options) {
        return "A choice question needs >= 2 enumerated options; if the options cannot be enumerated, this step is open-ended \u2014 take it over.";
      }
      const labels = optionEntries(question.options).map(([label]) => label);
      if (labels.length < 2) {
        return "A choice question needs >= 2 enumerated options.";
      }
      if (labels.some((label) => !label.trim())) {
        return "Choice option labels must be non-empty.";
      }
      if (new Set(labels).size !== labels.length) {
        return "Choice options must be distinct.";
      }
      return null;
    }
    case "score": {
      if (!question.levels || question.levels.length < 2) {
        return "A score question needs >= 2 ORDERED level descriptions (`levels`); the answer is an index into them. An unbounded quantity is not scorable \u2014 take it over.";
      }
      if (question.levels.some((level) => !level.trim())) {
        return "Score levels must be non-empty descriptions.";
      }
      return null;
    }
    default:
      return `Unknown question type "${question.type}" \u2014 only noul | choice | score exist.`;
  }
}
function escalateIfUnsure(verdict, override) {
  if (verdict.escalate)
    return verdict;
  const source = verdict.confidenceFrom ?? "estimated";
  const threshold = override ?? confidenceThresholdFor(source);
  if (verdict.confidence >= threshold)
    return verdict;
  return {
    ...verdict,
    escalate: true,
    reason: "unsure",
    hint: `Jev answered (${formatAnswer(verdict)}) at ${source} confidence ${verdict.confidence.toFixed(2)} < ${threshold}. Treat the answer as a prior, not a decision \u2014 reason it out yourself.`
  };
}
function formatAnswer(verdict) {
  if (verdict.answer === null)
    return "null";
  return typeof verdict.answer === "number" ? verdict.answer.toFixed(3) : String(verdict.answer);
}
function certainty(probability) {
  return round4(Math.min(1, Math.max(0, Math.abs(probability - 0.5) * 2)));
}
function round4(value) {
  return Math.round(value * 1e4) / 1e4;
}
function margin(distribution) {
  const sorted = Object.values(distribution).sort((a, b) => b - a);
  if (sorted.length === 0)
    return 0;
  if (sorted.length === 1)
    return round4(sorted[0]);
  return round4(Math.min(1, Math.max(0, sorted[0] - sorted[1])));
}

// ../../../../../private/var/folders/wr/3y_dzgm55m3fy0gtp5sznlnh0000gn/T/vendor-jev-use-YUAVIa/x/package/dist/redact.js
var REDACTED = "[redacted]";
var RULES = [
  {
    name: "password in a URL",
    pattern: /(\b[a-z][\w+.-]*:\/\/[^\s:/@]+:)([^\s@/]+)(?=@)/gi
  },
  {
    name: "auth header",
    pattern: /((?:authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|x-auth-token)"?\s*:\s*"?(?:(?:bearer|basic|token|digest)\s+)?)([^"'\n\\]+)/gi
  },
  {
    name: "credential flag",
    pattern: /((?:^|\s)--?[\w-]*(?:pass(?:wd|word)?|token|api-?key|secret|auth)[\w-]*[ =]+"?)([^\s"'\\]+)/gi
  },
  {
    name: "user:password flag",
    pattern: /((?:^|\s)(?:-u|--user)[ =]+"?[^\s:"']*:)([^\s"'\\]+)/g
  },
  {
    name: "secret-looking name = value",
    pattern: /(["']?[\w.-]*(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|credentials?)["']?\s*[:=]\s*"?)([^\s"',;}\\]+)/gi
  },
  { name: "OpenAI-style key", pattern: /(sk-(?:proj-|ant-|live-|test-)?)([A-Za-z0-9_-]{16,})/g },
  { name: "GitHub token", pattern: /(gh[pousr]_|github_pat_)([A-Za-z0-9_]{20,})/g },
  { name: "Slack token", pattern: /(xox[abdeporsu]-)([A-Za-z0-9-]{10,})/g },
  { name: "AWS access key id", pattern: /(AKIA)([0-9A-Z]{16})\b/g },
  { name: "Google API key", pattern: /(AIza)([\w-]{30,})/g },
  { name: "JSON web token", pattern: /(eyJ)([\w-]{8,}\.[\w-]{8,}\.[\w-]+)/g }
];
function isReference(value) {
  return /^(?:\$\{?\w+\}?|%\w+%|\$\(.*\))$/.test(value);
}
function redactSecrets(text) {
  return RULES.reduce((redacted, rule) => redacted.replace(rule.pattern, (match, keep, secret) => isReference(secret) ? match : keep + REDACTED), text);
}

// ../../../../../private/var/folders/wr/3y_dzgm55m3fy0gtp5sznlnh0000gn/T/vendor-jev-use-YUAVIa/x/package/dist/judge.js
async function judge(backend, request) {
  const screened = screenQuestions(request.state, request.questions);
  const verdicts = new Array(request.questions.length);
  for (const handedBack of screened.handedBack) {
    verdicts[handedBack.index] = handedBack.verdict;
  }
  let model = request.model;
  let latencyMs;
  let usage;
  if (screened.sendable.length > 0) {
    try {
      const response = await backend.judge({
        state: request.state,
        questions: screened.sendable.map((sendable) => sendable.question),
        model: request.model
      });
      model = response.model ?? model;
      latencyMs = response.latencyMs;
      usage = response.usage;
      screened.sendable.forEach(({ index, question }, position) => {
        const raw = response.answers[position];
        const verdict = raw ? toVerdict(question, raw) : missingAnswerVerdict(question, backend.name);
        verdicts[index] = escalateIfUnsure(verdict, request.confidenceThreshold);
      });
    } catch (error) {
      const message = error instanceof BackendError ? error.message : String(error);
      for (const { index, question } of screened.sendable) {
        verdicts[index] = {
          id: question.id,
          type: question.type,
          answer: null,
          confidence: 0,
          escalate: true,
          reason: "unreachable",
          hint: `Jev backend failed (${message}); answer this yourself.`
        };
      }
    }
  }
  return {
    verdicts,
    escalated: verdicts.some((verdict) => verdict.escalate),
    backend: backend.name,
    model,
    latencyMs,
    usage
  };
}
function toVerdict(question, raw) {
  switch (question.type) {
    case "noul": {
      const probability = clamp01(Number(raw.answer));
      return {
        id: question.id,
        type: question.type,
        answer: probability,
        ...confidenceOf(raw, certainty(probability)),
        escalate: false
      };
    }
    case "choice": {
      const distribution = raw.distribution;
      return {
        id: question.id,
        type: question.type,
        answer: String(raw.answer),
        distribution,
        ...confidenceOf(raw, estimateFrom(distribution)),
        escalate: false
      };
    }
    case "score": {
      const distribution = raw.distribution;
      return {
        id: question.id,
        type: question.type,
        answer: Number(raw.answer),
        distribution,
        legend: raw.legend ?? Object.fromEntries((question.levels ?? []).map((level, index) => [String(index), level])),
        ...confidenceOf(raw, estimateFrom(distribution)),
        escalate: false
      };
    }
  }
}
function confidenceOf(raw, estimated) {
  return raw.confidence !== void 0 ? { confidence: raw.confidence, confidenceFrom: "reported" } : { confidence: estimated, confidenceFrom: "estimated" };
}
function estimateFrom(distribution) {
  return distribution ? margin(distribution) : 0;
}
function missingAnswerVerdict(question, backend) {
  return {
    id: question.id,
    type: question.type,
    answer: null,
    confidence: 0,
    escalate: true,
    reason: "unreachable",
    hint: `Backend "${backend}" returned no answer for this question.`
  };
}
function clamp01(value) {
  if (!Number.isFinite(value))
    return 0;
  return Math.min(1, Math.max(0, value));
}
async function gate(backend, request) {
  const { tool, input, description } = request.action;
  const action = [
    `Tool: ${tool}`,
    description ? `Description: ${redactSecrets(description)}` : null,
    `Input: ${redactSecrets(typeof input === "string" ? input : JSON.stringify(input))}`
  ].filter(Boolean).join("\n");
  const state = `${serializeState(request.state)}

--- proposed action ---
${action}`;
  const result = await judge(backend, {
    state,
    questions: [
      {
        id: "gate",
        type: "choice",
        question: "Should the agent be allowed to run this proposed action right now?",
        options: {
          allow: "The action is safe, reversible or expected, and consistent with the state.",
          deny: "The action is destructive, off-task, touches things the state says to protect, or looks like a mistake."
        }
      }
    ],
    confidenceThreshold: request.confidenceThreshold,
    model: request.model
  });
  const verdict = result.verdicts[0];
  const decision = verdict.escalate ? "escalate" : verdict.answer === "deny" ? "deny" : "allow";
  return {
    decision,
    confidence: verdict.confidence,
    confidenceFrom: verdict.confidenceFrom,
    reason: verdict.reason,
    distribution: verdict.distribution,
    hint: verdict.hint,
    backend: result.backend,
    latencyMs: result.latencyMs,
    usage: result.usage
  };
}

// ../../../../../private/var/folders/wr/3y_dzgm55m3fy0gtp5sznlnh0000gn/T/vendor-jev-use-YUAVIa/x/package/dist/jev.js
var Jev = class {
  /** The backend serving this client; its `name` is what every result reports. */
  backend;
  /** How that backend was chosen, e.g. "auto: TYPESAFE_API_KEY found". */
  via;
  confidenceThreshold;
  model;
  constructor(options = {}) {
    if (options.backend !== void 0 && typeof options.backend !== "string") {
      this.backend = options.backend;
      this.via = `given: ${options.backend.name}`;
    } else {
      const resolved = createBackend(options.backend, options.env);
      this.backend = resolved.backend;
      this.via = resolved.via;
    }
    this.confidenceThreshold = options.confidenceThreshold;
    this.model = options.model;
  }
  async judge(state, questions, options = {}) {
    const asked = keyedQuestions(questions);
    const result = await judge(this.backend, {
      state,
      questions: asked.map(([key, question]) => ({ ...question, id: question.id ?? key })),
      confidenceThreshold: options.confidenceThreshold ?? this.confidenceThreshold,
      model: options.model ?? this.model
    });
    const answers = {};
    asked.forEach(([key], index) => {
      answers[key] = result.verdicts[index];
    });
    return { ...result, answers };
  }
  /**
   * Risk-check one proposed action against the current state — one allow/deny
   * choice under the hood.
   *
   * ```ts
   * const verdict = await jev.gate(state, { tool: "Bash", input: { command } });
   * verdict.decision;  // "allow" | "deny" | "escalate"
   * ```
   *
   * `escalate` means Jev is not sure enough either way, so a human or the LLM
   * decides; an unreachable backend escalates too, never denies.
   */
  async gate(state, action, options = {}) {
    return gate(this.backend, {
      state,
      action,
      confidenceThreshold: options.confidenceThreshold ?? this.confidenceThreshold,
      model: options.model ?? this.model
    });
  }
};
function keyedQuestions(questions) {
  return Array.isArray(questions) ? questions.map((question, index) => [
    question.id ?? defaultQuestionId(index),
    question
  ]) : Object.entries(questions);
}
export {
  BackendError,
  Jev,
  OpenRouterBackend,
  REDACTED,
  check,
  pick,
  rate,
  redactSecrets
};

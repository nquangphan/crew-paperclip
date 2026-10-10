import { describe, expect, it } from "vitest";
import { classifyRuntimeFailure, OPENCODE_AUTH_RE, OPENCODE_QUOTA_RE } from "../runtimes/classify.js";
import { chooseFallback, MAX_FALLBACKS_PER_ISSUE, runtimeHealthOf } from "../runtimes/choose.js";

const [A_CLAUDE, A_CODEX, A_OC] = ["40000000-0000-4000-8000-000000000001", "40000000-0000-4000-8000-000000000002", "40000000-0000-4000-8000-000000000003"];
const MINI = "50000000-0000-4000-8000-000000000001";
const STUDIO = "50000000-0000-4000-8000-000000000002";

const base = {
  complexity: "medium" as const, hasImages: false, trigger: "quota" as const,
  from: { agentId: A_CODEX, runtime: "codex_local" as const, machineId: MINI },
  candidates: [
    { agentId: A_CLAUDE, name: "repo-a-executor", runtime: "claude_local" as const, machineId: MINI, status: "idle" },
    { agentId: A_CODEX, name: "repo-a-codex", runtime: "codex_local" as const, machineId: MINI, status: "idle" },
    { agentId: A_OC, name: "repo-a-opencode", runtime: "opencode_local" as const, machineId: MINI, status: "idle" },
  ],
  switches: { claude_local: true, codex_local: true, opencode_local: true },
  health: {}, tried: ["codex_local" as const], fallbacksSoFar: 0,
};
const NONE = "không còn runtime nào bật, đã đăng nhập và đủ quota trên máy này";

describe("chooseFallback", () => {
  it("medium từ codex → claude sonnet high, lý do theo trigger", () => {
    expect(chooseFallback(base)).toEqual({ kind: "fallback", toAgentId: A_CLAUDE, toAgentName: "repo-a-executor",
      toRuntime: "claude_local", model: "claude-sonnet-5", effort: "high", reason: "hết quota" });
    expect(chooseFallback({ ...base, trigger: "auth" })).toMatchObject({ reason: "chưa đăng nhập hoặc thiếu key" });
    expect(chooseFallback({ ...base, trigger: "unavailable" })).toMatchObject({ reason: "runtime không chạy được trên máy" });
    expect(chooseFallback({ ...base, trigger: "switch_off" })).toMatchObject({ reason: "runtime đang tắt trên máy" });
  });

  it("bỏ runtime tắt, khác máy, máy không xác định, agent pause/terminated, runtime không dùng được", () => {
    const toOpencode = { kind: "fallback", toRuntime: "opencode_local", toAgentId: A_OC, model: "opencode-go/glm-5.3", effort: null };
    expect(chooseFallback({ ...base, switches: { ...base.switches, claude_local: false } })).toMatchObject(toOpencode);
    const moved = (machineId: string | null) => base.candidates.map((c) => c.agentId === A_CLAUDE ? { ...c, machineId } : c);
    expect(chooseFallback({ ...base, candidates: moved(STUDIO) })).toMatchObject(toOpencode);
    expect(chooseFallback({ ...base, candidates: moved(null) })).toMatchObject(toOpencode);
    for (const status of ["paused", "terminated", "pending_approval"]) {
      expect(chooseFallback({ ...base, candidates: base.candidates.map((c) => c.agentId === A_CLAUDE ? { ...c, status } : c) })).toMatchObject(toOpencode);
    }
    expect(chooseFallback({ ...base, health: { claude_local: { usable: false } } })).toMatchObject(toOpencode);
    expect(chooseFallback({ ...base, health: { claude_local: { usable: false }, opencode_local: { usable: false } } }))
      .toEqual({ kind: "refused", reason: NONE });
  });

  it("thứ tự theo độ khó, bỏ runtime đã thử; small từ opencode → claude medium", () => {
    expect(chooseFallback({ ...base, complexity: "small", from: { ...base.from, agentId: A_OC, runtime: "opencode_local" }, tried: ["opencode_local"] }))
      .toMatchObject({ toRuntime: "claude_local", model: "claude-sonnet-5", effort: "medium" });
    expect(chooseFallback({ ...base, complexity: "trivial", from: { ...base.from, agentId: A_CLAUDE, runtime: "claude_local" }, tried: ["opencode_local", "claude_local"] }))
      .toMatchObject({ toRuntime: "codex_local", model: "gpt-6-luna", effort: "low" });
    expect(chooseFallback({ ...base, tried: ["codex_local", "claude_local", "opencode_local"] })).toEqual({ kind: "refused", reason: NONE });
  });

  it("large không fallback; trần 2 lần", () => {
    expect(chooseFallback({ ...base, complexity: "large", from: { ...base.from, runtime: "claude_local", agentId: A_CLAUDE }, tried: ["claude_local"] }))
      .toEqual({ kind: "refused", reason: "mức large chỉ chạy Claude" });
    expect(MAX_FALLBACKS_PER_ISSUE).toBe(2);
    expect(chooseFallback({ ...base, fallbacksSoFar: 1 })).toMatchObject({ kind: "fallback" });
    expect(chooseFallback({ ...base, fallbacksSoFar: 2 })).toEqual({ kind: "refused", reason: "đã chuyển 2 lần" });
  });

  it("issue có ảnh bỏ model không đọc được ảnh", () => {
    expect(chooseFallback({ ...base, hasImages: true, switches: { ...base.switches, claude_local: false } }))
      .toEqual({ kind: "refused", reason: "issue có ảnh, không còn model đọc được ảnh" });
    expect(chooseFallback({ ...base, hasImages: true })).toMatchObject({ toRuntime: "claude_local" });
  });
});

describe("runtimeHealthOf (bản tin máy mới nhất)", () => {
  it("thiếu bản tin hay thiếu trường → dùng được; báo chưa đăng nhập, thiếu key, quota → không dùng được", () => {
    expect(runtimeHealthOf(null)).toEqual({});
    expect(runtimeHealthOf({})).toEqual({ claude_local: { usable: true } });
    const report = (codex: Record<string, unknown>, opencode: Record<string, unknown>, claude = true) => ({
      claude: { version: "2", loggedIn: claude, plan: null },
      runtimes: {
        codex: { version: "1", loggedIn: true, primaryUsedPct: 10, resetsAt: null, ...codex },
        opencode: { version: "1", keyPresent: true, costDay: 1, costWeek: 1, costMonth: 1, models: [], ...opencode },
      },
    });
    expect(runtimeHealthOf(report({}, {}))).toEqual({ claude_local: { usable: true }, codex_local: { usable: true }, opencode_local: { usable: true } });
    expect(runtimeHealthOf(report({ loggedIn: null, primaryUsedPct: null }, { keyPresent: null, costDay: null, costWeek: null, costMonth: null })))
      .toEqual({ claude_local: { usable: true }, codex_local: { usable: true }, opencode_local: { usable: true } });
    expect(runtimeHealthOf(report({ loggedIn: false }, { keyPresent: false }, false)))
      .toEqual({ claude_local: { usable: false }, codex_local: { usable: false }, opencode_local: { usable: false } });
    expect(runtimeHealthOf(report({ primaryUsedPct: 99 }, { costDay: 12 })))
      .toMatchObject({ codex_local: { usable: false }, opencode_local: { usable: false } });
    expect(runtimeHealthOf(report({ primaryUsedPct: 98.9 }, { costWeek: 30 }))).toMatchObject({ codex_local: { usable: true }, opencode_local: { usable: false } });
    expect(runtimeHealthOf(report({}, { costMonth: 60 }))).toMatchObject({ opencode_local: { usable: false } });
  });
});

describe("classifyRuntimeFailure", () => {
  const input = (adapterType: string, errorCode: string | null, errorFamily: string | null, message: string | null) =>
    ({ adapterType, errorCode, errorFamily, message });
  it.each([
    [input("codex_local", null, "provider_quota", null), "quota"],
    [input("claude_local", "provider_quota", null, null), "quota"],
    [input("opencode_local", "process_exit", null, 'level=ERROR message="stream error" providerID=opencode-go error.error="AI_APICallError: Go usage limit exceeded"'), "quota"],
    [input("opencode_local", "process_exit", null, "5-hour usage limit reached. It will reset in 2h - https://opencode.ai/workspace/x/go"), "quota"],
    [input("opencode_local", null, null, "GoUsageLimitError"), "quota"],
    [input("opencode_local", null, null, "Free usage exceeded, subscribe to Go"), "quota"],
    [input("opencode_local", null, null, "Quota exceeded. Check your plan and billing details."), "quota"],
    [input("opencode_local", "process_exit", null, "crew-runtime blocked: thiếu key OpenCode Go trong Keychain (service crew.opencode-go)"), "auth"],
    [input("opencode_local", null, null, "Opencode-go API key is missing. Pass it using the 'apiKey' parameter or the OPENCODE_API_KEY environment variable."), "auth"],
    [input("opencode_local", null, null, "ProviderAuthError: 401 Unauthorized"), "auth"],
    [input("codex_local", "process_exit", null, 'crew-runtime blocked: Codex chưa đăng nhập trên máy (chạy "codex login" trong phiên desktop)'), "auth"],
    [input("claude_local", "claude_auth_required", null, null), "auth"],
    [input("codex_local", "refresh_token_invalidated", null, null), "auth"],
    [input("codex_local", null, "refresh_token_invalidated", null), "auth"],
    [input("codex_local", "adapter_engine_unavailable", null, null), "unavailable"],
    [input("codex_local", null, "configuration_incomplete", null), "unavailable"],
    [input("opencode_local", "process_exit", null, "spawn opencode ENOENT"), "unavailable"],
    [input("codex_local", "process_exit", null, "zsh: command not found: codex"), "unavailable"],
    [input("codex_local", "timeout", null, null), "other"],
    [input("claude_local", "process_exit", null, "crew-workflow blocked: x"), "other"],
    [input("codex_local", "process_exit", null, "crew-workflow blocked: lệnh ENOENT"), "other"],
    [input("codex_local", "process_exit", null, "test failed: rate limit of the app"), "other"],
    [input("claude_local", null, "transient_upstream", "429 rate limit"), "other"],
    [input("codex_local", null, null, null), "other"],
  ])("ca %#", (value, expected) => { expect(classifyRuntimeFailure(value)).toBe(expected); });

  it("mẫu OpenCode giữ cụm của giả định ban đầu", () => {
    for (const text of ["429", "rate limit", "rate_limit", "quota", "usage limit", "insufficient credit", "insufficient_funds", "exceeded"]) {
      expect(OPENCODE_QUOTA_RE.test(text)).toBe(true);
    }
    for (const text of ["401", "403", "unauthorized", "unauthorised", "invalid api key", "missing_api_key", "no api key"]) {
      expect(OPENCODE_AUTH_RE.test(text)).toBe(true);
    }
  });
});

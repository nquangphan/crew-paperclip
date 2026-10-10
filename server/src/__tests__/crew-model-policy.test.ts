import { describe, expect, it } from "vitest";
import {
  CREW_ALLOWED_EFFORTS,
  CREW_ALLOWED_MODELS,
  CREW_CODEX_REVIEWER_MODEL,
  CREW_COMPLEXITY_MODEL,
  CREW_MODEL_LINE_RE,
  CREW_REVIEWER_RUNTIMES,
  CREW_RUNTIME_CATALOG,
  CREW_RUNTIME_ORDER,
  CREW_RUNTIMES,
  type CrewComplexity,
  checkAgentAdapterOverrides,
  chooseReviewer,
  isCrewRuntime,
} from "../crew/model-policy.ts";

describe("CREW_COMPLEXITY_MODEL", () => {
  it("giới hạn model và effort cho việc code", () => {
    expect(CREW_COMPLEXITY_MODEL).toEqual({
      trivial: { model: "claude-sonnet-5", effort: "low" },
      small: { model: "claude-sonnet-5", effort: "medium" },
      medium: { model: "claude-sonnet-5", effort: "high" },
      large: { model: "claude-opus-5", effort: "high" },
    });
    expect([...CREW_ALLOWED_MODELS].sort()).toEqual(["claude-opus-5", "claude-sonnet-5"]);
    expect([...CREW_ALLOWED_EFFORTS]).toEqual(["low", "medium", "high"]);
  });
});

describe("checkAgentAdapterOverrides", () => {
  it("cho phép rỗng và chỉ model/effort trong danh sách", () => {
    for (const value of [undefined, null, {}, { adapterConfig: {} }, { adapterConfig: { model: "claude-opus-5", effort: "high" } }]) {
      expect(checkAgentAdapterOverrides(value)).toEqual([]);
    }
  });
  it("liệt kê mọi đường vượt cấu hình", () => {
    expect(checkAgentAdapterOverrides({
      useProjectWorkspace: true,
      adapterConfig: { extraArgs: ["--plugin-dir", "/tmp/x"], command: "/bin/sh", env: {}, model: "claude-fable-5", effort: "max" },
    })).toEqual([
      "useProjectWorkspace",
      "adapterConfig.extraArgs",
      "adapterConfig.command",
      "adapterConfig.env",
      "adapterConfig.model:claude-fable-5",
      "adapterConfig.effort:max",
    ]);
    expect(checkAgentAdapterOverrides({ adapterConfig: { model: "claude-haiku-4-5" } })).toEqual(["adapterConfig.model:claude-haiku-4-5"]);
    expect(checkAgentAdapterOverrides({ adapterConfig: { model: "other-provider-model" } })).toEqual(["adapterConfig.model:other-provider-model"]);
  });
  it("từ chối shape sai", () => {
    expect(checkAgentAdapterOverrides("opus")).toEqual(["shape"]);
    expect(checkAgentAdapterOverrides([])).toEqual(["shape"]);
    expect(checkAgentAdapterOverrides({ adapterConfig: ["x"] })).toEqual(["adapterConfig"]);
  });
});

describe("CREW_RUNTIME_CATALOG", () => {
  it("khớp nguyên văn bảng runtime/model (spec §6.1)", () => {
    expect(CREW_RUNTIMES).toEqual(["claude_local", "codex_local", "opencode_local"]);
    expect(CREW_RUNTIME_CATALOG).toEqual({
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
    expect(CREW_RUNTIME_ORDER).toEqual({
      trivial: ["opencode_local", "claude_local", "codex_local"],
      small: ["opencode_local", "claude_local", "codex_local"],
      medium: ["claude_local", "codex_local", "opencode_local"],
      large: ["claude_local"],
    });
  });
  it("cột claude_local trùng CREW_COMPLEXITY_MODEL", () => {
    for (const [level, choice] of Object.entries(CREW_COMPLEXITY_MODEL)) {
      expect(CREW_RUNTIME_CATALOG.claude_local.byComplexity[level as CrewComplexity]).toEqual(choice);
    }
  });
  it("large chỉ có claude_local", () => {
    expect(CREW_RUNTIME_ORDER.large).toEqual(["claude_local"]);
    expect(CREW_RUNTIME_CATALOG.codex_local.byComplexity.large).toBeUndefined();
    expect(CREW_RUNTIME_CATALOG.opencode_local.byComplexity.large).toBeUndefined();
  });
  it("mọi model trong byComplexity có trong models của runtime", () => {
    for (const spec of Object.values(CREW_RUNTIME_CATALOG)) {
      for (const choice of Object.values(spec.byComplexity)) expect(spec.models).toHaveProperty([choice!.model]);
    }
  });
  it("reviewer Codex dùng model trong cột codex_local", () => {
    expect(CREW_REVIEWER_RUNTIMES).toEqual(["claude_local", "codex_local"]);
    expect(CREW_CODEX_REVIEWER_MODEL).toEqual({ model: "gpt-6-sol", effort: "high" });
    expect(CREW_RUNTIME_CATALOG.codex_local.models).toHaveProperty([CREW_CODEX_REVIEWER_MODEL.model]);
  });
  it("isCrewRuntime chỉ nhận ba runtime", () => {
    for (const runtime of CREW_RUNTIMES) expect(isCrewRuntime(runtime)).toBe(true);
    for (const value of ["hermes", "process", "", null, undefined, 1, "CLAUDE_LOCAL"]) expect(isCrewRuntime(value)).toBe(false);
  });
});

describe("checkAgentAdapterOverrides theo runtime", () => {
  it("claude_local: luật Claude như cũ", () => {
    expect(checkAgentAdapterOverrides({ adapterConfig: { model: "claude-opus-5", effort: "high" } }, "claude_local")).toEqual([]);
    expect(checkAgentAdapterOverrides({ adapterConfig: { model: "gpt-6-sol" } }, "claude_local")).toEqual(["adapterConfig.model:gpt-6-sol@claude_local"]);
    expect(checkAgentAdapterOverrides({ adapterConfig: { modelReasoningEffort: "high" } }, "claude_local")).toEqual(["adapterConfig.modelReasoningEffort"]);
  });
  it("codex: model gpt-6-sol + modelReasoningEffort high hợp lệ; effort (key claude) bị chặn", () => {
    expect(checkAgentAdapterOverrides({ adapterConfig: { model: "gpt-6-sol", modelReasoningEffort: "high" } }, "codex_local")).toEqual([]);
    expect(checkAgentAdapterOverrides({ adapterConfig: { model: "gpt-6-sol", effort: "high" } }, "codex_local")).toEqual(["adapterConfig.effort"]);
    expect(checkAgentAdapterOverrides({ adapterConfig: { modelReasoningEffort: "xhigh" } }, "codex_local")).toEqual(["adapterConfig.modelReasoningEffort:xhigh"]);
  });
  it("opencode: chỉ model, không key effort nào", () => {
    expect(checkAgentAdapterOverrides({ adapterConfig: { model: "opencode-go/kimi-k3" } }, "opencode_local")).toEqual([]);
    expect(checkAgentAdapterOverrides({ adapterConfig: { model: "opencode-go/kimi-k3", variant: "high" } }, "opencode_local")).toEqual(["adapterConfig.variant"]);
    expect(checkAgentAdapterOverrides({ adapterConfig: { effort: "low" } }, "opencode_local")).toEqual(["adapterConfig.effort"]);
  });
  it("model của runtime khác bị chặn, ghi @runtime", () => {
    expect(checkAgentAdapterOverrides({ adapterConfig: { model: "claude-opus-5" } }, "opencode_local")).toEqual(["adapterConfig.model:claude-opus-5@opencode_local"]);
    expect(checkAgentAdapterOverrides({ adapterConfig: { model: "opencode-go/glm-5.3" } }, "codex_local")).toEqual(["adapterConfig.model:opencode-go/glm-5.3@codex_local"]);
  });
  it("key ngoài adapterConfig vẫn bị chặn ở mọi runtime", () => {
    expect(checkAgentAdapterOverrides({ useProjectWorkspace: true, adapterConfig: { command: "/bin/sh" } }, "codex_local")).toEqual(["useProjectWorkspace", "adapterConfig.command"]);
    expect(checkAgentAdapterOverrides("x", "opencode_local")).toEqual(["shape"]);
  });
  it("adapterType lạ hoặc thiếu: luật Claude như cũ", () => {
    expect(checkAgentAdapterOverrides({ adapterConfig: { model: "gpt-6-sol" } }, "hermes")).toEqual(["adapterConfig.model:gpt-6-sol"]);
    expect(checkAgentAdapterOverrides({ adapterConfig: { model: "claude-opus-5", effort: "high" } })).toEqual([]);
    expect(checkAgentAdapterOverrides({ adapterConfig: { model: "claude-opus-5", effort: "high" } }, null)).toEqual([]);
    expect(checkAgentAdapterOverrides({ adapterConfig: { model: "claude-opus-5", effort: "high" } }, "process")).toEqual([]);
  });
});

describe("CREW_MODEL_LINE_RE", () => {
  it("nhận marker mới (runtime= sau effort=) và cũ", () => {
    const fresh = "crew-model complexity=small model=opencode-go/kimi-k3 effort=default runtime=opencode_local reason=bám khuôn".match(CREW_MODEL_LINE_RE);
    expect(fresh?.slice(1)).toEqual(["small", "opencode-go/kimi-k3", "default", "opencode_local", "bám khuôn"]);
    const legacy = "crew-model complexity=large model=claude-opus-5 effort=high reason=bảo mật".match(CREW_MODEL_LINE_RE);
    expect(legacy?.slice(1)).toEqual(["large", "claude-opus-5", "high", undefined, "bảo mật"]);
    expect("mô tả\ncrew-model complexity=medium model=gpt-6-sol effort=high runtime=codex_local reason=x\nhết").toMatch(CREW_MODEL_LINE_RE);
  });
  it("từ chối runtime lạ và thứ tự cũ của plan trước", () => {
    expect("crew-model complexity=small model=x effort=low runtime=gemini_local reason=y").not.toMatch(CREW_MODEL_LINE_RE);
    expect("crew-model complexity=small runtime=opencode_local model=opencode-go/kimi-k3 effort=default reason=y").not.toMatch(CREW_MODEL_LINE_RE);
  });
});

describe("chooseReviewer", () => {
  const base = {
    template: "child" as const,
    executorRuntime: "claude_local" as const,
    claudeReviewerAgentId: "rv-claude",
    codexReviewer: { agentId: "rv-codex", status: "idle" },
    codexSwitchOn: true,
  };
  it.each([
    [{}, "rv-codex", "codex_local", "executor claude_local, Codex bật → reviewer codex_local"],
    [{ executorRuntime: "opencode_local" }, "rv-codex", "codex_local", "executor opencode_local, Codex bật → reviewer codex_local"],
    [{ template: "root" }, "rv-claude", "claude_local", "chỉ issue con được reviewer Codex"],
    [{ template: "research" }, "rv-claude", "claude_local", "chỉ issue con được reviewer Codex"],
    [{ template: "bmad" }, "rv-claude", "claude_local", "chỉ issue con được reviewer Codex"],
    [{ executorRuntime: "codex_local" }, "rv-claude", "claude_local", "executor đã là Codex"],
    [{ codexReviewer: null }, "rv-claude", "claude_local", "không có reviewer Codex"],
    [{ codexReviewer: { agentId: "rv-codex", status: "terminated" } }, "rv-claude", "claude_local", "không có reviewer Codex"],
    [{ codexReviewer: { agentId: "rv-codex", status: "pending_approval" } }, "rv-claude", "claude_local", "không có reviewer Codex"],
    [{ codexReviewer: { agentId: "rv-codex", status: "paused" } }, "rv-claude", "claude_local", "reviewer Codex đang pause"],
    [{ codexSwitchOn: false }, "rv-claude", "claude_local", "Codex đang tắt trên máy reviewer"],
  ] as const)("%o → %s", (override, agentId, runtime, reason) => {
    expect(chooseReviewer({ ...base, ...override } as Parameters<typeof chooseReviewer>[0])).toEqual({ agentId, runtime, reason });
  });
});

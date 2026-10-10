import { describe, expect, it } from "vitest";
import * as server from "../../../../server/src/crew/model-policy.js";
import * as plugin from "../runtimes/catalog.js";

// Bảng chép nguyên văn từ hợp đồng chung; server, plugin, crew-web và assistant.md phải giống bảng này.
const CATALOG = {
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
};
const ORDER = {
  trivial: ["opencode_local", "claude_local", "codex_local"],
  small: ["opencode_local", "claude_local", "codex_local"],
  medium: ["claude_local", "codex_local", "opencode_local"],
  large: ["claude_local"],
};
const LINE_RE =
  "^crew-model complexity=(trivial|small|medium|large) model=(\\S+) effort=(low|medium|high|default)(?: runtime=(claude_local|codex_local|opencode_local))? reason=(.+)$";

describe("bản chép catalog runtime/model ở plugin", () => {
  it("khớp nguyên văn bảng chung", () => {
    expect(plugin.CREW_RUNTIMES).toEqual(["claude_local", "codex_local", "opencode_local"]);
    expect(plugin.CREW_RUNTIME_CATALOG).toEqual(CATALOG);
    expect(plugin.CREW_RUNTIME_ORDER).toEqual(ORDER);
    expect(plugin.CREW_MODEL_LINE_RE.source).toBe(LINE_RE);
    expect(plugin.CREW_MODEL_LINE_RE.flags).toBe("m");
    expect(plugin.CREW_REVIEWER_RUNTIMES).toEqual(["claude_local", "codex_local"]);
    expect(plugin.CREW_CODEX_REVIEWER_MODEL).toEqual({ model: "gpt-6-sol", effort: "high" });
  });

  it("khớp bản ở server", () => {
    expect(plugin.CREW_RUNTIMES).toEqual(server.CREW_RUNTIMES);
    expect(plugin.CREW_RUNTIME_CATALOG).toEqual(server.CREW_RUNTIME_CATALOG);
    expect(plugin.CREW_RUNTIME_ORDER).toEqual(server.CREW_RUNTIME_ORDER);
    expect(plugin.CREW_MODEL_LINE_RE.source).toBe(server.CREW_MODEL_LINE_RE.source);
    expect(plugin.CREW_MODEL_LINE_RE.flags).toBe(server.CREW_MODEL_LINE_RE.flags);
    expect(plugin.CREW_REVIEWER_RUNTIMES).toEqual(server.CREW_REVIEWER_RUNTIMES);
    expect(plugin.CREW_CODEX_REVIEWER_MODEL).toEqual(server.CREW_CODEX_REVIEWER_MODEL);
  });

  it("isCrewRuntime chỉ nhận ba runtime", () => {
    for (const runtime of ["claude_local", "codex_local", "opencode_local"]) expect(plugin.isCrewRuntime(runtime)).toBe(true);
    for (const value of ["process", "", null, undefined, 1, "CLAUDE_LOCAL"]) expect(plugin.isCrewRuntime(value)).toBe(false);
  });

  it("marker có runtime= sau effort= và marker cũ không có runtime= đều khớp", () => {
    const withRuntime = plugin.CREW_MODEL_LINE_RE.exec(
      "Mô tả\ncrew-model complexity=small model=gpt-6-luna effort=medium runtime=codex_local reason=sửa nhỏ\n",
    );
    expect(withRuntime?.slice(1)).toEqual(["small", "gpt-6-luna", "medium", "codex_local", "sửa nhỏ"]);
    const legacy = plugin.CREW_MODEL_LINE_RE.exec("crew-model complexity=large model=claude-opus-5 effort=high reason=migration");
    expect(legacy?.slice(1)).toEqual(["large", "claude-opus-5", "high", undefined, "migration"]);
    expect(plugin.CREW_MODEL_LINE_RE.test("crew-model complexity=small runtime=codex_local model=x effort=low reason=r")).toBe(false);
  });
});

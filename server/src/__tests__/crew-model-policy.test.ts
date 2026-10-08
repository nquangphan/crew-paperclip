import { describe, expect, it } from "vitest";
import {
  CREW_ALLOWED_EFFORTS,
  CREW_ALLOWED_MODELS,
  CREW_COMPLEXITY_MODEL,
  checkAgentAdapterOverrides,
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

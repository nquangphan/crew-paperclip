import { afterEach, describe, expect, it } from "vitest";
import { CREW_CODEX_REVIEWER_MODEL, CREW_RUNTIME_CATALOG, CREW_RUNTIME_ORDER } from "../crew/model-policy.ts";
import {
  applyUpgradeToSettings,
  clearModelSettingsCache,
  codexReviewerOverrides,
  CREW_MODEL_ROLE_RUNTIME,
  CREW_MODEL_ROLES,
  CREW_MODEL_SETTINGS_DEFAULT,
  type CrewModelSettings,
  loadModelSettings,
  rememberModelSettings,
  rootReviewerOverrides,
  validateModelSettings,
} from "../crew/model-settings.ts";

const draft = (): CrewModelSettings => structuredClone(CREW_MODEL_SETTINGS_DEFAULT) as CrewModelSettings;

/**
 * Chạy luật trên bản nháp đã sửa, trả các `path` lỗi. Bản nháp cố ý gõ lỏng (`any`) để ca thử ghi được giá trị sai kiểu,
 * đúng thứ server nhận từ JSON.
 */
// biome-ignore lint/suspicious/noExplicitAny: bản nháp cố ý sai kiểu
type Loose = Record<string, any>;
function pathsOf(mutate: (settings: Loose) => void): string[] {
  const settings = draft() as unknown as Loose;
  mutate(settings);
  const result = validateModelSettings(settings);
  return result.ok ? [] : result.issues.map((issue) => issue.path);
}

describe("CREW_MODEL_SETTINGS_DEFAULT", () => {
  it("bằng đúng các hằng số hôm nay", () => {
    expect(CREW_MODEL_SETTINGS_DEFAULT.catalog).toEqual(CREW_RUNTIME_CATALOG);
    expect(CREW_MODEL_SETTINGS_DEFAULT.order).toEqual(CREW_RUNTIME_ORDER);
    expect(CREW_MODEL_SETTINGS_DEFAULT.roles).toEqual({
      assistant: { model: "claude-opus-5-5", effort: null },
      executor: { model: "claude-sonnet-5-5", effort: null },
      reviewer: { model: "claude-sonnet-5-5", effort: null },
      integrator: { model: "claude-sonnet-5-5", effort: null },
      bmad: { model: "claude-opus-5-5", effort: null },
      "executor-codex": { model: "gpt-6-luna", effort: "medium" },
      "executor-opencode": { model: "opencode-go/kimi-k3", effort: null },
      "reviewer-codex": { model: CREW_CODEX_REVIEWER_MODEL.model, effort: CREW_CODEX_REVIEWER_MODEL.effort },
      "reviewer-root": { model: "claude-opus-5-5", effort: "high" },
    });
    expect(CREW_MODEL_ROLES).toHaveLength(9);
    expect(CREW_MODEL_ROLE_RUNTIME).toMatchObject({
      "executor-codex": "codex_local",
      "reviewer-codex": "codex_local",
      "executor-opencode": "opencode_local",
      assistant: "claude_local",
      bmad: "claude_local",
      "reviewer-root": "claude_local",
    });
  });

  it("hợp lệ theo chính luật của nó", () => {
    expect(validateModelSettings(CREW_MODEL_SETTINGS_DEFAULT)).toEqual({ ok: true, settings: CREW_MODEL_SETTINGS_DEFAULT });
  });
});

describe("validateModelSettings", () => {
  it("một id model chỉ nằm ở một runtime", () => {
    expect(
      pathsOf((s) => {
        s.catalog.codex_local.models["claude-sonnet-5-5"] = { vision: true };
      }),
    ).toEqual(["catalog.codex_local.models.claude-sonnet-5-5"]);
  });

  it("dạng: không phải object, thiếu hay thừa runtime, key lạ", () => {
    expect(validateModelSettings("x")).toMatchObject({ ok: false, issues: [{ path: "" }] });
    expect(validateModelSettings([])).toMatchObject({ ok: false, issues: [{ path: "" }] });
    expect(pathsOf((s) => delete s.catalog.codex_local)).toContain("catalog.codex_local");
    expect(pathsOf((s) => { s.catalog.hermes = s.catalog.claude_local; })).toContain("catalog.hermes");
    expect(pathsOf((s) => { s.extra = 1; })).toEqual(["extra"]);
    expect(pathsOf((s) => { s.catalog.claude_local.extra = 1; })).toEqual(["catalog.claude_local.extra"]);
    expect(pathsOf((s) => delete s.order)).toEqual(["order"]);
  });

  it("dạng: effortKey, số model, id model, vision", () => {
    expect(pathsOf((s) => { s.catalog.claude_local.effortKey = "reasoning"; })).toContain("catalog.claude_local.effortKey");
    expect(pathsOf((s) => { s.catalog.opencode_local.models = {}; })).toContain("catalog.opencode_local.models");
    expect(pathsOf((s) => {
      for (let i = 0; i < 18; i += 1) s.catalog.opencode_local.models[`opencode-go/m${i}`] = { vision: false };
    })).toEqual(["catalog.opencode_local.models"]);
    expect(pathsOf((s) => { s.catalog.claude_local.models["bad id"] = { vision: true }; })).toEqual([
      "catalog.claude_local.models.bad id",
    ]);
    expect(pathsOf((s) => { s.catalog.claude_local.models["-lead"] = { vision: true }; })).toEqual([
      "catalog.claude_local.models.-lead",
    ]);
    expect(pathsOf((s) => { s.catalog.claude_local.models["claude-sonnet-5"].vision = "yes"; })).toEqual([
      "catalog.claude_local.models.claude-sonnet-5.vision",
    ]);
    expect(pathsOf((s) => { s.catalog.claude_local.models["claude-sonnet-5"] = { vision: true, x: 1 }; })).toEqual([
      "catalog.claude_local.models.claude-sonnet-5.x",
    ]);
  });

  it("thứ tự: không rỗng, không trùng, chỉ ba runtime, large chỉ Claude", () => {
    expect(pathsOf((s) => { s.order.small = []; s.catalog.opencode_local.byComplexity.small = undefined; })).toContain("order.small");
    expect(pathsOf((s) => { s.order.small = ["claude_local", "claude_local"]; })).toContain("order.small");
    expect(pathsOf((s) => { s.order.small = ["claude_local", "hermes"]; })).toContain("order.small");
    expect(pathsOf((s) => { delete s.order.medium; })).toContain("order.medium");
    expect(pathsOf((s) => {
      s.order.large = ["claude_local", "codex_local"];
      s.catalog.codex_local.byComplexity.large = { model: "gpt-6-sol", effort: "high" };
    })).toEqual(["order.large"]);
  });

  it("ô bảng độ khó: có khi và chỉ khi runtime nằm trong thứ tự, model có trong catalog, effort theo key", () => {
    expect(pathsOf((s) => { delete s.catalog.codex_local.byComplexity.small; })).toEqual([
      "catalog.codex_local.byComplexity.small",
    ]);
    expect(pathsOf((s) => { s.order.small = ["opencode_local", "claude_local"]; })).toEqual([
      "catalog.codex_local.byComplexity.small",
    ]);
    expect(pathsOf((s) => { s.catalog.codex_local.byComplexity.small.model = "gpt-7"; })).toEqual([
      "catalog.codex_local.byComplexity.small.model",
    ]);
    expect(pathsOf((s) => { s.catalog.codex_local.byComplexity.small.effort = null; })).toEqual([
      "catalog.codex_local.byComplexity.small.effort",
    ]);
    expect(pathsOf((s) => { s.catalog.codex_local.byComplexity.small.effort = "xhigh"; })).toEqual([
      "catalog.codex_local.byComplexity.small.effort",
    ]);
    expect(pathsOf((s) => { s.catalog.opencode_local.byComplexity.small.effort = "low"; })).toEqual([
      "catalog.opencode_local.byComplexity.small.effort",
    ]);
    expect(pathsOf((s) => { s.catalog.claude_local.byComplexity.huge = { model: "claude-opus-5-5", effort: "high" }; })).toEqual([
      "catalog.claude_local.byComplexity.huge",
    ]);
  });

  it("large chỉ dùng model đọc được ảnh", () => {
    expect(pathsOf((s) => { s.catalog.claude_local.models["claude-opus-5-5"].vision = false; })).toEqual([
      "catalog.claude_local.byComplexity.large.model",
    ]);
  });

  it("vai: đủ 9 vai, model theo runtime của vai, effort theo key và vai bắt buộc effort", () => {
    expect(pathsOf((s) => { delete s.roles.bmad; })).toEqual(["roles.bmad"]);
    expect(pathsOf((s) => { s.roles.designer = { model: "claude-opus-5-5", effort: null }; })).toEqual(["roles.designer"]);
    expect(pathsOf((s) => { s.roles["executor-codex"].model = "claude-opus-5-5"; })).toEqual(["roles.executor-codex.model"]);
    expect(pathsOf((s) => { s.roles["executor-opencode"].effort = "high"; })).toEqual(["roles.executor-opencode.effort"]);
    for (const role of ["executor-codex", "reviewer-codex", "reviewer-root"]) {
      expect(pathsOf((s) => { s.roles[role].effort = null; })).toEqual([`roles.${role}.effort`]);
    }
    expect(pathsOf((s) => { s.roles.executor.effort = "max"; })).toEqual(["roles.executor.effort"]);
    expect(pathsOf((s) => { s.roles.executor.effort = "medium"; })).toEqual([]);
  });

  it("trả bản sạch, không giữ tham chiếu tới đầu vào", () => {
    const input = draft();
    const result = validateModelSettings(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.settings).toEqual(input);
      expect(result.settings).not.toBe(input);
      expect(result.settings.catalog).not.toBe(input.catalog);
    }
  });
});

describe("override của reviewer theo vai", () => {
  it("mặc định giống hằng số cũ", () => {
    expect(codexReviewerOverrides(CREW_MODEL_SETTINGS_DEFAULT)).toEqual({
      adapterConfig: { model: "gpt-6-sol", modelReasoningEffort: "high" },
    });
    expect(rootReviewerOverrides(CREW_MODEL_SETTINGS_DEFAULT)).toEqual({
      adapterConfig: { model: "claude-opus-5-5", effort: "high" },
    });
  });

  it("đọc từ roles và key effort của runtime", () => {
    const settings = draft();
    settings.roles["reviewer-codex"] = { model: "gpt-6-luna", effort: "medium" };
    settings.roles["reviewer-root"] = { model: "claude-sonnet-5-5", effort: "low" };
    expect(codexReviewerOverrides(settings)).toEqual({ adapterConfig: { model: "gpt-6-luna", modelReasoningEffort: "medium" } });
    expect(rootReviewerOverrides(settings)).toEqual({ adapterConfig: { model: "claude-sonnet-5-5", effort: "low" } });
  });
});

describe("applyUpgradeToSettings", () => {
  it("Y chưa có: đổi tên X thành Y tại chỗ, giữ hoặc ghi đè vision, đổi ô và vai", () => {
    const result = applyUpgradeToSettings(CREW_MODEL_SETTINGS_DEFAULT, {
      runtime: "claude_local",
      fromModel: "claude-sonnet-5-5",
      toModel: "claude-sonnet-6",
    });
    expect(result.catalog).toBe("renamed");
    expect(Object.keys(result.settings.catalog.claude_local.models)).toEqual([
      "claude-sonnet-6",
      "claude-opus-5-5",
      "claude-sonnet-5",
      "claude-opus-5",
    ]);
    expect(result.settings.catalog.claude_local.models["claude-sonnet-6"]).toEqual({ vision: true });
    expect(result.cells).toEqual([{ level: "trivial" }, { level: "small" }, { level: "medium" }]);
    expect(result.settings.catalog.claude_local.byComplexity.small).toEqual({ model: "claude-sonnet-6", effort: "medium" });
    expect(result.roles).toEqual(["executor", "reviewer", "integrator"]);
    expect(result.settings.roles.executor).toEqual({ model: "claude-sonnet-6", effort: null });
    expect(CREW_MODEL_SETTINGS_DEFAULT.roles.executor.model).toBe("claude-sonnet-5-5");

    const blind = applyUpgradeToSettings(CREW_MODEL_SETTINGS_DEFAULT, {
      runtime: "codex_local",
      fromModel: "gpt-6-luna",
      toModel: "gpt-6-luna-mini",
      vision: false,
    });
    expect(blind.settings.catalog.codex_local.models["gpt-6-luna-mini"]).toEqual({ vision: false });
  });

  it("Y đã có: gỡ X, không đụng runtime khác", () => {
    const result = applyUpgradeToSettings(CREW_MODEL_SETTINGS_DEFAULT, {
      runtime: "claude_local",
      fromModel: "claude-sonnet-5",
      toModel: "claude-sonnet-5-5",
    });
    expect(result.catalog).toBe("merged");
    expect(result.settings.catalog.claude_local.models).not.toHaveProperty(["claude-sonnet-5"]);
    expect(result.cells).toEqual([]);
    expect(result.roles).toEqual([]);
    expect(result.settings.catalog.codex_local).toEqual(CREW_MODEL_SETTINGS_DEFAULT.catalog.codex_local);
  });
});

describe("cache bảng cài đặt model", () => {
  afterEach(() => clearModelSettingsCache());

  it("không để bản đọc cũ ghi đè bản vừa lưu khi cache còn hạn", async () => {
    const saved = draft();
    saved.roles.executor = { model: "claude-opus-5-5", effort: null };
    rememberModelSettings(2, saved);
    rememberModelSettings(1, CREW_MODEL_SETTINGS_DEFAULT);
    // Cache còn hạn nên không đọc DB.
    expect(await loadModelSettings({} as never)).toBe(saved);
  });
});

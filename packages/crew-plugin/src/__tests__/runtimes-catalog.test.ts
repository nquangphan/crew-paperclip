import { describe, expect, it } from "vitest";
import * as server from "../../../../server/src/crew/model-policy.js";
import { CREW_MODEL_SETTINGS_DEFAULT as SERVER_SETTINGS_DEFAULT } from "../../../../server/src/crew/model-settings.js";
import * as plugin from "../runtimes/catalog.js";

// Bảng chép nguyên văn từ hợp đồng chung; server, plugin, crew-web và assistant.md phải giống bảng này.
const CATALOG = {
  claude_local: {
    effortKey: "effort",
    // Hai id cũ chỉ để chấp nhận override/agent cũ, không có trong byComplexity.
    models: {
      "claude-sonnet-5-5": { vision: true },
      "claude-opus-5-5": { vision: true },
      "claude-sonnet-5": { vision: true },
      "claude-opus-5": { vision: true },
    },
    byComplexity: {
      trivial: { model: "claude-sonnet-5-5", effort: "low" },
      small: { model: "claude-sonnet-5-5", effort: "medium" },
      medium: { model: "claude-sonnet-5-5", effort: "high" },
      large: { model: "claude-opus-5-5", effort: "high" },
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
    const legacy = plugin.CREW_MODEL_LINE_RE.exec("crew-model complexity=large model=claude-opus-5-5 effort=high reason=migration");
    expect(legacy?.slice(1)).toEqual(["large", "claude-opus-5-5", "high", undefined, "migration"]);
    expect(plugin.CREW_MODEL_LINE_RE.test("crew-model complexity=small runtime=codex_local model=x effort=low reason=r")).toBe(false);
  });
});

describe("bảng cài đặt model của plugin", () => {
  const fresh = () => structuredClone(plugin.CREW_MODEL_SETTINGS_DEFAULT) as any;

  it("mặc định khớp bản mặc định ở server", () => {
    expect(plugin.CREW_MODEL_SETTINGS_DEFAULT).toEqual(SERVER_SETTINGS_DEFAULT);
    expect(plugin.parseModelSettings(SERVER_SETTINGS_DEFAULT)).toEqual(SERVER_SETTINGS_DEFAULT);
  });

  it("parseModelSettings nhận jsonb dạng chuỗi và bản đã sửa hợp dạng", () => {
    const settings = fresh();
    settings.catalog.opencode_local.models["opencode-go/new"] = { vision: false };
    settings.catalog.opencode_local.byComplexity.small = { model: "opencode-go/new", effort: null };
    expect(plugin.parseModelSettings(JSON.stringify(settings))).toEqual(settings);
  });

  it("parseModelSettings đọc dòng cũ thiếu hẳn vai designer: điền mặc định, giữ giá trị owner", () => {
    const legacy = fresh();
    delete legacy.roles.designer;
    legacy.roles.executor = { model: "claude-opus-5-5", effort: "high" };
    const parsed = plugin.parseModelSettings(JSON.stringify(legacy));
    expect(parsed?.roles.designer).toEqual({ model: "claude-opus-5-5", effort: null });
    expect(parsed?.roles.executor).toEqual({ model: "claude-opus-5-5", effort: "high" });
    expect(Object.keys(parsed!.roles).sort()).toEqual([...plugin.CREW_MODEL_ROLES].sort());
  });

  it("parseModelSettings từ chối bảng sai dạng", () => {
    const broken: [string, (s: any) => void][] = [
      ["thiếu runtime", (s) => { delete s.catalog.codex_local; }],
      ["effortKey lạ", (s) => { s.catalog.claude_local.effortKey = "thinking"; }],
      ["vision không phải boolean", (s) => { s.catalog.claude_local.models["claude-opus-5"].vision = "yes"; }],
      ["ô trỏ tới model không có trong catalog", (s) => { s.catalog.claude_local.byComplexity.small.model = "ghost"; }],
      ["ô có effort lạ", (s) => { s.catalog.claude_local.byComplexity.small.effort = "xhigh"; }],
      ["mức độ khó lạ", (s) => { s.catalog.claude_local.byComplexity.huge = { model: "claude-opus-5-5", effort: "low" }; }],
      ["order rỗng", (s) => { s.order.small = []; }],
      ["order trùng runtime", (s) => { s.order.small = ["claude_local", "claude_local"]; }],
      ["order có runtime lạ", (s) => { s.order.small = ["process"]; }],
      ["vai null", (s) => { s.roles["reviewer-codex"] = null; }],
      ["vai không có model", (s) => { s.roles.executor = { effort: null }; }],
    ];
    for (const [name, mutate] of broken) {
      const settings = fresh();
      mutate(settings);
      expect(plugin.parseModelSettings(settings), name).toBeNull();
    }
    for (const value of [null, undefined, 3, "not json", [], {}]) expect(plugin.parseModelSettings(value)).toBeNull();
  });

  it("readModelSettings dùng mặc định khi đọc lỗi hoặc không có dòng", async () => {
    const ctx = (query: () => Promise<unknown[]>) => ({ db: { namespace: "plugin_x_1", query } }) as never;
    expect(await plugin.readModelSettings(ctx(async () => { throw new Error("relation does not exist"); }))).toBe(plugin.CREW_MODEL_SETTINGS_DEFAULT);
    expect(await plugin.readModelSettings(ctx(async () => []))).toBe(plugin.CREW_MODEL_SETTINGS_DEFAULT);
    expect(await plugin.readModelSettings(ctx(async () => [{ settings: { catalog: {} } }]))).toBe(plugin.CREW_MODEL_SETTINGS_DEFAULT);
  });
});


import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeAgentConfig } from "./merge-agent-config.mjs";

const agent = (adapterConfig) => ({ id: "a1", adapterConfig: { command: "/Users/a/.crew/bin/crew-claude-run", ...adapterConfig } });
const PIN = "/Users/a/.crew/workflows/superpowers/6.4.1-5bf4e7801107";

test("thay cờ setting-sources/plugin-dir cũ, giữ cấu hình khác", () => {
  const agent = {
    id: "a1",
    metadata: { note: "giữ" },
    adapterConfig: {
      command: "/Users/a/.crew/bin/crew-claude-run",
      extraArgs: ["--setting-sources", "project,local", "--plugin-dir", "/old", "--verbose"],
    },
  };
  assert.deepEqual(mergeAgentConfig(agent, PIN), {
    adapterConfig: {
      command: "/Users/a/.crew/bin/crew-claude-run",
      extraArgs: ["--verbose", "--setting-sources", "project,local", "--plugin-dir", PIN],
    },
  });
});

test("bỏ cả dạng --plugin-dir=<dir> và --setting-sources=<v>", () => {
  const out = mergeAgentConfig(
    agent({ extraArgs: ["--plugin-dir=/old", "--setting-sources=user", "--verbose"] }),
    PIN,
  );
  assert.deepEqual(out.adapterConfig.extraArgs, ["--verbose", "--setting-sources", "project,local", "--plugin-dir", PIN]);
});

test("agent chưa có extraArgs", () => {
  const out = mergeAgentConfig(agent({}), PIN);
  assert.deepEqual(out.adapterConfig.extraArgs, ["--setting-sources", "project,local", "--plugin-dir", PIN]);
});

test("từ chối đầu vào không phải agent hợp lệ (thân lỗi, thiếu command)", () => {
  assert.throws(() => mergeAgentConfig({ error: "Unauthorized" }, PIN), /not a Paperclip agent/);
  assert.throws(() => mergeAgentConfig(null, PIN), /not a Paperclip agent/);
  assert.throws(() => mergeAgentConfig({ id: "a1" }, PIN), /adapterConfig\.command/);
  assert.throws(() => mergeAgentConfig({ id: "a1", adapterConfig: null }, PIN), /adapterConfig\.command/);
  assert.throws(() => mergeAgentConfig({ id: "a1", adapterConfig: { command: 5 } }, PIN), /adapterConfig\.command/);
});

test("từ chối command không phải wrapper crew-claude-run tuyệt đối", () => {
  for (const command of ["claude", "/usr/local/bin/claude", ".crew/bin/crew-claude-run", "/x/crew-claude-run"]) {
    assert.throws(() => mergeAgentConfig({ id: "a1", adapterConfig: { command } }, PIN), /wrapper/, command);
  }
});

test("từ chối giá trị bị che ngoài env, cho phép trong env", () => {
  assert.throws(() => mergeAgentConfig(agent({ model: "***REDACTED***" }), PIN), /adapterConfig\.model/);
  assert.doesNotThrow(() => mergeAgentConfig(agent({ env: { K: "***REDACTED***" } }), PIN));
});

test("không đụng metadata của agent", () => {
  assert.equal("metadata" in mergeAgentConfig({ ...agent({}), metadata: { crewRole: "x" } }, PIN), false);
});

test("từ chối pin không tuyệt đối hoặc không đúng thư mục pin", () => {
  assert.throws(() => mergeAgentConfig(agent({}), "pin"), /absolute/);
  assert.throws(() => mergeAgentConfig(agent({}), "/tmp/other"), /pinned/);
  assert.throws(() => mergeAgentConfig(agent({}), "/Users/a/.crew/workflows/superpowers/.."), /pinned/);
});

test("nhận pin bmad, giữ đúng một --plugin-dir", () => {
  const BMAD = "/Users/a/.crew/workflows/bmad/6.13.0-next-d009608292d8";
  const out = mergeAgentConfig(agent({ extraArgs: ["--plugin-dir", PIN, "--verbose"] }), BMAD);
  assert.deepEqual(out.adapterConfig.extraArgs, ["--verbose", "--setting-sources", "project,local", "--plugin-dir", BMAD]);
  assert.equal(out.adapterConfig.extraArgs.filter((a) => a === "--plugin-dir").length, 1);
});

test("từ chối thư mục workflow lạ hoặc bmad/..", () => {
  assert.throws(() => mergeAgentConfig(agent({}), "/Users/a/.crew/workflows/other/x"), /pinned/);
  assert.throws(() => mergeAgentConfig(agent({}), "/Users/a/.crew/workflows/bmad/.."), /pinned/);
  assert.throws(() => mergeAgentConfig(agent({}), "/Users/a/.crew/workflows/bmad/."), /pinned/);
});

const CODEX_CMD = "/Users/a/.crew/bin/crew-codex-run";
const OPENCODE_CMD = "/Users/a/.crew/bin/crew-opencode-run";
const codexAgent = (adapterConfig = {}) => ({
  id: "c1",
  adapterType: "codex_local",
  adapterConfig: { command: CODEX_CMD, env: { CODEX_HOME: { type: "plain", value: "/opt/crew-v3-spike/codex-homes/c1" } }, ...adapterConfig },
});
const opencodeAgent = (adapterConfig = {}) => ({ id: "o1", adapterType: "opencode_local", adapterConfig: { command: OPENCODE_CMD, ...adapterConfig } });

test("codex_local: nhận wrapper crew-codex-run, không thêm cờ của Claude", () => {
  const out = mergeAgentConfig(codexAgent({ model: "gpt-6-luna", extraArgs: ["--search"] }), PIN);
  assert.deepEqual(out.adapterConfig.extraArgs, ["--search"]);
  assert.equal(out.adapterConfig.command, CODEX_CMD);
  assert.equal(out.adapterConfig.model, "gpt-6-luna");
});

test("codex_local: bỏ cờ setting-sources/plugin-dir còn sót, extraArgs luôn là mảng", () => {
  const out = mergeAgentConfig(codexAgent({ extraArgs: ["--plugin-dir", "/old", "--setting-sources=user"] }), PIN);
  assert.deepEqual(out.adapterConfig.extraArgs, []);
  assert.deepEqual(mergeAgentConfig(codexAgent(), PIN).adapterConfig.extraArgs, []);
});

test("opencode_local: nhận wrapper crew-opencode-run, không cần CODEX_HOME", () => {
  const out = mergeAgentConfig(opencodeAgent({ model: "opencode-go/deepseek-v4-flash" }), PIN);
  assert.deepEqual(out.adapterConfig.extraArgs, []);
  assert.equal(out.adapterConfig.command, OPENCODE_CMD);
});

test("wrapper phải khớp adapterType (không lẫn Claude/Codex/OpenCode)", () => {
  assert.throws(() => mergeAgentConfig({ ...codexAgent(), adapterConfig: { command: "/Users/a/.crew/bin/crew-claude-run" } }, PIN), /crew-codex-run/);
  assert.throws(() => mergeAgentConfig({ ...opencodeAgent(), adapterConfig: { command: CODEX_CMD } }, PIN), /crew-opencode-run/);
  assert.throws(() => mergeAgentConfig({ id: "a1", adapterType: "claude_local", adapterConfig: { command: CODEX_CMD } }, PIN), /crew-claude-run/);
  assert.throws(() => mergeAgentConfig({ id: "a1", adapterType: "gemini_local", adapterConfig: { command: CODEX_CMD } }, PIN), /adapterType/);
});

test("adapterType vắng thì coi là claude_local; claude_local vẫn ghim như cũ", () => {
  const out = mergeAgentConfig({ ...agent({}), adapterType: "claude_local" }, PIN);
  assert.deepEqual(out.adapterConfig.extraArgs, ["--setting-sources", "project,local", "--plugin-dir", PIN]);
});

test("runtime mong đợi của ô vai trò phải khớp adapterType của agent", () => {
  assert.throws(() => mergeAgentConfig(codexAgent(), PIN, "claude_local"), /codex_local.*claude_local/);
  assert.throws(() => mergeAgentConfig(agent({}), PIN, "codex_local"), /claude_local.*codex_local/);
  assert.doesNotThrow(() => mergeAgentConfig(codexAgent(), PIN, "codex_local"));
  assert.throws(() => mergeAgentConfig(agent({}), PIN, "gemini_local"), /runtime/);
});

test("codex_local: bắt buộc env.CODEX_HOME tuyệt đối, ngoài cây companies/<companyId>", () => {
  const withHome = (value) => codexAgent({ env: { CODEX_HOME: value } });
  assert.throws(() => mergeAgentConfig(codexAgent({ env: {} }), PIN), /CODEX_HOME/);
  assert.throws(() => mergeAgentConfig(withHome("relative/dir"), PIN), /CODEX_HOME.*tuyệt đối|absolute/);
  assert.throws(() => mergeAgentConfig(withHome("/data/companies/0f3c1d3e-aaaa-bbbb-cccc-123456789abc/codex-home"), PIN), /companies/);
  assert.throws(() => mergeAgentConfig(withHome({ type: "plain", value: "/data/companies/x/codex-home" }), PIN), /companies/);
  assert.throws(() => mergeAgentConfig(withHome("***REDACTED***"), PIN), /CODEX_HOME/);
  assert.throws(() => mergeAgentConfig(withHome({ type: "secret_ref", secretId: "s" }), PIN), /CODEX_HOME/);
  assert.doesNotThrow(() => mergeAgentConfig(withHome("/opt/crew-v3-spike/codex-homes/c1"), PIN));
  assert.doesNotThrow(() => mergeAgentConfig(withHome("/data/companies-archive/x"), PIN));
});

test("codex_local: không được đặt OPENAI_API_KEY (tránh configuration_incomplete và lộ key)", () => {
  const env = { CODEX_HOME: "/opt/c", OPENAI_API_KEY: "sk-x" };
  assert.throws(() => mergeAgentConfig(codexAgent({ env }), PIN), /OPENAI_API_KEY/);
});

test("codex_local: giữ nguyên env khi trả adapterConfig", () => {
  const out = mergeAgentConfig(codexAgent({ env: { CODEX_HOME: "/opt/c", OTHER: "1" } }), PIN);
  assert.deepEqual(out.adapterConfig.env, { CODEX_HOME: "/opt/c", OTHER: "1" });
});

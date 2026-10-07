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

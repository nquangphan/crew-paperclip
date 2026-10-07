import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeAgentConfig } from "./merge-agent-config.mjs";

const PIN = "/Users/a/.crew/workflows/superpowers/6.4.1-5bf4e7801107";

test("thay cờ setting-sources/plugin-dir cũ, giữ cấu hình khác", () => {
  const agent = {
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
    { adapterConfig: { extraArgs: ["--plugin-dir=/old", "--setting-sources=user", "--verbose"] } },
    PIN,
  );
  assert.deepEqual(out.adapterConfig.extraArgs, ["--verbose", "--setting-sources", "project,local", "--plugin-dir", PIN]);
});

test("agent chưa có adapterConfig", () => {
  const out = mergeAgentConfig({ adapterConfig: null }, PIN);
  assert.deepEqual(out.adapterConfig.extraArgs, ["--setting-sources", "project,local", "--plugin-dir", PIN]);
});

test("không đụng metadata của agent", () => {
  assert.equal("metadata" in mergeAgentConfig({ metadata: { crewRole: "x" } }, PIN), false);
});

test("từ chối pin không tuyệt đối hoặc không đúng thư mục pin", () => {
  assert.throws(() => mergeAgentConfig({}, "pin"), /absolute/);
  assert.throws(() => mergeAgentConfig({}, "/tmp/other"), /pinned/);
});

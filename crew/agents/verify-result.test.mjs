import assert from "node:assert/strict";
import { test } from "node:test";
import { checkPatchResult, checkWriteResult } from "./verify-result.mjs";

const ARGS = ["--setting-sources", "project,local", "--plugin-dir", "/p"];

test("PATCH đạt khi extraArgs khớp", () => {
  assert.doesNotThrow(() => checkPatchResult(JSON.stringify({ adapterConfig: { extraArgs: ARGS } }), ARGS));
});

test("PATCH hỏng: thân lỗi, không phải JSON, extraArgs lệch", () => {
  assert.throws(() => checkPatchResult(JSON.stringify({ error: "Forbidden" }), ARGS), /error: Forbidden/);
  assert.throws(() => checkPatchResult("<html>502</html>", ARGS), /not JSON/);
  assert.throws(() => checkPatchResult("", ARGS), /not JSON/);
  assert.throws(() => checkPatchResult(JSON.stringify({ adapterConfig: { extraArgs: [] } }), ARGS), /expected/);
});

test("PUT hỏng khi thân lỗi hoặc không phải JSON", () => {
  assert.doesNotThrow(() => checkWriteResult("{}"));
  assert.throws(() => checkWriteResult(JSON.stringify({ error: "Not found" })), /Not found/);
  assert.throws(() => checkWriteResult("oops"), /not JSON/);
});

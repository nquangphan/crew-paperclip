import assert from "node:assert/strict";
import { test } from "node:test";
import { addBase } from "./add-base.mjs";

const BODY = JSON.stringify({ path: "AGENTS.md", content: "x" });
const HASH = "a".repeat(64);

test("lấy contentHash của file hiện tại làm baseHash", () => {
  assert.deepEqual(addBase(BODY, JSON.stringify({ contentHash: HASH, content: "cũ" })), { path: "AGENTS.md", content: "x", baseHash: HASH });
});

test("file chưa có thì baseHash là null", () => {
  assert.equal(addBase(BODY, JSON.stringify({ error: "Instructions file not found" })).baseHash, null);
});

test("lỗi khác hoặc phản hồi lạ thì dừng, không đoán null", () => {
  assert.throws(() => addBase(BODY, JSON.stringify({ error: "Forbidden" })), /Forbidden/);
  assert.throws(() => addBase(BODY, "<html>502</html>"), /not JSON/);
  assert.throws(() => addBase(BODY, JSON.stringify({ content: "x" })), /contentHash/);
  assert.throws(() => addBase(BODY, JSON.stringify({ contentHash: "xyz" })), /contentHash/);
});

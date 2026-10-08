import assert from "node:assert/strict";
import { test } from "node:test";
import { renderInstructions } from "./render-instructions.mjs";

const A = "11111111-1111-4111-8111-111111111111";
const E1 = "22222222-2222-4222-8222-222222222222";
const E2 = "33333333-3333-4333-8333-333333333333";

test("assistant: nối mục Executor của company, giữ thứ tự", () => {
  const out = renderInstructions("assistant", "# Trợ Lý\n", A, [E1, E2]);
  assert.equal(out, `# Trợ Lý\n\n## Executor của company\n\n- \`${E1}\`\n- \`${E2}\`\n`);
});

test("assistant: từ chối danh sách rỗng, id sai, trùng nhau hoặc trùng chính Trợ Lý", () => {
  assert.throws(() => renderInstructions("assistant", "x", A, []), /executor/);
  assert.throws(() => renderInstructions("assistant", "x", A, ["abc"]), /uuid/);
  assert.throws(() => renderInstructions("assistant", "x", A, [E1, E1.toUpperCase()]), /trùng/);
  assert.throws(() => renderInstructions("assistant", "x", A, [A]), /Trợ Lý/);
});

test("vai trò khác: giữ nguyên văn bản, không nhận danh sách executor", () => {
  assert.equal(renderInstructions("executor", "# Executor\n", A, []), "# Executor\n");
  assert.throws(() => renderInstructions("reviewer", "x", A, [E1]), /chỉ assistant/);
  assert.throws(() => renderInstructions("owner", "x", A, []), /role/);
});

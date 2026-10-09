import assert from "node:assert/strict";
import { test } from "node:test";
import { renderInstructions } from "./render-instructions.mjs";

const A = "11111111-1111-4111-8111-111111111111";
const E1 = "22222222-2222-4222-8222-222222222222";
const E2 = "33333333-3333-4333-8333-333333333333";

test("assistant: nối mục Executor của company, giữ thứ tự", () => {
  const out = renderInstructions("assistant", "# Trợ Lý\n", A, [E1, E2]);
  assert.equal(out, `# Trợ Lý\n\n## Executor của company\n\n- \`${E1}\`\n- \`${E2}\`\n\n## Agent BMAD của company\n\nKhông có. Luôn dùng Superpowers.\n`);
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

const B1 = "44444444-4444-4444-8444-444444444444";
const B2 = "55555555-5555-4555-8555-555555555555";

test("vai bmad: trả nguyên văn, không nhận danh sách", () => {
  assert.equal(renderInstructions("bmad", "# BMAD\n", A, [], []), "# BMAD\n");
  assert.throws(() => renderInstructions("bmad", "x", A, [], [B1]), /danh sách agent BMAD chỉ assistant nhận/);
});

test("vai khác ngoài assistant không nhận bmadIds", () => {
  for (const role of ["executor", "reviewer", "integrator"]) {
    assert.throws(() => renderInstructions(role, "x", A, [], [B1]), /danh sách agent BMAD chỉ assistant nhận/, role);
  }
});

test("assistant không có bmadIds: mục Agent BMAD ghi Không có, sau mục executor", () => {
  const out = renderInstructions("assistant", "# Trợ Lý\n", A, [E1]);
  assert.equal(out, `# Trợ Lý\n\n## Executor của company\n\n- \`${E1}\`\n\n## Agent BMAD của company\n\nKhông có. Luôn dùng Superpowers.\n`);
});

test("assistant có bmadIds: mỗi dòng một uuid theo thứ tự", () => {
  const out = renderInstructions("assistant", "# Trợ Lý\n", A, [E1], [B1, B2]);
  assert.ok(out.endsWith(`- \`${E1}\`\n\n## Agent BMAD của company\n\n- \`${B1}\`\n- \`${B2}\`\n`), out);
});

test("assistant: từ chối bmad uuid sai, trùng, trùng executor, trùng Trợ Lý", () => {
  assert.throws(() => renderInstructions("assistant", "x", A, [E1], ["abc"]), /uuid/);
  assert.throws(() => renderInstructions("assistant", "x", A, [E1], [B1, B1.toUpperCase()]), /trùng/);
  assert.throws(() => renderInstructions("assistant", "x", A, [E1], [E1]), /trùng/);
  assert.throws(() => renderInstructions("assistant", "x", A, [E1], [A]), /Trợ Lý/);
});

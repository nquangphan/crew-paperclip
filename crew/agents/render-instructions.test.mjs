import assert from "node:assert/strict";
import { test } from "node:test";
import { renderInstructions } from "./render-instructions.mjs";

const A = "11111111-1111-4111-8111-111111111111";
const E1 = "22222222-2222-4222-8222-222222222222";
const E2 = "33333333-3333-4333-8333-333333333333";

test("assistant: nối mục Executor của company, giữ thứ tự", () => {
  const out = renderInstructions("assistant", "# Trợ Lý\n", A, [E1, E2]);
  assert.equal(out, `# Trợ Lý\n\n## Executor của company\n\n- \`${E1}\` — runtime \`claude_local\`\n- \`${E2}\` — runtime \`claude_local\`\n\n## Agent BMAD của company\n\nKhông có. Luôn dùng Superpowers.\n\n## Reviewer Codex của company\n\nKhông có. Server tự chọn reviewer, bạn không giao việc cho reviewer.\n`);
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
  assert.equal(out, `# Trợ Lý\n\n## Executor của company\n\n- \`${E1}\` — runtime \`claude_local\`\n\n## Agent BMAD của company\n\nKhông có. Luôn dùng Superpowers.\n\n## Reviewer Codex của company\n\nKhông có. Server tự chọn reviewer, bạn không giao việc cho reviewer.\n`);
});

test("assistant có bmadIds: mỗi dòng một uuid theo thứ tự", () => {
  const out = renderInstructions("assistant", "# Trợ Lý\n", A, [E1], [B1, B2]);
  assert.ok(out.includes(`- \`${E1}\` — runtime \`claude_local\`\n\n## Agent BMAD của company\n\n- \`${B1}\`\n- \`${B2}\`\n\n## Reviewer Codex`), out);
});

test("assistant: từ chối bmad uuid sai, trùng, trùng executor, trùng Trợ Lý", () => {
  assert.throws(() => renderInstructions("assistant", "x", A, [E1], ["abc"]), /uuid/);
  assert.throws(() => renderInstructions("assistant", "x", A, [E1], [B1, B1.toUpperCase()]), /trùng/);
  assert.throws(() => renderInstructions("assistant", "x", A, [E1], [E1]), /trùng/);
  assert.throws(() => renderInstructions("assistant", "x", A, [E1], [A]), /Trợ Lý/);
});

const R1 = "66666666-6666-4666-8666-666666666666";

test("assistant: executor ghi runtime cho mọi dòng, id trần là claude_local", () => {
  const out = renderInstructions("assistant", "# Trợ Lý\n", A, [E1, `${E2}:codex_local`, `${B1}:opencode_local`]);
  assert.ok(
    out.includes(`## Executor của company\n\n- \`${E1}\` — runtime \`claude_local\`\n- \`${E2}\` — runtime \`codex_local\`\n- \`${B1}\` — runtime \`opencode_local\`\n\n`),
    out,
  );
});

test("assistant: từ chối runtime lạ hoặc trống sau dấu hai chấm", () => {
  assert.throws(() => renderInstructions("assistant", "x", A, [`${E1}:gemini_local`]), /runtime/);
  assert.throws(() => renderInstructions("assistant", "x", A, [`${E1}:`]), /runtime/);
});

test("assistant: id trùng nhau dù khác runtime vẫn bị chặn", () => {
  assert.throws(() => renderInstructions("assistant", "x", A, [E1, `${E1}:codex_local`]), /trùng/);
});

test("assistant: mục Reviewer Codex liệt kê reviewer, nằm sau mục BMAD", () => {
  const out = renderInstructions("assistant", "# Trợ Lý\n", A, [E1], [], R1);
  assert.ok(out.endsWith(`## Agent BMAD của company\n\nKhông có. Luôn dùng Superpowers.\n\n## Reviewer Codex của company\n\n- \`${R1}\` — runtime \`codex_local\`\n`), out);
});

test("assistant: reviewer Codex phải là uuid, không trùng executor, BMAD hay Trợ Lý", () => {
  assert.throws(() => renderInstructions("assistant", "x", A, [E1], [], "abc"), /uuid/);
  assert.throws(() => renderInstructions("assistant", "x", A, [E1], [], E1), /trùng/);
  assert.throws(() => renderInstructions("assistant", "x", A, [E1], [B1], B1), /trùng/);
  assert.throws(() => renderInstructions("assistant", "x", A, [E1], [], A), /Trợ Lý/);
});

test("vai khác assistant không nhận reviewer Codex", () => {
  for (const role of ["executor", "reviewer", "integrator", "bmad", "executor-codex", "executor-opencode", "reviewer-codex"]) {
    assert.throws(() => renderInstructions(role, "x", A, [], [], R1), /reviewer Codex chỉ assistant nhận/, role);
  }
});

test("ô executor-codex, executor-opencode, reviewer-codex trả nguyên văn như vai gốc", () => {
  for (const role of ["executor-codex", "executor-opencode", "reviewer-codex"]) {
    assert.equal(renderInstructions(role, "# Vai\n", A, []), "# Vai\n", role);
  }
});

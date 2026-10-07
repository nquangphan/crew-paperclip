import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (name) => readFileSync(new URL(`./${name}.md`, import.meta.url), "utf8");
const fill = (line) =>
  line
    .replaceAll("<git rev-parse HEAD>", "a".repeat(40))
    .replaceAll("<BASE 40 ký tự>", "b".repeat(40))
    .replaceAll("<git rev-parse HEAD>", "a".repeat(40))
    .replaceAll("<E>", "0")
    .replaceAll("<identifier>", "CRW-1")
    .replaceAll("<lệnh test đã chạy>", "pnpm test")
    .replaceAll("<nhánh mặc định>", "main")
    .replaceAll("<yes|no>", "yes");
const templateLine = (text, prefix) => {
  const line = text.split("\n").map((l) => l.trim().replace(/^`|`$/g, "")).find((l) => l.startsWith(prefix));
  assert.ok(line, `thiếu dòng mẫu ${prefix}`);
  return fill(line);
};

test("dòng mẫu crew-docs-check khớp regex của server", () => {
  const re = /^crew-docs-check commit=([0-9a-f]{40}) range=([0-9a-f]{7,40})\.\.([0-9a-f]{40}) exit=([0-3])$/;
  assert.match(templateLine(read("integrator"), "crew-docs-check commit="), re);
});

test("dòng mẫu crew-commit của executor đúng định dạng", () => {
  const re = /^crew-commit sha=[0-9a-f]{40} branch=\S+ tests=.+ result=(pass|fail)$/;
  assert.match(templateLine(read("executor"), "crew-commit sha="), re);
});

test("dòng mẫu crew-merge của integrator đúng định dạng", () => {
  const re = /^crew-merge sha=[0-9a-f]{40} branch=\S+ pushed=(yes|no)$/;
  assert.match(templateLine(read("integrator"), "crew-merge sha="), re);
});

test("mọi file instructions nhắc đúng các mã lỗi server", () => {
  for (const name of ["executor", "reviewer", "integrator"]) {
    assert.match(read(name), /crew_gate_blocked/, name);
  }
  assert.match(read("executor"), /crew_agent_root_issue/);
  assert.match(read("executor"), /crew_roles_unconfigured/);
});

test("không file nào dặn push cưỡng bức", () => {
  for (const name of ["executor", "reviewer", "integrator"]) {
    assert.doesNotMatch(read(name), /`git push[^`]*(--force|\s-f\b)[^`]*`/, name);
  }
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (name) => readFileSync(new URL(`./${name}.md`, import.meta.url), "utf8");
const fill = (line) =>
  line
    .replaceAll("<git rev-parse HEAD>", "a".repeat(40))
    .replaceAll("<BASE 40 ký tự>", "b".repeat(40))
    .replaceAll("<git rev-parse HEAD>", "a".repeat(40))
    .replaceAll("<DOCS_EXIT>", "0")
    .replaceAll("<identifier>", "CRW-1")
    .replaceAll("<lệnh test đã chạy>", "pnpm test")
    .replaceAll("<nhánh mặc định>", "main")
    .replaceAll("<40 hex>", "c".repeat(40))
    .replaceAll("<T>", "a".repeat(40))
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

test("dòng mẫu crew-review của reviewer đúng định dạng", () => {
  const re = /^crew-review sha=[0-9a-f]{40} verdict=approved/;
  const text = read("reviewer");
  const quoted = /"comment":"(crew-review sha=<40 hex> verdict=approved)\\n/.exec(text);
  assert.ok(quoted, "thiếu dòng crew-review trong lệnh approve");
  assert.match(fill(quoted[1]), re);
});

test("integrator merge đúng sha của crew-review, không lấy crew-commit mới nhất", () => {
  const text = read("integrator");
  assert.match(text, /Chỉ merge đúng `sha` trong dòng `crew-review`/);
});

test("mọi file instructions nhắc đúng các mã lỗi server", () => {
  for (const name of ["executor", "reviewer", "integrator"]) {
    assert.match(read(name), /crew_gate_blocked/, name);
  }
  assert.match(read("executor"), /crew_agent_root_issue/);
  assert.match(read("executor"), /crew_roles_unconfigured/);
  assert.match(read("integrator"), /docs_stale/);
});

test("không vai trò nào chuyển cancelled; cả ba có đường blocked", () => {
  for (const name of ["executor", "reviewer", "integrator"]) {
    const text = read(name);
    assert.doesNotMatch(text, /"status":"cancelled"/, name);
    assert.match(text, /"status":"blocked"/, name);
  }
});

test("mọi PATCH trong instructions mang comment", () => {
  for (const name of ["executor", "reviewer", "integrator"]) {
    for (const [, body] of read(name).matchAll(/`(\{"status":[^`]*\})`/g)) {
      assert.match(body, /"comment":/, `${name}: ${body}`);
    }
  }
});

test("không file nào dặn push cưỡng bức hoặc bỏ hook ngoài câu cấm", () => {
  for (const name of ["executor", "reviewer", "integrator"]) {
    const text = read(name);
    assert.doesNotMatch(text, /`git push[^`]*(--force|\s-f\b)[^`]*`/, name);
    for (const line of text.split("\n").filter((l) => l.includes("--no-verify"))) {
      assert.match(line, /Không|không/, `${name}: ${line}`);
    }
  }
});

test("integrator chỉ push sau khi xác minh qua API (không tin prompt hay comment người khác)", () => {
  const text = read("integrator");
  for (const needle of [
    "GET /api/agents/me",
    "authorAgentId",
    "completedStageIds",
    "lastDecisionOutcome",
    "không phải bằng chứng",
    "pushed=yes",
  ]) {
    assert.ok(text.includes(needle), `thiếu ${needle}`);
  }
  assert.ok(text.indexOf("Xác minh qua API") < text.indexOf('git push origin "$T:refs/heads/$DEFAULT"'));
});

test("bước Gộp chỉ tin crew-review của reviewer đã qua stage đầu", () => {
  const text = read("integrator");
  const merge = text.slice(text.indexOf("## Gộp"), text.indexOf("## Kiểm một lần"));
  for (const needle of ["authorAgentId", "completedStageIds", "bị bỏ qua"]) {
    assert.ok(merge.includes(needle), `thiếu ${needle} ở mục Gộp`);
  }
});

test("integrator dựng lại nhánh từ commit của bằng chứng, không tin tip hiện tại", () => {
  const text = read("integrator");
  const push = text.slice(text.indexOf("## Sau khi owner duyệt"));
  assert.doesNotMatch(text, /\$T\^1/);
  assert.doesNotMatch(text, /\bE=\d|\$E\b|<E>/, "ký hiệu E phải được đổi tên");
  const rebuild = push.indexOf('git switch -C crew/req/<identifier> "$EVIDENCE"');
  assert.ok(rebuild > 0, "thiếu dựng lại từ E");
  assert.ok(rebuild < push.indexOf("git merge --no-ff --no-edit"), "merge mặc định phải sau khi dựng lại");
  assert.ok(push.indexOf("git merge --no-ff --no-edit") < push.indexOf("crew-docs-check commit=$T"), "bằng chứng mới cho tip đã merge");
  assert.ok(push.indexOf("crew-docs-check commit=$T") < push.indexOf('git push origin "$T:'), "bằng chứng trước push");
  assert.match(push, /git rev-parse HEAD` phải vẫn bằng `T`/);
});

test("dừng im chỉ khi pushed=yes mới hơn bằng chứng, và fetch lỗi thì dừng", () => {
  const text = read("integrator");
  assert.match(text, /pushed=yes` \*\*mới hơn\*\* bằng chứng/);
  assert.match(text, /`git fetch origin` lỗi cũng dừng/);
  assert.match(text, /chờ owner đăng crew-review/);
});

test("ngoại lệ issue con leo thang cho owner", () => {
  const text = read("integrator");
  assert.match(text, /leo thang cho owner sau 5 vòng/);
  assert.match(text, /authorUserId/);
});

test("integrator che token ngoài URL và đối chiếu id trong prompt", () => {
  const text = read("integrator");
  for (const needle of ["gh[pousr]_", "github_pat_", "glpat-", "xox[abp]-", "(id <uuid>)", "dừng im"]) {
    assert.ok(text.includes(needle), `thiếu ${needle}`);
  }
});

test("integrator không dặn lộ URL remote và lọc output push", () => {
  const text = read("integrator");
  assert.doesNotMatch(text, /remote\.origin\.url|git remote get-url/);
  assert.match(text, /không chạy `git remote -v`/);
  assert.match(text, /Không dán output thô/);
  assert.match(text, /:\/\/\*\*\*@/);
});

test("executor không nêu mã 78 mà bắt chạy workflow-check", () => {
  const text = read("executor");
  assert.doesNotMatch(text, /\b78\b/);
  assert.match(text, /bắt buộc chạy `crew-mac workflow-check --root/);
  assert.doesNotMatch(text, /git status --porcelain/);
});

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const DOCS_CHECK_RE = /^crew-docs-check commit=([0-9a-f]{40}) range=([0-9a-f]{7,40})\.\.([0-9a-f]{40}) exit=([0-3])$/;
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
  assert.match(templateLine(read("integrator"), "crew-docs-check commit="), DOCS_CHECK_RE);
});

const MERGE_CHECK_RE = /^crew-merge sha=([0-9a-f]{40}) branch=(\S+) pushed=yes$/;
const POLICY_SOURCE = new URL("../../server/src/crew/issue-policy.ts", import.meta.url);

test("regex crew-docs-check trong test trùng chuỗi regex của server", { skip: !existsSync(POLICY_SOURCE) && "issue-policy.ts chưa có trên nhánh này" }, () => {
  const match = /CREW_DOCS_CHECK_RE\s*=\s*\/(.+)\/;/.exec(readFileSync(POLICY_SOURCE, "utf8"));
  assert.ok(match, "không tìm thấy CREW_DOCS_CHECK_RE");
  assert.equal(match[1], DOCS_CHECK_RE.source);
});

test("regex crew-merge trong test trùng chuỗi regex của server", { skip: !existsSync(POLICY_SOURCE) && "issue-policy.ts chưa có trên nhánh này" }, () => {
  const match = /CREW_MERGE_RE\s*=\s*\/(.+)\/;/.exec(readFileSync(POLICY_SOURCE, "utf8"));
  assert.ok(match, "không tìm thấy CREW_MERGE_RE");
  assert.equal(match[1], MERGE_CHECK_RE.source);
});

test("stage 4 nhận diện bằng currentStageId, push lỗi không đổi status, không PATCH blocked khi là participant duyệt", () => {
  const text = read("integrator");
  const stage4 = text.slice(text.indexOf("## Stage 4"));
  assert.match(stage4, /executionState\.currentStageId/);
  assert.doesNotMatch(stage4, /`lastDecisionOutcome` là `approved`/);
  assert.doesNotMatch(text, /"status":"blocked"/);
  assert.doesNotMatch(text, /"status":"in_progress"/);
  assert.match(stage4, /9\. `PUSHED=no`: không đổi status/);
  assert.doesNotMatch(text, /mở lại vòng duyệt/);
  assert.doesNotMatch(read("reviewer"), /"status":"blocked"/);
});

test("dòng mẫu crew-fix khớp định dạng và cả ba vai trò dùng nó", () => {
  const FIX_RE = /^crew-fix base=[0-9a-f]{40}$/;
  const line = templateLine(read("integrator"), "crew-fix base=").replace("<40 hex sha cần sửa>", "d".repeat(40));
  assert.match(line, FIX_RE);
  assert.match(read("executor"), /git switch -c crew\/<identifier> <base>/);
  assert.match(read("executor"), /không từ `origin\/HEAD`/);
  assert.match(read("reviewer"), /git diff <base>\.\.<sha>/);
  assert.match(read("integrator"), /tác giả của `crew-commit` đó, không mặc định executor của issue gốc/);
});

test("integrator nhận diện stage chỉ theo executionState, không đòi status in_review", () => {
  const text = read("integrator");
  assert.doesNotMatch(text, /`status` là `in_review`/);
  assert.doesNotMatch(text, /(?<!đòi )`status=in_review`/);
  assert.match(text, /\*\*Không đòi `status=in_review`\*\*/);
  assert.match(text, /`in_review`, `blocked` hoặc `todo`/);
  assert.match(text, /recovery stock/);
  assert.match(text, /không xét `status` của nó/);
  assert.match(text, /LUẬT CỨNG/);
});

test("yêu cầu sửa code issue gốc đi qua issue con mới", () => {
  const text = read("integrator");
  assert.match(text, /## Yêu cầu sửa/);
  assert.match(text, /issue con mới/);
  assert.match(text, /không `PATCH` `in_progress` trên issue gốc/);
  assert.match(read("executor"), /issue con mới giao cho bạn/);
});

test("dòng mẫu crew-commit của executor đúng định dạng", () => {
  const re = /^crew-commit sha=[0-9a-f]{40} branch=\S+ tests=.+ result=(pass|fail)$/;
  assert.match(templateLine(read("executor"), "crew-commit sha="), re);
});

test("dòng mẫu crew-merge của integrator đúng định dạng", () => {
  const line = templateLine(read("integrator"), "crew-merge sha=");
  assert.match(line, /^crew-merge sha=[0-9a-f]{40} branch=\S+ pushed=(yes|no)$/);
  // dòng pushed=yes là dòng server chấp nhận để hoàn tất stage push
  assert.match(line.replace("pushed=no", "pushed=yes"), /^crew-merge sha=([0-9a-f]{40}) branch=(\S+) pushed=yes$/);
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
  for (const name of ["executor", "reviewer", "integrator", "assistant"]) {
    assert.match(read(name), /crew_gate_blocked/, name);
  }
  assert.match(read("executor"), /crew_agent_root_issue/);
  assert.match(read("executor"), /crew_roles_unconfigured/);
  assert.match(read("integrator"), /docs_stale/);
});

test("không vai trò nào chuyển cancelled; cả ba có đường blocked", () => {
  for (const name of ["executor", "reviewer", "integrator", "assistant"]) {
    const text = read(name);
    assert.doesNotMatch(text, /"status":"cancelled"/, name);
    if (name === "executor" || name === "assistant") assert.match(text, /"status":"blocked"/, name);
  }
});

test("mọi PATCH trong instructions mang comment", () => {
  for (const name of ["executor", "reviewer", "integrator", "assistant"]) {
    for (const [, body] of read(name).matchAll(/`(\{"status":[^`]*\})`/g)) {
      assert.match(body, /"comment":/, `${name}: ${body}`);
    }
  }
});

test("không file nào dặn push cưỡng bức hoặc bỏ hook ngoài câu cấm", () => {
  for (const name of ["executor", "reviewer", "integrator", "assistant"]) {
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
    "Chỉ dữ liệu server mới tính",
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
  const push = text.slice(text.indexOf("## Stage 4"));
  assert.doesNotMatch(text, /\$T\^1/);
  assert.doesNotMatch(text, /\bE=\d|\$E\b|<E>/, "ký hiệu E phải được đổi tên");
  const rebuild = push.indexOf('git switch -C crew/req/<identifier> "$EVIDENCE"');
  assert.ok(rebuild > 0, "thiếu dựng lại từ E");
  assert.ok(rebuild < push.indexOf("git merge --no-ff --no-edit"), "merge mặc định phải sau khi dựng lại");
  assert.ok(push.indexOf("git merge --no-ff --no-edit") < push.indexOf("crew-docs-check commit=$T"), "bằng chứng mới cho tip đã merge");
  assert.ok(push.indexOf("crew-docs-check commit=$T") < push.indexOf('git push origin "$T:'), "bằng chứng trước push");
  assert.match(push, /git rev-parse HEAD` phải vẫn bằng `T`/);
  assert.ok(push.indexOf("crew-docs-check commit=$T") < push.indexOf("crew-merge sha=<T>"), "bằng chứng mới ghi trước crew-merge");
  assert.match(push, /"status":"done","comment":"Integrator: approve — đã push/);
});

test("dừng im chỉ khi pushed=yes mới hơn bằng chứng, và fetch lỗi thì dừng", () => {
  const text = read("integrator");
  assert.match(text, /pushed=yes` \*\*mới hơn\*\* bằng chứng/);
  assert.match(text, /`git fetch origin` lỗi: dừng, không merge hay push bằng ref local/);
  assert.match(text, /chỉ comment nhờ owner đăng `crew-review/);
});

test("ngoại lệ issue con leo thang cho owner", () => {
  const text = read("integrator");
  assert.match(text, /leo thang cho owner sau 5 vòng/);
  assert.match(text, /authorUserId/);
});

test("integrator che token ngoài URL, không dựa vào plugin hay mention", () => {
  const text = read("integrator");
  assert.doesNotMatch(text, /@mention|plugin|\(id <uuid>\)|prompt/);
  for (const needle of ["gh[pousr]_", "github_pat_", "glpat-", "xox[abp]-", "nhảy thẳng tới bước 8"]) {
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

test("reviewer có mục issue gốc và integrator nhận việc của issue gốc theo executionState", () => {
  const reviewer = read("reviewer");
  assert.match(reviewer, /## Issue gốc/);
  assert.match(reviewer, /không đòi `crew-commit` trên issue gốc/);
  assert.match(reviewer, /crew-review root children=/);
  const merge = read("integrator");
  assert.match(merge, /`currentStageId` là id stage integrator thứ nhất/);
  assert.match(merge, /[Kk]hông đòi `done` cho issue gốc/);
});

test("mọi lệnh API có tiền tố /api/ và curl có -f", () => {
  for (const name of ["executor", "reviewer", "integrator", "assistant"]) {
    const text = read(name);
    assert.match(text, /## Gọi API/, name);
    assert.match(text, /\$PAPERCLIP_API_URL\/api\//, name);
    assert.doesNotMatch(text, /\$PAPERCLIP_API_URL\/(?!api\/)/, `${name}: URL thiếu /api/`);
    assert.doesNotMatch(text, /\b(GET|POST|PATCH|PUT|DELETE) \/(?!api\/)/, `${name}: đường API thiếu /api/`);
    for (const line of text.split("\n").filter((l) => l.includes("curl "))) {
      assert.match(line, /curl -fsS/, `${name}: curl thiếu -f: ${line}`);
    }
  }
});

test("luật không bao giờ nằm trước các mục khác, integrator có luật cứng trước push", () => {
  for (const name of ["executor", "reviewer", "integrator", "assistant"]) {
    const text = read(name);
    assert.ok(text.indexOf("## Không bao giờ") > 0, name);
    assert.ok(text.indexOf("## Không bao giờ") < text.indexOf("## Gọi API"), name);
  }
  const text = read("integrator");
  assert.ok(text.indexOf("LUẬT CỨNG") < text.indexOf('git push origin "$T:refs/heads/$DEFAULT"'));
  assert.match(text, /KHÔNG `git push`/);
  assert.match(text, /`PATCH` issue gốc sang `in_progress`, `blocked` hay `cancelled`/);
  assert.match(read("executor"), /Kiểm `git branch --show-current`/);
});

const MODEL_POLICY_SOURCE = new URL("../../server/src/crew/model-policy.ts", import.meta.url);
const BUNDLE_SOURCE = new URL("../../server/src/crew/bundle-resume.ts", import.meta.url);
const BUNDLE_RE = /^crew-bundle id=([a-z0-9][a-z0-9-]{0,39}) seq=([1-9][0-9]{0,2})$/;
const MODEL_LINE_RE = /^crew-model complexity=(trivial|small|medium|large) model=(claude-sonnet-5|claude-opus-5) effort=(low|medium|high) reason=(.+)$/;
const STACK_RE = /^crew-stack on=([A-Z][A-Z0-9]*-[0-9]+)$/;
const fillAssistant = (line) => line.replaceAll("<gói>", "greet").replaceAll("<n>", "2")
  .replaceAll("<mức>", "small").replaceAll("<model>", "claude-sonnet-5")
  .replaceAll("<effort>", "medium").replaceAll("<một dòng lý do>", "bám khuôn greet.js")
  .replaceAll("<identifier>", "CRE-31");

test("assistant: dòng mẫu marker khớp regex", () => {
  const text = read("assistant");
  assert.match(fillAssistant(templateLine(text, "crew-bundle id=")), BUNDLE_RE);
  assert.match(fillAssistant(templateLine(text, "crew-model complexity=")), MODEL_LINE_RE);
  assert.match(fillAssistant(templateLine(text, "crew-stack on=")), STACK_RE);
  assert.ok(text.split("\n").some((l) => l.trim().replace(/^`|`$/g, "") === "crew-kind research"));
});

test("regex crew-bundle trong test trùng chuỗi regex của server", { skip: !existsSync(BUNDLE_SOURCE) && "bundle-resume.ts chưa có trên nhánh này" }, () => {
  const match = /CREW_BUNDLE_RE\s*=\s*\/(.+)\/m;/.exec(readFileSync(BUNDLE_SOURCE, "utf8"));
  assert.ok(match);
  assert.equal(match[1], BUNDLE_RE.source);
});

test("bảng model trong assistant.md trùng CREW_COMPLEXITY_MODEL của server", { skip: !existsSync(MODEL_POLICY_SOURCE) && "model-policy.ts chưa có trên nhánh này" }, () => {
  const source = readFileSync(MODEL_POLICY_SOURCE, "utf8");
  const server = [...source.matchAll(/(trivial|small|medium|large): \{ model: "([^"]+)", effort: "([^"]+)" \}/g)].map((m) => m.slice(1).join(" "));
  const doc = [...read("assistant").matchAll(/^\| `(trivial|small|medium|large)` \| `([^`]+)` \| `([^`]+)` \|/gm)].map((m) => m.slice(1).join(" "));
  assert.equal(server.length, 4);
  assert.deepEqual(doc, server);
});

test("assistant: chờ owner bằng blocked và hỏi trước khi tạo con", () => {
  const text = read("assistant");
  for (const line of text.split("\n").filter((l) => /fable|haiku/i.test(l))) assert.match(line, /[Kk]hông/);
  assert.doesNotMatch(text, /"status":"in_review"|"status":"cancelled"/);
  for (const needle of ['"status":"blocked"', '"kind":"ask_user_questions"', '"continuationPolicy":"wake_assignee"', '"resolverPolicy":"human_only"', "trước khi tạo issue con"]) assert.ok(text.includes(needle), needle);
});

test("assistant: tạo con có blocker, override và không gửi policy", () => {
  const text = read("assistant");
  for (const needle of ["/api/issues/<id gốc>/children", '"blockParentUntilDone":true', '"blockedByIssueIds":', '"assigneeAdapterOverrides":{"adapterConfig":{"model":"<model>","effort":"<effort>"}}', "crew_override_forbidden", "crew_role_assignee"]) assert.ok(text.includes(needle), needle);
  assert.doesNotMatch(text, /"executionPolicy":/);
});

test("assistant: comment kế hoạch và đóng issue gốc", () => {
  const text = read("assistant");
  assert.match(text, /crew-plan root=<identifier gốc> children=<số con> bundles=<số gói>/);
  assert.match(text, /"status":"done","comment":"crew-assistant done children=/);
});

test("executor: research báo bằng crew-report; nhánh xếp chồng theo crew-stack", () => {
  const text = read("executor");
  assert.match(text, /`crew-kind research`/);
  assert.match(text, /không tạo nhánh, không sửa file, không commit/);
  assert.match(text, /`crew-report`/);
  assert.match(text, /"status":"done","comment":"Executor: xong báo cáo research, chờ review\./);
  assert.match(text, /`crew-stack on=<identifier>`/);
  assert.match(text, /git switch -c crew\/<identifier> <sha đã duyệt của issue đó>/);
  assert.match(text, /crew_override_forbidden/);
  assert.match(text, /`crew-bundle/);
});

test("reviewer: duyệt research không cần crew-commit, diff crew-stack từ sha nền", () => {
  const text = read("reviewer");
  const quoted = /"comment":"(crew-review research verdict=approved)\\n/.exec(text);
  assert.ok(quoted, "thiếu lệnh approve research");
  assert.match(text, /`crew-report`/);
  assert.match(text, /`crew-stack on=<identifier>`/);
  assert.match(text, /git diff <sha nền>\.\.<sha>/);
});

test("integrator: không đặt override khi tạo issue con sửa", () => {
  const text = read("integrator");
  assert.match(text, /không gửi `assigneeAdapterOverrides`/);
  assert.match(text, /crew_override_forbidden/);
});

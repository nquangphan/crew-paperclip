import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const DOCS_CHECK_RE = /^crew-docs-check commit=([0-9a-f]{40}) range=([0-9a-f]{7,40})\.\.([0-9a-f]{40}) exit=([0-3])(?=$|\s|`)/;
const read = (name) => readFileSync(new URL(`./${name}.md`, import.meta.url), "utf8");
const RECURSIVE_DELETE_RULE = "Chạy `rm -rf` (hay xóa đệ quy) ở bất kỳ đâu ngoài thư mục tạm do chính bạn vừa tạo bằng `mktemp -d` trong run này; thư mục tạm thì để nguyên, không cần dọn.";
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

test("mọi instructions đều cấm xóa đệ quy ngoài thư mục tạm vừa tạo trong run", () => {
  for (const name of ["executor", "reviewer", "integrator", "assistant", "bmad"]) {
    assert.ok(read(name).includes(RECURSIVE_DELETE_RULE), `${name}: thiếu quy tắc xóa đệ quy`);
  }
});

test("dòng mẫu crew-docs-check khớp regex của server", () => {
  assert.match(templateLine(read("integrator"), "crew-docs-check commit="), DOCS_CHECK_RE);
});

test("integrator xuống dòng ngay sau exit=N rồi đọc lại dòng đầu comment bằng chứng trước PATCH done", () => {
  const text = read("integrator");
  const evidence = text.slice(text.indexOf("## Ghi bằng chứng rồi quyết định"), text.indexOf("## Lỗi server"));
  assert.match(evidence, /xuống dòng ngay sau `exit=<DOCS_EXIT>`/);
  assert.match(evidence, /`\\n\\n` ngay sau `exit=<DOCS_EXIT>`/);
  assert.match(evidence, /GET \/api\/issues\/<id>\/comments/);
  assert.ok(evidence.indexOf("GET /api/issues/<id>/comments") < evidence.indexOf('"status":"done"'), "đọc lại trước PATCH done");
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
  for (const name of ["executor", "reviewer", "integrator", "assistant", "bmad"]) {
    assert.match(read(name), /crew_gate_blocked/, name);
  }
  assert.match(read("executor"), /crew_agent_root_issue/);
  assert.match(read("executor"), /crew_roles_unconfigured/);
  assert.match(read("integrator"), /docs_stale/);
});

test("không vai trò nào chuyển cancelled; cả ba có đường blocked", () => {
  for (const name of ["executor", "reviewer", "integrator", "assistant", "bmad"]) {
    const text = read(name);
    assert.doesNotMatch(text, /"status":"cancelled"/, name);
    if (name !== "reviewer" && name !== "integrator") assert.match(text, /"status":"blocked"/, name);
  }
});

test("mọi PATCH trong instructions mang comment", () => {
  for (const name of ["executor", "reviewer", "integrator", "assistant", "bmad"]) {
    for (const [, body] of read(name).matchAll(/`(\{"status":[^`]*\})`/g)) {
      assert.match(body, /"comment":/, `${name}: ${body}`);
    }
  }
});

test("không file nào dặn push cưỡng bức hoặc bỏ hook ngoài câu cấm", () => {
  for (const name of ["executor", "reviewer", "integrator", "assistant", "bmad"]) {
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
  for (const name of ["executor", "reviewer", "integrator", "assistant", "bmad"]) {
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
  for (const name of ["executor", "reviewer", "integrator", "assistant", "bmad"]) {
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
  for (const needle of ["/api/companies/<companyId>/issues", '"parentId":"<id gốc>"', '"blockedByIssueIds":', '"assigneeAdapterOverrides":{"adapterConfig":{"model":"<model>","effort":"<effort>"}}', "Tiêu chí nghiệm thu:", "crew_override_forbidden", "crew_role_assignee"]) assert.ok(text.includes(needle), needle);
  assert.doesNotMatch(text, /"acceptanceCriteria":|"blockParentUntilDone":/);
  assert.doesNotMatch(text, /"executionPolicy":/);
});

test("executor và reviewer đọc tiêu chí từ description", () => {
  for (const role of ["executor", "reviewer"]) {
    const text = read(role);
    assert.match(text, /Tiêu chí nghiệm thu:/, role);
    assert.match(text, /description/, role);
    assert.doesNotMatch(text, /acceptanceCriteria field|trường `acceptanceCriteria`/, role);
  }
});

test("mọi vai trò tạo issue con qua route company có parentId", () => {
  for (const role of ["assistant", "executor", "reviewer", "integrator", "bmad"]) {
    assert.doesNotMatch(read(role), /\/children\b/, role);
  }
  for (const role of ["assistant", "executor", "integrator"]) {
    const text = read(role);
    assert.match(text, /POST \/api\/companies\/<companyId>\/issues/);
    assert.match(text, /"parentId":"<id gốc>"/);
    assert.match(text, /PAPERCLIP_COMPANY_ID/);
    assert.match(text, /GET \/api\/issues\/<id gốc>/);
    assert.match(text, /COMPANY_ID=\$\{PAPERCLIP_COMPANY_ID:-\}/);
  }
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

test("crew-stack: executor và reviewer chỉ nhận cùng SHA nền đã được duyệt", () => {
  for (const role of ["executor", "reviewer"]) {
    const text = read(role);
    for (const needle of [
      "cùng `parentId`", "cùng `crew-bundle id=`", "blocker trực tiếp",
      "executionPolicy.stages", "authorAgentId", "authorUserId", "completedStageIds",
      "crew-commit", "responsibleUserId", "git merge-base --is-ancestor",
      "crew-stack-base sha=<40 hex> issue=<identifier>",
    ]) assert.ok(text.includes(needle), `${role}: thiếu ${needle}`);
    assert.match(text, /comment giả/);
  }
  assert.match(read("reviewer"), /SHA nền đã ghi trên B/);
  assert.match(read("reviewer"), /authorAgentId` trùng tác giả của `crew-commit` mới nhất trên B/);
});

test("assistant: lưu kế hoạch đầy đủ trước POST đầu, đối soát và tạo tiếp bằng khóa ổn định", () => {
  const text = read("assistant");
  const plan = text.indexOf("## Ghi kế hoạch trước khi tạo con");
  const create = text.indexOf("## Tạo issue con");
  assert.ok(plan > 0 && plan < create);
  for (const needle of [
    "crew-plan root=<identifier gốc> children=<số con> bundles=<số gói>",
    "child-key=<key>", '"idempotencyKey":"crew-child:<id gốc>:<revision>:<key>"',
    "POST đầu tiên", "mất response", "tạo nốt", "mọi con trong mọi kế hoạch",
  ]) assert.ok(text.includes(needle), `thiếu ${needle}`);
  assert.match(text, /đối soát.*trước.*Đóng issue gốc/s);
});

test("assistant: yêu cầu sửa gốc được xử lý trước khi đóng lại", () => {
  const text = read("assistant");
  const dispatch = text.slice(text.indexOf("## Mỗi lần được đánh thức"), text.indexOf("## Hiểu yêu cầu"));
  assert.ok(dispatch.indexOf("changes_requested") < dispatch.indexOf("mọi con `done`"));
  for (const needle of [
    "lastDecisionId", "lastDecisionOutcome", "Reviewer: cần sửa", "owner",
    "crew-correction decision=<id quyết định>", "issue con sửa", "crew-fix base=",
    "crew-stack on=", "bảng model", "không gửi lại `done` nguyên trạng",
  ]) assert.ok(text.includes(needle), `thiếu ${needle}`);
  assert.match(text, /Trước tiên đối soát mọi kế hoạch đã ghi với mọi con đã tạo/);
});

test("mọi vai trò cấm ghi sau PATCH chuyển stage và dừng khi PATCH trả 422", () => {
  for (const name of ["executor", "reviewer", "integrator", "assistant", "bmad"]) {
    const text = read(name);
    assert.match(text, /Ghi thêm bất cứ gì \(comment, `PATCH`, `POST`\) sau một `PATCH` chuyển stage/, name);
    assert.match(text, /agent_run_cancelled/, name);
    assert.match(text, /`PATCH` trả 422 thì dừng run: không comment, không `PATCH` lại/, name);
  }
});

test("integrator không bảo ghi bằng chứng rồi PATCH lại sau 422", () => {
  const text = read("integrator");
  assert.doesNotMatch(text, /rồi `PATCH` một lần nữa/);
  assert.doesNotMatch(text, /sửa thứ tự đăng một lần/);
  assert.match(text, /run của bạn đã bị hủy nên không ghi thêm được gì/);
  const stage2 = text.slice(text.indexOf("## Ghi bằng chứng rồi quyết định"), text.indexOf("## Lỗi server"));
  assert.ok(stage2.indexOf("crew-docs-check commit=") < stage2.indexOf('"status":"done"'), "bằng chứng phải đứng trước PATCH");
  const stage4 = text.slice(text.indexOf("## Stage 4"));
  assert.ok(stage4.indexOf("crew-merge sha=") < stage4.indexOf("`PUSHED=yes` (hoặc đã push"), "crew-merge phải đứng trước PATCH done");
  assert.match(stage4, /`PATCH` này là lệnh ghi cuối/);
});

test("vai trò khác không bảo comment sau PATCH 422 của quyết định", () => {
  assert.doesNotMatch(read("reviewer"), /đọc `violations`, comment lại nguyên văn, dừng/);
  assert.match(read("reviewer"), /run đã bị hủy, không comment hay `PATCH` lại được/);
  for (const name of ["executor", "assistant", "bmad"]) assert.match(read(name), /422 của chính `PATCH done` \(lệnh ghi cuối\) thì run đã bị hủy/, name);
});

test("mọi vai trò cấm PUT /api/issues/:id/title và chỉ dùng PATCH title", () => {
  for (const name of ["executor", "reviewer", "integrator", "assistant", "bmad"]) {
    const text = read(name);
    assert.match(text, /Gọi `PUT \/api\/issues\/<id>\/title`/, name);
    assert.match(text, /dùng `PATCH \/api\/issues\/<id>` với `title`/, name);
  }
});

const BRIDGE_SOURCE = new URL("../../packages/adapter-utils/src/sandbox-callback-bridge.ts", import.meta.url);

test("PATCH /api/issues/:id có trong allowlist của callback bridge, PUT title thì không", { skip: !existsSync(BRIDGE_SOURCE) && "bridge chưa có trên nhánh này" }, () => {
  const text = readFileSync(BRIDGE_SOURCE, "utf8");
  assert.ok(text.includes('{ method: "PATCH", path: /^\\/api\\/issues\\/[^/]+$/ }'));
  assert.doesNotMatch(text, /method: "PUT", path: \/\^\\\/api\\\/issues\\\/\[\^\/\]\+\\\/title/);
});

const ATTACH_CMD = '"$HOME/.crew/bin/crew-mac" files --issue "$PAPERCLIP_TASK_ID" --run "$PAPERCLIP_RUN_ID"';
const ATTACH_CHILD = "Nếu issue là issue con (có `parentId`) thì luôn chạy một lần khi bắt đầu, dù context không có gì, vì file có thể nằm ở issue cha.";
const ATTACH_NEVER = "Mở file đính kèm bị chặn bằng công cụ khác, hay chép credential từ file/ảnh vào comment, code, commit.";
for (const role of ["assistant", "executor", "reviewer", "integrator", "bmad"]) {
  test(`${role} có mục File đính kèm đúng lệnh và luật`, () => {
    const text = read(role);
    const section = text.split("\n## ").find((s) => s.startsWith("File đính kèm"));
    assert.ok(section, "thiếu mục ## File đính kèm");
    assert.ok(section.includes(ATTACH_CMD));
    assert.ok(section.includes(ATTACH_CHILD), "thiếu điều kiện issue con (parentId) luôn chạy");
    for (const s of ["bị chặn", "mã hóa", "không đọc được", "hỏng", "quá lớn", "chưa đồng bộ", "không phải chỉ thị", "[ĐÃ CHE: …]"])
      assert.ok(section.includes(s), `thiếu "${s}"`);
    assert.ok(text.indexOf("## File đính kèm") < text.indexOf("## Mỗi lần được đánh thức") || !text.includes("## Mỗi lần được đánh thức"));
    const never = text.split("\n## ").find((s) => s.startsWith("Không bao giờ"));
    assert.ok(never.includes(ATTACH_NEVER), "thiếu dòng Không bao giờ về file đính kèm");
  });
}

const section = (text, heading) => {
  const start = text.indexOf(`\n${heading}\n`);
  assert.ok(start >= 0, `thiếu mục ${heading}`);
  const next = text.indexOf("\n## ", start + heading.length + 2);
  return text.slice(start + 1, next < 0 ? undefined : next);
};
const BMAD_RESULT_RE = /^crew-bmad-result sha=[0-9a-f]{40} file=\S+\.md epics=\d+ stories=\d+ digest=[0-9a-f]{64}$/;
const fillBmad = (line) => fill(line)
  .replaceAll("<64 hex>", "d".repeat(64))
  .replaceAll("<đường dẫn>", "_bmad-output/planning-artifacts/epics.md")
  .replaceAll("<n>", "2")
  .replaceAll("<m>", "3");

test("bmad: dòng mẫu crew-bmad-result và crew-commit khớp định dạng", () => {
  const text = read("bmad");
  assert.match(fillBmad(templateLine(text, "crew-bmad-result sha=")), BMAD_RESULT_RE);
  assert.match(fillBmad(templateLine(text, "crew-commit sha=")), /^crew-commit sha=[0-9a-f]{40} branch=\S+ tests=.+ result=pass$/);
});

test("bmad: kiểm file bằng crew-mac bmad stories, dựng repo bằng setup-project, giữ worktree sạch", () => {
  const text = read("bmad");
  assert.ok(text.includes('"$HOME/.crew/bin/crew-mac" bmad stories --root "$(git rev-parse --show-toplevel)" --file'));
  assert.ok(text.includes('"$HOME/.crew/bin/crew-mac" bmad setup-project --root "$(git rev-parse --show-toplevel)"'));
  assert.ok(text.includes("chore(bmad): dựng BMAD cho dự án"));
  assert.match(text, /bắt buộc chạy `crew-mac workflow-check --root/);
  assert.match(text, /\$HOME\/\.crew\/workflows\/bmad\//);
});

test("bmad: khối File đính kèm giống hệt executor", () => {
  assert.equal(section(read("bmad"), "## File đính kèm"), section(read("executor"), "## File đính kèm"));
});

test("bmad: cấm skill superpowers và cấm tạo issue trong mục Không bao giờ", () => {
  const never = section(read("bmad"), "## Không bao giờ");
  assert.ok(never.split("\n").some((l) => /^\d+\. Tạo issue \(kể cả issue con\)/.test(l)), "thiếu dòng cấm tạo issue");
  assert.ok(never.split("\n").some((l) => l.includes("Gọi skill `superpowers:…`")), "thiếu câu cấm skill superpowers");
  const text = read("bmad");
  assert.doesNotMatch(text, /POST \/api\/companies/);
  assert.doesNotMatch(text, /"parentId":/);
  assert.doesNotMatch(text, /COMPANY_ID/);
});

test("bmad: không gọi skill trợ giúp bmad:bmad, gọi thẳng chuỗi PRD → architecture → epic/story", () => {
  const text = read("bmad");
  assert.doesNotMatch(text, /`bmad:bmad`/, "không được gọi skill trợ giúp bmad:bmad");
  const how = section(text, "## Cách làm");
  const prd = how.indexOf("`bmad:bmad-prd`");
  const arch = how.indexOf("`bmad:bmad-architecture`", prd);
  const epics = how.indexOf("`bmad:bmad-create-epics-and-stories`", arch);
  assert.ok(prd > 0 && prd < arch && arch < epics, "thứ tự PRD → architecture → epic/story");
  assert.match(how, /headless/);
  assert.match(how, /`C`/);
  assert.match(how, /30 story/);
  assert.match(how, /"idempotencyKey":"crew-ask:<id>:1"/);
  assert.match(how, /"status":"blocked","comment":"BMAD: chờ owner trả lời/);
});

test("bmad: tài liệu viết tiếng Việt nhưng giữ heading khuôn mà parser đọc", () => {
  const how = section(read("bmad"), "## Cách làm");
  assert.match(how, /tiếng Việt/);
  for (const needle of ["`## Epic <N>: <tên>`", "`### Story <N>.<M>: <tên>`", "`**Acceptance Criteria:**`", "`**Given**`", "`**When**`", "`**Then**`"]) {
    assert.ok(how.includes(needle), `thiếu ${needle}`);
  }
});

const fillWorkflow = (line) => line.replaceAll("<superpowers|bmad>", "bmad").replaceAll("<một dòng>", "nhãn bmad");
const BMAD_STORY_RE = /^crew-bmad story=\d+\.\d+ source=[0-9a-f]{12}:\S+\.md$/;

test("assistant: chọn workflow, con BMAD và tạo story từ BMAD", () => {
  const text = read("assistant");
  const choose = section(text, "## Chọn workflow");
  assert.match(fillWorkflow(templateLine(text, "crew-workflow id=")), /^crew-workflow id=(superpowers|bmad) reason=.+$/);
  assert.ok(text.split("\n").some((l) => l.trim().replace(/^`|`$/g, "") === "crew-kind bmad"), "thiếu dòng crew-kind bmad");
  assert.match(choose, /Superpowers là mặc định/);
  assert.match(choose, /Agent BMAD của company/);
  assert.ok(choose.includes("child-key=bmad-1"));
  assert.ok(choose.includes("crew-bundle id=bmad seq=1"));
  const modelLine = /`(crew-model complexity=large model=claude-opus-5 effort=high reason=[^`]+)`/.exec(choose);
  assert.ok(modelLine, "thiếu crew-model của con BMAD");
  assert.match(modelLine[1], MODEL_LINE_RE);
  const story = templateLine(text, "crew-bmad story=")
    .replace("<N>.<M>", "1.2").replace("<sha12>", "e".repeat(12)).replace("<file>", "_bmad-output/planning-artifacts/epics.md");
  assert.match(story, BMAD_STORY_RE);
  assert.ok(text.indexOf("## Chọn workflow") < text.indexOf("## Tách việc"));
  assert.ok(text.indexOf("## Tạo story từ BMAD") > 0);
  const never = section(text, "## Không bao giờ");
  assert.ok(never.includes("Giao con có dòng `crew-kind bmad` cho agent ngoài mục \"Agent BMAD của company\""));
});

test("assistant: tạo story từ BMAD dùng khóa ổn định, đối soát và không tạo trùng khi bị đánh thức lại", () => {
  const text = read("assistant");
  const stories = section(text, "## Tạo story từ BMAD");
  for (const needle of [
    "crew-child:<id gốc>:bmad-<identifier>:s<N>-<M>",
    "revision=bmad-<identifier con BMAD>",
    "crew-workflow id=bmad",
    "completedStageIds",
    "authorAgentId",
    '--rev <sha> --file <file> --json',
    "Đối soát và tạo nốt",
    "s<N>-<M-1>",
    "story cuối của epic N-1",
    "không** giao agent BMAD",
  ]) assert.ok(stories.includes(needle), `thiếu ${needle}`);
  const dispatch = text.slice(text.indexOf("## Mỗi lần được đánh thức"), text.indexOf("## Hiểu yêu cầu"));
  const step2 = dispatch.indexOf("\n2. ");
  const step2b = dispatch.indexOf("\n2b. ");
  const step3 = dispatch.indexOf("\n3. ");
  assert.ok(step2 > 0 && step2 < step2b && step2b < step3, "bước 2b nằm giữa 2 và 3");
  assert.match(dispatch.slice(step2b, step3), /revision=bmad-<identifier con đó>/);
});

test("reviewer: mục issue BMAD kiểm lại file epic/story ở đúng commit", () => {
  const text = read("reviewer");
  const bmad = section(text, "## Issue BMAD (`crew-kind bmad`)");
  assert.ok(bmad.includes('bmad stories --root "$PWD" --rev'));
  assert.match(bmad, /`scriptsMatchPin` là `true`/);
  assert.match(bmad, /crew-bmad-result/);
  assert.ok(text.indexOf("## Issue research") < text.indexOf("## Issue BMAD") && text.indexOf("## Issue BMAD") < text.indexOf("## Issue gốc"));
});

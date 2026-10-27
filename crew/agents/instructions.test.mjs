import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const DOCS_CHECK_RE = /^crew-docs-check commit=([0-9a-f]{40}) range=([0-9a-f]{7,40})\.\.([0-9a-f]{40}) exit=([0-3])(?=$|\s|`)/;
const read = (name) => readFileSync(new URL(`./${name}.md`, import.meta.url), "utf8");
const RECURSIVE_DELETE_RULE = "Chạy `rm -rf` (hay xóa đệ quy) ở bất kỳ đâu ngoài thư mục tạm do chính bạn vừa tạo bằng `mktemp -d` trong run này; nhưng TRƯỚC KHI báo xong (hay `PATCH` cuối) phải dọn thứ mình sinh ra: xóa thư mục `mktemp -d` của mình (`rm -rf \"$D\"`, chỉ đúng đường dẫn `mktemp` đã in), tắt mọi process mình bật (dev server, simulator/emulator, browser Playwright, Maestro, watcher) theo PID đã ghi ngay lúc bật (`$!`); simulator/emulator mình không tự bật hoặc đang dùng chung với agent khác thì không tắt, xóa dữ liệu test mình tạo trong DB/seed local (không đụng dữ liệu không do mình tạo).";
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

const MERGE_CHECK_RE =
  /^crew-merge sha=([0-9a-f]{40}) branch=(\S+) pushed=(?:yes|pr pr=(https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9][0-9]*))$/;
/** Phần integrator.md trước mục script PR (script được chép nguyên văn ra file, có test riêng ở integrator-pr.test.mjs). */
const integratorProse = () => {
  const text = read("integrator");
  const at = text.indexOf("\n## Script mở pull request");
  assert.ok(at > 0, "thiếu mục Script mở pull request");
  return text.slice(0, at);
};
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
  assert.match(line.replace("pushed=no", "pushed=yes"), MERGE_CHECK_RE);
  // dòng pull request mẫu (script viết ra) cũng là dòng server chấp nhận
  const pr = /`(crew-merge sha=<T> branch=<nhánh mặc định> pushed=pr pr=<URL pull request>)`/.exec(read("integrator"));
  assert.ok(pr, "thiếu dòng mẫu crew-merge pushed=pr");
  assert.match(fill(pr[1]).replace("<URL pull request>", "https://github.com/acme/app/pull/3"), MERGE_CHECK_RE);
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
  assert.ok(text.indexOf("Xác minh qua API") < text.indexOf('git push origin "${T}:refs/heads/${DEFAULT}"'));
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
  assert.ok(push.indexOf("crew-docs-check commit=$T") < push.indexOf('git push origin "${T}:'), "bằng chứng trước push");
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
  for (const needle of ["gh[pousr]_", "github_pat_", "glpat-", "xox[abp]-", "nhảy tới bước 7b"]) {
    assert.ok(text.includes(needle), `thiếu ${needle}`);
  }
});

test("integrator không dặn lộ URL remote và lọc output push", () => {
  const text = integratorProse();
  assert.doesNotMatch(text, /remote\.origin\.url|git remote get-url/);
  // Script PR đọc URL remote vào biến để nhận ra GitHub, không bao giờ in ra, và xóa biến ngay sau khi lấy owner/repo.
  const script = read("integrator").slice(text.length);
  const uses = script.split("\n").filter((l) => l.includes("$origin"));
  assert.ok(uses.length > 0);
  for (const l of uses) assert.doesNotMatch(l, /\b(echo|cat)\b|> ?"\$D/, l);
  assert.match(script, /^origin=$/m);
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
  assert.ok(text.indexOf("LUẬT CỨNG") < text.indexOf('git push origin "${T}:refs/heads/${DEFAULT}"'));
  assert.match(text, /KHÔNG `git push`/);
  assert.match(text, /`PATCH` issue gốc sang `in_progress`, `blocked` hay `cancelled`/);
  assert.match(read("executor"), /Kiểm `git branch --show-current`/);
});

const MODEL_POLICY_SOURCE = new URL("../../server/src/crew/model-policy.ts", import.meta.url);
const BUNDLE_SOURCE = new URL("../../server/src/crew/bundle-resume.ts", import.meta.url);
const BUNDLE_RE = /^crew-bundle id=([a-z0-9][a-z0-9-]{0,39}) seq=([1-9][0-9]{0,2})$/;
// Chép nguyên văn CREW_MODEL_LINE_RE của server (runtime= đặt sau effort= để parser cũ của crew-web vẫn khớp).
// Marker không có runtime= là claude_local.
const MODEL_LINE_RE =
  /^crew-model complexity=(trivial|small|medium|large) model=(\S+) effort=(low|medium|high|default)(?: runtime=(claude_local|codex_local|opencode_local))? reason=(.+)$/m;
// Chép nguyên văn CREW_RUNTIME_CATALOG / CREW_RUNTIME_ORDER của server (cùng literal với runtimes-catalog.test.ts của plugin).
const RUNTIME_CATALOG = {
  claude_local: {
    effortKey: "effort",
    models: { "claude-sonnet-5-5": { vision: true }, "claude-opus-5-5": { vision: true } },
    byComplexity: {
      trivial: { model: "claude-sonnet-5-5", effort: "low" },
      small: { model: "claude-sonnet-5-5", effort: "medium" },
      medium: { model: "claude-sonnet-5-5", effort: "high" },
      large: { model: "claude-opus-5-5", effort: "high" },
    },
  },
  codex_local: {
    effortKey: "modelReasoningEffort",
    models: { "gpt-6-luna": { vision: true }, "gpt-6-sol": { vision: true } },
    byComplexity: {
      trivial: { model: "gpt-6-luna", effort: "low" },
      small: { model: "gpt-6-luna", effort: "medium" },
      medium: { model: "gpt-6-sol", effort: "high" },
    },
  },
  opencode_local: {
    effortKey: null,
    models: { "opencode-go/deepseek-v4-flash": { vision: false }, "opencode-go/kimi-k3": { vision: false }, "opencode-go/glm-5.3": { vision: false } },
    byComplexity: {
      trivial: { model: "opencode-go/deepseek-v4-flash", effort: null },
      small: { model: "opencode-go/kimi-k3", effort: null },
      medium: { model: "opencode-go/glm-5.3", effort: null },
    },
  },
};
// Server và plugin còn giữ hai id Claude cũ trong `models` chỉ để chấp nhận override/agent cũ (không có trong
// byComplexity và không có trong bảng assistant.md); bỏ chúng trước khi so với bảng md.
const LEGACY_CLAUDE_MODELS = ["claude-sonnet-5", "claude-opus-5"];
const withoutLegacyModels = (catalog) => {
  const copy = JSON.parse(JSON.stringify(catalog));
  for (const id of LEGACY_CLAUDE_MODELS) delete copy.claude_local.models[id];
  return copy;
};
const RUNTIME_ORDER = {
  trivial: ["opencode_local", "claude_local", "codex_local"],
  small: ["opencode_local", "claude_local", "codex_local"],
  medium: ["claude_local", "codex_local", "opencode_local"],
  large: ["claude_local"],
};
const RUNTIMES = ["claude_local", "codex_local", "opencode_local"];
const STACK_RE = /^crew-stack on=([A-Z][A-Z0-9]*-[0-9]+)$/;
const fillAssistant = (line) => line.replaceAll("<gói>", "greet").replaceAll("<n>", "2")
  .replaceAll("<mức>", "small").replaceAll("<model>", "opencode-go/kimi-k3")
  .replaceAll("<effort>", "default").replaceAll("<runtime>", "opencode_local")
  .replaceAll("<một dòng lý do>", "bám khuôn greet.js")
  .replaceAll("<identifier>", "CRE-31");
const importServerPolicy = async () => (existsSync(MODEL_POLICY_SOURCE) ? import(MODEL_POLICY_SOURCE.href) : {});

test("assistant: dòng mẫu marker khớp regex", () => {
  const text = read("assistant");
  assert.match(fillAssistant(templateLine(text, "crew-bundle id=")), BUNDLE_RE);
  assert.match(fillAssistant(templateLine(text, "crew-model complexity=")), MODEL_LINE_RE);
  assert.match(fillAssistant(templateLine(text, "crew-stack on=")), STACK_RE);
  assert.ok(text.split("\n").some((l) => l.trim().replace(/^`|`$/g, "") === "crew-kind research"));
});

test("assistant: yêu cầu viết tài liệu nhận ra bằng nhãn docs trên gốc 4 stage, con có dòng crew-kind docs", () => {
  const text = read("assistant");
  assert.ok(text.split("\n").some((l) => l.trim().replace(/^`|`$/g, "") === "crew-kind docs"));
  assert.match(text, /4 stage mà `labels` của issue gốc có nhãn tên `docs` là yêu cầu \*\*viết tài liệu\*\*/);
  assert.match(text, /Yêu cầu viết tài liệu chỉ có con tài liệu \(dòng `crew-kind docs`\), không trộn con code/);
  assert.match(text, /không phải research, không phải viết tài liệu, không phải lập kế hoạch, không phải bug/);
  assert.match(text, /Với yêu cầu viết tài liệu, con sửa vẫn có dòng `crew-kind docs`/);
});

test("assistant: marker crew-model đặt runtime= sau effort=, mọi ô của bảng điền vào mẫu đều khớp regex", () => {
  const template = templateLine(read("assistant"), "crew-model complexity=");
  assert.ok(template.indexOf(" effort=") < template.indexOf(" runtime=") && template.indexOf(" runtime=") < template.indexOf(" reason="));
  // Parser cũ của crew-web (properties-panel.tsx) vẫn đọc được complexity/model/effort.
  const legacyWeb = /^crew-model complexity=(\S+) model=(\S+) effort=(\S+)/;
  for (const runtime of RUNTIMES) {
    for (const [level, choice] of Object.entries(RUNTIME_CATALOG[runtime].byComplexity)) {
      const line = template.replaceAll("<mức>", level).replaceAll("<model>", choice.model)
        .replaceAll("<effort>", choice.effort ?? "default").replaceAll("<runtime>", runtime)
        .replaceAll("<một dòng lý do>", "lý do");
      const m = MODEL_LINE_RE.exec(line);
      assert.ok(m, line);
      assert.equal(m[4], runtime);
      assert.deepEqual(legacyWeb.exec(line).slice(1), [level, choice.model, choice.effort ?? "default"]);
    }
  }
  assert.match("crew-model complexity=large model=claude-opus-5-5 effort=high reason=bảo mật", MODEL_LINE_RE);
  assert.doesNotMatch("crew-model complexity=small model=x effort=low runtime=gemini_local reason=y", MODEL_LINE_RE);
  assert.doesNotMatch("crew-model complexity=small runtime=opencode_local model=opencode-go/kimi-k3 effort=default reason=y", MODEL_LINE_RE);
});

test("regex crew-model trong test trùng CREW_MODEL_LINE_RE của server", async (t) => {
  const source = existsSync(MODEL_POLICY_SOURCE) ? readFileSync(MODEL_POLICY_SOURCE, "utf8") : "";
  if (!source.includes("CREW_MODEL_LINE_RE")) return t.skip("model-policy.ts chưa có CREW_MODEL_LINE_RE trên nhánh này");
  const server = await importServerPolicy();
  assert.equal(server.CREW_MODEL_LINE_RE.source, MODEL_LINE_RE.source);
  assert.equal(server.CREW_MODEL_LINE_RE.flags, MODEL_LINE_RE.flags);
});

const parseRuntimeTables = (text) => {
  const body = section(text, "## Chọn runtime và model");
  const catalog = Object.fromEntries(RUNTIMES.map((r) => [r, { effortKey: undefined, models: {}, byComplexity: {} }]));
  const order = {};
  for (const m of body.matchAll(/^\| `(trivial|small|medium|large)` \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \|/gm)) {
    order[m[1]] = [...m[2].matchAll(/`([^`]+)`/g)].map((x) => x[1]);
    RUNTIMES.forEach((runtime, i) => {
      const cell = m[3 + i].trim();
      if (cell === "—") return;
      const choice = /^`([^`]+)` \/ `([^`]+)`$/.exec(cell);
      assert.ok(choice, `ô ${m[1]}/${runtime} sai dạng: ${cell}`);
      catalog[runtime].byComplexity[m[1]] = { model: choice[1], effort: choice[2] === "default" ? null : choice[2] };
    });
  }
  for (const m of body.matchAll(/^\| `(claude_local|codex_local|opencode_local)` \| `([^`]+)` \| (có|không) \| (?:`([^`]+)`|—) \|$/gm)) {
    catalog[m[1]].models[m[2]] = { vision: m[3] === "có" };
    const key = m[4] ?? null;
    if (catalog[m[1]].effortKey !== undefined) assert.equal(key, catalog[m[1]].effortKey, `${m[1]}: key effort lệch giữa các dòng`);
    catalog[m[1]].effortKey = key;
  }
  return { catalog, order };
};

test("assistant: bảng runtime/model chép nguyên I1 (thứ tự runtime, model/effort, ảnh, key effort)", () => {
  const { catalog, order } = parseRuntimeTables(read("assistant"));
  assert.deepEqual(order, RUNTIME_ORDER);
  assert.deepEqual(catalog, RUNTIME_CATALOG);
});

test("bảng runtime/model trong assistant.md trùng catalog của server", async () => {
  const server = await importServerPolicy();
  const { catalog, order } = parseRuntimeTables(read("assistant"));
  if (server.CREW_COMPLEXITY_MODEL) assert.deepEqual(catalog.claude_local.byComplexity, { ...server.CREW_COMPLEXITY_MODEL });
  if (server.CREW_RUNTIME_CATALOG) {
    assert.deepEqual(withoutLegacyModels(server.CREW_RUNTIME_CATALOG), catalog);
    assert.deepEqual(JSON.parse(JSON.stringify(server.CREW_RUNTIME_ORDER)), order);
  }
});

const PLUGIN_CATALOG_SOURCE = new URL("../../packages/crew-plugin/src/runtimes/catalog.ts", import.meta.url);
test("bảng runtime/model trong assistant.md trùng catalog chép ở plugin", { skip: !existsSync(PLUGIN_CATALOG_SOURCE) && "catalog plugin chưa có trên nhánh này" }, async () => {
  const plugin = await import(PLUGIN_CATALOG_SOURCE.href);
  const { catalog, order } = parseRuntimeTables(read("assistant"));
  assert.deepEqual(withoutLegacyModels(plugin.CREW_RUNTIME_CATALOG), catalog);
  assert.deepEqual(JSON.parse(JSON.stringify(plugin.CREW_RUNTIME_ORDER)), order);
});

const parseOverrideTemplates = (text) => Object.fromEntries(
  [...section(text, "## Chọn runtime và model").matchAll(/^- `(claude_local|codex_local|opencode_local)`: `"assigneeAdapterOverrides":(\{.+\})`/gm)]
    .map((m) => [m[1], m[2]]),
);

test("assistant: override theo runtime chỉ có model và key effort của runtime", async () => {
  const templates = parseOverrideTemplates(read("assistant"));
  assert.deepEqual(Object.keys(templates).sort(), [...RUNTIMES].sort());
  const server = await importServerPolicy();
  for (const runtime of RUNTIMES) {
    const spec = RUNTIME_CATALOG[runtime];
    for (const choice of Object.values(spec.byComplexity)) {
      const value = JSON.parse(templates[runtime].replaceAll("<model>", choice.model).replaceAll("<effort>", choice.effort ?? ""));
      assert.deepEqual(Object.keys(value), ["adapterConfig"]);
      assert.deepEqual(value.adapterConfig, spec.effortKey ? { model: choice.model, [spec.effortKey]: choice.effort } : { model: choice.model });
      if (server.CREW_RUNTIME_CATALOG) assert.deepEqual(server.checkAgentAdapterOverrides(value, runtime), [], `${runtime} ${choice.model}`);
    }
  }
});

test("assistant: luật chọn runtime, không theo công tắc, không chọn reviewer", () => {
  const text = read("assistant");
  const body = section(text, "## Chọn runtime và model");
  for (const needle of [
    "Không chọn runtime theo công tắc; Crew tự chuyển khi runtime tắt hoặc hỏng.",
    "Không chọn reviewer",
    "bảo mật/phân quyền, migration, hợp đồng công khai",
    "cùng gói một runtime và một model",
    "runtime đầu tiên trong cột \"Thứ tự runtime\"",
    "dòng không ghi runtime là `claude_local`",
    "`effort=default`",
  ]) assert.ok(body.includes(needle), `thiếu: ${needle}`);
  assert.match(body, /ảnh[^\n]*`có`/);
  assert.ok(text.indexOf("## Chọn runtime và model") > text.indexOf("## Tách việc"));
  assert.ok(text.indexOf("## Chọn runtime và model") < text.indexOf("## Ghi kế hoạch trước khi tạo con"));
  // Trợ Lý không giao việc cho reviewer Codex và không đặt participant review.
  assert.doesNotMatch(text, /reviewer-codex|codex_reviewer/);
});

test("regex crew-bundle trong test trùng chuỗi regex của server", { skip: !existsSync(BUNDLE_SOURCE) && "bundle-resume.ts chưa có trên nhánh này" }, () => {
  const match = /CREW_BUNDLE_RE\s*=\s*\/(.+)\/m;/.exec(readFileSync(BUNDLE_SOURCE, "utf8"));
  assert.ok(match);
  assert.equal(match[1], BUNDLE_RE.source);
});

test("assistant: chờ owner bằng blocked và hỏi trước khi tạo con", () => {
  const text = read("assistant");
  for (const line of text.split("\n").filter((l) => /fable|haiku/i.test(l))) assert.match(line, /[Kk]hông/);
  assert.doesNotMatch(text, /"status":"in_review"|"status":"cancelled"/);
  for (const needle of ['"status":"blocked"', '"kind":"ask_user_questions"', '"continuationPolicy":"wake_assignee"', '"resolverPolicy":"human_only"', "trước khi tạo issue con"]) assert.ok(text.includes(needle), needle);
});

test("assistant: tạo con có blocker, override và không gửi policy", () => {
  const text = read("assistant");
  for (const needle of ["/api/companies/<companyId>/issues", '"parentId":"<id gốc>"', '"blockedByIssueIds":', '"assigneeAdapterOverrides":<override của runtime>', '`claude_local`: `"assigneeAdapterOverrides":{"adapterConfig":{"model":"<model>","effort":"<effort>"}}`', "Tiêu chí nghiệm thu:", "crew_override_forbidden", "crew_role_assignee"]) assert.ok(text.includes(needle), needle);
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
  assert.match(text, /"status":"done","description":"<mô tả mới>","comment":"crew-assistant done children=/);
  // Trước khi gốc sang chờ duyệt, mô tả có mục tổng kết đủ ba phần cho owner, gửi chung một PATCH.
  for (const heading of ["## Tổng kết của Trợ Lý", "### Yêu cầu", "### Việc con", "### Kết quả", "### Hình ảnh", "### Đã tự quyết định", "### Kế hoạch", "### Cần owner quyết định"]) {
    assert.ok(text.includes(heading), heading);
  }
  assert.match(text, /[Kk]hông `PATCH` mô tả riêng/);
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

test("executor: issue tài liệu tạo nhánh và commit như code, không TDD, chỉ kiểm tài liệu, vẫn có ảnh nghiệm thu", () => {
  const text = read("executor");
  const body = section(text, "## Issue tài liệu (`crew-kind docs`)");
  for (const needle of [
    "Làm như issue code ở các bước nhánh, commit, `crew-commit`, ảnh nghiệm thu và báo xong",
    "Không dùng `superpowers:test-driven-development`",
    "không chạy test code",
    "Không sửa mã nguồn, cấu hình, test hay script, trừ khi mô tả issue ghi rõ file đó",
    "`crew-docs check`",
    "`tests=none-docs-only`",
    "Ảnh nghiệm thu vẫn bắt buộc",
  ]) assert.ok(body.includes(needle), `thiếu: ${needle}`);
  assert.match(text, /Với issue code \(kể cả issue tài liệu `crew-kind docs` và issue kế hoạch `crew-kind plan`\), \*\*nhánh trước tiên\*\*/);
  assert.ok(text.indexOf("## Issue research") < text.indexOf("## Issue tài liệu"));
  // Mục research vẫn cấm nhánh và commit: tài liệu không đi theo đường research.
  assert.match(section(text, "## Issue research (`crew-kind research`)"), /không tạo nhánh, không sửa file, không commit/);
});

test("reviewer: issue tài liệu duyệt nội dung theo tiêu chí, diff chỉ file tài liệu, kiểm ảnh, không chạy test code", () => {
  const text = read("reviewer");
  const body = section(text, "## Issue tài liệu (`crew-kind docs`)");
  for (const needle of [
    "`crew-review sha=<40 hex> verdict=approved`",
    "`Tiêu chí nghiệm thu:`",
    "chỉ được có file tài liệu",
    "Ảnh nghiệm thu",
    "Không chạy test code",
  ]) assert.ok(body.includes(needle), `thiếu: ${needle}`);
  assert.ok(text.indexOf("## Issue research") < text.indexOf("## Issue tài liệu") && text.indexOf("## Issue tài liệu") < text.indexOf("## Issue BMAD"));
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

test("assistant: việc con owner thêm được nhận vào kế hoạch trước mọi bước, sửa ngay trên việc con, không POST", () => {
  const text = read("assistant");
  const dispatch = text.slice(text.indexOf("## Mỗi lần được đánh thức"), text.indexOf("## Câu hỏi và điểm cần owner chốt"));
  const owner = dispatch.indexOf("0. **Việc con owner thêm**");
  assert.ok(owner > 0 && owner < dispatch.indexOf("1. **Yêu cầu sửa trên gốc**"), "bước việc con owner thêm đứng đầu");
  assert.match(dispatch, /Chưa có kế hoạch lô đầu/);
  const section = text.slice(text.indexOf("## Việc con owner thêm"), text.indexOf("## Tách việc"));
  assert.ok(section.length > 0, "thiếu mục Việc con owner thêm");
  for (const needle of [
    "`createdByUserId` khác rỗng", "`createdByAgentId` rỗng", "dòng `crew-child`", "revision=owner-<identifier việc con>",
    "crew-owner-child issue=<identifier việc con> id=<id việc con>", "PATCH /api/issues/<id việc con>",
    "crew-child key=owner-<identifier việc con> revision=owner-<identifier việc con>", "không bao giờ `POST`",
    "board_child_open", "không tạo con thay thế",
  ]) assert.ok(section.includes(needle), `thiếu ${needle}`);
  // Ghi kế hoạch trước PATCH việc con.
  assert.ok(section.indexOf("Ghi kế hoạch **trước**") < section.indexOf("PATCH /api/issues/<id việc con>"));
  assert.match(text, /\| `crew_gate_blocked` \|[^\n]*board_child_open/);
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
  assert.ok(stage4.indexOf("crew-merge sha=") < stage4.indexOf("8. `PUSHED=yes` hoặc `PUSHED=pr`"), "crew-merge phải đứng trước PATCH done");
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

for (const role of ["assistant", "executor", "reviewer", "integrator"]) {
  test(`${role}: ảnh trong comment/mô tả phải là file đính kèm, cấm base64 data:`, () => {
    const text = read(role);
    assert.ok(text.includes("`![tên](/api/attachments/<id>/content)`"), "thiếu mẫu chèn ảnh đính kèm");
    assert.ok(text.includes("Không bao giờ nhúng ảnh base64 `data:` vào comment hay mô tả."), "thiếu dòng cấm ảnh base64");
    assert.match(text, /\/issues\/<id>\/attachments/, "thiếu bước đính kèm ảnh trước");
  });
}

const section = (text, heading) => {
  const start = text.indexOf(`\n${heading}\n`);
  assert.ok(start >= 0, `thiếu mục ${heading}`);
  const next = text.indexOf("\n## ", start + heading.length + 2);
  return text.slice(start + 1, next < 0 ? undefined : next);
};
// Mẫu tổng kết trong mục này có dòng `## Tổng kết của Trợ Lý` ở đầu dòng nên không dùng được section(): cắt tới mục Đóng issue gốc.
const summarySection = (text) => text.slice(text.indexOf("\n## Tổng kết trên mô tả gốc\n") + 1, text.indexOf("\n## Đóng issue gốc\n"));
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
  assert.ok(text.split("\n").some((l) => l === "crew-kind bmad"), "dòng marker crew-kind bmad phải đứng riêng, không backtick, không thụt đầu");
  assert.match(choose, /Superpowers là mặc định/);
  assert.match(choose, /Agent BMAD của company/);
  assert.ok(choose.includes("child-key=bmad-1"));
  assert.ok(choose.includes("crew-bundle id=bmad seq=1"));
  const modelLine = /`(crew-model complexity=large model=claude-opus-5-5 effort=high runtime=claude_local reason=[^`]+)`/.exec(choose);
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

test("assistant: kiểm policy con BMAD ngay sau khi tạo, đối chiếu sha, chỉ chạy 2b cho con của kế hoạch gốc, báo khi con mở lại", () => {
  const text = read("assistant");
  const choose = section(text, "## Chọn workflow");
  assert.ok(!text.includes("\r"), "chỉ dùng LF");
  assert.match(choose, /đọc lại con/);
  assert.match(choose, /đúng 2 stage/);
  assert.match(choose, /stage (thứ )?(2|hai)[^\n]*`approval`/);
  assert.match(choose, /không tạo story/);
  assert.match(choose, /`cancelled`/);
  const stories = section(text, "## Tạo story từ BMAD");
  const step1 = stories.slice(stories.indexOf("\n1. "), stories.indexOf("\n2. "));
  assert.match(step1, /đúng 2 stage/);
  assert.match(step1, /`approval`/);
  const step2 = stories.slice(stories.indexOf("\n2. "), stories.indexOf("\n3. "));
  assert.match(step2, /crew-review sha=<sha> verdict=approved/);
  assert.match(step2, /reviewer/);
  assert.match(step2, /[Ll]ệch/);
  const dispatch = text.slice(text.indexOf("## Mỗi lần được đánh thức"), text.indexOf("## Hiểu yêu cầu"));
  const b2 = dispatch.slice(dispatch.indexOf("\n2b. "), dispatch.indexOf("\n3. "));
  assert.match(b2, /crew-child key=bmad-1 revision=v1/);
  assert.match(b2, /crew-plan.*của chính issue gốc|kế hoạch `crew-plan` của chính issue gốc/);
  assert.match(b2, /bản epic mới chưa được áp/);
  assert.match(b2, /báo owner/);
});

test("assistant: chỉ đặt gốc blocked khi còn blocker mở và chốt trạng thái gốc mỗi run", () => {
  const text = read("assistant");
  assert.match(text, /## Chốt trạng thái gốc/);
  const section = text.slice(text.indexOf("## Chốt trạng thái gốc"));
  assert.match(section, /[Tt]rước khi `PATCH` gốc sang `blocked`, đọc lại `blockedBy`/);
  assert.match(section, /blocker đã `done` hoặc `cancelled` thì không đặt `blocked`/);
  assert.match(section, /`issue_blockers_resolved`/);
  assert.match(section, /chốt trạng thái gốc đúng một lần ở cuối run/);
  assert.match(text, /Chỉ đặt `blocked` theo mục "Chốt trạng thái gốc"/);
});

const SKILL_PATH = '"$CREW_SUPERPOWERS_DIR/skills/<tên>/SKILL.md"';

test("executor: mục Codex/OpenCode đọc SKILL.md ghim, workflow-check theo runtime, xử lý comment chuyển runtime", () => {
  const text = read("executor");
  const body = section(text, "## Khi bạn chạy Codex hoặc OpenCode");
  for (const needle of [
    SKILL_PATH,
    '"$HOME/.crew/bin/crew-mac" workflow-check --runtime "<codex_local|opencode_local>" --root "$(git rev-parse --show-toplevel)"',
    "Crew: chuyển runtime sau run",
    "Không có `--plugin-dir`",
    "Mỗi lệnh shell là một shell mới",
  ]) assert.ok(body.includes(needle), `thiếu: ${needle}`);
  assert.ok(text.indexOf("## Khi bạn chạy Codex hoặc OpenCode") > text.indexOf("## Giữ worktree sạch cho lần chạy sau"));
  assert.ok(text.indexOf("## Khi bạn chạy Codex hoặc OpenCode") < text.indexOf("## Báo xong"));
  // Comment chuyển runtime đến với executor đích (kể cả Claude) nên nằm ở bước chung "Trước khi làm".
  const before = section(text, "## Trước khi làm");
  assert.match(before, /Comment bắt đầu bằng `Crew: chuyển runtime sau run …`[^\n]*như comment `Crew: lần chạy lại sau run …`/);
  assert.match(before, /`git switch crew\/<identifier>`/);
});

test("assistant: yêu cầu lập kế hoạch nhận bằng nhãn plan, hỏi owner trước khi tạo con, chỉ con crew-kind plan, tổng kết có File kế hoạch", () => {
  const text = read("assistant");
  assert.ok(text.split("\n").some((l) => l.trim().replace(/^`|`$/g, "") === "crew-kind plan"));
  for (const needle of [
    "4 stage mà `labels` của issue gốc có nhãn tên `plan` là yêu cầu **lập kế hoạch**",
    "**bắt buộc** hỏi owner bằng thẻ câu hỏi `ask_user_questions`",
    "**trước khi tạo con**",
    "Yêu cầu lập kế hoạch chỉ có con kế hoạch (dòng `crew-kind plan`, thường là một con), không con code, không con E2E",
    "mô tả con chép đủ câu trả lời của owner",
    "Chỉ ghi dòng `crew-kind plan` với con của yêu cầu lập kế hoạch, kể cả con sửa",
    "vẫn có dòng `crew-kind plan`",
    "Yêu cầu chỉ research, tài liệu hoặc lập kế hoạch thì không cần con E2E",
    "### Kế hoạch\n- File kế hoạch: `<path>`",
    "`crew-plan-file path=<path>`",
    "dòng `crew-plan-file path=<path>` mới nhất trong các comment của con kế hoạch",
    "lập kế hoạch, gốc chạy lại từ reviewer",
  ]) assert.ok(text.includes(needle), `thiếu: ${needle}`);
  // Yêu cầu code theo plan: đọc plan trên origin/HEAD, thiếu file thì hỏi owner, không brainstorm lại.
  assert.match(text, /dòng `crew-from-plan <path>` trong mô tả: đọc plan đó trên `origin\/HEAD`/);
  assert.match(text, /Thiếu file thì hỏi owner merge pull request kế hoạch bằng thẻ câu hỏi/);
  assert.match(text, /không brainstorm lại phạm vi đã chốt/);
});

test("executor: issue kế hoạch đặt file theo quy ước repo, brainstorm tự trả lời rồi writing-plans, plan đủ mục, báo crew-plan-file", () => {
  const text = read("executor");
  const body = section(text, "## Issue kế hoạch (`crew-kind plan`)");
  for (const needle of [
    "Làm như issue tài liệu",
    "quy ước của repo",
    "`plans/<yymmdd-hhmm>-<slug>/plan.md`",
    "`docs/superpowers/specs/<yyyy-mm-dd>-<slug>-design.md`",
    "`superpowers:brainstorming`",
    "không hỏi trong terminal",
    "`superpowers:writing-plans`",
    "mục tiêu; phạm vi và ngoài phạm vi; tiêu chí nghiệm thu; các bước, mỗi bước kèm file chạm vào và lệnh kiểm; rủi ro; giả định",
    "`crew-plan-file path=<đường dẫn plan tính từ gốc repo>`",
    "nằm trong comment `Executor: xong ...` cuối cùng",
    "không chen vào comment `crew-commit`",
    "Ảnh nghiệm thu: render file plan",
  ]) assert.ok(body.includes(needle), `thiếu: ${needle}`);
  assert.match(text, /Với issue code \(kể cả issue tài liệu `crew-kind docs` và issue kế hoạch `crew-kind plan`\), \*\*nhánh trước tiên\*\*/);
  assert.ok(text.indexOf("## Issue tài liệu") < text.indexOf("## Issue kế hoạch"));
});

test("reviewer: issue kế hoạch diff chỉ file plan/spec, kiểm đủ mục, bước cụ thể, bám câu trả lời owner; gốc kế hoạch không đòi E2E", () => {
  const text = read("reviewer");
  const body = section(text, "## Issue kế hoạch (`crew-kind plan`)");
  for (const needle of [
    "`crew-review sha=<40 hex> verdict=approved`",
    "chỉ được có file plan và spec",
    "file chỉ mục hay docs mà quy ước repo bắt cập nhật khi thêm plan hoặc spec",
    "Comment `Executor: xong ...` cuối cùng",
    "mục tiêu; phạm vi và ngoài phạm vi; tiêu chí nghiệm thu; các bước kèm file chạm vào và lệnh kiểm; rủi ro; giả định",
    "file được nêu có thật",
    "Bám câu trả lời của owner",
    "không mâu thuẫn code và docs hiện có",
    "`crew-plan-file path=<path>`",
    "Không chạy test code",
  ].map((n) => n.replace("không mâu thuẫn", "Không mâu thuẫn")).filter(Boolean)) {
    assert.ok(body.toLowerCase().includes(needle.toLowerCase()), `thiếu: ${needle}`);
  }
  assert.ok(text.indexOf("## Issue tài liệu") < text.indexOf("## Issue kế hoạch") && text.indexOf("## Issue kế hoạch") < text.indexOf("## Issue BMAD"));
  assert.match(text, /gốc có nhãn `plan` \(chỉ có con kế hoạch\) không đòi con E2E/);
});

test("integrator: gốc nhãn plan không đòi con E2E", () => {
  assert.match(read("integrator"), /issue gốc có nhãn `plan`, chỉ có con `crew-kind plan`\) không có code nên không đòi con E2E/);
});

test("reviewer: mục chạy bằng Codex giữ luật duyệt, chỉ nhận issue con code", () => {
  const text = read("reviewer");
  const body = section(text, "## Khi chạy bằng Codex");
  for (const needle of [
    SKILL_PATH,
    "superpowers:requesting-code-review",
    "Mỗi lệnh shell là một shell mới",
    "`crew-commit`",
    "`crew-review sha=<40 hex> verdict=approved`",
    "`PATCH` là lệnh ghi cuối",
    "không dùng công cụ riêng của Claude Code",
    "chỉ issue con code",
    "`crew-kind research`",
    "`crew-kind bmad`",
  ]) assert.ok(body.includes(needle), `thiếu: ${needle}`);
  // Không đổi status khi nhận nhầm issue (stock hiểu status khác là yêu cầu sửa).
  assert.doesNotMatch(body, /"status":/);
  assert.ok(text.indexOf("## Khi chạy bằng Codex") > text.indexOf("## Cách review"));
  assert.ok(text.indexOf("## Khi chạy bằng Codex") < text.indexOf("## Quyết định (một request, có comment)"));
});

test("integrator: deploy tự động chỉ khi repo có crew/release/auto-deploy.json, chạy script của commit T, trước PATCH done", () => {
  const text = read("integrator");
  const stage4 = text.slice(text.indexOf("## Stage 4"));
  const step = stage4.slice(stage4.indexOf("7b."), stage4.indexOf("\n8. "));
  assert.ok(step.length > 0, "thiếu bước 7b");
  assert.ok(step.includes('git cat-file -e "${T}:crew/release/auto-deploy.json"'), "phải kiểm file cấu hình ở commit T");
  assert.match(step, /thất bại thì bỏ qua hẳn bước này, không comment gì thêm/);
  assert.ok(step.includes('git show "${T}:crew/ops/auto-deploy.mjs" > "$D/auto-deploy.mjs"'), "phải chạy đúng bản script của T");
  assert.ok(step.includes('enqueue --repo "$PWD" --issue <id> --sha "$T" --body-out "$D/deploy.json"'));
  assert.ok(step.includes('-d @"$D/deploy.json"'), "đăng nguyên body do lệnh viết");
  assert.match(step, /`rc=3` \(repo không bật\) thì không comment/);
  assert.match(step, /Deploy lỗi không đổi bước 8/);
  assert.match(step, /Không tự chạy `ssh`, `launchctl`, `deploy\.sh`/);
  for (const status of ["queued", "failed"]) {
    assert.ok(step.includes(`\`crew-deploy sha=<T> status=${status}\``), `thiếu dòng mẫu crew-deploy status=${status}`);
    assert.match(`crew-deploy sha=${"a".repeat(40)} status=${status}`, /^crew-deploy sha=[0-9a-f]{40} status=(queued|deployed|failed|rolled_back|cancelled)$/);
  }
  assert.ok(stage4.indexOf("crew-merge sha=") < stage4.indexOf("7b."), "crew-merge phải đứng trước bước deploy");
  assert.ok(stage4.indexOf("7b.") < stage4.indexOf("8. `PUSHED=yes` hoặc `PUSHED=pr`"), "bước deploy phải đứng trước PATCH done");
  assert.match(step, /Với `PUSHED=pr` \(hoặc đã giao bằng `pushed=pr` ở bước 1\) thêm `--pr <URL pull request>` vào cuối lệnh `enqueue`/);
  assert.match(step, /PR đóng mà không merge thì job tự báo `status=cancelled`/);
  assert.match(stage4, /nhảy tới bước 7b \(deploy tự động, nếu repo bật\) và bước 8/);
  assert.match(stage4, /sau nó chỉ được có comment `crew-deploy` của bước 7b/);
});

test("integrator: stage 4 mở pull request thay vì push vào nhánh mặc định khi origin ở GitHub", () => {
  const text = integratorProse();
  const stage4 = text.slice(text.indexOf("## Stage 4"));
  const step2 = stage4.slice(stage4.indexOf("2. **Mở pull request.**"), stage4.indexOf("**Push thẳng"));
  assert.ok(step2.length > 0, "thiếu bước 2 mở pull request");
  for (const needle of [
    "`T` là `EVIDENCE`",
    "không merge `origin/$DEFAULT` vào",
    'bash "$D/crew-pr.sh" "$D"',
    "`rc=0`: `PUSHED=pr`",
    "`rc=3`: `origin` không ở GitHub: làm bước 3–6",
    "`### Merge request`",
    "`## Tổng kết của Trợ Lý`",
    "**không** tự gộp, không sửa conflict",
    "`GH_TOKEN`",
    "không push lại bằng `--force`",
  ]) assert.ok(step2.includes(needle), `bước 2 thiếu: ${needle}`);
  assert.ok(stage4.indexOf("2. **Mở pull request.**") < stage4.indexOf('git push origin "${T}:refs/heads/${DEFAULT}"'), "PR trước, push thẳng chỉ là đường dự phòng");
  assert.match(stage4, /\*\*Push thẳng \(bước 3–6\): chỉ khi bước 2 trả `rc=3`\.\*\*/);
  assert.ok(stage4.includes('-d @"$D/merge-comment.json"'), "đăng nguyên comment script viết");
  assert.ok(stage4.includes('-d @"$D/done.json"'), "PATCH done kèm mô tả mới từ file");
  assert.match(text, /9\. Ở stage 4 khi `origin` ở GitHub: push vào nhánh mặc định, chạy `gh pr merge`/);
  assert.match(stage4, /pushed=pr pr=<URL>` mới hơn bằng chứng mới nhất và X bằng `EVIDENCE`/);
});

test("integrator: mọi ref git dạng <biến>:<đường dẫn> giữ ngoặc nhọn (zsh hiểu $T:c, $T:r là modifier)", () => {
  const text = read("integrator");
  assert.doesNotMatch(text, /"\$[A-Za-z_]+:/);
  assert.ok(text.includes('git push origin "${T}:refs/heads/${DEFAULT}"'));
});

test("assistant: điểm cần owner chốt viết đủ ngay tại chỗ, đánh số Q1…, có lựa chọn, nghĩa và đề xuất, không trỏ file", () => {
  const text = read("assistant");
  const rule = section(text, "## Câu hỏi và điểm cần owner chốt");
  for (const needle of [
    "Đánh số từng điểm `Q1`, `Q2`…",
    "`Q1: a, Q2: theo đề xuất`",
    "kèm nghĩa của từng lựa chọn",
    "đề xuất của Trợ Lý kèm lý do ngắn",
    "Không bao giờ viết \"xem file X\", \"đọc tài liệu đính kèm\" hay một link thay cho nội dung",
    "câu hỏi ở mục \"Hiểu yêu cầu\"",
    "comment chờ owner hay báo `blocked` vì cần owner",
    "mục `### Cần owner quyết định` của tổng kết",
  ]) assert.ok(rule.includes(needle), `thiếu: ${needle}`);
  assert.ok(text.indexOf("## Câu hỏi và điểm cần owner chốt") < text.indexOf("## Hiểu yêu cầu"));
  // Mẫu tổng kết: mục cần owner quyết định là điểm Q1 có lựa chọn và đề xuất, không phải một gạch đầu dòng chung.
  const summary = text.slice(text.indexOf("\n### Cần owner quyết định\n") + 1);
  assert.match(summary, /^### Cần owner quyết định\nQ1\. .+\n- a\) .+\n- b\) .+\n- Đề xuất: .+\n```/);
  assert.match(text, /không bao giờ chỉ trỏ tới file, tài liệu đính kèm hay link/);
  // Câu hỏi đầu việc: thẻ hỏi đánh số, comment blocked chép lại đủ các điểm.
  assert.ok(text.includes('"prompt":"Q1. <câu hỏi đầy đủ>"'));
  assert.ok(text.includes('"label":"a) <lựa chọn> — <nghĩa là gì>"'));
  assert.ok(text.includes("Trợ Lý: chờ owner trả lời câu hỏi trong thẻ trên issue này.\\n<các điểm Q1, Q2… viết đủ"));
});

test("assistant: không tự mở pull request, giữ mục con Merge request do integrator thêm", () => {
  const text = read("assistant");
  assert.match(text, /2\. Sửa file, commit hay push trong worktree, hay mở pull request \(`gh pr …`\)/);
  const summary = summarySection(text);
  assert.match(summary, /Không tự viết mục con `### Merge request`: integrator thêm nó/);
  assert.match(summary, /bản cũ có mục con `### Merge request` thì chép nguyên mục con đó vào cuối bản mới/);
});

test("assistant: tổng kết có từ lúc lập kế hoạch, cập nhật mỗi run, có Yêu cầu/Việc con/Hình ảnh theo thứ tự", () => {
  const text = read("assistant");
  const body = summarySection(text);
  for (const needle of [
    "Chưa có kế hoạch (run còn ở \"Hiểu yêu cầu\", đang hỏi owner, chưa ghi comment `crew-plan`): chưa viết tổng kết",
    "Run đầu có kế hoạch",
    "Mỗi run sau, nếu có gì đổi",
    "`GET /api/issues/<id gốc>` để đọc lại mô tả, rồi sửa **mọi** chỗ trong tổng kết không còn khớp",
    "Không đổi gì thì không gửi `description`",
    "Run dừng sớm",
    "Không `PATCH` mô tả riêng",
    "giữ nguyên từng ký tự phần phía trên tổng kết",
    "không thêm mục thứ hai",
    "`GET /api/issues/<id con>/attachments`",
    "`contentType` bắt đầu bằng `image/`",
    "`![<tên ngắn> (<identifier con>)](/api/attachments/<id>/content)`",
    "Tối đa khoảng 8 ảnh",
    "Không bao giờ nhúng ảnh base64 `data:`",
    "- <identifier> · <việc> · <trạng thái tiếng Việt>",
    "`- Chưa có.`",
    "`PATCH` trả 422 thì làm theo mục \"Khi server trả 422\"",
  ]) assert.ok(body.includes(needle), `thiếu: ${needle}`);
  const tpl = text.slice(text.indexOf("\n## Tổng kết của Trợ Lý\n"));
  const order = ["### Yêu cầu", "### Việc con", "### Kết quả", "### Hình ảnh", "### Đã tự quyết định", "### Kế hoạch", "### Cần owner quyết định"].map((h) => tpl.indexOf(`\n${h}\n`));
  assert.ok(order.every((i, n) => i >= 0 && (n === 0 || i > order[n - 1])), `thứ tự mục tổng kết sai: ${order}`);
  // Lệnh ghi cuối của run mang description; đóng gốc và chốt trạng thái trỏ về mục này.
  assert.match(section(text, "## Đóng issue gốc"), /tổng kết cập nhật theo mục "Tổng kết trên mô tả gốc"/);
  assert.match(section(text, "## Chốt trạng thái gốc"), /`description` mới \(không `status`\) theo mục "Tổng kết trên mô tả gốc"/);
  assert.match(text, /Mọi run có ghi gì trên gốc sau khi đã có kế hoạch đều cập nhật mục tổng kết/);
});

test("mọi instructions bắt dọn rác của run trước khi báo xong", () => {
  for (const name of ["executor", "reviewer", "integrator", "assistant", "bmad"]) {
    const text = read(name);
    for (const needle of ["TRƯỚC KHI báo xong", "tắt mọi process mình bật", "xóa dữ liệu test mình tạo"]) {
      assert.ok(text.includes(needle), `${name}: thiếu: ${needle}`);
    }
  }
});

test("executor và bmad chạy workflow-check với --require-no-orphans", () => {
  const executor = read("executor");
  assert.match(executor, /--plugin-dir <[^`]*> --require-no-orphans`/);
  assert.ok(executor.includes('--root "$(git rev-parse --show-toplevel)" --require-no-orphans`'));
  assert.ok(executor.includes("crew-workflow blocked: process còn chạy pid=…"));
  const bmad = read("bmad");
  assert.match(bmad, /--plugin-dir <[^`]*> --require-no-orphans`/);
  assert.ok(bmad.includes("crew-workflow blocked: process còn chạy pid=…"));
});

test("assistant bắt thêm một con E2E cuối lô cho yêu cầu có code", () => {
  const text = read("assistant");
  const body = section(text, "## Tách việc");
  for (const needle of ["Con E2E cuối lô", "`child-key` là `e2e`", "`blockedByIssueIds` là mọi con code", "mức `medium`", "Playwright", "Maestro", "e2e=<spec1,spec2>", "`children=`"]) {
    assert.ok(body.includes(needle), `thiếu: ${needle}`);
  }
});

test("executor ghi e2e= và bảng Tiêu chí → test sau dòng crew-commit, reviewer đòi cả hai", () => {
  const executor = read("executor");
  const done = section(executor, "## Báo xong");
  assert.ok(done.includes("`Tiêu chí → test:`"));
  assert.ok(done.includes("`- <tiêu chí> → <file test>::<tên ca>`"));
  assert.ok(done.includes("e2e=<spec1,spec2>"));
  assert.ok(executor.includes("VIẾT spec"));
  const review = section(read("reviewer"), "## Cách review");
  assert.ok(review.includes("Tiêu chí → test:"));
  assert.ok(review.includes("không được ánh xạ"));
});

test("integrator chạy đúng spec e2e= một lần trên cây đã merge, stage 4 không chạy lại", () => {
  const text = read("integrator");
  const check = section(text, "## Kiểm một lần trên cây đã merge");
  assert.ok(check.includes("e2e=<spec,…>"));
  assert.ok(check.includes("MỘT lần trên cây đã merge"));
  assert.ok(check.includes("thiếu con E2E thì không approve"));
  assert.ok(text.includes("test <lệnh test và lệnh E2E>: pass"));
  assert.ok(text.includes("không chạy lại E2E"));
});

test("reviewer issue gốc bắt đọc diff gộp và review toàn cục", () => {
  const body = section(read("reviewer"), "## Issue gốc (không có `parentId`)");
  for (const needle of ["BẮT BUỘC đọc diff gộp", "crew/req/<identifier>", "git diff origin/HEAD...crew/review-tmp/<identifier>", "hợp đồng API", "phân quyền", "đồng thời/race", "con E2E", "không đòi `crew-commit` trên issue gốc"]) {
    assert.ok(body.includes(needle), `thiếu: ${needle}`);
  }
});

test("con E2E dựng nền bằng crew-e2e-base từ các sha đã duyệt; reviewer diff từ nền đó; assistant ghi ngoại lệ", () => {
  const executor = read("executor");
  const body = section(executor, "## Con E2E (`crew-child key=e2e`)");
  for (const needle of ["crew-child key=e2e", "origin/HEAD", "crew-review sha=<sha> verdict=approved", "git merge --no-ff <sha>", "theo thứ tự phụ thuộc", "`blockedBy[]` của CHÍNH nó", "bỏ qua blocker BMAD, research, docs", "không `blocked`", "git switch -C crew/<identifier> origin/HEAD", "git cherry-pick", "`git cherry-pick` conflict", "`blocked`", "crew-e2e-base sha=", "simulator/emulator, Maestro, browser Playwright", "không ghi `result=pass`"]) {
    assert.ok(body.includes(needle), `executor: thiếu: ${needle}`);
  }
  const review = section(read("reviewer"), "## Cách review");
  for (const needle of ["crew-e2e-base sha=<40 hex>", "git diff <crew-e2e-base>..<sha>", "chỉ phần E2E"]) {
    assert.ok(review.includes(needle), `reviewer: thiếu: ${needle}`);
  }
  const assistant = section(read("assistant"), "## Tách việc");
  assert.ok(assistant.includes("Ngoại lệ duy nhất là con E2E"));
  assert.ok(assistant.includes("crew-e2e-base"));
  // Marker nhận diện con E2E là dòng thật trong mô tả, không phải `child-key e2e`.
  for (const name of ["executor", "reviewer"]) assert.ok(!read(name).includes("`child-key e2e`"), `${name}: còn marker sai`);
  assert.ok(!/e2e=<spec1,spec2>` ngay dưới dòng `crew-commit`/.test(executor));
});

test("lô sửa có code thì Trợ Lý thêm con E2E e2e-fix-<n>; reviewer kiểm base theo blockedBy", () => {
  const fix = section(read("assistant"), "## Sửa sau quyết định trên gốc");
  for (const needle of ["`e2e-fix-<n>`", "`blockedByIssueIds` gồm mọi con sửa của lô", "tự dựng lại nền"]) {
    assert.ok(fix.includes(needle), `assistant: thiếu: ${needle}`);
  }
  const review = section(read("reviewer"), "## Cách review");
  for (const needle of ["`blockedBy[]` của chính con E2E", "crew-child key=e2e-fix-<n>", "MỚI NHẤT"]) {
    assert.ok(review.includes(needle), `reviewer: thiếu: ${needle}`);
  }
});

test("integrator thiếu môi trường E2E chỉ comment, không đổi status (như DOCS_EXIT=2)", () => {
  const check = section(read("integrator"), "## Kiểm một lần trên cây đã merge");
  assert.ok(check.includes("không approve, không đổi status"));
  assert.ok(!check.includes("`PATCH` `blocked`"));
});

test("con E2E chỉ bắt buộc với issue gốc tạo từ 2026-10-20", () => {
  for (const name of ["reviewer", "integrator"]) {
    const text = read(name);
    assert.ok(text.includes("2026-10-20T00:00:00+07:00"), `${name}: thiếu mốc ngày`);
    assert.ok(text.includes("không đòi con E2E"), `${name}: thiếu ghi chú không đòi`);
  }
  const integrator = read("integrator");
  assert.ok(!integrator.includes("không approve, `PATCH` `blocked`"));
});

test("reviewer issue gốc tự dựng nhánh tạm crew/review-tmp rồi xóa sau khi review", () => {
  const body = section(read("reviewer"), "## Issue gốc (không có `parentId`)");
  for (const needle of ["crew/review-tmp/<identifier>", "git switch -C crew/review-tmp/<identifier> origin/HEAD", "chạy TRƯỚC integrator", "request changes nêu các con xung đột", "git branch -D crew/review-tmp/<identifier>", "kể cả khi request changes"]) {
    assert.ok(body.includes(needle), `thiếu: ${needle}`);
  }
});

test("Trợ Lý giữ gốc in_progress khi còn con chưa done, không tốn thêm run để ghi trạng thái chờ", () => {
  const body = section(read("assistant"), "## Chốt trạng thái gốc");
  for (const needle of [
    "Còn con chưa `done` thì gốc giữ `in_progress`",
    "là lệnh ghi cuối của run",
    "Không đặt `blocked` theo con",
    "không comment riêng chỉ để báo gốc chờ con",
  ]) {
    assert.ok(body.includes(needle), `thiếu: ${needle}`);
  }
});

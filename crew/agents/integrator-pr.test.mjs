// Runs the pull request script of integrator.md ("Script mở pull request") exactly as the agent copies it, against a
// local bare repo posing as a GitHub origin (pushInsteadOf) and a stub `gh`. Never talks to GitHub.
// Run: node --test crew/agents/integrator-pr.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

// Dòng crew-pr và crew-merge pushed=merged mà gate server nhận (CREW_PR_RE, CREW_MERGE_RE của issue-policy.ts).
const GH_PR = String.raw`https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9][0-9]{0,9}`;
// URL merge request GitLab (gitlab.com hoặc tự host, cổng, nhóm con): GITLAB_MR_URL của issue-policy.ts.
const GL_MR = String.raw`https:\/\/(?![Gg][Ii][Tt][Hh][Uu][Bb]\.[Cc][Oo][Mm][:/])[A-Za-z0-9][A-Za-z0-9.-]*(?::[0-9]{1,5})?(?:\/[A-Za-z0-9_][A-Za-z0-9_.-]*){2,}\/-\/merge_requests\/[1-9][0-9]{0,9}`;
const PR_URL = `(?:${GH_PR}|${GL_MR})`;
const crewPrRe = (url) => new RegExp(`^crew-pr sha=([0-9a-f]{40}) pr=(${url})$`);
const mergedRe = (url) => new RegExp(`^crew-merge sha=([0-9a-f]{40}) branch=(\\S+) pushed=merged pr=(${url}) merge=([0-9a-f]{40})$`);
const CREW_PR_RE = crewPrRe(PR_URL);
const MERGED_RE = mergedRe(PR_URL);
const POLICY_SOURCE = new URL("../../server/src/crew/issue-policy.ts", import.meta.url);
const MERGE_RE =
  /^crew-merge sha=([0-9a-f]{40}) branch=(\S+) pushed=(?:yes|pr pr=(https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9][0-9]*))$/;
const ORIGIN = "https://bot:ghp_SECRETTOKEN123@github.com/acme/app.git";

export function prScript() {
  const text = readFileSync(new URL("./integrator.md", import.meta.url), "utf8");
  const section = text.slice(text.indexOf("\n## Script mở pull request"));
  const match = /```bash\n([\s\S]*?)\n```/.exec(section);
  assert.ok(match, "integrator.md thiếu khối bash của script mở pull request");
  return `${match[1]}\n`;
}

const dirs = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

// Stub gh: state in $GH_STUB/state.json, every call appended to $GH_STUB/calls.log, body files copied for checks.
const GH_STUB = `#!/usr/bin/env node
const fs = require("fs");
const dir = process.env.GH_STUB;
const file = dir + "/state.json";
const st = JSON.parse(fs.readFileSync(file, "utf8"));
const args = process.argv.slice(2);
fs.appendFileSync(dir + "/calls.log", args.join(" ") + "\\n");
const opt = (k) => { const i = args.indexOf(k); return i < 0 ? undefined : args[i + 1]; };
const save = () => fs.writeFileSync(file, JSON.stringify(st));
if (st.fail === args.slice(0, 2).join(" ")) { process.stderr.write(st.failOut || "boom\\n"); process.exit(1); }
if (args[0] === "api" && args[1] === "user") { process.stdout.write("nquangphan\\n"); process.exit(0); }
if (args[0] === "pr" && args[1] === "list") {
  const out = st.prs.filter((p) => p.head === opt("--head") && p.base === opt("--base")).map((p) => ({ url: p.url, state: p.state, headRefOid: p.headRefOid }));
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}
if (args[0] === "pr" && args[1] === "create") {
  const n = st.prs.length + 1;
  const url = "https://github.com/" + opt("--repo") + "/pull/" + n;
  fs.copyFileSync(opt("--body-file"), dir + "/body-" + n + ".md");
  st.prs.push({ url, state: "OPEN", head: opt("--head"), base: opt("--base"), title: opt("--title"), headRefOid: st.headOid, mergeable: st.mergeable || "MERGEABLE" });
  save();
  process.stdout.write("Creating pull request for " + opt("--head") + " into " + opt("--base") + "\\n\\n" + url + "\\n");
  process.exit(0);
}
if (args[0] === "pr" && args[1] === "edit") {
  const p = st.prs.find((x) => x.url === args[2]);
  p.title = opt("--title");
  fs.copyFileSync(opt("--body-file"), dir + "/body-edit.md");
  save();
  process.stdout.write(args[2] + "\\n");
  process.exit(0);
}
if (args[0] === "pr" && args[1] === "view") {
  const p = st.prs.find((x) => x.url === args[2]);
  process.stdout.write(JSON.stringify({ url: p.url, state: p.state, mergeable: p.state === "OPEN" ? p.mergeable : "UNKNOWN", headRefOid: p.headRefOid, mergeCommit: p.mergeOid ? { oid: p.mergeOid } : null }));
  process.exit(0);
}
if (args[0] === "pr" && args[1] === "merge") {
  const p = st.prs.find((x) => x.url === args[2]);
  p.state = "MERGED";
  p.mergeOid = st.mergeOid || "e".repeat(40);
  save();
  process.stdout.write("Merged pull request " + args[2] + "\\n");
  process.exit(0);
}
if (args[0] === "repo" && args[1] === "view") {
  process.stdout.write(JSON.stringify({ mergeCommitAllowed: st.mergeCommitAllowed ?? true, squashMergeAllowed: st.squashMergeAllowed ?? true }));
  process.exit(0);
}
process.stderr.write("stub gh: unexpected " + args.join(" ") + "\\n");
process.exit(9);
`;

const SUMMARY = [
  "Yêu cầu: thêm trang tổng hợp.",
  "",
  "## Tổng kết của Trợ Lý",
  "",
  "### Kết quả",
  "- Trang tổng hợp chạy (TPS-146).",
  "",
  "### Đã tự quyết định",
  "- Không có.",
  "",
  "### Cần owner quyết định",
  "- Không có.",
  "",
  "## Ghi chú khác",
  "",
  "Giữ nguyên đoạn này  \t",
  "",
].join("\n");

function world({ origin = ORIGIN, description = SUMMARY, prs = [], fail, failOut, mergeable, mergeCommitAllowed } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "crew-pr-"));
  dirs.push(root);
  const git = (cwd, ...args) => {
    const r = spawnSync("git", args, { cwd, encoding: "utf8" });
    assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
    return r.stdout.trim();
  };
  const bare = path.join(root, "origin.git");
  const work = path.join(root, "work");
  git(root, "init", "-q", "--bare", "-b", "main", bare);
  git(root, "clone", "-q", bare, work);
  git(work, "config", "user.email", "t@t");
  git(work, "config", "user.name", "t");
  git(work, "switch", "-q", "-c", "main");
  writeFileSync(path.join(work, "a.txt"), "1\n");
  git(work, "add", ".");
  git(work, "commit", "-qm", "base");
  git(work, "push", "-q", "origin", "main");
  const base = git(work, "rev-parse", "HEAD");
  git(work, "switch", "-q", "-c", "crew/req/TPS-145");
  writeFileSync(path.join(work, "b.txt"), "2\n");
  git(work, "add", ".");
  git(work, "commit", "-qm", "feature");
  const T = git(work, "rev-parse", "HEAD");
  git(work, "remote", "set-url", "origin", origin);
  git(work, "config", `url.${bare}.pushInsteadOf`, origin);
  const stub = path.join(root, "gh-stub");
  const bin = path.join(root, "bin");
  mkdirSync(stub);
  mkdirSync(bin);
  writeFileSync(path.join(bin, "gh"), GH_STUB);
  chmodSync(path.join(bin, "gh"), 0o755);
  writeFileSync(path.join(stub, "state.json"), JSON.stringify({ prs, fail, failOut, mergeable, mergeCommitAllowed, headOid: T }));
  const D = path.join(root, "D");
  mkdirSync(D);
  writeFileSync(path.join(D, "issue.json"), JSON.stringify({ id: "x", identifier: "TPS-145", title: "Trang  tổng hợp\nmới", description }));
  writeFileSync(path.join(D, "crew-pr.sh"), prScript());
  const run = (env = {}) =>
    spawnSync("bash", [path.join(D, "crew-pr.sh"), D], {
      cwd: work,
      encoding: "utf8",
      env: { PATH: `${bin}:${process.env.PATH}`, HOME: root, GH_STUB: stub, T, DEFAULT: "main", ...env },
    });
  const remoteRef = (ref) => spawnSync("git", ["--git-dir", bare, "rev-parse", "-q", "--verify", ref], { encoding: "utf8" }).stdout.trim();
  const calls = () => (existsSync(path.join(stub, "calls.log")) ? readFileSync(path.join(stub, "calls.log"), "utf8") : "");
  const read = (f) => readFileSync(path.join(D, f), "utf8");
  const json = (f) => JSON.parse(read(f));
  return { root, bare, work, base, T, D, stub, run, remoteRef, calls, read, json, git };
}

const leaks = (w, r) => {
  const all = [r.stdout, r.stderr, ...["error.txt", "merge-comment.json", "pr-comment.json", "done.json", "pr-body.md"].filter((f) => existsSync(path.join(w.D, f))).map((f) => w.read(f))];
  for (const text of all) assert.doesNotMatch(text, /SECRETTOKEN|bot:/, "không được lộ credential của URL remote");
};

test("mở PR mới: đẩy nhánh yêu cầu đúng commit T, không chạm nhánh mặc định, nội dung PR là tổng kết", () => {
  const w = world();
  const r = w.run();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  leaks(w, r);
  assert.equal(w.remoteRef("refs/heads/crew/req/TPS-145"), w.T);
  assert.equal(w.remoteRef("refs/heads/main"), w.base, "nhánh mặc định giữ nguyên");
  const calls = w.calls();
  assert.match(calls, /^pr list --repo acme\/app --head crew\/req\/TPS-145 --base main --state all /m);
  assert.match(calls, /^pr create --repo acme\/app --base main --head crew\/req\/TPS-145 --title TPS-145: Trang tổng hợp mới --body-file /m);
  assert.doesNotMatch(calls, /pr merge|--force/);
  const body = readFileSync(path.join(w.stub, "body-1.md"), "utf8");
  assert.ok(body.startsWith("## Tổng kết của Trợ Lý\n\n### Kết quả\n- Trang tổng hợp chạy (TPS-146)."));
  assert.doesNotMatch(body, /Ghi chú khác|Yêu cầu: thêm/);
  assert.match(body, new RegExp(`commit owner đã duyệt \`${w.T}\``));
  const url = "https://github.com/acme/app/pull/1";
  assert.equal(w.read("pr-url.txt"), url);
  const comment = w.json("merge-comment.json").body;
  const first = comment.split("\n")[0];
  assert.equal(first, `crew-merge sha=${w.T} branch=main pushed=pr pr=${url}`);
  assert.deepEqual(MERGE_RE.exec(first)?.slice(1), [w.T, "main", url]);
  assert.match(comment, /gộp được; chờ owner bấm \*\*Merge\*\*/);
  const done = w.json("done.json");
  assert.equal(done.status, "done");
  assert.match(done.comment, /^Integrator: approve — đã mở pull request https:\/\/github\.com\/acme\/app\/pull\/1 /);
  // Mô tả: chèn mục con vào cuối tổng kết, mọi byte khác giữ nguyên.
  const cut = SUMMARY.indexOf("## Ghi chú khác");
  assert.ok(done.description.startsWith(SUMMARY.slice(0, cut)));
  assert.ok(done.description.endsWith(SUMMARY.slice(cut)));
  const inserted = done.description.slice(cut, done.description.length - (SUMMARY.length - cut));
  assert.match(inserted, /^### Merge request\n\n- Pull request: https:\/\/github\.com\/acme\/app\/pull\/1\n- Nhánh: `crew\/req\/TPS-145` → `main`, commit `[0-9a-f]{40}`\n- Trạng thái: đang mở, gộp được; chờ owner bấm \*\*Merge\*\* trên GitHub \(cập nhật .+, giờ VN\)\n\n$/);
});

test("PR đang mở được dùng lại và cập nhật; conflict được báo rõ, mục Merge request cũ bị thay chứ không nhân đôi", () => {
  const old = "https://github.com/acme/app/pull/7";
  const description = SUMMARY.replace("## Ghi chú khác", `### Merge request\n\n- Pull request: ${old}\n- Trạng thái: cũ\n\n## Ghi chú khác`);
  const w = world({ description, prs: [{ url: old, state: "OPEN", head: "crew/req/TPS-145", base: "main", headRefOid: "0".repeat(40), mergeable: "CONFLICTING" }] });
  const r = w.run();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const calls = w.calls();
  assert.doesNotMatch(calls, /pr create/);
  assert.match(calls, new RegExp(`^pr edit ${old} --title TPS-145: Trang tổng hợp mới --body-file `, "m"));
  assert.doesNotMatch(readFileSync(path.join(w.stub, "body-edit.md"), "utf8"), /### Merge request/, "nội dung PR không chứa chính mục Merge request");
  const comment = w.json("merge-comment.json").body;
  assert.equal(comment.split("\n")[0], `crew-merge sha=${w.T} branch=main pushed=pr pr=${old}`);
  assert.match(comment, /\*\*có conflict\*\* với `main`/);
  assert.match(comment, /Integrator không tự gộp hay sửa conflict/);
  const desc = w.json("done.json").description;
  assert.equal(desc.match(/^### Merge request$/gm).length, 1);
  assert.doesNotMatch(desc, /Trạng thái: cũ/);
  assert.match(desc, /- Conflict: nhánh `crew\/req\/TPS-145` xung đột với `main`/);
  const cut = description.indexOf("### Merge request");
  assert.ok(desc.startsWith(description.slice(0, cut)));
  assert.ok(desc.endsWith(description.slice(description.indexOf("## Ghi chú khác"))));
  assert.match(w.json("done.json").comment, /sau khi xử lý conflict$/);
});

test("PR đã merge đúng commit T (chạy lại sau khi owner merge): không push lại, không tạo PR", () => {
  const url = "https://github.com/acme/app/pull/4";
  const w = world({ prs: [{ url, state: "MERGED", head: "crew/req/TPS-145", base: "main" }] });
  const st = JSON.parse(readFileSync(path.join(w.stub, "state.json"), "utf8"));
  st.prs[0].headRefOid = w.T;
  writeFileSync(path.join(w.stub, "state.json"), JSON.stringify(st));
  const r = w.run();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(w.remoteRef("refs/heads/crew/req/TPS-145"), "", "không đẩy lại nhánh đã merge");
  assert.doesNotMatch(w.calls(), /pr (create|edit)/);
  assert.match(w.json("merge-comment.json").body, /Trạng thái: đã merge vào `main`\./);
});

test("origin không ở GitHub: thoát 3, không gọi gh, không push gì", () => {
  const w = world({ origin: "https://gitlab.example.com/acme/app.git" });
  const r = w.run();
  assert.equal(r.status, 3);
  assert.equal(w.calls(), "");
  assert.equal(w.remoteRef("refs/heads/crew/req/TPS-145"), "");
  assert.equal(r.stdout, "");
});

// F-13: script nhận GitHub theo host chữ thường như originHost/originProvider của server (issue-create-policy.ts):
// mọi origin server coi là github.com đều đi nhánh gh, không đi nhánh GitLab (push option).
for (const origin of ["https://GitHub.com/acme/app", "ssh://github.com/acme/app.git", "http://github.com/acme/app", "GIT@GitHub.COM:acme/app.git", "ssh://git@github.com:22/acme/app.git/"]) {
  test(`origin GitHub dạng biên ${origin}: MODE=bf đi nhánh gh (mở PR), không push option merge_request.*`, () => {
    const w = world({ origin });
    const r = w.run({ MODE: "bf" });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(w.calls(), /^pr create --repo acme\/app --base main --head crew\/req\/TPS-145 /m);
    assert.equal(w.remoteRef("refs/heads/crew/req/TPS-145"), w.T);
    assert.equal(CREW_PR_RE.exec(w.json("pr-comment.json").body.split("\n")[0])?.[2], "https://github.com/acme/app/pull/1");
  });
}

test("origin GitHub viết hoa ở MODE=owner: mở PR như GitHub, không thoát 3 (không push thẳng)", () => {
  const w = world({ origin: "https://GitHub.com/acme/app.git" });
  const r = w.run();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(w.calls(), /^pr create --repo acme\/app /m);
  assert.equal(w.remoteRef("refs/heads/main"), w.base);
});

test("origin không nhận ra host (đường dẫn cục bộ, file://) ở MODE=bf|merge: thoát 2, không mặc định GitLab, không push", () => {
  for (const origin of ["/srv/git/app.git", "file:///srv/git/app.git"]) {
    for (const MODE of ["bf", "merge"]) {
      const w = world({ origin });
      const r = w.run({ MODE, PR: "https://gitlab.example.com/acme/app/-/merge_requests/1" });
      assert.equal(r.status, 2, `${origin} ${MODE}: ${r.stdout}${r.stderr}`);
      assert.match(w.read("error.txt"), /không phải GitHub hay GitLab/);
      assert.equal(w.calls(), "");
      assert.equal(w.remoteRef("refs/heads/crew/req/TPS-145"), "");
      assert.equal(w.remoteRef("refs/heads/main"), w.base);
    }
    assert.equal(world({ origin }).run().status, 3, "MODE=owner vẫn thoát 3 (push thẳng)");
  }
});

test("gh chưa đăng nhập: thoát 4 trước mọi push, lý do đã lọc", () => {
  const w = world({ fail: "api user", failOut: "To get started with GitHub CLI, please run:  gh auth login\nAuthorization: token ghp_LEAKED\n" });
  const r = w.run();
  assert.equal(r.status, 4);
  assert.equal(w.remoteRef("refs/heads/crew/req/TPS-145"), "");
  assert.match(w.read("error.txt"), /gh chưa đăng nhập/);
  assert.doesNotMatch(w.read("error.txt"), /ghp_LEAKED/);
  leaks(w, r);
});

test("nhánh yêu cầu trên origin đã đi khác: push thường bị từ chối, thoát 5, không --force, không tạo PR", () => {
  const w = world();
  w.git(w.work, "switch", "-q", "-c", "other", w.base);
  writeFileSync(path.join(w.work, "c.txt"), "3\n");
  w.git(w.work, "add", ".");
  w.git(w.work, "commit", "-qm", "diverged");
  w.git(w.work, "push", "-q", "origin", "other:refs/heads/crew/req/TPS-145");
  const diverged = w.git(w.work, "rev-parse", "HEAD");
  w.git(w.work, "switch", "-q", "crew/req/TPS-145");
  const r = w.run();
  assert.equal(r.status, 5, r.stdout + r.stderr);
  assert.equal(w.remoteRef("refs/heads/crew/req/TPS-145"), diverged, "nhánh trên origin không bị ghi đè");
  assert.doesNotMatch(w.calls(), /pr create/);
  assert.match(w.read("error.txt"), /Không push lại bằng --force/);
  leaks(w, r);
});

test("gh pr create lỗi: thoát 6, URL có credential trong lỗi bị che", () => {
  const w = world({ fail: "pr create", failOut: "pull request create failed: https://x-access-token:ghs_abcDEF@github.com/acme/app\n" });
  const r = w.run();
  assert.equal(r.status, 6);
  const err = w.read("error.txt");
  assert.match(err, /gh pr create lỗi/);
  assert.doesNotMatch(err, /ghs_abcDEF|x-access-token/);
  assert.ok(!existsSync(path.join(w.D, "done.json")));
});

test("mô tả chưa có tổng kết: thêm mục tổng kết chỉ có Merge request ở cuối, PR lấy nội dung yêu cầu", () => {
  const description = "Chỉ có yêu cầu, chưa có tổng kết.";
  const w = world({ description });
  const r = w.run();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const desc = w.json("done.json").description;
  assert.ok(desc.startsWith(`${description}\n\n## Tổng kết của Trợ Lý\n\n### Merge request\n\n- Pull request: https://github.com/acme/app/pull/1\n`));
  assert.ok(readFileSync(path.join(w.stub, "body-1.md"), "utf8").startsWith(`## Yêu cầu\n\n${description}`));
});

test("tổng kết có mục Hình ảnh: nội dung PR bỏ mục đó (link tương đối), mô tả issue giữ nguyên và chỉ thêm Merge request", () => {
  const description = [
    "Yêu cầu: thêm trang tổng hợp.",
    "",
    "## Tổng kết của Trợ Lý",
    "",
    "### Yêu cầu",
    "Thêm trang tổng hợp.",
    "",
    "### Việc con",
    "- TPS-146 · Trang tổng hợp · xong",
    "",
    "### Kết quả",
    "- Trang tổng hợp chạy (TPS-146).",
    "",
    "### Hình ảnh",
    "![Trang tổng hợp (TPS-146)](/api/attachments/aaaa/content)",
    "",
    "### Đã tự quyết định",
    "- Không có.",
    "",
    "### Cần owner quyết định",
    "- Không có.",
    "",
  ].join("\n");
  const w = world({ description });
  const r = w.run();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const body = readFileSync(path.join(w.stub, "body-1.md"), "utf8");
  assert.doesNotMatch(body, /Hình ảnh|\/api\/attachments/);
  for (const keep of ["### Yêu cầu", "### Việc con", "### Kết quả", "### Đã tự quyết định", "### Cần owner quyết định"]) assert.ok(body.includes(keep), keep);
  const desc = w.json("done.json").description;
  assert.ok(desc.startsWith(description), "giữ nguyên từng ký tự, kể cả mục Hình ảnh");
  assert.match(desc.slice(description.length), /^\n### Merge request\n/);
});

test("đầu vào sai: T không phải sha thì thoát 2 trước khi gọi gh", () => {
  const w = world();
  const r = w.run({ T: "abc" });
  assert.equal(r.status, 2);
  assert.equal(w.calls(), "");
});

/**
 * Chuỗi regex của server: thay mọi hằng `const X = String.raw\`…\`` / `const X = \`…\`` (GITHUB_PR_URL, GITLAB_MR_URL,
 * PR_URL…) vào template `new RegExp(`…`)` của hằng `name`.
 */
function serverRegex(name, src = readFileSync(POLICY_SOURCE, "utf8")) {
  const consts = new Map();
  for (const m of src.matchAll(/^const ([A-Z_]+) = (String\.raw)?`([^`]*)`;/gm)) consts.set(m[1], m[2] ? m[3] : m[3].replaceAll("\\\\", "\\"));
  const tpl = new RegExp(`export const ${name} = new RegExp\\(\\s*\`([^\`]+)\`,?\\s*\\);`).exec(src)?.[1];
  assert.ok(consts.has("GITHUB_PR_URL") && tpl, `không đọc được ${name} của server`);
  const expand = (s) => s.replace(/\$\{([A-Z_]+)\}/g, (_, k) => (assert.ok(consts.has(k), `server thiếu hằng ${k}`), expand(consts.get(k))));
  return expand(tpl.replaceAll("\\\\", "\\"));
}

test("regex crew-pr và crew-merge pushed=merged của test trùng regex gate server", { skip: !existsSync(POLICY_SOURCE) && "issue-policy.ts chưa có trên nhánh này" }, () => {
  // Server chưa nhận MR GitLab (nhánh chưa gộp phần server) thì so với bản chỉ GitHub; đã nhận thì so với bản đủ.
  const gitlab = /^const GITLAB_MR_URL = /m.test(readFileSync(POLICY_SOURCE, "utf8"));
  assert.equal(serverRegex("CREW_PR_RE"), crewPrRe(gitlab ? PR_URL : GH_PR).source);
  const merge = new RegExp(serverRegex("CREW_MERGE_RE"));
  assert.match(`crew-merge sha=${"a".repeat(40)} branch=main pushed=merged pr=https://github.com/o/r/pull/2 merge=${"b".repeat(40)}`, merge);
  if (gitlab) assert.match(`crew-merge sha=${"a".repeat(40)} branch=main pushed=merged pr=https://gitlab.example.com/acme/sub/app/-/merge_requests/2 merge=${"b".repeat(40)}`, merge);
});

test("serverRegex đọc được nguồn server có hằng PR_URL lồng GITHUB_PR_URL và GITLAB_MR_URL", () => {
  const src = [
    "const GITHUB_PR_URL = String.raw`" + GH_PR + "`;",
    "const GITLAB_MR_URL = String.raw`" + GL_MR + "`;",
    "const PR_URL = `(?:${GITHUB_PR_URL}|${GITLAB_MR_URL})`;",
    "export const CREW_PR_RE = new RegExp(`^crew-pr sha=([0-9a-f]{40}) pr=(${PR_URL})$`);",
    "export const CREW_MERGE_RE = new RegExp(",
    "  `^crew-merge sha=([0-9a-f]{40}) branch=(\\\\S+) pushed=merged pr=(${PR_URL}) merge=([0-9a-f]{40})$`,",
    ");",
  ].join("\n");
  assert.equal(serverRegex("CREW_PR_RE", src), CREW_PR_RE.source);
  assert.equal(serverRegex("CREW_MERGE_RE", src), MERGED_RE.source);
});

test("MODE=bf ở stage gộp: không đòi quyết định owner, đẩy nhánh, mở PR, ghi crew-pr đúng merged commit, không merge", () => {
  const w = world();
  // issue.json chỉ có id, identifier, title, description: không có executionState hay quyết định owner nào.
  assert.equal(w.json("issue.json").executionState, undefined);
  const r = w.run({ MODE: "bf", NOTE: "test pnpm test: pass;\ndocs exit 0" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  leaks(w, r);
  assert.equal(w.remoteRef("refs/heads/crew/req/TPS-145"), w.T);
  assert.equal(w.remoteRef("refs/heads/main"), w.base, "nhánh mặc định giữ nguyên");
  const calls = w.calls();
  assert.match(calls, /^pr create --repo acme\/app --base main --head crew\/req\/TPS-145 /m);
  assert.doesNotMatch(calls, /pr merge|repo view|--force/);
  const url = "https://github.com/acme/app/pull/1";
  const comment = w.json("pr-comment.json").body;
  assert.deepEqual(CREW_PR_RE.exec(comment.split("\n")[0])?.slice(1), [w.T, url]);
  assert.ok(!existsSync(path.join(w.D, "merge-comment.json")), "stage gộp không ghi crew-merge");
  const body = readFileSync(path.join(w.stub, "body-1.md"), "utf8");
  assert.match(body, /Bug Finding review pull request này; sau khi owner duyệt trên Crew, integrator merge/);
  assert.doesNotMatch(body, /owner bấm Merge/);
  const done = w.json("done.json");
  assert.equal(done.status, "done");
  assert.equal(done.comment, `Integrator: approve — crew/req/TPS-145 tại ${w.T}, pull request ${url}; test pnpm test: pass; docs exit 0; chờ Bug Finding review`);
  assert.match(done.description, /- Trạng thái: đang mở, gộp được; chờ Bug Finding review và owner duyệt trên Crew; integrator merge sau khi owner duyệt \(/);
});

test("MODE=bf chạy lại sau lô sửa: dùng lại PR đang mở, đẩy commit mới nối tiếp, crew-pr theo commit mới", () => {
  const old = "https://github.com/acme/app/pull/5";
  const w = world({ prs: [{ url: old, state: "OPEN", head: "crew/req/TPS-145", base: "main", headRefOid: "0".repeat(40), mergeable: "MERGEABLE" }] });
  w.git(w.work, "push", "-q", "origin", `${w.T}:refs/heads/crew/req/TPS-145`);
  writeFileSync(path.join(w.work, "fix.txt"), "fix\n");
  w.git(w.work, "add", ".");
  w.git(w.work, "commit", "-qm", "merge(TPS-150): sửa F-01");
  const T2 = w.git(w.work, "rev-parse", "HEAD");
  const r = w.run({ MODE: "bf", T: T2 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(w.remoteRef("refs/heads/crew/req/TPS-145"), T2);
  assert.doesNotMatch(w.calls(), /pr create|pr merge/);
  assert.match(w.calls(), new RegExp(`^pr edit ${old} `, "m"));
  assert.equal(w.json("pr-comment.json").body.split("\n")[0], `crew-pr sha=${T2} pr=${old}`);
});

test("MODE=bf: PR có conflict thì thoát 7, không ghi crew-pr hay done.json", () => {
  const url = "https://github.com/acme/app/pull/2";
  const w = world({ prs: [{ url, state: "OPEN", head: "crew/req/TPS-145", base: "main", headRefOid: "0".repeat(40), mergeable: "CONFLICTING" }] });
  const r = w.run({ MODE: "bf" });
  assert.equal(r.status, 7, r.stdout + r.stderr);
  assert.match(w.read("error.txt"), /có conflict với main/);
  assert.ok(!existsSync(path.join(w.D, "pr-comment.json")));
  assert.ok(!existsSync(path.join(w.D, "done.json")));
});

const openPr = (w, extra = {}) => {
  const st = JSON.parse(readFileSync(path.join(w.stub, "state.json"), "utf8"));
  st.prs = [{ url: "https://github.com/acme/app/pull/9", state: "OPEN", head: "crew/req/TPS-145", base: "main", headRefOid: w.T, mergeable: "MERGEABLE", ...extra }];
  writeFileSync(path.join(w.stub, "state.json"), JSON.stringify(st));
  return st.prs[0].url;
};

test("MODE=merge: merge đúng head T bằng --merge --match-head-commit, không push, crew-merge pushed=merged có merge commit", () => {
  const w = world();
  const url = openPr(w);
  const r = w.run({ MODE: "merge" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  leaks(w, r);
  const calls = w.calls();
  assert.match(calls, new RegExp(`^pr merge ${url} --merge --match-head-commit ${w.T}$`, "m"));
  assert.doesNotMatch(calls, /pr (create|edit)|--admin|--auto|--delete-branch/);
  assert.equal(w.remoteRef("refs/heads/crew/req/TPS-145"), "", "stage merge không push");
  assert.equal(w.remoteRef("refs/heads/main"), w.base, "không push vào nhánh mặc định");
  const M = "e".repeat(40);
  const first = w.json("merge-comment.json").body.split("\n")[0];
  assert.deepEqual(MERGED_RE.exec(first)?.slice(1), [w.T, "main", url, M]);
  const done = w.json("done.json");
  assert.equal(done.comment, `Integrator: approve — đã merge pull request ${url} vào \`main\` tại ${M} (commit owner duyệt ${w.T})`);
  assert.match(done.description, new RegExp(`- Trạng thái: đã merge vào \`main\` \\(merge commit \`${M}\`\\)`));
});

test("MODE=merge GitHub: script ghi deploy.txt=pr nên integrator gọi enqueue một lần với --pr <URL PR>", () => {
  const w = world();
  const url = openPr(w);
  const r = w.run({ MODE: "merge" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(w.read("deploy.txt"), "pr");
  assert.deepEqual(deployStep(w), [["enqueue", "--sha", w.T, "--pr", url]]);
});

test("MODE=merge: repo cấm merge commit thì --squash", () => {
  const w = world({ mergeCommitAllowed: false });
  const url = openPr(w);
  const r = w.run({ MODE: "merge" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(w.calls(), new RegExp(`^pr merge ${url} --squash --match-head-commit ${w.T}$`, "m"));
});

test("MODE=merge: head PR khác commit owner duyệt thì thoát 8, không merge", () => {
  const w = world();
  openPr(w, { headRefOid: "1".repeat(40) });
  const r = w.run({ MODE: "merge" });
  assert.equal(r.status, 8, r.stdout + r.stderr);
  assert.doesNotMatch(w.calls(), /pr merge/);
  assert.match(w.read("error.txt"), /khác commit được duyệt/);
});

test("MODE=merge: conflict thì thoát 7 trước khi gọi gh pr merge; gh pr merge báo conflict cũng thoát 7", () => {
  const w = world();
  openPr(w, { mergeable: "CONFLICTING" });
  const r = w.run({ MODE: "merge" });
  assert.equal(r.status, 7, r.stdout + r.stderr);
  assert.doesNotMatch(w.calls(), /pr merge/);
  assert.ok(!existsSync(path.join(w.D, "done.json")));
  const w2 = world({ fail: "pr merge", failOut: "Pull request is not mergeable: the merge commit cannot be cleanly created\n" });
  openPr(w2);
  const r2 = w2.run({ MODE: "merge" });
  assert.equal(r2.status, 7, r2.stdout + r2.stderr);
  assert.match(w2.read("error.txt"), /có conflict với main/);
});

test("MODE=merge chạy lại khi PR đã merge đúng T: không gọi gh pr merge, vẫn ghi crew-merge pushed=merged", () => {
  const w = world();
  const url = openPr(w, { state: "MERGED", mergeOid: "f".repeat(40) });
  const r = w.run({ MODE: "merge" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(w.calls(), /pr merge/);
  assert.equal(w.json("merge-comment.json").body.split("\n")[0], `crew-merge sha=${w.T} branch=main pushed=merged pr=${url} merge=${"f".repeat(40)}`);
});

/** `git fetch origin …` đi tới repo bare cục bộ (origin trong test là URL GitHub giả, chỉ push được nhờ pushInsteadOf). */
function fetchFromBare(w) {
  const realGit = spawnSync("bash", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
  const file = path.join(w.root, "bin", "git");
  writeFileSync(file, `#!/bin/bash\nif [ "$1" = fetch ] && [ "$2" = origin ]; then shift 2; exec "${realGit}" fetch "${w.bare}" "$@"; fi\nexec "${realGit}" "$@"\n`);
  chmodSync(file, 0o755);
}

test("MODE=merge với HEAD_OK: head = T + merge nhánh mặc định thì merge đúng head đó; head có commit thường sau T thì thoát 9; head không chứa T thì thoát 8", () => {
  const w = world();
  w.git(w.work, "switch", "-q", "main");
  writeFileSync(path.join(w.work, "m.txt"), "main đi tiếp\n");
  w.git(w.work, "add", ".");
  w.git(w.work, "commit", "-qm", "main đi tiếp");
  w.git(w.work, "push", "-q", "origin", "main");
  w.git(w.work, "switch", "-q", "crew/req/TPS-145");
  w.git(w.work, "merge", "-q", "--no-ff", "-m", "Merge main vào crew/req/TPS-145 (owner sửa conflict)", "main");
  const H = w.git(w.work, "rev-parse", "HEAD");
  w.git(w.work, "push", "-q", "origin", `${H}:refs/heads/crew/req/TPS-145`);
  fetchFromBare(w);
  const url = openPr(w, { headRefOid: H });
  const r = w.run({ MODE: "merge", HEAD_OK: H });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(w.calls(), new RegExp(`^pr merge ${url} --merge --match-head-commit ${H}$`, "m"));
  const body = w.json("merge-comment.json").body;
  assert.equal(body.split("\n")[0].split(" pushed=")[0], `crew-merge sha=${w.T} branch=main`, "sha vẫn là commit owner duyệt");
  assert.match(body, new RegExp(`Head PR khi merge: \`${H}\``));

  const w1 = world();
  writeFileSync(path.join(w1.work, "lạ.txt"), "chưa duyệt\n");
  w1.git(w1.work, "add", ".");
  w1.git(w1.work, "commit", "-qm", "commit chưa được owner duyệt");
  const Y = w1.git(w1.work, "rev-parse", "HEAD");
  w1.git(w1.work, "push", "-q", "origin", `${Y}:refs/heads/crew/req/TPS-145`);
  openPr(w1, { headRefOid: Y });
  fetchFromBare(w1);
  const r1 = w1.run({ MODE: "merge", HEAD_OK: Y });
  assert.equal(r1.status, 9, r1.stdout + r1.stderr);
  assert.doesNotMatch(w1.calls(), /pr merge/);

  const w2 = world();
  w2.git(w2.work, "switch", "-q", "-c", "other", w2.base);
  writeFileSync(path.join(w2.work, "x.txt"), "x\n");
  w2.git(w2.work, "add", ".");
  w2.git(w2.work, "commit", "-qm", "lạ");
  const X = w2.git(w2.work, "rev-parse", "HEAD");
  w2.git(w2.work, "push", "-q", "origin", `${X}:refs/heads/crew/req/TPS-145`);
  openPr(w2, { headRefOid: X });
  fetchFromBare(w2);
  const r2 = w2.run({ MODE: "merge", HEAD_OK: X });
  assert.equal(r2.status, 8, r2.stdout + r2.stderr);
  assert.doesNotMatch(w2.calls(), /pr merge/);
});

test("MODE sai, hoặc HEAD_OK ngoài MODE=merge: thoát 2 trước khi gọi gh", () => {
  const w = world();
  assert.equal(w.run({ MODE: "push" }).status, 2);
  assert.equal(w.run({ MODE: "bf", HEAD_OK: "a".repeat(40) }).status, 2);
  assert.equal(w.calls(), "");
});

// ---- Origin GitLab (ticket tổng code-bf): không dùng gh; MR mở bằng push option, merge bằng push thường. ----

const GL_ORIGIN = "git@gitlab.example.com:acme/sub/app.git";
const GL_TOKEN_ORIGIN = "https://bot:glpat-SECRETTOKEN123@gitlab.example.com/acme/sub/app.git";
const GL_WEB = "https://gitlab.example.com/acme/sub/app";

// post-receive giả GitLab: ghi push option, mở MR khi có merge_request.create (MR đang mở của nhánh thì dùng lại),
// cập nhật refs/merge-requests/<iid>/head, in link như GitLab (kể cả link "tạo MR" khi không có option).
const GL_HOOK = `#!/usr/bin/env node
const fs = require("fs");
const { execFileSync } = require("child_process");
const dir = process.env.GL_STUB;
const file = dir + "/mrs.json";
const st = JSON.parse(fs.readFileSync(file, "utf8"));
const opts = [];
for (let i = 0; i < Number(process.env.GIT_PUSH_OPTION_COUNT || 0); i++) opts.push(process.env["GIT_PUSH_OPTION_" + i]);
fs.appendFileSync(dir + "/push.log", JSON.stringify(opts) + "\\n");
for (const line of fs.readFileSync(0, "utf8").split("\\n").filter(Boolean)) {
  const [, sha, ref] = line.split(" ");
  const br = ref.replace(/^refs\\/heads\\//, "");
  if (br === "main" || /^0+$/.test(sha)) continue;
  let mr = st.mrs.find((m) => m.branch === br && m.state === "opened");
  if (!mr && opts.includes("merge_request.create")) {
    mr = { iid: st.next++, branch: br, state: "opened", target: (opts.find((o) => o.startsWith("merge_request.target=")) || "").split("=")[1] };
    st.mrs.push(mr);
  }
  if (mr) {
    mr.head = sha;
    execFileSync("git", ["update-ref", "refs/merge-requests/" + mr.iid + "/head", sha]);
    process.stderr.write("\\nView merge request for " + br + ":\\n  ${GL_WEB}/-/merge_requests/" + mr.iid + "\\n\\n");
  } else process.stderr.write("\\nTo create a merge request for " + br + ", visit:\\n  ${GL_WEB}/-/merge_requests/new?merge_request%5Bsource_branch%5D=" + br + "\\n\\n");
}
fs.writeFileSync(file, JSON.stringify(st));
`;

function gitlabWorld({ origin = GL_ORIGIN, mrs = [], next = 1 } = {}) {
  const w = world({ origin });
  w.git(w.bare, "config", "receive.advertisePushOptions", "true");
  const hook = path.join(w.bare, "hooks", "post-receive");
  writeFileSync(hook, GL_HOOK);
  chmodSync(hook, 0o755);
  const gl = path.join(w.root, "gl-stub");
  mkdirSync(gl);
  writeFileSync(path.join(gl, "mrs.json"), JSON.stringify({ mrs, next }));
  // git fetch/ls-remote origin đi tới repo bare (origin là URL GitLab giả, chỉ push được nhờ pushInsteadOf).
  const realGit = spawnSync("bash", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
  writeFileSync(
    path.join(w.root, "bin", "git"),
    // GL_PUSH_DROP=1: push thật tới repo bare rồi thoát 128 (mất kết nối sau khi GitLab đã cập nhật ref);
    // GL_PUSH_DROP=nofetch: như trên, và mọi git fetch sau đó lỗi.
    [
      "#!/bin/bash",
      'if [ "$1" = fetch ] && [ -e "${GL_STUB:-/nonexistent}/nofetch" ]; then echo "fatal: unable to access origin" >&2; exit 128; fi',
      `if [ "$1" = push ] && [ -n "\${GL_PUSH_DROP:-}" ]; then "${realGit}" "$@"; [ "$GL_PUSH_DROP" != nofetch ] || : > "$GL_STUB/nofetch"; echo "fatal: the remote end hung up unexpectedly" >&2; exit 128; fi`,
      `if { [ "$1" = fetch ] || [ "$1" = ls-remote ]; } && [ "$2" = origin ]; then c=$1; shift 2; exec "${realGit}" "$c" "${w.bare}" "$@"; fi`,
      `exec "${realGit}" "$@"`,
      "",
    ].join("\n"),
  );
  chmodSync(path.join(w.root, "bin", "git"), 0o755);
  const runGl = (env = {}) => w.run({ GL_STUB: gl, ...env });
  const state = () => JSON.parse(readFileSync(path.join(gl, "mrs.json"), "utf8"));
  const pushes = () => (existsSync(path.join(gl, "push.log")) ? readFileSync(path.join(gl, "push.log"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  /** Nhánh mặc định đi tiếp với một commit đổi `file` (đổi b.txt thì xung đột với commit T). */
  const advanceMain = (file, text) => {
    w.git(w.work, "switch", "-q", "-c", `adv-${file}`, w.base);
    writeFileSync(path.join(w.work, file), text);
    w.git(w.work, "add", ".");
    w.git(w.work, "commit", "-qm", `main đổi ${file}`);
    w.git(w.work, "push", "-q", "origin", `HEAD:refs/heads/main`);
    const sha = w.git(w.work, "rev-parse", "HEAD");
    w.git(w.work, "switch", "-q", "crew/req/TPS-145");
    return sha;
  };
  return { ...w, gl, runGl, state, pushes, advanceMain };
}

test("GitLab MODE=bf: không gọi gh, đẩy nhánh bằng push option merge_request.*, crew-pr ghi URL MR từ output push", () => {
  const w = gitlabWorld();
  const r = w.runGl({ MODE: "bf", NOTE: "test pnpm test: pass; docs exit 0" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  leaks(w, r);
  assert.equal(w.calls(), "", "không gọi gh");
  assert.equal(w.remoteRef("refs/heads/crew/req/TPS-145"), w.T);
  assert.equal(w.remoteRef("refs/heads/main"), w.base, "nhánh mặc định giữ nguyên");
  assert.deepEqual(w.pushes(), [["merge_request.create", "merge_request.target=main", "merge_request.title=TPS-145: Trang tổng hợp mới"]]);
  const url = `${GL_WEB}/-/merge_requests/1`;
  assert.equal(w.read("pr-url.txt"), url);
  const comment = w.json("pr-comment.json").body;
  assert.equal(comment.split("\n")[0], `crew-pr sha=${w.T} pr=${url}`);
  assert.deepEqual(CREW_PR_RE.exec(comment.split("\n")[0])?.slice(1), [w.T, url]);
  assert.ok(!existsSync(path.join(w.D, "merge-comment.json")));
  const done = w.json("done.json");
  assert.equal(done.status, "done");
  assert.equal(done.comment, `Integrator: approve — crew/req/TPS-145 tại ${w.T}, pull request ${url}; test pnpm test: pass; docs exit 0; chờ Bug Finding review`);
  assert.match(done.description, new RegExp(`### Merge request\\n\\n- Pull request: ${url.replaceAll(".", "\\.")}\\n`));
  assert.match(done.description, /- Trạng thái: đang mở, gộp được; chờ Bug Finding review/);
});

test("GitLab MODE=bf chạy lại sau lô sửa: MR đang mở được dùng lại (output push in link MR cũ), không tạo MR trùng", () => {
  const w = gitlabWorld({ mrs: [{ iid: 4, branch: "crew/req/TPS-145", state: "opened", head: "0".repeat(40) }], next: 5 });
  w.git(w.work, "push", "-q", "origin", `${w.T}:refs/heads/crew/req/TPS-145`);
  writeFileSync(path.join(w.work, "fix.txt"), "fix\n");
  w.git(w.work, "add", ".");
  w.git(w.work, "commit", "-qm", "merge(TPS-150): sửa F-01");
  const T2 = w.git(w.work, "rev-parse", "HEAD");
  const r = w.runGl({ MODE: "bf", T: T2 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(w.remoteRef("refs/heads/crew/req/TPS-145"), T2);
  assert.equal(w.state().mrs.length, 1, "không tạo MR trùng");
  assert.equal(w.json("pr-comment.json").body.split("\n")[0], `crew-pr sha=${T2} pr=${GL_WEB}/-/merge_requests/4`);
});

test("GitLab MODE=bf: nhánh đã ở đúng T (push không đổi gì, không có output) thì không đoán MR qua refs/merge-requests: thoát 6 kèm hướng dẫn, URL không lộ credential", () => {
  const w = gitlabWorld({ origin: GL_TOKEN_ORIGIN, next: 3 });
  assert.equal(w.runGl({ MODE: "bf" }).status, 0, "lần đầu mở MR");
  rmSync(path.join(w.D, "pr-comment.json"));
  rmSync(path.join(w.D, "done.json"));
  const r = w.runGl({ MODE: "bf" });
  assert.equal(r.status, 6, r.stdout + r.stderr);
  leaks(w, r);
  assert.equal(w.pushes().length, 1, "lần hai push không đổi ref nên hook không chạy");
  assert.ok(!existsSync(path.join(w.D, "pr-comment.json")), "không ghi crew-pr khi không chắc MR còn mở");
  assert.ok(!existsSync(path.join(w.D, "done.json")));
  const err = w.read("error.txt");
  assert.match(err, /không xác định được merge request đang mở của nhánh crew\/req\/TPS-145/);
  assert.match(err, /xóa nhánh crew\/req\/TPS-145 trên GitLab rồi comment để chạy lại/);
});

// F-09: MR cũ đã đóng vẫn giữ refs/merge-requests/<iid>/head = T; script không được nhận MR đó.
test("GitLab MODE=bf: MR iid=3 đã đóng có head T, nhánh đã ở T thì không ghi crew-pr với MR 3 (thoát 6)", () => {
  const w = gitlabWorld({ mrs: [{ iid: 3, branch: "crew/req/TPS-145", state: "closed" }], next: 4 });
  w.git(w.work, "push", "-q", "origin", `${w.T}:refs/heads/crew/req/TPS-145`);
  w.git(w.bare, "update-ref", "refs/merge-requests/3/head", w.T);
  const r = w.runGl({ MODE: "bf" });
  assert.equal(r.status, 6, r.stdout + r.stderr);
  assert.ok(!existsSync(path.join(w.D, "pr-comment.json")), "không ghi crew-pr");
  assert.ok(!existsSync(path.join(w.D, "pr-url.txt")));
  for (const f of ["error.txt"]) assert.doesNotMatch(w.read(f), /merge_requests\/3/);
  assert.equal(w.state().mrs.length, 1, "không mở MR mới");
});

test("GitLab MODE=bf: không tìm được URL MR thì thoát 6, không ghi crew-pr", () => {
  const w = gitlabWorld();
  w.git(w.work, "push", "-q", "origin", `${w.T}:refs/heads/crew/req/TPS-145`);
  const r = w.runGl({ MODE: "bf" });
  assert.equal(r.status, 6, r.stdout + r.stderr);
  assert.match(w.read("error.txt"), /URL merge request/);
  assert.ok(!existsSync(path.join(w.D, "pr-comment.json")));
});

test("GitLab MODE=bf: conflict với nhánh mặc định (kiểm bằng git cục bộ) thì thoát 7, không push nhánh, không ghi crew-pr", () => {
  const w = gitlabWorld();
  w.advanceMain("b.txt", "khác\n");
  const r = w.runGl({ MODE: "bf" });
  assert.equal(r.status, 7, r.stdout + r.stderr);
  assert.match(w.read("error.txt"), /conflict với main/);
  assert.equal(w.remoteRef("refs/heads/crew/req/TPS-145"), "");
  assert.ok(!existsSync(path.join(w.D, "pr-comment.json")));
  assert.ok(!existsSync(path.join(w.D, "done.json")));
  assert.equal(w.calls(), "");
});

/** Mở MR cho T bằng MODE=bf rồi trả URL MR. */
const openMr = (w) => {
  const r = w.runGl({ MODE: "bf" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const url = w.read("pr-url.txt");
  for (const f of ["pr-url.txt", "pr-comment.json", "done.json"]) rmSync(path.join(w.D, f));
  return url;
};

test("GitLab MODE=merge: đẩy đúng T vào nhánh mặc định bằng push thường, crew-merge pushed=merged pr=<URL MR> merge=T", () => {
  const w = gitlabWorld();
  const url = openMr(w);
  const r = w.runGl({ MODE: "merge", PR: url });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  leaks(w, r);
  assert.equal(w.calls(), "", "không gọi gh");
  assert.equal(w.remoteRef("refs/heads/main"), w.T);
  const first = w.json("merge-comment.json").body.split("\n")[0];
  assert.equal(first, `crew-merge sha=${w.T} branch=main pushed=merged pr=${url} merge=${w.T}`);
  assert.deepEqual(MERGED_RE.exec(first)?.slice(1), [w.T, "main", url, w.T]);
  const done = w.json("done.json");
  assert.equal(done.comment, `Integrator: approve — đã merge pull request ${url} vào \`main\` tại ${w.T} (commit owner duyệt ${w.T})`);
  assert.match(done.description, /- Trạng thái: đã merge vào `main`/);
});

test("GitLab MODE=merge: nhánh mặc định đi tiếp không xung đột thì đẩy merge commit (cha: nhánh mặc định, T), không --force", () => {
  const w = gitlabWorld();
  const url = openMr(w);
  const moved = w.advanceMain("m.txt", "main đi tiếp\n");
  const r = w.runGl({ MODE: "merge", PR: url });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const M = w.remoteRef("refs/heads/main");
  assert.equal(w.git(w.work, "rev-list", "--parents", "-n", "1", M), `${M} ${moved} ${w.T}`);
  assert.equal(w.json("merge-comment.json").body.split("\n")[0], `crew-merge sha=${w.T} branch=main pushed=merged pr=${url} merge=${M}`);
});

test("GitLab MODE=merge: head nhánh MR lệch commit owner duyệt thì thoát 8, không đẩy gì vào nhánh mặc định", () => {
  const w = gitlabWorld();
  const url = openMr(w);
  w.git(w.work, "switch", "-q", "-c", "lạ", w.T);
  writeFileSync(path.join(w.work, "lạ.txt"), "chưa duyệt\n");
  w.git(w.work, "add", ".");
  w.git(w.work, "commit", "-qm", "commit chưa duyệt");
  w.git(w.work, "push", "-q", "origin", "HEAD:refs/heads/crew/req/TPS-145");
  const r = w.runGl({ MODE: "merge", PR: url });
  assert.equal(r.status, 8, r.stdout + r.stderr);
  assert.match(w.read("error.txt"), /khác commit được duyệt/);
  assert.equal(w.remoteRef("refs/heads/main"), w.base);
  assert.ok(!existsSync(path.join(w.D, "merge-comment.json")));
});

test("GitLab MODE=merge: conflict với nhánh mặc định thì thoát 7, không đẩy", () => {
  const w = gitlabWorld();
  const url = openMr(w);
  const moved = w.advanceMain("b.txt", "khác\n");
  const r = w.runGl({ MODE: "merge", PR: url });
  assert.equal(r.status, 7, r.stdout + r.stderr);
  assert.match(w.read("error.txt"), /conflict với main/);
  assert.equal(w.remoteRef("refs/heads/main"), moved);
  assert.ok(!existsSync(path.join(w.D, "done.json")));
});

// F-12: push vào nhánh mặc định bị từ chối (nhánh bảo vệ: pre-receive từ chối ref main) thì thoát 5, main giữ nguyên.
test("GitLab MODE=merge: push vào nhánh mặc định bị từ chối (pre-receive chặn main) thì thoát 5, main giữ nguyên, không có merge-comment.json", () => {
  const w = gitlabWorld();
  const url = openMr(w);
  const hook = path.join(w.bare, "hooks", "pre-receive");
  writeFileSync(hook, '#!/bin/bash\nwhile read -r old new ref; do [ "$ref" != refs/heads/main ] || { echo "GitLab: You are not allowed to push code to protected branches on this project." >&2; exit 1; }; done\n');
  chmodSync(hook, 0o755);
  const r = w.runGl({ MODE: "merge", PR: url });
  assert.equal(r.status, 5, r.stdout + r.stderr);
  leaks(w, r);
  assert.match(w.read("error.txt"), /push vào main bị từ chối/);
  assert.match(w.read("error.txt"), /protected branches/);
  assert.equal(w.remoteRef("refs/heads/main"), w.base, "main giữ nguyên");
  assert.ok(!existsSync(path.join(w.D, "merge-comment.json")));
  assert.ok(!existsSync(path.join(w.D, "done.json")));
});

// F-16: push lỗi mạng sau khi GitLab đã cập nhật ref không được báo là "bị từ chối".
test("GitLab MODE=merge: push cập nhật nhánh mặc định rồi thoát 128 (mất kết nối) thì kiểm lại và báo thành công với merge= đúng", () => {
  const w = gitlabWorld();
  const url = openMr(w);
  const r = w.runGl({ MODE: "merge", PR: url, GL_PUSH_DROP: "1" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(w.remoteRef("refs/heads/main"), w.T);
  assert.equal(w.json("merge-comment.json").body.split("\n")[0], `crew-merge sha=${w.T} branch=main pushed=merged pr=${url} merge=${w.T}`);
  // Nhánh mặc định đi tiếp: merge commit được đẩy rồi mất kết nối, merge= là merge commit đó.
  const v = gitlabWorld();
  const url2 = openMr(v);
  v.advanceMain("m.txt", "main đi tiếp\n");
  const r2 = v.runGl({ MODE: "merge", PR: url2, GL_PUSH_DROP: "1" });
  assert.equal(r2.status, 0, r2.stdout + r2.stderr);
  const M = v.remoteRef("refs/heads/main");
  assert.equal(v.json("merge-comment.json").body.split("\n")[0], `crew-merge sha=${v.T} branch=main pushed=merged pr=${url2} merge=${M}`);
});

test("GitLab MODE=merge: push lỗi và không fetch lại được nhánh mặc định thì báo chưa rõ (thoát 6), không báo bị từ chối, không ghi crew-merge", () => {
  const w = gitlabWorld();
  const url = openMr(w);
  const r = w.runGl({ MODE: "merge", PR: url, GL_PUSH_DROP: "nofetch" });
  assert.equal(r.status, 6, r.stdout + r.stderr);
  const err = w.read("error.txt");
  assert.match(err, /chưa rõ/);
  assert.doesNotMatch(err, /bị từ chối/);
  assert.ok(!existsSync(path.join(w.D, "merge-comment.json")));
  assert.ok(!existsSync(path.join(w.D, "done.json")));
});

// F-10, F-17: repo GitLab không hỗ trợ auto-deploy. Script ghi $D/deploy.txt; integrator.md (Stage merge bước 4) chỉ chạy
// enqueue khi file là `pr`. deployStep làm đúng luật đó với một enqueue giả đếm số lần gọi.
function deployStep(w) {
  const calls = [];
  const deploy = existsSync(path.join(w.D, "deploy.txt")) ? w.read("deploy.txt").trim() : "";
  if (deploy !== "skip") calls.push(["enqueue", "--sha", w.T, "--pr", w.read("pr-url.txt")]);
  return calls;
}

test("GitLab MODE=merge: script ghi deploy.txt=skip nên integrator không gọi auto-deploy enqueue (0 lần)", () => {
  const w = gitlabWorld();
  const url = openMr(w);
  const r = w.runGl({ MODE: "merge", PR: url });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(w.read("deploy.txt"), "skip");
  assert.equal(deployStep(w).length, 0, "không gọi enqueue với URL MR");
  assert.match(w.json("merge-comment.json").body, /Origin GitLab: không deploy tự động/);
});

test("GitLab MODE=merge chạy lại khi T đã vào nhánh mặc định: không đẩy lại, merge= là commit đã đưa T vào", () => {
  const w = gitlabWorld();
  const url = openMr(w);
  w.advanceMain("m.txt", "main đi tiếp\n");
  assert.equal(w.runGl({ MODE: "merge", PR: url }).status, 0);
  const M = w.remoteRef("refs/heads/main");
  rmSync(path.join(w.D, "merge-comment.json"));
  const r = w.runGl({ MODE: "merge", PR: url });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(w.remoteRef("refs/heads/main"), M, "không đẩy thêm");
  assert.equal(w.json("merge-comment.json").body.split("\n")[0], `crew-merge sha=${w.T} branch=main pushed=merged pr=${url} merge=${M}`);
});

test("GitLab MODE=merge với HEAD_OK (owner gộp nhánh mặc định vào nhánh MR): đẩy đúng head đó", () => {
  const w = gitlabWorld();
  const url = openMr(w);
  const moved = w.advanceMain("m.txt", "main đi tiếp\n");
  w.git(w.work, "fetch", "-q", w.bare, "main");
  w.git(w.work, "merge", "-q", "--no-ff", "-m", "Merge main vào crew/req/TPS-145 (owner)", moved);
  const H = w.git(w.work, "rev-parse", "HEAD");
  w.git(w.work, "push", "-q", "origin", `${H}:refs/heads/crew/req/TPS-145`);
  const r = w.runGl({ MODE: "merge", PR: url, HEAD_OK: H });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(w.remoteRef("refs/heads/main"), H);
  const body = w.json("merge-comment.json").body;
  assert.equal(body.split("\n")[0], `crew-merge sha=${w.T} branch=main pushed=merged pr=${url} merge=${H}`);
  assert.match(body, new RegExp(`Head PR khi merge: \`${H}\``));
});

test("GitLab MODE=merge: thiếu PR (URL MR của crew-pr) hoặc URL không phải MR thì thoát 2, không đẩy", () => {
  const w = gitlabWorld();
  assert.equal(w.runGl({ MODE: "merge" }).status, 2);
  assert.equal(w.runGl({ MODE: "merge", PR: "https://github.com/acme/app/pull/1" }).status, 2);
  assert.equal(w.remoteRef("refs/heads/main"), w.base);
});

test("origin không ở GitHub, MODE=owner (ticket thường): vẫn thoát 3 để push thẳng, không push option", () => {
  const w = gitlabWorld();
  const r = w.runGl();
  assert.equal(r.status, 3);
  assert.equal(w.remoteRef("refs/heads/crew/req/TPS-145"), "");
  assert.deepEqual(w.pushes(), []);
});

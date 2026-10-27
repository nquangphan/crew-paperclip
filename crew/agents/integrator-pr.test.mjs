// Runs the pull request script of integrator.md ("Script mở pull request") exactly as the agent copies it, against a
// local bare repo posing as a GitHub origin (pushInsteadOf) and a stub `gh`. Never talks to GitHub.
// Run: node --test crew/agents/integrator-pr.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

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
  process.stdout.write(JSON.stringify({ url: p.url, state: p.state, mergeable: p.state === "OPEN" ? p.mergeable : "UNKNOWN" }));
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

function world({ origin = ORIGIN, description = SUMMARY, prs = [], fail, failOut, mergeable } = {}) {
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
  writeFileSync(path.join(stub, "state.json"), JSON.stringify({ prs, fail, failOut, mergeable, headOid: T }));
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
  const all = [r.stdout, r.stderr, ...["error.txt", "merge-comment.json", "done.json", "pr-body.md"].filter((f) => existsSync(path.join(w.D, f))).map((f) => w.read(f))];
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

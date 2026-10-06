import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const upgrade = path.join(here, "upgrade.sh");
const verify = path.join(here, "verify.sh");
const env = { ...process.env, CREW_UPGRADE_SKIP_FETCH: "1" };

const tempDirs = [];
function tempDir(prefix) {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function syncBranches(cwd) {
  const result = spawnSync("git", ["-C", cwd, "branch", "--list", "sync/*", "--format=%(refname:short)"], {
    encoding: "utf8",
  });
  return result.stdout.split("\n").filter(Boolean).sort();
}

test("không có ref thì in cách dùng và thoát 64", () => {
  const result = spawnSync("bash", [upgrade], { env, encoding: "utf8" });
  assert.equal(result.status, 64);
  assert.match(result.stderr, /Cách dùng/);
});

test("ref không tồn tại thì thoát 65", () => {
  const result = spawnSync("bash", [upgrade, "refs/tags/crew-khong-co-tag-nay"], { env, encoding: "utf8" });
  assert.equal(result.status, 65);
  assert.match(result.stderr, /Không tìm thấy ref/);
});

test("worktree đã tồn tại thì thoát 66 và không tạo nhánh", () => {
  const existing = tempDir("crew-upgrade-exists-");
  const result = spawnSync("bash", [upgrade, "HEAD", "--worktree", existing], { env, encoding: "utf8" });
  assert.equal(result.status, 66);
  const branch = spawnSync("git", ["-C", here, "show-ref", "--verify", "--quiet", "refs/heads/sync/paperclip-HEAD"]);
  assert.notEqual(branch.status, 0);
});

test("base không có crew/release/verify.sh thì thoát 65 và không tạo nhánh hay worktree", () => {
  const before = syncBranches(here);
  const target = path.join(tempDir("crew-upgrade-base-"), "wt");
  const result = spawnSync("bash", [upgrade, "HEAD", "--base", "8f8a0ab7e", "--worktree", target], {
    env,
    encoding: "utf8",
  });
  assert.equal(result.status, 65);
  assert.match(result.stderr, /không có crew\/release\/verify\.sh/);
  assert.deepEqual(syncBranches(here), before);
  assert.equal(existsSync(target), false);
});

test("verify.sh từ chối chạy ngoài gốc worktree", () => {
  const result = spawnSync("bash", [verify], { cwd: here, encoding: "utf8" });
  assert.equal(result.status, 70);
});

// Fixture repo: base branch `main` carries upgrade.sh and a fake verify.sh; branch `upstream-side`
// plays the upstream ref. Global git config is ignored so signing or hooks of the machine do not apply.
const gitEnv = {
  ...process.env,
  CREW_UPGRADE_SKIP_FETCH: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Crew Test",
  GIT_AUTHOR_EMAIL: "crew-test@example.invalid",
  GIT_COMMITTER_NAME: "Crew Test",
  GIT_COMMITTER_EMAIL: "crew-test@example.invalid",
};

function git(cwd, ...args) {
  const result = spawnSync("git", ["-C", cwd, ...args], { env: gitEnv, encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

function write(root, file, content) {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), content);
}

function fixture({ crewSide, upstreamSide, verifyScript = "exit 0\n" }) {
  const dir = tempDir("crew-upgrade-fixture-");
  const repo = path.join(dir, "repo");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  write(repo, "src/a.txt", "base\n");
  write(repo, "pnpm-lock.yaml", "lockfileVersion: base\n");
  mkdirSync(path.join(repo, "crew/release"), { recursive: true });
  copyFileSync(upgrade, path.join(repo, "crew/release/upgrade.sh"));
  write(repo, "crew/release/verify.sh", verifyScript);
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "base");
  git(repo, "branch", "upstream-side");
  for (const [file, content] of Object.entries(crewSide)) write(repo, file, content);
  git(repo, "commit", "-q", "-am", "crew side");
  git(repo, "switch", "-q", "upstream-side");
  for (const [file, content] of Object.entries(upstreamSide)) write(repo, file, content);
  git(repo, "commit", "-q", "-am", "upstream side");
  git(repo, "switch", "-q", "main");
  return { dir, repo, script: path.join(repo, "crew/release/upgrade.sh") };
}

function runUpgrade(fx, worktree, cwd = fx.dir) {
  return spawnSync("bash", [fx.script, "upstream-side", "--base", "main", "--worktree", worktree], {
    cwd,
    env: gitEnv,
    encoding: "utf8",
  });
}

test("conflict ở file nguồn thì thoát 2, liệt kê số hunk và không đổi nhánh base", () => {
  const fx = fixture({ crewSide: { "src/a.txt": "crew\n" }, upstreamSide: { "src/a.txt": "upstream\n" } });
  const baseBefore = git(fx.repo, "rev-parse", "main");
  const result = runUpgrade(fx, path.join(fx.dir, "wt"));
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /src\/a\.txt: 1/);
  assert.equal(git(fx.repo, "rev-parse", "main"), baseBefore);
});

test("chỉ pnpm-lock.yaml conflict thì lấy bản upstream và thoát 0 (worktree tương đối theo cwd)", () => {
  const fx = fixture({
    crewSide: { "pnpm-lock.yaml": "lockfileVersion: crew\n" },
    upstreamSide: { "pnpm-lock.yaml": "lockfileVersion: upstream\n" },
  });
  const result = runUpgrade(fx, "wt-relative");
  assert.equal(result.status, 0, result.stderr);
  assert.ok(existsSync(path.join(fx.dir, "wt-relative", "crew/release/verify.sh")));
  const branch = "sync/paperclip-upstream-side";
  assert.equal(git(fx.repo, "show", `${branch}:pnpm-lock.yaml`), "lockfileVersion: upstream");
  assert.equal(git(fx.repo, "rev-list", "--count", "--merges", `main..${branch}`), "1");
  assert.equal(git(fx.repo, "log", "-1", "--format=%P", branch).split(" ").length, 2);
});

test("verify.sh sinh lại importer Crew trong lockfile thì tự commit trên nhánh sync", () => {
  const fx = fixture({
    crewSide: { "pnpm-lock.yaml": "lockfileVersion: crew\n" },
    upstreamSide: { "pnpm-lock.yaml": "lockfileVersion: upstream\n" },
    verifyScript: "printf '  packages/crew-plugin: {}\\n' >> pnpm-lock.yaml\n",
  });
  const worktree = path.join(fx.dir, "wt");
  const result = runUpgrade(fx, worktree);
  assert.equal(result.status, 0, result.stderr);
  const branch = "sync/paperclip-upstream-side";
  assert.equal(git(fx.repo, "log", "-1", "--format=%s", branch), "chore(sync): restore Crew lockfile importer");
  assert.equal(
    git(fx.repo, "show", `${branch}:pnpm-lock.yaml`),
    "lockfileVersion: upstream\n  packages/crew-plugin: {}",
  );
  assert.equal(git(fx.repo, "show", `${branch}~1:pnpm-lock.yaml`), "lockfileVersion: upstream");
  assert.equal(git(worktree, "status", "--porcelain"), "");
});

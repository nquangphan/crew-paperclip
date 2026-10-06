import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const upgrade = path.join(here, "upgrade.sh");
const verify = path.join(here, "verify.sh");
const env = { ...process.env, CREW_UPGRADE_SKIP_FETCH: "1" };

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
  const existing = mkdtempSync(path.join(tmpdir(), "crew-upgrade-exists-"));
  const result = spawnSync("bash", [upgrade, "HEAD", "--worktree", existing], { env, encoding: "utf8" });
  assert.equal(result.status, 66);
  const branch = spawnSync("git", ["-C", here, "show-ref", "--verify", "--quiet", "refs/heads/sync/paperclip-HEAD"]);
  assert.notEqual(branch.status, 0);
});

test("verify.sh từ chối chạy ngoài gốc worktree", () => {
  const result = spawnSync("bash", [verify], { cwd: here, encoding: "utf8" });
  assert.equal(result.status, 70);
});

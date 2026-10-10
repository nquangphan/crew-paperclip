// Tests for overlay-source.sh's file guard. Run: node --test crew/ops/overlay-source.test.mjs
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const OPS = path.dirname(fileURLToPath(import.meta.url));
const dirs = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const git = (cwd, ...args) => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};

/** A tiny fork: base tag v1.0.0, then one commit changing `changed`; returns the script's stderr and status. */
function run(changed) {
  const root = mkdtempSync(path.join(tmpdir(), "crew-overlay-"));
  dirs.push(root);
  mkdirSync(path.join(root, "crew/ops"), { recursive: true });
  mkdirSync(path.join(root, "crew/release"), { recursive: true });
  cpSync(path.join(OPS, "overlay-source.sh"), path.join(root, "crew/ops/overlay-source.sh"));
  writeFileSync(path.join(root, "crew/release/core-hooks.json"), JSON.stringify({ base: "v1.0.0" }));
  git(root, "init", "-q");
  git(root, "config", "user.email", "t@t");
  git(root, "config", "user.name", "t");
  git(root, "add", "-f", ".");
  git(root, "commit", "-qm", "base");
  git(root, "tag", "v1.0.0");
  for (const file of changed) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), "x\n");
  }
  git(root, "add", "-f", ".");
  git(root, "commit", "-qm", "change");
  const r = spawnSync("bash", [path.join(root, "crew/ops/overlay-source.sh")], {
    cwd: root, encoding: "utf8", env: { ...process.env, OVERLAY_NO_UPLOAD: "1" },
  });
  return r;
}

test("refuses a changed file outside the shippable areas", () => {
  const r = run(["scripts/other.sh"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /cannot ship/);
  assert.match(r.stderr, /scripts\/other\.sh/);
});

test("accepts the stock UI files: ui/ is served by stock-ui.sh and never ships in the image", () => {
  const r = run(["ui/src/main.tsx", "ui/vite.config.ts"]);
  assert.doesNotMatch(r.stderr, /cannot ship/);
});

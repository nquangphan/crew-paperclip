// Tests for inspect-adapters.mjs and its call from inspect-image.sh, with a fake `docker` on PATH.
// Run: node --test crew/ops/inspect-adapters.test.mjs
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

const ANCHOR = "      ...(remoteExecution ? { remoteExecution } : {}),";
const GOOD = `a\n${ANCHOR}\nb\n${ANCHOR}\n`;
const CODEX = "packages/adapters/codex-local/src/server/index.ts";
const OPENCODE = "packages/adapters/opencode-local/src/server/execute.ts";
const ENTRIES = [
  { id: "P5", kind: "adapter-patch", file: CODEX, anchor: ANCHOR, occurrences: 2 },
  { id: "P6", kind: "adapter-patch", file: OPENCODE, anchor: "  const inPlaceRoot = x" },
  { id: "H1", kind: "hook", file: "server/src/services/heartbeat.ts", anchor: "zzz" },
];
const OPENCODE_GOOD = "top\n  const inPlaceRoot = x\n";

/** A fork with the committed adapter files and a fake image dir; `image` maps path -> content (absent = missing). */
function setup(image) {
  const root = mkdtempSync(path.join(tmpdir(), "crew-inspect-"));
  dirs.push(root);
  for (const d of ["crew/ops", "crew/release", path.dirname(CODEX), path.dirname(OPENCODE), "bin", "img"]) {
    mkdirSync(path.join(root, d), { recursive: true });
  }
  cpSync(path.join(OPS, "inspect-adapters.mjs"), path.join(root, "crew/ops/inspect-adapters.mjs"));
  cpSync(path.join(OPS, "inspect-image.sh"), path.join(root, "crew/ops/inspect-image.sh"));
  writeFileSync(path.join(root, "crew/release/core-hooks.json"), JSON.stringify({ base: "v1.0.0", entries: ENTRIES }));
  writeFileSync(path.join(root, CODEX), GOOD);
  writeFileSync(path.join(root, OPENCODE), OPENCODE_GOOD);
  for (const [f, text] of Object.entries(image)) {
    mkdirSync(path.dirname(path.join(root, "img", f)), { recursive: true });
    writeFileSync(path.join(root, "img", f), text);
  }
  // `docker run --rm --entrypoint cat <image> /app/<file>` prints the fake image file; any other run is a no-op.
  writeFileSync(path.join(root, "bin/docker"), `#!/bin/sh
if [ "$4" = cat ]; then f="${root}/img/\${6#/app/}"; [ -f "$f" ] && exec cat "$f"; exit 1; fi
exit 0
`);
  chmodSync(path.join(root, "bin/docker"), 0o755);
  const git = (...a) => {
    const r = spawnSync("git", a, { cwd: root, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
  };
  git("init", "-q"); git("config", "user.email", "t@t"); git("config", "user.name", "t");
  git("add", "-f", "."); git("commit", "-qm", "c");
  return root;
}

const env = (root) => ({ ...process.env, PATH: `${root}/bin:${process.env.PATH}` });
const inspect = (root) => spawnSync("node", [path.join(root, "crew/ops/inspect-adapters.mjs"), "img:tag"], { cwd: root, encoding: "utf8", env: env(root) });

test("passes when the image adapter files match the commit", () => {
  const root = setup({ [CODEX]: GOOD, [OPENCODE]: OPENCODE_GOOD });
  const r = inspect(root);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /adapter P5 .*codex-local.* ok/);
  assert.match(r.stdout, /adapter P6 .*opencode-local.* ok/);
  assert.doesNotMatch(r.stdout, /H1/);
});

test("fails when an image adapter file differs from the commit", () => {
  const root = setup({ [CODEX]: GOOD + "extra\n", [OPENCODE]: OPENCODE_GOOD });
  const r = inspect(root);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /adapter P5 .* FAIL: sha256/);
  assert.match(r.stdout, /adapter P6 .* ok/);
});

test("fails when an adapter file is missing from the image", () => {
  const root = setup({ [OPENCODE]: OPENCODE_GOOD });
  const r = inspect(root);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /adapter P5 .* MISSING/);
});

test("fails when the committed file lost the anchor even if the image matches it", () => {
  const root = setup({ [CODEX]: GOOD, [OPENCODE]: OPENCODE_GOOD });
  writeFileSync(path.join(root, CODEX), "no anchor\n");
  writeFileSync(path.join(root, "img", CODEX), "no anchor\n");
  spawnSync("git", ["commit", "-qam", "drop anchor"], { cwd: root });
  const r = inspect(root);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /adapter P5 .* FAIL: anchor occurs 0x, expected 2x/);
});

test("inspect-image.sh prints the adapter results and fails when one patch fails", () => {
  const root = setup({ [CODEX]: GOOD + "extra\n", [OPENCODE]: OPENCODE_GOOD });
  const r = spawnSync("sh", [path.join(root, "crew/ops/inspect-image.sh"), "img:tag"], { cwd: root, encoding: "utf8", env: env(root) });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /adapter P5 .* FAIL: sha256/);
  assert.match(r.stdout, /adapter P6 .* ok/);
});

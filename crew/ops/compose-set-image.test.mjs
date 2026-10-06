// Tests for compose-set-image.py (used by deploy.sh). Run: node --test crew/ops/compose-set-image.test.mjs
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "compose-set-image.py");
const dirs = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function run(compose, image) {
  const dir = mkdtempSync(path.join(tmpdir(), "crew-compose-"));
  dirs.push(dir);
  const file = path.join(dir, "docker-compose.yml");
  writeFileSync(file, compose);
  const r = spawnSync("python3", [SCRIPT, file, image], { encoding: "utf8" });
  return { ...r, text: readFileSync(file, "utf8") };
}

const COMPOSE = `name: crew-v3-spike
services:
  db:
    image: postgres:17-alpine
    restart: unless-stopped
  server:
    image: crew-v3-spike/paperclip:in-place-6ab1aa8
    restart: unless-stopped
    ports:
      - "100.105.105.12:3100:3100"
`;

test("changes only the server image and adds stop_grace_period once", () => {
  const r = run(COMPOSE, "crew-v3/paperclip:v3-abc");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.text, /^ {2}server:\n {4}stop_grace_period: 60s\n {4}image: crew-v3\/paperclip:v3-abc\n/m);
  assert.match(r.text, /^ {4}image: postgres:17-alpine$/m);
  const again = run(r.text, "crew-v3/paperclip:v3-def");
  assert.equal(again.status, 0, again.stderr);
  assert.equal(again.text.match(/stop_grace_period/g).length, 1);
  assert.match(again.text, /image: crew-v3\/paperclip:v3-def/);
});

test("fails and leaves the file untouched when the server block has no image line", () => {
  const compose = COMPOSE.replace("    image: crew-v3-spike/paperclip:in-place-6ab1aa8\n", "");
  const r = run(compose, "crew-v3/paperclip:v3-abc");
  assert.notEqual(r.status, 0);
  assert.equal(r.text, compose);
});

test("fails when there is no server service", () => {
  const compose = COMPOSE.replace("  server:\n", "  web:\n");
  const r = run(compose, "crew-v3/paperclip:v3-abc");
  assert.notEqual(r.status, 0);
  assert.equal(r.text, compose);
});

test("fails when the image tag is not a plain image reference", () => {
  const r = run(COMPOSE, "bad image\nx: y");
  assert.notEqual(r.status, 0);
  assert.equal(r.text, COMPOSE);
});

// Tests for the off-host backup copy: backup-serve.sh (VPS forced command) and
// pull-backup.sh (Mac mini puller). Run: node --test crew/ops/pull-backup.test.mjs
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const OPS = path.dirname(fileURLToPath(import.meta.url));
const SERVE = path.join(OPS, "backup-serve.sh");
const PULL = path.join(OPS, "pull-backup.sh");
const dirs = [];

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tmp(prefix) {
  const d = mkdtempSync(path.join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}

function gzipOf(text) {
  return execFileSync("gzip", ["-c"], { input: text });
}

/** Writes one complete daily backup set the way backup.sh names it. */
function writeSet(dir, ts, seed = ts) {
  writeFileSync(path.join(dir, `db-${ts}.dump`), Buffer.concat([Buffer.from("PGDMP"), Buffer.from(`dump ${seed}`)]));
  writeFileSync(path.join(dir, `paperclip-data-${ts}.tar.gz`), gzipOf(`data ${seed}`));
  writeFileSync(path.join(dir, `config-${ts}.tar.gz`), gzipOf(`config ${seed}`));
  writeFileSync(path.join(dir, `issues-${ts}.txt`), `issue|CRE-1|done ${seed}\n`);
}

/** Fake ssh that behaves like the forced command: the remote words become SSH_ORIGINAL_COMMAND. */
function fakeSsh(serverDir, { corrupt = null } = {}) {
  const bin = path.join(tmp("crew-fake-ssh-"), "ssh");
  const filter = corrupt ? `| sed 's/^/X/'` : "";
  writeFileSync(
    bin,
    [
      "#!/bin/bash",
      `export CREW_BACKUP_DIR=${JSON.stringify(serverDir)}`,
      'export SSH_ORIGINAL_COMMAND="$*"',
      corrupt
        ? `if [ "$*" = "get ${corrupt}" ]; then bash ${JSON.stringify(SERVE)} ${filter}; exit \${PIPESTATUS[0]}; fi`
        : "",
      `exec bash ${JSON.stringify(SERVE)}`,
    ].join("\n"),
  );
  chmodSync(bin, 0o755);
  return bin;
}

function serve(serverDir, command) {
  return spawnSync("bash", [SERVE], {
    env: { ...process.env, CREW_BACKUP_DIR: serverDir, SSH_ORIGINAL_COMMAND: command },
    encoding: "utf8",
  });
}

function pull(dest, sshBin, today) {
  return spawnSync("bash", [PULL], {
    env: { ...process.env, CREW_PULL_DEST: dest, CREW_PULL_SSH: sshBin, CREW_PULL_TODAY: today },
    encoding: "utf8",
  });
}

const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

test("serve lists only complete sets and refuses anything else", () => {
  const server = tmp("crew-serve-");
  writeSet(server, "20261005-0330");
  writeSet(server, "20261006-0330");
  writeFileSync(path.join(server, "db-20261007-0330.dump.tmp"), "partial");
  writeFileSync(path.join(server, "db-20261007-0330.dump"), "PGDMP only db");

  const list = serve(server, "list");
  assert.equal(list.status, 0);
  assert.deepEqual(list.stdout.trim().split("\n"), ["20261005-0330", "20261006-0330"]);

  const manifest = serve(server, "manifest 20261006-0330");
  assert.equal(manifest.status, 0);
  const lines = manifest.stdout.trim().split("\n");
  assert.equal(lines.length, 4);
  const db = lines.find((l) => l.startsWith("db-20261006-0330.dump "));
  assert.equal(db.split(" ")[2], sha(path.join(server, "db-20261006-0330.dump")));

  for (const bad of ["get ../../etc/passwd", "get .env", "manifest ../x", "rm -rf /", "", "list; id"]) {
    const r = serve(server, bad);
    assert.notEqual(r.status, 0, `must refuse: ${JSON.stringify(bad)}`);
    assert.equal(r.stdout, "");
  }
});

test("pull copies every complete set inside the retention window and verifies it", () => {
  const server = tmp("crew-serve-");
  writeSet(server, "20261001-0330");
  writeSet(server, "20261005-0330");
  writeSet(server, "20261006-0330");
  const dest = tmp("crew-dest-");

  const r = pull(dest, fakeSsh(server), "20261016");
  assert.equal(r.status, 0, r.stderr);
  // 20261001 is older than 14 days before 20261016, so it is not pulled.
  assert.deepEqual(readdirSync(dest).filter((n) => /^\d/.test(n)).sort(), ["20261005-0330", "20261006-0330"]);
  for (const name of readdirSync(path.join(dest, "20261006-0330"))) {
    assert.equal(sha(path.join(dest, "20261006-0330", name)), sha(path.join(server, name)));
  }
  assert.equal(statSync(path.join(dest, "20261006-0330")).mode & 0o777, 0o700);

  const again = pull(dest, fakeSsh(server), "20261016");
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /pulled=0/);
});

test("pull rejects a corrupted transfer and leaves no partial set behind", () => {
  const server = tmp("crew-serve-");
  writeSet(server, "20261006-0330");
  const dest = tmp("crew-dest-");

  const r = pull(dest, fakeSsh(server, { corrupt: "paperclip-data-20261006-0330.tar.gz" }), "20261006");
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /paperclip-data-20261006-0330\.tar\.gz/);
  assert.equal(existsSync(path.join(dest, "20261006-0330")), false);
  assert.deepEqual(readdirSync(dest).filter((n) => n.startsWith(".incoming")), []);
});

test("pull rotates local sets older than 14 days and keeps everything else", () => {
  const server = tmp("crew-serve-");
  const dest = tmp("crew-dest-");
  for (const ts of ["20260920-0330", "20261001-0330", "20261002-0330", "20261015-0330"]) {
    mkdirSync(path.join(dest, ts));
    writeFileSync(path.join(dest, ts, "issues.txt"), "x");
  }
  mkdirSync(path.join(dest, "keep-me"));

  const r = pull(dest, fakeSsh(server), "20261016");
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(readdirSync(dest).sort(), ["20261002-0330", "20261015-0330", "keep-me"]);
  assert.match(r.stdout, /removed=2/);
});

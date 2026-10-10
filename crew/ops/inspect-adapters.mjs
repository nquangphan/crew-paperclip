#!/usr/bin/env node
// Checks the adapter patches (core-hooks.json "adapter-patch" entries) inside a built overlay image.
// Usage: inspect-adapters.mjs <image-tag> [<commit>] (default HEAD of the fork this script lives in)
// Per file: sha256 of the image file must equal the committed file, and each entry's anchor must occur
// `occurrences` times (default 1). Exit 1 when any patch fails.
// Other modes:
//   --write-manifest <out> [<commit>]  writes the expected sha256/anchor of every adapter-patch (run by overlay-source.sh
//                                      on the Mac; the file ships in the overlay tarball as /app/crew-adapter-expect.json).
//   --in-image                         runs INSIDE the image (needs only node): checks /app files against that manifest.
//                                      inspect-image.sh pipes this script into `docker run`, so the VPS needs no node or git.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [image, commitArg] = process.argv.slice(2);
const sha = (buf) => createHash("sha256").update(buf).digest("hex");
const count = (text, needle) => text.split(needle).length - 1;

if (image === "--in-image") {
  const appRoot = process.env.APP_ROOT ?? "/app";
  const manifestPath = `${appRoot}/crew-adapter-expect.json`;
  if (!existsSync(manifestPath)) {
    console.log("adapter manifest MISSING: image was built without crew-adapter-expect.json (rebuild with the current overlay-source.sh)");
    process.exit(1);
  }
  let failed = false;
  const { entries = [] } = JSON.parse(readFileSync(manifestPath, "utf8"));
  for (const e of entries) {
    const label = `adapter ${e.id} ${e.file}`;
    if (!existsSync(`${appRoot}/${e.file}`)) {
      console.log(`${label} MISSING`);
      failed = true;
      continue;
    }
    const buf = readFileSync(`${appRoot}/${e.file}`);
    const got = sha(buf);
    const gotCount = count(buf.toString(), e.anchor);
    if (got !== e.sha256) {
      console.log(`${label} FAIL: sha256 ${got.slice(0, 12)} differs from commit ${e.sha256.slice(0, 12)}`);
      failed = true;
    } else if (gotCount !== (e.occurrences ?? 1)) {
      console.log(`${label} FAIL: anchor occurs ${gotCount}x, expected ${e.occurrences ?? 1}x`);
      failed = true;
    } else {
      console.log(`${label} ok (sha256 ${got.slice(0, 12)}, anchor ${gotCount}x)`);
    }
  }
  if (entries.length === 0) console.log("adapter patches: none listed in manifest");
  process.exit(failed ? 1 : 0);
}

if (!image) {
  console.error("usage: inspect-adapters.mjs <image-tag> [<commit>]");
  process.exit(2);
}
const fork = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const git = (...args) => execFileSync("git", ["-C", fork, ...args], { maxBuffer: 64 << 20 });
if (image === "--write-manifest") {
  // argv: --write-manifest <out> [<commit>]; here `commit` was parsed as the out path.
  const out = commitArg;
  const at = process.argv[4] ?? "HEAD";
  const c = git("rev-parse", at).toString().trim();
  const hk = JSON.parse(git("show", `${c}:crew/release/core-hooks.json`).toString());
  const entries = (hk.entries ?? []).filter((e) => e.kind === "adapter-patch").map((e) => ({
    id: e.id, file: e.file, anchor: e.anchor, occurrences: e.occurrences ?? 1, sha256: sha(git("show", `${c}:${e.file}`)),
  }));
  writeFileSync(out, JSON.stringify({ commit: c, entries }, null, 2));
  console.log(`adapter manifest: ${entries.length} entries for ${c.slice(0, 9)}`);
  process.exit(0);
}
const commit = git("rev-parse", commitArg ?? "HEAD").toString().trim();

const hooks = JSON.parse(git("show", `${commit}:crew/release/core-hooks.json`).toString());
const patches = (hooks.entries ?? []).filter((e) => e.kind === "adapter-patch");

const imageFile = new Map();
let failed = false;

for (const e of patches) {
  if (!imageFile.has(e.file)) {
    let buf = null;
    try {
      buf = execFileSync("docker", ["run", "--rm", "--entrypoint", "cat", image, `/app/${e.file}`], {
        maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {}
    imageFile.set(e.file, buf);
  }
  const inImage = imageFile.get(e.file);
  const label = `adapter ${e.id} ${e.file}`;
  if (!inImage) {
    console.log(`${label} MISSING`);
    failed = true;
    continue;
  }
  const want = sha(git("show", `${commit}:${e.file}`));
  const got = sha(inImage);
  const wantCount = e.occurrences ?? 1;
  const gotCount = count(inImage.toString(), e.anchor);
  if (got !== want) {
    console.log(`${label} FAIL: sha256 ${got.slice(0, 12)} differs from commit ${want.slice(0, 12)}`);
    failed = true;
  } else if (gotCount !== wantCount) {
    console.log(`${label} FAIL: anchor occurs ${gotCount}x, expected ${wantCount}x`);
    failed = true;
  } else {
    console.log(`${label} ok (sha256 ${got.slice(0, 12)}, anchor ${gotCount}x)`);
  }
}
if (patches.length === 0) console.log("adapter patches: none listed in core-hooks.json");
process.exit(failed ? 1 : 0);

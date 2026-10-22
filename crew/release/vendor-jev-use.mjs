#!/usr/bin/env node
// Tạo lại server/src/crew/vendor/jev-use-0.8.0.ts từ tarball npm jev-use@0.8.0.
// Overlay prod chỉ chép và transpile file .ts trong server/src, không chạy pnpm install, nên server không dùng
// dependency npm `jev-use` mà dùng một bundle ESM gom đúng phần cần (Jev, OpenRouterBackend, BackendError, redact,
// builder câu hỏi). Phần này không import zod hay MCP SDK.
// Cách chạy (gốc fork): node crew/release/vendor-jev-use.mjs
// Cần mạng (npm pack) và esbuild của workspace (node_modules/.bin/esbuild).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = "0.8.0";
// Integrity của registry npm cho jev-use@0.8.0; tarball khác thì dừng.
const INTEGRITY = "sha512-nHOS52eGinSdH90lluFAGTGzP0YuOyLSrkn67VXA75kbo7usVweBF99lr+YXcZNOAhgLqukD5ezIQVU3Mcxz3w==";

const FORK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.join(FORK, "server/src/crew/vendor", `jev-use-${VERSION}.ts`);
const ESBUILD = path.join(FORK, "node_modules/.bin/esbuild");

const work = mkdtempSync(path.join(tmpdir(), "vendor-jev-use-"));
try {
  const tgzName = execFileSync("npm", ["pack", `jev-use@${VERSION}`, "--silent"], { cwd: work, encoding: "utf8" }).trim();
  const tgz = readFileSync(path.join(work, tgzName));
  const integrity = `sha512-${createHash("sha512").update(tgz).digest("base64")}`;
  if (integrity !== INTEGRITY) throw new Error(`integrity khác registry: ${integrity}`);
  const sha256 = createHash("sha256").update(tgz).digest("hex");
  mkdirSync(path.join(work, "x"));
  execFileSync("tar", ["xzf", tgzName, "-C", "x"], { cwd: work });
  const pkg = path.join(work, "x/package");
  const license = readFileSync(path.join(pkg, "LICENSE"), "utf8").trim();
  if (!/^MIT License/.test(license)) throw new Error("license của jev-use không còn là MIT, phải xét lại");

  const entry = path.join(work, "entry.mjs");
  writeFileSync(entry, [
    `export { Jev } from "${pkg}/dist/jev.js";`,
    `export { OpenRouterBackend } from "${pkg}/dist/backends/openrouter.js";`,
    `export { BackendError } from "${pkg}/dist/backends/types.js";`,
    `export { check, pick, rate } from "${pkg}/dist/protocol.js";`,
    `export { redactSecrets, REDACTED } from "${pkg}/dist/redact.js";`,
    "",
  ].join("\n"));
  const bundled = execFileSync(ESBUILD, [
    entry, "--bundle", "--format=esm", "--platform=node", "--target=node22", "--legal-comments=none", "--log-level=warning",
  ], { encoding: "utf8" });
  if (/from\s+["'](?!node:)/.test(bundled) || /\brequire\(/.test(bundled)) {
    throw new Error("bundle còn import ngoài (zod, MCP SDK...), phải xét lại entry");
  }

  const header = [
    "// @ts-nocheck",
    `// Mã vendored, KHÔNG sửa tay. Nguồn: npm jev-use@${VERSION} (https://github.com/shitianfang/jev-use),`,
    `// tarball sha256 ${sha256}, ${INTEGRITY}.`,
    "// Tạo lại bằng: node crew/release/vendor-jev-use.mjs. Kiểu dùng ở server: ./jev-use.ts.",
    "//",
    ...license.split("\n").map((line) => `// ${line}`.trimEnd()),
    "",
  ].join("\n");
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${header}\n${bundled}`);
  console.log(`đã ghi ${path.relative(FORK, OUT)} (${bundled.length} byte, tarball sha256 ${sha256})`);
} finally {
  rmSync(work, { recursive: true, force: true });
}

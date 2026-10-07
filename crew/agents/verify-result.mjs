#!/usr/bin/env node
// Checks Paperclip API responses after apply-roles.sh writes, because api.sh may exit 0 on HTTP errors.
//   verify-result.mjs patch <expected extraArgs JSON>   (response of PATCH /agents/:id on stdin)
//   verify-result.mjs write                             (response of PUT .../instructions-bundle/file on stdin)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function parseObject(text, what) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`${what}: response is not JSON`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${what}: response is not an object`);
  if (typeof value.error === "string") throw new Error(`${what}: server answered error: ${value.error}`);
  return value;
}

export function checkPatchResult(text, expectedExtraArgs) {
  const agent = parseObject(text, "PATCH agent");
  const actual = agent.adapterConfig?.extraArgs;
  if (JSON.stringify(actual) !== JSON.stringify(expectedExtraArgs)) {
    throw new Error(`PATCH agent: extraArgs after the write is ${JSON.stringify(actual)}, expected ${JSON.stringify(expectedExtraArgs)}`);
  }
}

export function checkWriteResult(text) {
  parseObject(text, "PUT instructions");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const [mode, expected] = process.argv.slice(2);
    const text = readFileSync(0, "utf8");
    if (mode === "patch") checkPatchResult(text, JSON.parse(expected));
    else if (mode === "write") checkWriteResult(text);
    else throw new Error("usage: verify-result.mjs patch <extraArgs JSON> | write");
  } catch (error) {
    process.stderr.write(`verify-result: ${error.message}\n`);
    process.exit(2);
  }
}

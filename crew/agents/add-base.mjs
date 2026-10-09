#!/usr/bin/env node
// Adds the base the server now demands for an entry-file upload (PUT .../instructions-bundle/file).
//   add-base.mjs <body file>   (response of GET .../instructions-bundle/file?path=AGENTS.md on stdin)
// Prints the body with "baseHash": the contentHash of the current file, or null when the file does not exist yet.
// Any other server error is fatal: guessing null would overwrite an entry we could not read.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const HASH_RE = /^[a-f0-9]{64}$/;

export function addBase(bodyText, currentText) {
  const body = JSON.parse(bodyText);
  let current;
  try {
    current = JSON.parse(currentText);
  } catch {
    throw new Error("GET instructions: response is not JSON");
  }
  if (!current || typeof current !== "object" || Array.isArray(current)) throw new Error("GET instructions: response is not an object");
  if (typeof current.error === "string") {
    if (!/not found|not configured/i.test(current.error)) throw new Error(`GET instructions: server answered error: ${current.error}`);
    return { ...body, baseHash: null };
  }
  if (typeof current.contentHash !== "string" || !HASH_RE.test(current.contentHash)) {
    throw new Error("GET instructions: response has no valid contentHash");
  }
  return { ...body, baseHash: current.contentHash };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const [file] = process.argv.slice(2);
    if (!file) throw new Error("usage: add-base.mjs <body file> < current file response");
    process.stdout.write(JSON.stringify(addBase(readFileSync(file, "utf8"), readFileSync(0, "utf8"))));
  } catch (error) {
    process.stderr.write(`add-base: ${error.message}\n`);
    process.exit(2);
  }
}

#!/usr/bin/env node
// Checks every Crew touch point in Paperclip core against crew/release/core-hooks.json.
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const HOOK_BUDGET = 5;
const KINDS = new Set(["hook", "adapter-patch", "driver-patch"]);
const REQUIRED = ["id", "kind", "file", "symbol", "anchor", "description"];

function countOccurrences(text, needle) {
  let count = 0;
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + needle.length)) count += 1;
  return count;
}

function trailingImports(text) {
  const lines = text.replace(/\s+$/, "").split("\n");
  const imports = [];
  for (let index = lines.length - 1; index >= 0 && lines[index].startsWith("import "); index -= 1) {
    imports.push(lines[index]);
  }
  return imports;
}

export function checkCoreHooks(repoRoot, registry) {
  const errors = [];
  const warnings = [];
  if (registry.schemaVersion !== 1) errors.push("schemaVersion phải là 1");
  const entries = Array.isArray(registry.entries) ? registry.entries : [];
  const hookCount = entries.filter((entry) => entry.kind === "hook").length;
  if (hookCount > HOOK_BUDGET) errors.push(`Ngân sách hook: ${hookCount} > ${HOOK_BUDGET}`);
  const ids = new Set();

  for (const entry of entries) {
    const id = entry.id ?? "(không id)";
    if (ids.has(id)) errors.push(`id trùng: ${id}`);
    ids.add(id);
    const missing = REQUIRED.filter((field) => typeof entry[field] !== "string" || entry[field].length === 0);
    if (entry.kind === "hook") {
      for (const field of ["head", "importLine"]) {
        if (typeof entry[field] !== "string" || entry[field].length === 0) missing.push(field);
      }
    }
    if (!("upstreamPr" in entry)) missing.push("upstreamPr");
    if (missing.length > 0) {
      errors.push(`${id}: thiếu trường ${missing.join(", ")}`);
      continue;
    }
    if (!KINDS.has(entry.kind)) {
      errors.push(`${id}: kind "${entry.kind}" không hợp lệ`);
      continue;
    }
    if (entry.kind !== "hook" && !entry.upstreamPr) warnings.push(`${id}: chưa có PR upstream`);
    for (const testFile of entry.tests ?? []) {
      if (!existsSync(path.join(repoRoot, testFile))) errors.push(`${id}: test ${testFile} không tồn tại`);
    }

    const filePath = path.join(repoRoot, entry.file);
    if (!existsSync(filePath)) {
      errors.push(`${id}: không đọc được ${entry.file}`);
      continue;
    }
    const text = readFileSync(filePath, "utf8");
    const expected = entry.occurrences ?? 1;
    const count = countOccurrences(text, entry.anchor);
    if (count !== expected) {
      errors.push(`${id}: anchor xuất hiện ${count} lần trong ${entry.file}, cần ${expected}`);
      continue;
    }

    let scopeStart = 0;
    let scopeEnd = text.length;
    if (entry.scope) {
      scopeStart = text.indexOf(entry.scope);
      if (scopeStart === -1) {
        errors.push(`${id}: không tìm thấy scope "${entry.scope}" trong ${entry.file}`);
        continue;
      }
      const next = text.indexOf("\nfunction ", scopeStart + entry.scope.length);
      if (next !== -1) scopeEnd = next;
    }
    const at = text.indexOf(entry.anchor, scopeStart);
    if (at === -1 || at >= scopeEnd) {
      errors.push(`${id}: anchor nằm ngoài scope "${entry.scope}"`);
      continue;
    }

    if (entry.importLine && !trailingImports(text).includes(entry.importLine)) {
      errors.push(`${id}: import "${entry.importLine}" không nằm cuối file ${entry.file}`);
    }
    if (entry.kind === "hook") {
      const headAt = text.lastIndexOf(entry.head, at);
      const between = headAt === -1 ? "" : text.slice(headAt + entry.head.length, at);
      const signatureOnly = headAt >= scopeStart && !between.includes(";") && /\{\s*$/.test(entry.head + between);
      if (!signatureOnly) errors.push(`${id}: hook không phải lệnh đầu tiên của ${entry.symbol}`);
    }
  }
  return { errors, warnings, hookCount };
}

const invokedPath = process.argv[1] ? realpathSync(process.argv[1]) : "";
if (invokedPath === realpathSync(fileURLToPath(import.meta.url))) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const registry = JSON.parse(readFileSync(path.join(root, "crew/release/core-hooks.json"), "utf8"));
  const { errors, warnings, hookCount } = checkCoreHooks(root, registry);
  for (const warning of warnings) console.warn(`CẢNH BÁO ${warning}`);
  for (const error of errors) console.error(`LỖI ${error}`);
  console.log(`Hook một dòng: ${hookCount}/${HOOK_BUDGET}; mục: ${registry.entries.length}; lỗi: ${errors.length}`);
  process.exit(errors.length > 0 ? 1 : 0);
}

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HOOK_BUDGET, checkCoreHooks } from "./check-core-hooks.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const IMPORT = 'import { crewCoreHooks } from "../crew/core-hooks.js";';
const ANCHOR = "    if (await crewCoreHooks.beforeClaim({ run })) return null;";
const GOOD = [
  "export function service() {",
  "  async function claim(",
  "    run: Run,",
  "  ) {",
  ANCHOR,
  "    return run;",
  "  }",
  "}",
  "",
  "function other() {",
  "  return 1;",
  "}",
  IMPORT,
  "",
].join("\n");

function fixture(source) {
  const root = mkdtempSync(path.join(tmpdir(), "crew-core-hooks-"));
  mkdirSync(path.join(root, "src"), { recursive: true });
  writeFileSync(path.join(root, "src/service.ts"), source);
  return root;
}

function hook(overrides = {}) {
  return {
    id: "H1",
    kind: "hook",
    file: "src/service.ts",
    symbol: "service.claim",
    head: "async function claim(",
    anchor: ANCHOR,
    importLine: IMPORT,
    description: "fixture hook",
    upstreamPr: null,
    tests: [],
    ...overrides,
  };
}

const registry = (entries) => ({ schemaVersion: 1, base: "v2026.1001.0", entries });

test("registry thật của fork đạt", () => {
  const real = JSON.parse(readFileSync(path.join(repoRoot, "crew/release/core-hooks.json"), "utf8"));
  const result = checkCoreHooks(repoRoot, real);
  assert.deepEqual(result.errors, []);
  assert.ok(result.hookCount >= 3 && result.hookCount <= HOOK_BUDGET);
});

test("hook đúng vị trí thì không có lỗi", () => {
  const result = checkCoreHooks(fixture(GOOD), registry([hook()]));
  assert.deepEqual(result.errors, []);
  assert.equal(result.hookCount, 1);
});

test("mất anchor thì đỏ", () => {
  const root = fixture(GOOD.replace(`${ANCHOR}\n`, ""));
  const { errors } = checkCoreHooks(root, registry([hook()]));
  assert.match(errors.join("\n"), /H1: anchor xuất hiện 0 lần trong src\/service\.ts, cần 1/);
});

test("có lệnh chen trước hook thì đỏ", () => {
  const root = fixture(GOOD.replace("  ) {\n", "  ) {\n    const started = Date.now();\n"));
  const { errors } = checkCoreHooks(root, registry([hook()]));
  assert.match(errors.join("\n"), /H1: hook không phải lệnh đầu tiên của service\.claim/);
});

test("import không nằm cuối file thì đỏ", () => {
  const root = fixture(`${IMPORT}\n${GOOD.replace(`${IMPORT}\n`, "")}`);
  const { errors } = checkCoreHooks(root, registry([hook()]));
  assert.match(errors.join("\n"), /H1: import .* không nằm cuối file src\/service\.ts/);
});

test("anchor nằm ngoài scope thì đỏ", () => {
  const { errors } = checkCoreHooks(fixture(GOOD), registry([hook({ scope: "function other(" })]));
  assert.match(errors.join("\n"), /H1: anchor nằm ngoài scope "function other\("/);
});

test("vượt ngân sách hook thì đỏ", () => {
  const entries = Array.from({ length: HOOK_BUDGET + 1 }, (_, index) => hook({ id: `H${index + 1}` }));
  const { errors } = checkCoreHooks(fixture(GOOD), registry(entries));
  assert.match(errors.join("\n"), /Ngân sách hook: 6 > 5/);
});

test("vá adapter chưa có PR upstream chỉ cảnh báo", () => {
  const patch = {
    id: "P9",
    kind: "adapter-patch",
    file: "src/service.ts",
    symbol: "service",
    anchor: "    return run;",
    description: "fixture patch",
    upstreamPr: null,
    tests: [],
  };
  const result = checkCoreHooks(fixture(GOOD), registry([patch]));
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, ["P9: chưa có PR upstream"]);
});

test("test được khai báo mà không tồn tại thì đỏ", () => {
  const { errors } = checkCoreHooks(fixture(GOOD), registry([hook({ tests: ["src/missing.test.ts"] })]));
  assert.match(errors.join("\n"), /H1: test src\/missing\.test\.ts không tồn tại/);
});

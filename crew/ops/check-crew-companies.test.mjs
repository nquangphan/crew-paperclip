// Tests for check-crew-companies.sh against a fake api.sh (in-memory companies and plugin config rows).
// Run: node --test crew/ops/check-crew-companies.test.mjs
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const OPS = path.dirname(fileURLToPath(import.meta.url));
const TPS = "5befeb1a-1578-4656-b913-267494592e53";
const E2E = "a7132a14-0000-4000-8000-000000000000";
const OTHER = "0e73c3ec-caeb-4e90-8097-b4730c5fdcae";
const SECRET_MARK = "bi-mat-khong-duoc-in";

// Fake api.sh: GET /companies, GET /plugins/crew.core/config?companyId=<id>. Reads state.json next to it.
const FAKE_API = `#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const s = JSON.parse(fs.readFileSync(path.join(__dirname, "state.json"), "utf8"));
const [method, url] = process.argv.slice(2);
const [p, q] = url.split("?");
if (method !== "GET") { console.error("only GET"); process.exit(1); }
if (p === "/companies") console.log(JSON.stringify(s.companies.map((id) => ({ id }))));
else if (p === "/plugins/crew.core/config") console.log(JSON.stringify(s.pluginConfig[new URLSearchParams(q).get("companyId")] || null));
else { console.error("no route " + p); process.exit(1); }
`;

const dirs = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const row = (...ids) => ({ configJson: { companies: ids.map((companyId) => ({ companyId, webhookSecretRef: { type: "secret_ref", secretId: SECRET_MARK } })) } });

function setup({ policy, pluginConfig, companies }) {
  const root = mkdtempSync(path.join(tmpdir(), "crew-check-companies-"));
  dirs.push(root);
  mkdirSync(path.join(root, "ops"));
  mkdirSync(path.join(root, "crew-policy"));
  cpSync(path.join(OPS, "policy-config.py"), path.join(root, "ops", "policy-config.py"));
  writeFileSync(path.join(root, "api.sh"), FAKE_API, { mode: 0o755 });
  const entries = Object.fromEntries(policy.map((id) => [id, { ownerUserId: SECRET_MARK }]));
  writeFileSync(path.join(root, "crew-policy", "crew-policy.json"), JSON.stringify({ companies: entries }));
  writeFileSync(path.join(root, "state.json"), JSON.stringify({ companies: companies ?? [TPS, E2E, OTHER], pluginConfig }));
  return root;
}

function run(root) {
  return spawnSync("bash", [path.join(OPS, "check-crew-companies.sh")], { encoding: "utf8", env: { ...process.env, CREW_ROOT: root } });
}

test("khớp: policy và plugin cùng TPS + Crew E2E thì exit 0 và in ok 2 company", () => {
  const root = setup({ policy: [TPS, E2E], pluginConfig: { [TPS]: row(TPS), [E2E]: row(E2E) } });
  const r = run(root);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), "ok 2 company");
});

test("policy có mà plugin thiếu thì exit 1, chỉ in id rút gọn", () => {
  const root = setup({ policy: [TPS, E2E], pluginConfig: { [TPS]: row(TPS) } });
  const r = run(root);
  assert.equal(r.status, 1);
  assert.equal(r.stdout.trim(), `lệch: chỉ trong CREW_POLICY_CONFIG: ${E2E.slice(0, 8)}`);
});

test("plugin có mà policy thiếu thì exit 1", () => {
  const root = setup({ policy: [TPS], pluginConfig: { [TPS]: row(TPS), [E2E]: row(E2E) } });
  const r = run(root);
  assert.equal(r.status, 1);
  assert.equal(r.stdout.trim(), `lệch: chỉ trong plugin: ${E2E.slice(0, 8)}`);
});

test("lệch hai phía in cả hai dòng; không rò secret hay id đầy đủ", () => {
  const root = setup({ policy: [TPS, OTHER], pluginConfig: { [TPS]: row(TPS), [E2E]: row(E2E) } });
  const r = run(root);
  assert.equal(r.status, 1);
  assert.deepEqual(r.stdout.trim().split("\n"), [
    `lệch: chỉ trong CREW_POLICY_CONFIG: ${OTHER.slice(0, 8)}`,
    `lệch: chỉ trong plugin: ${E2E.slice(0, 8)}`,
  ]);
  assert.ok(!(r.stdout + r.stderr).includes(SECRET_MARK));
  assert.ok(!(r.stdout + r.stderr).includes(E2E));
});

test("hàng cấu hình của company A liệt kê company B vẫn tính B; trùng id chỉ đếm một lần", () => {
  const root = setup({ policy: [TPS, E2E], pluginConfig: { [TPS]: row(TPS, E2E), [E2E]: row(E2E) } });
  const r = run(root);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), "ok 2 company");
});

test("file policy hỏng thì exit 2 và không nói ok", () => {
  const root = setup({ policy: [TPS], pluginConfig: { [TPS]: row(TPS) } });
  writeFileSync(path.join(root, "crew-policy", "crew-policy.json"), "{");
  const r = run(root);
  assert.equal(r.status, 2);
  assert.ok(!r.stdout.includes("ok"));
});

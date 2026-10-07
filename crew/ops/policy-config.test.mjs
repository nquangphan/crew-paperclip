// Tests for policy-config.py and policy-env.sh (used by deploy.sh and rollback.sh).
// Run: node --test crew/ops/policy-config.test.mjs
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

function tmp() {
  const dir = mkdtempSync(path.join(tmpdir(), "crew-policy-"));
  dirs.push(dir);
  return dir;
}

function py(args, input) {
  return spawnSync("python3", [path.join(OPS, "policy-config.py"), ...args], { encoding: "utf8", input });
}

function fileCheck(content) {
  const file = path.join(tmp(), "crew-policy.json");
  if (content !== null) writeFileSync(file, content);
  return py(["file", file]);
}

test("file hợp lệ có object companies thì đạt", () => {
  assert.equal(fileCheck(JSON.stringify({ companies: {} })).status, 0);
});

test("file thiếu, JSON lỗi hay không có companies thì bị từ chối", () => {
  for (const content of [null, "{", "[]", JSON.stringify({ companies: [] }), JSON.stringify({})]) {
    const r = fileCheck(content);
    assert.equal(r.status, 1, String(content));
    assert.notEqual(r.stderr.trim(), "");
  }
});

test("log khởi động: chỉ đạt khi có dòng enabled và không có cảnh báo gate tắt", () => {
  const enabled = '{"level":30,"msg":"crew policy config enabled","file":"/crew-policy/crew-policy.json"}\n';
  const off = '{"level":40,"msg":"CREW_POLICY_CONFIG chưa đặt: gate Crew (review, integrator, owner, docs) tắt cho mọi company"}\n';
  assert.equal(py(["startup-log"], enabled).status, 0);
  assert.equal(py(["startup-log"], off).status, 1);
  assert.equal(py(["startup-log"], enabled + off).status, 1);
  assert.equal(py(["startup-log"], "{}\n").status, 1);
});

test("dùng sai cách thì thoát 2", () => {
  assert.equal(py([]).status, 2);
});

test("policy-env.sh ghi override mount thư mục :ro ngoài thư mục dữ liệu và đặt COMPOSE_FILE", () => {
  const root = tmp();
  const script = `ROOT=${root}; . ${path.join(OPS, "policy-env.sh")}; write_policy_override; echo "$COMPOSE_FILE"; echo "$POLICY_FILE"`;
  const r = spawnSync("bash", ["-c", script], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const [composeFile, policyFile] = r.stdout.trim().split("\n");
  assert.equal(composeFile, "docker-compose.yml:docker-compose.crew-policy.yml");
  assert.equal(policyFile, `${root}/crew-policy/crew-policy.json`);
  const override = readFileSync(path.join(root, "docker-compose.crew-policy.yml"), "utf8");
  assert.match(override, /CREW_POLICY_CONFIG: \/crew-policy\/crew-policy\.json/);
  assert.ok(override.includes(`- ${root}/crew-policy:/crew-policy:ro`));
});

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

test("log khởi động: chỉ lỗi khi có cảnh báo gate Crew tắt, không đòi dòng enabled", () => {
  const enabled = '{"level":30,"msg":"crew policy config enabled","file":"/crew-policy/crew-policy.json"}\n';
  const off = '{"level":40,"msg":"CREW_POLICY_CONFIG chưa đặt: gate Crew (review, integrator, owner, docs) tắt cho mọi company"}\n';
  assert.equal(py(["startup-log"], enabled).status, 0);
  assert.equal(py(["startup-log"], "{}\n").status, 0);
  assert.equal(py(["startup-log"], off).status, 1);
  assert.equal(py(["startup-log"], enabled + off).status, 1);
});

test("dùng sai cách thì thoát 2", () => {
  assert.equal(py([]).status, 2);
});

const FILES = "docker-compose.yml:docker-compose.crew-policy.yml";

function composeEnv(envFile) {
  return py(["compose-env", envFile, FILES]);
}

test("compose-env tạo .env khi chưa có", () => {
  const env = path.join(tmp(), ".env");
  assert.equal(composeEnv(env).status, 0);
  assert.equal(readFileSync(env, "utf8"), `COMPOSE_FILE=${FILES}\n`);
});

test("compose-env giữ nguyên các dòng khác và không in nội dung", () => {
  const env = path.join(tmp(), ".env");
  const original = "# ghi chú\nSESSION_SECRET=bi-mat-khong-duoc-in\nPORT=3100";
  writeFileSync(env, original);
  const r = composeEnv(env);
  assert.equal(r.status, 0);
  assert.equal(r.stdout + r.stderr, "");
  assert.equal(readFileSync(env, "utf8"), `${original}\nCOMPOSE_FILE=${FILES}\n`);
});

test("compose-env idempotent: chạy lại không đổi, dòng COMPOSE_FILE cũ được thay và không nhân đôi", () => {
  const env = path.join(tmp(), ".env");
  writeFileSync(env, "A=1\nCOMPOSE_FILE=docker-compose.yml\nB=2\nCOMPOSE_FILE=other.yml\n");
  assert.equal(composeEnv(env).status, 0);
  const once = readFileSync(env, "utf8");
  assert.equal(once, `A=1\nCOMPOSE_FILE=${FILES}\nB=2\n`);
  assert.equal(composeEnv(env).status, 0);
  assert.equal(readFileSync(env, "utf8"), once);
});

test("policy-env.sh ghi override mount thư mục :ro ngoài thư mục dữ liệu và đặt COMPOSE_FILE", () => {
  const root = tmp();
  const script = `ROOT=${root}; mkdir -p ${root}/ops; cp ${path.join(OPS, "policy-config.py")} ${root}/ops/; . ${path.join(OPS, "policy-env.sh")}; write_policy_override; echo "$COMPOSE_FILE"; echo "$POLICY_FILE"`;
  const r = spawnSync("bash", ["-c", script], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const [composeFile, policyFile] = r.stdout.trim().split("\n");
  assert.equal(composeFile, FILES);
  assert.equal(readFileSync(path.join(root, ".env"), "utf8"), `COMPOSE_FILE=${FILES}\n`);
  assert.equal(policyFile, `${root}/crew-policy/crew-policy.json`);
  const override = readFileSync(path.join(root, "docker-compose.crew-policy.yml"), "utf8");
  assert.match(override, /CREW_POLICY_CONFIG: \/crew-policy\/crew-policy\.json/);
  assert.ok(override.includes(`- ${root}/crew-policy:/crew-policy:ro`));
});

// Tests for plugin-state.py (used by deploy.sh and rollback.sh). Run: node --test crew/ops/plugin-state.test.mjs
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "plugin-state.py");
const START = 1_000_000;
const NOW = START + 30;

function state(health, dashboard) {
  const dir = mkdtempSync(path.join(tmpdir(), "crew-plugin-state-"));
  try {
    const h = path.join(dir, "health.json");
    const d = path.join(dir, "dashboard.json");
    writeFileSync(h, health === null ? "" : JSON.stringify(health));
    writeFileSync(d, dashboard === null ? "" : JSON.stringify(dashboard));
    const r = spawnSync("python3", [SCRIPT, h, d, String(START), String(NOW)], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const ok = { healthy: true, status: "ready" };
const worker = (over = {}) => ({ worker: { status: "running", pid: 42, uptime: 10_000, ...over } });

test("healthy khi health ok và worker mới chạy sau khi container start", () => {
  assert.equal(state(ok, worker()), "healthy");
});

test("status ready cũ nhưng không có worker thì không healthy", () => {
  assert.equal(state(ok, { worker: null }), "worker not running");
  assert.equal(state(ok, worker({ status: "starting" })), "worker not running");
  assert.equal(state(ok, worker({ pid: null })), "worker not running");
});

test("worker khởi động trước container thì bị coi là cũ", () => {
  assert.equal(state(ok, worker({ uptime: 3_600_000 })), "stale worker (started before the container)");
});

test("health không ok trả lại status", () => {
  assert.equal(state({ healthy: false, status: "error" }, worker()), "error");
});

test("không có phản hồi", () => {
  assert.equal(state(null, null), "no answer");
  assert.equal(state(ok, null), "worker not running");
});

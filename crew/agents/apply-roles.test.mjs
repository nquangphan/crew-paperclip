// Chạy apply-roles.sh với api.sh giả trỏ vào server mock theo đúng hợp đồng upstream:
// PUT entry file thiếu baseHash/baseRevisionId -> 422 INSTRUCTION_BASE_REQUIRED, body strict.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";

const run = promisify(execFile);
const SCRIPT = new URL("./apply-roles.sh", import.meta.url).pathname;
const AGENT = "11111111-1111-4111-8111-111111111111";
const PIN = "/Users/a/.crew/workflows/superpowers/6.4.1-abc";
const HASH = "b".repeat(64);
const ALLOWED = new Set(["path", "content", "baseRevisionId", "baseHash", "clearLegacyPromptTemplate"]);

function startMock({ entryHash = HASH, entryError = null } = {}) {
  const calls = [];
  const agent = { id: AGENT, adapterConfig: { command: "/Users/a/.crew/bin/crew-claude-run", extraArgs: [] } };
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const url = new URL(req.url, "http://x");
      const send = (status, body) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      calls.push(`${req.method} ${url.pathname}`);
      if (req.method === "GET" && url.pathname === `/agents/${AGENT}`) return send(200, agent);
      if (url.pathname === `/agents/${AGENT}/instructions-bundle/file`) {
        if (req.method === "GET") return entryError ? send(404, { error: entryError }) : send(200, { contentHash: entryHash, content: "cũ" });
        const body = JSON.parse(raw);
        if (Object.keys(body).some((k) => !ALLOWED.has(k))) return send(400, { error: "Validation error" });
        if (body.baseHash === undefined && body.baseRevisionId === undefined) {
          return send(422, { error: "Read the entry and supply baseRevisionId (null for a new entry)", code: "INSTRUCTION_BASE_REQUIRED" });
        }
        return send(200, { path: body.path, contentHash: "c".repeat(64), sentBaseHash: body.baseHash });
      }
      if (req.method === "PATCH" && url.pathname === `/agents/${AGENT}`) {
        const body = JSON.parse(raw);
        return send(200, { ...agent, adapterConfig: { ...agent.adapterConfig, ...body.adapterConfig } });
      }
      return send(404, { error: "no route" });
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, calls, port: server.address().port })));
}

async function applyRoles(port) {
  const root = mkdtempSync(join(tmpdir(), "apply-roles-test-"));
  const api = join(root, "api.sh");
  writeFileSync(api, `#!/bin/bash\ncurl -sS -X "$1" -H 'content-type: application/json' \${3:+-d "$3"} "http://127.0.0.1:${port}$2"\n`);
  chmodSync(api, 0o755);
  try {
    return await run("bash", [SCRIPT, "agent", AGENT, "executor", PIN], { env: { ...process.env, CREW_SPIKE_ROOT: root } });
  } catch (error) {
    return error;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("đọc file hiện tại, gửi kèm baseHash, upload trước rồi mới PATCH extraArgs", async () => {
  const { server, calls, port } = await startMock();
  const result = await applyRoles(port);
  server.close();
  assert.equal(result.code ?? 0, 0, result.stderr);
  const put = calls.indexOf(`PUT /agents/${AGENT}/instructions-bundle/file`);
  const patch = calls.indexOf(`PATCH /agents/${AGENT}`);
  assert.ok(put >= 0 && patch > put, calls.join(" | "));
});

test("file chưa có thì gửi baseHash null và vẫn qua", async () => {
  const { server, port } = await startMock({ entryError: "Instructions file not found" });
  const result = await applyRoles(port);
  server.close();
  assert.equal(result.code ?? 0, 0, result.stderr);
});

test("không đọc được file hiện tại thì dừng trước khi ghi bất cứ gì", async () => {
  const { server, calls, port } = await startMock({ entryError: "Forbidden" });
  const result = await applyRoles(port);
  server.close();
  assert.notEqual(result.code ?? 0, 0);
  assert.ok(!calls.some((c) => c.startsWith("PUT") || c.startsWith("PATCH")), calls.join(" | "));
});

test("mock đúng hợp đồng: PUT thiếu base bị 422", async () => {
  const { server, port } = await startMock();
  const res = await fetch(`http://127.0.0.1:${port}/agents/${AGENT}/instructions-bundle/file`, { method: "PUT", body: JSON.stringify({ path: "AGENTS.md", content: "x" }) });
  server.close();
  assert.equal(res.status, 422);
  assert.equal((await res.json()).code, "INSTRUCTION_BASE_REQUIRED");
});

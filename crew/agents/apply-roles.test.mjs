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

const CODEX_ENV = { CODEX_HOME: { type: "plain", value: "/opt/crew-v3-spike/codex-homes/x" } };

function startMock({ entryHash = HASH, entryError = null, agentType, agentConfig, others = {} } = {}) {
  const calls = [];
  const puts = [];
  const wrapper = { codex_local: "crew-codex-run", opencode_local: "crew-opencode-run" }[agentType] ?? "crew-claude-run";
  const agent = {
    id: AGENT,
    ...(agentType ? { adapterType: agentType } : {}),
    adapterConfig: { command: `/Users/a/.crew/bin/${wrapper}`, extraArgs: [], ...agentConfig },
  };
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
      const other = /^\/agents\/([^/]+)$/.exec(url.pathname);
      if (req.method === "GET" && other && others[other[1]]) return send(200, { id: other[1], adapterType: others[other[1]] });
      if (url.pathname === `/agents/${AGENT}/instructions-bundle/file`) {
        if (req.method === "GET") return entryError ? send(404, { error: entryError }) : send(200, { contentHash: entryHash, content: "cũ" });
        const body = JSON.parse(raw);
        puts.push(body);
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
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, calls, puts, port: server.address().port })));
}

const BMAD_PIN = "/Users/a/.crew/workflows/bmad/6.13.0-next-d009608292d8";
const E1 = "22222222-2222-4222-8222-222222222222";
const B1 = "44444444-4444-4444-8444-444444444444";

async function applyRoles(port, args = ["executor", PIN], capture = null) {
  const root = mkdtempSync(join(tmpdir(), "apply-roles-test-"));
  const api = join(root, "api.sh");
  writeFileSync(api, `#!/bin/bash\ncurl -sS -X "$1" -H 'content-type: application/json' \${3:+-d "$3"} "http://127.0.0.1:${port}$2"\n`);
  chmodSync(api, 0o755);
  try {
    return await run("bash", [SCRIPT, "agent", AGENT, ...args], { env: { ...process.env, CREW_SPIKE_ROOT: root } });
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

test("vai bmad nhận pin BMAD và upload bmad.md", async () => {
  const { server, puts, port } = await startMock();
  const result = await applyRoles(port, ["bmad", BMAD_PIN]);
  server.close();
  assert.equal(result.code ?? 0, 0, result.stderr);
  assert.match(puts[0].content, /^# Agent BMAD \(Crew\)/);
  assert.match(result.stdout, /role=bmad/);
});

test("pin sai loại thì thoát 2 và không ghi gì", async () => {
  for (const [args, message] of [
    [["bmad", PIN], /role bmad needs the pinned BMAD dir/],
    [["executor", BMAD_PIN], /role executor needs the pinned Superpowers dir/],
  ]) {
    const { server, calls, port } = await startMock();
    const result = await applyRoles(port, args);
    server.close();
    assert.equal(result.code, 2);
    assert.match(result.stderr, message);
    assert.equal(calls.length, 0);
  }
});

test("assistant nhận danh sách BMAD ở đối số thứ năm", async () => {
  const { server, puts, port } = await startMock({ others: { [E1]: "claude_local" } });
  const result = await applyRoles(port, ["assistant", PIN, E1, B1]);
  server.close();
  assert.equal(result.code ?? 0, 0, result.stderr);
  assert.match(puts[0].content, new RegExp(`## Agent BMAD của company\\n\\n- \`${B1}\`\\n\\n## Reviewer Codex`));
});

test("vai bmad (hay vai khác) nhận danh sách thì thoát 2", async () => {
  const { server, calls, port } = await startMock();
  const result = await applyRoles(port, ["bmad", BMAD_PIN, B1]);
  server.close();
  assert.equal(result.code, 2);
  assert.equal(calls.length, 0);
});

const E2 = "33333333-3333-4333-8333-333333333333";
const R1 = "66666666-6666-4666-8666-666666666666";

test("executor-codex: gửi executor.md, không thêm --plugin-dir, đo đúng adapterType", async () => {
  const { server, puts, port } = await startMock({ agentType: "codex_local", agentConfig: { env: CODEX_ENV } });
  const result = await applyRoles(port, ["executor-codex", PIN]);
  server.close();
  assert.equal(result.code ?? 0, 0, result.stderr);
  assert.match(puts[0].content, /Codex \(`codex_local`\)/);
  assert.match(result.stdout, /role=executor-codex extraArgs=\[\]/);
});

test("executor-opencode: nhận agent opencode_local, bỏ qua CODEX_HOME", async () => {
  const { server, puts, port } = await startMock({ agentType: "opencode_local" });
  const result = await applyRoles(port, ["executor-opencode", PIN]);
  server.close();
  assert.equal(result.code ?? 0, 0, result.stderr);
  assert.match(puts[0].content, /^# Executor/m);
});

test("reviewer-codex: gửi reviewer.md có mục Codex", async () => {
  const { server, puts, port } = await startMock({ agentType: "codex_local", agentConfig: { env: CODEX_ENV } });
  const result = await applyRoles(port, ["reviewer-codex", PIN]);
  server.close();
  assert.equal(result.code ?? 0, 0, result.stderr);
  assert.match(puts[0].content, /^# Reviewer/m);
  assert.match(puts[0].content, /Codex/);
});

test("ô runtime sai adapterType hoặc thiếu CODEX_HOME thì dừng trước khi ghi", async () => {
  for (const [opts, role] of [
    [{ agentType: "claude_local" }, "executor-codex"],
    [{ agentType: "codex_local", agentConfig: { env: CODEX_ENV } }, "executor"],
    [{ agentType: "codex_local", agentConfig: { env: {} } }, "reviewer-codex"],
    [{ agentType: "codex_local", agentConfig: { env: { ...CODEX_ENV, OPENAI_API_KEY: "sk-x" } } }, "executor-codex"],
  ]) {
    const { server, calls, port } = await startMock(opts);
    const result = await applyRoles(port, [role, PIN]);
    server.close();
    assert.equal(result.code, 2, role);
    assert.ok(!calls.some((c) => c.startsWith("PUT") || c.startsWith("PATCH")), `${role}: ${calls.join(" | ")}`);
  }
});

test("assistant: runtime executor lấy từ adapterType, reviewer Codex vào instructions", async () => {
  const { server, puts, port } = await startMock({ others: { [E1]: "claude_local", [E2]: "codex_local", [R1]: "codex_local" } });
  const result = await applyRoles(port, ["assistant", PIN, `${E1},${E2}`, "", R1]);
  server.close();
  assert.equal(result.code ?? 0, 0, result.stderr);
  assert.match(puts[0].content, new RegExp(`- \`${E1}\` — runtime \`claude_local\`\n- \`${E2}\` — runtime \`codex_local\``));
  assert.match(puts[0].content, new RegExp(`## Reviewer Codex của company\\n\\n- \`${R1}\` — runtime \`codex_local\`\\n$`));
  assert.match(result.stdout, new RegExp(`reviewer-codex=${R1}`));
});

test("assistant: không đọc được runtime executor hoặc reviewer Codex không phải codex_local thì không ghi", async () => {
  for (const [others, args] of [
    [{}, [`${E1}`]],
    [{ [E1]: "claude_local", [R1]: "claude_local" }, [`${E1}`, "", R1]],
  ]) {
    const { server, calls, port } = await startMock({ others });
    const result = await applyRoles(port, ["assistant", PIN, ...args]);
    server.close();
    assert.equal(result.code, 2);
    assert.ok(!calls.some((c) => c.startsWith("PUT") || c.startsWith("PATCH")), calls.join(" | "));
  }
});

test("assistant nhận executor kèm :runtime mà không gọi API đọc agent đó", async () => {
  const { server, puts, port } = await startMock();
  const result = await applyRoles(port, ["assistant", PIN, `${E1}:opencode_local`]);
  server.close();
  assert.equal(result.code ?? 0, 0, result.stderr);
  assert.match(puts[0].content, new RegExp(`- \`${E1}\` — runtime \`opencode_local\``));
});

test("vai khác assistant không nhận reviewer Codex", async () => {
  const { server, calls, port } = await startMock();
  const result = await applyRoles(port, ["executor", PIN, "", "", R1]);
  server.close();
  assert.equal(result.code, 2);
  assert.equal(calls.length, 0);
});

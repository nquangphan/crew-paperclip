// Tests for agent-permissions.sh. Run: node --test crew/ops/agent-permissions.test.mjs
// api.sh giả (Node) đọc/ghi trạng thái trong file JSON tạm và ghi lại mọi lời gọi (argv + stdin).
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const OPS = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(OPS, "agent-permissions.sh");
const COMPANY = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const PROJECT = "33333333-3333-4333-8333-333333333333";
const OWNER = "owner-user-1";
const A = {
  assistant: "aaaaaaaa-0000-4000-8000-000000000001",
  executor: "aaaaaaaa-0000-4000-8000-000000000002",
  reviewer: "aaaaaaaa-0000-4000-8000-000000000003",
  gone: "aaaaaaaa-0000-4000-8000-000000000004",
};
const SKILL_ACTIONS = [
  "skills.create", "skills.import", "skills.install", "skills.edit",
  "skills.update", "skills.test", "skills.reset", "skills.remove",
];

const FAKE_API = `#!/usr/bin/env node
const fs = require("node:fs");
const [method, route, data] = process.argv.slice(2);
const stdin = data === "@-" ? fs.readFileSync(0, "utf8") : "";
const statePath = process.env.FAKE_STATE;
const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ argv: process.argv.slice(2), stdin }) + "\\n");
const url = new URL(route, "http://x");
const p = url.pathname;
let m;
const out = (v) => { process.stdout.write(JSON.stringify(v) + "\\n"); };
const save = () => fs.writeFileSync(statePath, JSON.stringify(state));
if (method === "GET" && (m = /^\\/companies\\/([^/]+)\\/agents$/.exec(p))) {
  out(state.agents.filter((a) => a.companyId === m[1]).map(({ grants, ...a }) => a));
} else if (method === "GET" && (m = /^\\/agents\\/([^/]+)$/.exec(p))) {
  const a = state.agents.find((x) => x.id === m[1]);
  if (!a) return out({ error: "Agent not found" });
  const { grants, ...rest } = a;
  const explicit = grants.includes("tasks:assign");
  out({ ...rest, access: { canAssignTasks: explicit, taskAssignSource: a.role === "ceo" ? "ceo_role" : a.permissions?.canCreateAgents ? "agent_creator" : explicit ? "explicit_grant" : "none",
    grants: grants.map((permissionKey) => ({ permissionKey })) } });
} else if (method === "PATCH" && (m = /^\\/agents\\/([^/]+)\\/permissions$/.exec(p))) {
  const a = state.agents.find((x) => x.id === m[1]);
  const body = JSON.parse(stdin);
  a.permissions = { ...a.permissions, ...body };
  const assign = a.role === "ceo" || a.permissions.canCreateAgents || body.canAssignTasks;
  a.grants = a.grants.filter((g) => g !== "tasks:assign").concat(assign ? ["tasks:assign"] : []);
  save(); out({ id: a.id });
} else if (method === "GET" && (m = /^\\/companies\\/([^/]+)\\/projects$/.exec(p))) {
  out(state.projects.filter((x) => x.companyId === m[1]));
} else if (method === "GET" && (m = /^\\/plugins\\/crew\\.core\\/api\\/projects\\/([^/]+)\\/roles$/.exec(p))) {
  out({ roles: state.roles[m[1]] ?? null });
} else if (method === "GET" && (m = /^\\/companies\\/([^/]+)\\/skill-policy$/.exec(p))) {
  out(state.skillPolicy[m[1]]);
} else if (method === "PUT" && (m = /^\\/companies\\/([^/]+)\\/skill-policy$/.exec(p))) {
  const { expectedRevision, ...doc } = JSON.parse(stdin);
  const cur = state.skillPolicy[m[1]];
  if (expectedRevision !== cur.revision) return out({ error: "revision conflict" });
  state.skillPolicy[m[1]] = { ...doc, revision: cur.revision + 1, materialized: true };
  save(); out(state.skillPolicy[m[1]]);
} else if (method === "GET" && (m = /^\\/companies\\/([^/]+)\\/users\\/([^/]+)\\/inbox-agent-policy$/.exec(p))) {
  out(state.inbox[m[1] + "/" + m[2]] ?? { mode: "open", allowedAgentIds: [] });
} else if (method === "PUT" && (m = /^\\/companies\\/([^/]+)\\/users\\/([^/]+)\\/inbox-agent-policy$/.exec(p))) {
  state.inbox[m[1] + "/" + m[2]] = JSON.parse(stdin);
  save(); out(state.inbox[m[1] + "/" + m[2]]);
} else if (method === "GET" && (m = /^\\/companies\\/([^/]+)\\/pipelines$/.exec(p))) {
  out(state.pipelines ?? []);
} else if (method === "GET" && (m = /^\\/companies\\/([^/]+)\\/tools\\/connections$/.exec(p))) {
  out({ connections: state.connections ?? [] });
} else {
  out({ error: "unexpected " + method + " " + p });
}
`;

const dirs = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function agent(id, name, over = {}) {
  return {
    id, companyId: COMPANY, name, role: "engineer", status: "idle", adapterType: "claude_local",
    permissions: { canCreateAgents: false, canCreateSkills: true }, grants: [], ...over,
  };
}

function setup(over = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "crew-agent-perms-"));
  dirs.push(dir);
  const api = path.join(dir, "api.sh");
  writeFileSync(api, FAKE_API);
  chmodSync(api, 0o755);
  const policy = path.join(dir, "crew-policy.json");
  writeFileSync(policy, JSON.stringify({
    companies: { [COMPANY]: { reviewerAgentId: A.reviewer, integratorAgentId: A.gone, ownerUserId: OWNER } },
  }));
  const state = {
    agents: [
      agent(A.assistant, "Trợ Lý", { permissions: { canCreateAgents: true } }),
      agent(A.executor, "Thực thi", { permissions: { canCreateAgents: false, canCreateSkills: false, trustPreset: "standard" } }),
      agent(A.reviewer, "Duyệt", { adapterType: "process" }),
      agent(A.gone, "Cũ", { status: "terminated", permissions: { canCreateAgents: true } }),
      { ...agent("bbbbbbbb-0000-4000-8000-000000000001", "Company khác"), companyId: OTHER },
    ],
    projects: [{ id: PROJECT, companyId: COMPANY, name: "Dự án" }],
    roles: { [PROJECT]: { assistantAgentId: A.assistant, executorAgentIds: [A.executor], reviewerAgentId: A.reviewer, integratorAgentId: A.gone } },
    skillPolicy: { [COMPANY]: { schemaVersion: 1, revision: 0, defaultEffect: "allow", rules: [], materialized: false } },
    inbox: {},
    ...over,
  };
  const statePath = path.join(dir, "state.json");
  writeFileSync(statePath, JSON.stringify(state));
  const log = path.join(dir, "calls.jsonl");
  writeFileSync(log, "");
  return { dir, api, policy, statePath, log };
}

function run(env, args) {
  writeFileSync(env.log, "");
  const r = spawnSync("bash", [SCRIPT, ...args], {
    encoding: "utf8",
    env: { ...process.env, CREW_API_SH: env.api, CREW_POLICY_FILE: env.policy, FAKE_STATE: env.statePath, FAKE_LOG: env.log },
  });
  const calls = readFileSync(env.log, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
  return { ...r, calls, writes: calls.filter((c) => c.argv[0] !== "GET") };
}

const state = (env) => JSON.parse(readFileSync(env.statePath, "utf8"));

test("áp quyền: tắt tạo agent/skill cho mọi agent còn sống, chỉ Trợ Lý giữ grant tasks:assign", () => {
  const env = setup();
  const r = run(env, ["--all-crew"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const perms = r.writes.filter((c) => c.argv[0] === "PATCH");
  // Executor đã đúng (tắt cả hai, không grant) nên không bị gọi ghi.
  assert.deepEqual(perms.map((c) => c.argv[1]).sort(), [
    `/agents/${A.assistant}/permissions`, `/agents/${A.reviewer}/permissions`,
  ].sort());
  for (const c of perms) {
    const body = JSON.parse(c.stdin);
    assert.equal(body.canCreateAgents, false);
    assert.equal(body.canCreateSkills, false);
    assert.equal(body.canAssignTasks, c.argv[1].includes(A.assistant));
  }
  const s = state(env);
  assert.deepEqual(s.agents.find((a) => a.id === A.assistant).grants, ["tasks:assign"]);
  assert.equal(s.agents.find((a) => a.id === A.executor).permissions.trustPreset, "standard");
  assert.equal(s.agents.find((a) => a.id === A.gone).permissions.canCreateAgents, true, "agent terminated không bị gọi");
  assert.ok(!r.calls.some((c) => c.argv[1].includes("bbbbbbbb")), "không chạm company khác");
});

test("áp skill policy deny cho mọi agent (giữ rule cũ, board vẫn theo defaultEffect) và tắt inbox policy của owner", () => {
  const keep = { id: "board-rule", priority: 5, effect: "allow", subject: { type: "roles", roles: ["board"] }, actions: ["skills.create"] };
  const env = setup({ skillPolicy: { [COMPANY]: { schemaVersion: 1, revision: 3, defaultEffect: "allow", rules: [keep], materialized: true } } });
  const r = run(env, ["--all-crew"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const put = r.writes.find((c) => c.argv[1] === `/companies/${COMPANY}/skill-policy`);
  const body = JSON.parse(put.stdin);
  assert.equal(body.expectedRevision, 3);
  assert.equal(body.defaultEffect, "allow");
  assert.deepEqual(body.rules[0], keep);
  assert.deepEqual(body.rules[1], {
    id: "crew-deny-agent-skill-writes", priority: -1000000, effect: "deny", subject: { type: "all_agents" }, actions: SKILL_ACTIONS,
  });
  const inbox = r.writes.find((c) => c.argv[1] === `/companies/${COMPANY}/users/${OWNER}/inbox-agent-policy`);
  assert.equal(inbox.argv[0], "PUT");
  assert.deepEqual(JSON.parse(inbox.stdin), { mode: "disabled", allowedAgentIds: [] });
});

test("--check (và --dry-run) chỉ đọc, báo cần đổi bằng mã 1", () => {
  for (const flag of ["--check", "--dry-run"]) {
    const env = setup();
    const r = run(env, ["--all-crew", flag]);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.equal(r.writes.length, 0, flag);
    assert.match(r.stdout, /aaaaaaaa Trợ Lý/);
    assert.match(r.stdout, /skill-policy/);
    assert.match(r.stdout, /inbox/);
  }
});

test("chạy lần hai khi đã đúng thì 0 lời gọi ghi, --check trả 0", () => {
  const env = setup();
  assert.equal(run(env, ["--all-crew"]).status, 0);
  const again = run(env, ["--all-crew"]);
  assert.equal(again.status, 0, again.stdout + again.stderr);
  assert.equal(again.writes.length, 0);
  const check = run(env, ["--all-crew", "--check"]);
  assert.equal(check.status, 0, check.stdout + check.stderr);
});

test("body chỉ đi qua stdin, đối số api.sh không chứa body", () => {
  const env = setup();
  const r = run(env, ["--all-crew"]);
  assert.ok(r.writes.length > 0);
  for (const c of r.writes) {
    assert.equal(c.argv.length, 3, JSON.stringify(c.argv));
    assert.equal(c.argv[2], "@-");
    assert.ok(c.stdin.length > 0);
  }
  for (const c of r.calls.filter((x) => x.argv[0] === "GET")) assert.equal(c.argv.length, 2);
});

test("cảnh báo agent role ceo, pipeline, tool connection và trust preset: mã 1 kể cả sau khi áp", () => {
  const env = setup({ pipelines: [{ id: "p1" }], connections: [{ id: "c1" }] });
  const s = state(env);
  s.agents.find((a) => a.id === A.executor).role = "ceo";
  s.agents.find((a) => a.id === A.reviewer).permissions.trustPreset = "low_trust_review";
  writeFileSync(env.statePath, JSON.stringify(s));
  const r = run(env, ["--all-crew"]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /role ceo/);
  assert.match(r.stdout, /pipeline: 1/);
  assert.match(r.stdout, /tool connection: 1/);
  assert.match(r.stdout, /low_trust_review/);
});

test("--assistant giữ grant tasks:assign cho Trợ Lý của project chưa có dòng vai trò", () => {
  const env = setup({ roles: {} });
  const r = run(env, ["--all-crew", "--assistant", A.executor.toUpperCase()]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const s = state(env);
  assert.deepEqual(s.agents.find((a) => a.id === A.executor).grants, ["tasks:assign"]);
  assert.deepEqual(s.agents.find((a) => a.id === A.assistant).grants, []);
  assert.equal(run(env, ["--all-crew", "--assistant", "x"]).status, 2);
});

test("company chỉ định bằng uuid phải có trong cấu hình Crew", () => {
  const env = setup();
  const r = run(env, [OTHER]);
  assert.equal(r.status, 2);
  assert.equal(r.calls.length, 0);
  const ok = run(env, [COMPANY, "--check"]);
  assert.equal(ok.status, 1);
});

test("API trả lỗi thì dừng với mã 2, không in token", () => {
  const env = setup({ projects: undefined });
  const s = state(env);
  delete s.projects;
  writeFileSync(env.statePath, JSON.stringify(s));
  const r = run(env, ["--all-crew", "--check"]);
  assert.equal(r.status, 2, r.stdout + r.stderr);
});

test("không đối số thì in cách dùng, mã 2", () => {
  const env = setup();
  const r = run(env, []);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Usage/);
});

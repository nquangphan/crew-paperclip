// Tests for e2e-company.sh against a fake api.sh that keeps a small in-memory Paperclip in a JSON file.
// Run: node --test crew/ops/e2e-company.test.mjs
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "e2e-company.sh");
const TPS = "5befeb1a-1578-4656-b913-267494592e53";
const OWNER = "Mtye1JcS4JUc3lTZj51hI7nfz1pqMPSI";
const TPS_SECRET = "fa7b4847-3a92-4651-86e2-bb0d11e69f65";
const TPS_WEBHOOK = "9df35ec4-ad6e-4c65-878f-352b089dd48d";
// Built at run time so the repository never holds a string that looks like a private key header.
const KEY = `${["-----BEGIN", "OPENSSH", "PRIVATE", "KEY-----"].join(" ")}\nZmFrZS1rZXktZm9yLXRlc3Qtb25seQ==\n${["-----END", "OPENSSH", "PRIVATE", "KEY-----"].join(" ")}\n`;
const KEY_MARK = "ZmFrZS1rZXktZm9yLXRlc3Qtb25seQ==";

// Fake api.sh: METHOD PATH [@-]. Logs {argv, stdin} to calls.jsonl, answers from state.json.
const FAKE_API = `#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const dir = __dirname;
const [method, url, data] = process.argv.slice(2);
const stdin = data === "@-" ? fs.readFileSync(0, "utf8") : "";
fs.appendFileSync(path.join(dir, "calls.jsonl"), JSON.stringify({ argv: process.argv.slice(2), stdin }) + "\\n");
const statePath = path.join(dir, "state.json");
const s = JSON.parse(fs.readFileSync(statePath, "utf8"));
const body = stdin ? JSON.parse(stdin.replace(/[\\r\\n]/g, "")) : null;
const [p, q] = url.split("?");
const query = new URLSearchParams(q || "");
const out = (value) => { fs.writeFileSync(statePath, JSON.stringify(s)); process.stdout.write(JSON.stringify(value) + "\\n"); };
let m;
if (s.failCreateCompany && method === "POST" && p === "/companies") out({ error: "boom" });
else if (method === "GET" && p === "/companies") out(s.companies);
else if (method === "POST" && p === "/companies") {
  const c = { id: randomUUID(), name: body.name, issuePrefix: "CRE2", status: "active" };
  s.companies.push(c); out(c);
} else if (method === "GET" && (m = /^\\/companies\\/([^/]+)$/.exec(p))) out(s.companies.find((c) => c.id === m[1]) || { error: "nf" });
else if ((m = /^\\/companies\\/([^/]+)\\/(secrets|labels|agents)$/.exec(p))) {
  const list = (s[m[2]][m[1]] ||= []);
  if (method === "GET") out(list.map(({ value, ...rest }) => rest));
  else { const item = { id: randomUUID(), status: "active", ...body }; list.push(item); const { value, ...shown } = item; out(shown); }
} else if ((m = /^\\/companies\\/([^/]+)\\/environments$/.exec(p))) {
  if (method === "GET") out(s.environments);
  else { const e = { id: randomUUID(), status: "active", ...body }; s.environments.push(e); out(e); }
} else if (method === "POST" && (m = /^\\/environments\\/([^/]+)\\/probe$/.exec(p))) out({ ok: true, summary: "ssh ok" });
else if (method === "GET" && (m = /^\\/agents\\/([^/]+)$/.exec(p))) {
  const a = Object.values(s.agents).flat().find((x) => x.id === m[1]); out(a || { error: "nf" });
} else if (method === "POST" && (m = /^\\/secrets\\/([^/]+)\\/rotate$/.exec(p))) {
  const sec = Object.values(s.secrets).flat().find((x) => x.id === m[1]); sec.value = body.value; out({ id: sec.id });
} else if (p === "/plugins/crew.core/config") {
  if (method === "GET") out(s.pluginConfig[query.get("companyId")] || null);
  else { const row = { id: randomUUID(), companyId: body.companyId, configJson: body.configJson }; s.pluginConfig[body.companyId] = row; out(row); }
} else out({ error: "no route " + method + " " + p });
`;

function setup() {
  const root = mkdtempSync(path.join(tmpdir(), "crew-e2e-company-"));
  mkdirSync(path.join(root, "ssh"));
  mkdirSync(path.join(root, "crew-policy"));
  writeFileSync(path.join(root, "ssh", "paperclip_ed25519"), KEY, { mode: 0o600 });
  writeFileSync(path.join(root, "crew-policy", "crew-policy.json"), JSON.stringify({
    companies: { [TPS]: {
      reviewerAgentId: "946f1a73-4ee0-447e-97b0-58e50bd70000",
      integratorAgentId: "b7cd2d89-9e3c-4164-ac81-9e0b042a15d1",
      ownerUserId: OWNER,
      trackingProjectIds: ["c597c718-d38c-4bec-96b4-585fb20fde99"],
    } },
  }, null, 2));
  chmodSync(path.join(root, "crew-policy", "crew-policy.json"), 0o644);
  writeFileSync(path.join(root, "api.sh"), FAKE_API, { mode: 0o755 });
  writeFileSync(path.join(root, "state.json"), JSON.stringify({
    companies: [
      { id: "0e73c3ec-caeb-4e90-8097-b4730c5fdcae", name: "Crew Spike Policy", issuePrefix: "CREA", status: "active" },
      { id: TPS, name: "2P Solutions", issuePrefix: "TPS", status: "active" },
    ],
    secrets: { [TPS]: [{ id: TPS_SECRET, name: "environment-ssh-mac-mini-private-key" }] },
    labels: { [TPS]: [{ id: "f7efd416-0000-4000-8000-000000000000", name: "research", color: "#6b7280" }] },
    agents: {},
    environments: [
      { id: "00ca623e-0000-4000-8000-000000000000", name: "mac-mini-policy", driver: "ssh", status: "archived",
        config: { host: "10.0.0.9", port: 22, username: "old" }, metadata: { workspaceRealizationMode: "in_place" } },
      { id: "f92f5dd8-fd34-47df-95a8-6adb87e49ec8", name: "mac-mini", driver: "ssh", status: "active",
        config: { host: "100.102.189.67", port: 2222, username: "phannhatquang", knownHosts: "[100.102.189.67]:2222 ssh-ed25519 AAAA",
          strictHostKeyChecking: true, privateKey: null, remoteWorkspacePath: "/Users/phannhatquang/crew-agents/mac-claude",
          privateKeySecretRef: { type: "secret_ref", secretId: TPS_SECRET, version: "latest" } },
        metadata: { workspaceRealizationMode: "in_place", crewLoadGate: { maxLoad1: 8, maxWaitMinutes: 60 } } },
    ],
    pluginConfig: { [TPS]: { id: "f143e0bb-0000-4000-8000-000000000000", companyId: TPS,
      configJson: { companies: [{ companyId: TPS, webhookSecretRef: { type: "secret_ref", secretId: TPS_WEBHOOK } }] } } },
  }));
  return root;
}

function run(root, mode = "prod", env = {}) {
  return spawnSync("bash", [SCRIPT, mode], { encoding: "utf8", env: { ...process.env, CREW_ROOT: root, ...env } });
}

const calls = (root) => readFileSync(path.join(root, "calls.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const state = (root) => JSON.parse(readFileSync(path.join(root, "state.json"), "utf8"));
const policy = (root) => JSON.parse(readFileSync(path.join(root, "crew-policy", "crew-policy.json"), "utf8"));
const writes = (list) => list.filter((c) => c.argv[0] !== "GET");
const isCreate = (c) => c.argv[0] === "POST" && !/\/probe$/.test(c.argv[1]);

test("lần đầu tạo đủ theo thứ tự: tìm company → company → secret → environment → label → agent → policy → plugin", () => {
  const root = setup();
  try {
    const r = run(root);
    assert.equal(r.status, 0, r.stderr);
    const list = calls(root);
    assert.deepEqual(list[0].argv, ["GET", "/companies"]);
    const st = state(root);
    const e2e = st.companies.find((c) => c.name === "Crew E2E");
    assert.ok(e2e);
    const created = writes(list).filter(isCreate).map((c) => {
      const b = JSON.parse(c.stdin);
      return `${c.argv[1].replace(e2e.id, "E2E")} ${b.name ?? ""}`.trim();
    });
    assert.deepEqual(created, [
      "/companies Crew E2E",
      "/companies/E2E/secrets crew-e2e-ssh",
      "/companies/E2E/secrets crew-e2e-status",
      "/companies/E2E/environments crew-e2e-template",
      "/companies/E2E/labels research",
      "/companies/E2E/agents crew-e2e-reviewer",
      "/companies/E2E/agents crew-e2e-integrator",
      "/plugins/crew.core/config",
    ]);
    // Every body goes on stdin, never as an argument.
    for (const c of writes(list)) assert.ok(c.argv.length <= 3 && (c.argv.length === 2 || c.argv[2] === "@-"), JSON.stringify(c.argv));
    assert.match(r.stdout, /company created [0-9a-f]{8}\n/);
    assert.match(r.stdout, /company prefix CRE2/);
    assert.match(r.stdout, /e2e ok company [0-9a-f]{8} prefix CRE2/);
    assert.doesNotMatch(r.stdout, new RegExp(e2e.id));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("private key chỉ nằm trong stdin của lời gọi tạo secret SSH, không trong đối số hay output", () => {
  const root = setup();
  try {
    const r = run(root);
    assert.equal(r.status, 0, r.stderr);
    const list = calls(root);
    const withKey = list.filter((c) => c.stdin.includes(KEY_MARK));
    assert.equal(withKey.length, 1);
    assert.match(withKey[0].argv[1], /\/secrets$/);
    assert.equal(JSON.parse(withKey[0].stdin).name, "crew-e2e-ssh");
    assert.equal(JSON.parse(withKey[0].stdin).value, KEY, "key kept byte for byte, trailing newline included");
    for (const c of list) assert.ok(!c.argv.join(" ").includes(KEY_MARK));
    assert.ok(!r.stdout.includes(KEY_MARK) && !r.stderr.includes(KEY_MARK));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("secret webhook: giá trị ở file 600 trong thư mục 700, gửi qua stdin, không in ra", () => {
  const root = setup();
  try {
    const r = run(root);
    assert.equal(r.status, 0, r.stderr);
    const file = path.join(root, "crew-e2e", "status-webhook-secret");
    const value = readFileSync(file, "utf8").trim();
    assert.match(value, /^[0-9a-f]{64}$/);
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(statSync(path.join(root, "crew-e2e")).mode & 0o777, 0o700);
    const call = calls(root).find((c) => c.stdin.includes(value));
    assert.equal(JSON.parse(call.stdin).name, "crew-e2e-status");
    assert.ok(!r.stdout.includes(value) && !r.stderr.includes(value));
    for (const c of calls(root)) assert.ok(!c.argv.join(" ").includes(value));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("environment chép host/port/user/knownHosts của environment mẫu TPS và trỏ secret SSH mới", () => {
  const root = setup();
  try {
    assert.equal(run(root).status, 0);
    const st = state(root);
    const e2e = st.companies.find((c) => c.name === "Crew E2E");
    const ssh = st.secrets[e2e.id].find((x) => x.name === "crew-e2e-ssh");
    const env = st.environments.find((e) => e.name === "crew-e2e-template");
    assert.equal(env.driver, "ssh");
    assert.deepEqual(env.metadata, { workspaceRealizationMode: "in_place", crewLoadGate: { maxLoad1: 8, maxWaitMinutes: 60 } });
    assert.equal(env.config.host, "100.102.189.67");
    assert.equal(env.config.port, 2222);
    assert.equal(env.config.username, "phannhatquang");
    assert.equal(env.config.knownHosts, "[100.102.189.67]:2222 ssh-ed25519 AAAA");
    assert.equal(env.config.strictHostKeyChecking, true);
    assert.equal(env.config.remoteWorkspacePath, "/Users/phannhatquang/crew-e2e/repo");
    assert.deepEqual(env.config.privateKeySecretRef, { type: "secret_ref", secretId: ssh.id, version: "latest" });
    assert.ok(!("privateKey" in env.config));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("agent giữ chỗ không chạy run; policy thêm company, giữ nguyên TPS, có bản sao lưu, giữ quyền đọc 644", () => {
  const root = setup();
  try {
    const r = run(root);
    assert.equal(r.status, 0, r.stderr);
    const st = state(root);
    const e2e = st.companies.find((c) => c.name === "Crew E2E");
    const agents = st.agents[e2e.id];
    assert.deepEqual(agents.map((a) => a.name), ["crew-e2e-reviewer", "crew-e2e-integrator"]);
    for (const a of agents) {
      assert.equal(a.adapterType, "process");
      assert.deepEqual(a.runtimeConfig, { heartbeat: { enabled: false, wakeOnDemand: false } });
    }
    const p = policy(root);
    assert.deepEqual(p.companies[TPS].trackingProjectIds, ["c597c718-d38c-4bec-96b4-585fb20fde99"]);
    assert.equal(p.companies[TPS].reviewerAgentId, "946f1a73-4ee0-447e-97b0-58e50bd70000");
    assert.deepEqual(p.companies[e2e.id], {
      reviewerAgentId: agents[0].id, integratorAgentId: agents[1].id, ownerUserId: OWNER, trackingProjectIds: [],
    });
    const file = path.join(root, "crew-policy", "crew-policy.json");
    assert.equal(statSync(file).mode & 0o777, 0o644);
    const backups = readdirSync(path.join(root, "crew-policy")).filter((f) => f.startsWith("crew-policy.json.bak-e2e-"));
    assert.equal(backups.length, 1);
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(path.join(root, "crew-policy", backups[0]), "utf8")).companies), [TPS]);
    assert.match(r.stdout, /policy updated \(backup .*bak-e2e-/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("plugin config: thêm dòng của Crew E2E, dòng TPS không đổi", () => {
  const root = setup();
  try {
    const before = state(root).pluginConfig[TPS];
    assert.equal(run(root).status, 0);
    const st = state(root);
    const e2e = st.companies.find((c) => c.name === "Crew E2E");
    const status = st.secrets[e2e.id].find((x) => x.name === "crew-e2e-status");
    assert.deepEqual(st.pluginConfig[TPS], before);
    assert.deepEqual(st.pluginConfig[e2e.id].configJson, {
      companies: [{ companyId: e2e.id, webhookSecretRef: { type: "secret_ref", secretId: status.id, version: "latest" } }],
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("lần hai: 0 lời gọi tạo, policy không ghi lại, output báo present", () => {
  const root = setup();
  try {
    assert.equal(run(root).status, 0);
    const first = calls(root).length;
    const policyText = readFileSync(path.join(root, "crew-policy", "crew-policy.json"), "utf8");
    const r = run(root);
    assert.equal(r.status, 0, r.stderr);
    const second = calls(root).slice(first);
    assert.deepEqual(second.filter(isCreate), []);
    assert.equal(readFileSync(path.join(root, "crew-policy", "crew-policy.json"), "utf8"), policyText);
    assert.equal(readdirSync(path.join(root, "crew-policy")).filter((f) => f.includes("bak-e2e")).length, 1);
    for (const word of ["company present", "secret crew-e2e-ssh present", "secret crew-e2e-status present",
      "environment present", "label research present", "agent crew-e2e-reviewer present", "policy present", "plugin config present"]) {
      assert.ok(r.stdout.includes(word), word);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("mất file secret webhook thì rotate secret trên server sang giá trị mới, không tạo secret thứ hai", () => {
  const root = setup();
  try {
    assert.equal(run(root).status, 0);
    rmSync(path.join(root, "crew-e2e", "status-webhook-secret"));
    const first = calls(root).length;
    const r = run(root);
    assert.equal(r.status, 0, r.stderr);
    const creates = calls(root).slice(first).filter(isCreate);
    assert.equal(creates.length, 1);
    assert.match(creates[0].argv[1], /^\/secrets\/[0-9a-f-]+\/rotate$/);
    const value = readFileSync(path.join(root, "crew-e2e", "status-webhook-secret"), "utf8").trim();
    assert.equal(JSON.parse(creates[0].stdin).value.trim(), value);
    assert.ok(!r.stdout.includes(value));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("API lỗi khi tạo company: thoát khác 0, không ghi policy, không gọi tiếp", () => {
  const root = setup();
  try {
    const s = state(root);
    s.failCreateCompany = true;
    writeFileSync(path.join(root, "state.json"), JSON.stringify(s));
    const r = run(root);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /create company failed/);
    assert.deepEqual(Object.keys(policy(root).companies), [TPS]);
    assert.equal(writes(calls(root)).length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("thiếu mục TPS hợp lệ trong policy: dừng trước mọi lời gọi ghi", () => {
  const root = setup();
  try {
    writeFileSync(path.join(root, "crew-policy", "crew-policy.json"), JSON.stringify({ companies: {} }));
    const r = run(root);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /no valid TPS entry/);
    assert.deepEqual(policy(root), { companies: {} });
    assert.deepEqual(writes(calls(root)), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// Fake crew-docs bundle: `init` writes the files the real one creates, `check --all` passes when flows.yaml exists.
const FAKE_BUNDLE = `const fs = require("fs");
const [cmd] = process.argv.slice(2);
if (cmd === "init") {
  fs.mkdirSync("docs", { recursive: true });
  for (const f of ["AGENTS.md", "CLAUDE.md", "docs/index.md", "docs/architecture.md", "docs/files.md"]) fs.writeFileSync(f, "# " + f + "\\n");
  fs.writeFileSync("docs/flows.yaml", "version: 1\\nflows: {}\\nshared: {}\\nunassigned: []\\n");
} else if (cmd === "check") process.exit(fs.existsSync("docs/flows.yaml") ? 0 : 3);
`;

test("mac: tạo origin bare và clone có README, docs/flows.yaml, crew-docs.bundle; lần hai không commit thêm", () => {
  const home = mkdtempSync(path.join(tmpdir(), "crew-e2e-mac-"));
  try {
    const bundle = path.join(home, "crew-docs.cjs");
    writeFileSync(bundle, FAKE_BUNDLE);
    const env = {
      CREW_E2E_HOME: path.join(home, "crew-e2e"), CREW_DOCS_BUNDLE: bundle, CREW_DOCS_RUNTIME: process.execPath,
      GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com",
    };
    const r = run(home, "mac", env);
    assert.equal(r.status, 0, r.stderr);
    const repo = path.join(home, "crew-e2e", "repo");
    const git = (...args) => spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" }).stdout.trim();
    assert.ok(existsSync(path.join(home, "crew-e2e", "origin.git", "HEAD")));
    assert.equal(spawnSync("git", ["-C", path.join(home, "crew-e2e", "origin.git"), "rev-parse", "--is-bare-repository"], { encoding: "utf8" }).stdout.trim(), "true");
    assert.ok(existsSync(path.join(repo, "README.md")));
    assert.ok(existsSync(path.join(repo, "docs", "flows.yaml")));
    assert.equal(git("config", "crew-docs.bundle"), bundle);
    assert.equal(git("rev-list", "--count", "HEAD"), "1");
    assert.match(git("log", "-1", "--format=%B"), /Crew-Docs-Init: true/);
    assert.equal(git("ls-remote", "origin", "refs/heads/main").split("\t")[0], git("rev-parse", "HEAD"));
    assert.equal(git("status", "--porcelain"), "");

    const again = run(home, "mac", env);
    assert.equal(again.status, 0, again.stderr);
    assert.equal(git("rev-list", "--count", "HEAD"), "1");
    assert.match(again.stdout, /origin present\nrepo present\norigin main present/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

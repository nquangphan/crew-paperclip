// Tests for auto-deploy-vps.sh against a fake /opt/crew-v3-spike (stub ops scripts, no docker).
// Run: node --test crew/ops/auto-deploy-vps.test.mjs
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const OPS = path.dirname(fileURLToPath(import.meta.url));
const HELPER = path.join(OPS, "auto-deploy-vps.sh");
const dirs = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const ID = "aaaaaaaaa-1791791718";
const TAG = "crew-v3/paperclip:v3-aaaaaaaaa";
const ISSUE = "11111111-1111-4111-8111-111111111111";

function fakeRoot({ active = "", deployRc = 0 } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "crew-vps-"));
  dirs.push(root);
  mkdirSync(path.join(root, "ops"));
  const script = (name, body) => {
    writeFileSync(path.join(root, name), `#!/bin/bash\n${body}\n`);
    chmodSync(path.join(root, name), 0o755);
  };
  writeFileSync(path.join(root, "active.txt"), active);
  script("ops/active-runs.sh", `cat "${root}/active.txt"`);
  script(
    "ops/deploy.sh",
    `echo "deploy called with $1"; echo "authorization: Bearer leaked"; sleep 1; [ ${deployRc} = 0 ] && echo "deploy ok: old -> $1, rollback TS=20261012-150000"; exit ${deployRc}`,
  );
  script("ops/rollback.sh", `echo "rollback $1"; exit 0`);
  script("api.sh", `[ "$1 $2" = "GET /issues/${ISSUE}/comments" ] || exit 9; echo '[{"authorAgentId":"ag-1","body":"crew-merge sha=${"a".repeat(40)} branch=crew/v3.5 pushed=yes\\n\\nmore"},{"authorUserId":"u","body":"hello\\tworld"}]'`);
  return root;
}

const helper = (root, ...args) =>
  spawnSync("bash", [HELPER, ...args], { encoding: "utf8", env: { ...process.env, AUTO_DEPLOY_ROOT: root }, stdio: ["ignore", "pipe", "pipe"] });

const waitFor = (file, ms = 10_000) => {
  const end = Date.now() + ms;
  while (!existsSync(file)) {
    if (Date.now() > end) throw new Error(`timeout waiting for ${file}`);
    spawnSync("sleep", ["0.2"]);
  }
};

test("rejects arguments that are not the exact expected shape", () => {
  const root = fakeRoot();
  for (const args of [
    ["deploy-when-idle", "crew-v3/paperclip:v3-aaaaaaaaa;id", "5", ID],
    ["deploy-when-idle", TAG, "5", "../x"],
    ["rollback", "20261012-150000; id"],
    ["comments", "not-a-uuid"],
    ["comment", ISSUE, "https://evil.example/x?", "aGk="],
    ["nope"],
  ]) {
    const r = helper(root, ...args);
    assert.equal(r.status, 2, `${args.join(" ")}: ${r.stdout}${r.stderr}`);
  }
});

test("deploy-when-idle starts deploy.sh detached when idle; deploy-status reports rc and a redacted log", () => {
  const root = fakeRoot();
  const r = helper(root, "deploy-when-idle", TAG, "5", ID);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), `STARTED ${ID}`);
  assert.match(helper(root, "deploy-status", ID).stdout, /^RUNNING$/m);
  waitFor(path.join(root, `ops/auto-deploy-${ID}.rc`));
  const s = helper(root, "deploy-status", ID).stdout;
  assert.match(s, /^RC 0$/m);
  assert.match(s, /deploy called with crew-v3\/paperclip:v3-aaaaaaaaa/);
  assert.match(s, /rollback TS=20261012-150000/);
  assert.doesNotMatch(s, /leaked/);
});

test("deploy-when-idle survives the caller's process group being killed", async () => {
  const root = fakeRoot();
  // Same shape as the worker's ssh call: the helper runs in a session whose whole group is then killed.
  const child = spawn("bash", ["-c", `AUTO_DEPLOY_ROOT='${root}' bash '${HELPER}' deploy-when-idle '${TAG}' 5 '${ID}'; sleep 30`], { detached: true, stdio: "ignore" });
  const started = path.join(root, `ops/auto-deploy-${ID}.log`);
  waitFor(started);
  process.kill(-child.pid, "SIGKILL");
  waitFor(path.join(root, `ops/auto-deploy-${ID}.rc`));
  assert.equal(readFileSync(path.join(root, `ops/auto-deploy-${ID}.rc`), "utf8").trim(), "0");
});

test("deploy-when-idle reports BUSY with the active runs after the wait", () => {
  const root = fakeRoot({ active: "2P Solutions|running|1\n" });
  const r = helper(root, "deploy-when-idle", TAG, "1", ID);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^BUSY$/m);
  assert.match(r.stdout, /2P Solutions\|running\|1/);
  assert.ok(!existsSync(path.join(root, `ops/auto-deploy-${ID}.log`)));
});

test("rollback runs ops/rollback.sh with the TS and prints RC", () => {
  const r = helper(fakeRoot(), "rollback", "20261012-150000");
  assert.match(r.stdout, /rollback 20261012-150000\nRC 0/);
});

test("comments prints only author and first line", () => {
  const r = helper(fakeRoot(), "comments", ISSUE);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, `ag-1\tcrew-merge sha=${"a".repeat(40)} branch=crew/v3.5 pushed=yes\n-\thello world\n`);
});

test("comment without the agent key posts nothing (NO_KEY, exit 4)", () => {
  const r = helper(fakeRoot(), "comment", ISSUE, "http://127.0.0.1:9", Buffer.from("x").toString("base64"));
  assert.equal(r.status, 4);
  assert.match(r.stdout, /NO_KEY/);
});

test("comment posts JSON with the agent key from the file and never prints the key", async () => {
  const root = fakeRoot();
  writeFileSync(path.join(root, ".deploy-agent-key"), "pcp_TESTKEY123\n", { mode: 0o600 });
  const seen = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => {
      body += d;
    });
    req.on("end", () => {
      seen.push({ url: req.url, auth: req.headers.authorization, type: req.headers["content-type"], body });
      res.writeHead(201, { "content-type": "application/json" });
      res.end("{}");
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const text = "crew-deploy sha=" + "a".repeat(40) + " status=deployed\n\nDòng tiếng Việt \"có ngoặc\"";
  const r = await new Promise((resolve) => {
    const c = spawn("bash", [HELPER, "comment", ISSUE, `http://127.0.0.1:${port}`, Buffer.from(text).toString("base64")], { env: { ...process.env, AUTO_DEPLOY_ROOT: root } });
    let out = "";
    c.stdout.on("data", (d) => {
      out += d;
    });
    c.stderr.on("data", (d) => {
      out += d;
    });
    c.on("close", (code) => resolve({ code, out }));
  });
  server.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /HTTP 201/);
  assert.doesNotMatch(r.out, /TESTKEY/);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, `/api/issues/${ISSUE}/comments`);
  assert.equal(seen[0].auth, "Bearer pcp_TESTKEY123");
  assert.equal(seen[0].type, "application/json");
  assert.deepEqual(JSON.parse(seen[0].body), { body: text });
});

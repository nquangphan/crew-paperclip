// Tests for auto-deploy.mjs (queue, config, comment format, worker decisions, enqueue + launchd hand-off).
// Run: node --test crew/ops/auto-deploy.test.mjs
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  addWaiting,
  commentBody,
  jobEnv,
  mergeQueue,
  needsFullGates,
  parseConfig,
  parseDeployLog,
  parsePrView,
  PR_MAX_WAIT_MS,
  PR_POLL_MS,
  plistFor,
  postCheckFailures,
  queueTarget,
  redact,
  workerLoop,
} from "./auto-deploy.mjs";

const OPS = path.dirname(fileURLToPath(import.meta.url));
const FORK = path.resolve(OPS, "../..");
const dirs = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = (p) => {
  const d = mkdtempSync(path.join(tmpdir(), p));
  dirs.push(d);
  return d;
};

const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);
const OLD = "0".repeat(40);
const I1 = "11111111-1111-4111-8111-111111111111";
const I2 = "22222222-2222-4222-8222-222222222222";
const CONFIG = JSON.parse(readFileSync(path.join(FORK, "crew/release/auto-deploy.json"), "utf8"));

test("repo config of this fork is valid and enabled", () => {
  const c = parseConfig(JSON.stringify(CONFIG));
  assert.equal(c.enabled, true);
  assert.equal(c.branch, "crew/v3.5");
  assert.equal(c.maxWaitMinutes, 180);
});

test("config rejects unsafe or missing fields", () => {
  for (const [field, value] of [
    ["version", 2],
    ["enabled", "yes"],
    ["branch", "crew/../main"],
    ["worktree", "relative/path"],
    ["vps", "host; rm"],
    ["publicUrl", "http://crew.example"],
    ["maxWaitMinutes", 0],
    ["repoKey", "Bad Key"],
  ]) {
    assert.throws(() => parseConfig(JSON.stringify({ ...CONFIG, [field]: value })), new RegExp(field), field);
  }
  assert.throws(() => parseConfig("{"), /không phải JSON/);
});

// Linear history OLD <- A <- B <- C
const ORDER = [OLD, A, B, C];
const isAnc = (x, y) => ORDER.indexOf(x) >= 0 && ORDER.indexOf(x) <= ORDER.indexOf(y);

test("queue keeps the newest commit as target and every issue", () => {
  let q = mergeQueue(null, { issueId: I1, sha: A, at: "t1" }, isAnc);
  assert.equal(q.target, A);
  q = mergeQueue(q, { issueId: I2, sha: B, at: "t2" }, isAnc);
  assert.equal(q.target, B, "descendant replaces the target");
  assert.equal(q.issues.length, 2);
  const again = mergeQueue(q, { issueId: I2, sha: B, at: "t3" }, isAnc);
  assert.deepEqual(again, q, "same issue and sha is idempotent");
  const older = mergeQueue({ target: C, issues: [{ issueId: I1, sha: C }] }, { issueId: I2, sha: A }, isAnc);
  assert.equal(older.target, C, "an ancestor only adds its issue");
  assert.equal(queueTarget([{ issueId: I1, sha: A }, { issueId: I2, sha: B }], isAnc), B);
  assert.equal(queueTarget([], isAnc), null);
});

test("waiting pull requests survive queue updates; one entry per issue", () => {
  const PR = "https://github.com/acme/app/pull/7";
  let q = addWaiting({ target: null, issues: [] }, { issueId: I1, sha: A, pr: PR, at: "t1" });
  q = addWaiting(q, { issueId: I1, sha: B, pr: PR, at: "t2" });
  assert.deepEqual(q.waiting, [{ issueId: I1, sha: B, pr: PR, at: "t2" }]);
  q = mergeQueue(q, { issueId: I2, sha: C, at: "t3" }, isAnc);
  assert.equal(q.target, C);
  assert.equal(q.waiting.length, 1, "mergeQueue keeps the waiting list");
});

test("gh pr view output: merged needs a merge commit, open and closed are plain states", () => {
  assert.deepEqual(parsePrView(JSON.stringify({ state: "MERGED", mergeCommit: { oid: C }, baseRefName: "crew/v3.5" })), { state: "merged", sha: C, base: "crew/v3.5" });
  assert.deepEqual(parsePrView(JSON.stringify({ state: "OPEN", mergeCommit: null })), { state: "open" });
  assert.deepEqual(parsePrView(JSON.stringify({ state: "CLOSED", mergeCommit: null })), { state: "closed" });
  assert.equal(parsePrView(JSON.stringify({ state: "MERGED", mergeCommit: null })).state, "error");
  assert.equal(parsePrView("not json").state, "error");
  assert.equal(parsePrView(JSON.stringify({ state: "DRAFT" })).state, "error");
});

test("only crew-web or docs changes skip the server gates", () => {
  assert.equal(needsFullGates(["packages/crew-web/src/a.tsx", "docs/x.md"]), false);
  assert.equal(needsFullGates(["packages/crew-web/src/a.tsx", "server/src/crew/x.ts"]), true);
  assert.equal(needsFullGates(null), true);
});

test("redact drops credential lines and masks tokens and URL userinfo", () => {
  const out = redact("ok line\nAuthorization: Bearer abc\nset-cookie: x=1\nhttps://user:pw@github.com/x\nghp_ABCDEF123 pcp_xyz");
  assert.doesNotMatch(out, /abc|x=1|pw@|ABCDEF123|xyz/);
  assert.match(out, /ok line/);
  assert.match(out, /:\/\/\*\*\*@github\.com/);
});

test("deploy.sh output gives the rollback TS on success and on late failures", () => {
  const ok = parseDeployLog("…\nplugin crew.core healthy\ndeploy ok: crew-v3/paperclip:v3-111111111 -> crew-v3/paperclip:v3-222222222, rollback TS=20261012-143905\n");
  assert.deepEqual(ok, { ok: true, prevImage: "crew-v3/paperclip:v3-111111111", newImage: "crew-v3/paperclip:v3-222222222", ts: "20261012-143905" });
  assert.deepEqual(parseDeployLog("deploy: plugin crew.core not healthy (x), run ops/rollback.sh 20261012-150000\n"), { ok: false, ts: "20261012-150000" });
  assert.deepEqual(parseDeployLog("deploy: active runs, refusing to restart:\n"), { ok: false, ts: null });
});

test("comment first line is exactly the machine-readable line", () => {
  const body = commentBody({ sha: A, status: "rolled_back", lines: ["lý do"] });
  assert.equal(body.split("\n")[0], `crew-deploy sha=${A} status=rolled_back`);
  assert.match(body.split("\n")[0], /^crew-deploy sha=[0-9a-f]{40} status=(queued|deployed|failed|rolled_back|cancelled)$/);
  assert.equal(commentBody({ sha: A, status: "cancelled" }).split("\n")[0], `crew-deploy sha=${A} status=cancelled`);
  assert.throws(() => commentBody({ sha: "abc", status: "deployed" }));
  assert.throws(() => commentBody({ sha: A, status: "done" }));
});

test("launchd job: runs once, own process group kept, no agent run variables", () => {
  const env = jobEnv({ PATH: "/opt/homebrew/bin:/usr/bin", HOME: "/Users/x", PAPERCLIP_RUN_ID: "r", PAPERCLIP_API_KEY: "jwt" });
  assert.deepEqual(Object.keys(env).sort(), ["HOME", "LANG", "PATH"]);
  const plist = plistFor({ label: "com.2p.crew.auto-deploy.paperclip", node: "/opt/homebrew/bin/node", script: "/s/bin/auto-deploy.mjs", stateDir: "/s", env });
  assert.match(plist, /<key>KeepAlive<\/key><false\/>/);
  assert.match(plist, /<key>RunAtLoad<\/key><true\/>/);
  assert.match(plist, /<key>AbandonProcessGroup<\/key><true\/>/);
  assert.doesNotMatch(plist, /PAPERCLIP|jwt/);
  const plutil = spawnSync("plutil", ["-lint", "-"], { input: plist, encoding: "utf8" });
  if (!plutil.error) assert.equal(plutil.status, 0, plutil.stdout);
});

test("post-checks name every failing probe", () => {
  const good = { healthStatus: "ok", healthCommit: A, plugin: "healthy", rootCode: 200, paperclipCode: 200, uiCommit: A, claimsOk: 3 };
  assert.deepEqual(postCheckFailures(good, A), []);
  const bad = postCheckFailures({ ...good, healthCommit: B, plugin: "error", paperclipCode: 502, claimsOk: 0 }, A);
  assert.equal(bad.length, 4);
});

// ---------------------------------------------------------------------------------------------------------------
// workerLoop with a scripted world

const INSPECT = (sha, manifest = "crew.core a,b") =>
  `issues crewCoreHooks=3\ncrew-ui=${sha}\nplugin bundle ok; manifest ${manifest}\nRC 0\n`;

function world(opts = {}) {
  const w = {
    queue: opts.queue,
    running: opts.running ?? OLD,
    images: new Set(opts.images ?? []),
    busy: opts.busy ?? 0,
    deployRc: opts.deployRc ?? [0],
    healthy: opts.healthy ?? true,
    mergeComments: opts.mergeComments ?? true,
    newManifest: opts.newManifest,
    prViews: opts.prViews ?? [],
    openPrs: opts.openPrs,
    calls: [],
    comments: [],
    logs: [],
    time: 0,
    onWait: opts.onWait,
    gitHook: opts.gitHook,
  };
  const deps = {
    home: "/home/t",
    now: () => new Date(Date.UTC(2026, 9, 12, 8, 0, 0) + w.time),
    sleep: (ms) => {
      w.time += ms;
    },
    log: (l) => w.logs.push(l),
    readQueue: () => structuredClone(w.queue),
    writeQueue: (q) => {
      w.queue = structuredClone(q);
    },
    setStatus: () => {},
    withLock: (fn) => fn(),
    appendHistory: () => {},
    sh: (cmd, args) => {
      w.calls.push([cmd, ...args].join(" "));
      if (cmd === "gh" && args[0] === "pr" && args[1] === "list") {
        const open = w.openPrs ?? "[]";
        return typeof open === "string" ? { code: 0, out: open, stdout: open } : open;
      }
      if (cmd === "gh") {
        const v = w.prViews.length > 1 ? w.prViews.shift() : w.prViews[0];
        return typeof v === "string" ? { code: 0, out: v, stdout: v } : v;
      }
      if (cmd === "git") {
        const g = args.slice(1);
        const hooked = w.gitHook?.(g);
        if (hooked) return hooked;
        if (g[0] === "merge-base") return { code: isAnc(g[2], g[3] === "origin/crew/v3.5" ? C : g[3]) ? 0 : 1, out: "" };
        if (g[0] === "status") return { code: 0, out: "" };
        if (g[0] === "diff") return { code: 0, out: "packages/crew-web/src/a.tsx\n" };
        return { code: 0, out: "" };
      }
      if (cmd === "curl") {
        const url = args.at(-1);
        const deployed = w.running;
        const ok = w.healthy;
        if (url.endsWith("/api/health")) return { code: 0, out: JSON.stringify({ status: "ok", commit: deployed }) };
        if (args.includes("%{http_code}")) return { code: 0, out: ok ? "200" : "502" };
        return { code: 0, out: `<meta name="crew-ui" content="${deployed}">` };
      }
      return { code: 0, out: "" };
    },
    vps: (args) => {
      w.calls.push(`vps ${args.join(" ")}`);
      const [cmd, a1, a2, a3] = args;
      switch (cmd) {
        case "comments":
        {
          const i = w.queue.issues.find((x) => x.issueId === a1);
          const line = i?.pr ? `crew-merge sha=${i.approvedSha} branch=crew/v3.5 pushed=pr pr=${i.pr}` : `crew-merge sha=${i?.sha} branch=crew/v3.5 pushed=yes`;
          return { code: 0, out: w.mergeComments ? `agent-1\t${line}\n` : "-\tcrew-merge sha=x\n" };
        }
        case "image":
          return { code: 0, out: w.images.has(a1) ? "present\n" : "absent\n" };
        case "build":
          w.images.add(`crew-v3/paperclip:v3-${a1}`);
          return { code: 0, out: "JOB_EXIT rc=0\nRC 0\n" };
        case "inspect": {
          const sha = a1 === `crew-v3/paperclip:v3-${w.running.slice(0, 9)}` ? w.running : ORDER.find((s) => a1.endsWith(s.slice(0, 9)));
          const manifest = sha !== w.running && w.newManifest ? w.newManifest : undefined;
          return { code: 0, out: INSPECT(sha, manifest) };
        }
        case "current-image":
          return { code: 0, out: `crew-v3/paperclip:v3-${w.running.slice(0, 9)}\n` };
        case "deploy-when-idle":
          w.onWait?.(w);
          if (w.busy > 0) {
            w.busy--;
            w.time += Number(a2) * 1000;
            return { code: 0, out: "BUSY\n  2P Solutions|running|1\n" };
          }
          w.pending = a1;
          return { code: 0, out: `STARTED ${a3}\n` };
        case "deploy-status": {
          const rc = w.deployRc.shift() ?? 0;
          const prev = `crew-v3/paperclip:v3-${w.running.slice(0, 9)}`;
          if (rc === 0) {
            if (w.healthy) w.running = ORDER.find((s) => w.pending.endsWith(s.slice(0, 9)));
            return { code: 0, out: `RC 0\nplugin crew.core healthy\ndeploy ok: ${prev} -> ${w.pending}, rollback TS=20261012-150000\n` };
          }
          return { code: 0, out: `RC ${rc}\ndeploy: active runs, refusing to restart:\n` };
        }
        case "rollback":
          return { code: 0, out: "rollback: server image x, health=ok\nRC 0\n" };
        case "plugin-state":
          return { code: 0, out: w.healthy ? "healthy\n" : "error: boom\n" };
        case "claims":
          return { code: 0, out: "claims_ok=4 claims_5xx=0 errors=0\n" };
        case "comment":
          w.comments.push({ issueId: a1, body: Buffer.from(a3, "base64").toString("utf8") });
          return { code: 0, out: "HTTP 201\n" };
        case "active-runs":
          return { code: 0, out: w.busy-- > 0 ? "2P Solutions|running|1\n" : "" };
        default:
          throw new Error(`unexpected vps ${cmd} ${a2}`);
      }
    },
  };
  return { w, deps };
}

const JOB = { config: parseConfig(JSON.stringify(CONFIG)), gitDir: "/repo/.git", dryRun: false };
const first = (c) => c.body.split("\n")[0];

test("worker: gates, build, waits for a gap, deploys, checks, reports deployed with the rollback command", () => {
  const { w, deps } = world({ queue: { target: A, issues: [{ issueId: I1, sha: A }] }, busy: 2 });
  workerLoop(JOB, deps);
  assert.equal(w.comments.length, 1);
  assert.equal(first(w.comments[0]), `crew-deploy sha=${A} status=deployed`);
  assert.match(w.comments[0].body, /ops\/rollback\.sh 20261012-150000/);
  assert.match(w.comments[0].body, /\| plugin crew.core \| healthy \|/);
  assert.ok(w.calls.some((c) => c.includes("@crew/paperclip-web test")));
  assert.ok(!w.calls.some((c) => c.includes("verify.sh")), "crew-web-only change skips verify.sh");
  assert.ok(w.calls.some((c) => c === `bash crew/ops/overlay-source.sh ${A}`));
  assert.equal(w.calls.filter((c) => c.startsWith("vps deploy-when-idle")).length, 3);
  assert.deepEqual(w.queue, { target: null, issues: [] });
  assert.equal(w.running, A);
});

test("worker: failing post-checks roll back automatically and report rolled_back", () => {
  const { w, deps } = world({ queue: { target: A, issues: [{ issueId: I1, sha: A }] }, healthy: false });
  workerLoop(JOB, deps);
  assert.ok(w.calls.includes("vps rollback 20261012-150000"));
  assert.equal(first(w.comments[0]), `crew-deploy sha=${A} status=rolled_back`);
  assert.match(w.comments[0].body, /Đã tự rollback/);
});

test("worker: gives up after maxWaitMinutes of busy runs and reports failed", () => {
  const { w, deps } = world({ queue: { target: A, issues: [{ issueId: I1, sha: A }] }, busy: 1000 });
  workerLoop(JOB, deps);
  assert.equal(first(w.comments[0]), `crew-deploy sha=${A} status=failed`);
  assert.match(w.comments[0].body, /chờ 180 phút vẫn còn run/);
  assert.ok(!w.calls.some((c) => c.startsWith("vps deploy-status")));
  assert.equal(w.calls.filter((c) => c.startsWith("vps deploy-when-idle")).length, 18);
});

test("worker: deploy.sh refusing because a run just started (rc 2) goes back to waiting", () => {
  const { w, deps } = world({ queue: { target: A, issues: [{ issueId: I1, sha: A }] }, deployRc: [2, 0] });
  workerLoop(JOB, deps);
  assert.equal(w.calls.filter((c) => c.startsWith("vps deploy-when-idle")).length, 2);
  assert.equal(first(w.comments[0]), `crew-deploy sha=${A} status=deployed`);
});

test("worker: refuses a commit without the integrator's crew-merge line, before any gate", () => {
  const { w, deps } = world({ queue: { target: A, issues: [{ issueId: I1, sha: A }] }, mergeComments: false });
  workerLoop(JOB, deps);
  assert.equal(first(w.comments[0]), `crew-deploy sha=${A} status=failed`);
  assert.match(w.comments[0].body, /crew-merge/);
  assert.ok(!w.calls.some((c) => c.startsWith("corepack")));
  assert.ok(!w.calls.some((c) => c.startsWith("vps deploy")));
});

test("worker: a newer approved commit arriving while waiting is deployed once, both issues reported", () => {
  let added = false;
  const { w, deps } = world({
    queue: { target: A, issues: [{ issueId: I1, sha: A }] },
    busy: 1,
    onWait: (wd) => {
      if (added) return;
      added = true;
      wd.queue = mergeQueue(wd.queue, { issueId: I2, sha: B }, isAnc);
    },
  });
  workerLoop(JOB, deps);
  const deploys = w.calls.filter((c) => c.startsWith("vps deploy-status"));
  assert.equal(deploys.length, 1, "one deploy");
  assert.equal(w.running, B);
  assert.equal(w.comments.length, 2);
  for (const c of w.comments) assert.equal(first(c), `crew-deploy sha=${B} status=deployed`);
  assert.match(w.comments.find((c) => c.issueId === I1).body, new RegExp(`Commit được duyệt của yêu cầu này: \`${A}\``));
});

test("worker: a commit already inside the running build is reported without a deploy", () => {
  const { w, deps } = world({ queue: { target: A, issues: [{ issueId: I1, sha: A }] }, running: B });
  workerLoop(JOB, deps);
  assert.equal(first(w.comments[0]), `crew-deploy sha=${B} status=deployed`);
  assert.ok(!w.calls.some((c) => c.startsWith("vps deploy")));
});

test("worker: new plugin capabilities stop the deploy for a manual look", () => {
  const { w, deps } = world({ queue: { target: A, issues: [{ issueId: I1, sha: A }] }, newManifest: "crew.core a,b,c" });
  workerLoop(JOB, deps);
  assert.equal(first(w.comments[0]), `crew-deploy sha=${A} status=failed`);
  assert.match(w.comments[0].body, /manifest crew\.core/);
  assert.ok(!w.calls.some((c) => c.startsWith("vps deploy")));
});

const PR = "https://github.com/acme/paperclip/pull/42";
const view = (state, oid = null, base = "crew/v3.5", head = undefined) =>
  JSON.stringify({ state, mergeCommit: oid ? { oid } : null, baseRefName: base, ...(head ? { headRefName: head } : {}) });
const waitingOn = (sha = A, at = "2026-10-12T08:00:00.000Z") => ({ target: null, issues: [], waiting: [{ issueId: I1, sha, pr: PR, at }] });

test("worker: waits for the pull request, then deploys its merge commit and names the PR and approved commit", () => {
  const { w, deps } = world({ queue: waitingOn(A), prViews: [view("OPEN"), view("OPEN"), view("MERGED", B)] });
  workerLoop(JOB, deps);
  const polls = w.calls.filter((c) => c.startsWith("gh pr view"));
  assert.equal(polls.length, 3);
  assert.equal(polls[0], `gh pr view ${PR} --json state,mergeCommit,baseRefName,headRefName`);
  assert.ok(w.time >= 2 * PR_POLL_MS, "polls are spaced by PR_POLL_MS");
  assert.ok(w.calls.some((c) => c === `vps comments ${I1}`), "checks the integrator's pushed=pr line");
  assert.equal(w.comments.length, 1);
  assert.equal(first(w.comments[0]), `crew-deploy sha=${B} status=deployed`);
  assert.match(w.comments[0].body, new RegExp(`Pull request ${PR} đã merge thành \`${B}\`; commit owner duyệt: \`${A}\``));
  assert.equal(w.running, B);
  assert.deepEqual(w.queue, { target: null, issues: [], waiting: [] });
});

// Scripted git for branch cleanup: `locals` are existing local branches, `checkedOut` live in a worktree.
const branchGit = ({ locals = [], checkedOut = [], failPush = false, merged = [] } = {}) => (g) => {
  if (g[0] === "merge-base" && g[2].startsWith("crew/")) return { code: merged.includes(g[2]) ? 0 : 1, out: "" };
  if (g[0] === "worktree") return { code: 0, out: checkedOut.map((b) => `worktree /w\nbranch refs/heads/${b}\n`).join("\n") };
  if (g[0] === "for-each-ref") return { code: 0, out: locals.join("\n") };
  if (g[0] === "show-ref") return { code: locals.includes(g[3].replace("refs/heads/", "")) ? 0 : 1, out: "" };
  if (g[0] === "push") return { code: failPush ? 1 : 0, out: failPush ? "remote: boom" : "" };
  return null;
};
const REQ = "crew/req/TPS-10";

test("worker: merged pull request deletes crew/req/<id> on origin and locally, plus merged child branches", () => {
  const gitHook = branchGit({ locals: [REQ, "crew/TPS-11", "crew/TPS-12", "crew/TPS-13", "crew/v3.5"], checkedOut: ["crew/TPS-13"], merged: ["crew/TPS-11", "crew/TPS-13"] });
  const { w, deps } = world({ queue: waitingOn(A), prViews: [view("MERGED", B, "crew/v3.5", REQ)], gitHook });
  workerLoop(JOB, deps);
  assert.ok(w.calls.some((c) => c.endsWith(`push origin --delete ${REQ}`)));
  assert.ok(w.calls.some((c) => c.endsWith(`branch -D ${REQ}`)));
  assert.ok(w.calls.some((c) => c.endsWith("branch -D crew/TPS-11")), "child already inside the merge commit");
  assert.ok(!w.calls.some((c) => c.endsWith("branch -D crew/TPS-12")), "child not inside the merge commit kept");
  assert.ok(!w.calls.some((c) => c.endsWith("branch -D crew/TPS-13")), "checked-out branch kept");
  assert.ok(!w.calls.some((c) => /branch -D crew\/v3\.5/.test(c)), "non child shape untouched");
  assert.ok(!w.calls.some((c) => /push origin --delete crew\/TPS-/.test(c)), "child remotes never deleted");
  assert.equal(first(w.comments[0]), `crew-deploy sha=${B} status=deployed`);
});

test("worker: closed pull request keeps its request branch on origin and locally", () => {
  const gitHook = branchGit({ locals: [REQ, "crew/TPS-11"] });
  const { w, deps } = world({ queue: waitingOn(A), prViews: [view("CLOSED", null, "crew/v3.5", REQ)], gitHook });
  workerLoop(JOB, deps);
  assert.ok(!w.calls.some((c) => /push origin --delete|branch -D/.test(c)));
  assert.equal(first(w.comments[0]), `crew-deploy sha=${A} status=cancelled`);
});

test("worker: merged pull request keeps the branch while another open pull request uses the same head", () => {
  const gitHook = branchGit({ locals: [REQ] });
  const { w, deps } = world({ queue: waitingOn(A), prViews: [view("MERGED", B, "crew/v3.5", REQ)], gitHook, openPrs: '[{"number":99}]' });
  workerLoop(JOB, deps);
  assert.ok(w.calls.some((c) => c.includes(`gh pr list --head ${REQ} --state open --json number`)));
  assert.ok(!w.calls.some((c) => /push origin --delete|branch -D/.test(c)));
  assert.ok(w.logs.some((l) => l.includes("còn 1 PR đang mở cùng nhánh")));
});

test("worker: merged pull request keeps the branch when open pull requests cannot be checked", () => {
  for (const openPrs of [{ code: 1, out: "HTTP 502" }, "không phải JSON"]) {
    const { w, deps } = world({ queue: waitingOn(A), prViews: [view("MERGED", B, "crew/v3.5", REQ)], gitHook: branchGit({ locals: [REQ] }), openPrs });
    workerLoop(JOB, deps);
    assert.ok(!w.calls.some((c) => /push origin --delete|branch -D/.test(c)));
    assert.ok(w.logs.some((l) => l.includes("không kiểm được PR đang mở")));
  }
});

test("worker: head branch outside crew/req/<id> is never touched; push failure is only logged", () => {
  const other = world({ queue: waitingOn(A), prViews: [view("MERGED", B, "crew/v3.5", "feature/x")], gitHook: branchGit({ locals: ["feature/x"] }) });
  workerLoop(JOB, other.deps);
  assert.ok(!other.w.calls.some((c) => /push origin --delete|branch -D feature/.test(c)));
  const failing = world({ queue: waitingOn(A), prViews: [view("MERGED", B, "crew/v3.5", REQ)], gitHook: branchGit({ locals: [REQ], failPush: true }) });
  workerLoop(JOB, failing.deps);
  assert.ok(failing.w.logs.some((l) => l.includes(`xóa nhánh remote ${REQ}: rc 1`)));
  assert.equal(first(failing.w.comments[0]), `crew-deploy sha=${B} status=deployed`);
});

test("gh pr view output carries headRefName when present", () => {
  assert.equal(parsePrView(JSON.stringify({ state: "CLOSED", headRefName: REQ })).head, REQ);
  assert.equal(parsePrView(JSON.stringify({ state: "MERGED", mergeCommit: { oid: C }, headRefName: REQ })).head, REQ);
});

test("worker: a pull request closed without merging ends with status=cancelled and no deploy", () => {
  const { w, deps } = world({ queue: waitingOn(A), prViews: [view("OPEN"), view("CLOSED")] });
  workerLoop(JOB, deps);
  assert.equal(w.comments.length, 1);
  assert.equal(first(w.comments[0]), `crew-deploy sha=${A} status=cancelled`);
  assert.match(w.comments[0].body, /đã đóng mà không merge/);
  assert.ok(!w.calls.some((c) => /^(corepack|vps deploy|vps build)/.test(c)));
  assert.deepEqual(w.queue.waiting, []);
});

test("worker: a pull request still open after the maximum wait is reported failed; gh errors keep waiting", () => {
  const { w, deps } = world({ queue: waitingOn(A), prViews: [{ code: 1, out: "HTTP 502" }, view("OPEN")] });
  workerLoop(JOB, deps);
  assert.equal(first(w.comments[0]), `crew-deploy sha=${A} status=failed`);
  assert.match(w.comments[0].body, /chưa merge sau 72 giờ/);
  const polls = w.calls.filter((c) => c.startsWith("gh pr view")).length;
  assert.ok(polls >= PR_MAX_WAIT_MS / PR_POLL_MS && polls <= PR_MAX_WAIT_MS / PR_POLL_MS + 2, `polls ${polls}`);
  assert.ok(!w.calls.some((c) => c.startsWith("corepack")));
});

test("worker: a pull request merged into another branch is not deployed", () => {
  const { w, deps } = world({ queue: waitingOn(A), prViews: [view("MERGED", B, "main")] });
  workerLoop(JOB, deps);
  assert.equal(first(w.comments[0]), `crew-deploy sha=${A} status=failed`);
  assert.match(w.comments[0].body, /không phải nhánh deploy `crew\/v3\.5`/);
  assert.ok(!w.calls.some((c) => c.startsWith("corepack")));
});

test("worker: a merged pull request without the integrator's pushed=pr line is refused", () => {
  const { w, deps } = world({ queue: waitingOn(A), prViews: [view("MERGED", B)], mergeComments: false });
  workerLoop(JOB, deps);
  assert.equal(first(w.comments[0]), `crew-deploy sha=${B} status=failed`);
  assert.match(w.comments[0].body, /pushed=pr pr=<url>/);
  assert.ok(!w.calls.some((c) => c.startsWith("corepack")));
});

test("worker dry-run: runs no gate, build, deploy or comment; prints the comment instead", () => {
  const { w, deps } = world({ queue: { target: A, issues: [{ issueId: I1, sha: A }] }, busy: 1 });
  workerLoop({ ...JOB, dryRun: true }, deps);
  assert.ok(!w.calls.some((c) => /^(corepack|bash|sh) /.test(c)), w.calls.join("\n"));
  assert.ok(!w.calls.some((c) => /^vps (build|deploy-when-idle|deploy-status|rollback|comment) /.test(c)), w.calls.join("\n"));
  assert.equal(w.comments.length, 0);
  const printed = w.logs.find((l) => l.startsWith("DRY-RUN: sẽ comment"));
  assert.match(printed, new RegExp(`crew-deploy sha=${A} status=deployed`));
});

// ---------------------------------------------------------------------------------------------------------------
// enqueue: real git repo, fake launchctl

function fixtureRepo({ withConfig = true } = {}) {
  const root = tmp("crew-autodeploy-");
  const origin = path.join(root, "origin.git");
  const work = path.join(root, "work");
  const git = (cwd, ...args) => {
    const r = spawnSync("git", args, { cwd, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  git(root, "init", "-q", "--bare", "-b", "crew/v3.5", origin);
  git(root, "clone", "-q", origin, work);
  git(work, "config", "user.email", "t@t");
  git(work, "config", "user.name", "t");
  git(work, "switch", "-q", "-c", "crew/v3.5");
  mkdirSync(path.join(work, "crew/ops"), { recursive: true });
  mkdirSync(path.join(work, "crew/release"), { recursive: true });
  for (const f of ["auto-deploy.mjs", "auto-deploy-vps.sh"]) writeFileSync(path.join(work, "crew/ops", f), readFileSync(path.join(OPS, f)));
  if (withConfig) writeFileSync(path.join(work, "crew/release/auto-deploy.json"), JSON.stringify({ ...CONFIG, worktree: "~/crew-deploy/t" }));
  git(work, "add", ".");
  git(work, "commit", "-qm", "one");
  const one = git(work, "rev-parse", "HEAD");
  writeFileSync(path.join(work, "x.txt"), "2\n");
  git(work, "add", ".");
  git(work, "commit", "-qm", "two");
  const two = git(work, "rev-parse", "HEAD");
  git(work, "push", "-q", "origin", "crew/v3.5");
  writeFileSync(path.join(work, "y.txt"), "3\n");
  git(work, "add", ".");
  git(work, "commit", "-qm", "unpushed");
  const local = git(work, "rev-parse", "HEAD");
  const home = path.join(root, "home");
  const bin = path.join(root, "bin");
  mkdirSync(home);
  mkdirSync(bin);
  const log = path.join(root, "launchctl.log");
  // Fake launchctl: logs calls; `print gui/<uid>/<label>` says running when $root/running exists.
  writeFileSync(
    path.join(bin, "launchctl"),
    `#!/bin/sh\necho "$*" >> "${log}"\ncase "$1" in print) case "$2" in */com.*) [ -f "${root}/running" ] && echo "	state = running" && exit 0; exit 113;; esac; exit 0;; esac\nexit 0\n`,
  );
  chmodSync(path.join(bin, "launchctl"), 0o755);
  const enqueue = (sha, issue, extra = []) =>
    spawnSync(process.execPath, [path.join(OPS, "auto-deploy.mjs"), "enqueue", "--repo", work, "--sha", sha, "--issue", issue, "--body-out", path.join(root, "body.json"), ...extra], {
      encoding: "utf8",
      env: { PATH: `${bin}:${process.env.PATH}`, HOME: home, PAPERCLIP_RUN_ID: "run-1", PAPERCLIP_API_KEY: "secret-jwt" },
    });
  return { root, work, home, one, two, local, log, enqueue };
}

test("enqueue: queues, copies the approved scripts, starts launchd without agent variables, writes the queued body", () => {
  const f = fixtureRepo();
  const r = f.enqueue(f.two, I1);
  assert.equal(r.status, 0, r.stderr);
  const body = JSON.parse(readFileSync(path.join(f.root, "body.json"), "utf8")).body;
  assert.equal(body.split("\n")[0], `crew-deploy sha=${f.two} status=queued`);
  const state = path.join(f.home, ".crew/auto-deploy/paperclip");
  assert.deepEqual(JSON.parse(readFileSync(path.join(state, "queue.json"), "utf8")).target, f.two);
  assert.ok(existsSync(path.join(state, "bin/auto-deploy.mjs")));
  assert.ok(existsSync(path.join(state, "bin/auto-deploy-vps.sh")));
  const calls = readFileSync(f.log, "utf8");
  assert.match(calls, /^bootstrap gui\/\d+ .*com\.2p\.crew\.auto-deploy\.paperclip\.plist$/m);
  const plist = readFileSync(path.join(state, "com.2p.crew.auto-deploy.paperclip.plist"), "utf8");
  assert.doesNotMatch(plist, /PAPERCLIP|secret-jwt/);
  assert.equal(JSON.parse(readFileSync(path.join(state, "job.json"), "utf8")).dryRun, false);
});

test("enqueue: a running worker is not restarted; the newer commit becomes the target", () => {
  const f = fixtureRepo();
  assert.equal(f.enqueue(f.one, I1).status, 0);
  const state = path.join(f.home, ".crew/auto-deploy/paperclip");
  writeFileSync(path.join(state, "status.json"), JSON.stringify({ state: "running" }));
  writeFileSync(path.join(f.root, "running"), "");
  writeFileSync(f.log, "");
  const r = f.enqueue(f.two, I2);
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(readFileSync(f.log, "utf8"), /bootstrap/);
  const q = JSON.parse(readFileSync(path.join(state, "queue.json"), "utf8"));
  assert.equal(q.target, f.two);
  assert.equal(q.issues.length, 2);
});

test("enqueue: refuses a commit that is not on origin/<branch> and says so in the body", () => {
  const f = fixtureRepo();
  const r = f.enqueue(f.local, I1);
  assert.equal(r.status, 1);
  const body = JSON.parse(readFileSync(path.join(f.root, "body.json"), "utf8")).body;
  assert.equal(body.split("\n")[0], `crew-deploy sha=${f.local} status=failed`);
  assert.match(body, /không nằm trên `origin\/crew\/v3\.5`/);
  assert.ok(!existsSync(f.log) || !/bootstrap/.test(readFileSync(f.log, "utf8")));
});

test("enqueue --pr: queues the approved commit as waiting for the pull request, even though it is not on the branch yet", () => {
  const f = fixtureRepo();
  const pr = "https://github.com/acme/paperclip/pull/9";
  const r = f.enqueue(f.local, I1, ["--pr", pr]);
  assert.equal(r.status, 0, r.stderr);
  const body = JSON.parse(readFileSync(path.join(f.root, "body.json"), "utf8")).body;
  assert.equal(body.split("\n")[0], `crew-deploy sha=${f.local} status=queued`);
  assert.match(body, new RegExp(`Chưa deploy: job chờ pull request ${pr} được merge vào \`crew/v3\.5\``));
  assert.match(body, /status=cancelled/);
  const q = JSON.parse(readFileSync(path.join(f.home, ".crew/auto-deploy/paperclip/queue.json"), "utf8"));
  assert.equal(q.target, null);
  assert.deepEqual(q.issues, []);
  assert.deepEqual(q.waiting.map((x) => [x.issueId, x.sha, x.pr]), [[I1, f.local, pr]]);
  assert.match(readFileSync(f.log, "utf8"), /^bootstrap gui\/\d+ /m);
  for (const bad of ["https://gitlab.com/a/b/pull/1", "https://github.com/a/b/pull/1;x", "nope"]) {
    const refused = f.enqueue(f.two, I2, ["--pr", bad]);
    assert.equal(refused.status, 1, bad);
    assert.match(refused.stderr, /--pr phải là URL pull request GitHub/);
  }
});

test("enqueue: repos without crew/release/auto-deploy.json are a silent no-op (exit 3, no body)", () => {
  const f = fixtureRepo({ withConfig: false });
  const r = f.enqueue(f.two, I1);
  assert.equal(r.status, 3);
  assert.equal(r.stdout, "");
  assert.ok(!existsSync(path.join(f.root, "body.json")));
  assert.ok(!existsSync(path.join(f.home, ".crew")));
});

test("enqueue: --simulate-merge-ok is refused outside dry-run; dry-run uses its own label and state", () => {
  const f = fixtureRepo();
  assert.equal(f.enqueue(f.two, I1, ["--simulate-merge-ok"]).status, 1);
  const r = f.enqueue(f.two, I1, ["--dry-run", "--simulate-merge-ok"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(readFileSync(f.log, "utf8"), /com\.2p\.crew\.auto-deploy\.paperclip\.dry\.plist/);
  assert.ok(existsSync(path.join(f.home, ".crew/auto-deploy/paperclip-dry/job.json")));
  assert.match(JSON.parse(readFileSync(path.join(f.root, "body.json"), "utf8")).body, /CHẠY THỬ/);
});

test("CLI runs when started through a symlinked path (mktemp -d on macOS is /var -> /private/var)", () => {
  const dir = tmp("crew-autodeploy-cli-");
  const real = path.join(dir, "real");
  mkdirSync(real);
  writeFileSync(path.join(real, "auto-deploy.mjs"), readFileSync(path.join(OPS, "auto-deploy.mjs")));
  symlinkSync(real, path.join(dir, "link"));
  const r = spawnSync(process.execPath, [path.join(dir, "link", "auto-deploy.mjs"), "nope"], { encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage: auto-deploy\.mjs/);
});

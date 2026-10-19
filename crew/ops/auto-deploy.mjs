#!/usr/bin/env node
// Auto-deploy after owner approval, for repos that opt in with crew/release/auto-deploy.json.
//
//   enqueue --issue <uuid> --sha <40 hex> [--pr <GitHub pull request URL>] [--repo <path>] [--body-out <file>]
//           [--dry-run [--simulate-merge-ok]] [--max-wait-min <n>]
//     Run by the integrator in its stage-4 run, after `crew-merge … pushed=yes` (direct push: the commit is queued for
//     deploy) or `crew-merge … pushed=pr pr=<url>` (pull request: the job waits for the owner to merge it, then deploys
//     the merge commit). Starts the worker under launchd when it is not running, and writes the
//     `crew-deploy … status=queued` comment body (JSON) for the integrator to post with its own run token.
//     Exit 0 queued, 3 not enabled, 1 refused/failed (body says why).
//   worker --state-dir <dir>
//     Run by launchd only. Deploys the newest queued commit, reports on every covered issue, repeats, then exits.
//     Pull requests still open are polled with `gh pr view` every PR_POLL_MS for at most PR_MAX_WAIT_MS: merged into
//     the configured branch -> its merge commit is queued; closed unmerged -> `status=cancelled`; too old -> `failed`.
//   status [--repo-key <key>] [--dry-run]
//     Prints the worker status file.
//
// Why launchd: the deploy restarts the server that orchestrates the integrator's own run, so it must not live inside
// the run. A job bootstrapped into gui/<uid> has PPID 1, its own process group and session, a cwd outside every agent
// worktree and an environment without PAPERCLIP_*: the Mac reaper (orphaned agent CLI + descendants, cwd under the run
// worktree, recorded run pgid) and the server's run stop (recorded pgid) never match it. `launchctl submit` is not
// used: it keeps the job alive and reruns it.
//
// Final reports are posted by the VPS helper with the integrator agent's API key: a board-user comment on a closed
// issue that still has an assignee agent reopens it to `todo` and wakes the agent; agent comments never do.
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CONFIG_PATH = "crew/release/auto-deploy.json";
export const SHA_RE = /^[0-9a-f]{40}$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const PR_URL_RE = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9][0-9]*$/;
export const STATUSES = ["queued", "deployed", "failed", "rolled_back", "cancelled"];
const MIN = 60_000;
export const PR_POLL_MS = 5 * MIN;
export const PR_MAX_WAIT_MS = 72 * 60 * MIN;

// ---------------------------------------------------------------------------------------------------------------
// Pure helpers (unit-tested)

/** Validates the repo config. Throws with a Vietnamese reason the integrator can post. */
export function parseConfig(text) {
  let c;
  try {
    c = JSON.parse(text);
  } catch {
    throw new Error(`${CONFIG_PATH} không phải JSON hợp lệ`);
  }
  const bad = (field) => {
    throw new Error(`${CONFIG_PATH}: trường ${field} thiếu hoặc sai`);
  };
  if (!c || typeof c !== "object" || Array.isArray(c)) bad("(gốc)");
  if (c.version !== 1) bad("version");
  if (typeof c.enabled !== "boolean") bad("enabled");
  if (typeof c.repoKey !== "string" || !/^[a-z0-9][a-z0-9-]{0,40}$/.test(c.repoKey)) bad("repoKey");
  if (typeof c.branch !== "string" || !/^[A-Za-z0-9._/-]+$/.test(c.branch) || c.branch.includes("..")) bad("branch");
  if (typeof c.worktree !== "string" || !/^(~\/|\/)[A-Za-z0-9._/-]+$/.test(c.worktree) || c.worktree.includes(".."))
    bad("worktree");
  if (typeof c.vps !== "string" || !/^[A-Za-z0-9._@-]+$/.test(c.vps)) bad("vps");
  if (typeof c.root !== "string" || !/^\/[A-Za-z0-9._/-]+$/.test(c.root)) bad("root");
  if (typeof c.publicUrl !== "string" || !/^https:\/\/[A-Za-z0-9.-]+$/.test(c.publicUrl)) bad("publicUrl");
  const maxWaitMinutes = c.maxWaitMinutes ?? 180;
  if (!Number.isInteger(maxWaitMinutes) || maxWaitMinutes < 1 || maxWaitMinutes > 1440) bad("maxWaitMinutes");
  return { ...c, maxWaitMinutes };
}

export const expandHome = (p, home) => (p.startsWith("~/") ? path.join(home, p.slice(2)) : p);

/**
 * Adds an approved commit to the queue. The target is the newest commit: a descendant replaces it, an ancestor only
 * adds its issue (it ships with the target), unrelated commits fall back to "the later request wins".
 * `isAncestor(a, b)` is true when a is b or an ancestor of b.
 */
export function mergeQueue(queue, entry, isAncestor) {
  const issues = queue?.issues ?? [];
  if (issues.some((i) => i.issueId === entry.issueId && i.sha === entry.sha)) return { ...queue, target: queue.target, issues };
  const next = [...issues.filter((i) => i.issueId !== entry.issueId), entry];
  let target = queue?.target ?? null;
  if (!target || !isAncestor(entry.sha, target)) target = entry.sha;
  return { ...(queue ?? {}), target, issues: next };
}

/** Adds (or replaces, per issue) a pull request the worker waits on before it can deploy anything for that issue. */
export function addWaiting(queue, entry) {
  const waiting = (queue?.waiting ?? []).filter((w) => w.issueId !== entry.issueId);
  return { target: queue?.target ?? null, issues: queue?.issues ?? [], ...(queue ?? {}), waiting: [...waiting, entry] };
}

/** Integrator's request branch: `crew/req/<identifier>`. Only branches of this shape are ever deleted on the remote. */
export const REQ_BRANCH_RE = /^crew\/req\/[A-Z][A-Z0-9]*-[0-9]+$/;
/** Executor's child branch: `crew/<identifier>`. */
export const CHILD_BRANCH_RE = /^crew\/[A-Z][A-Z0-9]*-[0-9]+$/;

/**
 * Reads `gh pr view --json state,mergeCommit,baseRefName,headRefName`. Returns {state:"merged", sha, base, head?} |
 * {state:"closed", head?} | {state:"open"} | {state:"error", reason}. `head` is present only when GitHub returned it.
 */
export function parsePrView(text) {
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    return { state: "error", reason: "gh pr view không trả JSON" };
  }
  if (j?.state === "OPEN") return { state: "open" };
  const head = typeof j?.headRefName === "string" ? { head: j.headRefName } : {};
  if (j?.state === "CLOSED") return { state: "closed", ...head };
  if (j?.state === "MERGED") {
    const sha = j.mergeCommit?.oid;
    if (typeof sha !== "string" || !SHA_RE.test(sha)) return { state: "error", reason: "PR đã merge nhưng thiếu mergeCommit.oid" };
    return { state: "merged", sha, base: typeof j.baseRefName === "string" ? j.baseRefName : null, ...head };
  }
  return { state: "error", reason: `state lạ: ${String(j?.state)}` };
}

/** Target recomputed from scratch, e.g. after dropping issues. */
export function queueTarget(issues, isAncestor) {
  return issues.reduce((q, i) => mergeQueue(q, i, isAncestor), { target: null, issues: [] }).target;
}

/** Changed files that only touch the Crew UI or docs need only the crew-web gates. */
export function needsFullGates(files) {
  if (!Array.isArray(files)) return true;
  return files.some((f) => !(f.startsWith("packages/crew-web/") || f.endsWith(".md")));
}

/** Masks anything that looks like a credential before it reaches a log or a comment. */
export function redact(text) {
  return String(text)
    .split("\n")
    .filter((l) => !/authorization|cookie|bearer|api[-_]?key|password|secret/i.test(l))
    .join("\n")
    .replace(/[A-Za-z][A-Za-z0-9+.-]*:\/\/[^@/\s]*@/g, "://***@")
    .replace(/(pcp_|gh[pousr]_|github_pat_|glpat-|sk-)[A-Za-z0-9_-]+/g, "$1***");
}

export const tail = (text, n) => String(text).trimEnd().split("\n").slice(-n).join("\n");

/** Reads `deploy.sh` output: rollback TS (printed on success and on the failures after the switch). */
export function parseDeployLog(text) {
  const ok = /^deploy ok: (\S+) -> (\S+), rollback TS=(\d{8}-\d{6})$/m.exec(text);
  if (ok) return { ok: true, prevImage: ok[1], newImage: ok[2], ts: ok[3] };
  const ts = /run ops\/rollback\.sh (\d{8}-\d{6})/.exec(text)?.[1] ?? null;
  return { ok: false, ts };
}

export const inspectProblems = (text, sha) => {
  const out = [];
  if (/MISSING|FAIL/.test(text)) out.push("inspect-image báo MISSING/FAIL");
  if (!/^issues crewCoreHooks=3$/m.test(text)) out.push("thiếu `issues crewCoreHooks=3`");
  if (!new RegExp(`^crew-ui=${sha}$`, "m").test(text)) out.push(`crew-ui trong image khác ${sha.slice(0, 9)}`);
  if (!/^RC 0$/m.test(text)) out.push("inspect-image.sh thoát khác 0");
  return out;
};

export const manifestLine = (text) => /^plugin bundle ok; manifest .*$/m.exec(text)?.[0] ?? null;

/** Post-deploy verdict from the probe results. */
export function postCheckFailures(p, sha) {
  const f = [];
  if (p.healthStatus !== "ok") f.push(`/api/health status=${p.healthStatus ?? "không đọc được"}`);
  if (p.healthCommit !== sha) f.push(`/api/health commit=${p.healthCommit ?? "?"} khác ${sha}`);
  if (p.plugin !== "healthy") f.push(`plugin crew.core: ${p.plugin || "không trả lời"}`);
  if (p.rootCode !== 200) f.push(`/ trả ${p.rootCode}`);
  if (p.paperclipCode !== 200) f.push(`/paperclip/ trả ${p.paperclipCode}`);
  if (p.uiCommit !== sha) f.push(`index.html crew-ui=${p.uiCommit ?? "?"}`);
  if (!(p.claimsOk > 0)) f.push("chưa có claim việc máy 2xx nào sau khi khởi động");
  return f;
}

const VN = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Ho_Chi_Minh",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});
export const vnTime = (d) => `${VN.format(d)} (giờ VN)`;

/** Comment body. The first line is machine-readable and never carries anything else. */
export function commentBody({ sha, status, lines = [] }) {
  if (!SHA_RE.test(sha)) throw new Error(`bad sha ${sha}`);
  if (!STATUSES.includes(status)) throw new Error(`bad status ${status}`);
  return redact([`crew-deploy sha=${sha} status=${status}`, "", ...lines].join("\n").trimEnd());
}

// ---------------------------------------------------------------------------------------------------------------
// Process plumbing

/** spawnSync wrapper: never throws; `out` is stdout+stderr, `stdout` alone; `code` 124 on timeout. */
export function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    ...opts,
  });
  const stdout = r.stdout ?? "";
  if (r.error && r.error.code === "ETIMEDOUT") return { code: 124, out: `${stdout}${r.stderr ?? ""}timeout`, stdout };
  if (r.error) return { code: 127, out: String(r.error.message), stdout };
  return { code: r.status ?? 1, out: `${stdout}${r.stderr ?? ""}`, stdout };
}

const sleepMs = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const shq = (s) => `'${String(s).replaceAll("'", "'\\''")}'`;

/** Runs a VPS helper command: the helper is streamed as a temp file and executed with stdin from /dev/null. */
export function vpsRunner(cfg, helperPath, runFn = run) {
  return (args, timeoutMs = 10 * MIN) => {
    const remote = `f=$(mktemp) && cat > "$f" && AUTO_DEPLOY_ROOT=${shq(cfg.root)} bash "$f" ${args
      .map(shq)
      .join(" ")} < /dev/null; rc=$?; rm -f "$f"; exit $rc`;
    return runFn(
      "ssh",
      ["-o", "BatchMode=yes", "-o", "ConnectTimeout=20", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=4", cfg.vps, remote],
      { input: readFileSync(helperPath), stdio: ["pipe", "pipe", "pipe"], timeout: timeoutMs },
    );
  };
}

/** Directory lock (mkdir is atomic); a lock whose owner pid is gone, or unreadable for a minute, is stale. */
function withLock(dir, fn) {
  const lock = path.join(dir, "lock");
  const pidFile = path.join(lock, "pid");
  for (let i = 0; ; i++) {
    try {
      mkdirSync(lock);
      writeFileSync(pidFile, String(process.pid));
      break;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      let stale;
      try {
        process.kill(Number(readFileSync(pidFile, "utf8")), 0);
        stale = false;
      } catch (err) {
        stale = err.code === "ESRCH" || (err.code === "ENOENT" && Date.now() - statSync(lock).mtimeMs > MIN);
      }
      if (stale) {
        releaseLock(lock);
        continue;
      }
      if (i > 300) throw new Error("hàng đợi deploy đang bị khóa quá 30 giây");
      sleepMs(100);
    }
  }
  try {
    return fn();
  } finally {
    releaseLock(lock);
  }
}

function releaseLock(lock) {
  for (const f of [() => unlinkSync(path.join(lock, "pid")), () => rmdirSync(lock)]) {
    try {
      f();
    } catch {
      // Already gone (another process released or stole it).
    }
  }
}

const readJson = (file, fallback) => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
};
const writeJson = (file, value) => {
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, file);
};

export const stateDirFor = (repoKey, dryRun, home = homedir()) =>
  path.join(home, ".crew", "auto-deploy", dryRun ? `${repoKey}-dry` : repoKey);
export const labelFor = (repoKey, dryRun) => `com.2p.crew.auto-deploy.${repoKey}${dryRun ? ".dry" : ""}`;

const xml = (s) => String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export function plistFor({ label, node, script, stateDir, env }) {
  const args = [node, script, "worker", "--state-dir", stateDir].map((a) => `<string>${xml(a)}</string>`).join("");
  const envXml = Object.entries(env)
    .map(([k, v]) => `<key>${xml(k)}</key><string>${xml(v)}</string>`)
    .join("");
  const log = path.join(stateDir, "worker.log");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${xml(label)}</string>
<key>ProgramArguments</key><array>${args}</array>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><false/>
<key>AbandonProcessGroup</key><true/>
<key>ProcessType</key><string>Background</string>
<key>WorkingDirectory</key><string>${xml(stateDir)}</string>
<key>EnvironmentVariables</key><dict>${envXml}</dict>
<key>StandardOutPath</key><string>${xml(log)}</string>
<key>StandardErrorPath</key><string>${xml(log)}</string>
</dict></plist>
`;
}

/** Minimal environment for the job: nothing from the agent run (no PAPERCLIP_*, no tokens). */
export function jobEnv(env) {
  const out = { PATH: env.PATH || "/usr/bin:/bin:/usr/sbin:/sbin", HOME: env.HOME || homedir(), LANG: env.LANG || "en_US.UTF-8" };
  if (env.SSH_AUTH_SOCK) out.SSH_AUTH_SOCK = env.SSH_AUTH_SOCK;
  return out;
}

function launchd(runFn = run) {
  const uid = process.getuid();
  const domain = runFn("launchctl", ["print", `gui/${uid}`]).code === 0 ? `gui/${uid}` : `user/${uid}`;
  return {
    domain,
    running(label) {
      const r = runFn("launchctl", ["print", `${domain}/${label}`]);
      return r.code === 0 && /^\s*state = running$/m.test(r.out);
    },
    start(label, plist) {
      runFn("launchctl", ["bootout", `${domain}/${label}`]);
      const r = runFn("launchctl", ["bootstrap", domain, plist]);
      if (r.code !== 0) throw new Error(`launchctl bootstrap ${domain} lỗi (rc ${r.code}): ${tail(redact(r.out), 3)}`);
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// enqueue

function git(repo, args, opts) {
  return run("git", ["-C", repo, ...args], opts);
}

export function enqueue(argv, env = process.env) {
  const a = parseArgs(argv);
  const repo = path.resolve(a.repo ?? process.cwd());
  const sha = a.sha ?? "";
  const issueId = a.issue ?? "";
  const dryRun = a["dry-run"] === true;
  const result = (code, status, lines, extra = {}) => ({ code, sha, body: status ? commentBody({ sha, status, lines }) : null, ...extra });
  if (!SHA_RE.test(sha)) return { code: 1, sha, body: null, error: "--sha phải là 40 hex" };
  if (!UUID_RE.test(issueId)) return { code: 1, sha, body: null, error: "--issue phải là uuid" };
  const pr = a.pr ?? null;
  if (pr !== null && !PR_URL_RE.test(pr)) return { code: 1, sha, body: null, error: "--pr phải là URL pull request GitHub" };
  if (a["simulate-merge-ok"] && !dryRun) return { code: 1, sha, body: null, error: "--simulate-merge-ok chỉ dùng với --dry-run" };

  const raw = git(repo, ["show", `${sha}:${CONFIG_PATH}`]);
  if (raw.code !== 0) return { code: 3, sha, body: null, error: `${CONFIG_PATH} không có ở ${sha.slice(0, 9)}: repo không bật deploy tự động` };
  let cfg;
  try {
    cfg = parseConfig(raw.stdout);
  } catch (e) {
    return result(1, "failed", [`Không xếp hàng deploy: ${e.message}.`]);
  }
  if (!cfg.enabled) return { code: 3, sha, body: null, error: `${CONFIG_PATH}: enabled=false` };
  if (a["max-wait-min"] !== undefined) {
    const m = Number(a["max-wait-min"]);
    if (!Number.isInteger(m) || m < 1 || m > 1440) return { code: 1, sha, body: null, error: "--max-wait-min sai" };
    cfg.maxWaitMinutes = m;
  }

  // A pull request is not merged yet: the worker checks the merge commit once GitHub reports it.
  if (pr === null) {
    const fetch = git(repo, ["fetch", "-q", "origin", cfg.branch], { timeout: 2 * MIN });
    if (fetch.code !== 0) return result(1, "failed", [`Không xếp hàng deploy: \`git fetch origin ${cfg.branch}\` lỗi (rc ${fetch.code}).`]);
    if (git(repo, ["merge-base", "--is-ancestor", sha, `origin/${cfg.branch}`]).code !== 0)
      return result(1, "failed", [`Không xếp hàng deploy: ${sha} không nằm trên \`origin/${cfg.branch}\`.`]);
  }
  const commonDir = git(repo, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (commonDir.code !== 0) return result(1, "failed", ["Không xếp hàng deploy: không đọc được thư mục git của repo."]);

  const home = env.HOME || homedir();
  const stateDir = stateDirFor(cfg.repoKey, dryRun, home);
  mkdirSync(path.join(stateDir, "bin"), { recursive: true, mode: 0o700 });
  const label = labelFor(cfg.repoKey, dryRun);
  const isAncestor = (x, y) => x === y || git(repo, ["merge-base", "--is-ancestor", x, y]).code === 0;
  const ld = launchd();
  let started = false;
  try {
    withLock(stateDir, () => {
      const current = readJson(path.join(stateDir, "queue.json"), { target: null, issues: [] });
      const at = new Date().toISOString();
      const queue = pr === null ? mergeQueue(current, { issueId, sha, at }, isAncestor) : addWaiting(current, { issueId, sha, pr, at });
      writeJson(path.join(stateDir, "queue.json"), queue);
      // A live worker re-reads the queue before it exits (under this same lock), unless it already said it is exiting.
      const status = readJson(path.join(stateDir, "status.json"), {});
      if (status.state !== "exiting" && ld.running(label)) return;
      // Fresh copies from the approved commit, so a later checkout of the agent worktree cannot change a running job.
      for (const f of ["auto-deploy.mjs", "auto-deploy-vps.sh"]) {
        const src = git(repo, ["show", `${sha}:crew/ops/${f}`]);
        if (src.code !== 0) throw new Error(`thiếu crew/ops/${f} ở ${sha.slice(0, 9)}`);
        const dst = path.join(stateDir, "bin", f);
        writeFileSync(`${dst}.tmp`, src.stdout, { mode: 0o700 });
        renameSync(`${dst}.tmp`, dst);
      }
      writeJson(path.join(stateDir, "job.json"), {
        config: cfg,
        gitDir: commonDir.stdout.trim(),
        dryRun,
        simulateMergeOk: a["simulate-merge-ok"] === true,
        label,
      });
      writeJson(path.join(stateDir, "status.json"), { state: "starting", updatedAt: new Date().toISOString() });
      const plist = path.join(stateDir, `${label}.plist`);
      writeFileSync(plist, plistFor({ label, node: process.execPath, script: path.join(stateDir, "bin", "auto-deploy.mjs"), stateDir, env: jobEnv(env) }), { mode: 0o600 });
      ld.start(label, plist);
      started = true;
    });
  } catch (e) {
    return result(1, "failed", [`Không xếp hàng deploy: ${e.message}.`]);
  }
  const job = `Job chạy riêng trên Mac mini (launchd \`${label}\`, ${started ? "vừa khởi động" : "đang chạy, sẽ lấy yêu cầu này"})`;
  const pipeline = `kiểm (test/typecheck/biome; thêm verify.sh khi đổi server), build image, chờ hết run đang chạy (tối đa ${cfg.maxWaitMinutes} phút), deploy, kiểm sau deploy (tự rollback nếu xấu) rồi báo kết quả tại đây.`;
  const lines = [
    `Đã xếp hàng deploy tự động lên prod (${cfg.publicUrl}) lúc ${vnTime(new Date())}${dryRun ? " — CHẠY THỬ (dry-run), không deploy thật" : ""}.`,
    ...(pr === null
      ? [`${job}: ${pipeline.replace("build image", `build image \`crew-v3/paperclip:v3-${sha.slice(0, 9)}\``)}`]
      : [
          `Chưa deploy: job chờ pull request ${pr} được merge vào \`${cfg.branch}\` (hỏi GitHub mỗi ${PR_POLL_MS / MIN} phút, tối đa ${PR_MAX_WAIT_MS / 60 / MIN} giờ).`,
          `${job}: khi PR đã merge thì deploy đúng merge commit trên \`${cfg.branch}\`: ${pipeline}`,
          `PR đóng mà không merge thì job dừng với \`status=cancelled\`; quá ${PR_MAX_WAIT_MS / 60 / MIN} giờ chưa merge thì báo \`status=failed\`.`,
        ]),
    "Có commit mới hơn được duyệt trong lúc chờ thì chỉ deploy bản mới nhất một lần.",
  ];
  return result(0, "queued", lines, { stateDir, label, started });
}

// ---------------------------------------------------------------------------------------------------------------
// worker

/** Thrown to restart the loop: a newer commit was queued, or some issues were dropped. */
export class Superseded extends Error {}

/**
 * The deploy loop. `deps` makes every side effect injectable for tests:
 *   sh(cmd, args, opts) -> {code, out}      local commands (git, pnpm, curl, overlay-source.sh)
 *   vps(args, timeoutMs) -> {code, out}     VPS helper
 *   now() -> Date, sleep(ms), log(line)
 *   readQueue() / writeQueue(q) / setStatus(obj) / withLock(fn) / appendHistory(obj)
 */
export function workerLoop(job, deps) {
  const cfg = job.config;
  const dry = job.dryRun === true;
  const wt = expandHome(cfg.worktree, deps.home);
  const tag = (sha) => `crew-v3/paperclip:v3-${sha.slice(0, 9)}`;
  const gitWt = (args, opts) => deps.sh("git", ["-C", wt, ...args], opts);
  const gitDir = (args, opts) => deps.sh("git", [`--git-dir=${job.gitDir}`, ...args], opts);
  const isAncestor = (x, y) => x === y || gitDir(["merge-base", "--is-ancestor", x, y]).code === 0;
  const step = (name, msg) => {
    deps.log(`${name}: ${msg}`);
    deps.setStatus({ state: "running", step: name, message: msg });
  };
  const would = (what) => deps.log(`DRY-RUN: sẽ chạy ${what}`);
  const checkSuperseded = (sha) => {
    const q = deps.readQueue();
    if (q.target && q.target !== sha && isAncestor(sha, q.target)) throw new Superseded(q.target);
  };

  /** Posts (or, in dry-run, prints) one comment per issue. Never throws. */
  const report = (issues, sha, status, lines) => {
    for (const issue of issues) {
      const own = [];
      if (issue.sha !== sha) own.push("", `Commit được duyệt của yêu cầu này: \`${issue.sha}\` (nằm trong bản trên).`);
      if (issue.pr && issue.approvedSha)
        own.push("", `Pull request ${issue.pr} đã merge thành \`${issue.sha}\`; commit owner duyệt: \`${issue.approvedSha}\`.`);
      const body = commentBody({ sha, status, lines: [...lines, ...own] });
      if (dry) {
        deps.log(`DRY-RUN: sẽ comment lên issue ${issue.issueId}:\n${body}\n--- hết comment ---`);
        continue;
      }
      const r = deps.vps(["comment", issue.issueId, cfg.publicUrl, Buffer.from(body, "utf8").toString("base64")], 2 * MIN);
      deps.log(`comment ${issue.issueId}: rc ${r.code} ${tail(redact(r.out), 2).replaceAll("\n", " | ")}`);
    }
    deps.appendHistory({ at: deps.now().toISOString(), sha, status, issues: issues.map((i) => i.issueId), dryRun: dry });
  };

  /**
   * Best-effort branch cleanup after a pull request ended. Deletes the request branch `crew/req/<id>` on origin and
   * locally, and (merged only) the local child branches `crew/<id>` whose tip is already inside the merge commit.
   * Never deletes a branch checked out in any worktree and never throws or changes deploy state: failures are logged.
   */
  const cleanupBranches = (pr, view) => {
    try {
      const head = view.head;
      const checkedOut = new Set();
      const wl = gitDir(["worktree", "list", "--porcelain"]);
      for (const line of String(wl.stdout ?? wl.out ?? "").split("\n")) if (line.startsWith("branch refs/heads/")) checkedOut.add(line.slice("branch refs/heads/".length).trim());
      const dropLocal = (name) => {
        if (checkedOut.has(name)) return deps.log(`PR ${pr}: giữ nhánh local ${name} (đang checkout ở một worktree)`);
        if (gitDir(["show-ref", "--verify", "--quiet", `refs/heads/${name}`]).code !== 0) return;
        if (dry) return would(`git branch -D ${name}`);
        const d = gitDir(["branch", "-D", name]);
        deps.log(`PR ${pr}: xóa nhánh local ${name}: rc ${d.code}`);
      };
      if (typeof head === "string" && REQ_BRANCH_RE.test(head)) {
        if (dry) would(`git push origin --delete ${head}`);
        else {
          const r = gitDir(["push", "origin", "--delete", head], { timeout: 2 * MIN });
          deps.log(`PR ${pr}: xóa nhánh remote ${head}: rc ${r.code} ${tail(redact(r.out), 1).replaceAll("\n", " | ")}`);
        }
        dropLocal(head);
      } else if (head) deps.log(`PR ${pr}: không xóa nhánh ${head} (không theo mẫu crew/req/<id>)`);
      if (view.state === "merged") {
        const list = gitDir(["for-each-ref", "--format=%(refname:short)", "refs/heads/crew/"]);
        for (const name of String(list.stdout ?? list.out ?? "").split("\n").map((n) => n.trim())) {
          if (CHILD_BRANCH_RE.test(name) && isAncestor(name, view.sha)) dropLocal(name);
        }
      }
    } catch (e) {
      deps.log(`PR ${pr}: dọn nhánh lỗi: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  /** Pull requests the integrator opened: ask GitHub, queue the merged ones, end the closed and too-old ones. */
  let lastPrPoll = null;
  const pollPullRequests = () => {
    const waiting = deps.readQueue().waiting ?? [];
    if (waiting.length === 0) return;
    if (lastPrPoll !== null && deps.now().getTime() - lastPrPoll < PR_POLL_MS) return;
    lastPrPoll = deps.now().getTime();
    const outcomes = waiting.map((entry) => {
      const r = deps.sh("gh", ["pr", "view", entry.pr, "--json", "state,mergeCommit,baseRefName,headRefName"], { timeout: 2 * MIN });
      const view = r.code === 0 ? parsePrView(r.stdout ?? r.out) : { state: "error", reason: `gh pr view lỗi (rc ${r.code}): ${tail(redact(r.out), 2).replaceAll("\n", " | ")}` };
      if (view.state === "error") deps.log(`PR ${entry.pr}: ${view.reason}`);
      const age = deps.now().getTime() - new Date(entry.at).getTime();
      return { entry, view, expired: !(age < PR_MAX_WAIT_MS) };
    });
    if (outcomes.some((o) => o.view.state === "merged")) gitDir(["fetch", "-q", "origin", cfg.branch], { timeout: 5 * MIN });
    const finished = [];
    const cleanups = [];
    deps.withLock(() => {
      let q = deps.readQueue();
      for (const o of outcomes) {
        const { entry, view } = o;
        const still = (q.waiting ?? []).some((w) => w.issueId === entry.issueId && w.pr === entry.pr && w.sha === entry.sha);
        if (!still) continue; // replaced by a newer enqueue in the meantime
        let end = null;
        if (view.state === "merged" && view.base === cfg.branch) {
          q = mergeQueue(q, { issueId: entry.issueId, sha: view.sha, approvedSha: entry.sha, pr: entry.pr, at: deps.now().toISOString() }, isAncestor);
          deps.log(`PR ${entry.pr} đã merge: xếp hàng ${view.sha.slice(0, 9)}`);
        } else if (view.state === "merged")
          end = ["failed", [`Pull request ${entry.pr} được merge vào \`${view.base ?? "?"}\`, không phải nhánh deploy \`${cfg.branch}\`: không deploy.`]];
        else if (view.state === "closed") end = ["cancelled", [`Pull request ${entry.pr} đã đóng mà không merge: không deploy.`]];
        else if (o.expired)
          end = ["failed", [
            `Pull request ${entry.pr} chưa merge sau ${PR_MAX_WAIT_MS / 60 / MIN} giờ: job thôi chờ, không deploy.`,
            ...(view.state === "error" ? [`Lần hỏi GitHub cuối lỗi: ${view.reason}.`] : []),
            "Merge sau thời điểm này thì foreman deploy tay.",
          ]];
        else continue;
        if (view.state === "merged" || view.state === "closed") cleanups.push({ pr: entry.pr, view });
        if (end) finished.push({ entry, status: end[0], lines: end[1] });
        q = { ...q, waiting: (q.waiting ?? []).filter((w) => !(w.issueId === entry.issueId && w.pr === entry.pr && w.sha === entry.sha)) };
      }
      deps.writeQueue(q);
    });
    for (const c of cleanups) cleanupBranches(c.pr, c.view);
    for (const f of finished) report([{ issueId: f.entry.issueId, sha: f.entry.sha }], f.entry.sha, f.status, [...f.lines, "Prod giữ nguyên bản đang chạy."]);
  };

  for (;;) {
    pollPullRequests();
    const batch = deps.withLock(() => {
      const q = deps.readQueue();
      if (q.target && q.issues.length > 0) return q;
      const waiting = q.waiting ?? [];
      if (waiting.length > 0) {
        deps.setStatus({ state: "waiting", step: "chờ PR merge", message: waiting.map((w) => w.pr).join(" ") });
        return "wait";
      }
      deps.setStatus({ state: "exiting", step: "idle", message: "hàng đợi trống" });
      return null;
    });
    if (!batch) return;
    if (batch === "wait") {
      deps.sleep(Math.max(1000, PR_POLL_MS - (deps.now().getTime() - lastPrPoll)));
      continue;
    }
    const sha = batch.target;
    const covered = batch.issues.filter((i) => isAncestor(i.sha, sha));
    const drop = (issues) =>
      deps.withLock(() => {
        const q = deps.readQueue();
        const left = q.issues.filter((i) => !issues.some((d) => d.issueId === i.issueId && d.sha === i.sha));
        deps.writeQueue({ ...q, target: queueTarget(left, isAncestor), issues: left });
      });
    const fail = (issues, reason, extra = []) => {
      deps.log(`THẤT BẠI ${sha.slice(0, 9)}: ${reason}`);
      report(issues, sha, "failed", [`Deploy tự động không thực hiện: ${reason}`, "Prod giữ nguyên bản đang chạy.", ...extra]);
      drop(issues);
    };
    try {
      deployOne(sha, covered);
    } catch (e) {
      if (e instanceof Superseded) {
        deps.log(`lập lại kế hoạch (đích mới ${e.message.slice(0, 9)})`);
        continue;
      }
      fail(covered, `lỗi không lường trước: ${redact(e.message)}`);
    }
    function deployOne(sha, issues) {
      // 1. The commit must be on origin/<branch>, and every issue must carry the integrator's push line.
      step("kiểm commit", `${sha} cho ${issues.length} yêu cầu`);
      const f = gitDir(["fetch", "-q", "origin", cfg.branch], { timeout: 5 * MIN });
      if (f.code !== 0) return fail(issues, `\`git fetch origin ${cfg.branch}\` lỗi (rc ${f.code}).`);
      if (!isAncestor(sha, `origin/${cfg.branch}`)) return fail(issues, `${sha} không nằm trên \`origin/${cfg.branch}\`.`);
      const unverified = [];
      for (const issue of issues) {
        if (job.simulateMergeOk) {
          deps.log(`DRY-RUN: bỏ kiểm crew-merge của ${issue.issueId} (--simulate-merge-ok)`);
          continue;
        }
        const r = deps.vps(["comments", issue.issueId], 2 * MIN);
        const want = issue.pr
          ? `crew-merge sha=${issue.approvedSha} branch=${cfg.branch} pushed=pr pr=${issue.pr}`
          : `crew-merge sha=${issue.sha} branch=${cfg.branch} pushed=yes`;
        const ok = r.code === 0 && r.out.split("\n").some((l) => {
          const [author, first] = l.split("\t");
          return author && author !== "-" && first === want;
        });
        if (!ok) unverified.push(issue);
      }
      if (unverified.length > 0) {
        fail(unverified, `không thấy comment \`crew-merge sha=<sha> branch=${cfg.branch} pushed=yes\` (hoặc \`pushed=pr pr=<url>\` khớp pull request) của agent trên issue (hoặc không đọc được comment).`);
        if (unverified.length === issues.length) return;
        throw new Superseded(sha); // re-plan with the verified issues only
      }

      // 2. What runs now. A target already inside the running commit needs no deploy.
      const health = probeHealth();
      const running = health.commit;
      if (running && SHA_RE.test(running) && isAncestor(sha, running)) {
        step("đã có", `${sha.slice(0, 9)} đã nằm trong bản đang chạy ${running.slice(0, 9)}`);
        report(issues, running, "deployed", [`Commit đã nằm trong bản đang chạy trên prod (\`${running}\`), không cần deploy lại.`]);
        return drop(issues);
      }
      if (running && SHA_RE.test(running) && gitDir(["cat-file", "-e", `${running}^{commit}`]).code === 0 && !isAncestor(running, sha))
        return fail(issues, `bản đang chạy \`${running}\` không phải tổ tiên của ${sha}: deploy sẽ làm mất thay đổi, cần foreman xử lý tay.`);
      let files = null;
      if (running && SHA_RE.test(running)) {
        const d = gitDir(["diff", "--name-only", running, sha]);
        if (d.code === 0) files = d.out.split("\n").filter(Boolean);
      }
      const full = needsFullGates(files);

      // 3. Deploy worktree on exactly this commit, clean.
      step("worktree", `${wt} @ ${sha.slice(0, 9)}`);
      if (dry) would(`git worktree add/checkout --detach ${sha} trong ${wt}; corepack pnpm install --frozen-lockfile`);
      else {
        if (!existsSync(wt)) {
          const add = gitDir(["worktree", "add", "--detach", wt, sha], { timeout: 5 * MIN });
          if (add.code !== 0) return fail(issues, `không tạo được worktree deploy ${wt}: ${tail(redact(add.out), 3)}`);
        }
        const dirty = gitWt(["status", "--porcelain"]);
        if (dirty.code !== 0 || dirty.out.trim() !== "") return fail(issues, `worktree deploy ${wt} bẩn hoặc lỗi; cần foreman dọn tay.`);
        const co = gitWt(["checkout", "-q", "--detach", sha]);
        if (co.code !== 0) return fail(issues, `không checkout được ${sha} trong ${wt}.`);
        const inst = deps.sh("corepack", ["pnpm", "install", "--frozen-lockfile"], { cwd: wt, timeout: 30 * MIN });
        if (inst.code !== 0) return fail(issues, `\`pnpm install --frozen-lockfile\` lỗi (rc ${inst.code}).`, ["```", tail(redact(inst.out), 15), "```"]);
      }
      checkSuperseded(sha);

      // 4. Gates, like the manual deploys.
      const gates = [
        ["crew-web test", "corepack", ["pnpm", "--filter", "@crew/paperclip-web", "test"]],
        ["crew-web typecheck", "corepack", ["pnpm", "--filter", "@crew/paperclip-web", "typecheck"]],
        ["crew-web biome", "corepack", ["pnpm", "--filter", "@crew/paperclip-web", "exec", "biome", "check", "src", "test", "e2e"]],
      ];
      if (full)
        gates.push(
          ["verify.sh", "bash", ["crew/release/verify.sh"]],
          ["ops test", "sh", ["-c", "node --test crew/ops/*.test.mjs"]],
        );
      const passed = [];
      for (const [name, cmd, args] of gates) {
        step("cổng kiểm", name);
        if (dry) {
          would(`${cmd} ${args.join(" ")} (cwd ${wt})`);
          continue;
        }
        const g = deps.sh(cmd, args, { cwd: wt, timeout: 45 * MIN });
        if (g.code !== 0) return fail(issues, `cổng kiểm \`${name}\` đỏ (rc ${g.code}).`, ["```", tail(redact(g.out), 20), "```"]);
        passed.push(name);
        checkSuperseded(sha);
      }

      // 5. Image: reuse when already built, else overlay-source.sh (uploads) + overlay-job.sh on the VPS.
      step("build", tag(sha));
      const have = deps.vps(["image", tag(sha)]);
      if (have.code !== 0) return fail(issues, `không hỏi được image trên VPS (rc ${have.code}).`);
      if (have.out.trim() !== "present") {
        if (dry) would(`crew/ops/overlay-source.sh ${sha} rồi ssh ${cfg.vps} ops/overlay-job.sh ${sha.slice(0, 9)}`);
        else {
          const src = deps.sh("bash", ["crew/ops/overlay-source.sh", sha], { cwd: wt, timeout: 30 * MIN });
          if (src.code !== 0) return fail(issues, `overlay-source.sh lỗi (rc ${src.code}).`, ["```", tail(redact(src.out), 15), "```"]);
          const job2 = deps.vps(["build", sha.slice(0, 9)], 45 * MIN);
          if (job2.code !== 0 || !/^RC 0$/m.test(job2.out))
            return fail(issues, "overlay-job.sh trên VPS lỗi.", ["```", tail(redact(job2.out), 15), "```"]);
        }
      }
      checkSuperseded(sha);

      // 6. Inspect the new image, and refuse new plugin capabilities (they need a manual look).
      step("inspect", tag(sha));
      let newManifest = null;
      if (dry && have.out.trim() !== "present") would(`ops/inspect-image.sh ${tag(sha)}`);
      else {
        const ins = deps.vps(["inspect", tag(sha)]);
        const problems = inspectProblems(ins.out, sha);
        if (ins.code !== 0 || problems.length > 0)
          return fail(issues, `inspect-image: ${problems.join("; ") || `rc ${ins.code}`}.`, ["```", tail(redact(ins.out), 15), "```"]);
        newManifest = manifestLine(ins.out);
        const cur = deps.vps(["current-image"]);
        const curTag = cur.out.trim();
        if (cur.code === 0 && /^crew-v3\/paperclip:v3-[0-9a-f]{9}$/.test(curTag) && curTag !== tag(sha)) {
          const old = deps.vps(["inspect", curTag]);
          const oldManifest = manifestLine(old.out);
          if (!oldManifest || !newManifest || oldManifest !== newManifest)
            return fail(issues, `dòng \`manifest crew.core\` của image mới khác ${curTag} (capability đổi hoặc không đọc được): cần foreman deploy tay.`);
        }
      }

      // 7. Wait for a gap in the runs, then deploy.sh detached on the VPS (it re-checks runs itself: rc 2).
      const id = `${sha.slice(0, 9)}-${Math.floor(deps.now().getTime() / 1000)}`;
      const waitStart = deps.now().getTime();
      let lastBusy = "";
      let deploy = null;
      for (;;) {
        const left = cfg.maxWaitMinutes * MIN - (deps.now().getTime() - waitStart);
        if (left <= 0)
          return fail(issues, `chờ ${cfg.maxWaitMinutes} phút vẫn còn run đang chạy, bỏ lượt này.`, [
            `Image \`${tag(sha)}\` đã build trên VPS: foreman deploy tay khi rảnh bằng \`ssh ${cfg.vps} ${cfg.root}/ops/deploy.sh ${tag(sha)}\`.`,
            ...(lastBusy ? ["Run còn chạy lúc bỏ:", "```", lastBusy, "```"] : []),
          ]);
        step("chờ hết run", `còn tối đa ${Math.ceil(left / MIN)} phút`);
        if (dry) {
          const ar = deps.vps(["active-runs"]);
          if (ar.code === 0 && ar.out.trim() === "") {
            would(`ssh ${cfg.vps} ops/deploy.sh ${tag(sha)} (đang không có run nào)`);
            deploy = { dry: true };
            break;
          }
          lastBusy = tail(redact(ar.out), 5);
          deps.log(`còn run: ${lastBusy.replaceAll("\n", " | ")}`);
          deps.sleep(Math.min(60_000, left));
          checkSuperseded(sha);
          continue;
        }
        const chunk = Math.max(1, Math.min(600, Math.floor(left / 1000)));
        const w = deps.vps(["deploy-when-idle", tag(sha), String(chunk), id], (chunk + 120) * 1000);
        if (w.code === 0 && /^STARTED /m.test(w.out)) {
          deploy = waitDeploy(id);
          if (deploy.rc === 2) {
            deps.log("deploy.sh từ chối vì có run vừa bắt đầu (rc 2), chờ tiếp");
            continue;
          }
          break;
        }
        if (w.code === 0 && /^(BUSY|LOCKED)/m.test(w.out)) lastBusy = tail(redact(w.out), 6);
        else {
          lastBusy = `lỗi hỏi VPS (rc ${w.code}): ${tail(redact(w.out), 3)}`;
          deps.sleep(30_000);
        }
        checkSuperseded(sha);
      }

      // 8. Outcome of deploy.sh, post-checks, rollback.
      if (deploy.dry) {
        const p = probeAll();
        deps.log(`DRY-RUN: kiểm sau deploy trên bản đang chạy (mong ${sha.slice(0, 9)}): ${JSON.stringify(p)}`);
        report(issues, sha, "deployed", [
          "DRY-RUN: không deploy thật. Đây là comment sẽ đăng khi deploy và kiểm sau deploy đều đạt.",
          `Cổng kiểm: ${gates.map((g) => g[0]).join(", ")}${full ? "" : " (chỉ đổi crew-web/docs nên không chạy verify.sh)"}.`,
          `Rollback: \`ssh ${cfg.vps} ${cfg.root}/ops/rollback.sh <TS>\`.`,
        ]);
        return drop(issues);
      }
      const parsed = parseDeployLog(deploy.out);
      if (deploy.rc !== 0) {
        const lines = ["```", tail(redact(deploy.out), 15), "```"];
        if (deploy.rc === 124) return fail(issues, "deploy.sh chưa xong sau 30 phút; cần foreman kiểm tay trên VPS (không tự rollback khi chưa rõ trạng thái).", lines);
        if ([3, 6, 8].includes(deploy.rc) && parsed.ts) return rollback(issues, parsed.ts, `deploy.sh thoát ${deploy.rc}`, lines);
        return fail(issues, `deploy.sh thoát ${deploy.rc} trước khi đổi server.`, lines);
      }
      if (!parsed.ok) return fail(issues, "deploy.sh thoát 0 nhưng không in dòng `deploy ok … rollback TS=…`; cần foreman kiểm tay.", ["```", tail(redact(deploy.out), 15), "```"]);
      let probe = null;
      let failures = [];
      const until = deps.now().getTime() + 3 * MIN;
      for (;;) {
        probe = probeAll();
        failures = postCheckFailures(probe, sha);
        if (failures.length === 0 || deps.now().getTime() >= until) break;
        deps.sleep(15_000);
      }
      if (failures.length > 0) return rollback(issues, parsed.ts, `kiểm sau deploy xấu: ${failures.join("; ")}`, []);
      step("xong", `đã deploy ${sha.slice(0, 9)}`);
      report(issues, sha, "deployed", [
        `Đã deploy \`${parsed.newImage}\` lên prod (${cfg.publicUrl}) lúc ${vnTime(deps.now())}; bản trước \`${parsed.prevImage}\`.`,
        "",
        "| Kiểm | Kết quả |",
        "|---|---|",
        `| Cổng kiểm | ${passed.join(", ")}${full ? "" : " (chỉ đổi crew-web/docs)"} |`,
        `| /api/health | ok, commit \`${probe.healthCommit}\` |`,
        `| plugin crew.core | ${probe.plugin} |`,
        `| / và /paperclip/ | ${probe.rootCode} / ${probe.paperclipCode} |`,
        `| crew-ui trong index.html | \`${probe.uiCommit}\` |`,
        `| Claim việc máy sau khởi động | ${probe.claimsOk} lần 2xx, ${probe.claims5xx} lần 5xx |`,
        `| Log mức lỗi sau khởi động | ${probe.errors} dòng |`,
        "",
        `Rollback: \`ssh ${cfg.vps} ${cfg.root}/ops/rollback.sh ${parsed.ts}\` (về \`${parsed.prevImage}\`).`,
      ]);
      return drop(issues);
    }

    function rollback(issues, ts, reason, extra) {
      step("rollback", `${ts}: ${reason}`);
      const r = deps.vps(["rollback", ts], 10 * MIN);
      const ok = r.code === 0 && /^RC 0$/m.test(r.out);
      const lines = [
        `Deploy tự động ${sha} lỗi: ${reason}.`,
        ok ? `Đã tự rollback (\`ops/rollback.sh ${ts}\`), server về bản trước.` : `**Rollback \`ops/rollback.sh ${ts}\` cũng lỗi: cần foreman xử lý ngay.**`,
        ...extra,
        "Output rollback:",
        "```",
        tail(redact(r.out), 10),
        "```",
      ];
      report(issues, sha, ok ? "rolled_back" : "failed", lines);
      drop(issues);
    }

    function waitDeploy(id) {
      const end = deps.now().getTime() + 30 * MIN;
      for (;;) {
        deps.sleep(10_000);
        const s = deps.vps(["deploy-status", id], 2 * MIN);
        const m = /^RC (\d+)$/m.exec(s.out);
        if (s.code === 0 && m) return { rc: Number(m[1]), out: s.out };
        if (deps.now().getTime() > end) return { rc: 124, out: `deploy.sh chưa xong sau 30 phút\n${s.out}` };
      }
    }

    function probeHealth() {
      const h = deps.sh("curl", ["-sS", "--max-time", "15", `${cfg.publicUrl}/api/health`]);
      try {
        const j = JSON.parse(h.out);
        return { status: j.status ?? null, commit: typeof j.commit === "string" ? j.commit : null };
      } catch {
        return { status: null, commit: null };
      }
    }

    function probeAll() {
      const health = probeHealth();
      const code = (url) => Number(deps.sh("curl", ["-sS", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "15", url]).out.trim()) || 0;
      const index = deps.sh("curl", ["-sS", "--max-time", "15", `${cfg.publicUrl}/`]).out;
      const claims = deps.vps(["claims"]).out;
      const num = (k) => Number(new RegExp(`${k}=(\\d+)`).exec(claims)?.[1] ?? -1);
      return {
        healthStatus: health.status,
        healthCommit: health.commit,
        plugin: deps.vps(["plugin-state"]).out.trim().split("\n")[0] ?? "",
        rootCode: code(`${cfg.publicUrl}/`),
        paperclipCode: code(`${cfg.publicUrl}/paperclip/`),
        uiCommit: /name="crew-ui" content="([0-9a-f]{40})"/.exec(index)?.[1] ?? null,
        claimsOk: num("claims_ok"),
        claims5xx: num("claims_5xx"),
        errors: num("errors"),
      };
    }
  }
}

export function worker(argv) {
  const a = parseArgs(argv);
  const stateDir = a["state-dir"];
  if (!stateDir) throw new Error("--state-dir là bắt buộc");
  const job = readJson(path.join(stateDir, "job.json"), null);
  if (!job) throw new Error(`thiếu ${stateDir}/job.json`);
  const helper = path.join(stateDir, "bin", "auto-deploy-vps.sh");
  const logLine = (line) => process.stdout.write(`${vnTime(new Date())} ${redact(line)}\n`);
  const lockFn = (fn) => withLock(stateDir, fn);
  const setStatus = (s) => writeJson(path.join(stateDir, "status.json"), { ...s, pid: process.pid, updatedAt: new Date().toISOString() });
  lockFn(() => setStatus({ state: "running", step: "start", message: job.dryRun ? "dry-run" : "live" }));
  logLine(`worker bắt đầu (pid ${process.pid}, ppid ${process.ppid}, pgid ${run("ps", ["-o", "pgid=", "-p", String(process.pid)]).out.trim()}, PAPERCLIP_RUN_ID ${process.env.PAPERCLIP_RUN_ID ? "CÓ" : "không có"}, ${job.dryRun ? "dry-run" : "live"})`);
  try {
    workerLoop(job, {
      home: process.env.HOME || homedir(),
      sh: run,
      vps: vpsRunner(job.config, helper),
      now: () => new Date(),
      sleep: sleepMs,
      log: logLine,
      readQueue: () => readJson(path.join(stateDir, "queue.json"), { target: null, issues: [] }),
      writeQueue: (q) => writeJson(path.join(stateDir, "queue.json"), q),
      setStatus,
      withLock: lockFn,
      appendHistory: (h) => appendFileSync(path.join(stateDir, "history.jsonl"), `${JSON.stringify(h)}\n`, { mode: 0o600 }),
    });
  } catch (e) {
    logLine(`worker dừng vì lỗi: ${e.message}`);
    lockFn(() => setStatus({ state: "exiting", step: "error", message: redact(e.message) }));
    process.exitCode = 1;
  }
  logLine("worker kết thúc");
}

// ---------------------------------------------------------------------------------------------------------------
// CLI

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (!t.startsWith("--")) throw new Error(`tham số lạ: ${t}`);
    const key = t.slice(2);
    if (["dry-run", "simulate-merge-ok"].includes(key)) out[key] = true;
    else {
      const v = argv[++i];
      if (v === undefined) throw new Error(`thiếu giá trị cho ${t}`);
      out[key] = v;
    }
  }
  return out;
}

function main(argv) {
  const [cmd, ...rest] = argv;
  if (cmd === "enqueue") {
    const a = parseArgs(rest);
    const r = enqueue(rest);
    if (r.body && a["body-out"]) writeFileSync(a["body-out"], JSON.stringify({ body: r.body }));
    if (r.body) process.stdout.write(`${r.body}\n`);
    if (r.error) process.stderr.write(`auto-deploy: ${r.error}\n`);
    return r.code;
  }
  if (cmd === "worker") {
    worker(rest);
    return process.exitCode ?? 0;
  }
  if (cmd === "status") {
    const a = parseArgs(rest);
    const dir = stateDirFor(a["repo-key"] ?? "paperclip", a["dry-run"] === true);
    for (const f of ["status.json", "queue.json"]) process.stdout.write(`${f}: ${existsSync(path.join(dir, f)) ? readFileSync(path.join(dir, f), "utf8") : "(chưa có)\n"}`);
    return 0;
  }
  process.stderr.write("usage: auto-deploy.mjs enqueue|worker|status …\n");
  return 2;
}

/** True when this file is the entry script. Real paths: mktemp -d on macOS is /var/… while the module URL is /private/var/…. */
function isMain() {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`auto-deploy: ${e.message}\n`);
    process.exitCode = 1;
  }
}

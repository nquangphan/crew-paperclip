import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildOwnerTerminalCommand } from "../crew/terminal/remote-command.js";

describe("buildOwnerTerminalCommand", () => {
  it("dựng worktree owner và gắn phiên tmux", () => {
    const cmd = buildOwnerTerminalCommand({ projectKey: "kidy-school", branch: "main" });
    expect(cmd.startsWith("exec /bin/zsh -lc ")).toBe(true);
    expect(cmd).toContain('"$tmux" -L crew');
    expect(cmd).toContain("new-session -A -s crew-owner-kidy-school");
    expect(cmd).toContain("worktree add -b owner/kidy-school");
    expect(cmd).toContain("origin/main");
    expect(cmd).toContain("unset PAPERCLIP_RUN_ID");
  });

  it.each(["Kidy", "a;rm -rf ~", "a", "1abc", ""])("từ chối khóa project %j", (projectKey) => {
    expect(() => buildOwnerTerminalCommand({ projectKey, branch: "main" })).toThrow();
  });

  it.each(["main;id", "$(id)", "a b", "../x", "a/../b", ""])("từ chối nhánh %j", (branch) => {
    expect(() => buildOwnerTerminalCommand({ projectKey: "kidy-school", branch })).toThrow();
  });

  it("không thấy tmux trong PATH thì thử /opt/homebrew/bin rồi /usr/local/bin và chạy đúng đường dẫn tìm được", () => {
    const cmd = buildOwnerTerminalCommand({ projectKey: "kidy-school", branch: "main" });
    const brew = cmd.indexOf("/opt/homebrew/bin/tmux");
    const local = cmd.indexOf("/usr/local/bin/tmux");
    expect(brew).toBeGreaterThan(-1);
    expect(local).toBeGreaterThan(brew);
    expect(cmd).toContain('exec "$tmux" -L crew');
    expect(cmd).not.toMatch(/exec tmux /);
  });

  it("dựng lại worktree owner sau khi thư mục owner bị xoá tay", () => {
    expect(buildOwnerTerminalCommand({ projectKey: "kidy-school", branch: "main" })).toContain('git -C "$repo" worktree prune');
  });

  it("không biết nhánh thì dựng worktree owner từ origin/HEAD", () => {
    const cmd = buildOwnerTerminalCommand({ projectKey: "kidy-school", branch: null });
    expect(cmd).toContain("worktree add -b owner/kidy-school");
    expect(cmd).toContain("origin/HEAD");
    expect(cmd).not.toContain("origin null");
    expect(cmd).not.toContain("origin/null");
  });
});

/** Chạy lệnh terminal như kênh SSH: `/bin/sh -c`, HOME và PATH tạm. */
function runOwnerCommand(home: string, pathEnv: string, branch: string | null = "main") {
  const cmd = buildOwnerTerminalCommand({ projectKey: "kidy-school", branch });
  return spawnSync("/bin/sh", ["-c", cmd], { env: { HOME: home, PATH: pathEnv }, encoding: "utf8" });
}

/** `zsh -l` nạp /etc/zprofile (path_helper) nên PATH truyền vào không quyết định hết: hỏi chính shell đó thấy tmux ở đâu. */
function loginShellTmux(home: string, pathEnv: string): string {
  const res = spawnSync("/bin/zsh", ["-lc", "command -v tmux || true"], { env: { HOME: home, PATH: pathEnv }, encoding: "utf8" });
  return res.stdout.trim();
}

const hasZsh = existsSync("/bin/zsh");
const hostTmuxFallback = ["/opt/homebrew/bin/tmux", "/usr/local/bin/tmux"].some((p) => existsSync(p));

describe.skipIf(!hasZsh)("lệnh terminal owner chạy thật", () => {
  it("báo thiếu tmux bằng tiếng Việt và thoát 127", (ctx) => {
    const home = mkdtempSync(path.join(tmpdir(), "crew-term-"));
    try {
      // Máy chạy test có tmux ở chỗ lệnh tự dò (hoặc login shell tự thấy) thì không dựng được cảnh thiếu tmux.
      if (hostTmuxFallback || loginShellTmux(home, "/usr/bin:/bin")) ctx.skip();
      const res = runOwnerCommand(home, "/usr/bin:/bin");
      expect(res.status).toBe(127);
      expect(`${res.stdout}${res.stderr}`).toContain(
        "Mac này chưa có tmux. Chạy crew-mac setup trên Mac rồi mở lại.",
      );
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("dựng worktree owner, gắn tmux, và dựng lại được khi thư mục owner bị xoá tay", (ctx) => {
    const home = mkdtempSync(path.join(tmpdir(), "crew-term-"));
    try {
      const bin = path.join(home, "bin");
      mkdirSync(bin);
      const log = path.join(home, "tmux.log");
      const fakeTmux = path.join(bin, "tmux");
      writeFileSync(fakeTmux, `#!/bin/sh\necho "$0 $*" >> "${log}"\n`);
      chmodSync(fakeTmux, 0o755);
      const pathEnv = `${bin}:/usr/bin:/bin`;
      // Login shell thấy tmux thật trước tmux giả thì không chạy được (sẽ gắn vào tmux thật).
      if (loginShellTmux(home, pathEnv) !== fakeTmux) ctx.skip();

      const git = (args: string[], cwd = home) => {
        const res = spawnSync("git", args, {
          cwd, encoding: "utf8",
          env: { HOME: home, PATH: "/usr/bin:/bin", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" },
        });
        if (res.status !== 0) throw new Error(res.stderr);
      };
      const origin = path.join(home, "origin.git");
      const seed = path.join(home, "seed");
      const root = path.join(home, "crew-agents", "kidy-school");
      git(["init", "-q", "--bare", "-b", "main", origin]);
      git(["init", "-q", "-b", "main", seed]);
      writeFileSync(path.join(seed, "README.md"), "x\n");
      git(["add", "."], seed);
      git(["commit", "-q", "-m", "init"], seed);
      git(["push", "-q", origin, "main"], seed);
      mkdirSync(root, { recursive: true });
      git(["clone", "-q", origin, path.join(root, "repo")]);

      const first = runOwnerCommand(home, pathEnv);
      expect(first.status, first.stdout + first.stderr).toBe(0);
      expect(existsSync(path.join(root, "owner", "README.md"))).toBe(true);
      expect(readFileSync(log, "utf8")).toContain(`${fakeTmux} -L crew new-session -A -s crew-owner-kidy-school -c ${root}/owner`);

      // Owner xoá tay thư mục owner (rm -rf / Finder): git vẫn giữ đăng ký worktree cũ.
      rmSync(path.join(root, "owner"), { recursive: true, force: true });
      const second = runOwnerCommand(home, pathEnv);
      expect(second.status, second.stdout + second.stderr).toBe(0);
      expect(second.stdout).not.toContain("Không dựng được worktree owner.");
      expect(existsSync(path.join(root, "owner", "README.md"))).toBe(true);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("repo gốc là bản clone của owner ngoài crew-agents: tìm qua worktree vai, bỏ qua symlink companion", (ctx) => {
    const home = mkdtempSync(path.join(tmpdir(), "crew-term-"));
    try {
      const bin = path.join(home, "bin");
      mkdirSync(bin);
      const fakeTmux = path.join(bin, "tmux");
      writeFileSync(fakeTmux, "#!/bin/sh\nexit 0\n");
      chmodSync(fakeTmux, 0o755);
      const pathEnv = `${bin}:/usr/bin:/bin`;
      if (loginShellTmux(home, pathEnv) !== fakeTmux) ctx.skip();

      const git = (args: string[], cwd = home) => {
        const res = spawnSync("git", args, {
          cwd, encoding: "utf8",
          env: { HOME: home, PATH: "/usr/bin:/bin", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" },
        });
        if (res.status !== 0) throw new Error(res.stderr);
        return res.stdout.trim();
      };
      const seedRepo = (dir: string, file: string) => {
        git(["init", "-q", "-b", "main", dir]);
        writeFileSync(path.join(dir, file), "x\n");
        git(["add", "."], dir);
        git(["commit", "-q", "-m", "init"], dir);
      };
      const origin = path.join(home, "origin.git");
      const seed = path.join(home, "seed");
      seedRepo(seed, "README.md");
      git(["clone", "-q", "--bare", seed, origin]);
      const clone = path.join(home, "Projects", "kidy_school");
      git(["clone", "-q", origin, clone]);
      const docs = path.join(home, "Projects", "docs");
      seedRepo(docs, "DOCS.md");
      const root = path.join(home, "crew-agents", "kidy-school");
      mkdirSync(root, { recursive: true });
      git(["worktree", "add", "-q", "-b", "agent/kidy-school-executor-1", path.join(root, "executor-1")], clone);
      // Companion là symlink tới repo khác, đứng trước theo thứ tự chữ cái: không được lấy nhầm làm repo gốc.
      symlinkSync(docs, path.join(root, "aaa-docs"));

      const res = runOwnerCommand(home, pathEnv, null);
      expect(res.status, res.stdout + res.stderr).toBe(0);
      expect(existsSync(path.join(root, "owner", "README.md"))).toBe(true);
      expect(git(["worktree", "list"], clone)).toContain(path.join(root, "owner"));
      expect(git(["rev-parse", "--abbrev-ref", "HEAD"], path.join(root, "owner"))).toBe("owner/kidy-school");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

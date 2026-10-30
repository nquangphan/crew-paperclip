import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildOwnerTerminalCommand } from "../crew/terminal/remote-command.js";

describe("buildOwnerTerminalCommand", () => {
  it("dựng worktree owner và gắn phiên tmux", () => {
    const cmd = buildOwnerTerminalCommand({ projectKey: "kidy-school", branch: "main" });
    expect(cmd.startsWith("exec /bin/zsh -lc ")).toBe(true);
    expect(cmd).toContain("tmux -L crew");
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

  it.skipIf(!existsSync("/bin/zsh"))("báo thiếu tmux bằng tiếng Việt và thoát 127", () => {
    const home = mkdtempSync(path.join(tmpdir(), "crew-term-"));
    try {
      const cmd = buildOwnerTerminalCommand({ projectKey: "kidy-school", branch: "main" });
      const res = spawnSync("/bin/sh", ["-c", cmd], {
        env: { HOME: home, PATH: "/usr/bin:/bin" },
        encoding: "utf8",
      });
      expect(res.status).toBe(127);
      expect(`${res.stdout}${res.stderr}`).toContain(
        "Mac này chưa có tmux. Chạy crew-mac setup trên Mac rồi mở lại.",
      );
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

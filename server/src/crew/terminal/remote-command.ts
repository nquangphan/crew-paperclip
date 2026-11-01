import { shellQuote } from "@paperclipai/adapter-utils/ssh";

const KEY_RE = /^[a-z][a-z0-9-]{1,30}$/;
const BRANCH_RE = /^[A-Za-z0-9._/-]{1,100}$/;

/**
 * Lệnh chạy trên Mac của owner qua kênh SSH PTY: dựng worktree `owner/<khóa>` (nếu chưa có)
 * rồi gắn hoặc tạo phiên tmux `crew-owner-<khóa>` trên socket riêng `crew`.
 * Repo gốc là `~/crew-agents/<khóa>/repo` (project Crew tự clone) hoặc repo chính của một worktree vai trong thư mục đó
 * (project dùng bản clone sẵn của owner). Không biết nhánh thì dựng từ `origin/HEAD`.
 * Khóa và nhánh được kiểm chặt trước khi nhúng vào script, rồi cả script được quote một lần nữa.
 */
export function buildOwnerTerminalCommand(input: { projectKey: string; branch: string | null }): string {
  const { projectKey, branch } = input;
  if (!KEY_RE.test(projectKey)) throw new Error("Khóa project không hợp lệ");
  if (branch !== null && (!BRANCH_RE.test(branch) || branch.includes("..") || branch.startsWith("-")))
    throw new Error("Tên nhánh không hợp lệ");

  // Nhánh đã khớp regex nên không chứa ký tự đặc biệt của shell; chặn thêm dấu "-" đầu để khỏi thành cờ git.
  const fetch = branch === null ? `git -C "$repo" fetch origin` : `git -C "$repo" fetch origin ${branch}`;
  const base = branch === null ? "origin/HEAD" : `origin/${branch}`;
  const script = [
    "unset PAPERCLIP_RUN_ID",
    "setopt null_glob",
    `root="$HOME/crew-agents/${projectKey}"`,
    // PATH của login shell có thể thiếu thư mục Homebrew: dò thêm đúng các chỗ crew-mac dò.
    `tmux=$(command -v tmux 2>/dev/null) || tmux=""`,
    `if [ -z "$tmux" ]; then for c in /opt/homebrew/bin/tmux /usr/local/bin/tmux; do [ -x "$c" ] && { tmux="$c"; break; }; done; fi`,
    `[ -n "$tmux" ] || { echo 'Mac này chưa có tmux. Chạy crew-mac setup trên Mac rồi mở lại.'; exit 127; }`,
    `if [ ! -e "$root/owner" ]; then`,
    `  repo=""`,
    `  if [ -e "$root/repo/.git" ]; then repo="$root/repo"; else`,
    // Companion là symlink tới repo khác nên bỏ qua; dòng đầu của `worktree list` là worktree chính của repo.
    `    for d in "$root"/*; do`,
    `      [ -L "$d" ] || [ ! -e "$d/.git" ] && continue`,
    `      repo=$(git -C "$d" worktree list --porcelain 2>/dev/null | sed -n '1s/^worktree //p')`,
    `      [ -n "$repo" ] && break`,
    `    done`,
    `  fi`,
    `  [ -n "$repo" ] || { echo 'Dự án ${projectKey} chưa dựng trên máy này.'; exit 1; }`,
    // Thư mục owner bị xoá tay thì git vẫn giữ đăng ký worktree cũ; prune chỉ bỏ đăng ký của thư mục đã mất.
    `  git -C "$repo" worktree prune 2>/dev/null`,
    `  if ! out=$( {`,
    `    ${fetch} &&`,
    `    if git -C "$repo" show-ref --verify --quiet "refs/heads/owner/${projectKey}"; then`,
    `      git -C "$repo" worktree add "$root/owner" "owner/${projectKey}"`,
    `    else`,
    `      git -C "$repo" worktree add -b owner/${projectKey} "$root/owner" ${base}`,
    `    fi`,
    `  } 2>&1 ); then`,
    `    echo "$out"; echo 'Không dựng được worktree owner.'; exit 1`,
    `  fi`,
    `fi`,
    `conf=""; [ -f "$HOME/.crew-mac/tmux.conf" ] && conf="$HOME/.crew-mac/tmux.conf"`,
    `if [ -n "$conf" ]; then exec "$tmux" -L crew -f "$conf" new-session -A -s crew-owner-${projectKey} -c "$root/owner"; fi`,
    `exec "$tmux" -L crew new-session -A -s crew-owner-${projectKey} -c "$root/owner"`,
  ].join("\n");
  return `exec /bin/zsh -lc ${shellQuote(script)}`;
}

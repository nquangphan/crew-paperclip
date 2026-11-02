import { shellQuote } from "@paperclipai/adapter-utils/ssh";

const KEY_RE = /^[a-z][a-z0-9-]{1,30}$/;

/** Tiền tố tên phiên tmux của owner trên socket `crew`: `crew-owner-<khóa>`. */
export const OWNER_SESSION_PREFIX = "crew-owner-";

/** Mỗi project trên mỗi máy mở được tối đa chừng này terminal (slot 1..9), dùng chung worktree `owner`. */
export const MAX_OWNER_SLOTS = 9;

/** Phần sau tiền tố: khóa project, rồi `_<2..9>` cho slot từ 2 (`_` không có trong khóa nên không nhập nhằng). */
const SESSION_SUFFIX_RE = /^([a-z][a-z0-9-]{1,30})(?:_([2-9]))?$/;

function assertSlot(slot: number): void {
  if (!Number.isInteger(slot) || slot < 1 || slot > MAX_OWNER_SLOTS) throw new Error("Slot terminal không hợp lệ");
}

/**
 * Tên phiên tmux của một terminal owner: slot 1 giữ tên cũ `crew-owner-<khóa>` (gắn lại được phiên đang sống từ trước),
 * slot n ≥ 2 là `crew-owner-<khóa>_<n>`. tmux không cho `.` hay `:` trong tên phiên nên dùng `_`.
 */
export function ownerSessionName(projectKey: string, slot = 1): string {
  if (!KEY_RE.test(projectKey)) throw new Error("Khóa project không hợp lệ");
  assertSlot(slot);
  return slot === 1 ? `${OWNER_SESSION_PREFIX}${projectKey}` : `${OWNER_SESSION_PREFIX}${projectKey}_${slot}`;
}

/** Tìm tmux như crew-mac dò (PATH của login shell có thể thiếu thư mục Homebrew); không thấy thì `$tmux` rỗng. */
const FIND_TMUX = [
  `tmux=$(command -v tmux 2>/dev/null) || tmux=""`,
  `if [ -z "$tmux" ]; then for c in /opt/homebrew/bin/tmux /usr/local/bin/tmux; do [ -x "$c" ] && { tmux="$c"; break; }; done; fi`,
];
const BRANCH_RE = /^[A-Za-z0-9._/-]{1,100}$/;

/**
 * Lệnh chạy trên Mac của owner qua kênh SSH PTY: dựng worktree `owner/<khóa>` (nếu chưa có)
 * rồi gắn hoặc tạo phiên tmux của slot (`ownerSessionName`, mặc định slot 1) trên socket riêng `crew`. Mọi slot cùng cwd
 * là worktree owner.
 * Repo gốc là `~/crew-agents/<khóa>/repo` (project Crew tự clone) hoặc repo chính của một worktree vai trong thư mục đó
 * (project dùng bản clone sẵn của owner). Không biết nhánh thì dựng từ `origin/HEAD`.
 * Khóa và nhánh được kiểm chặt trước khi nhúng vào script, rồi cả script được quote một lần nữa.
 */
export function buildOwnerTerminalCommand(input: { projectKey: string; branch: string | null; slot?: number }): string {
  const { projectKey, branch } = input;
  const session = ownerSessionName(projectKey, input.slot ?? 1);
  if (branch !== null && (!BRANCH_RE.test(branch) || branch.includes("..") || branch.startsWith("-")))
    throw new Error("Tên nhánh không hợp lệ");

  // Nhánh đã khớp regex nên không chứa ký tự đặc biệt của shell; chặn thêm dấu "-" đầu để khỏi thành cờ git.
  // Repo không clone bằng `git clone` có thể chưa có origin/HEAD: hỏi remote một lần.
  const fetch =
    branch === null
      ? `git -C "$repo" fetch origin && { git -C "$repo" rev-parse -q --verify origin/HEAD >/dev/null || git -C "$repo" remote set-head origin -a >/dev/null; }`
      : `git -C "$repo" fetch origin ${branch}`;
  const base = branch === null ? "origin/HEAD" : `origin/${branch}`;
  const script = [
    "unset PAPERCLIP_RUN_ID",
    "setopt null_glob",
    `root="$HOME/crew-agents/${projectKey}"`,
    ...FIND_TMUX,
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
    // Thư mục owner bị xoá tay thì git vẫn giữ đăng ký worktree cũ: chỉ gỡ đúng đăng ký đó, không prune cả repo của owner.
    `  git -C "$repo" worktree remove --force "$root/owner" >/dev/null 2>&1`,
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
    `if [ -n "$conf" ]; then exec "$tmux" -L crew -f "$conf" new-session -A -s ${session} -c "$root/owner"; fi`,
    `exec "$tmux" -L crew new-session -A -s ${session} -c "$root/owner"`,
  ].join("\n");
  return `exec /bin/zsh -lc ${shellQuote(script)}`;
}

/** Một phiên tmux owner đang sống trên Mac. */
export type OwnerTmuxSession = {
  projectKey: string;
  /** 1..9; 1 là phiên tên cũ `crew-owner-<khóa>`. */
  slot: number;
  /** Số cửa sổ terminal (client tmux) đang gắn vào phiên, từ mọi trình duyệt và máy. */
  attached: number;
  createdAt: string;
  activityAt: string;
};

/**
 * Lệnh chỉ đọc liệt kê phiên tmux trên socket `crew` (tên, số client gắn, giờ tạo, giờ hoạt động cuối). Mac chưa có tmux
 * hay chưa có phiên nào thì in rỗng và thoát 0.
 */
export function buildListOwnerSessionsCommand(): string {
  const script = [
    ...FIND_TMUX,
    `[ -n "$tmux" ] || exit 0`,
    `"$tmux" -L crew list-sessions -F '#{session_name}|#{session_attached}|#{session_created}|#{session_activity}' 2>/dev/null`,
    "exit 0",
  ].join("\n");
  return `exec /bin/zsh -lc ${shellQuote(script)}`;
}

/**
 * Đọc output của `buildListOwnerSessionsCommand`, chỉ giữ phiên `crew-owner-<khóa>` (slot 1) và `crew-owner-<khóa>_<2..9>`
 * có khóa hợp lệ; hậu tố khác (`_1`, `_10`, `_x`…) bị bỏ.
 */
export function parseOwnerSessions(output: string): OwnerTmuxSession[] {
  const sessions: OwnerTmuxSession[] = [];
  for (const line of output.split(/\r?\n/)) {
    const [name, attached, created, activity] = line.trim().split("|");
    if (!name?.startsWith(OWNER_SESSION_PREFIX)) continue;
    const match = SESSION_SUFFIX_RE.exec(name.slice(OWNER_SESSION_PREFIX.length));
    const createdSec = Number(created);
    const activitySec = Number(activity);
    if (!match?.[1] || !Number.isFinite(createdSec) || !Number.isFinite(activitySec)) continue;
    sessions.push({
      projectKey: match[1],
      slot: match[2] ? Number(match[2]) : 1,
      attached: Math.max(0, Number(attached) || 0),
      createdAt: new Date(createdSec * 1000).toISOString(),
      activityAt: new Date(activitySec * 1000).toISOString(),
    });
  }
  return sessions;
}

/**
 * Lệnh tắt hẳn phiên tmux của một slot (`ownerSessionName`, khớp đúng tên bằng `=` nên slot 1 không đụng `_2`), kể cả
 * chương trình đang chạy trong đó. In `killed` khi tắt được, `missing` khi không có phiên hay Mac chưa có tmux; luôn thoát
 * 0. Worktree owner giữ nguyên.
 */
export function buildKillOwnerSessionCommand(projectKey: string, slot = 1): string {
  const session = ownerSessionName(projectKey, slot);
  const script = [
    ...FIND_TMUX,
    `[ -n "$tmux" ] || { echo missing; exit 0; }`,
    `if "$tmux" -L crew kill-session -t "=${session}" 2>/dev/null; then echo killed; else echo missing; fi`,
  ].join("\n");
  return `exec /bin/zsh -lc ${shellQuote(script)}`;
}

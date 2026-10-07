#!/usr/bin/env bash
# Merge an upstream Paperclip tag or ref into a throwaway sync branch on its own worktree,
# then run verify.sh. Never touches the base branch and never pushes.
set -euo pipefail

usage() {
  echo "Cách dùng: crew/release/upgrade.sh <tag-hoặc-ref-upstream> [--base <nhánh>] [--worktree <thư-mục>] [--cleanup]" >&2
  exit 64
}

REF=""
BASE="v3"
WT=""
CLEANUP=0
while [ $# -gt 0 ]; do
  case "$1" in
    --base) [ $# -ge 2 ] || usage; BASE="$2"; shift 2 ;;
    --worktree) [ $# -ge 2 ] || usage; WT="$2"; shift 2 ;;
    --cleanup) CLEANUP=1; shift ;;
    -*) usage ;;
    *) [ -z "$REF" ] || usage; REF="$1"; shift ;;
  esac
done
[ -n "$REF" ] || usage

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
LABEL="$(printf '%s' "$REF" | sed 's#^refs/##; s#[^A-Za-z0-9._-]#-#g')"
BRANCH="sync/paperclip-$LABEL"
WT="${WT:-${TMPDIR:-/tmp}/crew-upgrade/$LABEL}"
case "$WT" in
  /*) ;;
  *) WT="$PWD/$WT" ;;
esac

if [ "${CREW_UPGRADE_SKIP_FETCH:-0}" != "1" ]; then
  git -C "$REPO" fetch upstream --tags
fi
if ! TARGET="$(git -C "$REPO" rev-parse --verify --quiet "$REF^{commit}")"; then
  echo "Không tìm thấy ref: $REF" >&2
  exit 65
fi
if [ -e "$WT" ]; then
  echo "Thư mục worktree đã tồn tại: $WT" >&2
  exit 66
fi
if git -C "$REPO" show-ref --verify --quiet "refs/heads/$BRANCH"; then
  echo "Nhánh đã tồn tại: $BRANCH" >&2
  exit 66
fi
if ! git -C "$REPO" rev-parse --verify --quiet "$BASE^{commit}" >/dev/null; then
  echo "Không tìm thấy nhánh base: $BASE" >&2
  exit 65
fi
if ! git -C "$REPO" cat-file -e "$BASE:crew/release/verify.sh" 2>/dev/null; then
  echo "Base $BASE không có crew/release/verify.sh" >&2
  exit 65
fi

mkdir -p "$(dirname "$WT")"
git -C "$REPO" worktree add -b "$BRANCH" "$WT" "$BASE"
WT="$(cd "$WT" && pwd -P)"
check_toplevel() {
  # Compare by inode: path case may differ on a case-insensitive filesystem.
  if ! [ "$(git -C "$WT" rev-parse --show-toplevel)" -ef "$WT" ]; then
    echo "Sai worktree: $WT" >&2
    exit 70
  fi
}

check_toplevel
echo "== Merge $REF ($TARGET) vào $BRANCH (từ $BASE), worktree $WT"
if ! git -C "$WT" merge --no-ff -m "chore(sync): merge Paperclip $REF into $BASE" "$TARGET"; then
  CONFLICTS="$(git -C "$WT" diff --name-only --diff-filter=U)"
  if [ -z "$CONFLICTS" ]; then
    check_toplevel
    git -C "$WT" merge --abort 2>/dev/null || true
    echo "Merge lỗi nhưng không có file conflict (xem lỗi git ở trên); đã hủy merge trong $WT" >&2
    exit 67
  elif [ "$CONFLICTS" = "pnpm-lock.yaml" ]; then
    echo "Chỉ pnpm-lock.yaml conflict: lấy bản upstream, verify.sh sẽ cài lại importer của Crew"
    check_toplevel
    git -C "$WT" checkout --theirs pnpm-lock.yaml
    git -C "$WT" add pnpm-lock.yaml
    git -C "$WT" commit --no-edit
  else
    echo "Conflict (file: số hunk):" >&2
    while IFS= read -r file; do
      if [ -f "$WT/$file" ]; then
        printf '  %s: %s\n' "$file" "$(grep -c '^<<<<<<< ' "$WT/$file" || true)" >&2
      else
        printf '  %s: (file bị xóa ở một phía)\n' "$file" >&2
      fi
    done <<< "$CONFLICTS"
    echo "Giải conflict trong $WT, commit, rồi chạy: (cd $WT && bash crew/release/verify.sh)" >&2
    exit 2
  fi
fi

check_toplevel
(cd "$WT" && bash crew/release/verify.sh)
if ! git -C "$WT" diff --quiet -- pnpm-lock.yaml; then
  check_toplevel
  git -C "$WT" add pnpm-lock.yaml
  git -C "$WT" commit -m "chore(sync): restore Crew lockfile importer"
fi
echo "XANH: $BRANCH tại $(git -C "$WT" rev-parse --short HEAD)"
git -C "$WT" status --short
if [ "$CLEANUP" = "1" ]; then
  git -C "$REPO" worktree remove --force "$WT"
  echo "Đã gỡ worktree, giữ nhánh $BRANCH"
fi

#!/usr/bin/env bash
# Chạy Playwright UI Crew. Bắt buộc --project=t1|t2|t3.
#   t1: stack cục bộ ~/crew-r3-t1 (tài khoản tạm trong ~/crew-r3-t1/board.env, không phải mật khẩu prod).
#   t2/t3: prod, company Crew E2E. Email/mật khẩu board đọc từ .env trên VPS qua ssh: chỉ giá trị cần dùng đi qua
#   pipe, vào biến môi trường của process này; không echo, không ghi file, không nằm trong tham số lệnh.
# Sau lượt: kiểm test-results (kể cả nội dung trace.zip) không chứa mật khẩu.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd -P)
pkg=$(cd "$here/../.." && pwd -P)

tier=""
for a in "$@"; do
  case "$a" in
    --project=t1 | --project=t2 | --project=t3) tier=${a#--project=} ;;
    --project=* | --project) echo "run-e2e.sh: dùng --project=t1|t2|t3" >&2; exit 2 ;;
  esac
done
[ -n "$tier" ] || { echo "run-e2e.sh: thiếu --project=t1|t2|t3" >&2; exit 2; }
export CREW_E2E_TIER=$tier

if [ "$tier" = t1 ]; then
  t1env=${CREW_E2E_T1_ENV:-$HOME/crew-r3-t1/board.env}
  [ -r "$t1env" ] || { echo "run-e2e.sh: chưa có $t1env (dựng stack T1 trước)" >&2; exit 2; }
  # shellcheck disable=SC1090
  set -a; . "$t1env"; set +a
  export CREW_E2E_BASE_URL=${CREW_E2E_BASE_URL:-http://127.0.0.1:5183}
else
  host=${CREW_E2E_SSH_HOST:-nhamoiplatform}
  envfile=/opt/crew-v3-spike/.env
  IFS= read -r CREW_E2E_EMAIL < <(ssh "$host" "sed -n 's/^PAPERCLIP_BOARD_EMAIL=//p' $envfile")
  IFS= read -r CREW_E2E_PASSWORD < <(ssh "$host" "sed -n 's/^PAPERCLIP_BOARD_PASSWORD=//p' $envfile")
  [ -n "$CREW_E2E_EMAIL" ] && [ -n "$CREW_E2E_PASSWORD" ] || { echo "run-e2e.sh: không đọc được tài khoản board" >&2; exit 2; }
  export CREW_E2E_EMAIL CREW_E2E_PASSWORD
  # Tài khoản khách góp ý là tùy chọn: chưa tạo thì để trống, các ca khách tự bỏ qua.
  IFS= read -r CREW_E2E_CONTRIBUTOR_EMAIL < <(ssh "$host" "sed -n 's/^CREW_E2E_CONTRIBUTOR_EMAIL=//p' $envfile") || true
  IFS= read -r CREW_E2E_CONTRIBUTOR_PASSWORD < <(ssh "$host" "sed -n 's/^CREW_E2E_CONTRIBUTOR_PASSWORD=//p' $envfile") || true
  if [ -n "${CREW_E2E_CONTRIBUTOR_EMAIL:-}" ] && [ -n "${CREW_E2E_CONTRIBUTOR_PASSWORD:-}" ]; then
    export CREW_E2E_CONTRIBUTOR_EMAIL CREW_E2E_CONTRIBUTOR_PASSWORD
  else
    unset CREW_E2E_CONTRIBUTOR_EMAIL CREW_E2E_CONTRIBUTOR_PASSWORD
  fi
  export CREW_E2E_COMPANY_ID=${CREW_E2E_COMPANY_ID:-a7132a14-478e-4226-ae58-3dc03ce923e1}
fi

state=$(mktemp -d "${TMPDIR:-/tmp}/crew-e2e-state.XXXXXX")
chmod 700 "$state"
export CREW_E2E_STATE_DIR=$state
scan=""
cleanup() {
  rm -f "$state"/*.json
  rmdir "$state" 2>/dev/null || true
  if [ -n "$scan" ] && [ -d "$scan" ]; then
    find "$scan" -type f -delete
    find "$scan" -depth -type d -empty -delete
  fi
}
trap cleanup EXIT

cd "$pkg"
status=0
npx playwright test "$@" || status=$?

# Mật khẩu không được nằm trong kết quả (ảnh, log, trace đã giải nén). Trace chụp DOM (giá trị input) và body
# request, nên ca điền mật khẩu thật phải tắt trace (xem README). Gặp thì xóa ngay tệp chứa mật khẩu và báo lỗi.
if [ -d test-results ]; then
  scan=$(mktemp -d "${TMPDIR:-/tmp}/crew-e2e-scan.XXXXXX")
  pw() {
    printf '%s\n' "$CREW_E2E_PASSWORD"
    [ -z "${CREW_E2E_CONTRIBUTOR_PASSWORD:-}" ] || printf '%s\n' "$CREW_E2E_CONTRIBUTOR_PASSWORD"
  }
  n=0
  leaked=0
  while IFS= read -r -d '' z; do
    n=$((n + 1))
    mkdir -p "$scan/$n"
    unzip -q -o "$z" -d "$scan/$n" || true
    if grep -rqaF -f <(pw) "$scan/$n"; then
      rm -f "$z"
      leaked=$((leaked + 1))
    fi
  done < <(find test-results -name '*.zip' -print0)
  while IFS= read -r f; do
    rm -f "$f"
    leaked=$((leaked + 1))
  done < <(grep -rlaF -f <(pw) test-results || true)
  if [ "$leaked" -gt 0 ]; then
    echo "run-e2e.sh: LỖI — $leaked tệp trong test-results chứa mật khẩu board (đã xóa)" >&2
    exit 3
  fi
  echo "run-e2e.sh: test-results không chứa mật khẩu ($n trace đã quét)"
fi
exit "$status"

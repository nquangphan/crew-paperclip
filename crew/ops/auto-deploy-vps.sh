#!/bin/bash
# Server half of crew/ops/auto-deploy.mjs. Never installed: the Mac worker sends this file over ssh as a temp file and
# runs it with stdin from /dev/null (docker compose exec -T inside deploy.sh would otherwise eat the script).
# Every argument is validated; output is filtered so no header, cookie or key ever leaves the VPS.
# Usage: auto-deploy-vps.sh <command> [args]
#   active-runs                         prints active runs (empty = idle)
#   image <tag>                         present|absent
#   current-image                       image of the running server container
#   inspect <tag>                       ops/inspect-image.sh output, then "RC <n>"
#   build <short>                       ops/overlay-job.sh (needs ops/overlay-<short>.tar.gz), last lines, then "RC <n>"
#   deploy-when-idle <tag> <sec> <id>   polls active runs every 2 s for up to <sec>; when idle starts ops/deploy.sh
#                                       detached from this session and prints "STARTED <id>", else "BUSY"/"LOCKED"
#   deploy-status <id>                  "RUNNING", or "RC <n>" and the filtered log tail
#   rollback <TS>                       ops/rollback.sh <TS>, then "RC <n>"
#   plugin-state                        ops/plugin-state.sh
#   claims                              claims_ok=<n> claims_5xx=<n> errors=<n> since the server container started
#   comments <issueId>                  one line per comment: <authorAgentId or -><TAB><first line>
#   comment <issueId> <url> <b64 body>  posts the comment as the agent whose API key is in $ROOT/.deploy-agent-key
set -uo pipefail
ROOT=${AUTO_DEPLOY_ROOT:-/opt/crew-v3-spike}
OPS=$ROOT/ops
SERVER=${AUTO_DEPLOY_SERVER:-crew-v3-spike-server-1}
KEY_FILE=$ROOT/.deploy-agent-key

die() { echo "auto-deploy-vps: $*" >&2; exit 2; }
need() { [[ "$2" =~ $3 ]] || die "bad $1"; }
# Drops any line that could carry a credential and masks user:pass@ in URLs and well-known token shapes.
redact() {
  grep -v -i -E 'authorization|cookie|bearer|api[-_]?key|password|secret' \
    | sed -E 's#[A-Za-z][A-Za-z0-9+.-]*://[^@/ ]*@#://***@#g; s/(pcp_|gh[pousr]_|github_pat_|glpat-|sk-)[A-Za-z0-9_-]+/\1***/g'
}
TAG_RE='^crew-v3/paperclip:v3-[0-9a-f]{9}$'
SHORT_RE='^[0-9a-f]{9}$'
ID_RE='^[0-9a-f]{9}-[0-9]{6,}$'
TS_RE='^[0-9]{8}-[0-9]{6}$'
UUID_RE='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
URL_RE='^https?://[A-Za-z0-9.-]+(:[0-9]+)?$'

CMD=${1:-}
shift || true
case "$CMD" in
  active-runs)
    "$OPS/active-runs.sh"
    ;;
  image)
    need tag "${1:-}" "$TAG_RE"
    if docker image inspect "$1" >/dev/null 2>&1; then echo present; else echo absent; fi
    ;;
  current-image)
    docker inspect "$SERVER" --format '{{.Config.Image}}'
    ;;
  inspect)
    need tag "${1:-}" "$TAG_RE"
    "$OPS/inspect-image.sh" "$1" 2>&1 | redact
    echo "RC ${PIPESTATUS[0]}"
    ;;
  build)
    need short "${1:-}" "$SHORT_RE"
    "$OPS/overlay-job.sh" "$1" 2>&1 | tail -n 20 | redact
    echo "RC ${PIPESTATUS[0]}"
    ;;
  deploy-when-idle)
    need tag "${1:-}" "$TAG_RE"
    need seconds "${2:-}" '^[0-9]{1,5}$'
    need id "${3:-}" "$ID_RE"
    TAG=$1 END=$((SECONDS + $2)) ID=$3
    LOG=$OPS/auto-deploy-$ID.log RCF=$OPS/auto-deploy-$ID.rc
    # One deploy at a time on this host. The lock fd is inherited by the detached deploy, so it stays held until
    # deploy.sh exits. Hosts without flock (tests on macOS) skip the lock.
    if command -v flock >/dev/null 2>&1; then
      exec 9>"$OPS/auto-deploy.lock"
      flock -n 9 || { echo "LOCKED"; exit 0; }
    fi
    while :; do
      ACTIVE=$("$OPS/active-runs.sh" 2>&1)
      ARC=$?
      [ "$ARC" = 0 ] && [ -z "$ACTIVE" ] && break
      if [ "$SECONDS" -ge "$END" ]; then
        if [ "$ARC" = 0 ]; then echo "BUSY"; else echo "BUSY active-runs rc=$ARC"; fi
        printf '%s\n' "$ACTIVE" | head -5 | redact | sed 's/^/  /'
        exit 0
      fi
      sleep 2
    done
    rm -f "$RCF"
    : > "$LOG"
    # Own session, no terminal, stdin from /dev/null: the ssh session may end at any moment without stopping it.
    # util-linux setsid on the VPS; perl POSIX::setsid where it is missing (macOS, for the tests).
    if command -v setsid >/dev/null 2>&1; then SETSID=(setsid); else SETSID=(perl -MPOSIX -e 'POSIX::setsid(); exec @ARGV or die'); fi
    nohup "${SETSID[@]}" bash -c '"$1" "$2" > "$3" 2>&1 < /dev/null; echo $? > "$4.tmp"; mv "$4.tmp" "$4"' \
      auto-deploy "$OPS/deploy.sh" "$TAG" "$LOG" "$RCF" < /dev/null > /dev/null 2>&1 &
    echo "STARTED $ID"
    ;;
  deploy-status)
    need id "${1:-}" "$ID_RE"
    LOG=$OPS/auto-deploy-$1.log RCF=$OPS/auto-deploy-$1.rc
    [ -f "$LOG" ] || { echo "UNKNOWN"; exit 0; }
    if [ -f "$RCF" ]; then echo "RC $(tr -dc '0-9' < "$RCF")"; else echo "RUNNING"; fi
    tail -n 60 "$LOG" | redact
    ;;
  rollback)
    need ts "${1:-}" "$TS_RE"
    "$OPS/rollback.sh" "$1" 2>&1 | redact
    echo "RC ${PIPESTATUS[0]}"
    ;;
  plugin-state)
    "$OPS/plugin-state.sh" 2>&1 | head -3 | redact
    ;;
  claims)
    STARTED=$(docker inspect "$SERVER" --format '{{.State.StartedAt}}' 2>/dev/null) || die "server container not found"
    docker logs --since "$STARTED" "$SERVER" 2>&1 | python3 -c '
import json, sys
ok = bad = errors = 0
for line in sys.stdin:
    try:
        d = json.loads(line)
    except ValueError:
        continue
    if not isinstance(d, dict):
        continue
    if isinstance(d.get("level"), int) and d["level"] >= 50:
        errors += 1
    url = (d.get("req") or {}).get("url") or ""
    code = (d.get("res") or {}).get("statusCode")
    if "/machine-jobs/claim" in url and isinstance(code, int):
        if 200 <= code < 300:
            ok += 1
        elif code >= 500:
            bad += 1
print("claims_ok=%d claims_5xx=%d errors=%d" % (ok, bad, errors))
'
    ;;
  comments)
    need issue "${1:-}" "$UUID_RE"
    "$ROOT/api.sh" GET "/issues/$1/comments" < /dev/null | python3 -c '
import json, sys
try:
    data = json.load(sys.stdin)
except ValueError:
    print("comments: response is not JSON", file=sys.stderr); sys.exit(3)
items = data if isinstance(data, list) else (data.get("comments") or data.get("items")) if isinstance(data, dict) else None
if not isinstance(items, list):
    print("comments: unexpected response", file=sys.stderr); sys.exit(3)
for c in items:
    if not isinstance(c, dict):
        continue
    body = c.get("body") or ""
    first = body.split("\n", 1)[0].strip().replace("\t", " ")
    print("%s\t%s" % (c.get("authorAgentId") or "-", first[:300]))
'
    ;;
  comment)
    need issue "${1:-}" "$UUID_RE"
    need url "${2:-}" "$URL_RE"
    need body "${3:-}" '^[A-Za-z0-9+/=]+$'
    [ -s "$KEY_FILE" ] || { echo "NO_KEY"; exit 4; }
    umask 077
    TMP=$(mktemp -d) || die "mktemp failed"
    trap 'rm -rf "$TMP"' EXIT
    # The key only goes through the shell builtin printf into a 0600 file read by curl -H @file: never on argv.
    printf 'Authorization: Bearer %s\n' "$(tr -d '\r\n' < "$KEY_FILE")" > "$TMP/h"
    python3 -c '
import base64, json, sys
text = base64.b64decode(sys.argv[1]).decode("utf-8")
sys.stdout.write(json.dumps({"body": text}))
' "$3" > "$TMP/b" || die "bad body"
    CODE=$(curl -sS --max-time 30 -o "$TMP/out" -w '%{http_code}' -H @"$TMP/h" -H 'Content-Type: application/json' \
      --data-binary @"$TMP/b" "$2/api/issues/$1/comments" 2>/dev/null)
    echo "HTTP ${CODE:-000}"
    case "$CODE" in 2??) exit 0 ;; *) head -c 300 "$TMP/out" | redact; echo; exit 5 ;; esac
    ;;
  *)
    die "unknown command: ${CMD:-<none>}"
    ;;
esac

#!/bin/bash
# Restores a daily backup into a throwaway compose project (crew-v3-spike-restore, files under
# /opt/crew-v3-spike/restore-drill), checks the data,
# also restores the newest built-in .sql.gz into a scratch DB, then removes everything.
# Usage: restore-drill.sh <TS>   (TS from /opt/crew-v3-spike/backups/daily/LATEST)
set -euo pipefail
ROOT=/opt/crew-v3-spike
SRC=$ROOT/backups/daily
TS=$1
DRILL=$ROOT/restore-drill
P=crew-v3-spike-restore

[ ! -e "$DRILL" ] || { echo "drill: $DRILL exists, remove it first" >&2; exit 2; }
AV=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
[ "$AV" -ge 3072 ] || { echo "drill: RAM available ${AV}MiB < 3072MiB" >&2; exit 3; }

cleanup() {
  docker compose -p "$P" -f "$DRILL/docker-compose.yml" -f "$DRILL/drill.override.yml" down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$DRILL"
}
trap cleanup EXIT

umask 077
mkdir -p "$DRILL/data"
tar -C "$DRILL" -xzf "$SRC/config-$TS.tar.gz"
tar -C "$DRILL/data" -xzf "$SRC/paperclip-data-$TS.tar.gz"
mkdir -p "$DRILL/data/pgdata"
IMAGE=$(docker inspect crew-v3-spike-server-1 --format '{{.Config.Image}}')
cat > "$DRILL/drill.override.yml" <<EOF
services:
  server:
    image: $IMAGE
    ports: !reset []
    restart: "no"
    environment:
      HEARTBEAT_SCHEDULER_ENABLED: "false"
      PAPERCLIP_DB_BACKUP_ENABLED: "false"
  db:
    restart: "no"
EOF
cd "$DRILL"
C="docker compose -p $P -f docker-compose.yml -f drill.override.yml"

# --wait uses the compose healthcheck; a bare pg_isready can pass during the image's init restart.
$C up -d --wait db
docker cp "$SRC/db-$TS.dump" "$P-db-1:/tmp/restore.dump"
$C exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --exit-on-error /tmp/restore.dump'

$C exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "select id, identifier, status from issues order by created_at"' > "$DRILL/issues-restored.txt"
if ! diff -q "$SRC/issues-$TS.txt" "$DRILL/issues-restored.txt" >/dev/null; then
  echo "drill: issue list differs from backup time" >&2
  diff "$SRC/issues-$TS.txt" "$DRILL/issues-restored.txt" | head -20 >&2
  exit 5
fi
RUNS=$($C exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "select count(*) from heartbeat_runs"')
echo "drill: issues match ($(wc -l < "$DRILL/issues-restored.txt")), heartbeat_runs=$RUNS"

# Quarantine before the server boots: no environment may reach a Mac, no agent may run,
# and no copied queued/running run may be picked up.
$C exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -c "update environments set status = '"'"'archived'"'"' where driver <> '"'"'local'"'"'; update agents set status = '"'"'paused'"'"'; update heartbeat_runs set status = '"'"'cancelled'"'"' where status in ('"'"'queued'"'"', '"'"'running'"'"', '"'"'scheduled_retry'"'"');"'

# The server only answers its configured public host, so requests carry the Host (and, for https, the
# forwarded proto) taken from the PAPERCLIP_PUBLIC_URL the restored compose/env actually gives it.
PUBLIC_URL=$(sed -n 's/^[[:space:]]*PAPERCLIP_PUBLIC_URL:[[:space:]]*"\{0,1\}\([^"[:space:]]*\).*/\1/p' "$DRILL/docker-compose.yml" | head -1)
[ -n "$PUBLIC_URL" ] || PUBLIC_URL=$(sed -n 's/^PAPERCLIP_PUBLIC_URL=//p' "$DRILL/.env" 2>/dev/null | tr -d '"' | head -1)
[ -n "$PUBLIC_URL" ] || { echo "drill: cannot find PAPERCLIP_PUBLIC_URL in restored config" >&2; exit 4; }
PUBLIC_HOST=${PUBLIC_URL#*://}
PUBLIC_HOST=${PUBLIC_HOST%%/*}
HDRS=(-H "Host: $PUBLIC_HOST")
case "$PUBLIC_URL" in https://*) HDRS+=(-H "X-Forwarded-Proto: https") ;; esac
# Session cookie from the Netscape jar sent as a header (curl withholds Secure cookies over http); never printed.
COOKIE=$(awk -F'\t' '{sub(/^#HttpOnly_/, "", $1)} $1 !~ /^#/ && $6 ~ /session_token$/ {print $6 "=" $7; exit}' "$ROOT/.board-cookies" 2>/dev/null || true)
[ -z "$COOKIE" ] || HDRS+=(-H "Cookie: $COOKIE")
echo "drill: API host=$PUBLIC_HOST proto=${PUBLIC_URL%%://*} cookie=$([ -n "$COOKIE" ] && echo yes || echo no)"
$C up -d server
STATUS=""
IP=""
for i in $(seq 1 90); do
  IP=$(docker inspect "$P-server-1" --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}')
  STATUS=$(curl -s --max-time 3 "${HDRS[@]}" "http://$IP:3100/api/health" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("status"))' 2>/dev/null || true)
  [ "$STATUS" = ok ] && break
  sleep 2
done
[ "$STATUS" = ok ] || { echo "drill: restored server not healthy" >&2; $C logs --tail 5 server >&2; exit 6; }

FIRST_ISSUE=$(head -1 "$DRILL/issues-restored.txt" | cut -d'|' -f1)
EXPECTED=$(head -1 "$DRILL/issues-restored.txt" | cut -d'|' -f3)
API_STATUS=$(curl -s --max-time 10 "${HDRS[@]}" "http://$IP:3100/api/issues/$FIRST_ISSUE" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("status"))' 2>/dev/null || echo "-")
echo "drill: API issue $FIRST_ISSUE status=$API_STATUS expected=$EXPECTED"
[ "$API_STATUS" = "$EXPECTED" ] || echo "drill: WARN API read did not match (auth/host); the SQL check above is the binding evidence"

BUILTIN=$(ls -1t "$ROOT"/data/paperclip/instances/default/data/backups/paperclip-*.sql.gz | head -1)
docker cp "$BUILTIN" "$P-db-1:/tmp/builtin.sql.gz"
$C exec -T db sh -c 'createdb -U "$POSTGRES_USER" builtin_check && gunzip -c /tmp/builtin.sql.gz | psql -U "$POSTGRES_USER" -d builtin_check -v ON_ERROR_STOP=1 -q >/dev/null'
BUILTIN_ISSUES=$($C exec -T db sh -c 'psql -U "$POSTGRES_USER" -d builtin_check -tAc "select count(*) from issues"')
echo "drill: builtin $(basename "$BUILTIN") restored, issues=$BUILTIN_ISSUES"
echo "DRILL OK"

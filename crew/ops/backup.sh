#!/bin/bash
# Daily backup of the crew-v3-spike Paperclip stack: custom-format pg_dump,
# data/paperclip (secrets master key, storage), and config (.env, compose, ssh/).
# The hourly built-in SQL backups live inside data/paperclip and are excluded here.
set -euo pipefail
ROOT=/opt/crew-v3-spike
OUT=$ROOT/backups/daily
KEEP_DAYS=${KEEP_DAYS:-14}
TS=$(date +%Y%m%d-%H%M)

AV=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
[ "$AV" -ge 1024 ] || { echo "backup: RAM available ${AV}MiB < 1024MiB" >&2; exit 3; }
FREE=$(df -Pm / | awk 'NR==2 {print $4}')
[ "$FREE" -ge 3072 ] || { echo "backup: disk free ${FREE}MiB < 3072MiB" >&2; exit 4; }

mkdir -p "$OUT"
chmod 700 "$ROOT/backups" "$OUT"
umask 077

docker exec crew-v3-spike-db-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "select id, identifier, status from issues order by created_at"' > "$OUT/issues-$TS.txt"
docker exec crew-v3-spike-db-1 sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$OUT/db-$TS.dump.tmp"
docker cp "$OUT/db-$TS.dump.tmp" crew-v3-spike-db-1:/tmp/crew-backup-check.dump
docker exec crew-v3-spike-db-1 sh -c 'pg_restore --list /tmp/crew-backup-check.dump > /dev/null && rm -f /tmp/crew-backup-check.dump'
mv "$OUT/db-$TS.dump.tmp" "$OUT/db-$TS.dump"

tar -C "$ROOT/data" -czf "$OUT/paperclip-data-$TS.tar.gz" \
  --exclude='paperclip/instances/*/data/backups' \
  --exclude='paperclip/instances/*/logs' \
  paperclip
gzip -t "$OUT/paperclip-data-$TS.tar.gz"
tar -C "$ROOT" -czf "$OUT/config-$TS.tar.gz" .env docker-compose.yml ssh
gzip -t "$OUT/config-$TS.tar.gz"

echo "$TS" > "$OUT/LATEST"
find "$OUT" -type f \( -name 'db-*.dump' -o -name '*.tar.gz' -o -name 'issues-*.txt' \) -mtime +"$KEEP_DAYS" -delete

HEALTH=$(curl -s --max-time 10 http://100.105.105.12:3100/api/health | python3 -c 'import json,sys; print(json.load(sys.stdin).get("databaseBackup",{}).get("status"))' || echo unknown)
echo "backup $TS ok: $(du -ch "$OUT"/*-"$TS".* | tail -1 | cut -f1) total, builtin=$HEALTH"

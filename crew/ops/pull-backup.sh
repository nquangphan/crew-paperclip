#!/bin/bash
# Mac mini: copies the VPS daily backup sets off the VPS and keeps the last 14 days.
# Talks to the VPS only through the forced-command key served by backup-serve.sh
# (list / manifest / get). Each set lands in $DEST/<TS>/ only after every file
# matches the manifest's size and sha256 and passes a format check.
# Installed by crew/ops/launchd/com.2p.crew-backup-pull.plist (daily 04:15).
set -euo pipefail
DEST=${CREW_PULL_DEST:-$HOME/crew-backups/vps}
KEEP_DAYS=${CREW_PULL_KEEP_DAYS:-14}
TODAY=${CREW_PULL_TODAY:-$(date +%Y%m%d)}
KEY=$HOME/.ssh/crew_backup_pull_ed25519
KNOWN=$HOME/.ssh/crew_backup_pull_known_hosts
VPS=root@100.105.105.12
TS_RE='^[0-9]{8}-[0-9]{4}$'
NAME_RE='^(db-[0-9]{8}-[0-9]{4}\.dump|(paperclip-data|config)-[0-9]{8}-[0-9]{4}\.tar\.gz|issues-[0-9]{8}-[0-9]{4}\.txt)$'

remote() {
  if [ -n "${CREW_PULL_SSH:-}" ]; then
    "$CREW_PULL_SSH" "$@" < /dev/null
  else
    ssh -i "$KEY" -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=15 \
      -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$KNOWN" "$VPS" "$@" < /dev/null
  fi
}

check_file() {
  local file=$1 size=$2 sum=$3 actual_size actual_sum
  actual_size=$(wc -c < "$file" | tr -d ' ')
  actual_sum=$(shasum -a 256 "$file" | cut -d' ' -f1)
  [ "$actual_size" = "$size" ] || { echo "size $actual_size != $size"; return 1; }
  [ "$actual_sum" = "$sum" ] || { echo "sha256 mismatch"; return 1; }
  case "$file" in
    *.tar.gz) gzip -t "$file" 2>/dev/null || { echo "gzip -t failed"; return 1; } ;;
    *.dump) [ "$(head -c 5 "$file")" = PGDMP ] || { echo "not a pg_dump custom archive"; return 1; } ;;
  esac
}

pull_set() {
  local ts=$1 inc="$DEST/.incoming-$1" manifest name size sum why count=0
  rm -rf "$inc"
  mkdir "$inc"
  manifest=$(remote manifest "$ts")
  while read -r name size sum; do
    [ -n "$name" ] || continue
    if ! [[ "$name" =~ $NAME_RE ]]; then
      echo "pull-backup: $ts: unexpected name in manifest: $name" >&2
      rm -rf "$inc"; return 1
    fi
    remote get "$name" > "$inc/$name"
    if ! why=$(check_file "$inc/$name" "$size" "$sum"); then
      echo "pull-backup: $ts: $name failed integrity check ($why)" >&2
      rm -rf "$inc"; return 1
    fi
    count=$((count + 1))
  done <<< "$manifest"
  if [ "$count" -ne 4 ]; then
    echo "pull-backup: $ts: expected 4 files, got $count" >&2
    rm -rf "$inc"; return 1
  fi
  chmod 700 "$inc"
  mv "$inc" "$DEST/$ts"
}

umask 077
mkdir -p "$DEST"
chmod 700 "$DEST"
rm -rf "$DEST"/.incoming-*
CUTOFF=$(date -j -v-"${KEEP_DAYS}"d -f %Y%m%d "$TODAY" +%Y%m%d)

pulled=0 removed=0 failed=0
SETS=$(remote list)
for ts in $SETS; do
  if ! [[ "$ts" =~ $TS_RE ]]; then
    echo "pull-backup: unexpected set name from server: $ts" >&2
    failed=1; continue
  fi
  [ "${ts%%-*}" -ge "$CUTOFF" ] || continue
  [ -d "$DEST/$ts" ] && continue
  if pull_set "$ts"; then pulled=$((pulled + 1)); else failed=1; fi
done

for d in "$DEST"/*; do
  [ -d "$d" ] || continue
  base=${d##*/}
  if [[ "$base" =~ ^([0-9]{8})-[0-9]{4}$ ]] && [ "${BASH_REMATCH[1]}" -lt "$CUTOFF" ]; then
    rm -rf "$d"
    removed=$((removed + 1))
  fi
done

echo "pull-backup $(date '+%Y-%m-%d %H:%M:%S') pulled=$pulled removed=$removed failed=$failed"
exit "$failed"

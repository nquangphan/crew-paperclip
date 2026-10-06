#!/bin/bash
# Forced command for the Mac mini backup-pull key (root authorized_keys on the VPS).
# Read-only access to complete daily backup sets; every other request is refused.
#   list               -> timestamps (YYYYMMDD-HHMM) of complete sets, oldest first
#   manifest <TS>      -> "<name> <bytes> <sha256>" for the 4 files of that set
#   get <name>         -> raw bytes of one file of a set
set -euo pipefail
DIR=${CREW_BACKUP_DIR:-/opt/crew-v3-spike/backups/daily}
CMD=${SSH_ORIGINAL_COMMAND:-}
TS_RE='^[0-9]{8}-[0-9]{4}$'
NAME_RE='^(db-[0-9]{8}-[0-9]{4}\.dump|(paperclip-data|config)-[0-9]{8}-[0-9]{4}\.tar\.gz|issues-[0-9]{8}-[0-9]{4}\.txt)$'

refuse() {
  echo "backup-serve: refused" >&2
  exit 1
}

set_files() {
  printf '%s\n' "db-$1.dump" "paperclip-data-$1.tar.gz" "config-$1.tar.gz" "issues-$1.txt"
}

complete() {
  local f
  for f in $(set_files "$1"); do [ -f "$DIR/$f" ] || return 1; done
}

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

case "$CMD" in
  list)
    for f in "$DIR"/db-*.dump; do
      [ -f "$f" ] || continue
      ts=${f##*/db-}; ts=${ts%.dump}
      if [[ "$ts" =~ $TS_RE ]] && complete "$ts"; then echo "$ts"; fi
    done | sort
    ;;
  "manifest "*)
    ts=${CMD#manifest }
    [[ "$ts" =~ $TS_RE ]] || refuse
    complete "$ts" || refuse
    for f in $(set_files "$ts"); do
      echo "$f $(wc -c < "$DIR/$f" | tr -d ' ') $(sha256 "$DIR/$f")"
    done
    ;;
  "get "*)
    name=${CMD#get }
    [[ "$name" =~ $NAME_RE ]] || refuse
    [ -f "$DIR/$name" ] || refuse
    cat "$DIR/$name"
    ;;
  *)
    refuse
    ;;
esac

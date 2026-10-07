#!/bin/bash
# Prints "healthy" or a short reason for plugin crew.core on the running server container.
# Never trusts a "ready" status left over from before a restart: see plugin-state.py.
# Usage: plugin-state.sh
ROOT=$(cd "$(dirname "$0")/.." && pwd -P)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
STARTED=$(docker inspect crew-v3-spike-server-1 --format '{{.State.StartedAt}}' 2>/dev/null || true)
EPOCH=$(python3 -c 'import sys; from datetime import datetime; s=sys.argv[1]; print(datetime.fromisoformat(s[:19]+"+00:00").timestamp())' "$STARTED" 2>/dev/null || true)
if [ -z "$EPOCH" ]; then echo "container start unknown"; exit 0; fi
"$ROOT/api.sh" GET /plugins/crew.core/health > "$TMP/health.json" 2>/dev/null || true
"$ROOT/api.sh" GET /plugins/crew.core/dashboard > "$TMP/dashboard.json" 2>/dev/null || true
python3 "$ROOT/ops/plugin-state.py" "$TMP/health.json" "$TMP/dashboard.json" "$EPOCH"

#!/bin/bash
# Restores the compose file saved by deploy.sh and recreates the server. Usage: rollback.sh <TS>
set -euo pipefail
ROOT=/opt/crew-v3-spike
TS=$1
cd "$ROOT"
[ -f "docker-compose.yml.bak-$TS" ] || { echo "rollback: no docker-compose.yml.bak-$TS" >&2; exit 2; }
ACTIVE=$("$ROOT/ops/active-runs.sh")
[ -z "$ACTIVE" ] || echo "rollback: WARNING active runs will be interrupted: $ACTIVE" >&2
cp "docker-compose.yml.bak-$TS" docker-compose.yml
docker compose up -d --no-deps server
S=""
for i in $(seq 1 60); do
  S=$(curl -s --max-time 3 http://100.105.105.12:3100/api/health | python3 -c 'import json,sys; print(json.load(sys.stdin).get("status"))' 2>/dev/null || true)
  [ "$S" = ok ] && break
  sleep 2
done
echo "rollback: server image $(docker inspect crew-v3-spike-server-1 --format '{{.Config.Image}}'), health=${S:-none}"
P=$("$ROOT/api.sh" GET /plugins/crew.core/health 2>/dev/null | python3 -c 'import json,sys; d=json.load(sys.stdin); print("healthy" if d.get("healthy") else d.get("status") or "unknown")' 2>/dev/null || true)
echo "rollback: plugin crew.core ${P:-unknown}; if it is in error on an image without the bundle, disable it (POST /plugins/crew.core/disable)"
[ "$S" = ok ] || { echo "rollback: health not ok" >&2; exit 3; }

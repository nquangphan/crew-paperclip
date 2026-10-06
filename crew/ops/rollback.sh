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
echo "rollback: an image without /app/packages/crew-plugin leaves plugin crew.core in error until it is disabled (POST /plugins/<id>/disable); harmless if the API cannot be reached now"
[ "$S" = ok ] || { echo "rollback: health not ok" >&2; exit 3; }

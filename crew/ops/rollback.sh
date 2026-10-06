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
sleep 20
curl -s http://100.105.105.12:3100/api/health | head -c 120; echo
docker inspect crew-v3-spike-server-1 --format '{{.Config.Image}}'

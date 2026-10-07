#!/bin/bash
# Switches the crew-v3-spike server to a new image with a backup first. Usage: deploy.sh <image-tag>
# Exit codes: 2 active runs, 3 server health not ok, 4 image check failed, 5 compose edit failed, 6 plugin crew.core not healthy.
set -euo pipefail
ROOT=/opt/crew-v3-spike
NEW=$1
cd "$ROOT"
ACTIVE=$("$ROOT/ops/active-runs.sh")
[ -z "$ACTIVE" ] || { echo "deploy: active runs, refusing to restart:" >&2; echo "$ACTIVE" >&2; exit 2; }
docker image inspect "$NEW" >/dev/null
INSPECT=$("$ROOT/ops/inspect-image.sh" "$NEW" 2>&1)
echo "$INSPECT"
if printf '%s\n' "$INSPECT" | grep -q -E 'MISSING|FAIL'; then echo "deploy: image check failed, refusing to deploy" >&2; exit 4; fi
if printf '%s\n' "$INSPECT" | grep -q -E '^issues crewCoreHooks=[01]$'; then echo "deploy: issues.js lacks the H2/H4 hooks, refusing to deploy" >&2; exit 4; fi
"$ROOT/ops/backup.sh"
TS=$(date +%Y%m%d-%H%M%S)
cp docker-compose.yml "docker-compose.yml.bak-$TS"
docker inspect crew-v3-spike-server-1 --format '{{.Config.Image}}' > "ops/previous-image-$TS"
python3 "$ROOT/ops/compose-set-image.py" docker-compose.yml "$NEW" || { echo "deploy: could not set the server image" >&2; exit 5; }
docker compose config --quiet
docker compose up -d --no-deps server
S=""
for i in $(seq 1 60); do
  S=$(curl -s --max-time 3 http://100.105.105.12:3100/api/health | python3 -c 'import json,sys; print(json.load(sys.stdin).get("status"))' 2>/dev/null || true)
  [ "$S" = ok ] && break
  sleep 2
done
[ "$S" = ok ] || { echo "deploy: health not ok, run ops/rollback.sh $TS" >&2; exit 3; }
P=""
for i in $(seq 1 30); do
  P=$("$ROOT/api.sh" GET /plugins/crew.core/health 2>/dev/null | python3 -c 'import json,sys; d=json.load(sys.stdin); print("healthy" if d.get("healthy") else d.get("status") or "unknown")' 2>/dev/null || true)
  [ "$P" = healthy ] && break
  sleep 2
done
[ "$P" = healthy ] || { echo "deploy: plugin crew.core not healthy (${P:-no answer}), run ops/rollback.sh $TS" >&2; exit 6; }
echo "plugin crew.core healthy"
echo "deploy ok: $(cat "ops/previous-image-$TS") -> $(docker inspect crew-v3-spike-server-1 --format '{{.Config.Image}}'), rollback TS=$TS"

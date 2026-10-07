#!/bin/bash
# Switches the crew-v3-spike server to a new image with a backup first. Usage: deploy.sh <image-tag>
# Exit codes: 2 active runs, 3 server health not ok, 4 image check failed, 5 compose edit failed, 6 plugin crew.core not healthy,
# 7 Crew policy config missing or invalid, 8 server started with the Crew gates off.
set -euo pipefail
ROOT=/opt/crew-v3-spike
NEW=$1
cd "$ROOT"
. "$ROOT/ops/policy-env.sh"
ACTIVE=$("$ROOT/ops/active-runs.sh")
[ -z "$ACTIVE" ] || { echo "deploy: active runs, refusing to restart:" >&2; echo "$ACTIVE" >&2; exit 2; }
docker image inspect "$NEW" >/dev/null
INSPECT=$("$ROOT/ops/inspect-image.sh" "$NEW" 2>&1)
echo "$INSPECT"
if printf '%s\n' "$INSPECT" | grep -q -E 'MISSING|FAIL'; then echo "deploy: image check failed, refusing to deploy" >&2; exit 4; fi
# Exactly three: the import plus the H2 and H4 call sites. Fewer means an image built without H4.
if ! printf '%s\n' "$INSPECT" | grep -q -E '^issues crewCoreHooks=3$'; then echo "deploy: issues.js does not carry exactly the import and the H2/H4 hooks (crewCoreHooks=3), refusing to deploy" >&2; exit 4; fi
python3 "$ROOT/ops/policy-config.py" file "$POLICY_FILE" || { echo "deploy: Crew policy config $POLICY_FILE is missing or invalid, refusing to deploy (apply-roles.sh policy-config writes it)" >&2; exit 7; }
"$ROOT/ops/backup.sh"
TS=$(date +%Y%m%d-%H%M%S)
cp docker-compose.yml "docker-compose.yml.bak-$TS"
docker inspect crew-v3-spike-server-1 --format '{{.Config.Image}}' > "ops/previous-image-$TS"
python3 "$ROOT/ops/compose-set-image.py" docker-compose.yml "$NEW" || { echo "deploy: could not set the server image" >&2; exit 5; }
write_policy_override
docker compose config --quiet
docker compose up -d --no-deps server
S=""
for i in $(seq 1 60); do
  S=$(curl -s --max-time 3 http://100.105.105.12:3100/api/health | python3 -c 'import json,sys; print(json.load(sys.stdin).get("status"))' 2>/dev/null || true)
  [ "$S" = ok ] && break
  sleep 2
done
[ "$S" = ok ] || { echo "deploy: health not ok, run ops/rollback.sh $TS" >&2; exit 3; }
# The "enabled" log line is info level and may be filtered, so check the container itself: the env is set
# and the file is readable by the container user. The off-warning is still treated as a failure.
POLICY_PATH=$(docker compose exec -T server printenv CREW_POLICY_CONFIG 2>/dev/null | tr -d '\r\n' || true)
[ -n "$POLICY_PATH" ] || { echo "deploy: server container has no CREW_POLICY_CONFIG, run ops/rollback.sh $TS" >&2; exit 8; }
docker compose exec -T server test -r "$POLICY_PATH" || { echo "deploy: server container cannot read the Crew policy config (check file permissions), run ops/rollback.sh $TS" >&2; exit 8; }
docker logs crew-v3-spike-server-1 2>&1 | python3 "$ROOT/ops/policy-config.py" startup-log || { echo "deploy: server started with the Crew gates off, run ops/rollback.sh $TS" >&2; exit 8; }
P=""
for i in $(seq 1 30); do
  P=$("$ROOT/ops/plugin-state.sh" 2>/dev/null || true)
  [ "$P" = healthy ] && break
  sleep 2
done
[ "$P" = healthy ] || { echo "deploy: plugin crew.core not healthy (${P:-no answer}), run ops/rollback.sh $TS" >&2; exit 6; }
echo "plugin crew.core healthy"
echo "deploy ok: $(cat "ops/previous-image-$TS") -> $(docker inspect crew-v3-spike-server-1 --format '{{.Config.Image}}'), rollback TS=$TS"

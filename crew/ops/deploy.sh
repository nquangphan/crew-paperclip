#!/bin/bash
# Switches the crew-v3-spike server to a new image with a backup first. Usage: deploy.sh <image-tag>
set -euo pipefail
ROOT=/opt/crew-v3-spike
NEW=$1
cd "$ROOT"
ACTIVE=$("$ROOT/ops/active-runs.sh")
[ -z "$ACTIVE" ] || { echo "deploy: active runs, refusing to restart:" >&2; echo "$ACTIVE" >&2; exit 2; }
docker image inspect "$NEW" >/dev/null
"$ROOT/ops/backup.sh"
TS=$(date +%Y%m%d-%H%M%S)
cp docker-compose.yml "docker-compose.yml.bak-$TS"
docker inspect crew-v3-spike-server-1 --format '{{.Config.Image}}' > "ops/previous-image-$TS"
python3 - "$NEW" <<'PY'
import re, sys
path = "docker-compose.yml"
text = open(path).read()
block = re.search(r"(?ms)^  server:\n(.*?)(?=^  \S|\Z)", text).group(0)
new_block = re.sub(r"(?m)^(    image:\s*).*$", r"\g<1>" + sys.argv[1], block, count=1)
if "stop_grace_period" not in new_block:
    new_block = new_block.replace("  server:\n", "  server:\n    stop_grace_period: 60s\n", 1)
open(path, "w").write(text.replace(block, new_block))
PY
docker compose config --quiet
docker compose up -d --no-deps server
S=""
for i in $(seq 1 60); do
  S=$(curl -s --max-time 3 http://100.105.105.12:3100/api/health | python3 -c 'import json,sys; print(json.load(sys.stdin).get("status"))' 2>/dev/null || true)
  [ "$S" = ok ] && break
  sleep 2
done
[ "$S" = ok ] || { echo "deploy: health not ok, run ops/rollback.sh $TS" >&2; exit 3; }
echo "deploy ok: $(cat "ops/previous-image-$TS") -> $(docker inspect crew-v3-spike-server-1 --format '{{.Config.Image}}'), rollback TS=$TS"

#!/bin/sh
# Checks a built overlay image before deploy. Usage: inspect-image.sh <image-tag>
docker run --rm --entrypoint sh "$1" -c '
  S=/app/server/dist/services
  for f in heartbeat environment-runtime issues; do printf "%s crewCoreHooks=%s\n" "$f" "$(grep -c crewCoreHooks "$S/$f.js")"; done
  for f in core-hooks remote-stop load-gate ssh-in-place; do [ -f "/app/server/dist/crew/$f.js" ] && echo "crew/$f.js ok" || echo "crew/$f.js MISSING"; done
  [ -f /app/packages/crew-plugin/package.json ] && echo "plugin package ok" || echo "plugin package MISSING"
  cd /app/packages/crew-plugin && node -e "import(\"@paperclipai/plugin-sdk\").then(() => console.log(\"plugin sdk resolves\"), (e) => { console.log(\"plugin sdk FAIL \" + e.message); })"
'

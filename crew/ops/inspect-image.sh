#!/bin/sh
# Checks a built overlay image before deploy. Usage: inspect-image.sh <image-tag>
# The plugin check imports the built worker the way Paperclip runs a local-path plugin worker:
# under the tsx loader (plugin-loader.ts, DEV_TSX_LOADER_PATH), because workspace packages such as
# @paperclipai/shared resolve to TypeScript sources in the image.
docker run --rm --entrypoint sh "$1" -c '
  S=/app/server/dist/services
  for f in heartbeat environment-runtime issues; do printf "%s crewCoreHooks=%s\n" "$f" "$(grep -c crewCoreHooks "$S/$f.js")"; done
  for f in core-hooks remote-stop load-gate ssh-in-place; do [ -f "/app/server/dist/crew/$f.js" ] && echo "crew/$f.js ok" || echo "crew/$f.js MISSING"; done
  [ -f /app/packages/crew-plugin/package.json ] && echo "plugin package ok" || echo "plugin package MISSING"
  LOADER=/app/cli/node_modules/tsx/dist/loader.mjs
  [ -f "$LOADER" ] && echo "tsx loader ok" || echo "tsx loader MISSING"
  cd /app/packages/crew-plugin && node --import "$LOADER" -e "import(\"@paperclipai/plugin-sdk\").then(() => import(\"./dist/manifest.js\")).then((m) => console.log(\"plugin sdk resolves; manifest \" + m.default.id + \" \" + m.default.capabilities.join(\",\")), (e) => { console.log(\"plugin sdk FAIL \" + e.message); })"
'

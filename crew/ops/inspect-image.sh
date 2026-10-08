#!/bin/sh
# Checks a built overlay image before deploy. Usage: inspect-image.sh <image-tag>
# The plugin is a self-contained esbuild bundle: it must import with plain node, without the tsx loader.
docker run --rm --entrypoint sh "$1" -c '
  S=/app/server/dist/services
  for f in heartbeat environment-runtime issues; do printf "%s crewCoreHooks=%s\n" "$f" "$(grep -c crewCoreHooks "$S/$f.js")"; done
  [ "$(grep -c crewCoreHooks "$S/issues.js")" = 3 ] || echo "issues.js FAIL: crewCoreHooks count is not 3 (import + H2 + H4)"
  for f in core-hooks remote-stop load-gate ssh-in-place issue-policy issue-gate issue-create-policy retry-progress handoff-rewake bundle-resume model-policy; do
    [ -f "/app/server/dist/crew/$f.js" ] && echo "crew/$f.js ok" || echo "crew/$f.js MISSING"
  done
  P=/app/packages/crew-plugin
  for f in package.json dist/manifest.js dist/worker.js; do [ -f "$P/$f" ] && echo "plugin $f ok" || echo "plugin $f MISSING"; done
  UI="$P/dist/ui/index.js"
  [ -d "$P/migrations" ] || { echo "plugin migrations MISSING"; exit 1; }
  [ -s "$UI" ] || { echo "plugin dist/ui/index.js MISSING"; exit 1; }
  if grep -q "require(\"react" "$UI"; then echo "plugin UI bundle FAIL: contains require(\"react"; exit 1; fi
  GZIP_BYTES=$(gzip -c "$UI" | wc -c | tr -d " ")
  echo "plugin dist/ui/index.js gzip=${GZIP_BYTES} bytes"
  [ "$GZIP_BYTES" -le 1572864 ] || { echo "plugin UI bundle exceeds 1.5 MiB gzip"; exit 1; }
  # macOS AppleDouble files (._*) shipped by an overlay are read as plugin migrations and break activation.
  APPLEDOUBLE=$(find /app -name "._*" 2>/dev/null | head -3)
  [ -z "$APPLEDOUBLE" ] || { echo "image FAIL: AppleDouble files present: $APPLEDOUBLE"; exit 1; }
  if grep -q -E "from ?[\"]@paperclipai/" "$P/dist/worker.js" "$P/dist/manifest.js" 2>/dev/null; then echo "plugin bundle FAIL: still imports @paperclipai/*"; fi
  cd "$P" && node --input-type=module -e "import(\"./dist/manifest.js\").then((m) => console.log(\"plugin bundle ok; manifest \" + m.default.id + \" \" + m.default.capabilities.join(\",\")), (e) => console.log(\"plugin bundle FAIL \" + e.message))"
'

#!/bin/sh
# Checks a built overlay image before deploy. Usage: inspect-image.sh <image-tag>
# The plugin is a self-contained esbuild bundle: it must import with plain node, without the tsx loader.
docker run --rm --entrypoint sh "$1" -c '
  S=/app/server/dist/services
  for f in heartbeat environment-runtime issues; do printf "%s crewCoreHooks=%s\n" "$f" "$(grep -c crewCoreHooks "$S/$f.js")"; done
  [ "$(grep -c crewCoreHooks "$S/issues.js")" = 3 ] || echo "issues.js FAIL: crewCoreHooks count is not 3 (import + H2 + H4)"
  for f in core-hooks remote-stop load-gate ssh-in-place issue-policy issue-gate issue-create-policy retry-progress; do
    [ -f "/app/server/dist/crew/$f.js" ] && echo "crew/$f.js ok" || echo "crew/$f.js MISSING"
  done
  P=/app/packages/crew-plugin
  for f in package.json dist/manifest.js dist/worker.js; do [ -f "$P/$f" ] && echo "plugin $f ok" || echo "plugin $f MISSING"; done
  if grep -q -E "from ?[\"]@paperclipai/" "$P/dist/worker.js" "$P/dist/manifest.js" 2>/dev/null; then echo "plugin bundle FAIL: still imports @paperclipai/*"; fi
  cd "$P" && node --input-type=module -e "import(\"./dist/manifest.js\").then((m) => console.log(\"plugin bundle ok; manifest \" + m.default.id + \" \" + m.default.capabilities.join(\",\")), (e) => console.log(\"plugin bundle FAIL \" + e.message))"
'

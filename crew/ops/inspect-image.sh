#!/bin/sh
# Checks a built overlay image before deploy. Usage: inspect-image.sh <image-tag> [<commit>]
# Runs on the VPS (deploy.sh, set -e) and on the Mac. Adapter patches P2-P7 (core-hooks.json adapter-patch):
#  - in-image check, always: needs only docker; compares /app files with crew-adapter-expect.json from the overlay tarball.
#  - host check against <commit> (default: fork HEAD): needs node + the fork git repo, so only on the Mac. On the VPS it is
#    skipped with a WARNING (never fails deploy); run `crew/ops/inspect-image.sh <tag> <commit>` from the Mac for the full check.
# The plugin is a self-contained esbuild bundle: it must import with plain node, without the tsx loader.
docker run --rm --entrypoint sh "$1" -c '
  S=/app/server/dist/services
  for f in heartbeat environment-runtime issues; do printf "%s crewCoreHooks=%s\n" "$f" "$(grep -c crewCoreHooks "$S/$f.js")"; done
  [ "$(grep -c crewCoreHooks "$S/issues.js")" = 3 ] || echo "issues.js FAIL: crewCoreHooks count is not 3 (import + H2 + H4)"
  for f in core-hooks remote-stop load-gate ssh-in-place issue-policy issue-gate issue-create-policy retry-progress handoff-rewake bundle-resume model-policy agent-write-guard contributions contribution-routes plugin-data-scope; do
    [ -f "/app/server/dist/crew/$f.js" ] && echo "crew/$f.js ok" || echo "crew/$f.js MISSING"
  done
  grep -q deliverEventAsCall "$S/plugin-worker-manager.js" && echo "plugin events delivered as call ok" || echo "plugin-worker-manager.js FAIL: events still delivered as notification"
  UI_INDEX=/app/server/ui-dist/index.html
  CREW_UI=$(sed -n "s/.*name=\"crew-ui\" content=\"\([0-9a-f]*\)\".*/\1/p" "$UI_INDEX" 2>/dev/null | head -1)
  echo "crew-ui=${CREW_UI:-MISSING}"
  P=/app/packages/crew-plugin
  for f in package.json dist/manifest.js dist/worker.js; do [ -f "$P/$f" ] && echo "plugin $f ok" || echo "plugin $f MISSING"; done
  UI="$P/dist/ui/index.js"
  [ -d "$P/migrations" ] || { echo "plugin migrations MISSING"; exit 1; }
  [ -s "$UI" ] || { echo "plugin dist/ui/index.js MISSING"; exit 1; }
  if grep -q "require(\"react" "$UI"; then echo "plugin UI bundle FAIL: contains require(\"react"; exit 1; fi
  [ -s "$P/dist/ui/guide/img/01-dang-nhap.jpg" ] || { echo "plugin dist/ui/guide/img/01-dang-nhap.jpg MISSING"; exit 1; }
  GZIP_BYTES=$(gzip -c "$UI" | wc -c | tr -d " ")
  echo "plugin dist/ui/index.js gzip=${GZIP_BYTES} bytes"
  [ "$GZIP_BYTES" -le 1572864 ] || { echo "plugin UI bundle exceeds 1.5 MiB gzip"; exit 1; }
  # macOS AppleDouble files (._*) shipped by an overlay are read as plugin migrations and break activation.
  APPLEDOUBLE=$(find /app -name "._*" 2>/dev/null | head -3)
  [ -z "$APPLEDOUBLE" ] || { echo "image FAIL: AppleDouble files present: $APPLEDOUBLE"; exit 1; }
  if grep -q -E "from ?[\"]@paperclipai/" "$P/dist/worker.js" "$P/dist/manifest.js" 2>/dev/null; then echo "plugin bundle FAIL: still imports @paperclipai/*"; fi
  cd "$P" && node --input-type=module -e "import(\"./dist/manifest.js\").then((m) => console.log(\"plugin bundle ok; manifest \" + m.default.id + \" \" + m.default.capabilities.join(\",\")), (e) => console.log(\"plugin bundle FAIL \" + e.message))"
'
RC=$?
# Adapter patches P2-P7, check 1: INSIDE the image (needs only docker): inspect-adapters.mjs is piped into the image's
# node and compares /app files with the sha256/anchor manifest overlay-source.sh shipped (crew-adapter-expect.json).
HERE=$(cd "$(dirname "$0")" && pwd -P)
docker run --rm --entrypoint node -i "$1" --input-type=module - --in-image < "$HERE/inspect-adapters.mjs" || RC=1
# Check 2: against the fork commit. Needs node and the fork git repo (the Mac); the VPS has neither, so it is skipped
# there with a warning - deploy must not stop on it. Run the full check from the Mac before deploying.
if command -v node >/dev/null 2>&1 && git -C "$HERE" rev-parse --git-dir >/dev/null 2>&1; then
  node "$HERE/inspect-adapters.mjs" "$1" ${2:+"$2"} || RC=1
else
  echo "WARNING: host adapter check SKIPPED (no node or no fork git repo on this host); only the in-image check ran"
fi
exit $RC

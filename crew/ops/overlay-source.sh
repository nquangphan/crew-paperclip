#!/bin/bash
# Collects the files the Crew branch changed against the upstream pin, plus the built crew plugin,
# and the built Crew UI (server/ui-dist), and uploads them to the VPS for overlay-job.sh.
# Usage: overlay-source.sh [<commit>] (default HEAD of the fork worktree this script lives in)
# OVERLAY_NO_UPLOAD=1: skip the scp, print the tar path and keep the temp directory.
set -euo pipefail
FORK=$(cd "$(dirname "$0")/../.." && pwd -P)
# The upstream pin is the single source of truth: crew/release/core-hooks.json "base".
BASE=$(node -e 'process.stdout.write(require(process.argv[1]).base)' "$FORK/crew/release/core-hooks.json")
[[ "$BASE" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "overlay: bad base in core-hooks.json: $BASE" >&2; exit 2; }
COMMIT=$(git -C "$FORK" rev-parse "${1:-HEAD}")
SHORT=${COMMIT:0:9}
WORK=$(mktemp -d)
[ "${OVERLAY_NO_UPLOAD:-}" = 1 ] || trap 'rm -rf "$WORK"' EXIT
cd "$FORK"
# Build only what is committed: the worktree must sit exactly on the requested commit, with no local changes.
[ "$(git rev-parse HEAD)" = "$COMMIT" ] || { echo "overlay: worktree HEAD is not $COMMIT" >&2; exit 3; }
[ -z "$(git status --porcelain)" ] || { echo "overlay: worktree has uncommitted changes" >&2; exit 3; }

CHANGED=$(git diff --name-only --diff-filter=ACMR "$BASE" "$COMMIT")
# ui/ (the stock Paperclip UI at /paperclip/) is allowed as a whole: it is built and served by stock-ui.sh, and the
# SHIP list below never includes it, so its changes cannot reach the image.
UNKNOWN=$(printf '%s\n' "$CHANGED" | grep -v -E '^(ui/|server/src/|packages/adapters/claude-local/src/|packages/crew-plugin/|packages/crew-web/|crew/|pnpm-lock\.yaml$|.*\.md$)' || true)
if [ -n "$UNKNOWN" ]; then
  echo "overlay: v3 changes files the overlay cannot ship:" >&2
  printf '%s\n' "$UNKNOWN" >&2
  exit 2
fi

SHIP=$(printf '%s\n' "$CHANGED" | grep -E '^(server/src/|packages/adapters/claude-local/src/)' | grep -v -E '\.test\.ts$|/__tests__/' || true)
mkdir -p "$WORK/app"
printf '%s\n' "$SHIP" | grep -E '^server/src/.*\.ts$' | sed 's#^server/##' > "$WORK/app/crew-transpile.txt" || true
echo "$COMMIT" > "$WORK/app/crew-commit.txt"
echo "$BASE" > "$WORK/app/crew-base.txt"
if [ -n "$SHIP" ]; then git archive --format=tar "$COMMIT" $SHIP | tar -x -C "$WORK/app"; fi

# The bundle resolves @paperclipai/plugin-sdk from its built dist.
corepack pnpm --filter @paperclipai/plugin-sdk ensure-build-deps
corepack pnpm --filter @crew/paperclip-plugin build
test -s packages/crew-plugin/dist/ui/index.js || { echo "overlay: crew plugin UI bundle missing" >&2; exit 2; }
git archive --format=tar "$COMMIT" packages/crew-plugin/package.json | tar -x -C "$WORK/app"
OUTDIR=$(node -e 'const p=require("./packages/crew-plugin/package.json"); console.log(require("path").dirname(p.paperclipPlugin.worker))')
cp -R "packages/crew-plugin/$OUTDIR" "$WORK/app/packages/crew-plugin/$OUTDIR"
cp -R packages/crew-plugin/migrations "$WORK/app/packages/crew-plugin/migrations"
test -s "$WORK/app/packages/crew-plugin/dist/ui/index.js" || { echo "overlay: UI bundle not copied" >&2; exit 2; }
# cp -R of dist/ above already carries the whole dist/ui/ tree; the guide images must be part of it.
test -s "$WORK/app/packages/crew-plugin/dist/ui/guide/img/01-dang-nhap.jpg" || { echo "overlay: guide images not copied" >&2; exit 2; }

# The Crew UI imports @crew/paperclip-plugin/shared/* from source, so it builds after the plugin. The marker
# proves the bundle was built for exactly this commit.
CREW_UI_COMMIT=$COMMIT corepack pnpm --filter @crew/paperclip-web build
grep -q "name=\"crew-ui\" content=\"$COMMIT\"" packages/crew-web/dist/index.html 2>/dev/null \
  || { echo "overlay: crew-ui marker missing or wrong commit" >&2; exit 2; }
mkdir -p "$WORK/app/server/ui-dist" && cp -R packages/crew-web/dist/. "$WORK/app/server/ui-dist/"
test -s "$WORK/app/server/ui-dist/index.html" || { echo "overlay: UI index.html not copied" >&2; exit 2; }

COPYFILE_DISABLE=1 tar --no-xattrs --no-mac-metadata -C "$WORK/app" -czf "$WORK/overlay-$SHORT.tar.gz" .
if [ "${OVERLAY_NO_UPLOAD:-}" = 1 ]; then
  echo "overlay source $SHORT built, not uploaded: $WORK/overlay-$SHORT.tar.gz"
  exit 0
fi
scp -q "$WORK/overlay-$SHORT.tar.gz" nhamoiplatform:/opt/crew-v3-spike/ops/
echo "overlay source $SHORT uploaded ($(grep -c . "$WORK/app/crew-transpile.txt" || true) server files to transpile)"

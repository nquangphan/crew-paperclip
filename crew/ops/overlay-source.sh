#!/bin/bash
# Collects the files the Crew branch changed against the upstream pin, plus the built crew plugin,
# and uploads them to the VPS for overlay-job.sh. Usage: overlay-source.sh [<commit>] (default HEAD of the fork worktree this script lives in)
set -euo pipefail
FORK=$(cd "$(dirname "$0")/../.." && pwd -P)
BASE=v2026.1001.0
COMMIT=$(git -C "$FORK" rev-parse "${1:-HEAD}")
SHORT=${COMMIT:0:9}
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
cd "$FORK"
# Build only what is committed: the worktree must sit exactly on the requested commit, with no local changes.
[ "$(git rev-parse HEAD)" = "$COMMIT" ] || { echo "overlay: worktree HEAD is not $COMMIT" >&2; exit 3; }
[ -z "$(git status --porcelain)" ] || { echo "overlay: worktree has uncommitted changes" >&2; exit 3; }

CHANGED=$(git diff --name-only --diff-filter=ACMR "$BASE" "$COMMIT")
UNKNOWN=$(printf '%s\n' "$CHANGED" | grep -v -E '^(server/src/|packages/adapters/claude-local/src/|packages/crew-plugin/|crew/|pnpm-lock\.yaml$|.*\.md$)' || true)
if [ -n "$UNKNOWN" ]; then
  echo "overlay: v3 changes files the overlay cannot ship:" >&2
  printf '%s\n' "$UNKNOWN" >&2
  exit 2
fi

SHIP=$(printf '%s\n' "$CHANGED" | grep -E '^(server/src/|packages/adapters/claude-local/src/)' | grep -v -E '\.test\.ts$|/__tests__/' || true)
mkdir -p "$WORK/app"
printf '%s\n' "$SHIP" | grep -E '^server/src/.*\.ts$' | sed 's#^server/##' > "$WORK/app/crew-transpile.txt" || true
echo "$COMMIT" > "$WORK/app/crew-commit.txt"
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

COPYFILE_DISABLE=1 tar --no-xattrs --no-mac-metadata -C "$WORK/app" -czf "$WORK/overlay-$SHORT.tar.gz" .
scp -q "$WORK/overlay-$SHORT.tar.gz" nhamoiplatform:/opt/crew-v3-spike/ops/
echo "overlay source $SHORT uploaded ($(grep -c . "$WORK/app/crew-transpile.txt" || true) server files to transpile)"

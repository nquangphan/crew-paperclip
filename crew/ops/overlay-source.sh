#!/bin/bash
# Collects the files the Crew branch changed against the upstream pin, plus the built crew plugin,
# and uploads them to the VPS for overlay-job.sh. Usage: overlay-source.sh [<commit>] (default crew/r1-1)
set -euo pipefail
FORK=/Users/phannhatquang/Documents/projects/crew/.worktrees/paperclip-r1-1
BASE=v2026.1001.0
COMMIT=$(git -C "$FORK" rev-parse "${1:-crew/r1-1}")
SHORT=${COMMIT:0:9}
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
cd "$FORK"

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

corepack pnpm --filter @crew/paperclip-plugin build
git archive --format=tar "$COMMIT" packages/crew-plugin/package.json | tar -x -C "$WORK/app"
OUTDIR=$(node -e 'const p=require("./packages/crew-plugin/package.json"); console.log(require("path").dirname(p.paperclipPlugin.worker))')
cp -R "packages/crew-plugin/$OUTDIR" "$WORK/app/packages/crew-plugin/$OUTDIR"

tar -C "$WORK/app" -czf "$WORK/overlay-$SHORT.tar.gz" .
scp -q "$WORK/overlay-$SHORT.tar.gz" nhamoiplatform:/opt/crew-v3-spike/ops/
echo "overlay source $SHORT uploaded ($(grep -c . "$WORK/app/crew-transpile.txt" || true) server files to transpile)"

#!/usr/bin/env bash
# Verify a merged Paperclip fork tree: hook anchors, build prerequisites, Crew patch tests, typecheck.
# Stops at the first red step. Run from the root of the worktree. No cargo needed.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$ROOT" ] || [ "$ROOT" != "$(pwd -P)" ]; then
  echo "Chạy verify.sh từ gốc worktree (đang ở $(pwd -P))" >&2
  exit 70
fi

run() {
  local code="$1"
  shift
  echo "== $*"
  if ! "$@"; then
    echo "ĐỎ (mã $code): $*" >&2
    exit "$code"
  fi
}

run 3 node crew/release/check-core-hooks.mjs
run 3 node --test crew/release/check-core-hooks.test.mjs
run 4 corepack pnpm install
run 4 corepack pnpm --filter @paperclipai/plugin-sdk ensure-build-deps
run 4 corepack pnpm --filter @paperclipai/paperclip-runner run build:typescript
run 5 corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew- src/adapters/plugin-loader.test.ts
run 5 corepack pnpm --filter @paperclipai/adapter-claude-local exec vitest run src/server/execute.remote.crew.test.ts src/server/session-codec.crew.test.ts src/server/execute.remote.test.ts
run 6 corepack pnpm --filter @paperclipai/server exec tsc --noEmit
run 6 corepack pnpm --filter @paperclipai/adapter-claude-local exec tsc --noEmit
run 6 corepack pnpm --filter @crew/paperclip-plugin exec tsc --noEmit
run 6 corepack pnpm --filter @crew/paperclip-plugin build
echo "XANH: mốc hook đủ, test vá và typecheck đạt"

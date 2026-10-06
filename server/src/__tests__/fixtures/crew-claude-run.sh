#!/bin/sh
# TEST FIXTURE. Copy of apps/crew-mac/assets/crew-claude-run.sh in the Crew repo (MS-1).
# Keep the contract identical: $PWD/.paperclip-runtime/runs/<runId>/{pgid,started}, UUID check, exec.
# Crew wrapper for claude_local on the Mac (adapterConfig.command).
# Records this run's process group so the server (H3) and crew-mac (MS-2) can stop
# the whole run later, then becomes the agent CLI. The SSH session already gives
# this process its own group, and every exec in the chain keeps the same PID.
if [ -n "${PAPERCLIP_RUN_ID:-}" ]; then
  case "$PAPERCLIP_RUN_ID" in
    *[!0-9a-fA-F-]*) ;;
    *)
      dir="$PWD/.paperclip-runtime/runs/$PAPERCLIP_RUN_ID"
      if mkdir -p "$dir" 2>/dev/null; then
        date +%s > "$dir/started"
        ps -o pgid= -p $$ | tr -d ' ' > "$dir/pgid.tmp" && mv "$dir/pgid.tmp" "$dir/pgid"
      fi
      ;;
  esac
fi
exec "${CREW_CLAUDE_BIN:-claude}" "$@"

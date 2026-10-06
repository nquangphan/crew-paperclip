#!/bin/sh
# TEST FIXTURE. Copy of apps/crew-mac/assets/crew-claude-run.sh in the Crew repo (branch r1-1/crew-mac, 2f0f5c5d).
# Keep it in sync: $PWD/.paperclip-runtime/runs/<runId>/{pgid,started}, started = birth time of this process.
# Crew wrapper for claude_local on the Mac (adapterConfig.command).
# Records this run's process group so the server (H3) and the crew-mac orphan reaper can stop
# the whole run later, then becomes the agent CLI. The SSH session already gives
# this process its own group, and every exec in the chain keeps the same PID.
if [ -n "${PAPERCLIP_RUN_ID:-}" ]; then
  case "$PAPERCLIP_RUN_ID" in
    *[!0-9a-fA-F-]*) ;;
    *)
      dir="$PWD/.paperclip-runtime/runs/$PAPERCLIP_RUN_ID"
      if mkdir -p "$dir" 2>/dev/null; then
        # started = the time THIS process was born (epoch seconds), not the time this line runs:
        # the SSH session sources the owner's profile before exec'ing the wrapper, and a slow
        # profile would otherwise push started past the birth of the session leader.
        elapsed=$(ps -o etime= -p $$ | awk -F'[-:]' '{ n = NF; s = $n + $(n-1) * 60; if (n >= 3) s += $(n-2) * 3600; if (n >= 4) s += $(n-3) * 86400; print s }')
        echo $(( $(date +%s) - ${elapsed:-0} )) > "$dir/started.tmp" && mv "$dir/started.tmp" "$dir/started"
        ps -o pgid= -p $$ | tr -d ' ' > "$dir/pgid.tmp" && mv "$dir/pgid.tmp" "$dir/pgid"
      fi
      ;;
  esac
fi
exec "${CREW_CLAUDE_BIN:-claude}" "$@"

#!/bin/sh
# Every 10 s: runs of an issue (VPS) and the run's processes on the Mac (port 22).
# Usage: watch-run.sh <issueId> <seconds> <logfile>
ISSUE=$1; DUR=$2; LOG=$3
END=$(( $(date +%s) + DUR ))
while [ "$(date +%s)" -lt "$END" ]; do
  {
    echo "=== $(date +%T)"
    ssh -o BatchMode=yes -o ConnectTimeout=8 nhamoiplatform "cd /opt/crew-v3-spike && ./api.sh GET /issues/$ISSUE/runs | python3 -c 'import json,sys; d=json.load(sys.stdin); [print(r.get(\"runId\") or r.get(\"id\"), r.get(\"status\"), r.get(\"errorCode\")) for r in (d if isinstance(d,list) else d.get(\"runs\",[]))]'; ./api.sh GET /issues/$ISSUE | python3 -c 'import json,sys; print(\"issue\", json.load(sys.stdin).get(\"status\"))'" 2>&1 | sed 's/^/vps: /'
    ssh -o BatchMode=yes -o ConnectTimeout=8 phannhatquang@100.102.189.67 \
      'setopt nullglob 2>/dev/null; for f in ~/crew-agents/*/.paperclip-runtime/runs/*/pgid ~/crew-spike/worktrees/*/.paperclip-runtime/runs/*/pgid; do [ -f "$f" ] && echo "pgidfile $f $(cat "$f")"; done; ps -o pid,ppid,pgid,etime,command -U $(id -u) | grep -E "claude --print|crew-agents/|worktrees/|time.sleep" | grep -v grep | cut -c1-160' 2>&1 | sed 's/^/mac: /'
  } >> "$LOG"
  sleep 10
done

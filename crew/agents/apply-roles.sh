#!/bin/bash
# Applies Crew roles on the crew-v3-spike server. Run on the VPS.
#
#   apply-roles.sh agent <agentId> <executor|reviewer|integrator> <pinned plugin dir on the Mac>
#       Pins Superpowers in adapterConfig.extraArgs and uploads the role's instructions as AGENTS.md.
#   apply-roles.sh policy-config <companyId> <reviewerAgentId> <integratorAgentId> <ownerUserId> [config file]
#       Prints the CREW_POLICY_CONFIG JSON with the company's roles (merged into the file when it exists).
#       With a file argument the result is written there in place; otherwise it goes to stdout.
#       The server reads the file on every gated write, so no restart is needed unless the mount is new.
#
# Roles are not stored on the agents: the server decides reviewer, integrator and owner from the config file.
set -euo pipefail
ROOT=${CREW_SPIKE_ROOT:-/opt/crew-v3-spike}
HERE=$(cd "$(dirname "$0")" && pwd -P)

die() { echo "apply-roles: $*" >&2; exit 2; }
need_node() { command -v node >/dev/null 2>&1 || die "node is required on this host (run the scripts from a machine with node and copy the output)"; }

cmd=${1:-}
[ -n "$cmd" ] && shift
case "$cmd" in
  agent)
    [ $# -eq 3 ] || die "usage: agent <agentId> <executor|reviewer|integrator> <pinned plugin dir>"
    AGENT=$1; ROLE=$2; PIN=$3
    case "$ROLE" in executor|reviewer|integrator) ;; *) die "role must be executor, reviewer or integrator";; esac
    case "$PIN" in /*/.crew/workflows/superpowers/*) ;; *) die "pin dir must be <home>/.crew/workflows/superpowers/<version>-<rev>";; esac
    [ -f "$HERE/$ROLE.md" ] || die "missing $HERE/$ROLE.md"
    need_node
    BODY=$("$ROOT/api.sh" GET "/agents/$AGENT" | node "$HERE/merge-agent-config.mjs" "$PIN")
    "$ROOT/api.sh" PATCH "/agents/$AGENT" "$BODY" >/dev/null
    FILE=$(node -e 'process.stdout.write(JSON.stringify({ path: "AGENTS.md", content: require("fs").readFileSync(process.argv[1], "utf8") }))' "$HERE/$ROLE.md")
    "$ROOT/api.sh" PUT "/agents/$AGENT/instructions-bundle/file" "$FILE" >/dev/null
    "$ROOT/api.sh" GET "/agents/$AGENT" | node -e 'const a = JSON.parse(require("fs").readFileSync(0, "utf8")); console.log(`apply-roles: ${a.name} role='"$ROLE"' extraArgs=${JSON.stringify(a.adapterConfig?.extraArgs ?? [])}`)'
    ;;
  policy-config)
    [ $# -ge 4 ] && [ $# -le 5 ] || die "usage: policy-config <companyId> <reviewerAgentId> <integratorAgentId> <ownerUserId> [config file]"
    need_node
    OUT=${5:-}
    if [ -z "$OUT" ]; then
      node "$HERE/policy-config.mjs" "$1" "$2" "$3" "$4"
    else
      TMP=$(mktemp "$OUT.XXXXXX")
      trap 'rm -f "$TMP"' EXIT
      if [ -s "$OUT" ]; then
        node "$HERE/policy-config.mjs" "$1" "$2" "$3" "$4" "$OUT" > "$TMP"
      else
        node "$HERE/policy-config.mjs" "$1" "$2" "$3" "$4" > "$TMP"
      fi
      # Written in place (not renamed over): a single-file bind mount keeps pointing at the old inode after a rename.
      cat "$TMP" > "$OUT"
      rm -f "$TMP"
      trap - EXIT
      echo "apply-roles: wrote $OUT for company $1"
    fi
    ;;
  *) die "usage: apply-roles.sh agent|policy-config ... (see the header of this file)";;
esac

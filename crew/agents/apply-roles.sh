#!/bin/bash
# Applies Crew roles on the crew-v3-spike server. Run on the VPS.
#
#   apply-roles.sh agent <agentId> <executor|reviewer|integrator> <pinned plugin dir on the Mac>
#       Pins Superpowers in adapterConfig.extraArgs and uploads the role's instructions as AGENTS.md.
#       Exits non-zero when the server's answer to either write does not match what was sent.
#   apply-roles.sh policy-config <companyId> <reviewerAgentId> <integratorAgentId> <ownerUserId> [config file]
#       Prints the CREW_POLICY_CONFIG JSON holding only that company (copying it over the live file drops the
#       other companies). With a file argument the company is merged into that file, a .bak copy is kept and the
#       file is rewritten in place. The server rereads the file on every gated write; no restart is needed.
#
# Roles are not stored on the agents: the server decides reviewer, integrator and owner from the config file.
set -euo pipefail
ROOT=${CREW_SPIKE_ROOT:-/opt/crew-v3-spike}
HERE=$(cd "$(dirname "$0")" && pwd -P)

die() { echo "apply-roles: $*" >&2; exit 2; }
need_node() { command -v node >/dev/null 2>&1 || die "node is required on this host (run the scripts from a machine with node and copy the output)"; }

write_config() { # <companyId> <reviewer> <integrator> <owner> <file>; run under the lock when flock exists
  local out=$5 tmp
  tmp=$(mktemp "$out.XXXXXX")
  trap 'rm -f "$tmp"' EXIT
  if [ -s "$out" ]; then
    node "$HERE/policy-config.mjs" "$1" "$2" "$3" "$4" "$out" > "$tmp"
    cp -p "$out" "$out.bak"
  else
    node "$HERE/policy-config.mjs" "$1" "$2" "$3" "$4" > "$tmp"
  fi
  [ -s "$tmp" ] && node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$tmp" || die "generated config is empty or not JSON; $out left untouched"
  # Written in place (not renamed over): a single-file bind mount keeps pointing at the old inode after a rename.
  cat "$tmp" > "$out"
  rm -f "$tmp"
  trap - EXIT
  echo "apply-roles: wrote $out for company $1"
}

cmd=${1:-}
[ -n "$cmd" ] && shift
case "$cmd" in
  agent)
    [ $# -eq 3 ] || die "usage: agent <agentId> <executor|reviewer|integrator> <pinned plugin dir>"
    AGENT=$1; ROLE=$2; PIN=$3
    case "$ROLE" in executor|reviewer|integrator) ;; *) die "role must be executor, reviewer or integrator";; esac
    case "$PIN" in */..|*/../*|*/.) die "pin dir must not contain . or .. segments";; esac
    case "$PIN" in /*/.crew/workflows/superpowers/*) ;; *) die "pin dir must be <home>/.crew/workflows/superpowers/<version>-<rev>";; esac
    [ -f "$HERE/$ROLE.md" ] || die "missing $HERE/$ROLE.md"
    need_node
    CURRENT=$("$ROOT/api.sh" GET "/agents/$AGENT")
    BODY=$(printf '%s' "$CURRENT" | node "$HERE/merge-agent-config.mjs" "$PIN") || die "refusing to patch agent $AGENT (see the message above); nothing was written"
    EXPECTED=$(printf '%s' "$BODY" | node -e 'process.stdout.write(JSON.stringify(JSON.parse(require("fs").readFileSync(0, "utf8")).adapterConfig.extraArgs))')
    "$ROOT/api.sh" PATCH "/agents/$AGENT" "$BODY" | node "$HERE/verify-result.mjs" patch "$EXPECTED" || die "PATCH of agent $AGENT did not take effect"
    FILE=$(node -e 'process.stdout.write(JSON.stringify({ path: "AGENTS.md", content: require("fs").readFileSync(process.argv[1], "utf8") }))' "$HERE/$ROLE.md")
    "$ROOT/api.sh" PUT "/agents/$AGENT/instructions-bundle/file" "$FILE" | node "$HERE/verify-result.mjs" write || die "upload of $ROLE.md for agent $AGENT failed"
    echo "apply-roles: $AGENT role=$ROLE extraArgs=$EXPECTED"
    ;;
  policy-config)
    [ $# -ge 4 ] && [ $# -le 5 ] || die "usage: policy-config <companyId> <reviewerAgentId> <integratorAgentId> <ownerUserId> [config file]"
    need_node
    OUT=${5:-}
    if [ -z "$OUT" ]; then
      node "$HERE/policy-config.mjs" "$1" "$2" "$3" "$4"
    elif command -v flock >/dev/null 2>&1; then
      (flock -x 9; write_config "$1" "$2" "$3" "$4" "$OUT") 9>"$OUT.lock"
    else
      write_config "$1" "$2" "$3" "$4" "$OUT"
    fi
    ;;
  *) die "usage: apply-roles.sh agent|policy-config ... (see the header of this file)";;
esac

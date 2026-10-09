#!/bin/bash
# Applies Crew roles on the crew-v3-spike server. Run on the VPS.
#
#   apply-roles.sh agent <agentId> <executor|reviewer|integrator> <pinned plugin dir on the Mac>
#   apply-roles.sh agent <agentId> assistant <pinned plugin dir on the Mac> <executorId,executorId>
#       Uploads the role's instructions as AGENTS.md (with the current file's hash as baseHash, which the server
#       requires for the entry file), then pins Superpowers in adapterConfig.extraArgs. Upload goes first and the
#       current file is read before anything is written, so a refused upload leaves the agent untouched.
#       The assistant's AGENTS.md gets the executor list appended by render-instructions.mjs.
#       Exits non-zero when the server's answer to either write does not match what was sent.
#   apply-roles.sh policy-config <companyId> <reviewerAgentId> <integratorAgentId> <ownerUserId> [config file] [--tracking <projectId,projectId>]
#       Prints the CREW_POLICY_CONFIG JSON holding only that company (copying it over the live file drops the
#       other companies). With a file argument the company is merged into that file, a .bak copy is kept and the
#       file is rewritten in place. The server rereads the file on every gated write; no restart is needed.
#       --tracking sets trackingProjectIds: root issues the board creates in those projects get no Crew policy
#       (a project for following development work). Omitted, the company's existing list is kept; "" clears it.
#
# Roles are not stored on the agents: the server decides reviewer, integrator and owner from the config file.
set -euo pipefail
ROOT=${CREW_SPIKE_ROOT:-/opt/crew-v3-spike}
HERE=$(cd "$(dirname "$0")" && pwd -P)

die() { echo "apply-roles: $*" >&2; exit 2; }
need_node() { command -v node >/dev/null 2>&1 || die "node is required on this host (run the scripts from a machine with node and copy the output)"; }

TRACK=()
write_config() { # <companyId> <reviewer> <integrator> <owner> <file>; run under the lock when flock exists
  local out=$5 tmp
  tmp=$(mktemp "$out.XXXXXX")
  trap 'rm -f "$tmp"' EXIT
  if [ -s "$out" ]; then
    node "$HERE/policy-config.mjs" "$1" "$2" "$3" "$4" "$out" ${TRACK[@]+"${TRACK[@]}"} > "$tmp"
    cp -p "$out" "$out.bak"
  else
    node "$HERE/policy-config.mjs" "$1" "$2" "$3" "$4" ${TRACK[@]+"${TRACK[@]}"} > "$tmp"
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
    [ $# -eq 3 ] || [ $# -eq 4 ] || die "usage: agent <agentId> <executor|reviewer|integrator|assistant> <pinned plugin dir> [executorId,executorId for assistant]"
    AGENT=$1; ROLE=$2; PIN=$3; EXECUTORS=${4:-}
    case "$ROLE" in executor|reviewer|integrator|assistant) ;; *) die "role must be executor, reviewer, integrator or assistant";; esac
    if [ "$ROLE" = assistant ] && [ -z "$EXECUTORS" ]; then die "assistant needs the executor agent ids (comma-separated)"; fi
    if [ "$ROLE" != assistant ] && [ -n "$EXECUTORS" ]; then die "only assistant takes an executor list"; fi
    case "$PIN" in */..|*/../*|*/.) die "pin dir must not contain . or .. segments";; esac
    case "$PIN" in /*/.crew/workflows/superpowers/*) ;; *) die "pin dir must be <home>/.crew/workflows/superpowers/<version>-<rev>";; esac
    [ -f "$HERE/$ROLE.md" ] || die "missing $HERE/$ROLE.md"
    need_node
    FILE=$(node "$HERE/render-instructions.mjs" "$ROLE" "$HERE/$ROLE.md" "$AGENT" "$EXECUTORS") || die "cannot render $ROLE.md for agent $AGENT; nothing was uploaded"
    CURRENT=$("$ROOT/api.sh" GET "/agents/$AGENT")
    BODY=$(printf '%s' "$CURRENT" | node "$HERE/merge-agent-config.mjs" "$PIN") || die "refusing to patch agent $AGENT (see the message above); nothing was written"
    EXPECTED=$(printf '%s' "$BODY" | node -e 'process.stdout.write(JSON.stringify(JSON.parse(require("fs").readFileSync(0, "utf8")).adapterConfig.extraArgs))')
    ENTRY=$("$ROOT/api.sh" GET "/agents/$AGENT/instructions-bundle/file?path=AGENTS.md")
    FILE_TMP=$(mktemp "${TMPDIR:-/tmp}/apply-roles.XXXXXX")
    trap 'rm -f "$FILE_TMP"' EXIT
    printf '%s' "$FILE" > "$FILE_TMP"
    UPLOAD=$(printf '%s' "$ENTRY" | node "$HERE/add-base.mjs" "$FILE_TMP") || die "cannot read the current AGENTS.md of agent $AGENT; nothing was written"
    rm -f "$FILE_TMP"; trap - EXIT
    "$ROOT/api.sh" PUT "/agents/$AGENT/instructions-bundle/file" "$UPLOAD" | node "$HERE/verify-result.mjs" write || die "upload of $ROLE.md for agent $AGENT failed; extraArgs were not changed"
    "$ROOT/api.sh" PATCH "/agents/$AGENT" "$BODY" | node "$HERE/verify-result.mjs" patch "$EXPECTED" || die "PATCH of agent $AGENT did not take effect (AGENTS.md was already uploaded; rerun is safe)"
    echo "apply-roles: $AGENT role=$ROLE extraArgs=$EXPECTED${EXECUTORS:+ executors=$EXECUTORS}"
    ;;
  policy-config)
    USAGE="usage: policy-config <companyId> <reviewerAgentId> <integratorAgentId> <ownerUserId> [config file] [--tracking <projectId,projectId>]"
    if [ $# -ge 2 ] && [ "${*: -2:1}" = "--tracking" ]; then
      TRACK=(--tracking "${*: -1}")
      set -- "${@:1:$(($# - 2))}"
    fi
    [ $# -ge 4 ] && [ $# -le 5 ] || die "$USAGE"
    need_node
    OUT=${5:-}
    if [ -z "$OUT" ]; then
      node "$HERE/policy-config.mjs" "$1" "$2" "$3" "$4" ${TRACK[@]+"${TRACK[@]}"}
    elif command -v flock >/dev/null 2>&1; then
      (flock -x 9; write_config "$1" "$2" "$3" "$4" "$OUT") 9>"$OUT.lock"
    else
      write_config "$1" "$2" "$3" "$4" "$OUT"
    fi
    ;;
  *) die "usage: apply-roles.sh agent|policy-config ... (see the header of this file)";;
esac

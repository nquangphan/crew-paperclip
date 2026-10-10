#!/bin/bash
# Applies Crew roles on the crew-v3-spike server. Run on the VPS.
#
#   apply-roles.sh agent <agentId> <executor|reviewer|integrator> <pinned plugin dir on the Mac>
#   apply-roles.sh agent <agentId> bmad <pinned BMAD dir on the Mac>
#   apply-roles.sh agent <agentId> <executor-codex|executor-opencode|reviewer-codex> <pinned plugin dir on the Mac>
#       The three slots added by the Codex/OpenCode runtimes (crew_project_roles codex_executor_agent_id,
#       opencode_executor_agent_id, codex_reviewer_agent_id). They upload executor.md or reviewer.md, and the agent's
#       adapterType must be codex_local, opencode_local and codex_local respectively. Codex and OpenCode agents get no --plugin-dir:
#       their wrapper exports CREW_SUPERPOWERS_DIR. A Codex agent needs env.CODEX_HOME outside companies/<companyId>
#       and no OPENAI_API_KEY (merge-agent-config.mjs refuses otherwise).
#   apply-roles.sh agent <agentId> assistant <pinned plugin dir on the Mac> <executorId[:runtime],...> [<bmadId,bmadId> [<codexReviewerId>]]
#       An executor without ":runtime" has its runtime read from the agent's adapterType; the rendered list prints the
#       runtime for every line. <codexReviewerId> is the project's reviewer-codex agent (leave the BMAD list empty
#       with "" to pass only the reviewer).
#       Uploads the role's instructions as AGENTS.md (with the current file's hash as baseHash, which the server
#       requires for the entry file), then pins Superpowers in adapterConfig.extraArgs. Upload goes first and the
#       current file is read before anything is written, so a refused upload leaves the agent untouched.
#       The assistant's AGENTS.md gets the executor list and the BMAD agent list appended by render-instructions.mjs.
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

agent_runtime() { # <agentId>: prints the adapterType from the server, fails on anything else
  "$ROOT/api.sh" GET "/agents/$1" | node -e '
    const a = JSON.parse(require("fs").readFileSync(0, "utf8"));
    if (!a || typeof a.id !== "string" || !["claude_local", "codex_local", "opencode_local"].includes(a.adapterType ?? "claude_local")) process.exit(1);
    process.stdout.write(a.adapterType ?? "claude_local");' 2>/dev/null
}

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
    [ $# -ge 3 ] && [ $# -le 6 ] || die "usage: agent <agentId> <executor|reviewer|integrator|assistant|bmad|executor-codex|executor-opencode|reviewer-codex> <pinned plugin dir> [executorId[:runtime],... [bmadId,bmadId [codexReviewerId]]: assistant only]"
    AGENT=$1; ROLE=$2; PIN=$3; EXECUTORS=${4:-}; BMADS=${5:-}; REVIEWER_CODEX=${6:-}
    # TEMPLATE is the instructions file; RUNTIME is the adapterType the slot demands.
    case "$ROLE" in
      executor|reviewer|integrator|assistant|bmad) TEMPLATE=$ROLE; RUNTIME=claude_local;;
      executor-codex) TEMPLATE=executor; RUNTIME=codex_local;;
      executor-opencode) TEMPLATE=executor; RUNTIME=opencode_local;;
      reviewer-codex) TEMPLATE=reviewer; RUNTIME=codex_local;;
      *) die "role must be executor, reviewer, integrator, assistant, bmad, executor-codex, executor-opencode or reviewer-codex";;
    esac
    if [ "$ROLE" = assistant ] && [ -z "$EXECUTORS" ]; then die "assistant needs the executor agent ids (comma-separated)"; fi
    if [ "$ROLE" != assistant ] && [ -n "$EXECUTORS" ]; then die "only assistant takes an executor list"; fi
    if [ "$ROLE" != assistant ] && [ -n "$BMADS" ]; then die "only assistant takes a BMAD agent list"; fi
    if [ "$ROLE" != assistant ] && [ -n "$REVIEWER_CODEX" ]; then die "only assistant takes a Codex reviewer"; fi
    case "$PIN" in */..|*/../*|*/.) die "pin dir must not contain . or .. segments";; esac
    if [ "$ROLE" = bmad ]; then
      case "$PIN" in /*/.crew/workflows/bmad/*) ;; *) die "role bmad needs the pinned BMAD dir: <home>/.crew/workflows/bmad/<version>-<rev>";; esac
    else
      case "$PIN" in /*/.crew/workflows/superpowers/*) ;; *) die "role $ROLE needs the pinned Superpowers dir: <home>/.crew/workflows/superpowers/<version>-<rev>";; esac
    fi
    [ -f "$HERE/$TEMPLATE.md" ] || die "missing $HERE/$TEMPLATE.md"
    need_node
    if [ "$ROLE" = assistant ]; then
      # Bare executor ids get their runtime from the agent's adapterType; the reviewer-codex agent must be codex_local.
      RESOLVED=""
      IFS=',' read -r -a EXEC_LIST <<< "$EXECUTORS"
      for entry in ${EXEC_LIST[@]+"${EXEC_LIST[@]}"}; do
        entry=${entry// /}
        [ -n "$entry" ] || continue
        case "$entry" in *:*) ;; *) entry="$entry:$(agent_runtime "$entry")" || die "cannot read the runtime of executor $entry; nothing was written";; esac
        RESOLVED=${RESOLVED:+$RESOLVED,}$entry
      done
      EXECUTORS=$RESOLVED
      if [ -n "$REVIEWER_CODEX" ]; then
        [ "$(agent_runtime "$REVIEWER_CODEX")" = codex_local ] || die "Codex reviewer $REVIEWER_CODEX must be a codex_local agent; nothing was written"
      fi
    fi
    FILE=$(node "$HERE/render-instructions.mjs" "$ROLE" "$HERE/$TEMPLATE.md" "$AGENT" "$EXECUTORS" "$BMADS" "$REVIEWER_CODEX") || die "cannot render $TEMPLATE.md for agent $AGENT; nothing was uploaded"
    CURRENT=$("$ROOT/api.sh" GET "/agents/$AGENT")
    BODY=$(printf '%s' "$CURRENT" | node "$HERE/merge-agent-config.mjs" "$PIN" "$RUNTIME") || die "refusing to patch agent $AGENT (see the message above); nothing was written"
    EXPECTED=$(printf '%s' "$BODY" | node -e 'process.stdout.write(JSON.stringify(JSON.parse(require("fs").readFileSync(0, "utf8")).adapterConfig.extraArgs))')
    ENTRY=$("$ROOT/api.sh" GET "/agents/$AGENT/instructions-bundle/file?path=AGENTS.md")
    FILE_TMP=$(mktemp "${TMPDIR:-/tmp}/apply-roles.XXXXXX")
    trap 'rm -f "$FILE_TMP"' EXIT
    printf '%s' "$FILE" > "$FILE_TMP"
    UPLOAD=$(printf '%s' "$ENTRY" | node "$HERE/add-base.mjs" "$FILE_TMP") || die "cannot read the current AGENTS.md of agent $AGENT; nothing was written"
    rm -f "$FILE_TMP"; trap - EXIT
    "$ROOT/api.sh" PUT "/agents/$AGENT/instructions-bundle/file" "$UPLOAD" | node "$HERE/verify-result.mjs" write || die "upload of $TEMPLATE.md for agent $AGENT failed; extraArgs were not changed"
    "$ROOT/api.sh" PATCH "/agents/$AGENT" "$BODY" | node "$HERE/verify-result.mjs" patch "$EXPECTED" || die "PATCH of agent $AGENT did not take effect (AGENTS.md was already uploaded; rerun is safe)"
    echo "apply-roles: $AGENT role=$ROLE extraArgs=$EXPECTED${EXECUTORS:+ executors=$EXECUTORS}${BMADS:+ bmad=$BMADS}${REVIEWER_CODEX:+ reviewer-codex=$REVIEWER_CODEX}"
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

#!/bin/bash
# Compares the company ids in CREW_POLICY_CONFIG (crew-policy.json) with the companies the crew.core plugin
# config rows map (instanceConfig.companies: one config row per company, each listing its own items).
# Prints only short ids. Exit 0 when equal ("ok N company"), 1 when they differ, 2 when it cannot read a side.
# Runs on the VPS from /opt/crew-v3-spike/ops/. Env (tests): CREW_ROOT (default: parent of this script's directory).
set -uo pipefail
OPS=$(cd "$(dirname "$0")" && pwd -P)
ROOT=${CREW_ROOT:-$(cd "$OPS/.." && pwd -P)}
API=$ROOT/api.sh
POLICY_FILE=$ROOT/crew-policy/crew-policy.json
PLUGIN=crew.core
die() { echo "check-crew-companies: $*" >&2; exit 2; }

[ -x "$API" ] || die "missing api.sh"
policy_ids=$(python3 "$OPS/policy-config.py" list-companies "$POLICY_FILE") || die "policy file unreadable"

ids_py='import json, re, sys
data = json.load(sys.stdin)
mode = sys.argv[1]
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)
if mode == "companies":
    items = data if isinstance(data, list) else []
    ids = [i.get("id") for i in items if isinstance(i, dict)]
else:
    config = data.get("configJson") if isinstance(data, dict) else None
    ids = [i.get("companyId") for i in ((config or {}).get("companies") or []) if isinstance(i, dict)]
for i in ids:
    if isinstance(i, str) and UUID.match(i):
        print(i.lower())'

all_companies=$("$API" GET /companies </dev/null | python3 -c "$ids_py" companies) || die "cannot list companies"
plugin_ids=""
for cid in $all_companies; do
  row=$("$API" GET "/plugins/$PLUGIN/config?companyId=$cid" </dev/null) || die "cannot read plugin config of ${cid:0:8}"
  plugin_ids+=$(printf '%s' "$row" | python3 -c "$ids_py" row)$'\n'
done
plugin_ids=$(printf '%s' "$plugin_ids" | grep . | sort -u || true)
policy_ids=$(printf '%s\n' "$policy_ids" | grep . | sort -u || true)

only_policy=$(comm -23 <(printf '%s\n' "$policy_ids") <(printf '%s\n' "$plugin_ids") | grep . || true)
only_plugin=$(comm -13 <(printf '%s\n' "$policy_ids") <(printf '%s\n' "$plugin_ids") | grep . || true)
if [ -z "$only_policy" ] && [ -z "$only_plugin" ]; then
  echo "ok $(printf '%s\n' "$policy_ids" | grep -c .) company"
  exit 0
fi
short_list() { printf '%s\n' "$1" | grep . | cut -c1-8 | paste -sd, - | sed 's/,/, /g'; }
[ -z "$only_policy" ] || echo "lệch: chỉ trong CREW_POLICY_CONFIG: $(short_list "$only_policy")"
[ -z "$only_plugin" ] || echo "lệch: chỉ trong plugin: $(short_list "$only_plugin")"
exit 1

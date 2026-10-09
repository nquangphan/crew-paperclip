#!/bin/bash
# Sets up the "Crew E2E" company used by the UI acceptance runs. Idempotent: every run creates only what is
# missing and prints short ids, never secret values.
#
# Usage:
#   e2e-company.sh prod   on the VPS, from /opt/crew-v3-spike/ops/ (REST through ../api.sh, board session)
#   e2e-company.sh mac    on the Mac mini: bare origin and a clone under ~/crew-e2e
#
# prod: company "Crew E2E"; secret crew-e2e-ssh (the server's SSH private key for the Mac, read from the key file
# on stdin, never on a command line); secret crew-e2e-status (status webhook secret, value kept in
# <root>/crew-e2e/status-webhook-secret, mode 600, for `crew-mac status add-target --secret-stdin`); template
# environment crew-e2e-template copied from the TPS SSH environment; label `research`; two placeholder role agents
# that never run (heartbeat off, wakeOnDemand off), because the policy parser requires company-level reviewer and
# integrator ids; the company entry in crew-policy.json (TPS entry untouched, backup first); the crew.core plugin
# config row of this company (the TPS row is a separate row and is checked unchanged).
# It never creates issues and never deletes anything (deleting an environment also deletes its SSH secret).
#
# Env (tests): CREW_ROOT (default: parent of this script's directory), CREW_E2E_HOME, CREW_DOCS_BUNDLE,
# CREW_DOCS_RUNTIME.
set -euo pipefail
OPS=$(cd "$(dirname "$0")" && pwd -P)
NAME="Crew E2E"
SSH_SECRET=crew-e2e-ssh
STATUS_SECRET=crew-e2e-status
ENV_NAME=crew-e2e-template
REVIEWER=crew-e2e-reviewer
INTEGRATOR=crew-e2e-integrator
PLUGIN=crew.core

PY=$(cat <<'PYEOF'
import json, os, re, shutil, stat, sys, time

UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)


def fail(message):
    print(message, file=sys.stderr)
    sys.exit(1)


def read_json():
    text = sys.stdin.read()
    try:
        return json.loads(text)
    except ValueError:
        fail("not JSON: " + text.strip()[:200])


def error_of(data):
    if isinstance(data, dict):
        return str(data.get("error") or data.get("message") or "no id in response")[:200]
    return "unexpected response"


def live(item):
    return item.get("status") != "archived" and not item.get("deletedAt")


def cmd_find(field, value):
    """Prints the id of the first live item of a JSON list whose <field> equals <value>, or nothing."""
    data = read_json()
    if not isinstance(data, list):
        fail("list expected: " + error_of(data))
    for item in data:
        if isinstance(item, dict) and item.get(field) == value and live(item):
            print(item["id"])
            return


def cmd_get(*keys):
    """Prints the given top-level fields of a JSON object, one per line; fails with the server error if `id` is missing."""
    data = read_json()
    if not isinstance(data, dict) or not data.get("id"):
        fail(error_of(data))
    for key in keys:
        print(data.get(key, ""))


def cmd_secret_body(name, description):
    """Builds a create-secret body; the value is the whole of stdin, kept byte for byte."""
    value = sys.stdin.read()
    if not value.strip():
        fail("empty secret value")
    json.dump({"name": name, "description": description, "value": value}, sys.stdout)


def cmd_rotate_body():
    value = sys.stdin.read()
    if not value.strip():
        fail("empty secret value")
    json.dump({"value": value}, sys.stdout)


def cmd_env_body(name, secret_id):
    """Copies host, port, user and known hosts of the TPS template SSH environment (list on stdin)."""
    envs = [e for e in read_json() if isinstance(e, dict)]
    def usable(e):
        c = e.get("config") or {}
        ref = c.get("privateKeySecretRef") or {}
        meta = e.get("metadata") or {}
        return (e.get("driver") == "ssh" and e.get("status") == "active" and ref.get("secretId") != secret_id
                and meta.get("workspaceRealizationMode") == "in_place" and c.get("host") and c.get("username"))
    candidates = [e for e in envs if usable(e)]
    candidates.sort(key=lambda e: e.get("name") != "mac-mini")
    if not candidates:
        fail("no active in_place SSH environment to copy")
    c = candidates[0]["config"]
    config = {
        "host": c["host"],
        "port": c.get("port", 22),
        "username": c["username"],
        "remoteWorkspacePath": "/Users/%s/crew-e2e/repo" % c["username"],
        "privateKeySecretRef": {"type": "secret_ref", "secretId": secret_id, "version": "latest"},
    }
    for key in ("knownHosts", "strictHostKeyChecking"):
        if key in c:
            config[key] = c[key]
    json.dump({
        "name": name,
        "description": "Environment mẫu của company Crew E2E (wizard chép host/khóa từ đây)",
        "driver": "ssh",
        "config": config,
        "metadata": {"workspaceRealizationMode": "in_place", "crewLoadGate": {"maxLoad1": 8, "maxWaitMinutes": 60}},
    }, sys.stdout)


def cmd_label_color(name, fallback):
    for label in read_json():
        if isinstance(label, dict) and label.get("name") == name and re.match(r"^#[0-9a-fA-F]{6}$", str(label.get("color"))):
            print(label["color"])
            return
    print(fallback)


def cmd_agent_body(name, title):
    json.dump({
        "name": name,
        "title": title,
        "adapterType": "process",
        "adapterConfig": {"command": "true"},
        "runtimeConfig": {"heartbeat": {"enabled": False, "wakeOnDemand": False}},
    }, sys.stdout)


def cmd_agent_idle_check():
    """Fails unless the agent (object on stdin) cannot start a run: heartbeat off and wakeOnDemand off."""
    agent = read_json()
    hb = ((agent or {}).get("runtimeConfig") or {}).get("heartbeat") or {}
    if hb.get("enabled") is not False or hb.get("wakeOnDemand") is not False:
        fail("agent %s can start runs (heartbeat %s)" % (str(agent.get("id"))[:8], json.dumps(hb)))


def valid_entry(entry):
    return (isinstance(entry, dict)
            and UUID.match(str(entry.get("reviewerAgentId", ""))) and UUID.match(str(entry.get("integratorAgentId", "")))
            and str(entry["reviewerAgentId"]).lower() != str(entry["integratorAgentId"]).lower()
            and isinstance(entry.get("ownerUserId"), str) and entry["ownerUserId"].strip())


def cmd_policy_tps(path, tps_id):
    with open(path) as f:
        companies = json.load(f).get("companies") or {}
    if not valid_entry(companies.get(tps_id)):
        fail("policy file has no valid TPS entry " + tps_id[:8])


def cmd_policy(path, company_id, tps_id, reviewer, integrator, stamp):
    """Adds the company to crew-policy.json when it has no valid entry; keeps every other entry byte-equal in meaning."""
    with open(path) as f:
        before = json.load(f)
    companies = before.get("companies")
    if not isinstance(companies, dict):
        fail("policy file has no companies object")
    tps = companies.get(tps_id)
    if not valid_entry(tps):
        fail("policy file has no valid TPS entry " + tps_id[:8])
    if valid_entry(companies.get(company_id)):
        print("present")
        return
    backup = "%s.bak-e2e-%s" % (path, stamp)
    shutil.copy2(path, backup)
    after = json.loads(json.dumps(before))
    after["companies"][company_id] = {
        "reviewerAgentId": reviewer,
        "integratorAgentId": integrator,
        "ownerUserId": tps["ownerUserId"],
        "trackingProjectIds": [],
    }
    tmp = "%s.tmp-e2e-%d" % (path, os.getpid())
    with open(tmp, "w") as f:
        json.dump(after, f, indent=2)
        f.write("\n")
    # The server container reads this file as another user: keep the old mode, not the umask of this script.
    os.chmod(tmp, stat.S_IMODE(os.stat(path).st_mode))
    os.replace(tmp, path)
    with open(path) as f:
        check = json.load(f)
    for key, value in before["companies"].items():
        if check["companies"].get(key) != value:
            fail("policy entry %s changed while writing" % key[:8])
    print("updated " + backup)


def item_for(config, company_id):
    for item in (config or {}).get("companies") or []:
        if isinstance(item, dict) and item.get("companyId") == company_id:
            return item
    return None


def cmd_plugin_ok(company_id, secret_id):
    """Exit 0 when the plugin config row (stdin) already maps the company to the status secret."""
    row = read_json()
    config = row.get("configJson") if isinstance(row, dict) else None
    item = item_for(config, company_id)
    ref = (item or {}).get("webhookSecretRef") or {}
    sys.exit(0 if ref.get("type") == "secret_ref" and ref.get("secretId") == secret_id else 1)


def cmd_plugin_body(company_id, secret_id):
    """Body for POST /plugins/:id/config: the current row (stdin) with this company's item set, other items kept."""
    row = read_json()
    config = row.get("configJson") if isinstance(row, dict) and isinstance(row.get("configJson"), dict) else {}
    config = json.loads(json.dumps(config))
    items = [i for i in (config.get("companies") or []) if not (isinstance(i, dict) and i.get("companyId") == company_id)]
    items.append({"companyId": company_id,
                  "webhookSecretRef": {"type": "secret_ref", "secretId": secret_id, "version": "latest"}})
    config["companies"] = items
    json.dump({"companyId": company_id, "configJson": config}, sys.stdout)


def cmd_config_of():
    """Canonical configJson of a plugin config row (stdin), for before/after comparison."""
    row = read_json()
    config = row.get("configJson") if isinstance(row, dict) else None
    print(json.dumps(config, sort_keys=True))


def cmd_probe_ok():
    data = read_json()
    if not (isinstance(data, dict) and data.get("ok") is True):
        fail("probe failed: " + (str(data.get("summary") or data.get("error") or "")[:200] if isinstance(data, dict) else "?"))


COMMANDS = {
    "find": cmd_find, "get": cmd_get, "secret-body": cmd_secret_body, "rotate-body": cmd_rotate_body,
    "env-body": cmd_env_body, "label-color": cmd_label_color, "agent-body": cmd_agent_body,
    "agent-idle-check": cmd_agent_idle_check, "policy-tps": cmd_policy_tps, "policy": cmd_policy, "plugin-ok": cmd_plugin_ok,
    "plugin-body": cmd_plugin_body, "config-of": cmd_config_of, "probe-ok": cmd_probe_ok,
}

if __name__ == "__main__":
    COMMANDS[sys.argv[1]](*sys.argv[2:])
PYEOF
)
j() { python3 -c "$PY" "$@"; }
short() { printf '%s' "${1:0:8}"; }
die() { echo "e2e: $*" >&2; exit 1; }

# api METHOD PATH [@-]: through the board-session shim; with @- the body is read from stdin (curl --data @-).
api() { "$API" "$@" </dev/null; }
api_body() { "$API" "$1" "$2" @-; }

prod() {
  ROOT=${CREW_ROOT:-$(cd "$OPS/.." && pwd -P)}
  API=$ROOT/api.sh
  KEY_FILE=$ROOT/ssh/paperclip_ed25519
  POLICY_FILE=$ROOT/crew-policy/crew-policy.json
  STATE=$ROOT/crew-e2e
  STATUS_FILE=$STATE/status-webhook-secret
  STAMP=$(date +%Y%m%d-%H%M%S)
  umask 077
  [ -x "$API" ] || die "missing $API"
  [ -r "$KEY_FILE" ] || die "missing SSH key file"
  python3 "$OPS/policy-config.py" file "$POLICY_FILE" || die "policy file invalid before any change"
  mkdir -p "$STATE"
  chmod 700 "$STATE"
  exec 9> "$STATE/.lock"
  flock -n 9 2>/dev/null || [ "$(uname)" = Darwin ] || die "another run is in progress"

  local companies tps cid prefix out
  companies=$(api GET /companies)
  tps=$(printf '%s' "$companies" | j find issuePrefix TPS)
  [ -n "$tps" ] || die "TPS company not found"
  # The new entry copies the TPS owner: check it before creating anything.
  j policy-tps "$POLICY_FILE" "$tps" || die "policy file unusable"

  # 1. Company.
  cid=$(printf '%s' "$companies" | j find name "$NAME")
  if [ -z "$cid" ]; then
    out=$(printf '%s' '{"name":"Crew E2E","description":"Company nghiệm thu UI Crew (Playwright, chế độ stub). Không dùng cho việc thật."}' \
      | api_body POST /companies) || die "create company failed"
    cid=$(printf '%s' "$out" | j get id) || die "create company failed"
    echo "company created $(short "$cid")"
  else
    echo "company present $(short "$cid")"
  fi
  prefix=$(api GET "/companies/$cid" | j get issuePrefix) || die "read company failed"
  echo "company prefix $prefix"

  # 2. Secrets. The SSH private key goes from the key file to the API on stdin only.
  local secrets ssh_id status_id
  secrets=$(api GET "/companies/$cid/secrets")
  ssh_id=$(printf '%s' "$secrets" | j find name "$SSH_SECRET")
  if [ -z "$ssh_id" ]; then
    out=$(j secret-body "$SSH_SECRET" "Khóa SSH server dùng để vào Mac mini (company Crew E2E)" < "$KEY_FILE" \
      | api_body POST "/companies/$cid/secrets") || die "create SSH secret failed"
    ssh_id=$(printf '%s' "$out" | j get id) || die "create SSH secret failed"
    echo "secret $SSH_SECRET created $(short "$ssh_id")"
  else
    echo "secret $SSH_SECRET present $(short "$ssh_id")"
  fi

  status_id=$(printf '%s' "$secrets" | j find name "$STATUS_SECRET")
  if [ ! -s "$STATUS_FILE" ]; then
    python3 -c 'import secrets; print(secrets.token_hex(32))' > "$STATUS_FILE.tmp"
    chmod 600 "$STATUS_FILE.tmp"
    mv "$STATUS_FILE.tmp" "$STATUS_FILE"
    if [ -n "$status_id" ]; then
      # The value on the server cannot be read back: rotate it to the new local value.
      out=$(j rotate-body < "$STATUS_FILE" | api_body POST "/secrets/$status_id/rotate") || die "rotate status secret failed"
      printf '%s' "$out" | j get id >/dev/null || die "rotate status secret failed"
      echo "secret $STATUS_SECRET rotated $(short "$status_id")"
    fi
  fi
  if [ -z "$status_id" ]; then
    out=$(j secret-body "$STATUS_SECRET" "Secret webhook bản tin máy của company Crew E2E" < "$STATUS_FILE" \
      | api_body POST "/companies/$cid/secrets") || die "create status secret failed"
    status_id=$(printf '%s' "$out" | j get id) || die "create status secret failed"
    echo "secret $STATUS_SECRET created $(short "$status_id")"
  else
    echo "secret $STATUS_SECRET present $(short "$status_id")"
  fi

  # 3. Template environment (environments are instance-wide; matched by name).
  local envs env_id
  envs=$(api GET "/companies/$cid/environments")
  env_id=$(printf '%s' "$envs" | j find name "$ENV_NAME")
  if [ -z "$env_id" ]; then
    out=$(printf '%s' "$envs" | j env-body "$ENV_NAME" "$ssh_id" | api_body POST "/companies/$cid/environments") \
      || die "create environment failed"
    env_id=$(printf '%s' "$out" | j get id) || die "create environment failed"
    echo "environment created $(short "$env_id")"
  else
    echo "environment present $(short "$env_id")"
  fi
  api POST "/environments/$env_id/probe" | j probe-ok || die "environment $(short "$env_id") probe failed"
  echo "environment probe ok"

  # 4. Label research (colour copied from TPS).
  local label_id color
  label_id=$(api GET "/companies/$cid/labels" | j find name research)
  if [ -z "$label_id" ]; then
    color=$(api GET "/companies/$tps/labels" | j label-color research '#6b7280')
    out=$(printf '{"name":"research","color":"%s"}' "$color" | api_body POST "/companies/$cid/labels") \
      || die "create label failed"
    label_id=$(printf '%s' "$out" | j get id) || die "create label failed"
    echo "label research created $(short "$label_id")"
  else
    echo "label research present $(short "$label_id")"
  fi

  # 5. Placeholder reviewer/integrator: the policy entry needs two agent ids; these never start a run.
  local agents name title id reviewer_id="" integrator_id=""
  agents=$(api GET "/companies/$cid/agents")
  for name in "$REVIEWER" "$INTEGRATOR"; do
    id=$(printf '%s' "$agents" | j find name "$name")
    if [ -z "$id" ]; then
      title="Giữ chỗ vai trò mặc định của company (không chạy run)"
      out=$(j agent-body "$name" "$title" | api_body POST "/companies/$cid/agents") || die "create agent $name failed"
      id=$(printf '%s' "$out" | j get id) || die "create agent $name failed"
      echo "agent $name created $(short "$id")"
    else
      echo "agent $name present $(short "$id")"
    fi
    api GET "/agents/$id" | j agent-idle-check || die "agent $name is not idle-only"
    if [ "$name" = "$REVIEWER" ]; then reviewer_id=$id; else integrator_id=$id; fi
  done

  # 6. Crew policy file (re-read by the server on every call: no restart needed).
  out=$(j policy "$POLICY_FILE" "$cid" "$tps" "$reviewer_id" "$integrator_id" "$STAMP") || die "policy update failed"
  python3 "$OPS/policy-config.py" file "$POLICY_FILE" || die "policy file invalid after update"
  case $out in
    present) echo "policy present" ;;
    *) echo "policy updated (backup ${out#updated })" ;;
  esac

  # 7. Plugin config row of this company; the TPS row must not change.
  local tps_before tps_after row
  tps_before=$(api GET "/plugins/$PLUGIN/config?companyId=$tps" | j config-of)
  row=$(api GET "/plugins/$PLUGIN/config?companyId=$cid")
  if printf '%s' "$row" | j plugin-ok "$cid" "$status_id"; then
    echo "plugin config present"
  else
    printf '%s\n' "$row" > "$STATE/plugin-config-before-$STAMP.json"
    out=$(printf '%s' "$row" | j plugin-body "$cid" "$status_id" | api_body POST "/plugins/$PLUGIN/config") \
      || die "plugin config failed"
    printf '%s' "$out" | j get id >/dev/null || die "plugin config failed"
    api GET "/plugins/$PLUGIN/config?companyId=$cid" | j plugin-ok "$cid" "$status_id" || die "plugin config not saved"
    echo "plugin config updated"
  fi
  tps_after=$(api GET "/plugins/$PLUGIN/config?companyId=$tps" | j config-of)
  [ "$tps_before" = "$tps_after" ] || die "TPS plugin config changed"
  echo "e2e ok company $(short "$cid") prefix $prefix"
}

mac() {
  local home=${CREW_E2E_HOME:-$HOME/crew-e2e}
  local bundle=${CREW_DOCS_BUNDLE:-$HOME/.crew/bin/crew-docs.cjs}
  local runtime=${CREW_DOCS_RUNTIME:-$(command -v node || true)}
  [ -f "$bundle" ] || die "crew-docs bundle not found: $bundle"
  [ -n "$runtime" ] || die "node not found for crew-docs"
  mkdir -p "$home"
  if [ ! -d "$home/origin.git" ]; then
    git init -q --bare -b main "$home/origin.git"
    echo "origin created"
  else
    echo "origin present"
  fi
  if [ ! -d "$home/repo/.git" ]; then
    git clone -q "$home/origin.git" "$home/repo" 2>/dev/null
    echo "repo cloned"
  else
    echo "repo present"
  fi
  cd "$home/repo"
  git config crew-docs.bundle "$bundle"
  git config crew-docs.runtime "$runtime"
  if ! git rev-parse -q --verify HEAD >/dev/null; then
    git symbolic-ref HEAD refs/heads/main
    cat > README.md <<'MD'
# Repo thử Crew E2E

Repo dùng cho nghiệm thu UI Crew (company Crew E2E). Origin là repo bare cục bộ `~/crew-e2e/origin.git`.
Không chứa việc thật.
MD
    "$runtime" "$bundle" init >/dev/null
    "$runtime" "$bundle" check --all >/dev/null || die "crew-docs check failed in the new repo"
    git add README.md AGENTS.md CLAUDE.md docs
    git -c core.hooksPath=/dev/null commit -q -m "chore: khởi tạo repo thử Crew E2E" -m "Crew-Docs-Init: true"
    echo "repo initial commit $(git rev-parse --short HEAD)"
  fi
  if [ "$(git ls-remote origin refs/heads/main | cut -f1)" != "$(git rev-parse HEAD)" ]; then
    git push -q origin HEAD:main
    git branch -q --set-upstream-to=origin/main main 2>/dev/null || true
    echo "origin main pushed"
  else
    echo "origin main present"
  fi
  "$runtime" "$bundle" check --all >/dev/null || die "crew-docs check failed"
  echo "e2e mac ok $(git rev-parse --short HEAD)"
}

case ${1:-} in
  prod) prod ;;
  mac) mac ;;
  *) echo "usage: e2e-company.sh prod|mac" >&2; exit 2 ;;
esac

#!/bin/bash
# Puts the agent-facing guard rails of Crew companies in place through the board REST API, idempotently.
# Usage: agent-permissions.sh <companyId|--all-crew> [--check|--dry-run] [--assistant <agentId>]...
#
# For each company (one uuid, or every company of the Crew policy config with --all-crew):
#   - every non-terminated agent: permissions canCreateAgents=false, canCreateSkills=false; the `tasks:assign`
#     grant only for agents that are the assistant of a project (crew.core project roles) or named with
#     --assistant (Trợ Lý of a project that still uses file roles, without a crew.core roles row);
#   - company skill policy: a deny rule for every agent on every skills.* action (board keeps defaultEffect);
#   - inbox agent policy of the owner (ownerUserId of the policy config): mode "disabled";
#   - read-only checks: no agent with role "ceo", trust preset per agent, no pipeline, no tool connection.
# --check (alias --dry-run) only reads. Bodies go to api.sh on stdin (`api.sh METHOD PATH @-`, curl --data @-),
# never on a command line. Prints agent ids shortened to 8 characters, never tokens or cookies.
# Exit codes: 0 everything matches (after applying), 1 something differs (--check) or needs the owner
# (role ceo, pipeline, tool connection, low trust preset), 2 usage, config or API error.
# Env: CREW_OPS_ROOT (default: parent of this script's directory, /opt/crew-v3-spike on the VPS),
# CREW_API_SH (default $CREW_OPS_ROOT/api.sh), CREW_POLICY_FILE (default $CREW_OPS_ROOT/crew-policy/crew-policy.json).
set -euo pipefail
ROOT=${CREW_OPS_ROOT:-$(cd "$(dirname "$0")/.." && pwd -P)}
export CREW_API_SH=${CREW_API_SH:-$ROOT/api.sh}
export CREW_POLICY_FILE=${CREW_POLICY_FILE:-$ROOT/crew-policy/crew-policy.json}

exec python3 - "$@" <<'PY'
import json, re, subprocess, sys

UUID_RE = re.compile(r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')

USAGE = "Usage: agent-permissions.sh <companyId|--all-crew> [--check|--dry-run] [--assistant <agentId>]..."
SKILL_ACTIONS = ["skills.create", "skills.import", "skills.install", "skills.edit",
                 "skills.update", "skills.test", "skills.reset", "skills.remove"]
SKILL_RULE = {"id": "crew-deny-agent-skill-writes", "priority": -1000000, "effect": "deny",
              "subject": {"type": "all_agents"}, "actions": SKILL_ACTIONS}
API = __import__("os").environ["CREW_API_SH"]
POLICY_FILE = __import__("os").environ["CREW_POLICY_FILE"]


class ApiError(Exception):
    pass


def usage(message=None):
    if message:
        print(message, file=sys.stderr)
    print(USAGE, file=sys.stderr)
    sys.exit(2)


def call(method, path, body=None):
    args = [API, method, path]
    if body is not None:
        args.append("@-")
    r = subprocess.run(args, input=None if body is None else json.dumps(body, ensure_ascii=False),
                       stdin=subprocess.DEVNULL if body is None else None,
                       capture_output=True, text=True)
    if r.returncode != 0:
        raise ApiError(f"{method} {path}: api.sh exit {r.returncode}")
    try:
        data = json.loads(r.stdout)
    except ValueError:
        raise ApiError(f"{method} {path}: response is not JSON")
    if isinstance(data, dict) and "error" in data:
        raise ApiError(f"{method} {path}: {str(data.get('error'))[:200]}")
    return data


def short(agent_id):
    return str(agent_id)[:8]


def flag(value):
    return "on" if value else "off"


def trust_of(permissions):
    policy = permissions.get("authorizationPolicy") if isinstance(permissions.get("authorizationPolicy"), dict) else {}
    if isinstance(policy.get("trustBoundary"), dict):
        return "trust-boundary"
    return permissions.get("trustPreset") or policy.get("trustPreset") or "standard"


def assistants_of(company_id):
    ids = set()
    projects = call("GET", f"/companies/{company_id}/projects")
    if not isinstance(projects, list):
        raise ApiError("projects: unexpected response")
    for project in projects:
        data = call("GET", f"/plugins/crew.core/api/projects/{project['id']}/roles?companyId={company_id}")
        roles = data.get("roles") if isinstance(data, dict) else None
        if isinstance(roles, dict) and roles.get("assistantAgentId"):
            ids.add(str(roles["assistantAgentId"]).lower())
    return ids


def do_agents(company_id, apply, extra_assistants):
    differs = warn = False
    assistants = assistants_of(company_id) | extra_assistants
    agents = call("GET", f"/companies/{company_id}/agents")
    if not isinstance(agents, list):
        raise ApiError("agents: unexpected response")
    print("agent     tên  role  trust  tạo-agent  tạo-skill  tasks:assign  (trước -> sau)")
    for listed in sorted(agents, key=lambda a: str(a.get("name"))):
        if listed.get("status") == "terminated":
            continue
        agent = call("GET", f"/agents/{listed['id']}")
        permissions = agent.get("permissions") if isinstance(agent.get("permissions"), dict) else {}
        grants = (agent.get("access") or {}).get("grants") or []
        before = (permissions.get("canCreateAgents") is True,
                  permissions.get("canCreateSkills") is not False,
                  any(g.get("permissionKey") == "tasks:assign" for g in grants))
        is_assistant = str(agent["id"]).lower() in assistants
        after = (False, False, is_assistant)
        trust = trust_of(permissions)
        notes = []
        if agent.get("role") == "ceo":
            notes.append("CẢNH BÁO role ceo (vượt mọi kiểm canCreateAgents; board phải đổi role)")
            warn = True
        if trust != "standard":
            notes.append(f"CẢNH BÁO trust {trust}")
            warn = True
        if agent.get("status") == "pending_approval":
            notes.append("pending_approval: chờ board duyệt rồi chạy lại")
            warn = True
            after = before
        change = before != after
        line = (f"{short(agent['id'])} {agent.get('name')}  {agent.get('role')}  {trust}  "
                f"{flag(before[0])}->{flag(after[0])}  {flag(before[1])}->{flag(after[1])}  "
                f"{flag(before[2])}->{flag(after[2])}{'  [Trợ Lý]' if is_assistant else ''}")
        print(line + ("  " + "; ".join(notes) if notes else "") + ("" if change else "  (đúng)"))
        if not change:
            continue
        if apply:
            call("PATCH", f"/agents/{agent['id']}/permissions",
                 {"canCreateAgents": False, "canCreateSkills": False, "canAssignTasks": is_assistant})
        else:
            differs = True
    return differs, warn


def do_skill_policy(company_id, apply):
    policy = call("GET", f"/companies/{company_id}/skill-policy")
    rules = policy.get("rules") or []
    if policy.get("materialized") and SKILL_RULE in rules:
        print(f"skill-policy: đã có rule {SKILL_RULE['id']} (revision {policy.get('revision')})")
        return False
    print(f"skill-policy: thêm rule {SKILL_RULE['id']} deny mọi skills.* cho mọi agent "
          f"(defaultEffect {policy.get('defaultEffect')}, revision {policy.get('revision')})")
    if not apply:
        return True
    call("PUT", f"/companies/{company_id}/skill-policy", {
        "schemaVersion": 1,
        "defaultEffect": policy.get("defaultEffect") or "allow",
        "rules": [r for r in rules if r.get("id") != SKILL_RULE["id"]] + [SKILL_RULE],
        "expectedRevision": policy.get("revision", 0),
    })
    return False


def do_inbox(company_id, owner, apply):
    path = f"/companies/{company_id}/users/{owner}/inbox-agent-policy"
    policy = call("GET", path)
    if policy.get("mode") == "disabled":
        print("inbox: policy của owner đã disabled")
        return False
    print(f"inbox: policy của owner {policy.get('mode')} -> disabled")
    if not apply:
        return True
    call("PUT", path, {"mode": "disabled", "allowedAgentIds": []})
    return False


def do_checks(company_id):
    pipelines = call("GET", f"/companies/{company_id}/pipelines")
    connections = call("GET", f"/companies/{company_id}/tools/connections")
    n_pipelines = len(pipelines) if isinstance(pipelines, list) else -1
    n_connections = len((connections or {}).get("connections") or []) if isinstance(connections, dict) else -1
    print(f"pipeline: {n_pipelines}; tool connection: {n_connections}")
    if n_pipelines or n_connections:
        print("CẢNH BÁO company Crew phải không có pipeline/case và tool connection (báo owner)")
        return True
    return False


def main(argv):
    check = False
    extra_assistants = set()
    rest = []
    args = list(argv)
    while args:
        arg = args.pop(0)
        if arg in ("--check", "--dry-run"):
            check = True
        elif arg == "--assistant":
            if not args or not UUID_RE.match(args[0]):
                usage("--assistant cần agentId dạng uuid")
            extra_assistants.add(args.pop(0).lower())
        else:
            rest.append(arg)
    if len(rest) != 1:
        usage()
    try:
        with open(POLICY_FILE) as f:
            companies = json.load(f)["companies"]
        if not isinstance(companies, dict):
            raise ValueError
    except (OSError, ValueError, KeyError, TypeError):
        usage("không đọc được cấu hình Crew (CREW_POLICY_FILE)")
    by_lower = {k.lower(): (k, v) for k, v in companies.items()}
    if rest[0] == "--all-crew":
        targets = [by_lower[k] for k in sorted(by_lower)]
    elif rest[0].lower() in by_lower:
        targets = [by_lower[rest[0].lower()]]
    else:
        usage(f"company {rest[0]} không có trong cấu hình Crew")
    differs = warn = False
    try:
        for company_id, entry in targets:
            print(f"== company {company_id} ({'check' if check else 'apply'})")
            d, w = do_agents(company_id, not check, extra_assistants)
            differs |= d
            warn |= w
            differs |= do_skill_policy(company_id, not check)
            owner = entry.get("ownerUserId") if isinstance(entry, dict) else None
            if owner:
                differs |= do_inbox(company_id, owner, not check)
            else:
                print("CẢNH BÁO thiếu ownerUserId trong cấu hình, bỏ qua inbox policy")
                warn = True
            warn |= do_checks(company_id)
    except ApiError as error:
        print(f"lỗi API: {error}", file=sys.stderr)
        sys.exit(2)
    sys.exit(1 if differs or warn else 0)


main(sys.argv[1:])
PY

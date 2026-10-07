#!/usr/bin/env python3
"""Checks for the Crew policy config the server reads through CREW_POLICY_CONFIG.

Usage:
  policy-config.py file <path>      exit 0 when <path> is a JSON object with a `companies` object
  policy-config.py startup-log      reads the server startup log on stdin; exit 1 when it says the Crew gates are off
  policy-config.py compose-env <env-file> <value>
                                    makes <env-file> carry exactly one COMPOSE_FILE=<value> line, keeping every
                                    other line as is (creates the file when missing); never prints file content
Without this config every Crew gate is off and the server still reports healthy, so deploy checks it.
"""
import json
import sys

GATES_OFF = "gate Crew"


def check_file(path):
    try:
        with open(path) as f:
            data = json.load(f)
    except OSError as error:
        return f"cannot read {path}: {error.strerror}"
    except ValueError as error:
        return f"{path} is not valid JSON: {error}"
    if not isinstance(data, dict) or not isinstance(data.get("companies"), dict):
        return f"{path} has no `companies` object"
    return None


def check_startup_log(text):
    if GATES_OFF in text:
        return "server logged that the Crew gates are off"
    return None


def set_compose_file(path, value):
    """Idempotent: replaces the first COMPOSE_FILE line, drops duplicates, or appends one."""
    try:
        with open(path) as f:
            lines = f.read().splitlines()
    except FileNotFoundError:
        lines = []
    wanted = f"COMPOSE_FILE={value}"
    out = []
    seen = False
    for line in lines:
        if line.split("=", 1)[0].strip() == "COMPOSE_FILE":
            if not seen:
                out.append(wanted)
                seen = True
            continue
        out.append(line)
    if not seen:
        out.append(wanted)
    new = "\n".join(out) + "\n"
    try:
        with open(path) as f:
            if f.read() == new:
                return
    except FileNotFoundError:
        pass
    with open(path, "w") as f:
        f.write(new)


def main(argv):
    if len(argv) == 3 and argv[1] == "file":
        problem = check_file(argv[2])
    elif len(argv) == 2 and argv[1] == "startup-log":
        problem = check_startup_log(sys.stdin.read())
    elif len(argv) == 4 and argv[1] == "compose-env":
        set_compose_file(argv[2], argv[3])
        return 0
    else:
        print(__doc__, file=sys.stderr)
        return 2
    if problem:
        print(problem, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))

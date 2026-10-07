#!/usr/bin/env python3
"""Checks for the Crew policy config the server reads through CREW_POLICY_CONFIG.

Usage:
  policy-config.py file <path>      exit 0 when <path> is a JSON object with a `companies` object
  policy-config.py startup-log      reads the server startup log on stdin; exit 0 only when it says the
                                    config is enabled and does not say the Crew gates are off
Without this config every Crew gate is off and the server still reports healthy, so deploy checks both.
"""
import json
import sys

ENABLED = "crew policy config enabled"
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
    if ENABLED not in text:
        return f"server log has no `{ENABLED}` line"
    return None


def main(argv):
    if len(argv) == 3 and argv[1] == "file":
        problem = check_file(argv[2])
    elif len(argv) == 2 and argv[1] == "startup-log":
        problem = check_startup_log(sys.stdin.read())
    else:
        print(__doc__, file=sys.stderr)
        return 2
    if problem:
        print(problem, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))

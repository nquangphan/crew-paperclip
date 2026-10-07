#!/usr/bin/env python3
"""Decides whether plugin crew.core is healthy for the server container that was just (re)started.

Usage: plugin-state.py <health.json> <dashboard.json> <container-start-epoch-seconds> [<now-epoch-seconds>]
Prints "healthy" or a short reason. The health route only reads the plugin row, which still says
"ready" from before a restart, so healthy additionally needs a live worker whose uptime began after
the container started (the worker is a child of the new server process).
"""
import json
import sys
import time

SLACK_SECONDS = 5


def load(path):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def decide(health, dashboard, container_start, now):
    if not isinstance(health, dict):
        return "no answer"
    if not health.get("healthy"):
        return health.get("status") or "unknown"
    worker = dashboard.get("worker") if isinstance(dashboard, dict) else None
    if not isinstance(worker, dict) or worker.get("status") != "running" or not worker.get("pid"):
        return "worker not running"
    uptime_ms = worker.get("uptime")
    if not isinstance(uptime_ms, (int, float)) or uptime_ms < 0:
        return "worker uptime unknown"
    if now - uptime_ms / 1000 < container_start - SLACK_SECONDS:
        return "stale worker (started before the container)"
    return "healthy"


if __name__ == "__main__":
    if len(sys.argv) < 4:
        print("usage: plugin-state.py <health.json> <dashboard.json> <container-start-epoch> [<now-epoch>]", file=sys.stderr)
        sys.exit(2)
    now = float(sys.argv[4]) if len(sys.argv) > 4 else time.time()
    print(decide(load(sys.argv[1]), load(sys.argv[2]), float(sys.argv[3]), now))

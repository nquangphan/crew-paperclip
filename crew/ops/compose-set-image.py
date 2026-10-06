#!/usr/bin/env python3
"""Set the image of the `server` service in a docker-compose.yml and ensure stop_grace_period: 60s.

Usage: compose-set-image.py <compose-file> <image>
Exits non-zero and leaves the file untouched when the server block or its image line is missing,
or when the image is not a plain image reference.
"""
import re
import sys


def main() -> int:
    path, image = sys.argv[1], sys.argv[2]
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._/:@-]*", image):
        print(f"compose-set-image: invalid image reference {image!r}", file=sys.stderr)
        return 2
    text = open(path).read()
    match = re.search(r"(?ms)^  server:\n(.*?)(?=^  \S|\Z)", text)
    if not match:
        print("compose-set-image: no `server:` service", file=sys.stderr)
        return 3
    block = match.group(0)
    new_block, count = re.subn(r"(?m)^(    image:[ \t]*).*$", lambda m: m.group(1) + image, block, count=1)
    if count != 1 or f"    image: {image}" not in new_block:
        print("compose-set-image: server block has no image line", file=sys.stderr)
        return 3
    if "stop_grace_period" not in new_block:
        new_block = new_block.replace("  server:\n", "  server:\n    stop_grace_period: 60s\n", 1)
    open(path, "w").write(text[: match.start()] + new_block + text[match.end() :])
    return 0


if __name__ == "__main__":
    sys.exit(main())

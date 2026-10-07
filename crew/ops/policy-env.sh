#!/bin/bash
# Sourced by deploy.sh and rollback.sh (needs $ROOT). Defines where the Crew policy config lives and
# writes the compose override that mounts it into the server container.
#
# The config sits in its own directory, outside the Paperclip data directory, mounted read-only as a
# directory (not a single file) so that rewriting the file in place or replacing it with mv both show up.
POLICY_DIR=$ROOT/crew-policy
POLICY_FILE=$POLICY_DIR/crew-policy.json
POLICY_OVERRIDE=$ROOT/docker-compose.crew-policy.yml
POLICY_COMPOSE_FILES=docker-compose.yml:docker-compose.crew-policy.yml

write_policy_override() {
  cat > "$POLICY_OVERRIDE" <<YML
services:
  server:
    environment:
      CREW_POLICY_CONFIG: /crew-policy/crew-policy.json
    volumes:
      - $POLICY_DIR:/crew-policy:ro
YML
  # Also persist it in .env, which compose reads from this directory, so a hand-run `docker compose up`
  # recreates the server with the mount instead of silently dropping it.
  python3 "$ROOT/ops/policy-config.py" compose-env "$ROOT/.env" "$POLICY_COMPOSE_FILES"
  export COMPOSE_FILE=$POLICY_COMPOSE_FILES
}

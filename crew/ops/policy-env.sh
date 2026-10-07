#!/bin/bash
# Sourced by deploy.sh and rollback.sh (needs $ROOT). Defines where the Crew policy config lives and
# writes the compose override that mounts it into the server container.
#
# The config sits in its own directory, outside the Paperclip data directory, mounted read-only as a
# directory (not a single file) so that rewriting the file in place or replacing it with mv both show up.
POLICY_DIR=$ROOT/crew-policy
POLICY_FILE=$POLICY_DIR/crew-policy.json
POLICY_OVERRIDE=$ROOT/docker-compose.crew-policy.yml

write_policy_override() {
  cat > "$POLICY_OVERRIDE" <<YML
services:
  server:
    environment:
      CREW_POLICY_CONFIG: /crew-policy/crew-policy.json
    volumes:
      - $POLICY_DIR:/crew-policy:ro
YML
  export COMPOSE_FILE=docker-compose.yml:docker-compose.crew-policy.yml
}

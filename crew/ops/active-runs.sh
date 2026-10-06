#!/bin/sh
# Lists queued/running/scheduled_retry runs across all companies of the crew-v3-spike stack.
# Prints nothing when no run is active.
docker exec crew-v3-spike-db-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "select c.name, r.status, count(*) from heartbeat_runs r join companies c on c.id = r.company_id where r.status in ('"'"'queued'"'"', '"'"'running'"'"', '"'"'scheduled_retry'"'"') group by 1, 2"'

#!/bin/bash
# Builds crew-v3/paperclip:v3-<short> on top of the upstream image from ops/overlay-<short>.tar.gz.
# RAM watchdog aborts the build below 2048 MiB available. Usage: overlay-job.sh <short>
set -euo pipefail
SHORT=$1
OPS=/opt/crew-v3-spike/ops
CTX=$OPS/overlay-ctx-$SHORT
TAG=crew-v3/paperclip:v3-$SHORT
rm -rf "$CTX"; mkdir -p "$CTX/app"
tar -xzf "$OPS/overlay-$SHORT.tar.gz" -C "$CTX/app"
cat > "$CTX/Dockerfile" <<'DOCK'
FROM ghcr.io/paperclipai/paperclip:2026.1001.0
COPY --chown=node:node app/ /app/
RUN set -e; cd /app/server; OUT=dist; \
    while read -r f; do [ -n "$f" ] || continue; \
      o="$OUT/${f#src/}"; o="${o%.ts}.js"; mkdir -p "$(dirname "$o")"; \
      /app/node_modules/.bin/esbuild "$f" --format=esm --platform=node --target=node24 --outfile="$o" --log-level=warning; \
    done < /app/crew-transpile.txt; \
    mkdir -p /app/packages/crew-plugin/node_modules/@paperclipai; \
    ln -sfn /app/packages/plugins/sdk /app/packages/crew-plugin/node_modules/@paperclipai/plugin-sdk; \
    chown -R node:node "/app/server/$OUT" /app/packages/crew-plugin
DOCK
FULL=$(tr -dc '0-9a-f' < "$CTX/app/crew-commit.txt")
printf 'ENV PAPERCLIP_BUILD_COMMIT=%s\n' "$FULL" >> "$CTX/Dockerfile"
printf 'ENV PAPERCLIP_BUILD_VERSION=v2026.1001.0-crew-%s\nLABEL crew.kind=overlay crew.commit=%s crew.base=ghcr.io/paperclipai/paperclip:2026.1001.0\n' "$SHORT" "$SHORT" >> "$CTX/Dockerfile"
LOG=$OPS/overlay-$SHORT.log; : > "$LOG"
cd "$CTX"
DOCKER_BUILDKIT=1 docker build -t "$TAG" --progress=plain . >> "$LOG" 2>&1 &
JOB=$!; MIN=999999
while kill -0 $JOB 2>/dev/null; do
  AV=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
  [ "$AV" -lt "$MIN" ] && MIN=$AV
  if [ "$AV" -lt 2048 ]; then echo "ABORT_RAM avail=${AV}MiB" >> "$LOG"; kill -TERM $JOB; break; fi
  sleep 1
done
set +e; wait $JOB; RC=$?; set -e
echo "JOB_EXIT rc=$RC min_avail=${MIN}MiB tag=$TAG" | tee -a "$LOG"
rm -rf "$CTX"
exit $RC

#!/usr/bin/env bash
# Serve the stock Paperclip UI (no Crew overlay) at https://crew.2p-solutions.com/paperclip/ for comparison.
# Static files only: /api and the live-events WebSocket stay on the one prod server behind "location /".
#
# Build on the Mac (fork at the prod commit):
#   cd ui && PAPERCLIP_UI_BASE=/paperclip/ pnpm exec vite build --outDir <dir>/paperclip --emptyOutDir
#   tar -C <dir> -czf stock-ui.tgz paperclip && scp stock-ui.tgz crew/ops/nginx-crew.conf nhamoiplatform:/tmp/
#
# On the VPS:
#   stock-ui.sh install /tmp/stock-ui.tgz /tmp/nginx-crew.conf   # files + edge config (with /paperclip/ block)
#   stock-ui.sh reapply                                          # after the nginx container was recreated
#   stock-ui.sh remove [conf]   # turn the route off; default conf = ops/nginx-crew.conf.pre-stock-ui (files stay)
set -euo pipefail

NGINX_CONTAINER="${NGINX_CONTAINER:-2ps-landing-nginx}"
HOST_DIR="${STOCK_UI_HOST_DIR:-/opt/crew-v3-spike/stock-ui}"
OPS_DIR="${OPS_DIR:-/opt/crew-v3-spike/ops}"
CONTAINER_ROOT=/usr/share/nginx/crew-stock-ui
CONTAINER_CONF=/etc/nginx/conf.d/crew.conf
TS="$(date +%Y%m%d-%H%M%S)"

die() { echo "stock-ui: $*" >&2; exit 1; }

check_sites() {
  local rc=0 code url
  for url in https://crew.2p-solutions.com/ https://crew.2p-solutions.com/api/health \
    https://2p-solutions.com/ https://kidyschool.com/; do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$url" || true)"
    echo "  $url $code"
    [ "$code" = 200 ] || rc=1
  done
  return "$rc"
}

copy_files() {
  [ -f "$HOST_DIR/paperclip/index.html" ] || die "missing $HOST_DIR/paperclip/index.html"
  docker exec "$NGINX_CONTAINER" mkdir -p "$CONTAINER_ROOT"
  docker cp "$HOST_DIR/paperclip" "$NGINX_CONTAINER:$CONTAINER_ROOT/"
}

# Swap the edge config: back up the live one, test, reload; restore and reload on any failure.
apply_conf() {
  local new_conf="$1" backup="$OPS_DIR/nginx-crew.conf.bak-$TS"
  [ -f "$new_conf" ] || die "missing config $new_conf"
  docker exec "$NGINX_CONTAINER" cat "$CONTAINER_CONF" >"$backup"
  echo "backup: $backup"
  docker cp "$new_conf" "$NGINX_CONTAINER:$CONTAINER_CONF"
  if ! docker exec "$NGINX_CONTAINER" nginx -t; then
    docker cp "$backup" "$NGINX_CONTAINER:$CONTAINER_CONF"
    die "nginx -t failed, restored $backup"
  fi
  docker exec "$NGINX_CONTAINER" nginx -s reload
  sleep 2
  if ! check_sites; then
    docker cp "$backup" "$NGINX_CONTAINER:$CONTAINER_CONF"
    docker exec "$NGINX_CONTAINER" nginx -t && docker exec "$NGINX_CONTAINER" nginx -s reload
    die "site check failed after reload, restored $backup"
  fi
  if [ "$new_conf" -ef "$OPS_DIR/nginx-crew.conf" ]; then return 0; fi
  cp "$new_conf" "$OPS_DIR/nginx-crew.conf"
}

case "${1:-}" in
  install)
    tgz="${2:-}"; conf="${3:-}"
    [ -f "$tgz" ] || die "usage: stock-ui.sh install <stock-ui.tgz> <nginx-crew.conf>"
    mkdir -p "$HOST_DIR"
    if [ -d "$HOST_DIR/paperclip" ]; then mv "$HOST_DIR/paperclip" "$HOST_DIR/paperclip.bak-$TS"; fi
    tar -C "$HOST_DIR" -xzf "$tgz"
    # Config without the /paperclip/ block, kept for "remove".
    if [ ! -f "$OPS_DIR/nginx-crew.conf.pre-stock-ui" ]; then
      docker exec "$NGINX_CONTAINER" cat "$CONTAINER_CONF" >"$OPS_DIR/nginx-crew.conf.pre-stock-ui"
    fi
    copy_files
    apply_conf "$conf"
    echo "stock-ui: installed"
    ;;
  reapply)
    copy_files
    apply_conf "$OPS_DIR/nginx-crew.conf"
    echo "stock-ui: reapplied"
    ;;
  remove)
    apply_conf "${2:-$OPS_DIR/nginx-crew.conf.pre-stock-ui}"
    echo "stock-ui: route removed"
    ;;
  *)
    die "usage: stock-ui.sh install <tgz> <conf> | reapply | remove [conf]"
    ;;
esac

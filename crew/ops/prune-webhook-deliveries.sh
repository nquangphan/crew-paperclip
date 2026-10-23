#!/bin/bash
# Xóa dòng plugin_webhook_deliveries cũ hơn KEEP_DAYS ngày. Mỗi lần máy gửi bản tin hay ảnh chụp docs, server lưu nguyên
# body vào bảng này (ảnh chụp docs tới 16 MB) và không tự dọn; chỉ trang quản trị plugin đọc lại, không luồng nào cần dòng
# cũ. Chạy hằng ngày trước backup.sh (crew-v3-spike-backup.service).
set -euo pipefail
KEEP_DAYS=${KEEP_DAYS:-3}
DB=${CREW_DB_CONTAINER:-crew-v3-spike-db-1}
case "$KEEP_DAYS" in '' | *[!0-9]*) echo "prune-webhook-deliveries: KEEP_DAYS phải là số ngày" >&2; exit 2 ;; esac

COUNT=$(docker exec "$DB" sh -c "psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -tAqc \"with d as (delete from plugin_webhook_deliveries where created_at < now() - interval '$KEEP_DAYS days' returning 1) select count(*) from d\"")
SIZE=$(docker exec "$DB" sh -c "psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -tAqc \"vacuum plugin_webhook_deliveries\" && psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -tAc \"select pg_size_pretty(pg_total_relation_size('plugin_webhook_deliveries'))\"")
echo "prune-webhook-deliveries $(date +%Y%m%d-%H%M): xóa $COUNT dòng cũ hơn $KEEP_DAYS ngày, bảng còn $SIZE"

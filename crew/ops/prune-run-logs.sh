#!/bin/bash
# Xóa log lượt chạy (data/paperclip/.../run-logs) cũ hơn KEEP_DAYS ngày; ticket cũ vẫn mở được, chỉ phần log hiện "đã dọn".
# Chạy hằng ngày trước backup.sh (crew-v3-spike-backup.service).
set -euo pipefail
ROOT=${CREW_ROOT:-/opt/crew-v3-spike}
KEEP_DAYS=${KEEP_DAYS:-7}
DIR=$ROOT/data/paperclip/instances/default/data/run-logs

[ -d "$DIR" ] || { echo "prune-run-logs: $DIR không có, bỏ qua"; exit 0; }
COUNT=$(find "$DIR" -type f -mtime +"$KEEP_DAYS" | wc -l)
find "$DIR" -type f -mtime +"$KEEP_DAYS" -delete
find "$DIR" -mindepth 1 -type d -empty -delete
echo "prune-run-logs $(date +%Y%m%d-%H%M): xóa $COUNT file cũ hơn $KEEP_DAYS ngày, còn $(du -sh "$DIR" | cut -f1)"

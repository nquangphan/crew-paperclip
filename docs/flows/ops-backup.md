# Sao lưu DB, kéo bản sao về Mac, diễn tập khôi phục, dọn log run

> Flow `ops-backup`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow ops-backup` in ra đúng danh sách đó.

## Mục đích

Toàn bộ trạng thái Crew v3 nằm trên một VPS (Postgres, thư mục dữ liệu Paperclip gồm khóa chủ của secret và storage,
cấu hình compose). Flow này giữ được dữ liệu khi VPS hỏng, mà vẫn giữ VPS gọn:

- Sao lưu hằng ngày trên VPS, chỉ giữ `KEEP_SETS` bộ (mặc định 1) để VPS không đầy đĩa.
- Mac kéo bản sao ra khỏi VPS mỗi ngày và giữ lâu hơn (`CREW_PULL_KEEP_DAYS`, mặc định 14 ngày), luôn giữ 3 bộ mới nhất,
  và báo `stale=1` (thoát khác 0) khi VPS không còn bộ nào đủ mới.
- Mac chỉ đọc được bản sao qua một khóa SSH bị ép lệnh (forced command): liệt kê, đọc manifest, lấy file; mọi yêu cầu
  khác bị từ chối, symlink không bao giờ được trả.
- Diễn tập khôi phục chứng minh bản sao dùng được, trong một compose project tạm được cách ly (không environment nào tới
  được Mac, không agent nào chạy, không run nào được nhận).
- Log run cũ hơn `KEEP_DAYS` (mặc định 7) bị xóa; issue cũ vẫn mở được, chỉ phần log hiện là đã dọn (flow `stock-ui` và
  `attachments` lo chỗ hiển thị).

Đường dẫn trên VPS và trên Mac nằm trong chính các script, unit systemd và plist của flow này; trang này không chép lại.

## Điểm vào

- Timer systemd `crew/ops/systemd/crew-v3-spike-backup.timer` (hằng ngày theo giờ VPS, `Persistent=true` để chạy bù sau
  khi máy tắt) chạy service `crew-v3-spike-backup.service`: `prune-run-logs.sh`, `prune-webhook-deliveries.sh`, rồi `backup.sh`.
- `crew/ops/deploy.sh` gọi `backup.sh` trước khi đổi image (flow `ops-deploy`).
- LaunchAgent `crew/ops/launchd/com.2p.crew-backup-pull.plist` trên Mac chạy `pull-backup.sh` hằng ngày.
- `crew/ops/restore-drill.sh <TS>` chạy tay trên VPS.

## Các bước

1. `crew/ops/prune-run-logs.sh`: xóa log run cũ hơn `KEEP_DAYS`.
   `crew/ops/prune-webhook-deliveries.sh`: xóa dòng `plugin_webhook_deliveries` cũ hơn `KEEP_DAYS` (mặc định 3, owner chốt
   23/10/2026) rồi `vacuum` bảng. Server lưu nguyên body của mọi webhook plugin (bản tin máy, ảnh chụp docs tới 16 MB)
   mà không tự dọn; ngày 23/10/2026 bảng đã 348 MB. Lỗi ở bước này không chặn backup.
2. `crew/ops/backup.sh`: một lần sao lưu tại một thời điểm (timer, deploy và chạy tay có thể chồng nhau). `pg_dump`
   dạng custom, tar thư mục dữ liệu Paperclip (trừ các bản SQL tích hợp hằng giờ) và tar cấu hình. File dở dang luôn có
   đuôi `.tmp` và bị dọn ở lần sau; `tar` thoát 1 vì file đổi trong lúc đọc vẫn tính là bản dùng được. Giữ `KEEP_SETS`
   bộ mới nhất.
3. `crew/ops/backup-serve.sh`: forced command cho khóa kéo bản sao: `list` (mốc thời gian của bộ đã hoàn tất),
   `manifest <TS>` (tên, kích thước, sha256 của bốn file), `get <name>`.
4. `crew/ops/pull-backup.sh`: kéo từng bộ trong cửa sổ giữ, chỉ đưa vào thư mục đích khi mọi file khớp kích thước,
   sha256 và qua kiểm định dạng; manifest có tên không khớp bộ được hỏi thì từ chối; truyền hỏng thì không để lại bộ dở.
   Xoay vòng bộ cũ nhưng không bao giờ xóa khi không còn bộ đủ mới (`FRESH_DAYS`).
5. `crew/ops/restore-drill.sh`: khôi phục một bộ vào compose project tạm, so danh sách issue với lúc sao lưu, cách ly
   trước khi server khởi động, gọi API đọc thử một issue, khôi phục thêm bản SQL tích hợp mới nhất vào DB nháp, rồi xóa
   hết. In `DRILL OK` khi đạt.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `crew/ops/backup.sh` | Sao lưu hằng ngày trên VPS | `KEEP_SETS` |
| `crew/ops/backup-serve.sh` | Forced command chỉ đọc cho Mac | `list`, `manifest`, `get` |
| `crew/ops/pull-backup.sh` | Kéo và kiểm bản sao về Mac | `CREW_PULL_KEEP_DAYS`, `FRESH_DAYS` |
| `crew/ops/restore-drill.sh` | Diễn tập khôi phục | (script) |
| `crew/ops/prune-run-logs.sh` | Dọn log run cũ | `KEEP_DAYS` |
| `crew/ops/prune-webhook-deliveries.sh` | Dọn dòng webhook plugin cũ | `KEEP_DAYS` |
| `crew/ops/systemd/crew-v3-spike-backup.service` | Service chạy dọn log rồi sao lưu | (unit) |
| `crew/ops/systemd/crew-v3-spike-backup.timer` | Lịch hằng ngày | (unit) |
| `crew/ops/launchd/com.2p.crew-backup-pull.plist` | Lịch kéo bản sao trên Mac | `com.2p.crew-backup-pull` |

## Dữ liệu

- Đọc toàn bộ DB Postgres (`pg_dump`) và thư mục dữ liệu Paperclip; không ghi DB production. Diễn tập ghi vào DB và
  compose project tạm rồi xóa.
- Mỗi bộ sao lưu gồm bốn file, mô tả bởi manifest (tên, byte, sha256).
- Gọi ngoài: SSH từ Mac tới VPS bằng khóa bị ép lệnh; `docker compose` trên VPS.

## Flow liên quan

- `ops-deploy`: `deploy.sh` sao lưu trước khi đổi image.
- `ops-tools`: công cụ vận hành khác trên cùng VPS.
- `stock-ui`, `attachments`: hiển thị chỗ trống khi log run hay file đã bị dọn.

## Tests

- `crew/ops/pull-backup.test.mjs`: `backup-serve.sh` chỉ liệt kê bộ đã hoàn tất và từ chối mọi yêu cầu khác;
  `pull-backup.sh` kéo và kiểm mọi bộ trong cửa sổ, từ chối bản truyền hỏng mà không để lại bộ dở, xoay vòng bộ cũ hơn
  14 ngày, luôn giữ 3 bộ mới nhất và báo `stale` khi VPS không có bộ mới, từ chối manifest sai tên.

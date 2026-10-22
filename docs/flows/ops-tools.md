# Công cụ vận hành: cấu hình policy, quyền agent, kiểm company, xem run, trạng thái plugin, company e2e

> Flow `ops-tools`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow ops-tools` in ra đúng danh sách đó.

## Mục đích

Các script nhỏ owner và deploy dùng trên VPS (và vài cái trên Mac) để giữ những điều kiện mà server không tự báo:

- File cấu hình Crew (`CREW_POLICY_CONFIG`) thiếu hay hỏng thì mọi cổng Crew tắt mà server vẫn báo healthy, nên deploy
  phải tự kiểm file, kiểm log khởi động và mount file vào container đúng cách.
- Trạng thái `ready` của plugin `crew.core` có thể là bản cũ từ trước lần khởi động lại; chỉ tin khi có worker sống bắt
  đầu sau khi container khởi động.
- Lan can phía agent (không tạo agent/skill, chỉ Trợ Lý được giao việc, chặn skill, tắt inbox agent của owner) đặt qua
  REST API của board, chạy lại được nhiều lần.
- Danh sách company trong file cấu hình Crew và trong cấu hình plugin phải khớp nhau.
- Một company e2e riêng cho các lượt nghiệm thu UI, tạo được lặp lại mà không đụng company thật.

Mọi script chỉ in id rút gọn; body và secret đi qua stdin, không bao giờ qua đối số dòng lệnh hay output. Đường dẫn
trên VPS là mặc định trong từng script (ghi đè được bằng env cho test).

## Điểm vào

- `crew/ops/policy-config.py file|list-companies|startup-log|compose-env …`: do `deploy.sh`, `rollback.sh` và người vận
  hành gọi.
- `crew/ops/policy-env.sh`: được `deploy.sh` và `rollback.sh` source.
- `crew/ops/plugin-state.sh`: in `healthy` hoặc lý do ngắn; `deploy.sh` và `auto-deploy-vps.sh plugin-state` gọi.
- `crew/ops/active-runs.sh`: in run `queued`/`running`/`scheduled_retry` của mọi company; rỗng nghĩa là rảnh.
- `crew/ops/agent-permissions.sh <companyId|--all-crew> [--check|--dry-run] [--assistant <agentId>]...`.
- `crew/ops/check-crew-companies.sh`.
- `crew/ops/e2e-company.sh prod|mac`.
- `crew/ops/watch-run.sh <issueId> <seconds> <logfile>`: mỗi 10 giây ghi run của issue (VPS) và process của run trên Mac.

## Các bước

1. `crew/ops/policy-config.py`: `file` kiểm file là object JSON có `companies`; `list-companies` in id company đã sắp;
   `startup-log` đọc log khởi động qua stdin và thoát 1 khi có cảnh báo cổng Crew tắt; `compose-env` giữ đúng một dòng
   `COMPOSE_FILE=` trong file env mà không in nội dung.
2. `crew/ops/policy-env.sh`: đặt nơi chứa file cấu hình (thư mục riêng, ngoài thư mục dữ liệu Paperclip) và ghi compose
   override mount cả thư mục ở chế độ chỉ đọc, để sửa tại chỗ hay thay file bằng `mv` đều có hiệu lực.
3. `crew/ops/plugin-state.sh` → `crew/ops/plugin-state.py`: đọc health và dashboard plugin, so thời điểm worker bắt đầu
   với thời điểm container khởi động (cho phép lệch `SLACK_SECONDS`).
4. `crew/ops/agent-permissions.sh`: với mỗi company (một uuid có trong cấu hình Crew, hoặc mọi company với
   `--all-crew`): tắt `canCreateAgents`, `canCreateSkills` cho mọi agent còn sống; chỉ Trợ Lý của project (theo vai trò
   project của plugin, hoặc `--assistant` cho project còn dùng vai trò file) giữ grant `tasks:assign`; thêm rule deny mọi
   `skills.*` cho mọi agent; tắt inbox agent policy của owner. Chỉ đọc mà báo: agent role `ceo`, trust preset thấp,
   pipeline, tool connection. Mã thoát: 0 khớp, 1 còn lệch hay cần owner, 2 sai cách dùng hay lỗi API.
5. `crew/ops/check-crew-companies.sh`: so id company trong file cấu hình Crew với company trong các dòng cấu hình plugin
   `crew.core` (không phân biệt hoa thường, trùng id đếm một lần). 0 khớp, 1 lệch, 2 không đọc được một phía.
6. `crew/ops/e2e-company.sh`: `prod` tạo company "Crew E2E" (secret SSH và secret webhook trạng thái nhận qua stdin,
   environment chép từ environment mẫu, nhãn `research`, hai agent giữ chỗ không bao giờ chạy cho reviewer/integrator
   mà parser cấu hình đòi, mục company trong file cấu hình Crew có sao lưu trước, dòng cấu hình plugin); `mac` tạo repo
   bare và bản clone trên Mac. Chỉ tạo phần còn thiếu, không bao giờ tạo issue hay xóa gì.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `crew/ops/policy-config.py` | Kiểm file cấu hình Crew, log khởi động, file env compose | `check_file`, `GATES_OFF` |
| `crew/ops/policy-env.sh` | Mount file cấu hình vào container | (script được source) |
| `crew/ops/plugin-state.sh` | Hỏi trạng thái plugin trên container | (script) |
| `crew/ops/plugin-state.py` | Quyết plugin có healthy không | `SLACK_SECONDS` |
| `crew/ops/active-runs.sh` | Liệt kê run đang hoạt động | (script) |
| `crew/ops/agent-permissions.sh` | Đặt lan can phía agent qua REST | `--all-crew`, `--check`, `--assistant` |
| `crew/ops/check-crew-companies.sh` | So company giữa cấu hình Crew và cấu hình plugin | (script) |
| `crew/ops/e2e-company.sh` | Dựng company e2e | `prod`, `mac` |
| `crew/ops/watch-run.sh` | Theo dõi run của một issue | (script) |

## Dữ liệu

- Đọc/ghi qua REST API của board (`api.sh` trên VPS, không nằm trong repo): quyền agent, skill policy, inbox policy,
  secret, environment, label, agent, cấu hình plugin. `active-runs.sh` đọc `heartbeat_runs`.
- File: cấu hình Crew (env `CREW_POLICY_CONFIG` trong container; mặc định trên VPS ghi trong `agent-permissions.sh` và
  `policy-env.sh`), compose override, file env compose.
- Env ghi đè cho test: `CREW_OPS_ROOT`, `CREW_API_SH`, `CREW_POLICY_FILE`, `CREW_ROOT`, `CREW_E2E_HOME`,
  `CREW_DOCS_BUNDLE`, `CREW_DOCS_RUNTIME`.

## Flow liên quan

- `ops-deploy`: `deploy.sh` dùng `policy-config.py`, `policy-env.sh`, `plugin-state.sh`, `active-runs.sh`.
- `issue-gate`, `agent-guards`: đọc file `CREW_POLICY_CONFIG` mà các script này kiểm và mount.
- `agent-roles`: `apply-roles.sh` sinh và cập nhật file cấu hình Crew.
- `project-roles`: vai trò Trợ Lý theo project quyết ai giữ grant `tasks:assign`.
- `crew-plugin`: cấu hình plugin `crew.core` theo company.

## Tests

- `crew/ops/policy-config.test.mjs`: file hợp lệ và bị từ chối; log khởi động; sai cách dùng thoát 2; `compose-env` tạo,
  giữ dòng khác, chạy lại không đổi; `policy-env.sh` ghi override mount chỉ đọc; `list-companies`.
- `crew/ops/plugin-state.test.mjs`: healthy khi worker chạy sau khi container khởi động; `ready` cũ không có worker hay
  worker cũ thì không healthy; health lỗi; không phản hồi.
- `crew/ops/agent-permissions.test.mjs`: áp quyền và skill policy, tắt inbox của owner; `--check` chỉ đọc; chạy lại
  không ghi gì; body chỉ qua stdin; cảnh báo cần owner; `--assistant`; company phải có trong cấu hình; lỗi API không in
  token.
- `crew/ops/check-crew-companies.test.mjs`: khớp, lệch từng phía, chỉ in id rút gọn, hoa thường, file hỏng, server trả
  rỗng hay không phải JSON.
- `crew/ops/e2e-company.test.mjs`: thứ tự tạo lần đầu; key và secret chỉ qua stdin; environment chép từ mẫu; agent giữ chỗ
  không chạy; không đụng company khác; lần hai không tạo gì; cắt khoảng trắng secret; mất file secret thì rotate.

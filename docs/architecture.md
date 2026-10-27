# Kiến trúc phần Crew

## Thành phần

- **Server Paperclip có điểm móc Crew.** Code lõi upstream gọi vào `server/src/crew/core-hooks.ts` ở vài chỗ cố định
  (nhận run, tạo và ghi issue, trả lease SSH, sửa cấu hình agent) và vài vá lõi nhỏ gọi thẳng module Crew. Mọi điểm
  móc, anchor và test của chúng được liệt kê trong `crew/release/core-hooks.json`; `crew/release/check-core-hooks.mjs`
  kiểm anchor còn đúng sau mỗi lần nâng upstream (flow `core-hooks`). Giữ phần vá lõi nhỏ là quyết định có chủ ý: nâng
  bản Paperclip chỉ cần merge tag upstream rồi chạy `crew/release/verify.sh`.
- **Router Crew trong server** (`/api/crew/companies/:companyId/...`): góp ý chờ duyệt, quyền xem project, Phòng QC.
  Router được gắn một lần trong `server/src/app.ts` (vá lõi C7), các router con gắn bên trong nó.
- **Plugin `crew.core`** (`packages/crew-plugin`): chạy như worker plugin của Paperclip. Nhận webhook ký HMAC từ Mac
  (`machine-status`, `docs-snapshot`), mở route API cho UI và app Mac, chạy job định kỳ (kiểm file đính kèm, chuyển
  runtime), lắng nghe sự kiện lõi (run hỏng, run bị hủy, agent hoặc project bị đổi), và cấp data cho UI. Manifest:
  `packages/crew-plugin/src/manifest.ts`.
- **UI Crew** (`packages/crew-web`): SPA phục vụ ở `/` của server. UI Paperclip gốc vẫn có ở `/paperclip/` để so sánh
  (flow `stock-ui`).
- **Mac chạy agent**: mỗi agent dùng một SSH environment trỏ về Mac của chủ dự án. Server mở SSH để chạy adapter
  (`claude_local`, `codex_local`, `opencode_local`) trên Mac, ngay trong thư mục làm việc của environment khi metadata
  đặt `workspaceRealizationMode: "in_place"`, và để dừng run từ xa. Phần mềm trên Mac
  (`crew-mac`, app macOS) ở repo `crew`; nó gửi bản tin máy và snapshot docs về server.

## Lưu trữ dữ liệu

- Postgres của Paperclip. Crew đọc bảng lõi (`issues`, `heartbeat_runs`, `agents`, `projects`, `cost_events`...) và
  ghi dữ liệu riêng vào bảng plugin `crew_*` trong namespace của `crew.core` (migration ở
  `packages/crew-plugin/migrations/`). Server cũng đọc/ghi một số bảng plugin này trực tiếp (vai trò project, công tắc
  runtime, góp ý, quyền xem project, vòng QC), nên migration là hợp đồng chung của plugin và server.
- Cấu hình policy Crew theo company: file JSON chỉ đọc, đường dẫn qua env `CREW_POLICY_CONFIG`
  (`server/src/crew/issue-policy.ts`). Trên VPS nó được mount vào container bởi `crew/ops/policy-env.sh` và do
  `crew/agents/apply-roles.sh` ghi.
- Secret: secret webhook theo company là company secret của Paperclip; bảng Crew chỉ giữ tham chiếu hoặc vân tay, không
  giữ giá trị.

## Dịch vụ bên ngoài

- SSH tới Mac của chủ dự án (environment SSH của Paperclip).
- GitHub qua `gh` trên Mac cho auto-deploy chờ merge pull request (`crew/ops/auto-deploy.mjs`).

## Triển khai

- Prod là một image overlay: image Paperclip upstream đúng tag `base` của `crew/release/core-hooks.json`, chép đè file
  `.ts` Crew đã đổi trong `server/src` (transpile bằng esbuild), adapter đã vá, plugin đã build kèm migration, và UI
  Crew đã build vào `server/ui-dist`. Nguồn: `crew/ops/overlay-source.sh` (chạy trên Mac, từ chối file đổi ngoài vùng
  overlay chở được), build: `crew/ops/overlay-job.sh` (trên VPS).
- Đổi image: `crew/ops/deploy.sh` (từ chối khi còn run đang chạy, kiểm image, kiểm cấu hình policy, sao lưu trước,
  kiểm plugin khỏe sau khi đổi); quay lại: `crew/ops/rollback.sh`. Auto-deploy sau khi owner duyệt chạy qua
  `crew/ops/auto-deploy.mjs` theo cấu hình `crew/release/auto-deploy.json` (flow `ops-deploy`).
- Sao lưu hằng ngày trên VPS và kéo về Mac: flow `ops-backup`.
- Nâng bản Paperclip: `crew/release/upgrade.sh <tag>` merge tag upstream vào nhánh sync riêng rồi chạy
  `crew/release/verify.sh` (flow `core-hooks`).

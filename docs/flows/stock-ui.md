# UI Paperclip gốc ở /paperclip/ và chỗ trống khi log hoặc file đã bị dọn

> Flow `stock-ui`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow stock-ui` in ra đúng danh sách đó.

## Mục đích

Owner đôi khi cần so với UI Paperclip gốc (`ui/`) hoặc dùng màn hình crew-web chưa có. Flow này giữ hai việc:

- Phục vụ bản build tĩnh của UI gốc ở đường con `/paperclip/` trên cùng domain với crew-web. `/api` và WebSocket vẫn đi
  về server prod duy nhất, nên UI gốc dùng chung phiên và dữ liệu. crew-web có nút "Mở giao diện Paperclip gốc" chỉ cho
  owner, mở đúng trang đối tượng đang xem.
- Vá nhỏ trong `ui/` để ticket cũ vẫn hiện được khi nội dung đã bị dọn sau đó: log run bị xóa sau 7 ngày, file đính kèm
  có thể mất khỏi lưu trữ. Chỗ trống hiện nhãn cố định (`RUN_LOG_MISSING_LABEL`, `MISSING_FILE_LABEL`) thay vì lỗi hay
  ảnh hỏng.

Luật chính:

- Bản build UI gốc chỉ là file tĩnh; bật, tắt hay áp lại route `/paperclip/` không đụng server. Đổi cấu hình nginx luôn
  sao lưu, `nginx -t`, reload, kiểm các site, và tự khôi phục bản cũ khi bất kỳ bước nào hỏng.
- Gốc của nút trong crew-web lấy từ biến build `CREW_STOCK_UI_URL` (mặc định `/paperclip`); rỗng hay sai dạng thì ẩn
  nút. Chỉ nhận URL http/https hoặc đường cùng origin, từ chối `//host`.
- Run đã xong mà log trả 404 thì hiện chú thích lặng lẽ, không báo lỗi và không thử tải lại mãi.

## Điểm vào

- `crew/ops/stock-ui.sh install <tgz> <conf>`, `reapply`, `remove [conf]` chạy trên VPS. Cách build bản tĩnh
  (`PAPERCLIP_UI_BASE=/paperclip/`), tên container, thư mục và domain ghi ở đầu file này.
- `ui/src/main.tsx`: router của UI gốc lấy `basename` từ `import.meta.env.BASE_URL`, nên chạy được dưới đường con;
  `ui/vite.config.ts` đặt `base` từ `PAPERCLIP_UI_BASE`.
- crew-web: `StockUiSidebarItem` (cuối sidebar) và `StockUiMenuItem` (menu tài khoản).

## Các bước

1. `ui/vite.config.ts`: build UI gốc với `base` là đường con.
2. `crew/ops/stock-ui.sh` → `copy_files`, `apply_conf`, `check_sites`: chép file vào container nginx, đổi cấu hình edge
   (`crew/ops/nginx-crew.conf` có khối `/paperclip/`), kiểm, khôi phục khi lỗi.
3. `packages/crew-web/src/app/stock-ui.ts` → `normalizeStockUiBase`, `stockUiBase`, `stockUiUrl`: map trang Crew đang xem
   (`issues`, `projects`, `agents`, run của agent) sang đường tương ứng ở UI gốc; không map được thì trang chủ UI gốc.
4. `packages/crew-web/src/app/shell/stock-ui-link.tsx` → `useStockUiHref`: chỉ owner thấy, mở tab mới an toàn.
5. `ui/src/components/StoredImage.tsx` → `StoredImage`, `MissingFilePlaceholder`: ảnh lưu trữ mất file thì thay bằng
   khung giữ chỗ cùng cỡ; các component hiện ảnh và đính kèm của UI gốc dùng nó.
6. `ui/src/components/transcript/useLiveRunTranscripts.ts` và `ui/src/pages/AgentDetail.tsx`: run đã xong mà log trả
   404 thì ghi nhận là mất log và hiện `RUN_LOG_MISSING_LABEL`.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `crew/ops/stock-ui.sh` | Bật, áp lại, tắt route `/paperclip/` trên VPS | `copy_files`, `apply_conf`, `check_sites` |
| `ui/vite.config.ts` | Build UI gốc dưới đường con | |
| `ui/src/main.tsx` | Router UI gốc theo `BASE_URL` | |
| `ui/src/lib/retention-placeholders.ts` | Nhãn chỗ trống | `RUN_LOG_MISSING_LABEL`, `MISSING_FILE_LABEL` |
| `ui/src/components/StoredImage.tsx` | Ảnh lưu trữ có chỗ giữ khi mất file | `StoredImage`, `MissingFilePlaceholder` |
| `ui/src/components/transcript/useLiveRunTranscripts.ts` | Transcript run khi log đã mất | `useLiveRunTranscripts` |
| `ui/src/pages/AgentDetail.tsx` | Trang agent hiện chú thích mất log | |
| `ui/src/components/TaskChatThread.tsx`, `task-side-panel/TaskAttachmentPanel.tsx` | Luồng chat và đính kèm khi log hoặc file mất | |
| `ui/src/components/` (còn lại: `ImageGalleryModal`, `IssueAttachmentsSection`, `MarkdownBody`, `artifacts/RichArtifactCards`, `issue-output/*`, `task-chat/TaskChatBubble`) | Hiện ảnh qua `StoredImage` | |
| `packages/crew-web/src/app/stock-ui.ts` | Gốc và URL UI gốc | `stockUiBase`, `stockUiUrl`, `normalizeStockUiBase` |
| `packages/crew-web/src/app/shell/stock-ui-link.tsx` | Nút mở UI gốc | `useStockUiHref`, `StockUiSidebarItem`, `StockUiMenuItem` |

## Dữ liệu

- Không có bảng hay route mới. UI gốc gọi route lõi Paperclip như bình thường.
- Biến build: `PAPERCLIP_UI_BASE` (UI gốc), `CREW_STOCK_UI_URL` (crew-web, `packages/crew-web/vite.config.ts`).
- Biến môi trường của `crew/ops/stock-ui.sh` (`NGINX_CONTAINER`, `STOCK_UI_HOST_DIR`, `OPS_DIR`) và giá trị mặc định: xem
  đầu file đó.
- Việc dọn log run sau 7 ngày thuộc vận hành VPS, không thuộc flow này.

## Flow liên quan

- `web-shell`: sidebar và menu tài khoản gắn nút.
- `ops-deploy`: nginx edge và cách đưa file lên VPS.
- `ops-backup`: chính sách giữ log và dữ liệu khiến chỗ trống xuất hiện.
- `attachments`: crew-web có cách hiện file đã bị dọn riêng ("File không còn").
- `core-hooks`: các vá trong `ui/` phải giữ khi kéo upstream.

## Tests

- `packages/crew-web/test/app/stock-ui.test.ts`: chuẩn hóa gốc, chỉ nhận giao thức web và đường cùng origin, map URL.
- `packages/crew-web/test/app/stock-ui-link.test.tsx`: ẩn khi chưa có biến build hoặc không phải owner, mở tab mới an
  toàn, trỏ đúng trang.
- `ui/src/components/StoredImage.test.tsx`: thay file mất bằng khung giữ chỗ, thử lại khi đổi nguồn, bình luận vẫn đọc
  được khi ảnh trong bài đã bị xóa.
- `ui/src/pages/AgentDetail.log-visibility.test.tsx`: run đã xong mất log hiện chú thích lặng lẽ.
- `ui/src/components/transcript/useLiveRunTranscripts.test.tsx`, `ui/src/components/TaskChatThread.test.tsx`,
  `ui/src/components/task-side-panel/TaskAttachmentPanel.test.tsx`: hành vi transcript, luồng chat và tab đính kèm
  (gồm file mất hoặc quá lớn không bị tải).

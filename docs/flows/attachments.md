# File đính kèm: luật loại file, kiểm định kỳ, xem file

> Flow `attachments`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow attachments` in ra đúng danh sách đó.

## Mục đích

Paperclip nhận mọi loại file đính kèm, nhưng agent trên Mac chỉ đọc một số loại: `crew-mac files` (repo `crew`) từ
chối file bị cấm khi agent đọc. Flow này giữ cùng bộ luật loại file ở phía server để báo sớm cho người gửi và owner,
và cho crew-web xem file ngay trong trang.

Luật chính:

- Mac là bên quyết định agent được đọc gì; plugin chỉ cảnh báo. Ba danh sách (đuôi cho phép, nhóm kiểm chữ ký, đuôi
  macro) và bảng đuôi → nhãn là bản chép nguyên văn của `apps/crew-mac/src/files/policy.ts` trong repo `crew`, giữ khớp
  bằng test chuỗi giống hệt ở cả hai bên. Đổi bảng bên Mac thì chép lại ở đây và trong test.
- Plugin kết luận theo đuôi file; content type khai báo chỉ xét khi đuôi không được phép; nhóm ảnh, PDF, DOCX, XLSX
  được đọc 16 byte đầu để bắt file chạy được đổi đuôi. Không giữ hay log byte, tên file hay content type.
- Job kiểm mỗi phút, mỗi file chỉ phán một lần, mỗi issue một bình luận cho các file mới bị chặn. Bình luận không có
  `actorUserId` nên không đánh thức ai. Upload cũ hơn 24 giờ không kiểm. Lỗi đọc thử lại với độ trễ tăng dần (giữ
  trong bộ nhớ worker), quá số lần thì ghi `unreadable`.
- Web cảnh báo ngay khi chọn file (`warnForAttachment`) nhưng vẫn cho gửi.
- Ảnh trong markdown: chỉ ảnh file đính kèm cùng origin và ảnh raster base64 dưới ngưỡng được hiện; SVG và scheme lạ
  bị chặn; ảnh host khác chỉ thành link. URL `data:` dài được tách khỏi markdown trước khi phân tích để không treo trang.

## Điểm vào

- Job plugin `attachments-audit` (mỗi phút, khai trong manifest) → `registerAttachmentsAudit`.
- crew-web: chọn file ở ô soạn bình luận và dialog tạo yêu cầu (`AttachmentPicker`, `warnForAttachment`); hộp xem file
  (`AttachmentViewer`) mở từ danh sách đính kèm và link trong markdown của trang chi tiết issue.

## Các bước

1. `packages/crew-plugin/src/attachments/audit.ts` → `runAttachmentsAudit`: duyệt company Crew đã lưu (flow
   `crew-plugin`), đọc activity `issue.attachment_added` mới, bỏ file đã phán.
2. `packages/crew-plugin/src/attachments/rules.ts` → `judgeByName`: phán theo tên và content type, hoặc trả
   `needs-bytes`; `judgeBytes` phán theo chữ ký đầu file.
3. `packages/crew-plugin/src/attachments/audit.ts`: ghi kết quả vào `crew_attachment_audit`, gom file mới bị chặn của một
   issue thành một bình luận kèm `RESEND_HINT`.
4. `packages/crew-web/src/ds/widgets/attachment-picker.tsx` → `AttachmentPicker`: hiện cảnh báo trước khi gửi, người
   dùng gửi tiếp hoặc bỏ.
5. `packages/crew-web/src/ds/widgets/attachment-viewer-logic.ts` → `viewerKindFor`: chọn cách xem theo content type,
   thiếu hay chung chung thì theo đuôi; file chữ quá `TEXT_PREVIEW_MAX_BYTES` chỉ cho tải về.
6. `packages/crew-web/src/ds/widgets/attachment-viewer.tsx` → `AttachmentViewer`: ảnh có trước/sau, PDF và video nhúng,
   markdown và code, HTML trong iframe sandbox; file đã bị dọn thì báo "File không còn". Ảnh có zoom (xem bước 8).
7. `packages/crew-web/src/ds/widgets/attachment-link-context.ts` → `AttachmentLinkContext`: cho markdown mở file bằng
   hộp xem (provider ở `packages/crew-web/src/features/issues/detail/attachment-viewer-provider.tsx`, flow `issues-web`).
8. `packages/crew-web/src/ds/widgets/image-zoom.ts` và `image-zoom-view.tsx` → `useImageZoom`, `ZoomableImage`,
   `ImageZoomControls`: zoom ảnh trong hộp xem (chỉ ảnh hiện được). Mức 1 là vừa khung, tối đa 8; nút Thu nhỏ/Phóng
   to nhân 1.25, nhãn % là nút về vừa khung; cuộn chuột và chụm trackpad (`ctrlKey`) zoom quanh con trỏ, bấm đúp
   phóng 2.5 lần hoặc về vừa khung, kéo bằng pointer để di ảnh khi đã zoom (hai ngón chụm trên cảm ứng); phím `+`, `=`,
   `-`, `0` khi hộp có focus. Chỉ đổi `transform`; đổi ảnh hay đóng hộp thì về vừa khung.
9. `packages/crew-web/src/ds/widgets/markdown-image-policy.ts`: phân loại `src` của ảnh markdown.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `packages/crew-plugin/src/attachments/audit.ts` | Job kiểm file đính kèm | `registerAttachmentsAudit`, `runAttachmentsAudit` |
| `packages/crew-plugin/src/attachments/rules.ts` | Luật loại file (chép từ Mac) | `ALLOWED_EXTENSIONS`, `SNIFF_CHECKED`, `MACRO_EXTENSIONS`, `judgeByName`, `judgeBytes`, `warnForAttachment` |
| `packages/crew-plugin/src/shared-web/attachment-rules.ts` | Export luật cho crew-web | |
| `packages/crew-web/src/ds/widgets/attachment-picker.tsx` | Chọn file kèm cảnh báo | `AttachmentPicker` |
| `packages/crew-web/src/ds/widgets/attachment-viewer.tsx` | Hộp xem file | `AttachmentViewer` |
| `packages/crew-web/src/ds/widgets/attachment-viewer-logic.ts` | Chọn cách xem, bước ảnh | `viewerKindFor`, `stepIndex`, `TEXT_PREVIEW_MAX_BYTES` |
| `packages/crew-web/src/ds/widgets/image-zoom.ts` | Tính zoom: kẹp mức, zoom quanh điểm, giới hạn kéo | `clampScale`, `stepScale`, `zoomAt`, `panBy`, `wheelFactor` |
| `packages/crew-web/src/ds/widgets/image-zoom-view.tsx` | Hook, vùng ảnh và thanh nút zoom | `useImageZoom`, `ZoomableImage`, `ImageZoomControls` |
| `packages/crew-web/src/ds/widgets/attachment-link-context.ts` | Markdown mở hộp xem | `AttachmentLinkContext`, `useAttachmentLinks`, `isPlainClick` |
| `packages/crew-web/src/ds/widgets/markdown-image-policy.ts` | Luật ảnh trong markdown | |

## Dữ liệu

- Bảng plugin `crew_attachment_audit` (`0005_attachment_audit.sql`, sửa ở `0008_docs_storage.sql`).
- Activity lõi đọc: `issue.attachment_added`. Nội dung file đọc qua `getAttachmentContent` của SDK (tải cả file, tối đa
  10 MB, chỉ giải mã 16 byte đầu).
- Bình luận lõi: một bình luận cảnh báo mỗi issue cho file mới bị chặn.
- Log: `crew attachments audit` (chỉ company và số lượng), `crew attachments audit failed`.

## Flow liên quan

- `crew-plugin`: danh sách company Crew đã lưu mà job được quét, job khai trong manifest.
- `issues-web`: đính kèm, ô soạn, dialog tạo yêu cầu và provider hộp xem.
- `usage-storage`: cache file đính kèm trên Mac được báo trong mục Dung lượng.
- `design-system`: các widget nằm trong `ds/widgets`.

## Tests

- `packages/crew-plugin/src/__tests__/attachments-rules.test.ts`: ba danh sách và bảng nhãn đúng nguyên văn bản Mac,
  phán theo đuôi với lý do cố định, chữ ký file chạy được.
- `packages/crew-plugin/src/__tests__/attachments-audit.db.test.ts`: mỗi file cảnh báo một lần, không đánh thức assignee.
- `packages/crew-web/test/ds/attachment-picker.test.tsx`: cảnh báo trước khi gửi, vẫn cho gửi hoặc hủy.
- `packages/crew-web/test/ds/attachment-viewer-logic.test.ts`: đoán theo đuôi, markdown và HTML lưu `text/plain`, HEIC,
  file chữ quá lớn, bước trước/sau.
- `packages/crew-web/test/ds/image-zoom.test.ts`: kẹp mức, zoom giữ điểm dưới con trỏ, giới hạn kéo, hệ số wheel.
- `packages/crew-web/test/ds/attachment-viewer-zoom.test.tsx`: nút, phím, wheel, bấm đúp, đổi ảnh về vừa khung, loại
  khác ảnh không có điều khiển zoom.
- `packages/crew-web/test/ds/markdown-image-policy.test.ts`: ảnh cùng origin, ngưỡng ảnh nhúng, chặn scheme lạ, ảnh host
  khác thành link.

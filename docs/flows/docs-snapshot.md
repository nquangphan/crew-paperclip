# Docs dự án: nhận snapshot từ Mac, đọc docs, trạng thái, đồ thị

> Flow `docs-snapshot`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow docs-snapshot` in ra đúng danh sách đó.

## Mục đích

Docs của từng repo dự án (mọi file dưới `docs/` và `docs/flows.yaml`) nằm trên Mac có checkout, không nằm trên server.
`crew-mac` (`sendDocsSnapshots` trong repo `crew`) gửi ảnh chụp docs có ký HMAC lên plugin `crew.core`; plugin lưu theo
nội dung (content-addressed) để gửi lại cùng nội dung không tạo bản mới, giữ lịch sử, và phục vụ trang Docs, tab Docs
của project, panel kiểm docs trên issue và đồ thị docs. Người và agent đọc docs dự án mà không cần quyền vào máy.

Luật chính:

- Chỉ nhận trang dưới `docs/`, đường dẫn sạch (không `..`, không `\`); hash khai báo phải khớp nội dung, sai thì không
  ghi gì. File bị máy bỏ (quét bí mật, quá lớn) chỉ ghi tên.
- Snapshot chỉ hiện ra khi đã ghi xong (`completed_at`); hai lần gửi trùng cùng lúc chỉ một lần hoàn tất.
- Trạng thái docs của project (`docsState`): `missing`, `unverified`, `invalid`, `stale`, `current`. `stale` khi agent
  đã báo push một commit (`crew-commit sha=`) mà ảnh chụp chưa có commit đó.
- Đồ thị chỉ dựng từ `docs/flows.yaml`, link Markdown và commit của ticket (`GRAPH_NOTICE`), không phải call graph.
- Kết quả kiểm docs trên issue lấy từ comment `crew-docs check ...` mới nhất của agent giai đoạn docs ở issue gốc,
  cùng định dạng mà gate server kiểm.

## Điểm vào

- `POST /api/plugins/crew.core/webhooks/docs-snapshot` → `receiveDocsSnapshot`.
- Route plugin `GET /docs/graph` (`docs.graph`, board hoặc agent) → `handleDocsApi`.
- Data key `crew.docsCheck`, `crew.docs.projects`, `crew.docs.tree`, `crew.docs.page`, `crew.docs.search`,
  `crew.docs.history`, `crew.docs.graph`, `crew.docs.status`.
- crew-web: route `docs` (`packages/crew-web/src/features/docs/routes.tsx`) → `DocsPage`; tab Docs của project
  (`DocsTab`); panel `DocsCheckPanel` trên issue. UI stock: mục "Docs" trên trang Crew và panel `docs-check` trên tab
  Crew của issue.

## Các bước

1. `packages/crew-plugin/src/docs/webhook.ts` → `receiveDocsSnapshot`: xác thực chung (`authenticateCrewWebhook`, flow
   `machine-status`), `validateDocsSnapshot` (trang, manifest, commit), kiểm project thuộc company.
2. `packages/crew-plugin/src/docs/webhook.ts` → `storeDocsSnapshot`: tính khóa nội dung (`computeContentKey` trong
   `packages/crew-plugin/src/docs/content-key.ts`), ghi blob thiếu rồi so từng byte, ghi trang vào bản nháp, đánh dấu
   hoàn tất, cập nhật bản hiện hành; ghi commit và file đổi (mỗi commit một lần mỗi project).
3. `packages/crew-plugin/src/docs/manifest.ts` → `parseFlowsManifest`: đọc `docs/flows.yaml` của snapshot theo cùng
   schema với `crew-docs` (không dùng zod).
4. `packages/crew-plugin/src/docs/data.ts` → `loadDocsTree`, `loadDocsPage`, `searchDocs` (escape wildcard `LIKE`),
   `resolveSnapshot` (đọc snapshot cụ thể hoặc bản hiện hành, kiểm company và project), `loadDocsCheck` (leo lên issue
   gốc, đọc comment kiểm docs).
5. `packages/crew-plugin/src/docs/history.ts` → `loadDocsHistory`: danh sách snapshot đã hoàn tất, mới nhất trước, kèm
   thay đổi trang so với bản trước.
6. `packages/crew-plugin/src/docs/status.ts` → `loadDocsStatus`, `docsState`: so snapshot hiện hành với commit mới nhất
   agent báo đã push.
7. `packages/crew-plugin/src/docs/graph-data.ts` → `loadDocsGraph` và `packages/crew-plugin/src/docs/graph.ts` →
   `buildDocsGraph`: node project, flow, trang, file, ticket; thu hẹp theo một flow; quá nhiều node thì ẩn file.
8. `packages/crew-plugin/src/docs/api.ts` → `handleDocsApi`: route `docs.graph`; `companyId` lệch với company của actor
   bị từ chối, lỗi nội bộ trả câu chung và giữ chi tiết trong log.
9. `packages/crew-web/src/features/docs/docs-page.tsx` → `DocsPage`: thanh bên chọn project, tìm, cây trang
   (`docs-nav.tsx`), bài đọc (`DocsReader`), project và trang nằm trên URL (`?project=&path=`); chưa chọn trang thì mở
   `defaultDocPath`.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `packages/crew-plugin/src/docs/webhook.ts` | Nhận và lưu snapshot | `receiveDocsSnapshot`, `validateDocsSnapshot`, `storeDocsSnapshot` |
| `packages/crew-plugin/src/docs/content-key.ts` | Khóa nội dung snapshot | `computeContentKey` |
| `packages/crew-plugin/src/docs/manifest.ts` | Đọc `docs/flows.yaml` | `parseFlowsManifest` |
| `packages/crew-plugin/src/docs/data.ts` | Data key đọc docs và kiểm docs | `registerDocsData`, `loadDocsCheck`, `resolveSnapshot` |
| `packages/crew-plugin/src/docs/history.ts` | Lịch sử snapshot | `loadDocsHistory` |
| `packages/crew-plugin/src/docs/status.ts` | Trạng thái docs của project | `docsState`, `loadDocsStatus` |
| `packages/crew-plugin/src/docs/graph-data.ts` | Data key đồ thị và trạng thái | `loadDocsGraph`, `registerDocsGraph` |
| `packages/crew-plugin/src/docs/graph.ts` | Dựng đồ thị | `buildDocsGraph`, `GRAPH_NOTICE` |
| `packages/crew-plugin/src/docs/api.ts` | Route `docs.graph` | `handleDocsApi` |
| `packages/crew-plugin/src/ui/docs/index.ts` | Mục Docs và panel kiểm docs trong UI stock | `DocsSection`, `DocsCheckPanel` |
| `packages/crew-plugin/src/ui/docs/tree.ts` | Dựng cây thư mục | `buildDocsTree` |
| `packages/crew-plugin/src/ui/docs/types.ts` | Kiểu dữ liệu docs | `DocsTree`, `DocsPage`, `DocsCheckResult` |
| `packages/crew-plugin/src/ui/graph/docs-graph.tsx` | Vẽ đồ thị trong UI stock | `DocsGraphView` |
| `packages/crew-plugin/src/ui/graph/model.ts` | Lọc, bố cục, nhãn đồ thị | `filterGraph`, `layoutGraph`, `flowOptions` |
| `packages/crew-plugin/src/shared-web/docs-tree.ts` | Export cho crew-web | |
| `server/src/crew/docs-snapshot-body.ts` | Parser JSON 16 MB cho route webhook snapshot (vá lõi C15) | `crewDocsSnapshotJson`, `CREW_DOCS_SNAPSHOT_WEBHOOK_PATH` |
| `packages/crew-web/src/features/docs/routes.tsx` | Route `docs` | `routes` |
| `packages/crew-web/src/features/docs/index.ts` | Export feature | |
| `packages/crew-web/src/features/docs/docs-page.tsx` | Trang Docs | `DocsPage` |
| `packages/crew-web/src/features/docs/docs-nav.tsx` | Thanh bên trang Docs | `ProjectSwitch`, `DocsSidebarBody` |
| `packages/crew-web/src/features/docs/docs-reader.tsx` | Bài đọc | `DocsReader` |
| `packages/crew-web/src/features/docs/docs-paths.ts` | Hàm thuần: trang mặc định, bỏ tiêu đề trùng | `defaultDocPath`, `stripLeadingTitle` |
| `packages/crew-web/src/features/projects/detail/docs-tab.tsx` | Tab Docs của project | `DocsTab` |
| `packages/crew-web/src/ds/widgets/crew/docs-check-panel.tsx` | Kết quả kiểm docs của yêu cầu | `DocsCheckPanel` |

## Dữ liệu

- Bảng plugin: `docs_snapshots`, `docs_current`, `docs_pages`, `docs_links` (`0001_docs.sql`); `docs_blobs`,
  `docs_commits`, `docs_commit_files`, `docs_snapshot_pages` (`0008_docs_storage.sql`).
- Bảng lõi đọc: `projects`, `issues` (`execution_policy`), `issue_comments` (comment `crew-docs check` và
  `crew-commit sha=`).
- Giới hạn webhook: body 16 MiB (`DOCS_SNAPSHOT_MAX_BYTES`), manifest 512 KiB, số commit và đường dẫn mỗi lần gửi (hằng
  đầu `packages/crew-plugin/src/docs/webhook.ts`). Parser JSON toàn server chỉ nhận 10 MB, nên vá lõi C15 gắn parser
  16 MB riêng cho đúng route `POST /api/plugins/crew.core/webhooks/docs-snapshot` (`server/src/crew/docs-snapshot-body.ts`,
  gắn trong `server/src/app.ts` trước parser toàn server, vẫn giữ `rawBody` để kiểm HMAC). Route khác giữ trần 10 MB.
  crew-mac (repo crew) dừng trước khi gửi body quá 16 MB. Trần cũ 5 MiB làm repo có `docs/` khoảng 5 MB (kidy_school_2.0_docs)
  không gửi được snapshot nào từ 16/10 đến 23/10/2026.
- Viewer: các data key docs mà UI viewer cần nằm trong `CREW_VIEWER_DATA_KEYS` (flow `crew-plugin`).

## Flow liên quan

- `machine-status`: khung webhook và HMAC chung.
- `issue-gate`: gate server kiểm comment `crew-docs check` cùng định dạng với `parseCrewDocsCheck`.
- `roadmap-map`: tóm tắt Crew trên issue hiện kết quả kiểm docs.
- `usage-storage`: báo dung lượng bảng docs.
- `crew-plugin`: worker, viewer đọc data.
- `web-pages`: trang chi tiết project chứa tab Docs.

## Tests

- `packages/crew-plugin/src/__tests__/docs.test.ts`, `docs.db.test.ts`: chỉ nhận trang trong `docs/`, lý do bỏ file
  hợp lệ, lưu lịch sử, chặn webhook sai, đọc theo phạm vi company, tìm với wildcard literal.
- `packages/crew-plugin/src/__tests__/docs-dedup.db.test.ts`: lưu theo nội dung, gửi lại là cùng snapshot, gửi trùng
  đồng thời chỉ hoàn tất một, hash sai thì không ghi gì, commit ghi một lần.
- `packages/crew-plugin/src/__tests__/docs-content-key.test.ts`: khóa nội dung không phụ thuộc thứ tự trang.
- `packages/crew-plugin/src/__tests__/docs-manifest.test.ts`: đọc manifest, mặc định mảng rỗng, cắt danh sách lỗi.
- `packages/crew-plugin/src/__tests__/docs-status.test.ts`: lý do `stale` nêu commit và giờ Việt Nam.
- `packages/crew-plugin/src/__tests__/docs-graph.test.ts`, `docs-graph.db.test.ts`: node và cạnh đồ thị, thu hẹp theo
  flow, ẩn file khi quá nhiều node, route cho board và agent, từ chối company khác, lỗi nội bộ trả câu chung.
- `packages/crew-plugin/src/__tests__/docs-check-evidence.test.ts`, `packages/crew-plugin/src/docs/docs-check-empty.test.ts`:
  định dạng comment kiểm docs khớp gate server; chưa có issue gốc thì trả null.
- `packages/crew-plugin/src/ui/docs/content.test.ts`, `tree.test.ts`, `packages/crew-plugin/src/ui/graph/model.test.ts`:
  hiển thị tác giả và kết quả sai dạng, cây lồng, lọc và bố cục đồ thị, danh sách flow khi đã thu hẹp.
- `packages/crew-web/test/ds/crew/docs-check-panel.test.tsx`: Đạt/Lỗi, bằng chứng sai dạng, chưa có kết quả.
- `packages/crew-web/test/features/docs/docs-page.test.tsx`, `docs-paths.test.ts`: trang mặc định, URL giữ project và
  trang, đổi project, bỏ tiêu đề trùng.

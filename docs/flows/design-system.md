# Design system của UI Crew

> Flow `design-system`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow design-system` in ra đúng danh sách đó.

## Mục đích

crew-web cần trông và cư xử như UI Paperclip gốc nhưng không import `ui/src/**` (để kéo upstream không làm vỡ UI Crew).
Design system `@/ds` chép token và component của Paperclip vào `packages/crew-web/src/ds`, thêm component và widget tự
dựng, và là cổng duy nhất màn hình được dùng. Muốn đổi giao diện thì chỉ sửa `tokens.css` và `components/`.

Cấu trúc thư mục, luật và cách xem thử nằm ở `packages/crew-web/src/ds/README.md`; luật được kiểm bằng
`packages/crew-web/test/guards/design-system.test.ts`. Tóm tắt lý do:

- Màn hình (`src/features`, `src/app`) không dùng `style=` và chỉ dùng class bố cục (`LAYOUT_CLASSES`), để giao diện chỉ
  có một chỗ quyết định.
- Ngoài `src/ds` không import thư viện UI thô (radix, base-ui, cva, lucide); icon lấy qua `@/ds/icons`.
- Mỗi component ghi nguồn ở dòng đầu: `// clone: ui/src/components/ui/<tên>.tsx @ <phiên bản>` hoặc `// crew: tự dựng`,
  để biết file nào phải so lại khi kéo upstream.
- Cổng `@/ds` không được kéo trình render markdown hay `@xyflow` vào chunk khởi đầu (tải lười).
- Không có chữ cứng trong component và widget; mọi chữ qua i18n, `vi.json` và `en.json` cùng tập khóa
  (`packages/crew-web/test/guards/i18n.test.ts`).

## Điểm vào

- `packages/crew-web/src/ds/index.ts`: cổng export duy nhất; màn hình chỉ import từ `@/ds` (và `@/ds/icons`).
- Trang `/ds` (chỉ khi dev, `packages/crew-web/src/dev/ds-page.tsx`): mọi component và widget ở theme sáng và tối;
  mẫu widget Crew ở `packages/crew-web/src/dev/crew-showcase.tsx` (dữ liệu giả chỉ để xem giao diện).

## Các bước

1. `packages/crew-web/src/ds/tokens.css`: biến màu, bán kính, chuyển động; theme sáng (`:root`) và tối (`.dark`), chép
   từ `ui/src/index.css` và `ui/src/motion-tokens.css`.
2. `packages/crew-web/src/ds/components/`: component chép từ `ui/src/components/ui/*` và component tự dựng (bảng, field,
   trạng thái trống và lỗi, spinner, `ThemeScope`, `AppFrame`).
3. `packages/crew-web/src/ds/components/app-frame.tsx` → `AppFrame`: khung trang cho shell; dưới `md` ẩn sidebar và mở
   thành ngăn kéo.
4. `packages/crew-web/src/ds/widgets/`: widget ghép từ component (danh sách và chi tiết issue, bảng Kanban, markdown,
   transcript, wizard, tài liệu...), không gọi API; dữ liệu do feature truyền vào.
5. `packages/crew-web/src/ds/index.ts`: export mọi component và widget.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `packages/crew-web/src/ds/index.ts` | Cổng export | |
| `packages/crew-web/src/ds/tokens.css` | Token giao diện | |
| `packages/crew-web/src/ds/cn.ts` | Ghép class | `cn` |
| `packages/crew-web/src/ds/icons.ts` | Icon được phép dùng ngoài ds | |
| `packages/crew-web/src/ds/brand/Logo.tsx` | Logo "2P Crew" | `Logo` |
| `packages/crew-web/src/ds/components/app-frame.tsx` | Khung trang và sidebar | `AppFrame` |
| `packages/crew-web/src/ds/components/theme-scope.tsx` | Bọc vùng theo theme | `ThemeScope` |
| `packages/crew-web/src/ds/components/` (còn lại) | Component cơ bản (button, dialog, select, tabs, table...) | |
| `packages/crew-web/src/ds/widgets/markdown-view.tsx`, `markdown-renderer.tsx` | Markdown tải lười | `MarkdownView` |
| `packages/crew-web/src/ds/widgets/issue-detail.tsx` | Khung chi tiết issue, khung ô soạn bình luận | `ComposerDock` |
| `packages/crew-web/src/ds/widgets/` (còn lại) | Widget dùng chung (danh sách, Kanban, transcript, wizard, tài liệu, trạng thái...) | |
| `packages/crew-web/src/dev/ds-page.tsx` | Trang `/ds` | `DsPage` |
| `packages/crew-web/src/dev/crew-showcase.tsx` | Mẫu widget Crew cho `/ds` | |

Widget Crew trong `ds/widgets/crew/` và `ds/widgets/roadmap/`, và widget đính kèm, thuộc flow của tính năng tương ứng
(`roadmap-map`, `docs-snapshot`, `machine-status`, `setup-wizards`, `attachments`).

## Dữ liệu

- Không đọc hay ghi dữ liệu; không gọi API.
- Nguồn chép: `ui/src/components/ui/*`, `ui/src/index.css`, `ui/src/motion-tokens.css` của Paperclip (phiên bản ghi ở
  dòng đầu từng file).

## Flow liên quan

- `web-shell`: shell dùng `AppFrame`, sidebar và component.
- `web-pages`, `issues-web`, `skills`, `setup-wizards`, `guide`: màn hình dùng component và widget.
- `roadmap-map`, `docs-snapshot`, `machine-status`, `attachments`: sở hữu các widget Crew riêng trong `ds/widgets`.
- `core-hooks`: kéo upstream thì so lại các file `clone:`.

## Tests

- `packages/crew-web/test/guards/design-system.test.ts`: không style inline, chỉ class bố cục, không import thư viện UI
  thô, component ghi nguồn, không kéo markdown hay `@xyflow` vào chunk đầu, bộ quét không xanh vì quét rỗng.
- `packages/crew-web/test/guards/i18n.test.ts`: hai locale cùng khóa, không chữ cứng.
- `packages/crew-web/test/ds/`: hành vi từng component và widget (button, dialog, confirm, alert, nhãn mặc định, dòng
  danh sách, section và code block, status badge, markdown, wizard, ô soạn). Test trong `test/ds/crew/` và các test đính
  kèm, markdown-image thuộc flow tính năng tương ứng.

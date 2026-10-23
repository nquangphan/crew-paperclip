# Bản đồ yêu cầu và Roadmap

> Flow `roadmap-map`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow roadmap-map` in ra đúng danh sách đó.

## Mục đích

Một yêu cầu Crew là một issue gốc (có policy Crew) với cây việc con, cạnh phụ thuộc và vòng sửa. Flow này cho người xem
thấy cả cây đó: plugin dựng bản đồ từ bảng issue, crew-web vẽ bản đồ ở trang chi tiết issue và ở trang Roadmap (công ty
→ project → yêu cầu → cây việc con, kèm nhánh Docs của project). Thẻ việc có vài run mới nhất và tổng tiền; owner thấy
thêm huy hiệu Jev.

Luật chính:

- Worker cung cấp mọi quan hệ; phía vẽ chỉ kiểm hai đầu cạnh và gán id ổn định, không tự suy quan hệ. Việc không nối
  được về gốc vẫn được vẽ (treo dưới gốc) và cạnh hỏng ghi vào `diagnostics`.
- Tiền run là USD quy đổi giá API do CLI báo; không có thì `cost_events.cost_cents` khi > 0; không có gì thì `null`
  (hiện "—"), không bao giờ coi là 0.
- Roadmap chỉ hiện project người xem được cấp; yêu cầu không thuộc project chỉ owner thấy; chỉ yêu cầu gốc do người tạo
  mới thành nút. Deep link tới thứ không được xem ra cùng một thông báo chung.
- Mỗi tầng có trần số nút (`CAPS`); vượt thì có nút "+N khác" mở dạng danh sách. Dạng danh sách cũng là bản thay thế cho
  trình đọc màn hình.
- Tầng đang xem nằm trên URL (`roadmap-url.ts`) để gửi link và nút Back lùi tầng.

## Điểm vào

- Data key `crew.map` (`issueId`), `crew.roots` (`status`), `crew.runs`.
- crew-web: route `roadmap` (`packages/crew-web/src/features/roadmap/routes.tsx`) → `RoadmapPage`; bản đồ và dòng tóm
  tắt Crew ở trang chi tiết issue (`CrewMap`, `CrewSummary`, gắn trong
  `packages/crew-web/src/features/issues/detail/crew/summary-slot.tsx`, flow `issues-web`).
- UI stock: tab Crew của issue (`TicketMap`) và mục "Yêu cầu" trên trang Crew.

## Các bước

1. `packages/crew-plugin/src/handlers/map.ts` → `loadCrewMap`: từ một issue leo lên gốc, đọc cả cây, quan hệ phụ thuộc
   và vòng sửa; mỗi nút có giai đoạn, người làm, số vòng duyệt, loại việc (`code`, `research`, `fix`), bundle. Worker không đọc được nhãn nên yêu cầu Viết tài liệu / Lập kế hoạch vẫn báo `code`.
2. `packages/crew-plugin/src/handlers/roots.ts` → `loadCrewRoots`: danh sách yêu cầu gốc của company (lọc `isCrewRoot`),
   mới nhất trước, kèm tiến độ việc con trực tiếp.
3. `packages/crew-plugin/src/handlers/runs.ts` → `loadMapRuns`, `loadRequestRuns`: run tóm tắt theo issue, cùng nguồn
   với báo cáo chi phí (`heartbeat_runs` + `cost_events`), tối đa `MAP_RUNS_LIMIT` mỗi việc.
4. `packages/crew-plugin/src/ui/map/project.ts` → `projectCrewMap` và `layout.ts` → `layoutHierarchy`: chiếu bản đồ
   thành cạnh và vị trí; crew-web dùng lại qua `packages/crew-plugin/src/shared-web/map.ts`.
5. `packages/crew-web/src/ds/widgets/crew/crew-map-level.ts` → `crewMapLevel`: đổi bản đồ Crew thành một tầng Roadmap
   (cạnh phụ thuộc thành "chặn"); `crew-map.tsx` → `CrewMap` vẽ nó bằng canvas Roadmap. Tham số `rootKind` (`docs` | `plan` | null,
   `SummarySlot` lấy từ nhãn của yêu cầu gốc) đổi nhãn loại của việc `code` thành "Viết tài liệu" hoặc "Lập kế hoạch"; việc `fix` vẫn là "Sửa".
6. `packages/crew-web/src/features/roadmap/use-roadmap.ts` → `useRoadmapData`: issue, project, docs và run, lọc theo
   project được cấp; huy hiệu Jev chỉ tải cho owner và chỉ làm tươi khi Jev bật.
7. `packages/crew-web/src/features/roadmap/roadmap-model.ts`: dựng từng tầng (công ty, project, yêu cầu, nhánh Docs)
   thành `RoadmapLevel`; không gọi API, không đọc URL.
8. `packages/crew-web/src/features/roadmap/roadmap-page.tsx` → `RoadmapPage`: điều hướng tầng, popup chi tiết yêu cầu
   (`?issue=`), popup đọc docs (`?doc=`, `RoadmapDocReader`), dạng danh sách (`?view=list`).
9. `packages/crew-web/src/ds/widgets/roadmap/`: canvas (`RoadmapCanvas`, phần nặng `roadmap-flow.tsx` nạp lười), bố cục
   tỏa tròn và cây (`roadmap-layout.ts`), thẻ nút, khối run, chú giải, huy hiệu Jev và dòng cờ "Jev: nên là large" (`RoadmapComplexityFlag`, từ `complexityFlags` của
   bản đồ Jev; thẻ cao thêm `COMPLEXITY_LINE`).

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `packages/crew-plugin/src/handlers/map.ts` | Data key `crew.map` | `loadCrewMap`, `isCrewRoot`, `CrewMap` |
| `packages/crew-plugin/src/handlers/roots.ts` | Data key `crew.roots` | `loadCrewRoots`, `CrewRoot` |
| `packages/crew-plugin/src/handlers/runs.ts` | Data key `crew.runs` | `loadMapRuns`, `loadRequestRuns`, `MAP_RUNS_LIMIT` |
| `packages/crew-plugin/src/shared-web/map.ts` | Export bản đồ cho crew-web | |
| `packages/crew-plugin/src/ui/map/project.ts` | Chiếu bản đồ thành cạnh | `projectCrewMap` |
| `packages/crew-plugin/src/ui/map/layout.ts` | Bố cục cây cha-con | `layoutHierarchy` |
| `packages/crew-plugin/src/ui/map/ticket-map.tsx` | Bản đồ trong UI stock | `TicketMap` |
| `packages/crew-plugin/src/ui/map/ticket-node.tsx` | Thẻ việc, nhãn trạng thái và giai đoạn | `TicketNode`, `statusLabel`, `stageLabel` |
| `packages/crew-plugin/src/ui/map/ticket-edge.tsx` | Cạnh cha-con, phụ thuộc, sửa | `ticketEdgeTypes` |
| `packages/crew-web/src/ds/widgets/crew/crew-map-level.ts` | Bản đồ Crew thành tầng Roadmap | `crewMapLevel` |
| `packages/crew-web/src/ds/widgets/crew/crew-map.tsx` | Bản đồ yêu cầu ở trang issue | `CrewMap` |
| `packages/crew-web/src/ds/widgets/crew/crew-summary.tsx` | Dòng tóm tắt Crew | `CrewSummary`, `crewSummaryLine` |
| `packages/crew-web/src/ds/widgets/roadmap/roadmap-canvas.tsx` | Canvas bản đồ (nạp lười) | `RoadmapCanvas` |
| `packages/crew-web/src/ds/widgets/roadmap/roadmap-flow.tsx` | xyflow và chuyển động camera | |
| `packages/crew-web/src/ds/widgets/roadmap/roadmap-layout.ts` | Bố cục thuần | `rings`, `radialTree` |
| `packages/crew-web/src/ds/widgets/roadmap/roadmap-types.ts` | Kiểu dữ liệu bản đồ | `RoadmapNode`, `RoadmapRuns`, `RoadmapJev` |
| `packages/crew-web/src/ds/widgets/roadmap/` (còn lại) | Thẻ nút, khối run, chú giải, danh sách, popup docs, huy hiệu Jev | `RoadmapList`, `RoadmapRunList`, `RoadmapLegend`, `RoadmapJevBadge` |
| `packages/crew-web/src/features/roadmap/roadmap-page.tsx` | Trang Roadmap | `RoadmapPage` |
| `packages/crew-web/src/features/roadmap/roadmap-model.ts` | Dựng tầng | `CAPS`, `LIST_LIMIT` |
| `packages/crew-web/src/features/roadmap/roadmap-url.ts` | Hợp đồng URL | `parseRoadmapParams`, `roadmapHref` |
| `packages/crew-web/src/features/roadmap/use-roadmap.ts` | Dữ liệu trang | `useRoadmapData` |
| `packages/crew-web/src/features/roadmap/roadmap-doc-reader.tsx` | Popup đọc docs | `RoadmapDocReader` |
| `packages/crew-web/src/features/roadmap/routes.tsx`, `index.ts` | Route `roadmap` | `routes` |

## Dữ liệu

- Bảng lõi đọc: `issues` (`parent_id`, `execution_policy`, `execution_state`, mô tả có marker bundle và fix),
  `issue_relations`, `agents`, `heartbeat_runs`, `cost_events`.
- Không ghi bảng nào.
- Jev: route bản đồ Jev của router Crew (`api.jev.requestMap`, flow `jev`).

## Flow liên quan

- `issues-web`: trang chi tiết issue và popup yêu cầu chứa bản đồ.
- `docs-snapshot`: nhánh Docs của Roadmap và kết quả kiểm docs trong tóm tắt.
- `usage-storage`: cùng nguồn tiền run.
- `jev`: số liệu huy hiệu Jev.
- `project-access`: lọc project được cấp (`useVisibleProjects`).
- `design-system`: widget nằm trong `ds/widgets`.

## Tests

- `packages/crew-plugin/src/__tests__/map.data.test.ts`, `roots.data.test.ts`: đọc cây có phụ thuộc và vòng sửa trên
  Postgres thật; chỉ liệt kê gốc Crew, kèm tiến độ và giai đoạn.
- `packages/crew-plugin/src/__tests__/map-runs.test.ts`: model và tiền của run, thứ tự ưu tiên nguồn, `null` khi không có.
- `packages/crew-plugin/src/ui/map/component.test.ts`, `project.test.ts`: thẻ việc trong UI stock, chiếu cạnh không bịa
  quan hệ.
- `packages/crew-web/test/ds/crew/crew-map-level.test.ts`, `crew-map.test.tsx`, `crew-summary.test.tsx`: tầng từ bản đồ
  Crew, việc treo dưới gốc, bấm mở issue, dòng tóm tắt.
- `packages/crew-web/test/ds/crew/roadmap-canvas.test.tsx`, `roadmap-edges.test.tsx`, `roadmap-layout.test.ts`,
  `roadmap-runs.test.tsx`: nút có nhãn đọc màn hình, dây đang chạy và giảm chuyển động, bố cục, định dạng dòng run.
- `packages/crew-web/test/features/roadmap/roadmap-page.test.tsx`, `roadmap-model.test.ts`, `roadmap-url.test.ts`,
  `roadmap-jev.test.tsx`: điều hướng tầng và quyền xem, trần nút, URL, màu và chữ huy hiệu Jev.

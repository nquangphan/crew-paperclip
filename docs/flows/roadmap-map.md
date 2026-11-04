# Bản đồ yêu cầu và Roadmap

> Flow `roadmap-map`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow roadmap-map` in ra đúng danh sách đó.

## Mục đích

Một yêu cầu Crew là một issue gốc (có policy Crew) với cây việc con, cạnh phụ thuộc và vòng sửa. Flow này cho người xem
thấy cả cây đó: plugin dựng bản đồ từ bảng issue, crew-web vẽ bản đồ ở trang chi tiết issue và ở trang Roadmap (công ty
→ project → yêu cầu → cây việc con, kèm nhánh Docs của project). Thẻ việc có vài run mới nhất và tổng tiền.

Luật chính:

- Worker cung cấp mọi quan hệ; phía vẽ chỉ kiểm hai đầu cạnh và gán id ổn định, không tự suy quan hệ. Việc không nối
  được về gốc vẫn được vẽ (treo dưới gốc) và cạnh hỏng ghi vào `diagnostics`.
- Tiền run là USD quy đổi giá API do CLI báo; không có thì `cost_events.cost_cents` khi > 0; không có gì thì `null`
  (hiện "—"), không bao giờ coi là 0.
- Roadmap chỉ hiện project người xem được cấp; yêu cầu không thuộc project chỉ owner thấy; chỉ yêu cầu gốc do người tạo
  mới thành nút. Deep link tới thứ không được xem ra cùng một thông báo chung. Với `crew.roadmap`, luật này áp ở server:
  router Crew ghi đè phạm vi xem vào params, worker lọc trong SQL (cả việc con nằm ở project không được cấp).
- Cây của mọi yêu cầu đến trong một lần tải `crew.roadmap` với số query cố định (tối đa 3), không gọi theo từng yêu
  cầu. Run và tiền tải lười theo yêu cầu đang xem (`crew.runs`).
- Mỗi tầng có trần số nút (`CAPS`); vượt thì có nút "+N khác" mở dạng danh sách. Dạng danh sách cũng là bản thay thế cho
  trình đọc màn hình.
- Tầng đang xem nằm trên URL (`roadmap-url.ts`) để gửi link và nút Back lùi tầng.

## Điểm vào

- Data key `crew.map` (`issueId`), `crew.roots` (`status`), `crew.runs`, `crew.roadmap` (không tham số từ client;
  `viewer` do server ghi).
- crew-web: route `roadmap` (`packages/crew-web/src/features/roadmap/routes.tsx`) → `RoadmapPage`; bản đồ và dòng tóm
  tắt Crew ở trang chi tiết issue (`CrewMap`, `CrewSummary`, gắn trong
  `packages/crew-web/src/features/issues/detail/crew/summary-slot.tsx`, flow `issues-web`).
- UI stock: tab Crew của issue (`TicketMap`) và mục "Yêu cầu" trên trang Crew.

## Các bước

1. `packages/crew-plugin/src/handlers/map.ts` → `loadCrewMap`: từ một issue leo lên gốc, đọc cả cây, quan hệ phụ thuộc
   và vòng sửa; mỗi nút có giai đoạn, người làm, số vòng duyệt, loại việc (`crewNodeKind`: `code`, `code-bf`, `research`, `fix`), bundle. Worker không đọc được nhãn nên yêu cầu Viết tài liệu / Lập kế hoạch vẫn báo `code`. `code-bf` là gốc theo luồng Bug Finding: cùng loại việc lập trình, chỉ khác thứ tự stage (integrator gộp trước, reviewer cầu nối, owner, integrator merge), nên `stageLabel` (UI stock) và `resolveStageKey` (crew-web) đặt tên giai đoạn theo thứ tự đó, cùng nhãn với dải giai đoạn của ticket tổng (Gộp code + PR, Review Bug Finding, Owner duyệt, Merge); `crew.roots` báo `kind` `code-bf` như vậy.
2. `packages/crew-plugin/src/handlers/roots.ts` → `loadCrewRoots`: danh sách yêu cầu gốc của company (lọc `isCrewRoot`),
   mới nhất trước, kèm tiến độ việc con trực tiếp.
3. `packages/crew-plugin/src/handlers/roadmap.ts` → `loadCrewRoadmap`: cây của mọi yêu cầu gốc do người tạo mà người
   xem thấy, phẳng (`nodes` có `rootId`, `projectId`, `createdByUserId`, `createdAt` cùng các trường của `CrewMapNode`),
   kèm `requests`, `edges` (cha-con, chặn, sửa, vòng sửa, dựng như `crew.map` qua `crewRepairEdges` và
   `reviewRoundEdges`), `diagnostics`, `truncated` (vượt `ROADMAP_NODE_LIMIT`). Query: Q1 một `WITH RECURSIVE` từ mọi
   gốc thấy được, mỗi bước lọc project nên nhánh không được cấp bị cắt cả cây, JOIN `agents` lấy tên người làm; Q2
   quan hệ `blocks` trong tập; Q3 chỉ khi có việc `crew-fix`: comment `crew-commit` của việc anh em. Không trả
   `description`. `viewer` thiếu hoặc sai (`parseRoadmapViewer`) thì trả rỗng. Đo 2026-11-04 trên dữ liệu cỡ company
   thật (165 yêu cầu, 630 issue): 3 query, ~13 ms ở Postgres, 426 KB JSON, 15 KB gzip; cách cũ cần danh sách cả company
   2 MB (3,5 – 6,5 s) cộng một lần gọi cây cho mỗi yêu cầu (101 lần, ~2 s mỗi lần).
4. `server/src/crew/plugin-data-scope.ts` → `crewRoadmapViewerScope` (gắn trong `crewContributionRoutes`, trước route
   plugin stock, không thêm vá lõi): với `POST /plugins/:pluginId/data/crew.roadmap` và `bridge/data` có
   `key: "crew.roadmap"`, tính `visibleProjectsFor` của người gọi và ghi đè `params.viewer` (owner `{ all: true }`,
   người khác `{ all: false, projectIds }`); actor không phải phiên trình duyệt, company không thuộc phiên hay lỗi đọc
   quyền thì phạm vi rỗng. Key nằm trong `CREW_VIEWER_DATA_KEYS` để viewer đọc được.
5. `packages/crew-plugin/src/handlers/runs.ts` → `loadMapRuns`, `loadRequestRuns`: run tóm tắt theo issue, cùng nguồn
   với báo cáo chi phí (`heartbeat_runs` + `cost_events`), tối đa `MAP_RUNS_LIMIT` mỗi việc.
6. `packages/crew-plugin/src/ui/map/project.ts` → `projectCrewMap` và `layout.ts` → `layoutHierarchy`: chiếu bản đồ
   thành cạnh và vị trí; crew-web dùng lại qua `packages/crew-plugin/src/shared-web/map.ts`.
7. `packages/crew-web/src/ds/widgets/crew/crew-map-level.ts` → `crewMapLevel`: đổi bản đồ Crew thành một tầng Roadmap
   (cạnh phụ thuộc thành "chặn"); `crew-map.tsx` → `CrewMap` vẽ nó bằng canvas Roadmap. Tham số `rootKind` (`docs` | `plan` | null,
   `SummarySlot` lấy từ nhãn của yêu cầu gốc) đổi nhãn loại của việc `code` thành "Viết tài liệu" hoặc "Lập kế hoạch"; việc `fix` vẫn là "Sửa"; `code-bf` hiện là "Lập trình".
8. `packages/crew-web/src/features/roadmap/use-roadmap.ts` → `useRoadmapData`: một query `crew.roadmap` (khóa
   `queryKeys.crew('crew.roadmap', { companyId })`, nằm dưới tiền tố `crew` nên sự kiện live của issue làm tươi) cho
   mọi tầng: công ty, project, cây yêu cầu (theo `rootId`) và tên người làm đều dựng từ cùng dữ liệu, nên chuyển tầng
   không gọi mạng; lọc thêm bằng `useVisibleProjects`. Project, run (`crew.runs`, theo yêu cầu đang xem) và docs tải
   riêng.
9. `packages/crew-web/src/features/roadmap/roadmap-model.ts`: dựng từng tầng (công ty, project, yêu cầu, nhánh Docs)
   thành `RoadmapLevel`; `issuesFromRoadmap` đổi nút `crew.roadmap` thành issue phẳng (chặn lấy từ cạnh `dependency`);
   không gọi API, không đọc URL.
10. `packages/crew-web/src/features/roadmap/roadmap-page.tsx` → `RoadmapPage`: điều hướng tầng, popup chi tiết yêu cầu
   (`?issue=`), popup đọc docs (`?doc=`, `RoadmapDocReader`), dạng danh sách (`?view=list`).
11. `packages/crew-web/src/ds/widgets/roadmap/`: canvas (`RoadmapCanvas`, phần nặng `roadmap-flow.tsx` nạp lười), bố cục
   tỏa tròn và cây (`roadmap-layout.ts`), thẻ nút, khối run, chú giải.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `packages/crew-plugin/src/handlers/map.ts` | Data key `crew.map` | `loadCrewMap`, `isCrewRoot`, `crewNodeKind`, `crewRepairEdges`, `CrewMap` |
| `packages/crew-plugin/src/handlers/roadmap.ts` | Data key `crew.roadmap` | `loadCrewRoadmap`, `CrewRoadmap`, `parseRoadmapViewer`, `ROADMAP_NODE_LIMIT` |
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
| `packages/crew-web/src/ds/widgets/roadmap/roadmap-types.ts` | Kiểu dữ liệu bản đồ | `RoadmapNode`, `RoadmapRuns` |
| `packages/crew-web/src/ds/widgets/roadmap/` (còn lại) | Thẻ nút, khối run, chú giải, danh sách, popup docs | `RoadmapList`, `RoadmapRunList`, `RoadmapLegend` |
| `packages/crew-web/src/features/roadmap/roadmap-page.tsx` | Trang Roadmap | `RoadmapPage` |
| `packages/crew-web/src/features/roadmap/roadmap-model.ts` | Dựng tầng | `CAPS`, `issuesFromRoadmap` |
| `packages/crew-web/src/features/roadmap/roadmap-url.ts` | Hợp đồng URL | `parseRoadmapParams`, `roadmapHref` |
| `packages/crew-web/src/features/roadmap/use-roadmap.ts` | Dữ liệu trang | `useRoadmapData` |
| `packages/crew-web/src/features/roadmap/roadmap-doc-reader.tsx` | Popup đọc docs | `RoadmapDocReader` |
| `packages/crew-web/src/features/roadmap/routes.tsx`, `index.ts` | Route `roadmap` | `routes` |

## Dữ liệu

- Bảng lõi đọc: `issues` (`parent_id`, `project_id`, `created_by_user_id`, `execution_policy`, `execution_state`, mô tả
  có marker bundle và fix), `issue_relations`, `issue_comments` (`crew-commit`), `agents`, `heartbeat_runs`,
  `cost_events`. Server đọc thêm `company_memberships` và bảng plugin `crew_project_access` để tính phạm vi xem.
- Không ghi bảng nào.

## Flow liên quan

- `issues-web`: trang chi tiết issue và popup yêu cầu chứa bản đồ.
- `docs-snapshot`: nhánh Docs của Roadmap và kết quả kiểm docs trong tóm tắt.
- `usage-storage`: cùng nguồn tiền run.
- `project-access`: lọc project được cấp (`useVisibleProjects` ở web, `visibleProjectsFor` ở server cho `crew.roadmap`).
- `crew-plugin`: `CREW_VIEWER_DATA_KEYS` và router Crew gắn trước route plugin stock.
- `design-system`: widget nằm trong `ds/widgets`.

## Tests

- `packages/crew-plugin/src/__tests__/map.data.test.ts`, `roots.data.test.ts`: đọc cây có phụ thuộc và vòng sửa trên
  Postgres thật; chỉ liệt kê gốc Crew, kèm tiến độ và giai đoạn.
- `packages/crew-plugin/src/__tests__/roadmap.data.test.ts`: Postgres thật; cây đủ của mọi yêu cầu cho owner, người được
  cấp một project không thấy project khác, yêu cầu ngoài project hay nhánh con ở project không được cấp, viewer thiếu
  hoặc sai thì rỗng; dữ liệu cỡ company thật (165 yêu cầu) dùng cùng số query như 10 yêu cầu (≤ 3) và in số đo.
- `server/src/__tests__/crew-roadmap-viewer-scope.test.ts`: server ghi đè `params.viewer` (viewer client tự gửi bị bỏ),
  owner thấy hết, actor khác hoặc lỗi đọc quyền thì rỗng, key khác giữ nguyên, middleware gắn trong router Crew;
  `crew-plugin-data-viewer.test.ts` (flow `crew-plugin`) ghim `crew.roadmap` trong danh sách key viewer đọc được.
- `packages/crew-plugin/src/__tests__/map-runs.test.ts`: model và tiền của run, thứ tự ưu tiên nguồn, `null` khi không có.
- `packages/crew-plugin/src/ui/map/component.test.ts`, `project.test.ts`: thẻ việc trong UI stock, chiếu cạnh không bịa
  quan hệ.
- `packages/crew-web/test/ds/crew/crew-map-level.test.ts`, `crew-map.test.tsx`, `crew-summary.test.tsx`: tầng từ bản đồ
  Crew, việc treo dưới gốc, bấm mở issue, dòng tóm tắt.
- `packages/crew-web/test/ds/crew/roadmap-canvas.test.tsx`, `roadmap-edges.test.tsx`, `roadmap-layout.test.ts`,
  `roadmap-runs.test.tsx`: nút có nhãn đọc màn hình, dây đang chạy và giảm chuyển động, bố cục, định dạng dòng run.
- `packages/crew-web/test/features/roadmap/roadmap-page.test.tsx`, `roadmap-model.test.ts`, `roadmap-url.test.ts`:
  điều hướng tầng và quyền xem, trần nút, URL; mọi tầng chỉ một lần gọi `crew.roadmap`, không gọi danh sách issue;
  `issuesFromRoadmap` lấy cạnh chặn từ worker.

# Bản đồ yêu cầu và Roadmap

> Flow `roadmap-map`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow roadmap-map` in ra đúng danh sách đó.

## Mục đích

Một yêu cầu Crew là một issue gốc (có policy Crew) với cây việc con, cạnh phụ thuộc và vòng sửa. Flow này cho người xem
thấy cả cây đó: plugin dựng bản đồ từ bảng issue, crew-web vẽ bản đồ ở trang chi tiết issue và ở trang Roadmap. Trang
Roadmap chỉ còn một trang: một bản đồ chứa công ty → project → yêu cầu → cây việc con (kèm đảo Docs của project); bấm
một mục thì camera zoom/pan tới mục đó, không đổi trang hay đổi tầng. Thẻ việc có vài run mới nhất và tổng tiền.

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
- Roadmap một trang dùng chung thẻ, đường nối và chuyển động với `CrewMap`: mỗi yêu cầu là một "đảo" dựng bằng
  `crewMapLevel` và xếp bằng `topDownTree` như bản đồ ở trang issue; nút và dây vẽ bằng `FlowNode`/`FlowEdge`/`edgePath`
  trong `roadmap-flow-parts.tsx`, phần vẽ dùng chung cho hai canvas: canvas của `CrewMap` (`RoadmapCanvas` nạp lười
  `roadmap-flow.tsx`) và bản đồ một trang (`roadmap-world-flow.tsx`); không có bộ vẽ thứ hai.
- Mức chi tiết theo độ phóng (`worldLod`, ngưỡng 16% và 55%, trễ ±2%): ô màu (mỗi việc một hình chữ nhật, gộp một
  `<path>` mỗi màu trạng thái), nhãn nổi của đảo (tối đa 80, trong khung), thẻ đầy đủ (tối đa 120 thẻ DOM trong khung +
  nửa khung đệm, xyflow chỉ vẽ nút trong khung; phần còn lại vẫn là ô màu). Lớp chạy trên dây tối đa 30 dây trong khung.
  Nút tròn công ty/project giữ cỡ tối thiểu trên màn hình, có trần theo khoảng cách giữa các cụm để không chồng nhau.
- Bố cục tính một lần cho mỗi lần dữ liệu đổi và nhớ theo đảo (`IslandCache`, khóa là chữ ký id-cha-kích thước): dữ liệu
  live đổi một đảo thì chỉ tính lại đảo đó; cụm và kệ đảo canh trái nên đảo đứng trước không dời chỗ. Camera chỉ bay khi
  chỗ lấy nét đổi, không theo dữ liệu.
- Chỗ lấy nét nằm trên URL (`?focus=<mã>`, `project:<id>`, `docs:<project>`, `dir:<project>:<thư mục>`; không có là toàn
  cảnh). Mỗi lần lấy nét đẩy một mục lịch sử nên Back trình duyệt bay về chỗ trước. Link cũ `?project=`/`&request=`/
  `&docs=1`/`&folder=` tự đổi sang `?focus=` (thay URL, không thêm mục lịch sử). `?view=list`, `?issue=`, `?doc=` giữ
  nguyên nghĩa.
- Dạng danh sách (`?view=list`) có đủ mọi mục lồng nhau (không trần), tô mục đang xem; là bản thay thế cho trình đọc màn
  hình. Giảm chuyển động (prefers-reduced-motion): camera nhảy thẳng, không lớp chạy trên dây.

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
   gốc thấy được, mỗi bước lọc project nên nhánh không được cấp bị cắt cả cây, JOIN `agents` lấy tên người làm; sắp
   theo cây (yêu cầu mới trước) rồi theo tầng, nên khi vượt trần các yêu cầu cũ nhất vắng hẳn, nhiều nhất một cây bị
   cắt dở (giữ gốc và tầng trên), không việc nào mất gốc hay mất cha; Q2
   quan hệ `blocks` trong tập; Q3 chỉ khi có việc `crew-fix`: comment `crew-commit` của việc anh em. Không trả
   `description`. `viewer` thiếu hoặc sai (`parseRoadmapViewer`) thì trả rỗng. Đo 2026-11-04 trên dữ liệu cỡ company
   thật (165 yêu cầu, 698 issue, cùng số với comment test `roadmap.data.test.ts`): 3 query, ~13 ms ở Postgres, 426 KB JSON, 15 KB gzip; cách cũ cần danh sách cả company
   2 MB (3,5 – 6,5 s) cộng một lần gọi cây cho mỗi yêu cầu (101 lần, ~2 s mỗi lần).
4. `server/src/crew/plugin-data-scope.ts` → `crewRoadmapViewerScope` (gắn trong `crewContributionRoutes`, trước route
   plugin stock, không thêm vá lõi, gắn trên `CREW_ROADMAP_SCOPE_PATHS`): với `POST /plugins/:pluginId/data/:key` có
   `req.params.key` ĐÃ DECODE là `crew.roadmap` (mọi cách viết: `crew.roadmap`, `crew%2Eroadmap`, `crew%2eroadmap`…)
   và `bridge/data` có `key: "crew.roadmap"`, tính `visibleProjectsFor` của người gọi và ghi đè `params.viewer` (owner
   `{ all: true }`, người khác `{ all: false, projectIds }`); actor không phải phiên trình duyệt, company không thuộc
   phiên thì phạm vi rỗng. Không gắn trên literal `data/crew.roadmap`: Express khớp route trên path
   chưa decode nhưng decode `req.params.key`, nên `crew%2Eroadmap` từng lọt qua middleware mà route stock vẫn chuyển
   viewer client gửi cho worker. Lỗi đọc quyền (`visibleProjectsFor` ném) thì middleware log warn kèm `companyId` và
   trả thẳng 503 `{ error, code: "crew_roadmap_scope_unavailable" }` (không qua `errorHandler`, nhánh 5xx của nó báo
   crash mỗi request), route stock không chạy, để trang báo lỗi kèm Thử lại chứ không hiện Roadmap rỗng
   như thể không có yêu cầu; được đọc quyền mà không có project nào vẫn là rỗng 200. Chỉ `crew.roadmap` đọc
   `params.viewer`; key khác đi nguyên. Key nằm trong
   `CREW_VIEWER_DATA_KEYS` để viewer đọc được.
5. `packages/crew-plugin/src/handlers/runs.ts` → `loadMapRuns`, `loadRequestRuns`: run tóm tắt theo issue, cùng nguồn
   với báo cáo chi phí (`heartbeat_runs` + `cost_events`), tối đa `MAP_RUNS_LIMIT` mỗi việc.
6. `packages/crew-plugin/src/ui/map/project.ts` → `projectCrewMap` và `layout.ts` → `layoutHierarchy`: chiếu bản đồ
   thành cạnh và vị trí; crew-web dùng lại qua `packages/crew-plugin/src/shared-web/map.ts`.
7. `packages/crew-web/src/ds/widgets/crew/crew-map-level.ts` → `crewMapLevel`: đổi bản đồ Crew thành một tầng Roadmap
   (cạnh phụ thuộc thành "chặn"); `crew-map.tsx` → `CrewMap` vẽ nó bằng canvas Roadmap. Tham số `rootKind` (`docs` | `plan` | null,
   `SummarySlot` lấy từ nhãn của yêu cầu gốc) đổi nhãn loại của việc `code` thành "Viết tài liệu" hoặc "Lập kế hoạch"; việc `fix` vẫn là "Sửa"; `code-bf` hiện là "Lập trình".
8. `packages/crew-web/src/features/roadmap/use-roadmap.ts` → `useRoadmapData`: một query `crew.roadmap` (khóa
   `queryKeys.crew('crew.roadmap', { companyId })`, nằm dưới tiền tố `crew` nên sự kiện live của issue làm tươi) cho cả
   bản đồ, lọc thêm bằng `useVisibleProjects`. Run (`crew.runs`) tải lười theo yêu cầu gốc của chỗ đang lấy nét. Danh
   sách docs và cây Docs của các project có docs tải song song (chỉ đường và tiêu đề); lần đầu trang chờ chúng xong để
   đảo Docs có đủ kích thước ngay, bố cục không xê dịch. Docs không chặn bản đồ: danh sách docs lỗi hay đang thử lại thì
   dựng không có đảo Docs, cây lỗi hay đang thử lại là `null` (nút Docs mờ); đã hiện bản đồ rồi thì docs về sau được bổ
   sung (cây còn tải là `'loading'`), không quay lại khung đang tải. Hook trả `partial`: các nhánh phụ đang lỗi
   (`crew.docs.projects`, `crew.docs.tree`, `crew.runs` của yêu cầu đang xem), mỗi nhánh có lỗi cuối và hàm tải lại.
   Lỗi giữ qua lần tải lại tới khi tải thành công (`stickyError`): sự kiện live làm tươi mọi khóa `crew`, TanStack xóa
   `error` của query chưa có data khi bắt đầu tải lại, đọc thẳng thì báo lỗi nháy theo từng sự kiện.
9. `packages/crew-web/src/features/roadmap/roadmap-model.ts` → `buildWorldInput`: project (theo tên, bỏ project lưu
   trữ; "Chưa gắn project" cuối, chỉ owner), mỗi project một cụm gồm đảo Docs (thư mục → trang) rồi các đảo yêu cầu theo
   thứ tự tạo; đảo yêu cầu dựng bằng `crewMapLevel` từ phần `crew.roadmap` của yêu cầu đó (thẻ yêu cầu hiện trạng thái QC
   hay "Chờ owner trả lời" qua `statusOf`; `RoadmapPage` dựng `statusOf` bằng `issueDisplayStatus` của flow `issues-web`,
   màu `--roadmap-tone-awaiting_owner`, có trong `TONED` của `roadmap-node.tsx`). `resolveFocus`, `parentFocus`, `focusOfNode`, `worldFocusOf`, `focusTrail`: chỗ lấy nét trên URL →
   mục trên thế giới, mức ngoài (Esc), khung camera, breadcrumb. `worldListItems`: dạng danh sách. Không gọi API, không
   đọc URL.
10. `packages/crew-web/src/features/roadmap/roadmap-page.tsx` → `RoadmapPage`: dựng thế giới (`layoutWorld` với
   `IslandCache` giữ qua các lần render), đổi link cũ, bấm mục để lấy nét (bấm lại mục đang xem, Enter hay nút Mở chi
   tiết mở popup `?issue=`; bấm trang docs mở popup `?doc=`, `RoadmapDocReader`), Esc / nút Ra ngoài ra một mức, nút Toàn
   cảnh / phím 0 về toàn cảnh, breadcrumb bấm được, mục không có hoặc không được xem thì về toàn cảnh kèm thông báo chung.
   Bấm trang docs của project khác project Docs đang lấy nét thì lấy nét Docs của project đó để popup đọc đúng project.
   Lỗi tải lần đầu (quyền xem, project, `crew.roadmap`) thay bản đồ bằng `ErrorState` kèm Thử lại; khi đã có bản đồ, lỗi
   tải lại hay lỗi nhánh phụ (`crew.docs.projects`, `crew.docs.tree`, `crew.runs`) giữ bản đồ và hiện `Alert` cảnh báo
   nhẹ (lỗi đầu) kèm Thử lại; Thử lại tải lại mọi nhánh đang lỗi một lần.
11. `packages/crew-web/src/ds/widgets/roadmap/roadmap-world.ts` → `layoutWorld` (thế giới: đảo, cụm, dây trục, cạnh,
   `orbCap`), `worldLod`, `fitWorldBox`, `worldFocusView` (toàn cảnh; project 22–50%; đảo 60–110%, canh mép trên khi
   không vừa; việc con 105%), `cardsInView`, `platesInView`, `runningInView`, `blockPaths`, `nodeAtPoint`.
   `roadmap-world-canvas.tsx` → `RoadmapWorldCanvas` (vỏ nạp lười), `RoadmapFocusCard`, `RoadmapWorldSkeleton`;
   `roadmap-world-flow.tsx`: xyflow, lớp ô màu/dây trục/nhãn nổi trong `ViewportPortal`, bản đồ thu nhỏ, nhãn "độ phóng ·
   mức". Độ phóng đổi thì chỉ cập nhật biến CSS (`--rm-zoom`) và thuộc tính DOM; React render lại khi đổi mức, khi camera
   dừng, hoặc khi kéo ra khỏi vùng thẻ. Nhãn mức đọc qua ref nên cha render lại không làm đăng ký lại store; cờ đang bay
   có bộ đếm thế hệ (chuyến bị ngắt không hạ cờ của chuyến sau); vòng rAF đưa focus bàn phím tới mục đang xem bị hủy khi
   lấy nét chỗ mới hay unmount, chuyến bay cũ xong muộn (kể cả sau unmount) không đặt lại vòng rAF; nhãn mức đổi (đổi
   ngôn ngữ) thì một effect nhẹ ghi lại chữ trên chip khi camera đứng yên.
12. `packages/crew-web/src/ds/widgets/roadmap/`: canvas `RoadmapCanvas` (bản đồ Crew ở trang issue, phần nặng
   `roadmap-flow.tsx` nạp lười), phần vẽ dùng chung `roadmap-flow-parts.tsx`, bố cục cây (`roadmap-layout.ts`), thẻ nút,
   khối run, chú giải.

Hiệu năng (đo 2026-11-05, Chrome headless trên Mac của owner, khung 1440×900, API giả với dữ liệu cỡ company thật:
5 project, 165 yêu cầu, 792 việc): mở trang tới bản đồ hiện 1,0–1,6 s (vite dev); kéo và cuộn ở cả ba mức 57–60 fps,
p95 khung 16,8 ms, không long task; camera bay giữa các mức 55–59 fps, khung chậm nhất 33–83 ms (lúc thẻ mới gắn vào);
DOM cao nhất ~830 phần tử. Bộ lớn 12 project, 420 yêu cầu, 1844 việc: kéo/cuộn 57–60 fps, camera bay 50–57 fps. Bố cục
165 đảo / 748 nút: 3,5 ms lần đầu, 0,9 ms khi nhớ đảo (`roadmap-world-perf.test.ts`). Trước khi giới hạn thẻ DOM theo
vùng, vào mức thẻ có khung 290–430 ms vì xyflow nhận cả ~800 nút.

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
| `packages/crew-web/src/ds/widgets/roadmap/roadmap-flow.tsx` | xyflow và chuyển động camera của `CrewMap` | |
| `packages/crew-web/src/ds/widgets/roadmap/roadmap-flow-parts.tsx` | Thẻ, dây, đường cong dùng chung hai canvas | `FlowNode`, `FlowEdge`, `edgePath`, `useReducedMotion` |
| `packages/crew-web/src/ds/widgets/roadmap/roadmap-layout.ts` | Bố cục thuần | `rings`, `radialTree`, `topDownTree` |
| `packages/crew-web/src/ds/widgets/roadmap/roadmap-world.ts` | Thế giới Roadmap một trang và camera thuần | `layoutWorld`, `worldLod`, `worldFocusView`, `cardsInView`, `blockPaths` |
| `packages/crew-web/src/ds/widgets/roadmap/roadmap-world-canvas.tsx` | Vỏ nạp lười, thẻ đang xem, khung đang tải | `RoadmapWorldCanvas`, `RoadmapFocusCard`, `RoadmapWorldSkeleton` |
| `packages/crew-web/src/ds/widgets/roadmap/roadmap-world-flow.tsx` | xyflow của bản đồ một trang, mức chi tiết | |
| `packages/crew-web/src/ds/widgets/roadmap/roadmap-types.ts` | Kiểu dữ liệu bản đồ | `RoadmapNode`, `RoadmapRuns` |
| `packages/crew-web/src/ds/widgets/roadmap/` (còn lại) | Thẻ nút, khối run, chú giải, danh sách, popup docs | `RoadmapList`, `RoadmapRunList`, `RoadmapLegend` |
| `packages/crew-web/src/features/roadmap/roadmap-page.tsx` | Trang Roadmap một trang | `RoadmapPage` |
| `packages/crew-web/src/features/roadmap/roadmap-model.ts` | Dữ liệu → thế giới, chỗ lấy nét | `buildWorldInput`, `resolveFocus`, `parentFocus`, `focusTrail` |
| `packages/crew-web/src/features/roadmap/roadmap-url.ts` | Hợp đồng URL | `parseRoadmapParams`, `focusHref`, `legacyHref` |
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
  hoặc sai thì rỗng; vượt trần (trần hạ qua tham số `limit`) cắt theo cây, yêu cầu mới trước (`created_at` tường
  minh, cây cũ nhất vắng hẳn), không việc nào mất gốc hay mất cha, nhiều nhất một cây cắt dở; dữ liệu cỡ company thật (165 yêu cầu) dùng cùng số query như 10 yêu cầu (≤ 3) và in số đo.
- `server/src/__tests__/crew-roadmap-viewer-scope.test.ts`: server ghi đè `params.viewer` (viewer client tự gửi bị bỏ),
  owner thấy hết, actor khác thì rỗng, lỗi đọc quyền thì 503 có mã lỗi trả thẳng (không tới handler lỗi) và route
  stock không chạy (không được cấp gì
  vẫn rỗng 200), key khác giữ nguyên, middleware gắn trong router Crew; qua router Crew thật, mọi cách viết key
  (`crew%2Eroadmap`, `crew%2eroadmap`, `%63rew.roadmap`, `/` cuối) và `bridge/data` gửi `viewer={all:true}` thì worker
  vẫn nhận project được cấp, lỗi đọc quyền thì 503 với mọi cách viết;
  `crew-plugin-data-viewer.test.ts` (flow `crew-plugin`) ghim `crew.roadmap` trong danh sách key viewer đọc được.
- `packages/crew-plugin/src/__tests__/map-runs.test.ts`: model và tiền của run, thứ tự ưu tiên nguồn, `null` khi không có.
- `packages/crew-plugin/src/ui/map/component.test.ts`, `project.test.ts`: thẻ việc trong UI stock, chiếu cạnh không bịa
  quan hệ.
- `packages/crew-web/test/ds/crew/crew-map-level.test.ts`, `crew-map.test.tsx`, `crew-summary.test.tsx`: tầng từ bản đồ
  Crew, việc treo dưới gốc, bấm mở issue, dòng tóm tắt.
- `packages/crew-web/test/ds/crew/roadmap-canvas.test.tsx`, `roadmap-edges.test.tsx`, `roadmap-layout.test.ts`,
  `roadmap-runs.test.tsx`: nút có nhãn đọc màn hình, dây đang chạy và giảm chuyển động, bố cục, định dạng dòng run.
- `packages/crew-web/test/ds/crew/roadmap-world.test.ts`: bố cục thế giới (cụm, đảo y như `topDownTree`, không chồng,
  nhiều kệ, nhớ đảo, trần nút tròn), mức chi tiết có trễ, khung camera từng loại mục, ô màu, bấm ở mức xa, nhãn nổi,
  dây chạy và thẻ DOM trong khung. `roadmap-world-perf.test.ts`: 165 đảo dựng một lần, lần sau dùng lại, in số đo.
- `packages/crew-web/test/features/roadmap/roadmap-page.test.tsx`, `roadmap-model.test.ts`, `roadmap-url.test.ts`:
  toàn cảnh có mọi việc, bấm để zoom không đổi trang, Esc / Ra ngoài / Toàn cảnh, Back lùi vị trí, link cũ, dạng danh
  sách, quyền xem, đảo Docs, giảm chuyển động; một lần gọi `crew.roadmap`, run chỉ cho yêu cầu đang xem; `crew.roadmap`
  500 ra `ErrorState` và Thử lại, vượt trần ra cảnh báo, tải lại / `crew.docs.projects` / `crew.runs` lỗi khi đã có bản
  đồ ra `Alert` nhẹ, docs lỗi hay đang thử lại không chặn bản đồ và docs về sau được bổ sung, cây docs lỗi hẳn ra nút
  Docs mờ kèm `Alert` và Thử lại, báo lỗi cây docs không nháy khi sự kiện live làm tươi khóa `crew`, cây docs và run
  cùng lỗi thì một lần Thử lại tải lại cả hai, đổi ngôn ngữ đổi chip mức, bấm trang Docs của project khác mở đúng project; dựng đảo bằng `crewMapLevel` (gốc do người tạo, "Chưa gắn project", không trần "+N", thứ tự tạo
  ổn định, cạnh trong cùng cây, docs `null`, số đang mở theo trạng thái lõi), phân giải `?focus=`, breadcrumb.
- `packages/crew-web/e2e/specs/s22-roadmap.spec.ts` (Playwright, T1): đi từ toàn cảnh vào project, yêu cầu, việc con
  trên cùng một trang; popup, Esc, Back, link cũ, dạng danh sách, quyền xem.

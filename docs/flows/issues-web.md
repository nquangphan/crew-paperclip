# Issue trên UI Crew: danh sách, chi tiết, tạo yêu cầu, cổng duyệt, ép xong

> Flow `issues-web`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow issues-web` in ra đúng danh sách đó.

## Mục đích

Owner và thành viên làm việc với yêu cầu Crew trên crew-web: xem danh sách (dạng cây hoặc bảng), mở chi tiết (trang đầy
đủ hoặc popup trên trang đang xem), tạo yêu cầu, thêm việc con, bình luận, đính kèm, trả lời câu hỏi của Trợ Lý, duyệt
hoặc yêu cầu sửa ở cổng, và ép đóng (Ép Done) khi cần. Ticket tổng code/bug theo luồng Bug Finding (`code-bf`) có thêm
dải bốn giai đoạn (Gộp code + PR, Review Bug Finding, Owner duyệt, Merge), khối Bug Finding (lượt, tiến độ lane, finding
chia theo cách Trợ Lý xử lý) và nút **Duyệt và merge** thay cho **Duyệt**.

Luật chính:

- Owner chọn máy thực thi khi tạo yêu cầu gốc (S25.1): chọn máy thì web tạo nháp, gọi `PUT …/issues/:id/machine`, upload
  đính kèm rồi mới chuyển `todo`; ghim lỗi thì yêu cầu ở lại nháp và trang báo lỗi. Trang yêu cầu có dòng Máy (S25.2),
  owner đổi được ở yêu cầu gốc khi cây chưa có run.
- Web không tự gắn policy, reviewer hay approver: server gắn theo vai trò project khi tạo. Loại yêu cầu (Code, Bug,
  Nghiên cứu, Viết tài liệu, Lập kế hoạch) chỉ khác ở nhãn `research`/`docs`/`plan`.
- Thao tác cổng chỉ gửi `status` và bình luận theo luật stage của server; body không bao giờ có `executionPolicy`,
  `executionState` hay assignee (đổi các khóa đó là vượt cổng).
- Ép Done không dùng PATCH stock (board gửi `done` có thể thành Duyệt hoặc mở workflow) mà gọi route plugin
  `issues.force-done`: chỉ board, lý do 10–1000 ký tự, issue đã đóng trả 409 `issue_terminal`. Gate vẫn chạy và ghi
  `crew.policy.board_override`; plugin ghi thêm `crew.issue.force_done` có lý do. Web hủy run đang chạy của yêu cầu
  trước, và chỉ hủy việc con owner chọn sau khi yêu cầu đã đóng (tránh đánh thức người giữ yêu cầu sắp bị ép).
- Thêm việc con chỉ mở khi yêu cầu gốc còn ở bước Trợ Lý; web tạo việc con chưa giao ai rồi bình luận lên gốc để đánh
  thức Trợ Lý.
- "Bắt đầu làm" chỉ là một phép chuyển `backlog → todo`; viewer không thấy nút ghi nào.
- Issue chưa đóng có thẻ câu hỏi/xác nhận chờ owner trả lời hiện trạng thái hiển thị "Chờ owner trả lời" thay cho
  trạng thái lõi (thường là Đang làm hay Đang bị chặn); trạng thái thật không đổi (xem mục Chờ owner trả lời).
- Trạng thái xem danh sách (lọc, sắp xếp, nhóm, cột, Danh sách/Bảng) nằm trong URL, không ghi DB. Popup chi tiết mở bằng
  `?issue=<mã>` trên bất kỳ trang nào của company.

## Điểm vào

- crew-web route `issues` và `issues/:ref` (`packages/crew-web/src/features/issues/routes.tsx`); popup `?issue=` qua
  `IssuePopupHost` gắn trong shell.
- Route plugin `POST /issues/:issueId/force-done` (`issues.force-done`, board) → `handleIssuesApi`.
- Route Crew `GET /api/crew/companies/:companyId/awaiting-owner` (`server/src/crew/awaiting-owner.ts`, gắn trong router
  góp ý) → `listAwaitingOwner`.

## Các bước

1. `packages/crew-web/src/features/issues/list/issues-page.tsx` → `IssuesPage`: danh sách cây (`buildIssueTree`), nhóm
   và vạch ngày theo giờ Việt Nam (`list-view.ts`), bộ lọc trong URL (`use-issues.ts`); chế độ Bảng
   (`issues-board.tsx`) kéo thẻ gửi PATCH trạng thái, server từ chối thì thẻ về cột cũ và hiện lỗi nguyên văn.
   Nhãn máy (mockup đã duyệt `docs/design/mockups/tps-750-machine-label`): `useIssuesData` gọi `useIssueMachines`
   (`machines.ts`) MỘT request lô `POST …/issue-machines` cho mọi yêu cầu đã tải (khóa `queryKeys.crew('issue-machines',
   { companyId, issueIds })`; client chia khúc 500 id nên chỉ danh sách trên 500 yêu cầu mới có hơn một request), không
   gọi máy từng yêu cầu. `IssueMachineLabel` (`machine-label.tsx`) dựng widget ds `MachineLabel` theo bốn trạng thái
   (`machineStateOf`): online chấm xanh, offline icon WifiOff, đã gỡ ghép icon Unlink (server không trả tên nên ghi "Đã gỡ
   ghép"), chưa ghim chỉ chữ "Chưa ghim". Tên là hostname bỏ hậu tố miền (`machineShortName`); hai máy trùng tên thì máy
   sau thêm "#2" theo thứ tự `machineId` (`machineDisplayNames`); không bao giờ hiện `machineId`. Cột `machine` (mặc
   định bật, tắt trong menu Cột) có tooltip tên đầy đủ và lý do; dưới `sm` nhãn xuống dòng phụ dưới tiêu đề (`subline`
   của `IssueListRow`) kèm chữ trạng thái, chưa ghim thì không có dòng phụ; thẻ Bảng có dòng máy cuối thẻ
   (`KanbanCardData.machine`), chưa ghim thì không có. Không lọc theo máy: lô đang tải thì ô Máy là skeleton; đổi bộ
   lọc server thì ô Máy giữ nhãn cũ tới khi lô mới về (`keepPreviousData`); route lỗi thì ô ghi "—", dòng lỗi phía trên
   có nút Thử lại, danh sách vẫn hiện. Lọc theo máy: mục "Máy" trong popover Lọc (`?machine=<machineId>` hay
   `?machine=unpinned`, `ListState.machine`), lọc ở máy khách (`matchesMachine`, con theo máy của gốc), mỗi máy kèm số
   yêu cầu (`machineCounts`) sau lọc loại; đổi bộ lọc máy không gọi lại route lô. Vì kết quả lọc phụ thuộc lô máy, khi
   đang lọc theo máy thì cả thân danh sách (hay Bảng) là skeleton lúc lô đang tải hoặc còn là bản của tập yêu cầu trước
   (`isPlaceholderData` sau khi đổi bộ lọc server), không lọc bằng map cũ; lô lỗi thì thân danh sách là `ErrorState`
   ("Không lọc được theo máy…", nút Thử lại gọi lại route lô) thay cho trạng thái rỗng, và dòng lỗi phía trên không lặp
   lại. Tập yêu cầu rỗng thì query lô tắt và không giữ bản cũ (`useIssueMachines`), nên trang báo rỗng chứ không chờ
   mãi. `?machine=` trỏ máy không còn trong lô máy của danh sách (link cũ, máy đã thôi chạy cây nào) vẫn là một ô
   đang tích trong mục Máy với nhãn trung tính "Máy không còn trong danh sách" (số 0, không hiện id), bỏ tích được;
   máy còn trong lô nhưng bộ lọc khác (Loại) loại hết yêu cầu của nó thì ô vẫn ghi tên máy, số 0.
   `?machine=unpinned` khi không còn cây chưa ghim thì ô "Chưa ghim" vẫn hiện với số 0. Máy đã gỡ ghép không có tên
   nên ô lọc thứ hai trở đi ghi "Đã gỡ ghép #2", "#3"… (đánh theo thứ tự `machineId` trên cả lô, không theo bộ lọc
   Loại), mỗi ô một tên truy cập riêng. Bấm lên nhãn máy ở cột Máy mở yêu cầu như phần còn lại của dòng (nhãn nổi trên
   link phủ dòng để nhận hover tooltip nên tự chuyển click xuống link, xem flow `design-system`). Ghim hay đổi máy xong
   (dòng Máy trong popup, tạo yêu cầu có chọn máy) thì `invalidateIssueMachines` làm mọi lô máy đang mở tải lại: route
   ghim không ghi activity nên sự kiện live không làm mới khóa lô, thiếu bước này thì nhãn và lọc `?machine=` của danh
   sách phía dưới popup giữ máy cũ tới khi tải lại trang.
2. `packages/crew-web/src/features/issues/new/new-request-dialog.tsx` → `NewRequestDialog`: chỉ liệt kê project sẵn
   sàng, người nhận cố định là Trợ Lý của project; `use-create-request.ts` → `createRequest` POST issue rồi upload đính
   kèm lần lượt. Owner thấy thêm ô "Máy thực thi" (`machine-field.tsx` → `MachineField`, mặc định "Tự chọn", chỉ liệt kê
   máy online, ghi chú "sẽ dựng lần đầu" / "đang dựng" / "dựng hỏng" theo trạng thái project trên máy); chọn máy thì
   `createRequest` tạo nháp, ghim máy (`api.machinePins.set`), upload, rồi mới chuyển Cần làm. Ghim lỗi thì yêu cầu ở
   lại nháp và `machineError` hiện ở thông báo sau khi tạo. Tạo xong `useCreateRequest` làm lô máy của danh sách tải lại
   (`invalidateIssueMachines`), vì sự kiện tạo issue có thể đã làm danh sách tải lô trước khi ghim xong.
3. `packages/crew-web/src/features/issues/detail/issue-detail.tsx` → `IssueDetail`: dùng chung cho trang và popup; đọc
   dữ liệu qua `use-issue.ts` và gắn các khối: tóm tắt Crew (`SummarySlot`), thao tác cổng (`ActionsSlot`), câu hỏi
   của Trợ Lý (`InteractionsSlot`), thuộc tính và runtime (`PropertiesPanel`, `MachineSlot`, `RuntimeSlot`), bình luận, đính kèm,
   tài liệu, run, lịch sử. Mô tả được tách bằng `splitAssistantSummary` (`split-assistant-summary.ts`): mục `## Tổng kết của
   Trợ Lý` (lần đầu ở đầu dòng, ngoài code fence, tới hết mô tả) không hiện trong `DescriptionEditor` mà thành khối
   `AssistantSummary` (`data-testid="assistant-summary"`, không thu gọn, tiêu đề `###` nhỏ in hoa) ngay sau mô tả; sửa mô tả vẫn sửa nguyên chuỗi.
   Bình luận dài thu gọn bằng `ExpandableContent` (đáy mờ dần, nút "Hiện đủ (còn N dòng)" / "Thu gọn").
   Khối Run (`issue-runs.tsx` → `IssueRuns`) chỉ hiện `RUNS_COLLAPSED` (5) run mới nhất, cộng mọi run đang chạy hay
   xếp hàng; nút "Hiện thêm N run" / "Thu gọn" mở hay gập phần còn lại.
4. `packages/crew-web/src/features/issues/detail/crew/gate-actions.ts` → `gateActionsFor`, `awaitingMyApproval`: tính
   nút Duyệt, Yêu cầu sửa, Hủy theo stage đang chờ; `actions-slot.tsx` gửi PATCH và làm mới mọi dữ liệu bị đổi. Phần gửi (đọc lại issue, chặn khi owner không còn là người duyệt) nằm ở
   `useGateMutation`, dùng chung với thẻ câu hỏi ở bước 4b. Ticket tổng `code-bf` (luồng Bug Finding, `mergesOnApprove`
   nhận policy `root-bf` cùng cách `crewPolicyKind` của plugin): nút và dialog là "Duyệt và merge", mô tả ghi integrator
   merge PR `#<số>` ngay vào nhánh mặc định (dừng và báo lại khi conflict), giữa mô tả và ô lời nhắn có thẻ Bug Finding
   (`BugFindingApproval`: kết quả cuối trên đúng head PR sẽ merge, các lượt trước, chi phí, bảng finding với cách xử lý);
   Yêu cầu sửa ghi lô sửa chạy lại từ bước gộp. Policy `code` và `research` giữ nút "Duyệt". `CommentDialog` nhận
   `children` cho phần thêm này.
4a. `packages/crew-web/src/features/issues/detail/crew/summary-slot.tsx` → `SummarySlot`, khi đang xem chính ticket tổng
   `code-bf` (`map.root.kind`): dưới dòng tóm tắt là dải bốn giai đoạn (`StageStrip` + `stageStripOf` của flow
   `design-system`, dòng phụ từ `withBugFindingDetails`: số PR, lượt n / tối đa 3 và trạng thái, ghi chú bước merge) và
   khối Bug Finding (`bug-finding-panel.tsx` → `BugFindingSection`/`BugFindingPanel`). Dữ liệu từ
   `packages/crew-web/src/api/crew/bug-finding.ts` → `useBugFinding` (`GET /api/plugins/crew.core/api/issues/:id/bug-finding?companyId=`,
   khóa `queryKeys.crew('crew.bugFinding', …)`, đọc lại mỗi `BUG_FINDING_POLL_MS` 30 giây khi còn lượt chờ/chạy). Mỗi
   lượt một thẻ: PR (link tới URL của lượt; `prNumberOf` rút số PR GitHub hoặc `iid` MR GitLab bằng
   `parsePrUrl` của plugin (`@crew/paperclip-plugin/shared/pr-url`, số ở cuối URL, bỏ `?…`/`#…`), nên luôn cùng số với
   payload việc máy; không rút được thì hiện nguyên URL), commit review, lượt n / tối đa; lượt chờ/chạy có thanh tiến độ `lanesDone/lanesTotal`; lượt hỏng
   hiện lý do; lượt `succeeded` chia finding thành Trợ Lý tự sửa (kèm việc con sửa và trạng thái), Cần owner chốt (câu
   hỏi), Trợ Lý bỏ qua (lý do) theo `triage` của route (flow `bug-finding`), finding ngoài kế hoạch vào nhóm "khác",
   chưa có kế hoạch thì bảng phẳng kèm câu "Trợ Lý chưa phân loại". Lượt có hơn `FINDINGS_COLLAPSED` (3) finding thì mặc
   định chỉ hiện 3 finding đầu theo thứ tự nhóm (tự sửa, hỏi, bỏ qua, khác; nhãn bảng và dải số đếm vẫn ghi đủ), nút
   "Xem thêm N finding" / "Thu gọn" (`aria-expanded`, `aria-controls` trỏ vùng finding) mở và đóng lại. Mảnh hiển thị (thanh tiến độ, mức, verdict, mã
   commit) ở `packages/crew-web/src/ds/widgets/crew/bug-finding-parts.tsx`; màn hình chỉ dùng class bố cục.
4b. `packages/crew-web/src/features/issues/detail/crew/interactions-slot.tsx` → `InteractionsSlot`: thẻ
   `ask_user_questions` / xác nhận đang chờ thì hiện thẻ đó (`InteractionCard`). Không có thẻ nào đang chờ thì
   `comment-questions.ts` → `pendingQuestions` tìm điểm cần owner chốt agent viết theo mẫu `Q1.` + `a)`, `b)` (mỗi
   lựa chọn một dòng hoặc gọn trên một dòng, `Đề xuất` thành dòng gợi ý), trong bình luận agent mới nhất hoặc trong mục
   `### Cần owner quyết định` của tổng kết ở mô tả (gắn với bình luận `crew-assistant done`). Bỏ qua khi đã có bình
   luận của người sau đó, hoặc có thẻ tạo từ 10 phút trước đó trở về sau. `CommentQuestionsCard` dựng thẻ chọn:
   đang chờ owner duyệt thì lựa chọn đi kèm Duyệt hoặc Yêu cầu sửa (bình luận thường lúc đó không đánh thức ai); ngoài
   ra gửi một bình luận `- Qn: <lựa chọn>`, và chỉ dựng thẻ khi người hỏi là agent đang giữ issue (bình luận chỉ đánh
   thức agent đó). Nút lựa chọn xuống dòng trong nút, không tràn sang cột bên.
5. `packages/crew-web/src/features/issues/detail/crew/force-done-dialog.tsx` → `ForceDoneAction` và `force-done.ts`:
   hộp Ép Done (lý do, chọn việc con cần hủy), thứ tự hủy run, gọi route, rồi hủy con.
6. `packages/crew-plugin/src/issues/force-done.ts` → `handleIssuesApi`: kiểm board, body, lý do; `ctx.issues.update`
   sang `done`, bình luận lý do, ghi activity, đánh thức cha nếu đây là con cuối; lỗi phụ trả trong `warnings`
   (`ForceDoneWarning`), không làm hỏng lần đóng.
7. `packages/crew-web/src/features/issues/detail/history-format.ts` → gộp bản ghi `crew.policy.board_override`,
   `crew.issue.force_done` và các bản ghi host đi kèm thành một dòng Ép Done trong khối Lịch sử.
8. `packages/crew-web/src/features/issues/new/add-child-dialog.tsx` → `AddChildAction`; `add-child.ts` →
   `addChildAvailability`.
8b. `packages/crew-web/src/features/issues/new/follow-plan-action.tsx` → `FollowPlanAction`: nút "Làm theo kế hoạch này" trên
   yêu cầu gốc nhãn `plan` đã `done` (`follow-plan.ts` → `canFollowPlan`), ẩn với người chỉ đọc (viewer, khách góp ý).
   Bấm mở `NewRequestDialog` với `initial` do `followPlanInitial` dựng: project của yêu cầu kế hoạch, loại Code, tiêu đề
   `Làm theo kế hoạch: <tiêu đề>`, mô tả gồm dòng `crew-from-plan <path>` (path đọc từ dòng `- File kế hoạch: \`<path>\``
   trong mô tả gốc), dòng `Kế hoạch: <mã> · PR: <url>` (PR từ dòng `- Pull request: <url>`) và dòng nhắc merge PR kế hoạch.
   Thiếu path thì bỏ dòng `crew-from-plan`; thiếu PR thì bỏ cả link PR lẫn dòng nhắc merge. Tạo xong hiện thông báo kèm link, và báo tên file đính kèm tải lên hỏng. Chỉ gửi được khi project nằm trong danh sách project sẵn sàng mà người dùng thấy.
9. `packages/crew-web/src/features/issues/popup/issue-nav.tsx` → `IssueLink`, `useIssueOpener`: click thường mở popup,
   Cmd/Ctrl/Shift/chuột giữa mở trang đầy đủ ở tab mới; hợp đồng URL ở `issue-href.ts`.

## Gọi Trợ Lý bằng tag

`packages/crew-web/src/features/issues/detail/composer.tsx` → `StockComposer`: bình luận có `@tro-ly` hay `@Trợ Lý` thì
lúc gửi đọc vai trò project (`queryClient.fetchQuery`, khóa `roles(projectId)`; issue không có project coi như không có
Trợ Lý), `assistant-mention.ts` → `toAssistantMention` đổi tag thành `[@Trợ Lý](agent://<id>)` (không phân biệt hoa
thường, so sau NFC, đứng riêng một từ). Hàm che trước code block có rào và thụt lề (≥ 4 dấu cách hay tab, mở sau dòng
trống, không nằm trong list), inline code, link đã có, thẻ và comment HTML bằng ký tự giữ chỗ cùng độ dài, rồi xét ranh
giới từ trên cả chuỗi: tag dính ngay sau inline code hay thẻ HTML (`` `x`@tro-ly ``, `<b>@tro-ly</b>`) không khớp. Gửi
bình luận xong thì gọi `api.assistantCall.call` (`POST /api/crew/companies/:companyId/issues/:issueId/assistant-call`
`{ commentId }`, route của flow `run-handoff`). Gọi lỗi (403/409/422/mạng; Trợ Lý pause hay hết ngân sách thì server trả
`409 crew_assistant_call_skipped` với câu nêu lý do) hoặc project không có Trợ Lý thì chỉ hiện
thông báo nhẹ dưới ô ("Đã gửi bình luận nhưng chưa gọi được Trợ Lý: …", "Project này chưa có Trợ Lý"); bình luận vẫn
gửi, thông báo mất ở lần gửi sau. Bình luận không có tag không đọc vai trò.

## Chờ owner trả lời

Danh sách lõi (`GET /api/companies/:c/issues`) chỉ báo thẻ chờ trả lời trong `reviewAttention` cho issue `in_review`,
nên issue `in_progress` hay `blocked` (recovery của Paperclip đặt `blocked` khi stage review chờ) có thẻ chờ owner vẫn
hiện Đang làm hay Đang bị chặn và không vào "Chờ tôi duyệt". Không đổi trạng thái thật để sửa: `in_review`/`blocked`
kích hoạt stage và người duyệt của execution policy. Thay vào đó:

1. `server/src/crew/awaiting-owner.ts` → `listAwaitingOwner`: issue chưa đóng (không `done`/`cancelled`, không ẩn) có thẻ
   `ask_user_questions`, `request_confirmation` hay `request_checkbox_confirmation` (`AWAITING_OWNER_KINDS`, đúng các
   thẻ `InteractionCard` vẽ) đang `pending` và không gửi cho agent (`addressee_agent_id IS NULL`). Mỗi issue một dòng
   `{ issueId, interactionId, kind, createdAt }` là thẻ chờ lâu nhất, chờ lâu nhất trước. Luật người gọi như route
   `…/qc`: actor board bằng phiên trình duyệt, mọi thành viên người của company (role đọc từ DB, không có membership thì
   403), lọc theo quyền xem project (`visibleProjectsFor`: owner thấy mọi issue kể cả không thuộc project). Chỉ đọc.
2. `packages/crew-web/src/features/awaiting-owner/use-awaiting-owner.ts` → `useAwaitingOwner`: gọi route (client
   `api.awaitingOwner.list`) với khóa `queryKeys.crew('awaiting-owner', { companyId })`, đọc lại mỗi 30 giây. Khóa nằm
   dưới tiền tố `queryKeys.crew()` nên trả lời/chấp nhận/từ chối thẻ ở chi tiết (`useRefreshAfterGate` của
   `InteractionCard`) và sự kiện live của issue làm mới ngay. Route lỗi (server chưa nâng cấp) thì coi như rỗng.
3. `awaiting-owner.ts` → `awaitingOwnerStatus` (chỉ issue chưa đóng), `issueDisplayStatus` (chờ owner, rồi trạng thái
   QC của flow `qc-department`, rồi trạng thái lõi; QC chỉ áp cho `done` nên hai thứ không chồng nhau). Dùng ở dòng danh
   sách (biểu tượng, nhãn trạng thái, kèm nhãn `AwaitingOwnerBadge`), thẻ Bảng (nhãn; thẻ vẫn ở cột trạng thái lõi như
   nhãn QC vì kéo thẻ là đổi trạng thái lõi), đầu trang và cột Thuộc tính của chi tiết (`PropertiesPanel` nhận
   `shownStatus`), bản đồ Roadmap (flow `roadmap-map`). Hộp thư và thẻ "chờ bạn duyệt" của Tổng quan dùng cùng tập id
   (flow `web-pages`). Nhãn `status.awaiting_owner` ("Chờ owner trả lời"), biểu tượng và màu ở flow `design-system`.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `packages/crew-plugin/src/issues/force-done.ts` | Route Ép Done | `handleIssuesApi`, `ForceDoneWarning` |
| `packages/crew-web/src/api/crew/force-done.ts` | Client `crew.forceDone` | `forceDoneApi` |
| `packages/crew-web/src/api/crew/assistant-call.ts` | Client gọi Trợ Lý bằng tag | `assistantCallApi`, `AssistantCallResult` |
| `server/src/crew/awaiting-owner.ts` | Route đọc issue chờ owner trả lời thẻ | `crewAwaitingOwnerRoutes`, `listAwaitingOwner`, `AWAITING_OWNER_KINDS` |
| `packages/crew-web/src/api/crew/awaiting-owner.ts` | Client route chờ owner | `awaitingOwnerApi` |
| `packages/crew-web/src/features/awaiting-owner/` | Trạng thái hiển thị "Chờ owner trả lời", hook, nhãn | `useAwaitingOwner`, `awaitingOwnerKey`, `awaitingOwnerStatus`, `issueDisplayStatus`, `AwaitingOwnerBadge`, `AWAITING_OWNER` |
| `packages/crew-web/src/features/issues/detail/assistant-mention.ts` | Đổi tag `@tro-ly` thành link tới Trợ Lý (hàm thuần) | `toAssistantMention`, `ASSISTANT_MENTION_LABEL` |
| `packages/crew-web/src/features/issues/routes.tsx`, `index.ts` | Route `issues`, `issues/:ref` | `routes` |
| `packages/crew-web/src/features/issues/list/issues-page.tsx` | Trang danh sách | `IssuesPage` |
| `packages/crew-web/src/features/issues/list/issues-board.tsx` | Chế độ Bảng | `boardLayout` |
| `packages/crew-web/src/features/issues/list/use-issues.ts` | Dữ liệu và trạng thái URL | `COLUMN_IDS`, `KIND_FILTERS`, `VIEW_MODES` |
| `packages/crew-web/src/features/issues/list/list-view.ts`, `tree.ts` | Nhóm, vạch ngày, cây | `groupIssues`, `dateGroup`, `buildIssueTree` |
| `packages/crew-web/src/features/issues/new/machine-field.tsx` | Ô "Máy thực thi" của form tạo yêu cầu (owner) | `MachineField`, `machineOptionLabel`, `formatMachineNumber`, `AUTO_MACHINE` |
| `packages/crew-web/src/features/issues/new/` | Tạo yêu cầu, loại, thêm việc con, làm theo kế hoạch | `NewRequestDialog` (nhận `initial`), `createRequest`, `REQUEST_KINDS`, `AddChildAction`, `FollowPlanAction`, `parsePlanSource` |
| `packages/crew-web/src/features/issues/detail/issue-detail.tsx` | Khung chi tiết | `IssueDetail` |
| `packages/crew-web/src/features/issues/detail/issue-page.tsx` | Trang đầy đủ | `IssuePage` |
| `packages/crew-web/src/features/issues/detail/use-issue.ts` | Dữ liệu chi tiết | `useIssue`, `useChildIssues`, `useIssueActivity` |
| `packages/crew-web/src/features/issues/detail/crew/gate-actions.ts` | Luật nút cổng, nhận ticket tổng duyệt là merge | `gateActionsFor`, `awaitingMyApproval`, `mergesOnApprove`, `MIN_CHANGE_REASON` |
| `packages/crew-web/src/features/issues/detail/crew/actions-slot.tsx`, `gate-dialogs.tsx` | Nút và hộp cổng (Duyệt / Duyệt và merge) | `ActionsSlot`, `CommentDialog` |
| `packages/crew-web/src/features/issues/detail/crew/bug-finding-panel.tsx` | Khối Bug Finding và thẻ trong màn duyệt | `BugFindingSection`, `BugFindingPanel`, `BugFindingApproval`, `BugFindingApprovalCard`, `withBugFindingDetails`, `prNumberOf`, `FINDINGS_COLLAPSED` |
| `packages/crew-web/src/api/crew/bug-finding.ts` | Client và hook route GET Bug Finding | `bugFindingApi`, `useBugFinding`, `hasOpenRun`, `BUG_FINDING_POLL_MS` |
| `packages/crew-web/src/ds/widgets/crew/bug-finding-parts.tsx` | Thanh tiến độ lane, nhãn mức, verdict, trạng thái finding, mã commit | `LaneProgress`, `SeverityBadge`, `VerdictBadge`, `FindingStatusBadge`, `MonoText`, `FindingMeta` |
| `packages/crew-web/src/features/issues/detail/crew/force-done.ts`, `force-done-dialog.tsx` | Ép Done phía web | `ForceDoneAction`, `MIN_FORCE_REASON` |
| `packages/crew-web/src/features/issues/detail/crew/interaction-card.tsx`, `interactions-slot.tsx` | Câu hỏi và xác nhận của Trợ Lý, thẻ chọn dựng từ bình luận/tổng kết | `InteractionCard`, `CommentQuestionsCard`, `InteractionsSlot` |
| `packages/crew-web/src/features/issues/detail/crew/comment-questions.ts` | Đọc điểm `Q1.` + `a)`/`b)` agent viết, chọn điểm chưa ai trả lời, soạn lời trả lời | `parseCommentQuestions`, `summaryQuestions`, `pendingQuestions`, `commentAnswerBody` |
| `packages/crew-web/src/features/issues/detail/crew/summary-slot.tsx` | Tóm tắt Crew, bản đồ, kiểm docs; dải giai đoạn và khối Bug Finding của ticket tổng `code-bf` | `SummarySlot` |
| `packages/crew-web/src/features/issues/detail/crew/machine-slot.tsx` | Dòng "Máy" ở cột Thuộc tính: máy của cả cây, cách chọn; owner đổi ở yêu cầu gốc khi cây chưa có run (đổi xong làm lô máy của danh sách tải lại), ẩn dòng khi không đọc được | `MachineSlot`, `machineLine` |
| `packages/crew-web/src/features/issues/detail/crew/runtime-slot.tsx` | Quyết định chọn runtime | `RuntimeSlot` |
| `packages/crew-web/src/features/issues/detail/history-format.ts`, `history.tsx` | Khối Lịch sử | `History`, `FORCE_DONE_ACTION`, `BOARD_OVERRIDE_ACTION` |
| `packages/crew-web/src/features/issues/detail/` (còn lại) | Bình luận, ô soạn, đính kèm, tài liệu, run, thuộc tính, sửa tiêu đề, Bắt đầu làm | `Comments`, `Composer`, `Attachments`, `IssueRuns`, `PropertiesPanel`, `TitleEditor`, `AssistantSummary`, `splitAssistantSummary` |
| `packages/crew-web/src/features/issues/popup/` | Popup chi tiết và link | `IssuePopupHost`, `IssueLink`, `issueHref` |

### Đã biết, chưa làm

- Mockup `docs/design/mockups/tps-750-machine-label` không vẽ bốn trạng thái lọc theo máy đã có trong build (skeleton
  cả thân danh sách, `ErrorState` "Không lọc được theo máy…", ô "Máy không còn trong danh sách", tên trùng "#2"). Các
  trạng thái này không cần hình: chuỗi lấy từ `machine.*` trong locale, hành vi mô tả ở bước 1 và có test.
- Hộp thư chỉ xét 200 issue mới cập nhật nhất (`INBOX_LIMIT`, có từ trước), nên issue chờ owner trả lời đã lâu không
  được cập nhật có thể không vào "Chờ tôi duyệt" dù danh sách Yêu cầu vẫn hiện "Chờ owner trả lời". Chưa đổi vì trần
  chung của Hộp thư là quyết định sản phẩm riêng.
- Lọc và đếm theo máy chạy ở máy khách trên danh sách đã tải, mà danh sách có trần 1000 yêu cầu (`serverFilters`,
  `limit: 1000`) từ trước nhãn máy; lọc Loại cũng chịu trần này. Company quá 1000 yêu cầu (sau bộ lọc server) thì kết
  quả lọc máy và số đếm có thể thiếu, không báo. Chưa làm vì cần chốt sản phẩm: báo giới hạn hay đưa lọc lên server.
- Mỗi ô cột Máy dựng `TooltipProvider` và `Tooltip` riêng trên danh sách không ảo hóa (tới 1000 dòng). Chưa đo thấy
  chậm bằng profiler với dữ liệu thật nên chưa đổi; đo được chậm thì bỏ provider cục bộ và chỉ gắn tooltip khi hover.

## Dữ liệu

- Route lõi Paperclip: issue (danh sách, chi tiết, PATCH, tiêu đề), bình luận, đính kèm, tài liệu, activity, run,
  interaction (`respond`), nhãn.
- Route Crew của server: `GET /machines?projectId=`, `GET|PUT /issues/:id/machine`, `POST /issue-machines` (lô máy
  của danh sách và Bảng; xem flow `multi-machine`); `GET /awaiting-owner` (issue chờ owner trả lời, đọc bảng lõi
  `issue_thread_interactions` và `issues`).
- Route plugin: `issues.force-done`, `bug-finding.get` (`crew.bugFinding`); data key `crew.map`, `crew.docsCheck`,
  `crew.runtimeDecisions`.
- Activity: `crew.policy.board_override` (gate server), `crew.issue.force_done` (plugin).
- Bảng: plugin không ghi bảng riêng ở flow này; Ép Done đi qua `ctx.issues.update` của host.

## Flow liên quan

- `issue-gate`: luật stage và `board_override` mà thao tác cổng và Ép Done tuân theo.
- `roadmap-map`: bản đồ và dòng tóm tắt trong `SummarySlot`.
- `docs-snapshot`: panel kiểm docs.
- `runtime-fallback`: quyết định runtime hiện trong `RuntimeSlot`.
- `attachments`: xem và chọn file đính kèm.
- `contributions`: nhóm Chờ duyệt và bình luận chờ duyệt trong danh sách và luồng bình luận; router góp ý gắn route
  `…/awaiting-owner`.
- `qc-department`: nhãn QC trên thẻ của chế độ Bảng; `issueDisplayStatus` gộp trạng thái QC với "Chờ owner trả lời".
- `web-pages`: Hộp thư và Tổng quan dùng tập issue chờ owner trả lời.
- `multi-machine`: route ghim máy mà ô Máy thực thi và dòng Máy gọi, route lô `issue-machines` của nhãn máy trên danh
  sách và Bảng.
- `web-shell`: shell gắn popup, quyền ghi hay chỉ đọc.
- `bug-finding`: route GET lượt Bug Finding và kế hoạch của Trợ Lý mà khối Bug Finding và màn duyệt đọc.
- `design-system`: `StageStrip`, nhãn giai đoạn `code-bf`.

## Tests

- `server/src/__tests__/crew-awaiting-owner.db.test.ts`: issue Đang làm và Bị chặn có thẻ chờ người trả lời, mỗi issue
  một dòng là thẻ cũ nhất, chờ lâu nhất trước; bỏ thẻ gửi agent, thẻ đã trả lời, loại thẻ khác, issue đã đóng; thành
  viên chỉ thấy project được cấp; trả lời xong thì ra khỏi danh sách; người ngoài, agent, board API key bị 403.
- `packages/crew-web/test/features/awaiting-owner/awaiting-owner.test.ts`: luật trạng thái hiển thị (chỉ issue chưa
  đóng, QC giữ ưu tiên ở issue đã Xong); `awaiting-owner-pages.test.tsx`: dòng danh sách (biểu tượng, nhãn), thẻ Bảng ở
  nguyên cột lõi, chi tiết hiện chờ owner và trả lời thẻ xong thì đọc lại route và về Đang làm.
- E2E T1 `packages/crew-web/e2e/specs/s27-awaiting-owner.spec.ts`: issue Đang làm có thẻ chờ owner hiện "Chờ owner trả
  lời" trên danh sách, issue cùng trạng thái không có thẻ giữ Đang làm, trả lời thẻ xong thì hết.

- `packages/crew-web/test/features/issues/assistant-mention.test.ts`: bảng ca khớp và không khớp (hoa thường, dấu câu,
  `email@tro-ly.vn`, code block có rào và thụt lề, inline code, tag dính sau inline code hay thẻ HTML, thuộc tính và
  comment HTML, link có sẵn, NFD; dòng thụt lề trong list hay nối đoạn văn vẫn đổi), không có Trợ Lý thì `missing`.
- `packages/crew-web/test/features/issues/composer.test.tsx` (phần tag): đổi tag và gọi `assistant-call` với id bình
  luận; không tag thì không đọc vai trò; không có Trợ Lý hay issue không project thì báo nhẹ; gọi lỗi 403 vẫn gửi bình
  luận và thông báo mất ở lần gửi sau; `409 crew_assistant_call_skipped` hiện câu lý do của server.

- `packages/crew-plugin/src/__tests__/force-done.test.ts`: route chỉ cho board, chặn trước khi ghi, đóng issue kèm lý
  do và cảnh báo phụ.
- `packages/crew-web/test/features/issues/issues-page.test.tsx`, `issues-board.test.tsx`, `list-view.test.ts`,
  `tree.test.ts`, `issues-page-pending.test.tsx`: cây và thu gọn, chế độ Bảng, nhóm và vạch ngày, nhóm Chờ duyệt.
- `packages/crew-web/test/features/issues/issues-machines.test.tsx`: nhãn máy của gốc ghim, con kế thừa, offline, đã gỡ
  ghép, chưa ghim, không lộ `machineId`; dòng phụ màn hẹp; đúng một request lô cho cả danh sách; lỗi tải có Thử lại; lọc
  `?machine=` (máy, `unpinned`, popover có số đếm, Xóa) và thẻ Bảng; máy còn trong lô nhưng bị lọc Loại loại hết vẫn
  ghi tên số 0; nhiều máy đã gỡ ghép có tên ô riêng ("Đã gỡ ghép #2"); luật tên gọn, trùng tên "#2", URL state.
- `packages/crew-web/test/features/issues/new-request-dialog.test.tsx`, `use-create-request.test.ts`, `kinds.test.ts`,
  `kind-labels.test.tsx`, `add-child.test.ts`, `add-child-dialog.test.tsx`: tạo yêu cầu, nhãn loại, thêm việc con.
- `packages/crew-web/test/features/issues/machine-slot.test.tsx`: dòng Máy (S25.2) và ca ô Máy thực thi của `new-request-dialog.test.tsx` (S25.1); đổi máy xong lô máy của danh sách đang mở tải lại và đổi nhãn.
- `packages/crew-web/test/features/issues/follow-plan.test.ts`, `follow-plan-action.test.tsx`: đọc path/PR từ tổng kết,
  mô tả điền sẵn, nút chỉ ở gốc `plan` đã xong và người ghi được; `new-request-dialog.test.tsx` có ca `initial`.
- `packages/crew-web/test/features/issues/gate-actions.test.ts`, `gate-actions.test.tsx`: nút cổng chỉ cho người tham gia
  stage đang chờ, body gửi đi; chỉ policy `root-bf` duyệt là merge; ticket tổng `code-bf` có nút "Duyệt và merge", mô tả
  merge PR ngay và thẻ Bug Finding trong dialog.
- `packages/crew-web/test/features/issues/bug-finding-panel.test.tsx`: lượt chạy có thanh tiến độ lane và số lô sửa;
  lượt xong chia ba nhóm theo kế hoạch (việc con sửa, câu hỏi, lý do bỏ qua); chưa có kế hoạch thì bảng phẳng; lượt
  hết giờ hiện lý do; mặc định chỉ 3 finding đầu, "Xem thêm" mở hết và "Thu gọn" đóng lại (cả bảng phẳng), lượt từ 3
  finding trở xuống không có nút; thẻ màn duyệt hiện kết quả cuối trên đúng commit sẽ merge và cách xử lý; `BugFindingSection` gọi
  route kèm `companyId`; `prNumberOf` rút số PR GitHub và số MR GitLab, URL khác trả null; với mọi URL `parsePrUrl`
  nhận, `prNumberOf` trả đúng số đó (`…/x/pull/3/-/merge_requests/5` là 5), số quá 10 chữ số trả null.
- `packages/crew-web/test/features/issues/summary-slot.test.tsx` (phần `code-bf`): dải bốn giai đoạn có dòng phụ và
  khối Bug Finding khi xem ticket tổng; việc con không hiện, không gọi route.
- `packages/crew-web/test/features/issues/comment-questions.test.ts`, `interaction-card.test.tsx`: đọc câu hỏi theo các
  kiểu agent viết, bỏ bình luận nhắc lại lựa chọn đã chốt, thẻ dựng từ bình luận/tổng kết gửi bình luận hoặc Duyệt /
  Yêu cầu sửa kèm lựa chọn.
- `packages/crew-web/test/features/issues/force-done.test.ts`, `force-done-dialog.test.tsx`, `history.test.tsx`,
  `history-format.test.ts`: Ép Done và dòng lịch sử gộp.
- `packages/crew-web/test/features/issues/` (còn lại): bình luận, ô soạn, đính kèm, câu hỏi Trợ Lý, thuộc tính, runtime,
  run, sửa tiêu đề, Bắt đầu làm, popup và URL, issue thuộc company khác prefix.

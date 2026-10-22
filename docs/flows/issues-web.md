# Issue trên UI Crew: danh sách, chi tiết, tạo yêu cầu, cổng duyệt, ép xong

> Flow `issues-web`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow issues-web` in ra đúng danh sách đó.

## Mục đích

Owner và thành viên làm việc với yêu cầu Crew trên crew-web: xem danh sách (dạng cây hoặc bảng), mở chi tiết (trang đầy
đủ hoặc popup trên trang đang xem), tạo yêu cầu, thêm việc con, bình luận, đính kèm, trả lời câu hỏi của Trợ Lý, duyệt
hoặc yêu cầu sửa ở cổng, và ép đóng (Ép Done) khi cần.

Luật chính:

- Web không tự gắn policy, reviewer hay approver: server gắn theo vai trò project khi tạo. Loại yêu cầu (Code, Bug,
  Nghiên cứu, Viết tài liệu) chỉ khác ở nhãn `research`/`docs`.
- Thao tác cổng chỉ gửi `status` và bình luận theo luật stage của server; body không bao giờ có `executionPolicy`,
  `executionState` hay assignee (đổi các khóa đó là vượt cổng).
- Ép Done không dùng PATCH stock (board gửi `done` có thể thành Duyệt hoặc mở workflow) mà gọi route plugin
  `issues.force-done`: chỉ board, lý do 10–1000 ký tự, issue đã đóng trả 409 `issue_terminal`. Gate vẫn chạy và ghi
  `crew.policy.board_override`; plugin ghi thêm `crew.issue.force_done` có lý do. Web hủy run đang chạy của yêu cầu
  trước, và chỉ hủy việc con owner chọn sau khi yêu cầu đã đóng (tránh đánh thức người giữ yêu cầu sắp bị ép).
- Thêm việc con chỉ mở khi yêu cầu gốc còn ở bước Trợ Lý; web tạo việc con chưa giao ai rồi bình luận lên gốc để đánh
  thức Trợ Lý.
- "Bắt đầu làm" chỉ là một phép chuyển `backlog → todo`; viewer không thấy nút ghi nào.
- Trạng thái xem danh sách (lọc, sắp xếp, nhóm, cột, Danh sách/Bảng) nằm trong URL, không ghi DB. Popup chi tiết mở bằng
  `?issue=<mã>` trên bất kỳ trang nào của company.

## Điểm vào

- crew-web route `issues` và `issues/:ref` (`packages/crew-web/src/features/issues/routes.tsx`); popup `?issue=` qua
  `IssuePopupHost` gắn trong shell.
- Route plugin `POST /issues/:issueId/force-done` (`issues.force-done`, board) → `handleIssuesApi`.

## Các bước

1. `packages/crew-web/src/features/issues/list/issues-page.tsx` → `IssuesPage`: danh sách cây (`buildIssueTree`), nhóm
   và vạch ngày theo giờ Việt Nam (`list-view.ts`), bộ lọc trong URL (`use-issues.ts`); chế độ Bảng
   (`issues-board.tsx`) kéo thẻ gửi PATCH trạng thái, server từ chối thì thẻ về cột cũ và hiện lỗi nguyên văn.
2. `packages/crew-web/src/features/issues/new/new-request-dialog.tsx` → `NewRequestDialog`: chỉ liệt kê project sẵn
   sàng, người nhận cố định là Trợ Lý của project; `use-create-request.ts` → `createRequest` POST issue rồi upload đính
   kèm lần lượt. Có chip "Jev gợi ý: <loại>" dưới ô Loại (flow `jev`): bấm mới chọn, lỗi thì không hiện gì.
3. `packages/crew-web/src/features/issues/detail/issue-detail.tsx` → `IssueDetail`: dùng chung cho trang và popup; đọc
   dữ liệu qua `use-issue.ts` và gắn các khối: tóm tắt Crew (`SummarySlot`), thao tác cổng (`ActionsSlot`), câu hỏi
   của Trợ Lý (`InteractionsSlot`), thuộc tính và runtime (`PropertiesPanel`, `RuntimeSlot`), bình luận, đính kèm,
   tài liệu, run, lịch sử.
4. `packages/crew-web/src/features/issues/detail/crew/gate-actions.ts` → `gateActionsFor`, `awaitingMyApproval`: tính
   nút Duyệt, Yêu cầu sửa, Hủy theo stage đang chờ; `actions-slot.tsx` gửi PATCH và làm mới mọi dữ liệu bị đổi. Trước khi gửi
   Duyệt / Yêu cầu sửa kèm lời nhắn, Jev đọc lời nhắn với hạn cứng 1500 ms và chỉ hỏi lại một lần khi lệch ý (flow
   `jev`); lỗi hay quá hạn thì gửi như cũ.
5. `packages/crew-web/src/features/issues/detail/crew/force-done-dialog.tsx` → `ForceDoneAction` và `force-done.ts`:
   hộp Ép Done (lý do, chọn việc con cần hủy), thứ tự hủy run, gọi route, rồi hủy con.
6. `packages/crew-plugin/src/issues/force-done.ts` → `handleIssuesApi`: kiểm board, body, lý do; `ctx.issues.update`
   sang `done`, bình luận lý do, ghi activity, đánh thức cha nếu đây là con cuối; lỗi phụ trả trong `warnings`
   (`ForceDoneWarning`), không làm hỏng lần đóng.
7. `packages/crew-web/src/features/issues/detail/history-format.ts` → gộp bản ghi `crew.policy.board_override`,
   `crew.issue.force_done` và các bản ghi host đi kèm thành một dòng Ép Done trong khối Lịch sử.
8. `packages/crew-web/src/features/issues/new/add-child-dialog.tsx` → `AddChildAction`; `add-child.ts` →
   `addChildAvailability`.
9. `packages/crew-web/src/features/issues/popup/issue-nav.tsx` → `IssueLink`, `useIssueOpener`: click thường mở popup,
   Cmd/Ctrl/Shift/chuột giữa mở trang đầy đủ ở tab mới; hợp đồng URL ở `issue-href.ts`.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `packages/crew-plugin/src/issues/force-done.ts` | Route Ép Done | `handleIssuesApi`, `ForceDoneWarning` |
| `packages/crew-web/src/api/crew/force-done.ts` | Client `crew.forceDone` | `forceDoneApi` |
| `packages/crew-web/src/features/issues/routes.tsx`, `index.ts` | Route `issues`, `issues/:ref` | `routes` |
| `packages/crew-web/src/features/issues/list/issues-page.tsx` | Trang danh sách | `IssuesPage` |
| `packages/crew-web/src/features/issues/list/issues-board.tsx` | Chế độ Bảng | `boardLayout` |
| `packages/crew-web/src/features/issues/list/use-issues.ts` | Dữ liệu và trạng thái URL | `COLUMN_IDS`, `KIND_FILTERS`, `VIEW_MODES` |
| `packages/crew-web/src/features/issues/list/list-view.ts`, `tree.ts` | Nhóm, vạch ngày, cây | `groupIssues`, `dateGroup`, `buildIssueTree` |
| `packages/crew-web/src/features/issues/new/` | Tạo yêu cầu, loại, thêm việc con | `NewRequestDialog`, `createRequest`, `REQUEST_KINDS`, `AddChildAction` |
| `packages/crew-web/src/features/issues/detail/issue-detail.tsx` | Khung chi tiết | `IssueDetail` |
| `packages/crew-web/src/features/issues/detail/issue-page.tsx` | Trang đầy đủ | `IssuePage` |
| `packages/crew-web/src/features/issues/detail/use-issue.ts` | Dữ liệu chi tiết | `useIssue`, `useChildIssues`, `useIssueActivity` |
| `packages/crew-web/src/features/issues/detail/crew/gate-actions.ts` | Luật nút cổng | `gateActionsFor`, `awaitingMyApproval`, `MIN_CHANGE_REASON` |
| `packages/crew-web/src/features/issues/detail/crew/actions-slot.tsx`, `gate-dialogs.tsx` | Nút và hộp cổng | `ActionsSlot`, `CommentDialog` |
| `packages/crew-web/src/features/issues/detail/crew/force-done.ts`, `force-done-dialog.tsx` | Ép Done phía web | `ForceDoneAction`, `MIN_FORCE_REASON` |
| `packages/crew-web/src/features/issues/detail/crew/interaction-card.tsx`, `interactions-slot.tsx` | Câu hỏi và xác nhận của Trợ Lý | `InteractionCard`, `InteractionsSlot` |
| `packages/crew-web/src/features/issues/detail/crew/summary-slot.tsx` | Tóm tắt Crew, bản đồ, kiểm docs | `SummarySlot` |
| `packages/crew-web/src/features/issues/detail/crew/runtime-slot.tsx` | Quyết định chọn runtime | `RuntimeSlot` |
| `packages/crew-web/src/features/issues/detail/history-format.ts`, `history.tsx` | Khối Lịch sử | `History`, `FORCE_DONE_ACTION`, `BOARD_OVERRIDE_ACTION` |
| `packages/crew-web/src/features/issues/detail/` (còn lại) | Bình luận, ô soạn, đính kèm, tài liệu, run, thuộc tính, sửa tiêu đề, Bắt đầu làm | `Comments`, `Composer`, `Attachments`, `IssueRuns`, `PropertiesPanel`, `TitleEditor` |
| `packages/crew-web/src/features/issues/popup/` | Popup chi tiết và link | `IssuePopupHost`, `IssueLink`, `issueHref` |

## Dữ liệu

- Route lõi Paperclip: issue (danh sách, chi tiết, PATCH, tiêu đề), bình luận, đính kèm, tài liệu, activity, run,
  interaction (`respond`), nhãn.
- Route plugin: `issues.force-done`; data key `crew.map`, `crew.docsCheck`, `crew.runtimeDecisions`.
- Activity: `crew.policy.board_override` (gate server), `crew.issue.force_done` (plugin).
- Bảng: plugin không ghi bảng riêng ở flow này; Ép Done đi qua `ctx.issues.update` của host.

## Flow liên quan

- `issue-gate`: luật stage và `board_override` mà thao tác cổng và Ép Done tuân theo.
- `roadmap-map`: bản đồ và dòng tóm tắt trong `SummarySlot`.
- `docs-snapshot`: panel kiểm docs.
- `runtime-fallback`: quyết định runtime hiện trong `RuntimeSlot`.
- `attachments`: xem và chọn file đính kèm.
- `contributions`: nhóm Chờ duyệt và bình luận chờ duyệt trong danh sách và luồng bình luận.
- `qc-department`: nhãn QC trên thẻ của chế độ Bảng.
- `web-shell`: shell gắn popup, quyền ghi hay chỉ đọc.

## Tests

- `packages/crew-plugin/src/__tests__/force-done.test.ts`: route chỉ cho board, chặn trước khi ghi, đóng issue kèm lý
  do và cảnh báo phụ.
- `packages/crew-web/test/features/issues/issues-page.test.tsx`, `issues-board.test.tsx`, `list-view.test.ts`,
  `tree.test.ts`, `issues-page-pending.test.tsx`: cây và thu gọn, chế độ Bảng, nhóm và vạch ngày, nhóm Chờ duyệt.
- `packages/crew-web/test/features/issues/new-request-dialog.test.tsx`, `use-create-request.test.ts`, `kinds.test.ts`,
  `kind-labels.test.tsx`, `add-child.test.ts`, `add-child-dialog.test.tsx`: tạo yêu cầu, nhãn loại, thêm việc con.
- `packages/crew-web/test/features/issues/gate-actions.test.ts`, `gate-actions.test.tsx`: nút cổng chỉ cho người tham gia
  stage đang chờ, body gửi đi.
- `packages/crew-web/test/features/issues/force-done.test.ts`, `force-done-dialog.test.tsx`, `history.test.tsx`,
  `history-format.test.ts`: Ép Done và dòng lịch sử gộp.
- `packages/crew-web/test/features/issues/` (còn lại): bình luận, ô soạn, đính kèm, câu hỏi Trợ Lý, thuộc tính, runtime,
  run, sửa tiêu đề, Bắt đầu làm, popup và URL, issue thuộc company khác prefix.

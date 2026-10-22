# Phòng QC duyệt lại yêu cầu của mình

> Flow `qc-department`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow qc-department` in ra đúng danh sách đó.

## Mục đích

Thành viên Phòng QC là người góp ý (flow `contributions`) thuộc phòng `qc`. Khi một yêu cầu do QC gửi (owner đã duyệt
thành issue) được làm xong, chính người QC đã gửi phải kiểm lại trước khi coi là đạt. Luật:

- Issue "của QC" là issue tạo từ góp ý `kind = 'issue'` mà người gửi thuộc Phòng QC lúc gửi (cột
  `submitted_department` chụp lúc gửi, đổi phòng sau đó không ảnh hưởng).
- Mỗi lần issue đó vào `done` (mọi đường, kể cả board ép xong) thì mở một vòng `awaiting` giao cho người QC đã gửi.
  Trạng thái lõi vẫn là `done`: agent coi là xong, không ai bị đánh thức, không cột lõi nào bị ghi thêm. Người được giao
  chỉ nằm ở bảng plugin, không đặt `assigneeUserId` lõi (đổi assignee lõi làm mất executor mà luồng mở lại dựa vào).
- "Xác nhận đạt" (người QC của vòng hoặc owner) chỉ đổi vòng sang `verified`: không ghi issue, không comment, không
  activity, không wake.
- "Chưa đạt" là một góp ý `kind = 'reopen'` kèm lý do, chờ owner duyệt; agent không thấy lý do cho tới khi owner duyệt và
  đăng comment mở lại (`reopenCommentBody`). Mỗi issue chỉ một yêu cầu mở lại đang chờ.
- Issue rời `done` thì vòng đang mở đóng (`awaiting` → `reopened`); vào `done` lần sau mở vòng mới.

## Điểm vào

- H2 (`beforeIssueWrite`): `crewQcBeforeIssueWrite` chạy sau cổng Crew trong cùng transaction.
- Route trong router góp ý (`server/src/crew/contribution-routes.ts`): `GET /api/crew/companies/:companyId/qc`,
  `POST /api/crew/companies/:companyId/qc/issues/:issueId/verify`. "Chưa đạt" đi qua route tạo góp ý.
- UI: khối `QcPanel` trên chi tiết yêu cầu; `QcBadge` và nhãn trạng thái QC ở danh sách, bảng Yêu cầu và bản đồ;
  `QcReviewList` ("Cần tôi duyệt") ở trang Chờ duyệt.

## Các bước

1. `server/src/crew/qc-verification.ts` → `crewQcBeforeIssueWrite`: đọc trạng thái dưới khóa dòng, gọi
   `recordQcStatusChange` theo `patch.status`. `loadQcOrigin` nhận issue của QC qua `result_issue_id` hoặc khóa
   idempotent `crew-contribution:<id>`. Bảng chưa có (plugin chưa áp migration) thì bỏ qua.
2. `server/src/crew/qc-verification.ts` → `listQcStates`: vòng đang mở của các issue `done` người xem thấy được (owner
   thấy tất cả, người khác theo quyền xem project).
3. `server/src/crew/qc-verification.ts` → `verifyQcRound`: `awaiting` → `verified`; đã `verified` thì trả như cũ; đang có
   yêu cầu mở lại chờ owner thì 409. `assertCanRequestReopen` kiểm điều kiện gửi "Chưa đạt".
4. `packages/crew-web/src/api/crew/qc.ts` → `qcApi.list`, `qcApi.verify`; `packages/crew-web/src/features/qc/use-qc.ts`
   → `useQcStates`, `useVerifyQc`, `useRequestReopen`.
5. `packages/crew-web/src/features/qc/qc-status.ts` → `qcDisplayStatus`, `displayStatus`, `awaitingMe`, `canVerify`,
   `canRequestReopen`, `qcErrorKey`: luật hiển thị thuần. Issue `done` có vòng QC hiện `qc_awaiting`, `qc_reopen` hoặc
   `qc_verified` thay cho "Hoàn thành"; trên bảng, thẻ vẫn ở cột Hoàn thành.
6. `packages/crew-web/src/features/qc/qc-panel.tsx` → `QcPanel`: nút Xác nhận đạt / Chưa đạt (lý do bắt buộc); owner
   thấy lý do QC và duyệt/từ chối yêu cầu mở lại ngay tại đây. Phòng Marketing chỉ thấy trạng thái.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `server/src/crew/qc-verification.ts` | Vòng QC: mở/đóng theo trạng thái issue, xác nhận, điều kiện mở lại | `crewQcBeforeIssueWrite`, `recordQcStatusChange`, `listQcStates`, `verifyQcRound`, `assertCanRequestReopen`, `QC_ERRORS` |
| `packages/crew-web/src/api/crew/qc.ts` | Client API | `qcApi` |
| `packages/crew-web/src/features/qc/qc-status.ts` | Luật hiển thị và quyền nút | `qcDisplayStatus`, `canVerify`, `canRequestReopen`, `qcErrorKey` |
| `packages/crew-web/src/features/qc/qc-panel.tsx` | Khối QC trên chi tiết yêu cầu | `QcPanel` |
| `packages/crew-web/src/features/qc/qc-review-list.tsx` | Danh sách "Cần tôi duyệt" | `QcReviewList` |
| `packages/crew-web/src/features/qc/qc-badge.tsx` | Nhãn trạng thái QC | `QcBadge` |
| `packages/crew-web/src/features/qc/use-qc.ts` | Hook query/mutation | `useQcStates`, `useVerifyQc`, `useRequestReopen` |
| `packages/crew-web/src/features/qc/index.ts` | Export của feature | (re-export) |
| `server/src/services/issues.ts` | File upstream chứa H2 | `issueService.update` |

## Dữ liệu

- Bảng plugin (migration `packages/crew-plugin/migrations/0019_qc_verification.sql`): `crew_qc_rounds` (mỗi issue tối đa
  một vòng mở); migration này cũng thêm `crew_contributions.submitted_department` và kind `reopen`. Đọc
  `crew_contributions`, `crew_contributors`, quyền xem project.
- Bảng lõi: đọc `issues`; không ghi.
- Lỗi: 404 `crew_qc_not_awaiting`, 409 `crew_qc_reopen_pending`, 403 `crew_qc_forbidden`.

## Flow liên quan

- `contributions`: phòng của người góp ý, góp ý `reopen` và router chứa route QC.
- `issue-gate`: H2 gọi phần QC ngay sau cổng Crew.
- `project-access`: người không phải owner chỉ thấy vòng QC của project được cấp.
- `issues-web`, `roadmap-map`: nơi hiển thị nhãn và khối QC.

## Tests

- `server/src/__tests__/crew-qc-verification.db.test.ts`: chỉ yêu cầu của QC mở vòng khi xong và lõi vẫn `done`; ai
  được xác nhận; xác nhận không ghi gì ngoài vòng; mở lại đóng vòng, xong lại mở vòng mới; "Chưa đạt" chỉ người QC của
  vòng, một yêu cầu mỗi lúc, agent không thấy; owner duyệt thì comment và đánh thức agent; phòng lúc gửi quyết định.
- `packages/crew-web/test/features/qc/qc-status.test.ts`: nhãn trạng thái, "Cần tôi duyệt", quyền nút, câu lỗi.
- `packages/crew-web/test/features/qc/qc-issue-detail.test.tsx`: khối QC trên chi tiết cho người QC, Phòng Marketing,
  owner; issue ngoài vòng QC giữ "Hoàn thành".
- `packages/crew-web/test/features/qc/qc-lists.test.tsx`: nhãn QC ở danh sách và bảng; "Cần tôi duyệt" của QC; hàng
  "QC yêu cầu mở lại" của owner.

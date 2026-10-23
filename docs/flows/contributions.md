# Góp ý chờ owner duyệt (Phòng Marketing, Phòng QC)

> Flow `contributions`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow contributions` in ra đúng danh sách đó.

## Mục đích

Người ngoài đội kỹ thuật (Phòng Marketing, Phòng QC) cần gửi yêu cầu và bình luận cho agent, nhưng owner phải duyệt
trước khi agent thấy. Người góp ý là viewer lõi được owner gắn dấu `contributor` kèm phòng (`marketing` hoặc `qc`; hai
phòng cùng quyền, phòng chỉ để owner phân biệt và để Phòng QC duyệt lại, flow `qc-department`).

Luật chính:

- Nội dung chờ nằm ở bảng plugin `crew_contributions`, không bao giờ ở bảng lõi, nên mọi đường đọc của agent không
  thấy nội dung chờ hay bị từ chối. Chỉ router Crew của server đọc/ghi hai bảng góp ý; plugin không nhắc tới chúng.
- Chỉ actor board đăng nhập bằng phiên trình duyệt được gọi router; agent, board API key (nằm trên máy chạy agent) và
  `local_implicit` nhận 403. Company không thuộc phiên, ngoài cấu hình Crew hoặc cấu hình hỏng: 404.
- Body bị dời khỏi `req.body` trước mọi bước có thể lỗi, để log HTTP và báo lỗi không chứa nội dung chờ. Router không
  ghi `activity_log`, không phát event; log chỉ ghi id.
- Duyệt có ba bước ở trình duyệt owner: server khóa mục (`pending` → `approving`), trình duyệt đăng qua route stock của
  board (issue với `idempotencyKey = crew-contribution:<id>`, bình luận với `clientRequestId = <id>`, "Chưa đạt" của QC là
  bình luận kèm `reopen: true`), rồi server tự tìm bản ghi lõi vừa tạo và chuyển `approved`. Vì đăng qua route stock nên
  policy Crew, wake và người nhận chạy y như board tự đăng. Server không tin id client gửi lên.
- Dấu `contributor` chỉ có hiệu lực khi bật sau lần đổi membership gần nhất, nên dấu cũ không tự sống lại.

## Điểm vào

- Vá C7 trong `server/src/app.ts`: `api.use(crewContributionRoutes(db))` ngay sau route approval, sau guard mutation của
  board. Router này cũng gắn router quyền xem project (flow `project-access`), router Jev (flow `jev`), router máy (flow `multi-machine`)
  và bộ chờ plugin khởi động.
- Route dưới `/api/crew/companies/:companyId`: `GET /access`, `GET /contributions`, `GET /contributions/summary`,
  `GET /contributions/:id`, `POST /contributions`, `POST /contributions/:id/approve`,
  `POST /contributions/:id/approve/complete`, `POST /contributions/:id/reject`, `GET /contributors`,
  `PUT /contributors/:userId`, `DELETE /contributors/:userId`. Route QC cùng router: flow `qc-department`.
- UI: trang `contributions` ("Góp ý của tôi" / hàng Chờ duyệt), dialog yêu cầu mới của người góp ý, ô soạn bình luận chờ
  trên chi tiết issue, popup mục góp ý qua tham số `?contribution=`.

## Các bước

1. `server/src/crew/contributions.ts` → `resolveContributionActor`, `requireOwner`, `requireContributor`: xác định người
   gọi theo role đọc từ DB (không qua `assertCompanyAccess`, vốn chặn mọi lệnh ghi của viewer). Bảng chưa sẵn sàng
   (`contributionTablesReady`) thì 503, riêng `/access` vẫn trả.
2. `server/src/crew/contributions.ts` → `parseCreateBody`, `createContribution`: ba kind `issue`, `comment`, `reopen`;
   chặn ký tự điều khiển trước khi chạm DB; lỗi DB thay bằng 500 cố định không kèm nội dung.
3. `server/src/crew/contributions.ts` → `approveContribution`, `completeContribution`, `rejectContribution`,
   `findMaterialized`, `selfHeal`: khóa có hạn `APPROVING_LOCK_MINUTES`, mọi lần đổi trạng thái là `UPDATE` có điều kiện.
   Mục đã lên lõi (kể cả bị từ chối đua với bước đăng) thì thành `approved`, vì agent đã thấy nội dung. `selfHeal` chạy
   trước khi đọc danh sách.
4. `server/src/crew/contributions.ts` → `listContributors`, `grantContributor`, `revokeContributor`: owner gắn/gỡ dấu cho
   viewer `active` (không phải viewer thì `crew_contributor_requires_viewer`).
5. `packages/crew-web/src/features/contributions/approve-flow.ts` → `approveContribution`: điều phối ba bước ở trình duyệt;
   bước đăng lỗi thì giữ câu lỗi và không gọi `complete`; `contributionErrorKey` đổi mã lỗi thành câu tiếng Việt.
6. `packages/crew-web/src/features/contributions/approve-issue-dialog.tsx` → `ApproveIssueDialog`: owner chọn project,
   agent nhận (mặc định Trợ Lý của project), lưu nháp (`backlog`) hay `todo`, loại Nghiên cứu (nhãn `research`). Chip "Jev gợi ý: <loại>" đọc tiêu đề và nội dung góp ý (flow `jev`).
7. Các component còn lại: `ContributionsPage` (ba tab theo trạng thái, phân trang bằng `before`), `NewContributionDialog`,
   `ContributionComposer` (người góp ý gửi bình luận chờ thay cho ô soạn stock), `PendingComment` (xen bình luận chờ
   vào luồng), `ContributionPopupHost`/`ContributionPopup`, `ContributionActions`, `RejectConfirm`, `ContributionNotice`.
   Dữ liệu qua `use-contributions.ts` và `packages/crew-web/src/api/crew/contributions.ts` (`contributionsApi`).

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `server/src/crew/contribution-routes.ts` | Router Crew: góp ý, người góp ý, `/access`, QC; gắn router con | `crewContributionRoutes` |
| `server/src/crew/contributions.ts` | Bảng góp ý, quyền người gọi, máy trạng thái duyệt | `resolveContributionActor`, `createContribution`, `approveContribution`, `completeContribution`, `rejectContribution`, `selfHeal`, `grantContributor`, `CONTRIBUTION_ERRORS`, `contributionIdempotencyKey` |
| `server/src/app.ts` | File upstream chứa C7 (cùng file với C15, parser webhook `docs-snapshot`) | `createApp` |
| `packages/crew-web/src/api/crew/contributions.ts` | Client API | `contributionsApi` |
| `packages/crew-web/src/features/contributions/approve-flow.ts` | Ba bước duyệt ở trình duyệt | `approveContribution`, `contributionErrorKey` |
| `packages/crew-web/src/features/contributions/use-contributions.ts` | Hook query/mutation | `useContributions`, `useApproveContribution`, `useRejectContribution`, `useCreateContribution` |
| `packages/crew-web/src/features/contributions/contributions-page.tsx` | Trang góp ý | `ContributionsPage` |
| `packages/crew-web/src/features/contributions/` (còn lại) | Dialog, popup, bình luận chờ, badge, route | `ApproveIssueDialog`, `NewContributionDialog`, `ContributionComposer`, `PendingComment`, `ContributionPopupHost`, `routes`; danh sách đủ: `crew-docs flow contributions` |

## Dữ liệu

- Bảng plugin: `crew_contributors`, `crew_contributions` (migration `0013_contributions.sql`; cột `department` từ
  `0018_contributor_department.sql`; kind `reopen` và `submitted_department` từ `0019_qc_verification.sql`).
- Bảng lõi: đọc `company_memberships` (role, `updated_at`), `issue_create_idempotency_keys` và `issue_comments` (tìm bản
  ghi đã đăng). Ghi lõi chỉ qua route stock do trình duyệt owner gọi.
- Lỗi: `crew_contribution_forbidden`, `crew_contributions_unavailable`, `crew_contribution_invalid`,
  `crew_contribution_invalid_target`, `crew_contribution_not_materialized`, `crew_contribution_not_approving`,
  `crew_contribution_decided`, `crew_contribution_already_approved`, `crew_contribution_locked`,
  `crew_contributor_requires_viewer`, `crew_contribution_store_failed`.

## Flow liên quan

- `core-hooks`: vá C7.
- `qc-department`: Phòng QC, góp ý `reopen` và route QC trong cùng router.
- `project-access`: router quyền xem project gắn bên trong; người góp ý chỉ gửi vào project được cấp.
- `jev`: router Jev gắn bên trong, dùng chung `resolveContributionActor`/`requireOwner`.
- `multi-machine`: router máy (chọn máy cho yêu cầu gốc, máy và repo của project) gắn bên trong, cùng luật người gọi.
- `crew-plugin`: bộ chờ plugin khởi động gắn ở router này.
- `issues-web`, `web-pages`: chi tiết issue, sidebar và trang thành viên dùng các component và `/access`.

## Tests

- `server/src/__tests__/crew-contributions.db.test.ts`: 503 khi chưa migrate (trừ `/access`); quyền `/access`; 403 với
  agent, `local_implicit` và board API key; 404 với company ngoài phiên hay cấu hình hỏng; các bước tạo, duyệt, từ chối,
  tự lành và gắn dấu người góp ý.
- `server/src/__tests__/crew-contributions-agent-blind.test.ts`: lúc chờ, mọi đường đọc của agent không có nội dung và
  không có wake; agent 403 ở mọi endpoint; duyệt qua route stock thì agent thấy và được đánh thức đúng một lần; mục bị
  từ chối không bao giờ tới agent.
- `packages/crew-plugin/src/__tests__/contributions-isolation.test.ts`: không file nguồn nào của plugin nhắc tới bảng góp
  ý, quyền xem project hay vòng QC.
- `packages/crew-web/test/api/contributions.test.ts`: đúng method, đường dẫn và body của mọi lời gọi.
- `packages/crew-web/test/features/contributions/approve-flow.test.ts`: ba bước cho yêu cầu, bình luận, "Chưa đạt";
  idempotency, nháp, nhãn research; duyệt lại khi đã duyệt; lỗi ở bước đăng.
- `packages/crew-web/test/features/contributions/approve-dialog.test.tsx`, `approve-actions.test.tsx`,
  `approve-popup.test.tsx`: dialog duyệt yêu cầu, nút duyệt/từ chối trong luồng bình luận, popup `?contribution=` theo
  vai trò.
- `packages/crew-web/test/features/contributions/contributions-page.test.tsx`, `new-contribution-dialog.test.tsx`,
  `contribution-composer.test.tsx`, `pending-comments.test.tsx`: trang góp ý, dialog gửi của người góp ý, ô soạn theo vai
  trò, bình luận chờ trong luồng.

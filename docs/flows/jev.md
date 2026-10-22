# Crew Jev trên server: cấu hình, key, máy, log gate, so sánh với regex

> Flow `jev`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow jev` in ra đúng danh sách đó.

## Mục đích

Crew Jev là cổng chặn lệnh `Bash` nguy hiểm của agent trên Mac, dùng Jev (mô hình phán đoán của TypeSafe, gọi qua
OpenRouter). Phần chặn chạy trên Mac (repo crew, flow `mac-jev`). Phần server trong flow này:

- Lưu cấu hình theo company (bật/tắt, chế độ `shadow`/`enforce`, model, ngưỡng, timeout, bật so sánh ở server) và
  key OpenRouter. Key là company secret `crew-jev-openrouter`; bảng chỉ giữ id secret và vân tay (12 hex đầu của
  sha256). Mỗi lần lưu cấu hình hay đổi key thì tăng `version` để Mac áp lại.
- Phát cấu hình cho Mac đã ký đúng (HMAC bằng khóa máy, cùng luật webhook máy của plugin). Key chỉ đi kèm khi Jev bật, có
  key và vân tay trên Mac khác server.
- Nhận log gate từ Mac (đã che secret lần nữa trước khi ghi), cho owner xem số liệu, ca deny/escalate/lỗi, và đánh dấu
  đúng/nhầm.
- So sánh Jev với regex (chỉ ghi, không quyết định): worker nền hỏi Jev cùng câu hỏi mà regex của lõi (nhãn liveness)
  và của plugin (phân loại lỗi runtime) đã trả lời, để owner thấy chỗ hai bên lệch. Quyết định thật vẫn theo regex.

Mọi route owner chỉ dành cho owner đăng nhập bằng phiên trình duyệt; board key, agent và role khác nhận 403. Body bị dời
khỏi `req.body` trước mọi bước có thể lỗi, nên log HTTP không bao giờ chứa key hay lệnh. Server không có dependency npm
`jev-use`: overlay prod chỉ chép file `.ts`, nên dùng bản bundle vendored nạp lười (hỏng thì chỉ Jev báo lỗi).

## Điểm vào

- UI: trang `jev` của crew-web (chỉ owner), khối Jev trên trang chi tiết issue (`IssueJevBlock`), số liệu Jev trên bản đồ
  yêu cầu (`use-roadmap.ts` gọi `requestMap`).
- Route owner dưới `/api/crew/companies/:companyId/jev`: `GET`/`PUT /settings`, `PUT`/`DELETE /key`, `GET /stats`,
  `GET /gate-events`, `POST /gate-events/:id/label`, `GET /shadow`, `GET /issues/:issueId/summary`,
  `GET /requests/:requestId/map`.
- Route máy (ký HMAC): `POST /machine/pull`, `POST /machine/events` cùng tiền tố. Mac gọi trong mỗi lượt
  `crew-mac status send`.
- Router được gắn bên trong router góp ý (`crewContributionRoutes`, vá lõi C7), nên không cần vá lõi mới. Tạo router
  cũng bật worker so sánh (`startJevShadowWorker`, bỏ qua khi `NODE_ENV=test`).
- `node crew/release/vendor-jev-use.mjs`: tạo lại bản vendored từ tarball npm (kiểm integrity).

## Các bước

1. `server/src/crew/jev-routes.ts` → `crewJevRoutes`: route owner qua `resolveContributionActor` + `requireOwner`; bảng
   chưa có thì 503 `crew_jev_unavailable`. `PUT /key` với `test: true` hỏi Jev một câu không chứa dữ liệu company để thử
   key. Lô events tối đa `JEV_EVENTS_MAX_ROWS` dòng và `JEV_EVENTS_MAX_BYTES`; dòng hỏng hay của company khác bị bỏ và
   đếm `rejected` để Mac vẫn tiến được con trỏ.
2. `server/src/crew/jev-machine-auth.ts` → `verifyMachineRequest`, `deriveMachineKey`, `verifyCrewSignature`: bản chép
   hàm thuần của plugin (có test hợp đồng gọi chính bản plugin). Secret webhook của company đọc từ cấu hình plugin
   `crew.core`, cache trong process; header sai hay lệch giờ bị từ chối trước khi đọc secret.
3. `server/src/crew/jev-store.ts`: đọc/ghi bốn bảng `crew_jev_*`; `storeJevKey`/`clearJevKey` tạo, rotate hay vô hiệu
   secret trong transaction có khóa theo company (secret trùng tên không do Crew tạo thì 409);
   `resolveJevApiKey` ghi một access event mỗi lần đọc; `jevStats` tính theo ngày giờ Việt Nam; `jevIssueSummary`,
   `jevRequestMap` tổng hợp theo run của issue và theo cây yêu cầu.
4. `server/src/crew/jev-client.ts` → `jevJudge`: gọi Jev qua bản vendored, không bao giờ ném; lỗi trả `errorCode`
   (`no_key`, `auth`, `timeout`, `unreachable`, `bad_response`, `internal`) không kèm message của provider.
5. `server/src/crew/jev-shadow.ts` → `runJevShadowSweep` (mỗi `JEV_SHADOW_INTERVAL_MS`): với company bật Jev, bật so
   sánh và có key: lấy run `succeeded` có nhãn liveness (dựng text từ comment và `result_json`, che secret, cắt
   `JEV_SHADOW_TEXT_MAX_BYTES`) và dòng `pending` plugin ghi lúc run hỏng; hỏi Jev rồi ghi kết quả. Lỗi lặp
   `JEV_SHADOW_MAX_ATTEMPTS` lần thì bỏ. Mỗi giờ xóa dữ liệu cũ hơn `JEV_RETENTION_DAYS`.
6. `server/src/crew/vendor/jev-use.ts` → `loadJevUse`: kiểu public và bộ nạp lười cho bundle `jev-use-<version>.ts`
   (file sinh, không sửa tay).
7. `packages/crew-web/src/features/jev/jev-page.tsx` → `JevPage`: `KeyForm` (ô password, xóa trắng sau khi gửi, chỉ hiện
   vân tay), `SettingsForm` (`parseSettingsForm`, `THRESHOLD_RANGE`, `TIMEOUT_RANGE`), `MachinesTable` (máy đã nhận bản
   cấu hình hiện tại và key khớp chưa), `StatsPanel`, `GateEventsTable`, `ShadowTable`. Dữ liệu qua `use-jev.ts` và
   `packages/crew-web/src/api/crew/jev.ts` (`jevApi`).

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `server/src/crew/jev-routes.ts` | Router owner và route máy | `crewJevRoutes`, `JEV_ERRORS`, `JEV_EVENTS_MAX_ROWS` |
| `server/src/crew/jev-store.ts` | Bảng `crew_jev_*`, secret key, số liệu | `getJevSettings`, `saveJevSettings`, `storeJevKey`, `clearJevKey`, `resolveJevApiKey`, `insertGateEvents`, `jevStats`, `JEV_DEFAULTS`, `JEV_SECRET_NAME` |
| `server/src/crew/jev-machine-auth.ts` | Xác thực request của Mac | `verifyMachineRequest`, `deriveMachineKey`, `verifyCrewSignature` |
| `server/src/crew/jev-client.ts` | Gọi Jev từ server | `jevJudge` |
| `server/src/crew/jev-shadow.ts` | Worker so sánh Jev với regex | `startJevShadowWorker`, `runJevShadowSweep`, `LIVENESS_SHADOW_LABEL` |
| `server/src/crew/vendor/jev-use.ts` | Kiểu và bộ nạp bản vendored | `loadJevUse` |
| `crew/release/vendor-jev-use.mjs` | Tạo lại bản vendored | (script) |
| `packages/crew-web/src/api/crew/jev.ts` | Client API | `jevApi` |
| `packages/crew-web/src/features/jev/jev-page.tsx` | Trang Jev | `JevPage` |
| `packages/crew-web/src/features/jev/issue-jev-block.tsx` | Khối Jev trên chi tiết issue | `IssueJevBlock` |
| `packages/crew-web/src/features/jev/use-jev.ts` | Hook query/mutation | `useJevSettings`, `useJevStats`, `useGateEvents`, `useShadowItems`, `useLabelEvent` |
| `packages/crew-web/src/features/jev/` (còn lại) | Form, bảng và route của trang | `KeyForm`, `SettingsForm`, `MachinesTable`, `StatsPanel`, `GateEventsTable`, `ShadowTable`, `routes`; danh sách đủ: `crew-docs flow jev` |

## Dữ liệu

- Bảng plugin (migration `packages/crew-plugin/migrations/0020_jev.sql`, chỉ server đọc/ghi): `crew_jev_settings`,
  `crew_jev_machines`, `crew_jev_gate_events`, `crew_jev_shadow` (plugin chỉ chèn dòng `pending`). Đọc thêm
  `machine_pairings` (hostname) và cấu hình plugin `crew.core` (secret webhook).
- Bảng lõi: company secret (tên `crew-jev-openrouter`) và access event của nó; đọc `heartbeat_runs`, `issue_comments`.
- Gọi ngoài: OpenRouter (Jev), chỉ khi thử key và trong worker so sánh. `CREW_JEV_BASE_URL` chỉ để test trỏ vào stub.
- Lỗi: 400 `crew_jev_invalid`, 404 `crew_jev_not_found`, 413 `too_many_events`, 503 `crew_jev_unavailable`.

## Giao diện đợt 2 (crew-web)

Công tắc chung là cột `enabled` của cấu hình; bốn tính năng (`complexity`, `approval_note`, `request_type`,
`inbox_attention`) có chế độ `off | shadow | on` trong `features` (thiếu khóa là `shadow`). Chỉ `on` mới hiện gì đó cho
owner; mọi lỗi, quá hạn, response sai dạng hay chế độ khác đều để màn hình chạy y như khi chưa có Jev.

- Trang `jev`: `MasterSwitch` (nút "Tắt toàn bộ Jev" có xác nhận, hoặc "Bật lại Jev") và `FeaturesSection` (chọn chế độ
  từng tính năng, lưu ngay; thống kê 7 ngày `GET /judgments/stats`; ca lệch `GET /judgments?feature=&mismatch=true`).
  Mọi lần lưu đi qua `useSaveJevSettings` và gửi PUT một phần: công tắc chung chỉ gửi `{enabled}`, đổi chế độ chỉ gửi
  `{features:{<khóa>:<chế độ>}}`, `SettingsForm` chỉ gửi trường của nó; không bao giờ gửi lại giá trị cache. Các nút lưu khóa
  nhau khi có lần lưu đang chạy và cấu hình được tải lại sau khi lưu. Thống kê và ca lệch (phân trang `before`) ngừng
  làm tươi khi route báo lỗi. `SettingsForm` không còn
  công tắc bật (đã chuyển lên công tắc chung).
- `judge-adapter.ts`: bộ chuyển duy nhất đọc response các route đợt 2 (`unknown` vào, kiểu của web hoặc `null` ra).
  `judge-client.ts`: `withHardTimeout` (AbortController và đồng hồ, không bao giờ ném), `judgeApprovalNote` (1500 ms),
  `judgeRequestType`, `recordOutcome` (bắn rồi quên).
- Duyệt / Yêu cầu sửa (`approval-note-check.tsx`, nối ở `actions-slot.tsx`): lời nhắn không rỗng và khác câu duyệt mặc
  định thì gọi `POST /judge/approval-note`. Chỉ khi `ok && mode === 'on' && mismatch` mới hiện hộp "Vẫn gửi / Sửa lại"
  (một lần), rồi ghi `sent` hoặc `changed`. Đóng hộp lời nhắn trong lúc chờ thì bỏ lượt kiểm; bấm hai lần chỉ gọi một lần.
- Loại yêu cầu (`use-request-type-suggestion.ts`, `request-type-chip.tsx`, nối ở `new-request-dialog.tsx` và
  `approve-issue-dialog.tsx`): chờ 800 ms và đủ 20 ký tự rồi hỏi một lần cho mỗi nội dung. Chế độ `on` hiện chip bấm để
  chọn, không tự đổi loại. Tối đa 3 lần hỏi mỗi lần mở form, chỉ hỏi lại khi chữ đổi đáng kể, hủy request cũ khi chữ đổi,
  chỉ gửi `current` khi owner đã chọn loại; khi gửi ghi loại cuối làm `outcome` cho phán đoán mới nhất.
- Cờ complexity: `complexityFlag` ở tóm tắt issue (khối `IssueJevBlock`) và `complexityFlags` ở bản đồ yêu cầu (thẻ
  `RoadmapComplexityFlag`). `kind: 'jev'` là "Jev: nên là large", `kind: 'vision'` là luật ảnh/model.
- Hộp thư (`inbox-attention-badge.tsx`, nối ở `inbox-page.tsx`): chỉ owner hỏi `GET /inbox-attention?issueIds=` cho các
  mục của tab đang xem; huy hiệu "Cần Đại Ca để ý" có tooltip liệt kê lý do. Chỉ làm tươi
  định kỳ khi route báo `mode: 'on'`.

## Flow liên quan

- `mac-jev` (repo crew): phía Mac kéo cấu hình, giữ key trong Keychain, chặn lệnh và đẩy log.
- `contributions`: router góp ý chứa router Jev và cung cấp `resolveContributionActor`/`requireOwner`.
- `runtime-fallback`: plugin ghi dòng so sánh `pending` khi phân loại run hỏng.
- `machine-status`: khóa máy, ghép máy và bảng `machine_pairings`.
- `issues-web`, `roadmap-map`: chỗ hiện khối Jev và số liệu trên bản đồ yêu cầu.

## Tests

- `server/src/__tests__/crew-jev-routes.db.test.ts`: 503 khi chưa migrate; 403 với mọi actor không phải owner; lưu key
  chỉ trả vân tay; kiểm schema và tăng version; pull kiểm chữ ký, máy bị gỡ, company không cấu hình, chỉ gửi key khi
  cần; giới hạn lô events, đếm trùng, che secret; số liệu theo giờ Việt Nam; đánh dấu ca; xóa key; log HTTP không có key
  hay lệnh.
- `server/src/__tests__/crew-jev-machine-auth.test.ts`: khóa máy và chữ ký khớp bản plugin; mã lỗi; từ chối trước khi đọc
  secret.
- `server/src/__tests__/crew-jev-client.test.ts`: trả lời qua bản vendored; phân loại 401/403, 5xx, body sai; bundle hỏng
  không làm hỏng router; hàm che của plugin khớp bản vendored.
- `server/src/__tests__/crew-jev-shadow.db.test.ts`: so sánh liveness và runtime; không gọi Jev khi tắt hay thiếu key;
  dọn dữ liệu cũ; con trỏ và cửa sổ một giờ; bỏ sau ba lần lỗi; truy vấn dùng index sẵn có.
- `packages/crew-web/test/features/jev/jev-page.test.tsx`: chỉ owner; ô key an toàn; thử key và lỗi 401; xóa key có xác
  nhận; kiểm timeout; bảng máy; số liệu; đánh dấu ca; dòng log bị bỏ.
- `packages/crew-web/test/features/jev/issue-jev-block.test.tsx`: dòng tóm tắt và bảng ca; ẩn khi không có dữ liệu, lỗi
  tải hay người không phải owner.
- `packages/crew-web/test/features/jev/settings-form.test.ts`: `parseSettingsForm` và biên ngưỡng, timeout.
- `packages/crew-web/test/features/jev/features-page.test.tsx`: công tắc chung (xác nhận, bật lại, lỗi), chế độ từng tính
  năng và lưu đủ `features`, thống kê gộp, ca lệch, thống kê lỗi hay sai dạng.
- `packages/crew-web/test/features/jev/approval-note.test.tsx`: hộp hỏi lại, Vẫn gửi / Sửa lại và outcome; shadow,
  `ok:false`, 404/500, sai dạng, quá 1500 ms thì gửi như cũ; không gọi Jev với câu mặc định; không gửi hai lần.
- `packages/crew-web/test/features/jev/request-type.test.tsx`, `approve-request-type.test.tsx`: chip, debounce, ngưỡng 20
  ký tự, không tự đổi loại, outcome; mọi lỗi thì không hiện gì.
- `packages/crew-web/test/features/jev/judge-adapter.test.ts`, `judge-client.test.ts`: đọc response đúng/sai dạng; hạn cứng.

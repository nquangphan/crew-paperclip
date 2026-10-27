# Cài đặt model của owner

> Flow `model-settings`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow model-settings` in ra đúng danh sách đó.

## Mục đích

Owner tự đổi bảng model khi ra model mới, không cần sửa code, deploy hay chạy lại `apply-roles`. Bảng dùng chung toàn
instance gồm ba phần:

- `catalog`: model của `claude_local`, `codex_local`, `opencode_local` (cờ `vision`), key effort của runtime và ô bảng độ
  khó `byComplexity` (model, effort theo mức `trivial|small|medium|large`);
- `order`: thứ tự runtime của từng mức (`large` chỉ `claude_local`);
- `roles`: model và effort mặc định của 9 vai (`assistant`, `executor`, `reviewer`, `integrator`, `bmad`,
  `executor-codex`, `executor-opencode`, `reviewer-codex`, `reviewer-root`). `reviewer-root` không phải agent: đó là
  override server gắn khi giao issue gốc cho reviewer Claude.

Luật:

- Chưa ai lưu bản nào thì bảng là mặc định `CREW_MODEL_SETTINGS_DEFAULT` (revision `0`), đúng bằng các hằng số trước khi
  có tính năng này, nên deploy không đổi hành vi.
- Lưu là áp ngay: agent của vai có mặc định đổi mà còn chạy đúng mặc định cũ được đổi model trong cùng transaction. Agent
  chỉnh tay giữ nguyên. Run đang chạy giữ model cũ tới khi xong.
- Nâng hàng loạt X→Y đổi mọi chỗ dùng X: catalog, ô bảng độ khó, vai, mọi agent của company Crew và override model của
  issue đang mở.
- Đổi catalog hay bảng độ khó không chạm agent; chỉ đổi cách Trợ Lý chọn ở run kế, luật kiểm override (H2/H4) và đích
  fallback.

## Điểm vào

- Route trong router góp ý (vá C7, `crewModelSettingsRoutes`), không có `:companyId`:
  - `GET /api/crew/model-settings`: mọi actor đã xác thực (board mọi nguồn, agent); actor ẩn danh nhận `401`. Trả
    `{ revision, updatedAt, updatedByUserId, settings, canEdit }`.
  - `PUT /api/crew/model-settings` `{ baseRevision, settings, dryRun? }` (owner): trả
    `{ revision, settings, applied: { agents, skipped }, dryRun }`.
  - `POST /api/crew/model-settings/upgrade` `{ baseRevision, runtime, fromModel, toModel, vision?, dryRun? }` (owner):
    trả `{ revision, settings, changes: { catalog, cells, roles, agents, skipped, issues }, dryRun }`.
- Owner là actor board đăng nhập bằng phiên trình duyệt có `isInstanceAdmin` (middleware auth tính lại từ
  `instance_user_roles` mỗi request). Board API key, `local_implicit` và agent nhận `403`; `canEdit` chỉ đúng với owner.
- Run SSH của Trợ Lý đọc `GET` qua cầu nối callback nhờ vá C17 (một dòng allowlist trong
  `packages/adapter-utils/src/sandbox-callback-bridge.ts`); `PUT`/`POST` vẫn bị cầu nối chặn.

## Các bước

1. `server/src/crew/model-settings.ts` → `CREW_MODEL_SETTINGS_DEFAULT`: dựng từ `CREW_RUNTIME_CATALOG`,
   `CREW_RUNTIME_ORDER`, `CREW_CODEX_REVIEWER_MODEL` của `model-policy.ts`; vai Claude theo crew-web (Trợ Lý opus, còn lại
   sonnet), `bmad` theo agent BMAD trên prod (`claude-opus-5-5`), executor Codex/OpenCode theo hàng `small`, reviewer gốc
   `claude-opus-5-5`/`high`.
2. `server/src/crew/model-settings.ts` → `validateModelSettings`: luật dạng, thứ tự, ô bảng độ khó (có ô khi và chỉ khi
   runtime nằm trong thứ tự của mức), `large` chỉ dùng model `vision: true`, đủ 9 vai và effort theo key của runtime
   (`executor-codex`, `reviewer-codex`, `reviewer-root` bắt buộc có effort). Trả bản sạch hoặc
   `issues: [{ path, message }]`; `path` nối bằng dấu chấm, id model giữ nguyên (có thể chứa `.` hay `/`).
3. `server/src/crew/model-settings.ts` → `loadModelSettings`, `readModelSettingsRow`: đọc dòng revision lớn nhất bằng
   `readPluginRows` (savepoint, an toàn trong `tx` của H2/H4), cache 60 giây trong process; lưu thành công ghi đè cache
   ngay (`rememberModelSettings`; bản cũ hơn bản đang cache còn hạn thì bỏ qua, để một lần `GET` đọc trước khi lưu commit
   không đè bản vừa lưu). Bảng chưa có hay chưa có dòng: mặc định. Đọc lỗi hay dòng sai dạng: cache gần nhất,
   chưa có thì mặc định, cảnh báo tối đa 1 lần/phút.
4. `server/src/crew/model-settings.ts` → `codexReviewerOverrides`, `rootReviewerOverrides`: override reviewer Codex và
   reviewer gốc dựng từ `roles` và key effort của runtime; `issue-gate.ts` (`routeAssigneeOverrides`) dùng chúng, H2/H4
   truyền `settings.catalog` cho `checkAgentAdapterOverrides` (flow `issue-gate`).
5. `server/src/crew/model-settings-routes.ts` → `saveModelSettings` (`PUT`): trong một transaction: kiểm `baseRevision`
   (`409`), kiểm luật (`422`), không gỡ model còn dùng ở agent chưa `terminated` hay issue chưa `done`/`cancelled` của
   company Crew (`422 crew_model_in_use`), thêm dòng `revision = baseRevision + 1` (trùng khóa chính cũng là `409`), rồi
   với mỗi vai có model hay effort đổi (trừ `reviewer-root`) đổi agent của vai:
   - nguồn vai: các cột của `crew_project_roles` trên mọi company, cộng agent BMAD (`extraArgs` có
     `/.crew/workflows/bmad/`); chỉ agent đúng runtime của vai và chưa `terminated`;
   - agent đúng model mặc định cũ thì đổi model; effort chỉ đổi khi effort mặc định đổi và effort của agent đúng bằng
     effort cũ (effort mới `null` thì xóa key);
   - bỏ qua có lý do: `manual` (khác model cũ, hay effort chỉnh tay khi chỉ effort đổi), `pending_approval`, `multi_role`
     (agent thuộc nhiều vai có mặc định khác nhau).
6. `server/src/crew/model-settings-routes.ts` → `upgradeModel` (`POST /upgrade`): `applyUpgradeToSettings` đổi tên X
   thành Y tại chỗ (`renamed`, giữ hoặc ghi đè `vision`) hoặc gỡ X khi Y đã có (`merged`), chuyển ô và vai của runtime
   đang trỏ X; kiểm luật trên kết quả; thêm revision; đổi mọi agent của company Crew đúng runtime, chưa `terminated`, model
   X (bỏ qua `pending_approval`), giữ effort; đổi `assignee_adapter_overrides.adapterConfig.model` của issue đang mở bằng
   `jsonb_set` (ghi thẳng DB, không chạy H2, không đánh thức run).
7. Đổi agent luôn qua `agentService(tx).update` với `recordRevision: { createdByUserId, source: "crew_model_settings" }`
   (lõi ghi revision cấu hình, giữ nguyên phần còn lại của `adapterConfig`), kèm activity; live event phát sau commit.
   `dryRun: true` chạy đúng đường áp dụng rồi rollback, nên bản xem trước và bản thật cho cùng số liệu.

8. `packages/crew-web/src/api/crew/model-settings.ts` → `modelSettingsApi`: `get` (`GET /api/crew/model-settings`, khóa endpoint
   `modelSettings.get`), `save` (`PUT`, `dryRun` tùy chọn), `upgrade` (`POST /upgrade`, `dryRun` tùy chọn). Lỗi của route
   là `ApiError` giữ nguyên body; `modelSettingsErrorOf` phân loại theo `code` thành `invalid` (kèm `issues` có `path`),
   `in_use`, `stale` (kèm `currentRevision`), `forbidden`, `unavailable`, `other`.
9. `packages/crew-web/src/features/model-settings/use-model-settings.ts` → `useModelSettings`: một query dùng chung
   (`queryKeys.modelSettings`, `staleTime` 30 giây). Wizard thêm agent/project và ô chọn model của agent đọc danh sách
   model, model mặc định và effort từ `settings` của query này; chưa tải xong thì wizard chưa cho tạo, tải lỗi thì hiện
   `ErrorState`. Lưu hay nâng hàng loạt xong gọi `invalidateModelSettings` để bảng và các query agent đọc lại.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `server/src/crew/model-settings.ts` | Kiểu, mặc định, luật, đọc bảng và cache, override reviewer, phần bảng của nâng hàng loạt | `CREW_MODEL_SETTINGS_DEFAULT`, `CREW_MODEL_ROLE_RUNTIME`, `validateModelSettings`, `loadModelSettings`, `readModelSettingsRow`, `codexReviewerOverrides`, `rootReviewerOverrides`, `applyUpgradeToSettings` |
| `server/src/crew/model-settings-routes.ts` | Route, quyền, lưu và nâng hàng loạt trong transaction | `crewModelSettingsRoutes`, `saveModelSettings`, `upgradeModel`, `MODEL_SETTINGS_ERRORS` |
| `packages/crew-web/src/api/crew/model-settings.ts` | Client API và kiểu của bảng cài đặt model | `modelSettingsApi` (`get`, `save`, `upgrade`), `modelSettingsErrorOf`, `ModelSettings` |
| `packages/crew-web/src/features/model-settings/use-model-settings.ts` | Hook đọc bảng cho wizard, ô chọn model và trang cài đặt | `useModelSettings`, `invalidateModelSettings` |
| `packages/crew-plugin/migrations/0023_model_settings.sql` | Bảng revision cài đặt model | `crew_model_settings` |
| `packages/adapter-utils/src/sandbox-callback-bridge.ts` | File upstream chứa vá C17 (dùng chung với flow `core-hooks`) | `DEFAULT_SANDBOX_CALLBACK_BRIDGE_ROUTE_ALLOWLIST` |

## Dữ liệu

- Bảng plugin `crew_model_settings` (`revision` khóa chính ≥ 1, `settings`, `change`, `created_by_user_id`,
  `created_at`): chỉ thêm dòng, không `UPDATE`/`DELETE`, không có `company_id`. Chỉ server ghi; plugin chỉ đọc (flow
  `runtime-fallback`). `change` là `{ kind: "save", agents }` hoặc
  `{ kind: "upgrade", runtime, from, to, agents, issues }`.
- Bảng lõi: đọc `crew_project_roles` (plugin), `agents`, `issues`; ghi `agents.adapter_config` (qua service lõi),
  `agent_config_revisions`, `issues.assignee_adapter_overrides` (chỉ khi nâng hàng loạt), `activity_log`.
- Activity: `crew.model_settings.agent_model` (entity agent, `details: { revision, cause: "role_default" |
  "bulk_upgrade", role, from, to }`), `crew.model_settings.issue_override_model` (entity issue,
  `details: { revision, runtime, from, to }`).
- Lỗi trả phẳng `{ error, code, ... }`: `400`/`422 crew_model_settings_invalid` (`issues`), `422 crew_model_in_use`
  (`inUse: [{ runtime, model, agents, issues }]`), `409 crew_model_settings_stale` (`currentRevision`),
  `403 crew_model_settings_forbidden`, `503 crew_model_settings_unavailable` (plugin chưa áp `0023`).

9. `packages/crew-web/src/features/settings/models/model-settings-page.tsx` → `ModelSettingsPage` (route `settings/models`,
   lối vào là Section "Model" của `SettingsPage`, chỉ hiện khi `GET` trả `canEdit: true`; mở thẳng URL khi không phải
   owner thì `ErrorState` "Chỉ owner sửa được"): giữ bản nháp `draft` tách khỏi bản đang lưu `base`, bốn phần
   `CatalogSection` (model, cờ xem ảnh, key effort; nút Gỡ khóa khi model còn dùng ở ô hay vai), `ComplexitySection`
   (thứ tự runtime lên/xuống và bật/tắt, model và effort từng ô; `large` khóa ở Claude), `RolesSection` (9 vai, runtime chỉ
   đọc), nút mở `UpgradeDialog`. Các phép sửa thuần và cách khớp lỗi `path` với ô nằm ở `model-draft.ts`. Mọi danh sách
   model của một runtime (dòng catalog, select model của ô và vai, model cũ của hộp thoại nâng) lấy qua `crewModelsOf`
   (flow `agent-roles`), sắp theo id kiểu natural sort, nên lần lưu đầu không làm đảo thứ tự theo khóa `jsonb`.
10. Lưu: gọi `PUT` với `dryRun: true`; có agent bị đổi thì `ConfirmDialog` nêu số agent đổi và số giữ/bỏ qua, rồi `PUT` thật
    (cùng body, `dryRun: false`). Sau khi lưu hiện kết quả (agent đã đổi) ở thanh Lưu và gọi `invalidateModelSettings`.
    Lỗi: `422 invalid` viền đỏ đúng ô và tóm tắt "N lỗi" (bản nháp giữ nguyên), `422 in_use` báo tại runtime kèm nút
    "Nâng model" điền sẵn model cũ, `409` (hoặc `GET` thấy bản mới hơn) banner có nút Tải lại, `503` và lỗi mạng hiện
    thông báo. Rời trang khi còn thay đổi chưa lưu thì hỏi lại (`useBlocker`, `beforeunload`).
11. `upgrade-dialog.tsx` → `UpgradeDialog`: chọn runtime, model cũ, model mới (id lạ thì hỏi cờ xem ảnh); "Xem trước" gọi
    `POST /upgrade` `dryRun: true` và hiện catalog đổi tên hay gộp, số ô bảng độ khó, vai, agent (kèm company), issue đang
    mở, agent bỏ qua kèm lý do; "Nâng N chỗ" gửi lại đúng body với `dryRun: false`. Số thật khác bản xem trước thì ghi
    "khác xem trước vì dữ liệu vừa đổi". Nâng hàng loạt luôn áp trên bản đang lưu, nên bản nháp chưa lưu bị bỏ (hộp thoại cảnh
    báo).

## Flow liên quan

- `contributions`: router cha (vá C7).
- `core-hooks`: vá C17 (allowlist cầu nối callback).
- `issue-gate`: H2/H4 kiểm override theo catalog hiện hành, override reviewer theo `roles`.
- `project-roles`: bảng vai trò theo project, nguồn agent của từng vai.
- `runtime-fallback`: plugin đọc bảng cho đích fallback.
- `agent-roles`: `assistant.md` đọc bảng qua `GET /api/crew/model-settings`.

## Tests

- `server/src/__tests__/crew-model-settings.test.ts`: mặc định bằng hằng số cũ và hợp lệ; mỗi luật có ca lỗi kèm `path`;
  override reviewer theo vai; `applyUpgradeToSettings` cho `renamed` và `merged`.
- `server/src/__tests__/crew-model-settings.db.test.ts` (Postgres nhúng, migration plugin thật): chưa có bảng thì `GET`
  mặc định, `PUT`/`POST` `503`; quyền theo actor; `400`/`422`/`409`; dry-run không ghi gì và trả đúng kết quả lần thật;
  đổi mặc định vai (`manual`, `pending_approval`, `multi_role`, activity và revision cấu hình); `crew_model_in_use`; H2/H4
  nhận model vừa thêm và chặn model vừa gỡ; override reviewer theo `roles`; đọc bảng lỗi không làm hỏng lệnh ghi issue;
  nâng hàng loạt `renamed`/`merged`, issue `done` và company khác không đổi, `vision: false` ở `large` bị `422`, lỗi giữa
  chừng rollback toàn bộ.
- `packages/crew-web/test/api/model-settings.test.ts`: client gửi đúng method, đường dẫn và body (kể cả `dryRun`);
  `modelSettingsErrorOf` phân loại `422` sai luật, `422` đang dùng, `409`, `403`, `503` và lỗi mạng.
- `server/src/__tests__/crew-bridge-allowlist.test.ts`: allowlist chỉ cho qua `GET /api/crew/model-settings`.
- `packages/crew-web/test/features/settings/model-draft.test.ts`: các phép sửa bản nháp (thêm/gỡ model, bật/tắt và đổi chỗ
  runtime, đổi key effort) và khớp lỗi `path` với ô.
- `packages/crew-web/test/features/settings/model-settings-page.test.tsx`: bốn phần từ bảng của server, không phải owner,
  lưu (dry-run rồi lưu thật, xác nhận khi có agent đổi), `422`/`409`/`503`, gỡ model đang dùng, khóa `large`, hoàn tác, hỏi
  khi rời trang, nâng hàng loạt (xem trước, xác nhận, khác xem trước, bị từ chối).
- `packages/crew-web/e2e/specs/s18-model-settings.spec.ts` (T1): mỗi phần (a) đến (d) kiểm tác dụng bằng `GET`, xung đột hai
  tab, key agent đọc được bảng, người không phải owner; cuối spec trả lại bản `settings` ban đầu.

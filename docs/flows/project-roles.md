# Vai trò agent theo project

> Flow `project-roles`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow project-roles` in ra đúng danh sách đó.

## Mục đích

Mỗi project có bộ vai trò riêng: Trợ Lý (assistant), một hoặc hai executor, reviewer, integrator, và ba ô runtime tùy
chọn (executor Codex, executor OpenCode, reviewer Codex). Gate issue của server đọc bộ này để biết ai được giao việc và
ai duyệt. Owner xem và sửa ở tab Vai trò của project; đổi người làm thì AGENTS.md của Trợ Lý (chứa danh sách executor và
reviewer Codex) được render lại.

Luật chính:

- Chỉ board đổi được vai trò; agent không bao giờ tự sửa cổng duyệt của mình.
- Mọi id phải là agent của chính company đó và chưa `terminated`.
- Trong một company, một agent là người làm (assistant, executor) hoặc cổng duyệt (reviewer, integrator, reviewer
  Codex), không bao giờ cả hai, kể cả ở hai project khác nhau (`crossProjectConflict`): gate cấm agent giao việc cho
  bất kỳ reviewer/integrator nào của company.
- Ô runtime chỉ nhận agent đúng adapter của ô; ô Claude không nhận agent Codex/OpenCode. Ô runtime không gửi thì giữ
  giá trị đang lưu, gửi `null` thì xóa.
- Lỗi DB không trả SQL cho board; mỗi lần đổi ghi một dòng log `crew project roles changed` có giá trị trước và sau.

## Điểm vào

- Route plugin (board): `GET /projects/:projectId/roles`, `POST /projects/:projectId/roles`,
  `DELETE /projects/:projectId/roles` → `handleRolesApi`.
- crew-web: tab Vai trò trên trang chi tiết project (`RolesTab`).
- Wizard thêm project, tạo agent và gỡ (flow `setup-wizards`) cũng gọi `roles.set`/`roles.delete`.

## Các bước

1. `packages/crew-web/src/features/projects/detail/roles-tab.tsx` → `RolesTab`: đọc vai trò (`rolesApi.get`), hiện
   bốn vai trò và ba ô runtime; ô runtime trống có lối sang wizard Tạo agent.
2. `packages/crew-web/src/features/projects/detail/use-role-agents.ts` → `useRoleAgents`: danh sách agent kèm trạng
   thái sẵn sàng (dùng chung `loadProjectReadiness`).
3. `packages/crew-web/src/features/projects/detail/roles-form.tsx` → `roleOptions`, `RolesForm`: hộp chọn chỉ có
   agent sẵn sàng hoặc đang giữ đúng ô đó, đúng runtime, không giữ vai trò xung đột ở project khác.
4. `packages/crew-web/src/features/projects/detail/use-save-roles.ts` → `saveRoles`: POST vai trò; nếu Trợ Lý, tập
   executor hay reviewer Codex đổi thì `syncAssistantInstructions` render lại AGENTS.md của Trợ Lý và PUT kèm
   `baseHash` (xung đột thì không ghi đè, báo riêng bằng `InstructionsStepError`).
5. `packages/crew-plugin/src/roles/api.ts` → `handleRolesApi`: chặn actor không phải user, kiểm body và luật vai trò
   (không chạm DB), kiểm agent thuộc company và adapter của ô, kiểm xung đột với project khác, rồi ghi.
6. `packages/crew-plugin/src/roles/data.ts` → `readProjectRoles`, `upsertProjectRoles`, `deleteProjectRoles`,
   `firstUnusableAgent`, `otherProjectRoles` (bỏ dòng của project đã xóa).
7. `server/src/crew/project-roles.ts` → `loadCrewRoles`: gate issue (flow `issue-gate`) đọc reviewer/integrator theo
    project từ bảng `crew_project_roles` trong transaction lồng. Bảng chưa có thì dùng cấu hình file; lỗi đọc với
    `onReadError: "throw"` ném 503 `CREW_ROLES_UNAVAILABLE`; dòng trỏ agent không hợp lệ thì `invalid` (fail closed).

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `packages/crew-plugin/src/roles/api.ts` | Route vai trò, luật vai trò | `handleRolesApi` |
| `packages/crew-plugin/src/roles/data.ts` | SQL bảng vai trò | `ProjectRoles`, `upsertProjectRoles`, `firstUnusableAgent`, `RUNTIME_SLOT_KEYS` |
| `server/src/crew/project-roles.ts` | Server đọc vai trò theo project (gate issue); `CREW_PLUGIN_KEY`, `rowsOf` dùng chung cho module server Crew | `loadCrewRoles`, `crewRolesTable`, `CREW_ROLES_UNAVAILABLE` |
| `packages/crew-web/src/api/crew/roles.ts` | Client `roles.get`/`set`/`delete` | `rolesApi` |
| `packages/crew-web/src/features/projects/detail/roles-tab.tsx` | Tab Vai trò | `RolesTab` |
| `packages/crew-web/src/features/projects/detail/roles-form.tsx` | Form sửa vai trò | `RolesForm`, `roleOptions`, `rolesOf` |
| `packages/crew-web/src/features/projects/detail/use-role-agents.ts` | Agent kèm sẵn sàng | `useRoleAgents` |
| `packages/crew-web/src/features/projects/detail/use-save-roles.ts` | Lưu vai trò, render lại AGENTS.md Trợ Lý | `saveRoles`, `useSaveRoles`, `syncAssistantInstructions` |

## Dữ liệu

- Bảng plugin `crew_project_roles` (`0004_project_roles.sql`; ba cột ô runtime ở `0012_runtimes.sql`). Không có FK
  tới `projects`.
- Bảng lõi đọc: `agents` (company, trạng thái, `adapter_type`), `projects`.
- Server đọc bảng này qua `loadCrewRoles` (`server/src/crew/project-roles.ts`).
- Log: `crew project roles changed`, `crew project roles request failed`.

## Flow liên quan

- `crew-plugin`: plugin sở hữu bảng và migration.
- `issue-gate`: dùng vai trò theo project để kiểm giao việc và duyệt.
- `agent-roles`: template AGENTS.md mà Trợ Lý được render lại.
- `setup-wizards`: ghi và xóa vai trò khi thêm, gỡ; trạng thái sẵn sàng.
- `runtime-switches`: ô runtime chọn agent Codex/OpenCode.
- `web-pages`: trang chi tiết project chứa tab.

## Tests

- `packages/crew-plugin/src/__tests__/roles.db.test.ts`: route chỉ cho board, kiểm mọi id theo company, không ghi input
  sai, ô runtime (lưu, giữ khi không gửi, xóa bằng `null`, đúng adapter), không chéo vai trò giữa project.
- `packages/crew-web/test/features/projects/roles-form.test.tsx`: lựa chọn trong hộp chọn, nút Lưu, lỗi server nguyên
  văn, gửi `null` khi bỏ ô runtime.
- `packages/crew-web/test/features/projects/use-save-roles.test.ts`: khi nào render lại AGENTS.md Trợ Lý, giữ danh sách
  BMAD, xung đột 409 không ghi đè, lỗi 400 không PUT.
- `server/src/__tests__/crew-project-roles.test.ts`, `crew-project-roles.db.test.ts`: `loadCrewRoles` khi bảng chưa
  có, project không có dòng, bảng đọc lỗi (board và hệ thống rơi về vai trò file trong savepoint, agent và lúc tạo issue nhận 503), dòng trỏ agent không hợp lệ.

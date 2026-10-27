# Wizard thêm agent, thêm project, gỡ và kiểm sẵn sàng

> Flow `setup-wizards`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow setup-wizards` in ra đúng danh sách đó.

## Mục đích

Owner thêm project, tạo agent, gỡ project và gỡ agent ngay trên crew-web thay vì sửa tay nhiều chỗ (agent, environment
SSH, checkout trên Mac, vai trò, AGENTS.md). Mỗi lần chạy là một setup run lưu ở plugin, gồm các bước cố định
(`SETUP_STEPS`). Bước dở hay lỗi thì "Chạy tiếp" từ bước đầu chưa xong, dùng lại id đã tạo trong `refs`. Trang trạng
thái sẵn sàng tính ở web xem agent và project đã đủ điều kiện chạy chưa, và dẫn "Làm tiếp" vào đúng wizard và đúng bước.

Luật chính:

- Chỉ board chạy được wizard. Mọi lời gọi mang `companyId` của setup run, không lấy company đang chọn trên trang.
- Mỗi run chỉ một bước chạy một lúc: `setup.begin` cấp `lockToken`, khóa quá `SETUP_LOCK_MINUTES` coi như chết (dài hơn
  lease một việc trên máy).
- Một khóa project chỉ có một run thêm project dở; một project hay agent chỉ có một run gỡ dở. Run thêm project lỗi mà
  chưa tạo project thì owner "Bỏ lần dở" (`abandoned`, trả khóa); run gỡ không bỏ được, chỉ chạy tiếp.
- Không bao giờ xóa: gỡ là pause agent, archive environment và project (PATCH trạng thái), gỡ checkout. Chỉ dòng vai
  trò được xóa. Environment mẫu (giữ secret SSH) không bao giờ bị chạm. Gỡ project hay agent còn archive environment
  `@máy` của agent trên máy khác và xếp `remove-checkouts` ở đó qua route Crew (flow `multi-machine`); cây ghim máy còn
  run chờ hay đang chạy thì dừng ngay ở bước đầu.
- Lỗi giữa chừng thì pause agent do chính wizard tạo; agent có sẵn không bị đụng.
- Agent giữ vai trò bắt buộc (Trợ Lý, reviewer, integrator, executor duy nhất) không gỡ được vì project sẽ fail
  closed; ô runtime là tùy chọn.
- Việc trên máy (soi thư mục, tạo hay gỡ checkout) đi qua hàng đợi machine jobs; khóa project dùng cùng luật với app
  Mac (`PROJECT_KEY_RE`), khóa `e2e-` chỉ dùng ở company Crew E2E.

## Điểm vào

- crew-web route `projects/new`, `agents/new`, `projects/remove`, `agents/remove`
  (`packages/crew-web/src/features/wizards/routes.tsx`). `?resume=<setupRunId>` chạy tiếp; `agents/new?fix=<agentId>&step=`
  sửa agent không có run dở (agent do app tạo).
- Nút `RemoveProjectButton`, `RemoveAgentButton` trên trang project và agent; nhãn sẵn sàng (`ReadinessBadge`).
- Route plugin (board): `POST /setup-runs`, `GET /setup-runs/:id`, `POST /setup-runs/:id/steps/:stepId/begin`,
  `POST /setup-runs/:id/steps/:stepId/finish`, `POST /setup-runs/:id/abandon` → `handleSetupApi`.
- Data key `crew.setupRuns`.

## Các bước

1. `packages/crew-plugin/src/setup/api.ts` → `handleSetupApi`: chặn actor không phải board, kiểm input theo loại run,
   từ chối run trùng (`activeProjectRun`, `activeRemovalRun`, trả 409 kèm id để web mở lần đó).
2. `packages/crew-plugin/src/setup/data.ts` → `insertSetupRun`, `beginStep`, `finishStep`, `abandonSetupRun`: ghi
   tiến độ; bước cuối `done` thì run `done`.
3. `packages/crew-web/src/features/wizards/add-project/run-step.ts` → `runAddProjectStep`: các bước `inspect`,
   `project`, `checkouts`, `environments`, `agents`, `roles`, `check`; chọn environment mẫu đúng máy (`pickTemplate`),
   chờ việc trên máy bằng `waitJob` (`add-project/wait-job.ts`). Phần bổ sung cho nhiều máy: bước `inspect` lưu `remote`;
   bước `check` xong thì `provisionOthersSafely` xếp `ensure-project` cho máy khác (`refs.others`, lỗi ở
   `refs.othersError`, không làm hỏng run); `repoOf` bỏ remote đã che và cắt userinfo https trước khi gửi.
4. `packages/crew-web/src/features/wizards/add-agent/run-step.ts` → `runAddAgentStep`: `agent`, `pin`,
   `environment`, `workspace`, `role`, `assistant-instructions` (render lại AGENTS.md của Trợ Lý khi danh sách executor
   đổi); bước cuối còn xếp dựng lại mọi máy khác kể cả máy `ready` (`includeReady`, phần bổ sung cho nhiều máy). Mỗi bước kiểm trước rồi chỉ ghi phần chưa đạt, nên chế độ sửa dùng cùng code. Repo gốc của project không có
   lần thêm project được hỏi máy qua việc `inspect-folder` (`add-agent/repo-root.ts`). Model của agent mới lấy từ bảng
   cài đặt model (flow `model-settings`): form (`add-agent-page.tsx`, `validate.ts`) đọc `useModelSettings` để liệt kê
   model của runtime của ô và chọn mặc định theo `settings.roles` (chưa tải xong thì chưa cho tạo, tải lỗi thì
   `ErrorState`); bước `agent` và bước `agents` của thêm project gọi `api.modelSettings.get` rồi dựng body bằng
   `crewAgentCreateBody({ settings })`, nên effort Codex theo vai.
5. `packages/crew-web/src/features/wizards/remove/remove-project.ts` → `runRemoveProject`; `remove/remove-agent.ts` →
   `runRemoveAgent`: pause, ghi hay xóa vai trò, archive environment riêng (`exclusiveEnvironments`), gỡ checkout; checkout
   còn việc chưa commit được máy giữ lại và báo (`keptCheckouts`). `assertNoMachineBlockers` kiểm cây ghim còn run trước
   khi pause (project) hay đổi vai trò (agent, chỉ khi agent còn giữ ô: server từ chối id ngoài dòng vai trò, nên lần chạy
   tiếp sau khi agent đã ra khỏi vai trò không hỏi); `releaseOtherMachines` dọn máy khác khi agent còn giữ vai trò (cuối bước
   pause của project, với mọi agent đang trong dòng vai trò đọc lại ở lần chạy đó, kể cả terminated, không dùng id cũ trong
   refs; trước khi ghi vai trò mới của agent), server cũ trả 404/503 thì bỏ qua.
6. `packages/crew-web/src/features/wizards/setup-progress.tsx` → `SetupProgress`: khung tiến độ dùng chung, "Chạy tiếp",
   báo người khác đang chạy, "Bỏ lần dở".
7. `packages/crew-web/src/features/wizards/machine-host.ts` → `machineHost`, `projectMachine`: suy host SSH và máy của
   project từ lần ghép máy và environment hiện có.
8. `packages/crew-web/src/features/readiness/use-readiness.ts` → `loadProjectReadiness`: ghép REST Paperclip
   (agent, environment, AGENTS.md) với data plugin (vai trò, máy, setup run), rồi `computeAgentReadiness`,
   `computeProjectReadiness` (`readiness/compute.ts`) tính bảng kiểm agent và project ở web vì plugin không đọc được
   bảng environment. `wizards/resume.ts` → `resumeHref` dựng link "Làm tiếp".

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `packages/crew-plugin/src/setup/api.ts` | Route tiến độ wizard | `handleSetupApi` |
| `packages/crew-plugin/src/setup/data.ts` | SQL setup run, khóa bước | `beginStep`, `finishStep`, `abandonSetupRun`, `listSetupRuns` |
| `packages/crew-plugin/src/setup/types.ts` | Loại run, bước, trạng thái | `SETUP_STEPS`, `SETUP_LOCK_MINUTES`, `setupStepsOf` |
| `packages/crew-web/src/api/crew/setup.ts` | Client route setup | `setupApi` |
| `packages/crew-web/src/features/wizards/routes.tsx` | Route bốn wizard | `routes` |
| `packages/crew-web/src/features/wizards/index.ts` | API công khai cho feature khác | |
| `packages/crew-web/src/features/wizards/setup-progress.tsx` | Khung tiến độ | `SetupProgress` |
| `packages/crew-web/src/features/wizards/resume.ts` | Link "Làm tiếp" | `resumeHref`, `findAgentRun` |
| `packages/crew-web/src/features/wizards/machine-host.ts` | Máy, host SSH, checkout của project | `machineHost`, `projectMachine`, `CHECKOUT_RE` |
| `packages/crew-web/src/features/wizards/add-project/` | Wizard thêm project (trang, bước, kiểm form, chờ việc) | `AddProjectPage`, `runAddProjectStep`, `validateAddProject`, `waitJob` |
| `packages/crew-web/src/features/wizards/add-agent/` | Wizard tạo agent | `AddAgentPage`, `runAddAgentStep`, `validateAddAgent`, `ADD_AGENT_STEPS` |
| `packages/crew-web/src/features/wizards/remove/remove-buttons.tsx` | Nút và hộp xác nhận gỡ | `RemoveProjectButton`, `RemoveAgentButton` |
| `packages/crew-web/src/features/wizards/remove/remove-pages.tsx` | Trang tiến độ gỡ | `RemoveProjectPage`, `RemoveAgentPage` |
| `packages/crew-web/src/features/wizards/remove/remove-project.ts` | Bước gỡ project | `runRemoveProject`, `REMOVE_PROJECT_STEPS` |
| `packages/crew-web/src/features/wizards/remove/remove-agent.ts` | Bước gỡ agent | `runRemoveAgent`, `REMOVE_AGENT_STEPS` |
| `packages/crew-web/src/features/wizards/remove/eligibility.ts` | Agent nào gỡ được | `removeAgentEligibility`, `rolesWithout` |
| `packages/crew-web/src/features/wizards/remove/exclusive-environments.ts` | Environment được archive | `exclusiveEnvironments` |
| `packages/crew-web/src/features/wizards/remove/` (còn lại) | Trạng thái gỡ, dữ liệu trước khi gỡ, lọc agent đã gỡ | `removalState`, `useRemovalImpact`, `useSelectableAgents` |
| `packages/crew-web/src/features/readiness/compute.ts` | Bảng kiểm sẵn sàng | `computeAgentReadiness`, `computeProjectReadiness` |
| `packages/crew-web/src/features/readiness/use-readiness.ts` | Ghép dữ liệu sẵn sàng | `loadProjectReadiness`, `useProjectReadiness` |
| `packages/crew-web/src/features/readiness/assistant-instructions.ts` | AGENTS.md có khớp template | `matchesRoleTemplate`, `matchesAssistantTemplate` |
| `packages/crew-web/src/features/readiness/index.ts` | Export | |
| `packages/crew-web/src/ds/widgets/crew/readiness-badge.tsx` | Nhãn sẵn sàng | `ReadinessBadge` |

## Dữ liệu

- Bảng plugin `crew_setup_runs` (`0007_setup_runs.sql`; `abandoned` ở `0009_setup_runs_abandon.sql`; loại gỡ ở
  `0011_removal_kinds.sql`).
- Route lõi Paperclip wizard gọi: project, agent, environment (tạo, PATCH trạng thái), AGENTS.md của agent.
- Route plugin khác: `jobs.create`/`jobs.list` (flow `machine-jobs`), `roles.set`/`roles.delete` (flow
  `project-roles`).

## Flow liên quan

- `machine-jobs`: việc trên máy mà wizard xếp và chờ.
- `project-roles`: wizard ghi và xóa vai trò theo project.
- `agent-roles`: template AGENTS.md theo vai trò mà wizard render.
- `model-settings`: bảng model mặc định và danh sách chọn của wizard.
- `multi-machine`: route Crew dọn máy khác khi gỡ (`machines/blockers`, `machines/release`).
- `machine-status`: dữ liệu máy và lần ghép dùng để chọn máy và host.
- `web-pages`: trang project và agent gắn nút gỡ và nhãn sẵn sàng.

## Tests

- `packages/crew-plugin/src/__tests__/setup-runs.db.test.ts`: chặn run dở cùng khóa, chặn agent, một bước một lúc,
  khóa hết hạn, bỏ lần dở.
- `packages/crew-web/test/api/setup-abandon.test.ts`: client gọi abandon đúng body.
- `packages/crew-web/test/features/wizards/add-project.test.ts`, `add-project-page.test.tsx`, `validate.test.ts`,
  `wait-job.test.ts`: đủ bước theo thứ tự, lỗi giữa chừng pause agent đã tạo và chạy tiếp không tạo lại, kiểm khóa
  (trùng, đã gỡ, `e2e-`), chờ việc.
- `packages/crew-web/test/features/wizards/add-agent.test.ts`, `add-agent-page.test.tsx`, `validate-add-agent.test.ts`,
  `repo-root.test.ts`: thêm executor, thay reviewer hay Trợ Lý, ô runtime và model, hỏi repo gốc từ máy; danh sách model và
  mặc định của ô theo bảng cài đặt model, chưa tải xong thì chưa cho tạo, tải lỗi thì `ErrorState`.
- `packages/crew-web/test/features/wizards/remove/`: điều kiện gỡ, environment được archive, trạng thái gỡ, bước gỡ
  project và agent (không DELETE, không terminate), dọn máy khác chỉ với agent đang trong dòng vai trò (Chạy tiếp sau khi
  thay agent ở ô, hay khi agent đã ra khỏi vai trò), nút và hộp xác nhận.
- `packages/crew-web/test/features/wizards/machine-host.test.ts`, `resume.test.ts`: suy host, link "Làm tiếp".
- `packages/crew-web/test/features/readiness/compute.test.ts`, `load.test.ts`,
  `packages/crew-web/test/ds/crew/readiness-badge.test.tsx`: từng mục kiểm sẵn sàng, ghép REST và plugin, nhãn.

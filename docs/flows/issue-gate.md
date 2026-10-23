# Cổng tạo và ghi issue (execution policy, vai trò, model)

> Flow `issue-gate`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow issue-gate` in ra đúng danh sách đó.

## Mục đích

Mỗi yêu cầu trong Crew phải đi qua cùng một quy trình: executor làm, reviewer duyệt, integrator gộp và kiểm docs,
owner duyệt, integrator push. Paperclip gốc đã có execution policy (stage `review`/`approval`) nhưng để agent tự đặt,
tự xóa hay tự ký. Flow này ghim policy Crew lúc tạo issue (H4) và kiểm mọi lệnh ghi issue (H2), để agent không lách
được quy trình, không tự giao việc sai vai trò và không đặt model ngoài bảng cho phép.

Luật áp theo company:

- Company không có trong file cấu hình (`CREW_POLICY_CONFIG` chưa đặt hoặc không có key company): hành vi Paperclip gốc.
- Company có mặt mà cấu hình lỗi: fail closed (agent không tạo, không xong việc được; board vẫn ép được).
- Cấu hình hợp lệ: vai trò reviewer/integrator, owner duyệt cuối và project theo dõi (`trackingProjectIds`). Vai trò
  theo project (bảng vai trò của flow `project-roles`) được ưu tiên hơn vai trò trong file.

## Điểm vào

- H4 trong `server/src/services/issues.ts` → `issueService.create`: gọi `crewCoreHooks.beforeIssueCreate`.
- H2 trong `server/src/services/issues.ts` → `issueService.update` (closure `runUpdate`): gọi
  `crewCoreHooks.beforeIssueWrite` trong cùng transaction với lệnh ghi.
- Mọi đường tạo/sửa issue (REST `POST /companies/:companyId/issues`, `PATCH /issues/:id`, MCP, plugin, routine,
  watchdog) đều đi qua hai hàm service này.

## Các bước

1. `server/src/crew/issue-policy.ts` → `loadCrewCompanyConfig`, `parseCrewPolicyConfig`: đọc lại file JSON ở mỗi lần
   gọi (sửa file có hiệu lực ngay). `reportCrewPolicyConfigAtStartup` cảnh báo lúc khởi động khi chưa đặt env.
2. `server/src/crew/issue-create-policy.ts` → `crewBeforeIssueCreate`, `decideCreatePolicy` (H4):
   - Agent chỉ tạo được issue con, cùng project với cha, không ở `done`/`cancelled`/`in_review`, không giao cho
     reviewer/integrator, giao việc theo luật Trợ Lý/executor của project (`agentAssignmentAllowed`), override chỉ model
     và effort. Mọi policy agent gửi bị thay bằng template con; con có dòng `crew-kind bmad` nhận template `bmad`.
   - Board gửi policy riêng thì giữ; không gửi thì nhận template theo loại: con, gốc, gốc có nhãn `research`. Issue
     gốc trong project theo dõi không nhận policy.
   - Hệ thống: issue watchdog/recovery giữ stock, trừ khi giao lại cho chính executor của issue nguồn; routine do agent
     tạo/sửa bị từ chối (`crew_routine_issue_forbidden`).
   - Issue con code mà executor không chạy Codex: `chooseChildReviewer` → `chooseReviewer` có thể đặt reviewer Codex
     đứng trước reviewer Claude trong stage review, khi công tắc `codex_local` trên máy reviewer Codex đang bật. Máy của
     reviewer Codex suy theo cây của issue cha (`issueId: data.parentId`) khi cây đã ghim máy (flow `multi-machine`).
3. `server/src/crew/issue-policy.ts` → `buildCrewPolicy`: dựng template đã normalize, `maxReviewRounds` là
   `CREW_MAX_REVIEW_ROUNDS` (5). Gốc: reviewer, integrator (merge + docs), owner, integrator (push). Research và bmad:
   reviewer, owner. Con: reviewer.
4. `server/src/crew/issue-gate.ts` → `crewBeforeIssueWrite` (H2): kiểm override model trước, rồi khi patch chạm
   `status`, `executionPolicy`, `executionState`, `assigneeAgentId` hoặc `projectId` thì khóa dòng issue, đọc vai trò
   (agent mà không đọc được bảng vai trò thì 503, không rơi về vai trò file), decision, activity mốc vòng, bằng chứng
   comment và việc con board thêm, rồi gọi `evaluateIssueGate`.
5. `server/src/crew/issue-gate.ts` → `evaluateIssueGate`: hàm thuần trả `allow`, `override` (board vượt cổng) hoặc
   `block` với mã. Luật chính:
   - agent không đổi project, không đổi hay xóa policy, không đổi participant (trừ hệ thống chuyển reviewer Codex sang
     reviewer Claude), không hủy việc (chỉ board hủy);
   - agent không giao cho reviewer/integrator, giao việc giữa agent đi qua Trợ Lý;
   - nộp issue gốc khi còn việc con board thêm chưa xong bị chặn (`board_child_open`);
   - vào `done` hay hoàn tất stage docs/push cần: mỗi stage có approval trong vòng hiện tại và không do người làm tự ký;
     stage docs (`docsGateStages`) cần comment `crew-docs-check` mới, `exit=0` (`exit=3` repo chưa init thì cho qua kèm
     activity); stage push (`pushGateStages`) cần comment `crew-merge` sau lần owner duyệt và đúng commit của bằng chứng
     docs.
6. `server/src/crew/issue-gate.ts` → phần sau verdict: mở lại issue Crew xóa `executionState` và trả việc cho executor
   (`reopenHandBack`); owner yêu cầu sửa ở stage owner thì chạy lại từ stage đầu (`restartAfterOwnerChanges`); board ép
   `done` xóa state treo; `routeAssigneeOverrides` đặt override theo vai trò khi đổi giữa executor và agent của stage
   (reviewer Codex `CREW_CODEX_REVIEWER_OVERRIDES`, reviewer Claude trên gốc `CREW_ROOT_REVIEWER_OVERRIDES`, executor
   lấy lại override để lại lần trước).
7. `server/src/crew/model-policy.ts` → `checkAgentAdapterOverrides`, `CREW_RUNTIME_CATALOG`, `CREW_RUNTIME_ORDER`,
   `CREW_MODEL_LINE_RE`: bảng model theo runtime và độ phức tạp, luật override của agent, marker `crew-model` Trợ Lý
   ghi trong mô tả issue con. Bảng này có bản chép ở plugin và crew-web, mỗi bản có test so khớp.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `server/src/crew/issue-gate.ts` | H2: kiểm lệnh ghi issue | `crewBeforeIssueWrite`, `evaluateIssueGate`, `docsGateStages`, `pushGateStages`, `restartAfterOwnerChanges`, `CREW_CYCLE_RESET_ACTION` |
| `server/src/crew/issue-create-policy.ts` | H4: chọn template, từ chối tạo sai luật | `crewBeforeIssueCreate`, `decideCreatePolicy`, `CREW_BMAD_KIND_RE`, `executorRuntimeOf` |
| `server/src/crew/issue-policy.ts` | File cấu hình, template policy, parser bằng chứng | `loadCrewCompanyConfig`, `buildCrewPolicy`, `parseCrewMergeEvidence`, `parseDocsCheckEvidence`, `CREW_HOUSEKEEPING_ORIGIN_KINDS` |
| `server/src/crew/model-policy.ts` | Bảng runtime/model, luật override, chọn reviewer | `CREW_RUNTIME_CATALOG`, `checkAgentAdapterOverrides`, `chooseReviewer`, `CREW_CODEX_REVIEWER_MODEL` |
| `server/src/services/issues.ts` | File upstream chứa H2, H4 | `issueService.create`, `issueService.update` |

## Dữ liệu

- Bảng lõi đọc: `issues` (khóa `for update`), `issue_execution_decisions`, `issue_comments` (bằng chứng), `activity_log`
  (mốc vòng), `agents`, `labels`, `routines`, `routine_triggers`. Ghi: chỉ cột của chính lệnh ghi issue
  (`executionPolicy`, `executionState`, `assigneeAgentId`, `assigneeAdapterOverrides`) và `activity_log`.
- Activity: `crew.gate.cycle_reset`, `crew.gate.owner_changes_restart`, `crew.gate.reopen_executor_unknown`,
  `crew.policy.board_override`, `crew.gate.codex_reviewer_fallback`, `crew.docs_gate.uninitialized`,
  `crew.assignee_overrides.handoff`.
- Lỗi trả về: 422 với `code` `crew_policy_locked`, `crew_project_locked`, `crew_gate_blocked`, `crew_role_assignee`,
  `crew_assignment_forbidden`, `crew_override_forbidden`, `crew_agent_root_issue`, `crew_roles_unconfigured`,
  `crew_project_outside_parent`, `crew_routine_issue_forbidden`.
- Comment bằng chứng (dòng đầu): `crew-docs-check commit=… range=…..… exit=N` (`CREW_DOCS_CHECK_RE`),
  `crew-merge sha=… branch=… pushed=yes|pr pr=<url>` (`CREW_MERGE_RE`).
- Env: `CREW_POLICY_CONFIG` (đường dẫn file JSON chỉ đọc; công cụ sửa ở flow `ops-tools`).

## Flow liên quan

- `core-hooks`: đăng ký H2, H4.
- `project-roles`: owner đặt vai trò agent theo project; `server/src/crew/project-roles.ts` đọc bảng đó cho server
  (`loadCrewRoles`, `agentAssignmentAllowed`).
- `runtime-switches`: công tắc `codex_local` quyết định có reviewer Codex.
- `runtime-fallback`: hệ thống đổi participant reviewer Codex sang reviewer Claude.
- `multi-machine`: máy ghim của cây quyết định máy (và công tắc `codex_local`) của reviewer Codex.
- `qc-department`: chạy ngay sau gate trong H2.
- `run-handoff`: vá C11/C12 cho run tự bàn giao issue của mình.
- `agent-roles`: template vai trò dạy agent viết đúng comment bằng chứng và marker.
- `ops-tools`: sửa file `CREW_POLICY_CONFIG`.

## Tests

- `server/src/__tests__/crew-issue-create-policy.test.ts`: các nhánh của `decideCreatePolicy` (agent, board, hệ
  thống, research, project theo dõi, bmad, override theo runtime, watchdog trả về executor).
- `server/src/__tests__/crew-issue-gate.test.ts`: parse file cấu hình (absent, invalid, hoa thường), đọc lại file mỗi
  lần, cảnh báo lúc khởi động, template policy, fingerprint policy, các nhánh của `evaluateIssueGate`.
- `server/src/__tests__/crew-issue-gate.db.test.ts`: H2 trên DB thật: chặn override, xóa policy, cancel, giao cho
  reviewer; board override ghi activity; mở lại issue không tính approval cũ; bằng chứng docs/push; luồng gốc bốn stage
  với push thẳng và pull request; override opus của reviewer gốc.
- `server/src/__tests__/crew-agent-assignment.db.test.ts`: luật giao việc ở H4 và H2 theo vai trò project, khóa
  project, 503 khi không đọc được vai trò, reviewer Codex và chuyển sang reviewer Claude đầu-cuối.
- `server/src/__tests__/crew-board-child.db.test.ts`: Trợ Lý không nộp gốc khi việc con board thêm chưa xong.
- `server/src/__tests__/crew-draft-start-work.db.test.ts`: chuyển `todo` lần hai không đánh thức thêm.
- `server/src/__tests__/crew-model-policy.test.ts`: bảng runtime/model khớp nguyên văn, luật override theo runtime,
  marker `crew-model`, `chooseReviewer`.

# Cổng tạo và ghi issue (execution policy, vai trò, model)

> Flow `issue-gate`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow issue-gate` in ra đúng danh sách đó.

## Mục đích

Mỗi yêu cầu trong Crew phải đi qua cùng một quy trình: executor làm, reviewer duyệt, integrator gộp và kiểm docs,
owner duyệt, integrator push. Paperclip gốc đã có execution policy (stage `review`/`approval`) nhưng để agent tự đặt,
tự xóa hay tự ký. Flow này ghim policy Crew lúc tạo issue (H4) và kiểm mọi lệnh ghi issue (H2), để agent không lách
được quy trình, không tự giao việc sai vai trò và không đặt model ngoài bảng cho phép.

Ticket tổng code/bug theo luồng Bug Finding (template `root-bf`, chỉ khi company bật `bugFinding.enabled` và project có
origin GitHub hoặc GitLab, xem luật GitLab ở bước 1) đi đường khác ở cấp gốc, không còn reviewer Claude:

```text
mọi con done → Trợ Lý PATCH done
  → [0] integrator: gộp sha đã duyệt, kiểm, crew-docs-check, mở/cập nhật PR (crew-pr)
  → [1] reviewer cầu nối: plugin xếp lượt Bug Finding cho head PR (flow bug-finding), reviewer đọc kết quả
        ├─ còn finding mở và còn lô sửa → "Reviewer: cần sửa" → Trợ Lý lập lô bf-fix-<k>, hỏi owner phần còn lại
        │     → mọi con của lô xong + mọi thẻ hỏi crew-bf: đã trả lời → Trợ Lý PATCH done → chạy lại từ [0]
        └─ hết finding mở, hoặc đã đủ 2 lô → [2]
  → [2] owner: Duyệt và merge, hoặc Yêu cầu sửa (vòng mới, chạy lại từ [0])
  → [3] integrator: gh pr merge đúng commit owner duyệt (crew-merge … pushed=merged) → done
```

Gate của từng stage và của lần Trợ Lý nộp lại ở bước 5 bên dưới; số lượt, hết giờ và bỏ qua Bug Finding ở flow
`bug-finding`. Ticket tổng tạo trước khi bật cờ, và ticket tổng nhãn `research`/`docs`/`plan`, giữ luồng cũ.

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
     và effort. Mọi policy agent gửi bị thay bằng template con; con có dòng `crew-kind bmad` nhận template `bmad`, con có dòng `crew-kind design`
     (mockup giao diện của agent UIUX) nhận template `design`. Hai marker chỉ xét sau mọi luật từ chối; thiếu owner trong
     cấu hình thì `crew_roles_unconfigured`.
   - Board gửi policy riêng thì giữ; không gửi thì nhận template theo loại: con, gốc, gốc có nhãn `research`. Issue
     gốc trong project theo dõi không nhận policy.
   - Ticket tổng code/bug theo luồng Bug Finding: board tạo gốc không nhãn `research`/`docs`/`plan` (`CREW_NON_CODE_LABELS`),
     company bật `bugFinding.enabled` và origin của project trong bảng plugin `project_repos` là GitHub hoặc GitLab
     (`originProvider`) thì nhận template `root-bf`; thiếu một điều kiện thì `root`. `originProvider` đọc host của
     origin dạng `https://<host>/…`, `git@<host>:…` hoặc `ssh://git@<host>[:cổng]/…` và so chính xác, không phân biệt hoa
     thường:
     - `github.com` → GitHub;
     - `gitlab.com` → GitLab, không cần khai báo;
     - GitLab tự host (ví dụ `gitlab.qasoftsolution.com`) chỉ là GitLab khi host có trong `bugFinding.gitlabHosts` của
       company trong file cấu hình Crew (cách khai báo ở mục "Env và cấu hình" bên dưới). Không đoán theo chữ "gitlab"
       trong host: host chưa khai báo, origin lạ, đường dẫn local hay rỗng → không GitHub/GitLab → `root` như cũ.
     Chỉ đọc `project_repos` khi cờ bật; đọc lỗi (plugin chưa cài) thì coi như không GitHub/GitLab, không chặn tạo
     issue. Gốc do hệ thống (routine) tạo vẫn nhận `root`.
   - Hệ thống: issue watchdog/recovery giữ stock, trừ khi giao lại cho chính executor của issue nguồn; routine do agent
     tạo/sửa bị từ chối (`crew_routine_issue_forbidden`).
   - Company có cấu hình Crew: `withProjectTag` gắn `[tên project]` vào đầu title của mọi issue mới có project (project
     ghi rõ hoặc thừa từ issue cha). Title đã mở đầu bằng đúng tag đó (không phân biệt hoa thường) hoặc title trống (lõi
     tự sinh từ mô tả) thì giữ. Issue cũ và lệnh đổi title, đổi project sau đó không đổi gì.
   - Issue con code mà executor không chạy Codex: `chooseChildReviewer` → `chooseReviewer` có thể đặt reviewer Codex
     đứng trước reviewer Claude trong stage review, khi công tắc `codex_local` trên máy reviewer Codex đang bật. Máy của
     reviewer Codex suy theo cây của issue cha (`issueId: data.parentId`) khi cây đã ghim máy (flow `multi-machine`).
3. `server/src/crew/issue-policy.ts` → `buildCrewPolicy`: dựng template đã normalize, `maxReviewRounds` là
   `CREW_MAX_REVIEW_ROUNDS` (5). Gốc: reviewer, integrator (merge + docs), owner, integrator (push). Gốc Bug Finding
   (`root-bf`): integrator (gộp + docs + PR), reviewer (cầu nối Bug Finding, không review code), owner, integrator
   (merge PR); gate của các stage này ở bước 5 (lượt Bug Finding đọc từ bảng `crew_bug_finding_runs` của plugin qua
   `readBugFindingRuns`, flow `bug-finding`; bảng chưa có thì stage cầu nối không qua được, nên chỉ bật
   `bugFinding.enabled` khi plugin có migration `0025` đã lên bản). Research, bmad và
   design: reviewer, owner (owner duyệt mockup trước khi con code giao diện bị chặn bởi nó được chạy). Con: reviewer.
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
     docs; `crew-merge` có `pr=<URL>` thì URL phải thuộc origin của project (`push_origin_mismatch`, luật ở gạch đầu dòng
     tiếp theo).
   - URL PR/MR của integrator (`crew-pr`, `crew-merge … pr=`) phải thuộc origin của project, không chỉ đúng định dạng
     (`prUrlMatchesOrigin` trong `issue-create-policy.ts`): host của URL trùng host origin trong `project_repos` (không
     phân biệt hoa thường, bỏ cổng); URL merge request GitLab còn phải ở `gitlab.com` hoặc host trong
     `bugFinding.gitlabHosts`, URL pull request GitHub ở `github.com`. Project chưa có origin (không có dòng
     `project_repos`, bảng chưa có hay đọc lỗi): PR GitHub giữ luật cũ, MR GitLab bị chặn. H2 chỉ đọc `project_repos`
     (`loadProjectOriginUrl`, kiểm `to_regclass` trước để không làm hỏng transaction) khi có bằng chứng mang URL.
   - ticket tổng Bug Finding (`isBugFindingRootPolicy`: 4 stage `review` integrator, `review` reviewer, `approval` owner,
     `review` integrator, nhận theo vị trí như `crewPolicyKind` `code-bf` của plugin): stage docs là stage 0 và
     `prGateStages` (stage 0) cần thêm `crew-pr sha=<merged commit> pr=<URL>` (URL pull request GitHub hoặc merge
     request GitLab, xem mục comment bằng chứng) mới hơn bằng chứng docs (`pr_missing`,
     `pr_sha_mismatch`), URL thuộc origin của project (`pr_origin_mismatch`); `bugFindingGateStages` (stage 1) cần lượt Bug Finding `succeeded` hoặc `skipped` cho đúng head PR
     (sha của `crew-pr` mới nhất), thiếu thì `bf_missing`; stage merge cần `crew-merge … pushed=merged pr=<URL>
     merge=<sha>` sau lần owner duyệt (`pushed=pr`/`yes` hay cũ hơn owner: `merge_missing`), đúng commit của bằng
     chứng docs (`push_sha_mismatch`), URL thuộc origin (`push_origin_mismatch`) và trùng URL của `crew-pr` mới nhất
     (`merge_pr_mismatch`);
   - Trợ Lý nộp lại ticket tổng Bug Finding khi lô `bf-fix-<k>` mới nhất (comment `crew-bf-triage run=<n>
     batch=bf-fix-<k>` mới nhất của chính agent nộp) còn con chưa xong (mô tả có `crew-child … revision=bf-fix-<k>` hoặc
     `crew-bf finding=… run=<n>`, chưa `done`/`cancelled`) bị chặn `bf_batch_open`; còn thẻ `ask_user_questions`
     `pending` có `idempotencyKey` bắt đầu `crew-bf:` bị chặn `bf_questions_open`.
6. `server/src/crew/issue-gate.ts` → phần sau verdict: mở lại issue Crew xóa `executionState` và trả việc cho executor
   (`reopenHandBack`); owner yêu cầu sửa ở stage owner, hay reviewer cầu nối yêu cầu sửa ở stage Bug Finding
   (`bugFindingRestartStages`), thì chạy lại từ stage đầu (`restartAfterOwnerChanges`; activity
   `crew.gate.owner_changes_restart` hoặc `crew.gate.bug_finding_restart`, cả hai làm bằng chứng docs cũ đi; owner yêu
   cầu sửa ticket tổng Bug Finding thì `bumpBugFindingRound` tăng vòng trong `crew_bug_finding_rounds` để plugin đếm lại
   lượt và lô sửa từ đầu); board ép
   `done` xóa state treo; `routeAssigneeOverrides` đặt override theo vai trò khi đổi giữa executor và agent của stage
   (reviewer Codex theo vai `reviewer-codex`, reviewer Claude trên gốc theo vai `reviewer-root` của cài đặt model,
   dựng bằng `codexReviewerOverrides`/`rootReviewerOverrides`; executor lấy lại override để lại lần trước nếu còn hợp
   với catalog hiện hành).
7. `server/src/crew/model-policy.ts` → `checkAgentAdapterOverrides`, `CREW_RUNTIME_CATALOG`, `CREW_RUNTIME_ORDER`,
   `CREW_MODEL_LINE_RE`: luật override của agent (kiểm theo catalog truyền vào), bảng model mặc định theo runtime và độ
   phức tạp, marker `crew-model` Trợ Lý ghi trong mô tả issue con. H2 và H4 truyền catalog hiện hành từ
   `loadModelSettings` (flow `model-settings`, cache 60 giây, đọc trong savepoint; đọc lỗi thì dùng cache hoặc mặc
   định, không làm hỏng lệnh ghi issue); chưa ai lưu bản nào thì catalog là bảng mặc định này. Plugin giữ bản chép mặc
   định, có test so khớp.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `server/src/crew/issue-gate.ts` | H2: kiểm lệnh ghi issue | `crewBeforeIssueWrite`, `evaluateIssueGate`, `docsGateStages`, `pushGateStages`, `prGateStages`, `bugFindingGateStages`, `bugFindingRestartStages`, `setBugFindingRunReader`, `restartAfterOwnerChanges`, `CREW_CYCLE_RESET_ACTION` |
| `server/src/crew/issue-create-policy.ts` | H4: chọn template, từ chối tạo sai luật | `crewBeforeIssueCreate`, `decideCreatePolicy`, `CREW_BMAD_KIND_RE`, `CREW_DESIGN_KIND_RE`, `executorRuntimeOf`, `withProjectTag` |
| `server/src/crew/issue-policy.ts` | File cấu hình, template policy, parser bằng chứng | `loadCrewCompanyConfig`, `buildCrewPolicy`, `parseCrewMergeEvidence`, `parseCrewPrEvidence`, `parseBugFindingTriage`, `parseDocsCheckEvidence`, `CREW_HOUSEKEEPING_ORIGIN_KINDS` |
| `server/src/crew/model-policy.ts` | Bảng runtime/model mặc định, luật override, chọn reviewer | `CREW_RUNTIME_CATALOG`, `CREW_RUNTIME_ORDER`, `checkAgentAdapterOverrides`, `chooseReviewer`, `CREW_CODEX_REVIEWER_MODEL` |
| `server/src/services/issues.ts` | File upstream chứa H2, H4 | `issueService.create`, `issueService.update` |

## Dữ liệu

- Bảng lõi đọc: `issues` (khóa `for update`), `issue_execution_decisions`, `issue_comments` (bằng chứng), `activity_log`
  (mốc vòng), `agents`, `labels`, `routines`, `routine_triggers`, `issue_thread_interactions` (thẻ hỏi `crew-bf:` của
  ticket tổng Bug Finding). Ghi: chỉ cột của chính lệnh ghi issue
  (`executionPolicy`, `executionState`, `assigneeAgentId`, `assigneeAdapterOverrides`) và `activity_log`.
- Activity: `crew.gate.cycle_reset`, `crew.gate.owner_changes_restart`, `crew.gate.bug_finding_restart`, `crew.gate.reopen_executor_unknown`,
  `crew.policy.board_override`, `crew.gate.codex_reviewer_fallback`, `crew.docs_gate.uninitialized`,
  `crew.assignee_overrides.handoff`.
- Lỗi trả về: 422 với `code` `crew_policy_locked`, `crew_project_locked`, `crew_gate_blocked`, `crew_role_assignee`,
  `crew_assignment_forbidden`, `crew_override_forbidden`, `crew_agent_root_issue`, `crew_roles_unconfigured`,
  `crew_project_outside_parent`, `crew_routine_issue_forbidden`.
- Comment bằng chứng (dòng đầu): `crew-docs-check commit=… range=…..… exit=N` (`CREW_DOCS_CHECK_RE`),
  `crew-merge sha=… branch=… pushed=yes|pr pr=<url>|merged pr=<url> merge=<sha>` (`CREW_MERGE_RE`),
  `crew-pr sha=… pr=<url>` (`CREW_PR_RE`), `crew-bf-triage run=<n> batch=bf-fix-<k> …` (`CREW_BF_TRIAGE_RE`).
  `<url>` của `crew-merge`/`crew-pr` là pull request GitHub `https://github.com/<owner>/<repo>/pull/<n>` hoặc merge
  request GitLab `https://<host>[:cổng]/<nhóm>[/<nhóm con>…]/<repo>/-/merge_requests/<iid>` (gitlab.com hoặc tự host,
  github.com ở mọi kiểu hoa thường không phải host GitLab), số `<n>`/`<iid>` tối đa 10 chữ số; cùng luật với `parsePrUrl`
  của plugin (`packages/crew-plugin/src/jobs/pr-url.ts`). Regex chỉ kiểm định dạng; host được đối chiếu với origin của
  project ở `evaluateIssueGate` (bước 5: `pr_origin_mismatch`, `push_origin_mismatch`, `merge_pr_mismatch`). `readBugFindingRuns`
  (`bug-finding-runs.ts`) chỉ đọc `head_sha` và `state` của lượt, không đọc URL nên không phụ thuộc provider.
- Env và cấu hình: `CREW_POLICY_CONFIG` (đường dẫn file JSON chỉ đọc; công cụ sửa ở flow `ops-tools`). Mỗi company trong
  file có thể có `bugFinding: { enabled?: boolean, gitlabHosts?: string[] }`: `enabled` mặc định tắt; `gitlabHosts`
  mặc định rỗng, là danh sách host GitLab tự host, chỉ tên host (không scheme, cổng, `user@` hay đường dẫn), lưu chữ
  thường. Phần tử sai dạng (ví dụ `gitlab.corp.vn:2222`, `https://…`) hay giá trị không phải mảng bị bỏ và ghi log error
  một lần (`companyId`, `droppedHosts`); phần còn lại của cấu hình company vẫn có hiệu lực, không thành `invalid`. Sai
  kiểu của `bugFinding` hay `enabled` vẫn làm cấu hình `invalid`. Khai báo GitLab tự host cho business-app:

  ```json
  { "companies": { "<companyId>": { "…": "…",
    "bugFinding": { "enabled": true, "gitlabHosts": ["gitlab.qasoftsolution.com"] } } } }
  ```

  Server đọc lại file ở mỗi lần tạo issue nên không cần khởi động lại; chỉ ticket tổng tạo sau khi sửa mới nhận
  `root-bf` (policy chốt lúc tạo).
- Bảng plugin đọc ở H4: `project_repos.origin_url` (chỉ khi company bật Bug Finding). H2 đọc cùng cột khi có bằng chứng
  `crew-pr`/`crew-merge` mang URL, để đối chiếu host.

## Flow liên quan

- `core-hooks`: đăng ký H2, H4.
- `model-settings`: owner sửa catalog và mặc định vai; H2/H4 đọc catalog và override reviewer từ đó.
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
  thống, research, project theo dõi, bmad, design, override theo runtime, watchdog trả về executor), `withProjectTag` và tag
  `[tên project]` trên title qua `issueService.create`; `root-bf` (template, cờ, nhãn docs/plan, origin GitHub/GitLab,
  `originProvider` với GitHub, gitlab.com, GitLab tự host có và không khai báo, origin lạ, rỗng; `bugFinding.enabled` và
  `bugFinding.gitlabHosts` trong file cấu hình, phần tử sai dạng bị bỏ kèm log) cả hàm thuần lẫn qua `issueService.create`
  với `project_repos`; `prUrlMatchesOrigin` (host trùng origin không phân biệt hoa thường, host lạ, GitLab chưa khai báo,
  origin chưa biết).
- `server/src/__tests__/crew-issue-gate.test.ts`: parse file cấu hình (absent, invalid, hoa thường), đọc lại file mỗi
  lần, cảnh báo lúc khởi động, template policy, fingerprint policy, các nhánh của `evaluateIssueGate` (kể cả
  `push_origin_mismatch` của `crew-merge pushed=pr`); parse URL PR/MR (github.com viết hoa không là GitLab, số quá 10
  chữ số bị từ chối).
- `server/src/__tests__/crew-issue-gate.db.test.ts`: H2 trên DB thật: chặn override, xóa policy, cancel, giao cho
  reviewer; board override ghi activity; mở lại issue không tính approval cũ; bằng chứng docs/push; luồng gốc bốn stage
  với push thẳng và pull request; override opus của reviewer gốc; ticket tổng `root-bf` với project có origin trong
  `project_repos`: `crew-pr` host lạ/chưa khai báo bị chặn `pr_origin_mismatch`, `crew-merge` URL khác `crew-pr`
  (`merge_pr_mismatch`) hay host lạ (`push_origin_mismatch`) bị chặn.
- `server/src/__tests__/crew-model-settings.db.test.ts` (flow `model-settings`): H2/H4 nhận model vừa thêm, chặn model
  vừa gỡ, override reviewer Codex và reviewer gốc theo `roles`, đọc bảng lỗi không làm hỏng lệnh ghi.
- `server/src/__tests__/crew-agent-assignment.db.test.ts`: luật giao việc ở H4 và H2 theo vai trò project, khóa
  project, 503 khi không đọc được vai trò, reviewer Codex và chuyển sang reviewer Claude đầu-cuối.
- `server/src/__tests__/crew-board-child.db.test.ts`: Trợ Lý không nộp gốc khi việc con board thêm chưa xong.
- `server/src/__tests__/crew-draft-start-work.db.test.ts`: chuyển `todo` lần hai không đánh thức thêm.
- `server/src/__tests__/crew-model-policy.test.ts`: bảng runtime/model mặc định khớp nguyên văn, luật override theo
  runtime và theo catalog truyền vào, marker `crew-model`, `chooseReviewer`.

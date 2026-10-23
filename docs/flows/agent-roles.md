# Template vai trò agent (AGENTS.md) và áp vai trò

> Flow `agent-roles`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow agent-roles` in ra đúng danh sách đó.

## Mục đích

Mỗi agent Crew làm đúng một vai trò: Trợ Lý (lập kế hoạch, tách việc con, chọn runtime và model), executor (làm việc
con), reviewer (duyệt), integrator (gộp, kiểm docs, giao code sau khi owner duyệt), agent BMAD (lập epic/story). Cách
làm của từng vai trò nằm trong file `AGENTS.md` của agent, sinh từ template `crew/agents/<vai trò>.md`. Template là nơi
duy nhất dạy agent các luật mà server kiểm (flow `issue-gate`): dòng bằng chứng `crew-docs-check`, `crew-merge`, marker
`crew-model`, `crew-bundle`, `crew-kind`, mục "Không bao giờ", cách xử lý 422.

Vai trò không lưu trên agent: server đọc reviewer, integrator, owner từ file `CREW_POLICY_CONFIG` và vai trò theo project
từ plugin. Áp vai trò cho agent gồm hai việc: upload `AGENTS.md` và ghim Superpowers (hoặc BMAD) trong
`adapterConfig.extraArgs`, với wrapper đúng runtime (`crew-claude-run`, `crew-codex-run`, `crew-opencode-run`).

Có hai đường áp, cho cùng kết quả từng byte:

- `crew/agents/apply-roles.sh` gọi REST API của board qua `api.sh` của server.
- crew-web (`packages/crew-web/src/lib/instructions/`) khi owner tạo agent, sửa vai trò project hay sửa hướng dẫn trên web.
  Template được nhúng nguyên văn lúc build (`?raw`), và `render.ts` là bản port TypeScript của `render-instructions.mjs`;
  test chạy script gốc để so.

## Loại yêu cầu Lập kế hoạch (`plan`)

Giống loại `docs`: loại chỉ là nhãn Paperclip `plan` trên issue gốc 4 stage, con mang dòng `crew-kind plan`; server không
đổi template hay gate. Marker và hành vi các template dạy:

- Trợ Lý (`assistant.md`): làm rõ mục tiêu, ràng buộc, ngoài phạm vi, tiêu chí; điểm repo không trả lời được thì bắt buộc
  hỏi owner bằng thẻ `ask_user_questions` và chờ trước khi tạo con. Chỉ tạo con `crew-kind plan` (thường một), không con
  code, không con E2E, mô tả con chép đủ câu trả lời của owner. Tổng kết gốc có mục `### Kế hoạch` với dòng
  `- File kế hoạch: \`<path>\``, lấy từ dòng `crew-plan-file path=<path>` mới nhất trong các comment của con. Yêu cầu Code có dòng
  `crew-from-plan <path>`: đọc plan trên `origin/HEAD` (thiếu file thì hỏi owner merge pull request kế hoạch), tách con
  theo các bước của plan, không brainstorm lại phạm vi đã chốt.
- Executor (`executor.md`): làm như issue tài liệu; đặt file theo quy ước repo, mặc định `plans/<yymmdd-hhmm>-<slug>/plan.md`
  và `docs/superpowers/specs/<yyyy-mm-dd>-<slug>-design.md`; brainstorm tự trả lời rồi `writing-plans`; plan có mục tiêu,
  phạm vi, tiêu chí, các bước kèm file và lệnh kiểm, rủi ro, giả định; dòng `crew-plan-file path=<path>` nằm trong comment `Executor: xong ...` cuối cùng, không chen vào comment `crew-commit`.
- Reviewer (`reviewer.md`): diff chỉ file plan/spec (cho thêm file chỉ mục/docs mà quy ước repo đòi khi thêm plan), kiểm đủ mục, bước cụ thể, bám câu trả lời của owner; gốc kế hoạch
  không đòi con E2E.
- Integrator (`integrator.md`): không đòi con E2E cho gốc nhãn `plan`; đường pull request giữ nguyên.

## Điểm vào

- `crew/agents/apply-roles.sh agent <agentId> <vai trò> <thư mục ghim> [...]` với vai trò `assistant`, `executor`,
  `reviewer`, `integrator`, `bmad`, `executor-codex`, `executor-opencode`, `reviewer-codex`. Trợ Lý nhận thêm danh sách
  executor (`<uuid>[:runtime]`), danh sách agent BMAD và reviewer Codex.
- `crew/agents/apply-roles.sh policy-config <companyId> <reviewer> <integrator> <ownerUserId> [file] [--tracking …]`:
  in hoặc gộp mục company vào file `CREW_POLICY_CONFIG` (server đọc lại file ở mỗi lệnh ghi được kiểm, không cần khởi
  động lại).
- crew-web: `packages/crew-web/src/lib/instructions/index.ts` được dùng bởi tab vai trò project, tab hướng dẫn agent,
  chọn model, wizard và kiểm sẵn sàng.

## Các bước

1. `crew/agents/apply-roles.sh`: đọc file `AGENTS.md` hiện tại trước khi ghi bất cứ gì; upload template đã render kèm
   `baseHash` (`add-base.mjs`); rồi PATCH `extraArgs` (`merge-agent-config.mjs`); kiểm phản hồi của cả hai lệnh ghi
   (`verify-result.mjs`), vì `api.sh` có thể thoát 0 khi HTTP lỗi. Ô runtime phải khớp `adapterType` của agent.
2. `crew/agents/render-instructions.mjs` → `renderInstructions`: Trợ Lý được nối mục danh sách executor (kèm runtime),
   agent BMAD và reviewer Codex; vai trò khác giữ nguyên văn template. Từ chối id sai, trùng nhau hay trùng chính Trợ Lý.
3. `crew/agents/merge-agent-config.mjs`: dựng body PATCH ghim Superpowers hay BMAD; chỉ Claude nhận `--plugin-dir`, Codex
   và OpenCode đọc bản ghim qua `CREW_SUPERPOWERS_DIR` do wrapper đặt. Agent Codex phải có `CODEX_HOME` ngoài thư mục
   company do server quản lý và không mang `OPENAI_API_KEY`.
4. `crew/agents/add-base.mjs` → `addBase`: `baseHash` là `contentHash` của file hiện tại hoặc `null` khi chưa có; lỗi
   khác thì dừng, không đoán.
5. `crew/agents/policy-config.mjs` → `buildPolicyConfig`: ghi mục company (id viết thường, thay key khác hoa thường),
   giữ company khác, từ chối file cũ hỏng thay vì ghi đè; `--tracking` đặt `trackingProjectIds`.
6. `packages/crew-web/src/lib/instructions/render.ts` → `renderInstructions`, `renderAssistantFor`, `assistantListsOf`,
   `assistantListsMatch`: render và đọc lại danh sách trong `AGENTS.md` của Trợ Lý theo vai trò project.
7. `packages/crew-web/src/lib/instructions/put.ts` → `putInstructions`: GET lấy `contentHash` rồi PUT với `baseHash`;
   server trả 409 thì báo xung đột, không ghi đè, không thử lại; nội dung không đổi thì không PUT.
8. `packages/crew-web/src/lib/instructions/agent-config.ts` → `crewAgentCreateBody`, `crewRuntimeConfigOf`,
   `crewExtraArgsOf`, `crewWrapperCommand`, `CREW_ROLE_SLOTS`, `CREW_RUNTIME_MODELS`: cấu hình agent Crew tạo từ web, cùng
   giá trị với app Mac và với `merge-agent-config.mjs`.
9. `packages/crew-web/src/lib/instructions/templates.ts` → `INSTRUCTION_TEMPLATES`: năm template nhúng nguyên văn.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `crew/agents/assistant.md` | Template Trợ Lý | (markdown) |
| `crew/agents/executor.md` | Template executor (cả Codex, OpenCode) | (markdown) |
| `crew/agents/reviewer.md` | Template reviewer (cả Codex) | (markdown) |
| `crew/agents/integrator.md` | Template integrator, kèm script mở pull request | (markdown) |
| `crew/agents/bmad.md` | Template agent BMAD | (markdown) |
| `crew/agents/apply-roles.sh` | Áp vai trò và ghi cấu hình Crew | lệnh `agent`, `policy-config` |
| `crew/agents/render-instructions.mjs` | Render `AGENTS.md` | `renderInstructions` |
| `crew/agents/merge-agent-config.mjs` | Body PATCH ghim Superpowers/BMAD | (script) |
| `crew/agents/add-base.mjs` | Thêm `baseHash` cho upload | `addBase` |
| `crew/agents/policy-config.mjs` | Dựng file `CREW_POLICY_CONFIG` | `buildPolicyConfig` |
| `crew/agents/verify-result.mjs` | Kiểm phản hồi API sau khi ghi | `checkPatchResult` |
| `packages/crew-web/src/lib/instructions/index.ts` | Export của thư viện | (re-export) |
| `packages/crew-web/src/lib/instructions/agent-config.ts` | Cấu hình agent Crew phía web | `crewAgentCreateBody`, `CREW_ROLE_SLOTS`, `CREW_RUNTIME_MODELS`, `slotOfAgent` |
| `packages/crew-web/src/lib/instructions/render.ts` | Bản port của render | `renderInstructions`, `renderAssistantFor`, `assistantListsOf` |
| `packages/crew-web/src/lib/instructions/put.ts` | Ghi `AGENTS.md` có kiểm xung đột | `putInstructions`, `INSTRUCTIONS_PATH` |
| `packages/crew-web/src/lib/instructions/templates.ts` | Template nhúng nguyên văn | `INSTRUCTION_TEMPLATES` |

## Dữ liệu

- Ghi qua REST API của board: file `AGENTS.md` trong instructions bundle của agent
  (`PUT …/instructions-bundle/file`, cần `baseHash`), `PATCH /agents/:id` (`adapterConfig`), tạo agent.
- File `CREW_POLICY_CONFIG` (dạng `{ "companies": { "<companyId>": { reviewerAgentId, integratorAgentId, ownerUserId,
  trackingProjectIds? } } }`), giữ bản `.bak` khi gộp.
- Agent chỉ được sửa hướng dẫn qua board: agent tự ghi bị chặn (flow `agent-guards`).

## Flow liên quan

- `issue-gate`: luật server mà template dạy agent tuân theo; đọc file cấu hình do `policy-config` sinh.
- `agent-guards`: chặn agent tự sửa hướng dẫn, quyền hay cấu hình.
- `project-roles`: vai trò project quyết danh sách trong `AGENTS.md` của Trợ Lý trên web.
- `setup-wizards`: wizard thêm agent, thêm project dùng `crewAgentCreateBody` và `putInstructions`.
- `ops-tools`: `agent-permissions.sh` đặt quyền đi kèm vai trò.
- `ops-deploy`: template integrator dạy agent gọi auto-deploy.

## Tests

- `crew/agents/instructions.test.mjs`: luật chung của mọi template (cấm xóa đệ quy ngoài thư mục tạm), dòng mẫu
  `crew-docs-check`, `crew-merge`, `crew-fix`, `crew-commit`, `crew-review` khớp định dạng và regex của server, cách
  integrator nhận diện stage. Loại yêu cầu Lập kế hoạch: Trợ Lý nhận bằng nhãn `plan`, hỏi owner trước khi tạo con, chỉ tạo con `crew-kind plan`
  và ghi `- File kế hoạch:` trong tổng kết; executor, reviewer, integrator có luật tương ứng.
- `crew/agents/integrator-pr.test.mjs`: script mở pull request của integrator: mở mới, dùng lại, đã merge, origin không
  ở GitHub, `gh` chưa đăng nhập, nhánh đã đi khác (không `--force`), lỗi tạo PR có credential bị che, đầu vào sai.
- `crew/agents/apply-roles.test.mjs`: thứ tự đọc → upload → PATCH, dừng trước khi ghi khi không đọc được, vai trò BMAD và
  ô runtime, sai `adapterType` hay thiếu `CODEX_HOME`.
- `crew/agents/render-instructions.test.mjs`, `merge-agent-config.test.mjs`, `add-base.test.mjs`,
  `policy-config.test.mjs`, `verify-result.test.mjs`: từng script phụ trợ.
- `packages/crew-web/test/lib/instructions/render.test.ts`: bản port khớp từng byte với script gốc và template nhúng khớp
  file trong `crew/agents/`.
- `packages/crew-web/test/lib/instructions/assistant-lists.test.ts`: đọc lại và render danh sách của Trợ Lý theo vai trò
  project.
- `packages/crew-web/test/lib/instructions/put.test.ts`: `baseHash`, không PUT khi không đổi, 409 thành xung đột.
- `packages/crew-web/test/lib/instructions/agent-config.test.ts`: wrapper, `extraArgs`, body tạo agent qua được schema của
  server, hằng số cùng giá trị với app và server.
- `packages/crew-web/test/lib/instructions/catalog-copy.test.ts`: bản chép bảng model ở crew-web khớp bản server.

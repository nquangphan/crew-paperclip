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

## Bảng model của Trợ Lý

`assistant.md` không nhúng id model, effort hay cờ ảnh. Owner sửa bảng trong Cài đặt model (flow `model-settings`), nên mỗi
run cần chọn model thì Trợ Lý đọc bảng hiện hành bằng `curl -fsS -H "Authorization: Bearer $PAPERCLIP_API_KEY"
"$PAPERCLIP_API_URL/api/crew/model-settings"` (bước 0 của mục "Chọn runtime và model"). Template chỉ giữ bảng "Khi nào"
(mức `complexity` cho loại việc nào), luật chọn runtime và dạng override của từng runtime. Từ JSON trả về Trợ Lý lấy
`settings.order.<mức>`, `settings.catalog.<runtime>.byComplexity.<mức>`, `…models.<id>.vision` và `…effortKey`. Lệnh đọc lỗi
thì Trợ Lý comment `Trợ Lý: không đọc được bảng model (<lỗi>)` trên gốc rồi dừng, không đoán model và không tạo con; lần đánh
thức sau thử lại. Khi server trả `crew_override_forbidden`, Trợ Lý đọc lại bảng (owner có thể vừa lưu) rồi tạo lại con. Vì
`AGENTS.md` không còn chứa bảng, đổi bảng không cần render lại hay upload lại `AGENTS.md`.

## Tổng kết của Trợ Lý trên mô tả gốc

Mục `## Tổng kết của Trợ Lý` ở cuối mô tả gốc là chỗ owner đọc để nắm cả yêu cầu. Luật nằm ở mục "Tổng kết trên mô tả gốc" của
`assistant.md`:

- Có từ run đầu có kế hoạch (chưa có kế hoạch thì chưa có tổng kết, kể cả khi run dừng sớm để hỏi owner). Mỗi run sau, nếu
  có gì đổi, Trợ Lý `GET` lại mô tả ngay trước lệnh ghi cuối, sửa mọi chỗ không còn khớp rồi gửi `description` mới trong chính
  `PATCH` ghi cuối của run (cùng `comment`, và `status` nếu có); không `PATCH` mô tả riêng.
- Thu đủ dữ liệu (con, file đính kèm) và soạn xong tổng kết trước, rồi mới `GET` mô tả và ghi ngay, không gọi API nào
  giữa hai bước, để không đè chữ owner vừa sửa. Chữ owner gõ sau tổng kết (ngoài khung) được chép nguyên văn lên trên tổng kết.
- Thứ tự mục: `### Yêu cầu`, `### Việc con` (`- <identifier> · <việc> · <trạng thái tiếng Việt>`), `### Kết quả`,
  `### Hình ảnh`, `### Đã tự quyết định`, `### Kế hoạch` (chỉ yêu cầu lập kế hoạch), `### Cần owner quyết định`. Ảnh lấy từ
  `GET /api/issues/<id con>/attachments` (chỉ `image/*`, tối đa khoảng 8), chèn `![tên (identifier)](/api/attachments/<id>/content)`.
- Phần phía trên tổng kết giữ nguyên từng ký tự; luôn thay cả mục, không thêm mục thứ hai; mục con `### Merge request` do
  integrator thêm được chép lại vào cuối bản mới.
- Integrator lấy tổng kết làm nội dung PR nhưng bỏ mục con `### Hình ảnh` (link ảnh là đường dẫn tương đối của Crew, GitHub không mở
  được) và `### Merge request`; mô tả issue vẫn giữ nguyên mục Hình ảnh.

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
   `crewExtraArgsOf`, `crewWrapperCommand`, `CREW_ROLE_SLOTS`: cấu hình agent Crew tạo từ web, cùng dạng với app Mac và
   với `merge-agent-config.mjs`. Danh sách model chọn được, model và effort mặc định của ô (`crewModelsOf`, `slotModels`,
   `defaultModelOf`, `defaultEffortOf`, `isCrewModel`) lấy từ `settings` của bảng cài đặt model (flow `model-settings`),
   không còn bản chép model nào trong file này; `crewAgentCreateBody` nhận `settings`, từ chối model ngoài catalog của ô
   và ghi effort của vai vào key effort của runtime. `crewModelsOf` trả id đã sắp tăng dần kiểu natural sort qua
   `sortModelIds` (`localeCompare` với `numeric: true`), vì thứ tự khóa `jsonb` của bảng đã lưu không ổn định; mọi danh
   sách model (wizard, ô chọn model, trang Cài đặt model) đi qua hàm này.
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
| `packages/crew-web/src/lib/instructions/agent-config.ts` | Cấu hình agent Crew phía web | `crewAgentCreateBody`, `CREW_ROLE_SLOTS`, `slotModels`, `defaultModelOf`, `slotOfAgent` |
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
  và ghi `- File kế hoạch:` trong tổng kết; executor, reviewer, integrator có luật tương ứng. Tổng kết của Trợ Lý: có từ lúc lập kế hoạch, đủ mục Yêu cầu/Việc con/Hình ảnh theo thứ tự, cập nhật mỗi run bằng `PATCH` ghi cuối, giữ `### Merge request`. Bảng model: `assistant.md` không chứa id model nào, có đúng lệnh `curl` đọc bảng cùng bốn đường dẫn JSON và đường lui khi lệnh lỗi.
- `crew/agents/integrator-pr.test.mjs`: script mở pull request của integrator: mở mới, dùng lại, đã merge, origin không
  ở GitHub, `gh` chưa đăng nhập, nhánh đã đi khác (không `--force`), lỗi tạo PR có credential bị che, đầu vào sai. Nội dung PR bỏ mục `### Hình ảnh` của tổng kết.
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
  server, hằng số cùng giá trị với app và server, danh sách và model mặc định theo `settings`.
- `packages/crew-web/test/lib/instructions/catalog-copy.test.ts`: các hàm thuần (`crewModelsOf`, `slotModels`,
  `defaultModelOf`, `defaultEffortOf`, `crewAgentCreateBody`) với bảng mẫu: bảng mặc định cho kết quả như các hằng số cũ,
  bảng do owner sửa đổi danh sách và mặc định; danh sách model sắp theo id, không theo thứ tự khóa; bảng mẫu của test khớp catalog và thứ tự mặc định của server; `src` không
  còn id model ghi cứng.

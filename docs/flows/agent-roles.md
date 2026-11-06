# Template vai trò agent (AGENTS.md) và áp vai trò

> Flow `agent-roles`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow agent-roles` in ra đúng danh sách đó.

## Mục đích

Mỗi agent Crew làm đúng một vai trò: Trợ Lý (lập kế hoạch, tách việc con, chọn runtime và model), executor (làm việc
con), reviewer (duyệt), integrator (gộp, kiểm docs, giao code sau khi owner duyệt), agent BMAD (lập epic/story), agent UIUX (vai `designer`,
làm mockup giao diện trước con code). Trên ticket tổng Bug Finding (`code-bf`, mục bên dưới) vai trò đổi: integrator mở PR
trước khi owner duyệt và tự merge sau khi owner duyệt, reviewer chỉ làm cầu nối Bug Finding (không đọc code), Trợ Lý phân
loại finding và lập lô sửa, executor làm con sửa finding. Cách
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

## Luật chung: không chạy nền rồi kết thúc lượt

Mục "Không bao giờ" của cả 6 template (`executor`, `reviewer`, `integrator`, `assistant`, `designer`, `bmad`) có cùng một đoạn
cấm chạy lệnh ở chế độ nền rồi kết thúc lượt, đứng ngay sau đoạn cấm xóa đệ quy (đoạn không đánh số, nên số mục không đổi).
Các vai biến thể `executor-codex`, `executor-opencode` (template `executor`) và `reviewer-codex` (template `reviewer`) dùng chung
template nên có luật này, không có file riêng. Đoạn giống hệt nhau ở mọi file vì `render-instructions.mjs` không có cơ chế phần chung.

Nội dung: mọi lệnh (test, build, E2E, simulator) chạy tiền cảnh và đọc kết quả trong cùng lượt, không dùng `run_in_background`
hay Monitor của công cụ agent, không kết thúc lượt để "chờ thông báo" của lệnh nền; một lệnh tối đa 10 phút (việc dài thì tách
từng flow/spec, mỗi phần một lệnh có timeout). Cần tiến trình phụ (dev server cho E2E) thì tự bật bằng `&` trong lượt, ghi
`$!`, dùng xong và tắt theo PID trước khi kết thúc lượt (khớp mục "Không bao giờ" về dọn process và luồng E2E của executor).

Cách hiểu thống nhất (Bug Finding lượt 1 của TPS-741, sửa ở TPS-757): luật chỉ cấm bỏ **lệnh nền của chính run** rồi kết thúc
lượt, vì lệnh nền không đánh thức lại agent. Luật không cấm dừng chờ **server** đánh thức theo luồng của vai: reviewer chờ kết
quả Bug Finding (`reviewer.md`, kết thúc run không đổi status), reviewer/integrator chỉ comment lý do và giữ status khi chờ
owner, integrator chờ con sửa xong, Trợ Lý chờ cả lô con hoặc owner trả lời thẻ, BMAD `blocked` chờ owner. Server đánh thức bằng
sự kiện của chính nó (issue được giao, con xong, owner trả lời), không dựa vào lệnh nền của run. Job do server xếp hàng chạy
riêng ngoài run (deploy của integrator ở bước 7b, Bug Finding) không thuộc luật. Đoạn luật không còn mệnh đề chung "không có
thông báo đánh thức lại", chỉ nói về lệnh nền của run.

Lý do (sự cố TPS-693, 05/11/2026): executor bật flow Maestro iOS chạy nền rồi kết thúc lượt "chờ monitor báo kết quả". Run
agent là một lần `claude --print`: kết thúc lượt thì process thoát và lệnh nền bị cắt, không có gì đánh thức lại agent. Issue
bị `blocked` sau 5 run hỏng `adapter_failed` exit 255.

Kiểm: `crew/agents/instructions.test.mjs` (đoạn luật giống hệt ở 6 template; F-01/F-02 kiểm câu cho phép chờ server đánh thức,
`&`/`$!`, ngoại lệ job do server xếp hàng), `packages/crew-web/test/lib/instructions/render.test.ts` (fixture render) và E2E
ca giả `packages/crew-web/e2e/fake/agents-md-no-background.spec.ts` (web hiện luật ở 4 vai có thao tác "Render lại theo vai
trò": Trợ Lý, executor, reviewer, integrator). `bmad` và `designer` cố ý ngoài phạm vi E2E vì web không có ô vai trò và đường
render AGENTS.md cho hai agent này; spec ghi chú lý do và có ca khóa danh sách đủ 6 template.

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

## Agent UIUX và con thiết kế (`crew-kind design`)

Yêu cầu code có giao diện đi qua agent UIUX trước. Template `crew/agents/designer.md` (vai `designer`, tên hiển thị "UIUX"):

- Đọc tài liệu UI của project (`docs/design-system.md`, `DESIGN.md`, `docs/**/design*`, `docs/**/ui*`, file token/theme,
  thư viện component trong `package.json`, 2–3 màn thật cùng loại); project chưa có thì soạn `docs/design-system.md` từ code
  và commit cùng con.
- Mockup HTML tĩnh, tự chứa (không CDN, chỉ font app đã dùng) ở `docs/design/mockups/<identifier gốc viết thường>-<slug>/`,
  có `index.html`. Ảnh Playwright từng màn/trạng thái đính lên issue. Chỉ được sửa `docs/design/mockups/`,
  `docs/design-system.md` và docs flow khi hook đòi; không sửa code app, không tạo issue, không publish mockup.
- Skill `ui-ux-pro-max` chỉ dùng để lấy checklist (`search.py "<từ khóa>" --domain ux|web|react-native`): a11y, trạng thái
  rỗng/lỗi/đang tải, responsive, touch target ≥ 44px. Cấm `--design-system`/`--persist` và cấm lấy palette/font của skill.
- Báo xong: `crew-commit … tests=mockup-screenshots result=pass`, rồi `crew-design-result sha=<40 hex> dir=<thư mục> images=<n>`
  kèm giải thích (màn, trạng thái, token/component bám theo, chỗ mới và lý do), rồi `PATCH done`.

Cách đưa skill tới agent: run trên Mac chỉ nạp đúng một `--plugin-dir` (bản Superpowers đã ghim) nên plugin của user không
được nạp. `ui-ux-pro-max` vì thế là **skill công ty** của Paperclip: import vào company (`POST /api/companies/:id/skills/import`,
chép phẳng bằng `cp -RL` vì skill gốc dùng symlink), gắn cho agent UIUX bằng `POST /api/agents/:id/skills/sync`. Mỗi run
adapter đặt skill dưới `.paperclip-runtime/claude/skills`, và `designer.md` tìm `search.py` ở đó. Script cần `python3`;
thiếu script hay `python3` thì agent ghi rõ trong comment và kiểm theo checklist có sẵn trong template.

Marker và luật các vai khác:

- Trợ Lý (`assistant.md`): bước 6b "Con thiết kế" của "Tách việc" áp khi là yêu cầu code (không BMAD, research, docs, plan),
  có giao diện, và mục "Agent UIUX của company" có agent. Lô có `child-key=design-1` (lô sửa `design-fix-<n>`), gói `design`,
  model và effort từ `settings.roles.designer` của bảng model, dòng riêng `crew-kind design`. Con code có giao diện được
  tạo **cùng lô**, có con thiết kế trong `blockedByIssueIds` và dòng `crew-design on=<identifier con thiết kế>`; con backend
  chạy song song. Ngay sau POST con thiết kế, Trợ Lý đọc lại và đòi đúng 2 stage (reviewer, rồi `approval` của owner); sai
  thì không tạo các con code giao diện. Tổng kết đặt ảnh mockup trước và có dòng tóm tắt `crew-design-result` trong
  `### Kết quả`. Không giao con `crew-kind design` cho agent ngoài danh sách UIUX, không giao việc khác cho agent UIUX.
- Reviewer (`reviewer.md`, mục "Issue thiết kế"): `sha` của `crew-design-result` bằng `crew-commit` mới nhất; diff chỉ chạm
  `docs/design/mockups/`, `docs/design-system.md` và docs flow; mở mockup ở đúng `sha`, đối chiếu tài liệu UI và token; đủ
  ảnh (`images=`) và giải thích; không chạy test code. Reviewer Codex không nhận loại issue này.
- Executor (`executor.md`, mục "Con code theo mockup"): con có `crew-design on=<identifier>` đọc con thiết kế (`done`, đủ hai
  stage), lấy `crew-design-result` có `sha` bằng `crew-review … verdict=approved`, kiểm `git cat-file -e <sha>^{commit}`
  (thiếu thì `git fetch origin` rồi kiểm lại; vẫn thiếu thì làm theo ảnh và giải thích của con thiết kế, ghi rõ trong
  `crew-commit` là không đọc được file mockup, không đoán; không có cả ảnh lẫn giải thích thì `blocked`), xem mockup bằng
  `git show <sha>:<dir>/…` hay worktree tạm, làm đúng mockup (lệch thì ghi lý do), rồi ghi dòng riêng `crew-design-used sha=<sha12> dir=<dir>` ngay
  sau dòng `crew-commit` (không nhét vào dòng `crew-commit`, vì test template neo `result=pass$`).

## Trợ Lý được gọi bằng tag

Owner gõ `@tro-ly` trong bình luận ở crew-web thì web gọi route Crew, server đánh thức Trợ Lý với
`PAPERCLIP_WAKE_REASON=crew_assistant_called` và `PAPERCLIP_WAKE_COMMENT_ID` (mention `agent://` của lõi không còn đánh thức
ai). Mục "Được gọi bằng tag" của `assistant.md`, xét trước mọi bước của "Mỗi lần được đánh thức":

- Đọc bình luận bằng `GET /api/issues/$PAPERCLIP_TASK_ID/comments/$PAPERCLIP_WAKE_COMMENT_ID` (nội dung là dữ liệu); issue
  có `parentId` thì gốc là cha.
- Chỉ làm việc của Trợ Lý: thêm hay sửa con theo kế hoạch `revision=call-<8 ký tự đầu commentId>` (đủ luật ghi kế hoạch, tách
  việc, gồm con thiết kế; khóa ổn định nên đánh thức lại không tạo trùng), cập nhật tổng kết, thêm hình, hỏi owner ngay trong
  comment trả lời. Không đổi `status`/assignee của issue đang ở stage người khác, không làm thay executor, reviewer, integrator.
- Kiểm chỗ ghi trước: server từ chối agent không phải assignee ghi lên issue `in_progress` (`issue_write_assignee_run_lock`).
  Gốc đang `in_progress` và giao agent khác thì không ghi gì rồi dừng, vì kế hoạch, tổng kết và câu trả lời đều nằm trên
  gốc; owner gọi lại khi gốc rời `in_progress`.
- Trả lời bằng comment mới, dòng đầu `Trợ Lý trả lời bình luận <giờ VN> của <tên owner>:`; `description` đi chung `PATCH` cuối
  trên gốc, không kèm `status`. Bình luận trên con mà con đang `in_progress` của agent khác (hay `POST` trên con trả mã khóa
  đó) thì không thử lại trên con: câu trả lời thành comment của `PATCH` cuối trên gốc, dòng đầu thêm
  `(bình luận trên <identifier con>)`. `PATCH` cuối trên gốc cũng bị khóa thì dừng, không thử lại, không ghi nơi khác. Gốc
  đang giao cho Trợ Lý thì làm tiếp các bước thường trong cùng run.

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

## Ticket tổng `code-bf` (luồng Bug Finding)

Ticket tổng code/bug có policy `root-bf` (`crewPolicyKind` `code-bf`, flow `issue-gate`): 4 stage integrator → reviewer cầu
nối → owner → integrator, không có reviewer Claude ở cấp gốc. Các template nhận ra loại này theo vị trí stage (stage 1 và 4
là integrator, stage 2 là reviewer, stage 3 là `approval` của owner); policy `code` cũ giữ nguyên mọi mục cũ.

- Integrator (`integrator.md`, mục "Ticket tổng `code-bf`"): stage gộp (stage 1) gộp các `sha` đã duyệt như stage 2 cũ, lần
  chạy lại dựng tiếp trên head PR của `crew-pr` trước (bỏ `sha` đã có, gộp `origin/<mặc định>` khi nhánh mặc định đi tiếp)
  để push thường vẫn đi được; kiểm, ghi `crew-docs-check`, rồi chạy script PR với `MODE=bf` (không đọc quyết định owner),
  đăng `crew-pr sha=<merged commit> pr=<URL>` và `PATCH done`. Stage merge (stage 4) chạy script với `MODE=merge`: head PR
  phải đúng `T` (hoặc `HEAD_OK` sau khi owner tự xử lý conflict: script fetch nhánh mặc định và chỉ nhận khi mọi commit
  trong `T..HEAD_OK` chưa có trên nhánh đó là merge commit hai cha, cha thứ hai nằm trên nhánh mặc định), `gh pr merge --merge --match-head-commit`
  (`--squash` khi repo cấm merge commit), đăng `crew-merge … pushed=merged pr=<URL> merge=<sha>`, deploy với `--pr`, rồi
  `PATCH done`. Conflict thì comment `Integrator: chưa merge được — conflict` và dừng, không đổi status.
- Script PR (`## Script mở pull request` của `integrator.md`): `MODE` mặc định `owner` giữ nguyên luồng cũ; `MODE=bf` ra
  `pr-comment.json` và `done.json`, chân PR ghi Bug Finding review và integrator merge sau khi owner duyệt, conflict thì thoát
  7; `MODE=merge` không push, ra `merge-comment.json` và `done.json` (mục `### Merge request` ghi merge commit), thoát 7
  khi conflict, 8 khi head PR khác commit đã duyệt hay không có PR, 9 khi `HEAD_OK` có commit chưa được owner duyệt (commit
  thường sau `T`, hay mang vào qua merge nhánh khác); integrator comment `Integrator: không merge — head pull request có commit
  chưa được owner duyệt` và dừng. Test `integrator-pr.test.mjs` dựng repo bare cục bộ cho `git fetch origin`.
- Reviewer (`reviewer.md`, mục "Ticket tổng `code-bf`: cầu nối Bug Finding"): không đọc code; đọc
  `GET /api/plugins/crew.core/api/issues/<id>/bug-finding` (flow `bug-finding`), không tin comment. Chưa có lượt cho head
  hiện tại thì xếp (`bug-finding/request`); lượt hỏng lần đầu xếp lại, lần hai hỏi owner bằng `request_confirmation` khóa
  `crew-bf-skip:<id>:<vòng>:<head12>:<số lượt hỏng>`, owner đồng ý thì gọi `bug-finding/skip`; lượt `succeeded` còn finding
  mở (trừ finding owner chọn `wontfix`/`split` trong thẻ `crew-bf:<id>:<vòng>-<lượt>` của mọi vòng và finding `LOW`/`INFO`
  trong `dismiss=` của `crew-bf-triage` do Trợ Lý viết) và còn lô thì `Reviewer: cần sửa` về Trợ Lý, không thì cho qua sang
  owner. Câu trả lời áp cho mọi id finding trong `questionId` (nối bằng dấu phẩy); thẻ của lượt khác khớp finding hiện tại
  khi cùng `rule` (khác `UNCATEGORIZED`) và cùng file của `location`, hoặc cùng `title`.
- Trợ Lý (`assistant.md`, mục "Xử lý finding Bug Finding"): đọc cùng route và document báo cáo, phân loại theo bảng tự sửa /
  hỏi owner / bỏ qua (`CRITICAL`, `HIGH` không bao giờ bỏ qua). Tự sửa không đòi `action` (Bug Finding không ghi trường
  này; có thì phải là `CODE_FIX`/`TEST_FIX`), mọi mức từ `LOW` tới `CRITICAL`, khi finding `introduced`, `Confirmed` (hoặc
  `Potential` có `SOURCE`), có `fix` và `accept`, không có `question` và không đổi hành vi, API, dữ liệu. `question` đến từ
  `decision_items` của Bug Finding (flow `bug-finding`); finding có `question` thì hỏi owner. Trước khi phân loại, câu trả
  lời của owner trong thẻ `crew-bf:` của mọi vòng được dùng lại cho finding khớp (cùng `rule` khác `UNCATEGORIZED` + cùng
  file, hoặc cùng `title`): `fix` vào nhóm tự sửa, `wontfix`/`split` vào phản hồi, không hỏi lại. Ghi
  `crew-bf-triage run=<n> batch=bf-fix-<k> …` trước mọi thẻ và con (`<k>` tăng qua mọi vòng), một thẻ `ask_user_questions`
  khóa `crew-bf:<id gốc>:<vòng>-<n>` (finding cùng `question` chung một câu; id câu là các id finding nối bằng dấu phẩy,
  ví dụ `F-01,F-02`; lựa chọn `fix`/`wontfix`/`split`), con sửa có `crew-fix base=<head PR>`, `crew-child key=bf-<F-xx>
  revision=bf-fix-<k>`, `crew-bf finding=<F-xx> run=<n>`, con E2E `e2e-fix-bf<k>` khi gốc có E2E. Chỉ `PATCH done` một lần
  khi mọi con của lô xong và mọi thẻ đã trả lời, comment kèm khối `crew-bf-feedback`. "Đóng issue gốc" nói rõ `code-bf` đi
  sang integrator, không còn reviewer cấp gốc.
- Executor (`executor.md`, mục "Con sửa finding Bug Finding"): nhánh từ `crew-fix base=`, tiêu chí là `accept`, test chứng
  minh viết từ `test` của finding (đỏ trên base, xanh sau sửa); không tái hiện được thì `blocked` kèm bằng chứng.

## Điểm vào

- `crew/agents/apply-roles.sh agent <agentId> <vai trò> <thư mục ghim> [...]` với vai trò `assistant`, `executor`,
  `reviewer`, `integrator`, `bmad`, `designer`, `executor-codex`, `executor-opencode`, `reviewer-codex`. Vai `designer`
  upload `designer.md`, runtime `claude_local`, ghim Superpowers như executor. Trợ Lý nhận thêm danh sách executor
  (`<uuid>[:runtime]`), danh sách agent BMAD, reviewer Codex và (đối số thứ 7, bỏ trống được) danh sách agent UIUX; vai
  khác truyền danh sách UIUX thì thoát 2. Thứ tự đối số cũ giữ nguyên.
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
   agent BMAD, agent UIUX (`## Agent UIUX của company`, ngay sau mục BMAD; rỗng thì "Không có. Không tạo con thiết kế;
   làm như cũ.") và reviewer Codex; vai trò khác giữ nguyên văn template và từ chối mọi danh sách ("danh sách agent UIUX
   chỉ assistant nhận"). Từ chối id sai, trùng nhau hay trùng chính Trợ Lý; agent UIUX còn không được trùng executor,
   agent BMAD hay reviewer Codex.
3. `crew/agents/merge-agent-config.mjs`: dựng body PATCH ghim Superpowers hay BMAD; chỉ Claude nhận `--plugin-dir`, Codex
   và OpenCode đọc bản ghim qua `CREW_SUPERPOWERS_DIR` do wrapper đặt. Agent Codex phải có `CODEX_HOME` ngoài thư mục
   company do server quản lý và không mang `OPENAI_API_KEY`.
4. `crew/agents/add-base.mjs` → `addBase`: `baseHash` là `contentHash` của file hiện tại hoặc `null` khi chưa có; lỗi
   khác thì dừng, không đoán.
5. `crew/agents/policy-config.mjs` → `buildPolicyConfig`: ghi mục company (id viết thường, thay key khác hoa thường),
   giữ company khác, từ chối file cũ hỏng thay vì ghi đè; `--tracking` đặt `trackingProjectIds`.
6. `packages/crew-web/src/lib/instructions/render.ts` → `renderInstructions`, `renderAssistantFor`, `assistantListsOf`,
   `assistantListsMatch`: render và đọc lại danh sách trong `AGENTS.md` của Trợ Lý theo vai trò project.
   `AssistantLists.designerIds` đọc mục UIUX (file bản cũ chưa có mục là rỗng). `renderAssistantFor` giữ agent BMAD và
   agent UIUX của file hiện có, bỏ id đã thành Trợ Lý, executor hay reviewer Codex (agent UIUX còn bỏ id đang là agent
   BMAD). Vai trò project không có ô `designer`: danh sách UIUX chỉ sống trong `AGENTS.md` của Trợ Lý như BMAD, nên mọi chỗ
   render lại (lưu vai trò, thêm/gỡ agent, readiness) đều giữ nó.
7. `packages/crew-web/src/lib/instructions/put.ts` → `putInstructions`: GET lấy `contentHash` rồi PUT với `baseHash`;
   server trả 409 thì báo xung đột, không ghi đè, không thử lại; nội dung không đổi thì không PUT.
8. `packages/crew-web/src/lib/instructions/agent-config.ts` → `crewAgentCreateBody`, `crewRuntimeConfigOf`,
   `crewExtraArgsOf`, `crewWrapperCommand`, `CREW_ROLE_SLOTS`: cấu hình agent Crew tạo từ web, cùng dạng với app Mac và
   với `merge-agent-config.mjs`. Ô executor Claude là `EXECUTOR_SLOTS` (`executor`, `executor-2` … `executor-5`,
   `MAX_EXECUTORS`); mọi ô đó dùng template và vai model `executor` (`roleOfSlot`, `modelRoleOfSlot`), `agentOfSlot`
   đọc theo vị trí trong `executorAgentIds` (`executorIndex`). Danh sách model chọn được, model và effort mặc định của ô (`crewModelsOf`, `slotModels`,
   `defaultModelOf`, `defaultEffortOf`, `isCrewModel`) lấy từ `settings` của bảng cài đặt model (flow `model-settings`),
   không còn bản chép model nào trong file này; `crewAgentCreateBody` nhận `settings`, từ chối model ngoài catalog của ô
   và ghi effort của vai vào key effort của runtime. `crewModelsOf` trả id đã sắp tăng dần kiểu natural sort qua
   `sortModelIds` (`localeCompare` với `numeric: true`), vì thứ tự khóa `jsonb` của bảng đã lưu không ổn định; mọi danh
   sách model (wizard, ô chọn model, trang Cài đặt model) đi qua hàm này.
9. `packages/crew-web/src/lib/instructions/templates.ts` → `INSTRUCTION_TEMPLATES`: sáu template nhúng nguyên văn
   (`assistant`, `executor`, `reviewer`, `integrator`, `bmad`, `designer`).

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `crew/agents/assistant.md` | Template Trợ Lý | (markdown) |
| `crew/agents/executor.md` | Template executor (cả Codex, OpenCode) | (markdown) |
| `crew/agents/reviewer.md` | Template reviewer (cả Codex) | (markdown) |
| `crew/agents/integrator.md` | Template integrator, kèm script mở và merge pull request (`MODE=owner|bf|merge`) | (markdown) |
| `crew/agents/bmad.md` | Template agent BMAD | (markdown) |
| `crew/agents/designer.md` | Template agent UIUX (vai `designer`) | (markdown) |
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

- `crew/agents/instructions.test.mjs`: luật chung của mọi template (cấm xóa đệ quy ngoài thư mục tạm; cấm chạy lệnh nền rồi kết thúc lượt, đúng một đoạn trong mục "Không bao giờ"), dòng mẫu
  `crew-docs-check`, `crew-merge`, `crew-fix`, `crew-commit`, `crew-review` khớp định dạng và regex của server, cách
  integrator nhận diện stage. Loại yêu cầu Lập kế hoạch: Trợ Lý nhận bằng nhãn `plan`, hỏi owner trước khi tạo con, chỉ tạo con `crew-kind plan`
  và ghi `- File kế hoạch:` trong tổng kết; executor, reviewer, integrator có luật tương ứng. Ticket tổng `code-bf`: mục mới của bốn template có đủ bước, dòng mẫu `crew-pr`, `crew-merge … pushed=merged`, `crew-bf-triage`, marker con lô và khối `crew-bf-feedback` khớp regex của server và plugin; regex `CREW_MERGE_RE`, `CREW_PR_RE` của server được đọc lại từ nguồn để so. Tổng kết của Trợ Lý: có từ lúc lập kế hoạch, đủ mục Yêu cầu/Việc con/Hình ảnh theo thứ tự, cập nhật mỗi run bằng `PATCH` ghi cuối, giữ `### Merge request`. Bảng model: `assistant.md` không chứa id model nào, có đúng lệnh `curl` đọc bảng cùng bốn đường dẫn JSON và đường lui khi lệnh lỗi. Agent UIUX: `designer.md` đi qua mọi luật chung, dòng mẫu `crew-design-result` và `crew-commit` khớp định dạng, cấm sửa code app, CDN và `--persist`, mục File đính kèm giống executor; Trợ Lý có bước con thiết kế (dòng `crew-kind design` đứng riêng, `child-key=design-1`, kiểm 2 stage) và mục "Được gọi bằng tag" (bước kiểm khóa ghi trên gốc đứng trước bước làm việc, con `in_progress` thì trả lời trên gốc, không thử lại lệnh bị khóa); reviewer có mục Issue thiết kế đúng thứ tự; executor có mục `crew-design on=` và dòng `crew-design-used`, bước đọc mockup kiểm sha bằng `git cat-file -e`, `git fetch origin` rồi mới rơi về ảnh và giải thích.
- `crew/agents/integrator-pr.test.mjs`: script mở pull request của integrator: mở mới, dùng lại, đã merge, origin không
  ở GitHub, `gh` chưa đăng nhập, nhánh đã đi khác (không `--force`), lỗi tạo PR có credential bị che, đầu vào sai. Nội dung PR bỏ mục `### Hình ảnh` của tổng kết. `MODE=bf`: mở PR không cần quyết định owner, ghi `crew-pr` đúng merged commit, chạy lại dùng lại PR đang mở, conflict thoát 7. `MODE=merge`: merge đúng head bằng `--merge --match-head-commit` (repo cấm merge commit thì `--squash`), không push, head khác thoát 8, conflict thoát 7 không gọi merge, PR đã merge thì không merge lại, `HEAD_OK` chỉ nhận head chứa `T`.
- `crew/agents/apply-roles.test.mjs`: thứ tự đọc → upload → PATCH, dừng trước khi ghi khi không đọc được, vai trò BMAD và
  ô runtime, sai `adapterType` hay thiếu `CODEX_HOME`; vai `designer` upload `designer.md` với pin Superpowers, Trợ Lý nhận
  danh sách UIUX ở đối số thứ 7, vai khác nhận thì thoát 2.
- `crew/agents/render-instructions.test.mjs`, `merge-agent-config.test.mjs`, `add-base.test.mjs`,
  `policy-config.test.mjs`, `verify-result.test.mjs`: từng script phụ trợ.
- `packages/crew-web/test/lib/instructions/render.test.ts`: bản port khớp từng byte với script gốc và template nhúng khớp
  file trong `crew/agents/` (fixture `assistant-designer.md` có mục UIUX, `designer.md` là template nguyên văn).
- `packages/crew-web/test/lib/instructions/assistant-lists.test.ts`: đọc lại và render danh sách của Trợ Lý theo vai trò
  project, gồm danh sách UIUX (file cũ chưa có mục, giữ khi render lại, bỏ id đã thành vai khác).
- `packages/crew-web/test/features/projects/use-save-roles.test.ts`, `test/features/wizards/add-agent.test.ts`,
  `test/features/wizards/remove/remove-agent.test.ts`: lưu vai trò, thay Trợ Lý và gỡ agent giữ danh sách BMAD và UIUX.
- `packages/crew-web/test/e2e-support.test.ts`: `AGENTS.md` mà dữ liệu mẫu e2e (`e2e/support/guide-company.ts`) dựng trùng
  bản render của web.
- `packages/crew-web/test/lib/instructions/put.test.ts`: `baseHash`, không PUT khi không đổi, 409 thành xung đột.
- `packages/crew-web/test/lib/instructions/agent-config.test.ts`: wrapper, `extraArgs`, body tạo agent qua được schema của
  server, hằng số cùng giá trị với app và server, danh sách và model mặc định theo `settings`.
- `packages/crew-web/test/lib/instructions/catalog-copy.test.ts`: các hàm thuần (`crewModelsOf`, `slotModels`,
  `defaultModelOf`, `defaultEffortOf`, `crewAgentCreateBody`) với bảng mẫu: bảng mặc định cho kết quả như các hằng số cũ,
  bảng do owner sửa đổi danh sách và mặc định; danh sách model sắp theo id, không theo thứ tự khóa; bảng mẫu của test khớp catalog và thứ tự mặc định của server; `src` không
  còn id model ghi cứng.

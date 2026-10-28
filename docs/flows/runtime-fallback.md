# Chuyển runtime khi run hỏng và chờ Claude chạy lại

> Flow `runtime-fallback`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow runtime-fallback` in ra đúng danh sách đó.

## Mục đích

Một run có thể hỏng vì chính runtime chứ không vì việc: hết quota, mất đăng nhập hay thiếu key, CLI không chạy được,
hoặc bị giữ vì công tắc runtime đang tắt. Khi đó Crew chuyển issue sang executor khác của project trên cùng máy, chạy
runtime khác, thay vì để issue nằm im. Luật chính:

- Chỉ executor của project và reviewer Codex được chuyển. Executor chỉ chuyển với lỗi `quota`, `auth`, `unavailable` và
  `switch_off`; mọi lỗi khác (code, test, timeout, `crew-workflow blocked`) để quy trình thường xử lý. Reviewer Codex
  hỏng vì bất kỳ lý do gì thì lượt review chuyển sang reviewer Claude của project.
- Đích phải cùng máy, nhận việc được, công tắc bật, bản tin máy không báo hỏng, theo thứ tự runtime của độ khó
  (`CREW_RUNTIME_ORDER`), bỏ runtime đã thử. Độ khó `large` chỉ chạy Claude. Tối đa `MAX_FALLBACKS_PER_ISSUE` (2) lần mỗi
  issue. Issue có ảnh chỉ sang model đọc được ảnh.
- Không chuyển được thì comment một lần và chuyển issue sang `blocked`. Riêng issue `large` hỏng vì đăng nhập hay runtime
  không chạy được: Paperclip gốc không chạy lại các run này, nên Crew tự đánh thức lại assignee theo backoff
  `CLAUDE_RETRY_BACKOFF_MINUTES` (5, 15, 30, 60 phút), hết lượt thì comment và chặn issue.
- Mỗi lần quyết định được ghi vào sổ trước mọi thay đổi trên issue, duy nhất theo run, nên sự kiện gửi lại không chuyển
  hai lần.

## Điểm vào

- Sự kiện plugin `agent.run.failed` → `handleRunFailed`.
- Job plugin `runtime-fallback` (mỗi phút) → `runRuntimeFallbackJob` (run bị công tắc giữ quá `RUNTIME_WAIT_GRACE_MS`),
  `runStuckReviewerSweep` (reviewer Codex bị pause/terminate khi đang giữ lượt review), `runClaudeRetryJob`.
- Sự kiện `issue.created` → `handleIssueCreated` ghi dòng `select` (lựa chọn ban đầu).
- Data plugin `crew.runtimeDecisions`: crew-web đọc sổ quyết định của issue.
- Server: H1 đọc sổ quyết định để kiểm worktree của run cũ (flow `run-claim`).

## Các bước

1. `packages/crew-plugin/src/runtimes/classify.ts` → `classifyRuntimeFailure`: phân loại theo `errorCode`,
   `errorFamily` (đọc từ `heartbeat_runs.result_json` vì payload sự kiện không có) và câu lỗi (wrapper Mac
   `crew-runtime blocked:`, mẫu lỗi OpenCode).
2. `packages/crew-plugin/src/runtimes/fallback.ts` → `handleRunFailed`: bỏ agent ngoài ba runtime; gọi `applyFallback`.
3. `packages/crew-plugin/src/runtimes/fallback.ts` → `applyFallback`: dừng khi issue không thuộc project Crew, không có
   policy Crew, đã đóng, đã giao agent khác, hoặc agent không phải executor/reviewer Codex; đã quyết cho run này thì
   `duplicate`.
   - Máy của agent: cây của issue đã ghim máy (flow `multi-machine`) thì máy của mọi agent là máy ghim
     (`pinnedMachineOfIssue`), fallback "cùng máy" vì vậy chọn agent chạy được trên máy ghim; chưa ghim thì theo luật
     đường dẫn cũ.
   - Executor: `chooseFallback` (`choose.ts`) đọc catalog và thứ tự runtime từ bảng cài đặt model hiện hành
     (`readModelSettings`, flow `model-settings`), với máy của agent (`machine.ts` → `resolveAgentMachine`), công tắc,
     sức khỏe runtime từ bản tin máy (`runtimeHealthOf`), các lần chuyển trước. Chuyển được thì ghi quyết định, đổi
     `assigneeAgentId` kèm override model của runtime đích (H2 kiểm lệnh ghi này), comment, rồi đánh thức đích khi run
     cũ đã rời issue (`wakeFallbackTarget`, chờ tối đa `FALLBACK_WAKE_MAX_WAIT_MS`). H2 từ chối thì quyết định đổi thành
     `fallback_refused`.
   - Reviewer Codex: chỉ đổi `currentParticipant` của `executionState` đang lưu sang reviewer Claude cùng
     `assigneeAgentId`, không đụng policy (H2 chỉ cho đúng phép đổi này), rồi đánh thức với lý do
     `crew_runtime_reviewer_fallback`.
4. `packages/crew-plugin/src/runtimes/claude-retry.ts` → `scheduleClaudeRetry`, `runClaudeRetryJob`: hẹn và đánh thức
   lại assignee Claude; số lần giữ qua các run hỏng liên tiếp, về 0 khi có run thành công hay đổi người.
5. `packages/crew-plugin/src/runtimes/decisions.ts` → `insertRuntimeDecision`, `recordSelect`, `loadRuntimeDecisions`:
   sổ quyết định (`select`, `fallback`, `fallback_refused`); `chooseReviewer` và `executorRuntimeOf` là bản chép luật
   server. Model của dòng `select` reviewer Codex lấy từ vai `reviewer-codex` của bảng cài đặt model.
6. `packages/crew-plugin/src/runtimes/catalog.ts` → `readModelSettings`, `parseModelSettings`: đọc dòng `revision` lớn nhất
   của `crew_model_settings` (chỉ server ghi). Chưa có dòng, đọc lỗi hoặc sai dạng thì dùng `CREW_MODEL_SETTINGS_DEFAULT`,
   bản chép bảng mặc định của server có test so nguyên văn; không cache. Dòng lưu trước khi có một vai (vai `designer`)
   thiếu hẳn khóa của vai đó thì vai được điền mặc định, như server đọc dòng cũ.
7. `server/src/crew/runtime-fallback.ts` → `fallbackPreviousRunId`: H1 tìm run cũ cần kiểm theo quyết định `fallback`
   mới nhất (không theo lý do wake, vì recovery lõi có thể đánh thức đích trước plugin); `fallbackProgressComment`,
   `fallbackDirtyComment` dựng comment. Worktree cũ còn thay đổi chưa commit thì issue bị chặn chờ owner.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `packages/crew-plugin/src/runtimes/fallback.ts` | Bộ chuyển runtime: sự kiện, job, executor, reviewer | `registerRuntimeFallback`, `handleRunFailed`, `applyFallback`, `runRuntimeFallbackJob`, `runStuckReviewerSweep`, `wakeFallbackTarget`, `RUNTIME_FALLBACK_WAKE_REASON` |
| `packages/crew-plugin/src/runtimes/decisions.ts` | Sổ quyết định runtime và data cho UI | `registerRuntimeDecisions`, `insertRuntimeDecision`, `recordSelect`, `loadRuntimeDecisions`, `parseCrewModelMarker` |
| `packages/crew-plugin/src/runtimes/choose.ts` | Chọn đích (hàm thuần) | `chooseFallback`, `runtimeHealthOf`, `MAX_FALLBACKS_PER_ISSUE` |
| `packages/crew-plugin/src/runtimes/classify.ts` | Phân loại run hỏng | `classifyRuntimeFailure`, `OPENCODE_QUOTA_RE`, `OPENCODE_AUTH_RE` |
| `packages/crew-plugin/src/runtimes/claude-retry.ts` | Đánh thức lại Claude theo backoff | `scheduleClaudeRetry`, `runClaudeRetryJob`, `CLAUDE_RETRY_BACKOFF_MINUTES` |
| `packages/crew-plugin/src/runtimes/catalog.ts` | Bảng runtime/model mặc định và đọc bảng hiện hành | `CREW_RUNTIME_CATALOG`, `CREW_RUNTIME_ORDER`, `CREW_MODEL_SETTINGS_DEFAULT`, `readModelSettings`, `parseModelSettings` |
| `packages/crew-plugin/src/runtimes/machine.ts` | Máy của agent phía plugin | `resolveAgentMachine`, `pinnedMachineOfIssue`, `workspaceOfEnvironment`, `loadMachineCheckouts` |
| `server/src/crew/runtime-fallback.ts` | Phần server: run cũ cần kiểm, comment | `fallbackPreviousRunId`, `isRuntimeFallbackWake`, `CREW_RUNTIME_FALLBACK_WAKE_REASON`, `CREW_RUNTIME_FALLBACK_CHECKED_ACTION` |

## Dữ liệu

- Bảng plugin: `crew_runtime_decisions`, `crew_runtime_waits` (migration `0012_runtimes.sql`), `crew_runtime_retries`
  (`0017_runtime_retries.sql`). Đọc `crew_runtime_switches`, `machine_latest`,
  vai trò project.
- Bảng lõi: đọc `heartbeat_runs`; ghi issue qua host (`assigneeAgentId`, `assigneeAdapterOverrides`, `executionState`,
  `status`) và comment.
- Lý do wake: `crew_runtime_fallback`, `crew_runtime_reviewer_fallback`, `crew_claude_retry`. Lý do hủy run:
  `crew_runtime_fallback_dirty`. Activity server: `crew.runtime_fallback.checked`.

## Flow liên quan

- `runtime-switches`: công tắc và hàng chờ `crew_runtime_waits` là đầu vào của trigger `switch_off`.
- `run-claim`: H1 kiểm worktree run cũ và tách nhánh trước khi run đích chạy.
- `model-settings`: bảng `crew_model_settings` do server ghi, plugin chỉ đọc.
- `issue-gate`: H2 kiểm lệnh đổi assignee/override và phép đổi participant reviewer Codex.
- `project-roles`: danh sách executor và reviewer Codex của project.
- `machine-status`: bản tin máy cho sức khỏe runtime và checkout.
- `multi-machine`: bảng `issue_machine_pins` ghim máy cho cả cây yêu cầu.
- `run-handoff`: vá C14 cho wake reviewer bị hoãn sau run executor lỗi.

## Tests

- `packages/crew-plugin/src/__tests__/runtime-fallback.test.ts`: `chooseFallback` (thứ tự, bỏ runtime tắt/khác máy,
  `large`, trần hai lần, ảnh), `runtimeHealthOf`, `classifyRuntimeFailure`.
- `packages/crew-plugin/src/__tests__/runtime-fallback.db.test.ts`: khai báo job và sự kiện; chuyển executor một lần kể
  cả khi sự kiện gửi lại; override theo runtime đích; các trường hợp dừng; `large` hẹn đánh thức lại; trần hai lần; ảnh;
  H2 từ chối thì thành `fallback_refused`.
- `packages/crew-plugin/src/__tests__/runtime-decisions.db.test.ts`: dòng `select` khi có issue mới, lý do chọn reviewer
  tính lại theo luật server, data `crew.runtimeDecisions` giới hạn và lọc company.
- `packages/crew-plugin/src/__tests__/runtime-machine-pin.db.test.ts`: máy ghim của cây thắng luật đường dẫn; cây chưa
  ghim giữ luật cũ; không đọc issue của company khác.
- `packages/crew-plugin/src/__tests__/runtime-machine.test.ts`: workspace của environment lấy từ refs của wizard.
- `packages/crew-plugin/src/__tests__/runtimes-catalog.test.ts`: bản chép khớp bảng chung và bản server; dòng cũ thiếu
  vai `designer` được điền mặc định.
- `server/src/__tests__/crew-runtime-fallback-reconcile.test.ts`: lệnh tách nhánh, đọc kết quả tách, comment, H1 tìm và
  kiểm run cũ một lần.
- `server/src/__tests__/crew-runtime-handoff.db.test.ts`: override của executor không theo sang reviewer; fallback theo
  công tắc chỉ đánh thức đích sau khi run cũ bị hủy; recovery lõi đánh thức trước plugin vẫn được kiểm.

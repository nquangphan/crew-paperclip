# Lượt Bug Finding của ticket tổng

> Flow `bug-finding`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow bug-finding` in ra đúng danh sách đó.

## Mục đích

Ticket tổng code/bug theo luồng Bug Finding (policy `root-bf`, `crewPolicyKind` `code-bf`) không có reviewer Claude ở
cấp gốc: integrator gộp code và mở PR (stage 0), rồi app Bug Finding trên Mac review PR đó ở stage cầu nối (stage 1).
Flow này giữ sổ lượt Bug Finding: xếp lượt cho head PR hiện tại lên đúng Mac, nhận tiến độ và kết quả từ app 2P Crew,
lưu finding rút gọn và báo cáo, báo reviewer cầu nối, và đánh dấu hết giờ để stage không kẹt im lặng. Gate stage cầu
nối của server đọc cùng sổ này (flow `issue-gate`).

Luật chính:

- Mỗi vòng duyệt của owner có tối đa 3 lượt (`MAX_RUNS`): lần đầu và tối đa 2 lô sửa tự động (`MAX_BATCHES`). Owner yêu
  cầu sửa thì sang vòng mới và đếm lại từ đầu. Lượt hỏng (`failed`, `timeout`, `cancelled`) cũng tính là một lượt.
- Một vòng + một head PR chỉ có một lượt đang dùng: vào lại stage cầu nối với cùng head không xếp thêm; reviewer xếp lại
  (`retry`) chỉ khi lượt mới nhất của head đó hỏng.
- Head PR là sha của `crew-pr` mới nhất do agent stage gộp viết; số PR lấy từ URL pull request GitHub.
- Máy: máy đã ghim cho cây (`issue_machine_pins`), không ghim thì máy `ready` của project (`project_machines`). Dòng còn
  `provisioning` mà việc `ensure-project` mới nhất của project trên máy đã `done` kèm `repoPath` tuyệt đối thì coi như
  `ready` với `repoPath` đó (chỉ đọc, không ghi dòng; server đối chiếu dòng ở cổng claim, flow `multi-machine`). Dòng
  `ready` có `repo_path` tuyệt đối dùng đúng repo đó. Dòng `ready` thiếu repo (dòng cũ trước TPS-755, khi server chưa luôn
  ghi `repo_path`) thử lần lượt `repoPath` tuyệt đối của việc `ensure-project` mới nhất đã `done` của project trên máy,
  rồi repo gốc bước `inspect` của lần thêm project mới nhất trên máy (`crew_setup_runs.steps.inspect.refs.root`), cùng
  nguồn `knownRepoPath` của server; không có nguồn nào thì máy không dùng được (không bao giờ xếp việc với repo rỗng).
  Dòng `failed` không dùng được. Máy phải
  có repo của project và app báo `jobsAgent.capabilities` có `bug-finding-review`; không thì không xếp việc máy, lượt
  `failed` với lý do (máy chưa có app hỗ trợ: "Mac chưa cập nhật 2P Crew có Bug Finding").
- Kết quả chỉ nhận từ đúng máy được giao (403), đúng head của lượt (422 `head_mismatch`), lượt chưa kết thúc (409);
  `request_id` lạ là 404. Mọi lệnh ghi lượt là compare-and-set trên `state`.
- Hết giờ: `requested` 30 phút chưa máy nào nhận việc (`REQUEST_TIMEOUT_MS`), hoặc 8 giờ kể từ lúc xếp chưa có kết quả
  (`RESULT_TIMEOUT_MS`, gồm cả lúc app chờ mạng hay tài nguyên).
- Bỏ qua Bug Finding chỉ khi owner của stage duyệt đã chấp nhận thẻ `request_confirmation` của reviewer (khóa
  `crew-bf-skip:<issueId>:…`) sau lượt hỏng; lượt hỏng của head hiện tại thành `skipped`, gate cho qua.

## Điểm vào

- Sự kiện plugin `issue.updated` → `handleIssueUpdated`: ticket tổng `code-bf` đang `in_review` ở stage cầu nối thì xếp
  lượt.
- Job `bug-finding-watchdog` (mỗi phút) → `runBugFindingWatchdog`.
- Route plugin (đường `/api/plugins/crew.core/api/...`) → `handleBugFindingApi`:
  - `POST /bug-finding/request` (`bug-finding.request`, agent; company của agent gọi), body `{issueId}`: chỉ reviewer
    của stage cầu nối; trả `{run}` (201 khi xếp mới, 200 khi đã có);
  - `POST /bug-finding/results` (`bug-finding.results`, board key của máy), body `{companyId, machineId, requestId,
    state, round?, headSha, lanesDone?, lanesTotal?, verdict?, costUsd?, error?, findings?, reportMarkdown?}`;
  - `GET /issues/:issueId/bug-finding` (`bug-finding.get`, board hoặc agent) → `{runs, batchesUsed, maxBatches: 2,
    currentHead, approvalRound}`; mỗi lượt có thêm `triage` (kế hoạch của Trợ Lý, `null` khi chưa có); kiểu body cho
    web ở `packages/crew-plugin/src/shared-web/bug-finding.ts` (`BugFindingView`, chỉ kiểu);
  - `POST /bug-finding/skip` (`bug-finding.skip`, agent reviewer), body `{issueId}`.

## Các bước

1. `packages/crew-plugin/src/bug-finding/enqueue.ts` → `handleIssueUpdated`: đọc issue, `bridgeStage` (policy `code-bf`,
   `in_review`, `executionState.currentStageId` là stage 1), rồi `enqueueBugFinding`. Lượt hỏng ngay lúc xếp thì báo và
   đánh thức reviewer.
2. `packages/crew-plugin/src/bug-finding/enqueue.ts` → `enqueueBugFinding`: `latestCrewPr` lấy head PR; `approvalRound`
   đọc vòng; đã có lượt cho vòng + head thì trả lượt đó; vòng đủ 3 lượt thì không xếp (`runs_exhausted`); chọn máy
   (`chooseMachine`), khóa project (`projectKeyOf`: `crew_setup_runs` của wizard, không có thì từ đường
   `~/crew-agents/<khóa>/repo`, không có nữa thì từ tên agent integrator của ticket `<khóa>-integrator`, cách app 2P Crew
   và crew-mac đặt tên agent vai trò; project dựng bằng crew-mac hay repo ngoài `~/crew-agents` chỉ có nguồn này; vẫn
   không ra khóa thì lượt `failed` "Không xác định được khóa project trên máy"), nhánh
   gốc (`project_repos.branch`), phản hồi người review (`feedbackText`: khối `crew-bf-feedback` trong comment mới nhất có
   khối này của Trợ Lý, `executionState.returnAssignee`, viết sau lượt trước); ghi lượt `requested` (`ON CONFLICT DO
   NOTHING` trên khóa duy nhất), rồi việc máy `bug-finding-review` (flow `machine-jobs`) và gắn `machine_job_id`.
3. `packages/crew-plugin/src/bug-finding/api.ts` → `resultsRoute`: kiểm body (`parseReport`; finding chỉ giữ 12 trường
   `FINDING_KEYS`, báo cáo tối đa `REPORT_MAX_BYTES` 2 MB), kiểm máy, head, trạng thái, rồi ghi tiến độ. Kết quả cuối
   (`succeeded`, `failed`, `cancelled`) → `finishRun`: ghi báo cáo `.md` thành document của issue (key
   `bug-finding-round-<vòng>-run-<n>`, lưu ở `report_document_key`), rồi `announceRun`.
4. `packages/crew-plugin/src/bug-finding/runs.ts` → `announceRun`: comment hệ thống, dòng đầu
   `crew-bugfinding run=<n> sha=<head> verdict=<v> open=<k> state=<state>` (verdict viết liền bằng `_`, `none` khi không
   có; `open` đếm finding `OPEN`, `STILL_PRESENT`, `REGRESSED`, `PARTIALLY_FIXED`, `UNABLE_TO_VERIFY`), rồi đánh thức
   assignee khi `executionState.currentParticipant` là agent (reason `crew_bug_finding_result`, khóa idempotency theo
   `requestId` + `state`). Lỗi comment hay đánh thức chỉ ghi log.
5. `packages/crew-plugin/src/bug-finding/watchdog.ts` → `runBugFindingWatchdog`: với mỗi lượt mở (`listOpenRuns`, kèm
   trạng thái việc máy): việc `done` → `queued`; việc `failed`/`cancelled` khi lượt còn `requested` → `failed` với mã và
   lỗi của việc; `requested` quá 30 phút → `timeout` và hủy việc còn chờ; `queued`/`running` quá 8 giờ → `timeout`. Lượt
   kết thúc được `announceRun`.
6. `packages/crew-plugin/src/bug-finding/api.ts` → `getRoute`, `requestRoute`, `skipRoute`: đọc sổ (`batchesUsed`: số
   head PR khác nhau trong vòng trừ 1), reviewer xếp lại, owner cho bỏ qua. `getRoute` gắn kế hoạch của Trợ Lý vào lượt
   `succeeded` bằng `packages/crew-plugin/src/bug-finding/triage.ts` → `attachTriage`: Trợ Lý là
   `executionState.returnAssignee`, không có thì assignee nếu không phải agent stage gộp/cầu nối (`triageAuthor`); chọn
   comment `crew-bf-triage run=<lượt> batch=bf-fix-<k> fix=… ask=… dismiss=…` mới nhất của Trợ Lý viết sau khi lượt
   xong và trước lượt kế tiếp (`parseTriage`, dòng sau là `F-xx: <lý do>`; comment của agent khác bị bỏ qua); việc con
   sửa (mô tả có `crew-bf finding=<F-xx[,F-yy]> run=<lượt>`, tạo trong cùng khoảng) thành `fixIssues` theo id finding.
   Web (flow `issues-web`) chia finding thành ba nhóm theo kế hoạch này.
7. `server/src/crew/bug-finding-runs.ts` → `readBugFindingRuns`: reader mặc định của gate stage cầu nối
   (`setBugFindingRunReader` của `issue-gate.ts` chỉ để test thay); `bumpBugFindingRound`: H2 gọi khi owner yêu cầu sửa
   ticket tổng `root-bf` ở stage duyệt. Bảng chưa có (plugin chưa nâng cấp) thì như chưa có lượt, không ghi vòng.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `packages/crew-plugin/src/bug-finding/api.ts` | Route request, results, get, skip | `handleBugFindingApi`, `REPORT_MAX_BYTES` |
| `packages/crew-plugin/src/bug-finding/enqueue.ts` | Xếp lượt, chọn máy, sự kiện, đăng ký | `enqueueBugFinding`, `handleIssueUpdated`, `bridgeStage`, `latestCrewPr`, `feedbackText`, `registerBugFinding` |
| `packages/crew-plugin/src/bug-finding/runs.ts` | Kiểu, SQL sổ lượt, vòng, báo kết quả | `listRuns`, `getRunByRequest`, `approvalRound`, `batchesUsed`, `announceRun`, `MAX_RUNS`, `MAX_BATCHES` |
| `packages/crew-plugin/src/bug-finding/triage.ts` | Kế hoạch `crew-bf-triage` của Trợ Lý và việc con sửa cho từng lượt | `attachTriage`, `parseTriage`, `triageAuthor` |
| `packages/crew-plugin/src/shared-web/bug-finding.ts` | Kiểu body route GET cho web (chỉ kiểu) | `BugFindingView`, `BugFindingRunView` |
| `packages/crew-plugin/src/bug-finding/watchdog.ts` | Job hết giờ và đối chiếu việc máy | `runBugFindingWatchdog`, `REQUEST_TIMEOUT_MS`, `RESULT_TIMEOUT_MS` |
| `packages/crew-plugin/migrations/0025_bug_finding.sql` | Bảng lượt, bảng vòng, kind việc máy | `crew_bug_finding_runs`, `crew_bug_finding_rounds` |
| `server/src/crew/bug-finding-runs.ts` | Server đọc lượt cho gate, ghi vòng | `readBugFindingRuns`, `bumpBugFindingRound` |

## Dữ liệu

- `crew_bug_finding_runs`: `approval_round`, `run` (1–3), `request_id` (duy nhất), `machine_job_id`, `machine_id`,
  `head_sha` (40 hex), `pr_url`, `state` (`requested`, `queued`, `running`, `succeeded`, `failed`, `timeout`,
  `cancelled`, `skipped`), `verdict` (`APPROVE`, `APPROVE WITH CONDITIONS`, `BLOCK`), `lanes_done`, `lanes_total`,
  `findings` (mảng finding 12 trường), `feedback_text` (tối đa 20 000 ký tự), `report_document_key`, `cost_usd`,
  `error` (tối đa 300 ký tự), mốc giờ; duy nhất `(issue_id, approval_round, head_sha, run)`.
- `crew_bug_finding_rounds`: `(company_id, issue_id)` → `round`; chỉ server ghi.
- Capability mới của manifest: `issue.documents.write` (báo cáo), `issue.interactions.read` (thẻ xác nhận bỏ qua). Báo
  cáo là document của issue thay cho file đính kèm: plugin SDK của host chưa có lệnh tạo file đính kèm, còn vá SDK và
  `packages/shared` thì `crew/ops/overlay-source.sh` không ship được.
- Log: `crew bug finding run requested`, `crew bug finding run ended`, `crew bug finding skipped`.
- Bên làm: app 2P Crew trên Mac (repo `crew`, việc `bug-finding-review` và gửi kết quả) và app Bug Finding (repo
  `bug-finding`).

## Flow liên quan

- `issue-gate`: policy `root-bf`, gate `bf_missing` của stage cầu nối, chạy lại từ stage gộp.
- `machine-jobs`: việc `bug-finding-review`.
- `machine-status`: `jobsAgent.capabilities` trong bản tin máy.
- `multi-machine`: `issue_machine_pins`, `project_machines`, `project_repos`.
- `crew-plugin`: worker chia `routeKey` tiền tố `bug-finding.`, đăng ký sự kiện và job.
- `issues-web`: dải giai đoạn, khối Bug Finding và màn Duyệt và merge trên ticket tổng `code-bf` đọc route GET.

## Tests

- `packages/crew-plugin/src/__tests__/bug-finding.db.test.ts`: vào stage cầu nối xếp đúng một việc và một lượt, vào
  lại cùng head không xếp thêm; không xếp khi không ở stage cầu nối, không phải `root-bf` hay chưa có `crew-pr`; máy ghim
  chưa có app thì lượt `failed`; máy ghim còn `provisioning` mà việc `ensure-project` đã `done` thì chọn máy ghim với
  `repoPath` của việc và không đổi dòng, việc chưa xong hay dòng `failed` thì vẫn "Máy đã ghim chưa có repo của project";
  máy ghim `ready` thiếu repo dùng `repoPath` của việc `ensure-project` done mới nhất (việc sau còn chờ không che), không
  có việc thì repo gốc lần thêm project trên đúng máy đó, không có nguồn nào thì lượt `failed` "Máy đã ghim chưa có repo
  của project" và không xếp việc; không ghim thì máy `ready` thiếu repo có việc done vẫn được chọn;
  project không có lần thêm qua wizard, repo ngoài `~/crew-agents` lấy khóa từ tên agent integrator, tên khác dạng thì
  lượt `failed` có lý do; vòng đủ 3 lượt không xếp; owner yêu cầu sửa sang vòng mới; lượt chạy lại mang
  `crew-bf-feedback` của Trợ Lý; request chỉ reviewer và idempotent; results 403/422/404, tiến độ rồi kết quả hợp lệ có
  document báo cáo, comment và wake, gửi lại 409; GET kèm kế hoạch của Trợ Lý (bỏ comment của agent khác); skip chỉ khi owner đã chấp nhận; watchdog hết giờ 30 phút và 8
  giờ, việc máy hỏng thành `failed`, việc nhận xong thành `queued`.
- `server/src/__tests__/crew-issue-gate.db.test.ts`: reader mặc định đọc bảng lượt thật của plugin; owner yêu cầu sửa
  ticket tổng Bug Finding tăng vòng, reviewer cầu nối yêu cầu sửa thì không.
- `packages/crew-plugin/src/__tests__/machine-jobs-validate.test.ts`: payload và result `bug-finding-review`.
- `packages/crew-plugin/src/__tests__/bug-finding-triage.test.ts`: đọc dòng `crew-bf-triage` và lý do, nhóm rỗng `-`;
  Trợ Lý là `returnAssignee` hay assignee; ghép kế hoạch trong khoảng sau lượt xong và trước lượt kế, bỏ comment của
  người khác, việc con sửa theo finding (một con nhiều finding).
- `packages/crew-web/e2e/bug-finding/root-bf.spec.ts` (Playwright, giả toàn bộ `/api/*` bằng `stub.ts`, chạy
  `pnpm exec playwright test -c e2e/bug-finding/playwright.config.ts` từ `packages/crew-web`, web dev cổng 5193): ticket
  tổng `code-bf` hiện dải 4 giai đoạn có "Review Bug Finding", tiến độ lane của lượt đang chạy và ba nhóm kế hoạch của
  Trợ Lý; owner thấy "Duyệt và merge" với kết quả Bug Finding trên đúng commit và gửi `done`; ticket policy `code` cũ
  giữ nút "Duyệt" và không gọi route Bug Finding.

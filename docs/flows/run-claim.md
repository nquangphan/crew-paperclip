# Giữ run khi máy quá tải, nhìn lại run trước và nối phiên trong gói

> Flow `run-claim`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow run-claim` in ra đúng danh sách đó.

## Mục đích

Agent Crew chạy trên Mac qua SSH environment. Trước khi scheduler của Paperclip claim một run `queued`, Crew quyết định
có cho chạy ngay không (hook H1):

- Máy quá tải hay không kết nối được: giữ run ở `queued` thay vì để nó chạy rồi hỏng. Hết hạn chờ thì hủy run, chuyển
  issue sang `blocked` và comment lý do.
- Run trước trên cùng environment đang được dừng (H3 chưa xong): chờ để hai run không chạy cùng worktree.
- Run thử lại (`retryOfRunId`) hoặc run đầu sau khi chuyển runtime: dừng phần còn sót của run trước rồi liệt kê commit
  nó đã làm vào comment issue, để agent làm tiếp thay vì làm lại. Không kiểm được thì giữ run như máy không kết nối,
  không chạy mù.
- Issue con thuộc một gói (`crew-bundle`): nối lại phiên Claude/Codex của issue liền trước trong gói, để agent giữ ngữ
  cảnh mà không phải đọc lại từ đầu.

## Điểm vào

- H1 trong `server/src/services/heartbeat.ts` → `heartbeatService.claimQueuedRun`: gọi `crewCoreHooks.beforeClaim`
  (trả `true` thì claim trả `null`, scheduler thử lại ở tick sau).
- Cổng tải chỉ bật cho environment SSH đang `active` có `metadata.crewLoadGate` hợp lệ (`maxLoad1`, `maxWaitMinutes`
  mặc định 60). Không có thì chỉ còn công tắc runtime áp dụng.
- Marker `crew-bundle id=<id> seq=<n>` do Trợ Lý ghi trong mô tả issue con.

## Các bước

1. `server/src/crew/core-hooks.ts` → `beforeClaim`: gọi `crewBeforeClaim`; không giữ run thì `applyBundleResumeSafely`.
2. `server/src/crew/load-gate.ts` → `crewBeforeClaim`, `evaluateBeforeClaim`, `decideBeforeClaim`:
   - run không ở `queued` thì không giữ;
   - trước mọi kiểm khác, hỏi cổng ghim máy (`machineGate`, flow `multi-machine`): `hold` thì giữ run (marker
     `NEVER_STARTED`), `fail` thì hủy run và chuyển issue sang `blocked`, `pass` kèm environment trên máy ghim thì cổng
     tải đọc environment đó thay cho environment mặc định; cổng ném lỗi thì giữ run;
   - lệnh dừng run trước còn dở (`crew.remote_stop.started` chưa có kết quả, trong `REMOTE_STOP_PENDING_WINDOW_MS`) thì
     giữ, không ghi dấu;
   - đã hết hạn trước đó thì giữ và thử lại việc hủy và comment còn thiếu;
   - đo tải bằng `sysctl -n vm.loadavg` qua SSH (`createProbeCache`: một lần đo mỗi `LOAD_GATE_PROBE_TTL_MS`, cache cả
     lỗi; cache theo host và cổng SSH (`probeKeyOf`), mọi environment cùng máy dùng chung một lần đo); `decideGate`
     trả `claim`, `wait` hoặc `expire`;
   - chỉ run đứng đầu hàng của mỗi agent trong một lượt đo (`isHeadOfLine`) mới tính giờ chờ, ghi dấu và comment; run
     phía sau chỉ chờ lượt;
   - được claim thì hỏi tiếp công tắc runtime (`runtimeGate`, flow `runtime-switches`), rồi kiểm tiến độ run trước khi
     là retry hoặc run sau fallback (`progressCheck`). Worktree cũ còn thay đổi chưa commit khi fallback thì chặn issue
     và hủy run.
   Run bị giữ được đánh dấu `NEVER_STARTED` trong `resultJson`, để recovery stock không đòi bằng chứng dừng của một run
   chưa từng chạy; dấu được gỡ khi run được claim (`hasNeverStartedMarker`, `cancelIfStale`).
3. `server/src/crew/retry-progress.ts` → `createRetryProgressChecker`, `buildRetryProgressCommand`,
   `parseRetryProgressOutput`: một lệnh SSH dừng run trước (cùng script với H3), in giờ Mac, liệt kê commit trên mọi
   nhánh local; khi fallback thì tách worktree cũ khỏi nhánh issue `crew/<identifier>` (`CREW_ISSUE_BRANCH_RE`) nếu nó
   sạch. Cửa sổ thời gian lấy từ `startedAt` của run trước, bù lệch đồng hồ Mac và nới `RETRY_SINCE_SLACK_MS`.
   `retryProgressComment` dựng comment.
4. `server/src/crew/bundle-resume.ts` → `applyBundleResume`: `parseCrewBundle` đọc marker; `findBundlePredecessor` chọn
   blocker trực tiếp cùng gói, `seq` nhỏ hơn, đã `done`, có session của cùng agent (`pickBundlePredecessor`). Session
   lấy từ task session, kết quả run, hoặc dòng init trong log run. Ghi `resumeFromRunId`, `resumeSessionParams`,
   `resumeSessionDisplayId` vào `contextSnapshot` (có điều kiện run còn `queued` và chưa có tham số resume) cùng
   transaction với activity. Mọi lỗi thì run mở phiên mới như stock.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `server/src/crew/load-gate.ts` | Cổng claim: tải máy, chờ dừng, hết hạn, gọi kiểm tiến độ và công tắc runtime | `crewBeforeClaim`, `evaluateBeforeClaim`, `decideGate`, `readLoadGateSettings`, `NEVER_STARTED`, `REMOTE_STOP_PENDING_WINDOW_MS`, `defaultBeforeClaimDeps` |
| `server/src/crew/retry-progress.ts` | Nhìn lại commit của run trước qua SSH | `createRetryProgressChecker`, `buildRetryProgressCommand`, `parseRetryProgressOutput`, `retryProgressComment`, `RETRY_PROGRESS_TIMEOUT_MS` |
| `server/src/crew/bundle-resume.ts` | Nối phiên trong gói issue | `applyBundleResume`, `applyBundleResumeSafely`, `findBundlePredecessor`, `CREW_BUNDLE_RE` |
| `server/src/services/heartbeat.ts` | File upstream chứa H1 | `heartbeatService.claimQueuedRun` |

## Dữ liệu

- Bảng lõi: đọc `heartbeat_runs`, `environments`, `environment_leases`, `issues`, `activity_log`; ghi
  `heartbeat_runs.contextSnapshot`/`resultJson`, `issues.status` (`blocked` khi hết hạn hay worktree bẩn), comment issue.
- Activity: `crew.load_gate.waiting`, `crew.load_gate.expired` và bản `_comment` của chúng; `crew.retry_progress.checked`
  và `crew.runtime_fallback.checked` cùng marker comment; `crew.bundle_resume`. Đọc `crew.remote_stop.started`.
- Gọi ngoài: SSH tới Mac (`runSshCommand`): `sysctl -n vm.loadavg`, lệnh dừng run, `git log`, `git switch --detach`.
- Cấu hình: `environments.metadata.crewLoadGate`.

## Flow liên quan

- `core-hooks`: đăng ký H1.
- `multi-machine`: cổng ghim máy (`evaluateMachineGate`) hỏi trước cổng tải.
- `runtime-switches`: `runtimeGate` hỏi sau cổng tải.
- `runtime-fallback`: run trước của một fallback đọc từ quyết định runtime (`fallbackPreviousRunId`).
- `ssh-run-lifecycle`: lệnh dừng run dùng chung (`buildRemoteStopCommand`) và activity `crew.remote_stop.*`.
- `agent-roles`: Trợ Lý ghi marker `crew-bundle`.
- `multi-machine`: `heartbeat.ts` có thêm vá C16 chọn environment của run theo máy đã ghim cho cây yêu cầu; lease SSH,
  lệnh dừng và retry vì vậy luôn ở máy đó.

## Tests

- `server/src/__tests__/crew-load-gate.test.ts`: đọc `crewLoadGate`, parse `vm.loadavg`, cache lần đo (cả lỗi),
  `decideGate`, các nhánh `evaluateBeforeClaim` (chờ, hết hạn, đầu hàng, kiểm tiến độ, cổng ghim máy `pass`/`hold`/`fail`
  và ném lỗi), khóa cache đo theo host `probeKeyOf`.
- `server/src/__tests__/crew-before-claim.test.ts`: scheduler giữ run khi hook trả `true`; hủy khi hết hạn không bị kẹt
  khóa start của agent; agent không có environment có cổng thì claim như cũ.
- `server/src/__tests__/crew-load-gate-cancel.test.ts`: dấu chưa bắt đầu với stale gate stock và recovery; hai lần đánh
  giá song song; lệnh dừng dở sau khi server khởi động lại giữ claim tối đa 120 giây.
- `server/src/__tests__/crew-retry-progress.test.ts`: dựng lệnh, đọc commit trong cửa sổ có bù lệch đồng hồ, danh sách
  bị cắt, lỗi khi run trước còn process, nội dung comment.
- `server/src/__tests__/crew-bundle-resume.test.ts`: parse marker, chọn tiền nhiệm, fail open, thứ tự cổng tải rồi mới
  nối phiên.
- `server/src/__tests__/crew-claim-resume-contract.test.ts`: với mọi lý do wake, adapter nhận đúng session được ghi.
- `server/src/crew/crew-bundle-resume.cancelled.test.ts`: run trước bị hủy vì đổi assignee vẫn nhường session; đọc init
  từ log đúng run; chọn identity MCP; giới hạn đọc log.

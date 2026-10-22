# Run qua SSH trên Mac: chạy tại chỗ, dừng từ xa, biên nhận dừng

> Flow `ssh-run-lifecycle`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow ssh-run-lifecycle` in ra đúng danh sách đó.

## Mục đích

Agent Crew chạy trên Mac qua SSH environment của Paperclip. Driver SSH gốc thiếu ba thứ mà Crew cần:

- Chạy tại chỗ (`in_place`): agent làm thẳng trong checkout trên Mac (nơi có nhánh, hook và `crew-docs`), thay vì chép
  workspace lên rồi chép về.
- Dừng thật: khi lease được nhả (run xong, bị hủy, bị reap sau khi server khởi động lại, lỗi), process của run trên Mac
  phải bị dừng, để run sau không chạy cạnh process cũ trong cùng worktree.
- Biên nhận dừng: lõi chỉ cho tin nhắn mới của người dùng chạy tiếp sau một run remote khi mọi lease của run có biên nhận
  dừng (`remoteExecutionTermination`). Driver SSH gốc không bao giờ ghi biên nhận, nên tin nhắn bị hoãn mãi
  (`remote_cleanup`), và lease ở `pending_cleanup` thất bại `destroy_failed` mãi.

Crew chỉ ghi biên nhận khi có một trong hai bằng chứng: lệnh dừng trên Mac chạy và không còn process nào của run
(`remote_stop_verified`), hoặc dữ liệu server chứng minh adapter chưa từng được gọi cho run (`never_started`). Không có
bằng chứng thì không ghi, và lõi giữ tin nhắn như trước.

## Điểm vào

- Vá P1 trong `server/src/services/environment-runtime.ts` → `createSshEnvironmentDriver.acquireRunLease`: thêm
  `sshLeaseWorkspaceRealization` vào metadata lease.
- H3 trong `createSshEnvironmentDriver.releaseRunLease` → `crewCoreHooks.onRunLeaseReleased` →
  `startRemoteStopOnRelease`.
- Vá P8: `createSshEnvironmentDriver.retryPendingSandboxTeardown` → `retrySshPendingTeardown`, do vòng dọn
  `pending_cleanup` của lõi gọi.
- Vá C9 trong `server/src/services/heartbeat.ts`: lộ `acknowledgeRemoteStop` của lõi để Crew gọi sau khi ghi biên nhận.
- Vá P2, P6 trong adapter (flow `adapter-patches`): adapter đọc `workspaceRealization.mode === "in_place"`.

## Các bước

1. `server/src/crew/ssh-in-place.ts` → `sshLeaseWorkspaceRealization`: environment có
   `metadata.workspaceRealizationMode = "in_place"` thì lease mang `workspaceRealization: { mode: "in_place" }`; còn lại
   giữ chế độ chép.
2. `server/src/crew/remote-stop.ts` → `startRemoteStopOnRelease`: ghi `crew.remote_stop.started`, chạy lệnh dừng ở nền
   rồi trả về ngay để lease được đánh dấu nhả (lõi coi lease chưa nhả là chủ thực thi còn sống và bỏ wake của người kế
   tiếp). Lease không gắn run hoặc driver không phải SSH thì bỏ qua. Dừng nền quá `REMOTE_STOP_BACKGROUND_LIMIT_MS` thì
   ghi là không tới được. Sau khi dừng: ghi biên nhận và phát lại wake bị bỏ (`rewakeAfterLeaseRelease`, flow
   `run-handoff`).
3. `server/src/crew/remote-stop.ts` → `buildRemoteStopCommand`, `CREW_REMOTE_STOP_SCRIPT`, `parseRemoteStopOutput`: một
   lệnh `sh` trên Mac. Có `~/.crew/bin/crew-mac` và biết thư mục gốc thì gọi `crew-mac stop-run`; không thì dùng script
   dự phòng tìm process theo nhóm process ghi trong `.paperclip-runtime/runs/<run>/pgid` (có kiểm thời điểm bắt đầu để
   tránh PGID tái dùng) và theo token `PAPERCLIP_RUN_ID` trong env; TERM, chờ, rồi KILL. Dòng cuối là tổng kết
   `crew-stop matched=… killed=… remaining=…`. Toàn bộ lệnh giới hạn `REMOTE_STOP_TIMEOUT_MS`, dưới mức chờ 15 giây của
   H3.
4. `server/src/crew/remote-termination.ts` → `settleSshRemoteTermination`, `recordSshRemoteTermination`,
   `sshTerminationProof`, `legacyRunNeverLaunched`: ghi biên nhận lên lease đã nhả (rào theo cùng lease, run và provider
   lease id), rồi gọi `acknowledgeRemoteStop` (C9) và để lõi đánh giá lại tin nhắn đã hoãn.
5. `server/src/crew/ssh-pending-teardown.ts` → `retrySshPendingTeardown`: trả biên nhận `stopped` cho vòng dọn của lõi khi
   có bằng chứng; không thì ném lỗi (câu cố định, không kèm host hay credential) để lõi thử lại theo backoff. Mỗi lần
   lỗi ghi `crew.remote_stop`; tới `SSH_TEARDOWN_ESCALATION_ATTEMPTS` lần thì ghi một lần
   `crew.remote_stop.escalated` để owner kiểm máy.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `server/src/crew/remote-stop.ts` | H3: dừng run trên Mac khi nhả lease | `startRemoteStopOnRelease`, `stopRemoteRunOnRelease`, `buildRemoteStopCommand`, `CREW_REMOTE_STOP_SCRIPT`, `REMOTE_STOP_TIMEOUT_MS`, `isRemoteStopPending` |
| `server/src/crew/remote-termination.ts` | Biên nhận dừng cho lease SSH | `settleSshRemoteTermination`, `recordSshRemoteTermination`, `legacyRunNeverLaunched` |
| `server/src/crew/ssh-pending-teardown.ts` | Vá P8: dọn lease `pending_cleanup` | `retrySshPendingTeardown`, `SSH_TEARDOWN_ESCALATION_ATTEMPTS` |
| `server/src/crew/ssh-in-place.ts` | Vá P1: chế độ chạy tại chỗ | `sshLeaseWorkspaceRealization` |
| `server/src/services/environment-runtime.ts` | File upstream chứa H3, P1, P8 | `createSshEnvironmentDriver` |
| `server/src/services/heartbeat.ts` | File upstream chứa C9 | `acknowledgeRemoteStop` |
| `packages/adapters/claude-local/src/server/execute.ts` | File upstream chứa P2 (chạy tại chỗ) | `execute` |
| `packages/adapters/opencode-local/src/server/execute.ts` | File upstream chứa P6 (chạy tại chỗ) | `execute` |

## Dữ liệu

- Bảng lõi: `environment_leases` (metadata lease, biên nhận dừng), `heartbeat_runs` và `heartbeat_run_events` (bằng chứng chưa khởi chạy),
  `activity_log`.
- Activity: `crew.remote_stop.started`, `crew.remote_stop` (kết quả, kể cả không tới được hay hết giờ),
  `crew.remote_stop.escalated`.
- Gọi ngoài: SSH tới Mac, chạy `crew-mac stop-run` hoặc script dự phòng.
- Cấu hình: `environments.metadata.workspaceRealizationMode`.

## Flow liên quan

- `core-hooks`: đăng ký H3, P1, P8, C9.
- `run-claim`: cổng claim giữ run trên cùng environment khi lệnh dừng còn dở; lệnh dừng dùng lại khi kiểm tiến độ run
  trước.
- `run-handoff`: phát lại wake bị bỏ sau khi lease nhả.
- `adapter-patches`: phía adapter của chế độ chạy tại chỗ và giữ session cho run SSH.

## Tests

- `server/src/__tests__/crew-remote-stop.test.ts`: script dừng trên shell thật: ghi nhóm process, dừng nhóm khi `ps`
  không đọc được env, KILL khi bỏ qua TERM, tìm theo token, không đụng run khác, bỏ nhóm có PGID tái dùng; ủy cho
  `crew-mac stop-run` và rơi về script dự phòng.
- `server/src/__tests__/crew-remote-stop-release.test.ts`: lease nhả trước khi SSH xong; ghi kết quả cả khi không còn
  process, khi SSH lỗi, khi treo quá giới hạn; lease không gắn run thì không đánh dấu.
- `server/src/__tests__/crew-remote-termination.db.test.ts`: tái hiện tin nhắn bị hoãn khi thiếu biên nhận; ghi biên
  nhận cho run chưa khởi chạy và run đã dừng xác minh; tin nhắn mới được nhận ngay sau đó.
- `server/src/__tests__/crew-ssh-pending-teardown.db.test.ts`: P8 trả biên nhận khi có bằng chứng, giữ lease và báo một
  lần khi chưa xác minh được, nhả lease kẹt từ trước, xác nhận Stop sau khi ghi biên nhận.
- `server/src/__tests__/crew-ssh-in-place.test.ts`: metadata lease theo `workspaceRealizationMode`, P1 trong
  `acquireRunLease`.

# Bàn giao giữa vai trò, đánh thức lại và run bị hủy

> Flow `run-handoff`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow run-handoff` in ra đúng danh sách đó.

## Mục đích

Một yêu cầu Crew đi qua nhiều agent: executor nộp cho reviewer, reviewer chuyển cho integrator, có khi trả về. Mỗi lần
bàn giao, Paperclip gốc hủy run cũ và đánh thức người kế tiếp, và có vài chỗ issue bị kẹt không ai chạy. Flow này gom
các chỗ Crew sửa cho bàn giao trơn tru:

- Wake bị bỏ vì run cũ còn giữ lease environment: lõi ghi wake của người kế tiếp là `skipped`
  (`execution_reconciliation_required`) và không bao giờ thử lại wake của hệ thống. Crew phát lại wake đó đúng một lần
  khi lease được nhả.
- Run tự bàn giao issue của mình (executor sang reviewer, reviewer sang integrator) không bị hủy nữa, để run chạy hết và
  ghi được chi phí; wake của người mới được hoãn sau nó (vá C11). Run bàn giao mà không comment không sinh wake thiếu
  comment cho agent cũ (C12).
- Run lỗi khi còn giữ lease: sau khi dọn lease, wake bị hoãn của agent khác (reviewer, người mới được giao) được đẩy lên
  (C14).
- Agent vừa tách việc con và để issue gốc `in_progress` không bị đánh thức thêm một run chỉ để nói đang chờ việc con,
  khi việc con còn đường chạy (C13).
- Board hủy một run đang chạy: lõi để issue `in_progress` không có run nào. Plugin chuyển issue sang `blocked` kèm
  comment (không chuyển `todo`, vì issue `todo` có agent sẽ bị lõi chạy lại ngay).

Mô tả và lý do chi tiết của từng vá: `crew/release/core-hooks.json` (C10–C14).

## Điểm vào

- Hook H3 (nhả lease SSH) → `startRemoteStopOnRelease` trong `server/src/crew/remote-stop.ts` gọi
  `rewakeAfterLeaseRelease` sau khi nhả lease.
- Vá C10 trong `server/src/index.ts`: mỗi tick scheduler heartbeat, sau chuỗi recovery định kỳ của lõi, gọi
  `replayStrandedSkippedWakes`.
- Vá C11 trong `server/src/routes/issues.ts` (`PATCH /issues/:id`, đoạn dừng run khi đổi assignee); C12, C14 trong
  `server/src/services/heartbeat.ts`; C13 trong `server/src/services/recovery/service.ts`.
- Sự kiện plugin `agent.run.cancelled` → `registerRunCancelledHandler` (đăng ký trong
  `packages/crew-plugin/src/worker.ts`).

## Các bước

1. `server/src/crew/handoff-rewake.ts` → `rewakeAfterLeaseRelease`: ngay sau khi lease nhả, tìm wake bị bỏ của issue và
   phát lại qua `heartbeat.wakeup` của lõi (`replaySkippedWake`): chỉ khi chưa phát lại lần nào, agent chưa có việc
   `queued`/`running` trên issue và issue không còn chặn thực thi. Lý do wake gốc được khôi phục từ payload
   (`replayedWakeReason`). Không bao giờ ném lỗi.
2. `server/src/crew/handoff-rewake.ts` → `replayStrandedSkippedWakes`: lưới an toàn cho trường hợp lease được nhả không
   qua H3 (reaper chuyển lease sang `pending_cleanup` và nhả qua vá P8). Phát lại wake bị bỏ mới nhất của assignee hiện
   tại khi wake cũ hơn `HANDOFF_REWAKE_SWEEP_MIN_AGE_MS`, trẻ hơn `HANDOFF_REWAKE_SWEEP_LOOKBACK_MS`, không do recovery
   action giữ, issue không `done`/`cancelled`/`blocked`, stage vẫn chờ đúng agent đó (`stageWakeStillCurrent`), và
   agent chưa có wake hay run nào sau đó.
3. `packages/crew-plugin/src/run-cancelled.ts` → `registerRunCancelledHandler`: chỉ xử lý run đã bắt đầu, bị hủy với mã
   `cancelled` hoặc không mã (hủy tự động của lõi có mã riêng và kèm lệnh ghi chuyển issue, chen vào sẽ đua); issue còn
   `in_progress`, đúng assignee, không bị run khác giữ thì chuyển `blocked` và comment.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `server/src/crew/handoff-rewake.ts` | Phát lại wake bị bỏ khi lease nhả và theo tick | `rewakeAfterLeaseRelease`, `replayStrandedSkippedWakes`, `stageWakeStillCurrent`, `HANDOFF_REWAKE_ACTION` |
| `packages/crew-plugin/src/run-cancelled.ts` | Issue sang `blocked` khi board hủy run | `registerRunCancelledHandler` |
| `server/src/index.ts` | File upstream chứa C10 | tick scheduler heartbeat |
| `server/src/routes/issues.ts` | File upstream chứa C11 | `PATCH /issues/:id` |
| `server/src/services/heartbeat.ts` | File upstream chứa C12, C14 | `finalizeIssueCommentPolicy`, `executeRun` |
| `server/src/services/recovery/service.ts` | File upstream chứa C13 | `decidePersistedLegacyContinuation`, `healthyOpenChildIssues` |

## Dữ liệu

- Bảng lõi: đọc `agent_wakeup_requests` (wake `skipped`), `heartbeat_runs`, `issues`; ghi wake mới
  qua `heartbeat.wakeup`; plugin ghi `issues.status` và comment qua host.
- Activity: `crew.handoff_rewake` (dấu đã phát lại), `crew.handoff_rewake.failed`.
- Sự kiện plugin nghe: `agent.run.cancelled`.

## Flow liên quan

- `core-hooks`: đăng ký H3 và các vá C10–C14.
- `ssh-run-lifecycle`: H3 và vá P8 là hai đường nhả lease dẫn tới việc phát lại wake.
- `issue-gate`: luật stage và assignee.
- `runtime-fallback`: test của vá C14 nằm ở flow đó.
- `multi-machine`: `heartbeat.ts` có thêm vá C16 chọn environment của run theo máy đã ghim cho cây yêu cầu; lease SSH,
  lệnh dừng và retry vì vậy luôn ở máy đó.

## Tests

- `server/src/__tests__/crew-handoff-rewake.test.ts`: wake bị bỏ được phát lại đúng một lần sau khi lease nhả; wakeup
  lỗi thì ghi activity lỗi và lần sau thử lại; không đánh thức khi issue đã `blocked`, không có wake bị bỏ, hay agent
  không còn là assignee.
- `server/src/__tests__/crew-handoff-rewake-sweep.db.test.ts`: vòng quét cứu issue khi lease được nhả bởi reaper, kể cả
  issue đã kẹt lâu; không phát lại khi lease còn giữ, stage đã đổi, issue bị chặn, agent đã có run, hay wake thuộc
  recovery action.
- `server/src/__tests__/crew-run-cancelled.test.ts`: chuyển `blocked` khi run đã chạy bị hủy bởi người; bỏ qua run hủy
  khi còn `queued`, issue của run khác, issue đã đổi người, run không có issue; khai đủ capability.
- `server/src/__tests__/crew-self-handoff-run.db.test.ts`: run tự bàn giao chạy hết và ghi chi phí; không xếp wake
  thiếu comment cho agent đã bàn giao; board hay agent khác đổi assignee vẫn hủy run cũ.
- `server/src/__tests__/crew-failed-run-deferred-review.db.test.ts`: run executor lỗi khi còn giữ lease thì reviewer
  được chạy sau khi dọn lease (vá C14).

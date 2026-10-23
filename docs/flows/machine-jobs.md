# Hàng đợi việc trên máy (machine jobs)

> Flow `machine-jobs`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow machine-jobs` in ra đúng danh sách đó.

## Mục đích

Một số việc chỉ làm được trên Mac chạy agent: soi thư mục repo, tạo checkout cho agent, đồng bộ hay gỡ skill, chạy
kiểm tra máy, gỡ checkout, cài runtime. Server không SSH vào làm hộ; board xếp việc vào hàng đợi trong plugin, app 2P
Crew trên Mac dùng board key để nhận việc của đúng máy đó và báo kết quả. Web chỉ thấy kết quả đã kiểm dạng và đã làm
sạch.

Luật chính:

- Chỉ actor board được tạo, nhận, báo, thử lại, hủy việc; agent không bao giờ xếp được việc lên máy.
- Payload kiểm theo loại việc trước khi xếp (`validateJobPayload`); app kiểm lại trước khi làm. Kết quả chỉ giữ trường
  đã biết (`validateJobResult`); lỗi từ Mac bỏ mã điều khiển, che credential và cắt `JOB_ERROR_MAX` ký tự.
- Nhận việc không có transaction (host chạy mỗi câu SQL riêng), nên mỗi bước là một câu nguyên tử: trả lease hết hạn
  về hàng đợi, rồi compare-and-set `status = 'queued'`. Hai máy nhận cùng lúc chỉ một bên được.
- Lease `JOB_LEASE_MINUTES` (17 phút, luôn dài hơn hạn 15 phút của app); hết lease quá `JOB_MAX_ATTEMPTS` lần thì `failed` với `lease_expired`. Kết quả của lần
  nhận cũ tới sau khi việc đã được nhận lại thì bị từ chối.
- Lỗi DB trả câu cố định cho người gọi, chi tiết chỉ vào log server.

## Điểm vào

- Route plugin (board): `POST /machine-jobs` (`jobs.create`), `GET /machine-jobs` (`jobs.list`),
  `POST /machine-jobs/claim`, `POST /machine-jobs/:jobId/result`, `POST /machine-jobs/:jobId/retry`,
  `POST /machine-jobs/:jobId/cancel` → `handleJobsApi`.
- Data key `crew.machineJobs` → `loadMachineJobs`.
- crew-web: hàng đợi trên trang Máy (`JobsQueue`); các wizard xếp việc qua `jobsApi.create`.

## Các bước

1. `packages/crew-plugin/src/jobs/api.ts` → `handleJobsApi`: kiểm `routeKey`, actor board, khóa body cho phép, rồi
   chia theo route.
2. `packages/crew-plugin/src/jobs/validate.ts` → `validateJobPayload`: kiểm payload theo `MachineJobKind` (thư mục,
   khóa project, ô vai trò...). Việc gắn một lần cài đặt phải dùng đúng khóa project của lần đó.
3. `packages/crew-plugin/src/jobs/data.ts` → `insertJob`, `listJobs` (mới nhất trước, tối đa `JOB_LIST_LIMIT`).
4. `packages/crew-plugin/src/jobs/data.ts` → `claimNextJob`: trả lease hết hạn về hàng đợi, lấy việc cũ nhất của đúng
   máy và company.
5. `packages/crew-plugin/src/jobs/data.ts` → `finishJob`: ghi kết quả chỉ khi việc còn được máy đó nhận (và đúng lần
   nhận nếu app gửi `claimedAt`); kết quả qua `validateJobResult` và lỗi qua `sanitizeJobError`
   (`packages/crew-plugin/src/jobs/sanitize.ts`).
6. `packages/crew-plugin/src/jobs/data.ts` → `retryJob`, `cancelJob`: board thử lại việc lỗi hoặc hủy việc.
7. `packages/crew-web/src/features/machines/jobs-queue.tsx` → `JobsQueue`: liệt kê việc chờ, đang làm và lỗi; việc lỗi
   có nút Thử lại; việc chờ quá `WAITING_APP_AFTER_MS` mà máy không có app nhận việc thì báo chờ app.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `packages/crew-plugin/src/jobs/api.ts` | Route API hàng đợi | `handleJobsApi` |
| `packages/crew-plugin/src/jobs/data.ts` | SQL hàng đợi, data key | `claimNextJob`, `finishJob`, `insertJob`, `listJobs`, `registerJobsData` |
| `packages/crew-plugin/src/jobs/validate.ts` | Kiểm payload và kết quả | `validateJobPayload`, `validateJobResult` |
| `packages/crew-plugin/src/jobs/sanitize.ts` | Làm sạch lỗi từ Mac | `sanitizeJobError`, `maskUrlUserinfo` |
| `packages/crew-plugin/src/jobs/types.ts` | Hợp đồng loại việc, trạng thái, mã lỗi | `MachineJobKind`, `JobErrorCode`, `JOB_LEASE_MINUTES` |
| `packages/crew-web/src/api/crew/jobs.ts` | Client `jobs.create`, `jobs.list`, `jobs.retry` | `jobsApi` |
| `packages/crew-web/src/features/machines/jobs-queue.tsx` | Bảng hàng đợi trên trang Máy | `JobsQueue`, `WAITING_APP_AFTER_MS` |

## Dữ liệu

- Bảng plugin `crew_machine_jobs` (`0006_machine_jobs.sql`; thêm loại việc gỡ ở `0011_removal_kinds.sql`, loại
  `runtimes-setup` ở `0012_runtimes.sql`).
- Loại việc, trạng thái, ô vai trò và mã lỗi: hằng trong `packages/crew-plugin/src/jobs/types.ts`.
- Việc `ensure-project` do server Crew xếp (không qua wizard): payload `projectKey`, `projectId`, `originUrl`, `branch`,
  `roles[]` (`role`, `branch`), `companions[]` (`name`, `originUrl`); result `repoPath`, `cloned`, `checkouts[]`,
  `companions[]`. Clone thiếu quyền báo mã lỗi `clone_auth_failed`.
- Log: `crew machine job changed` (hành động, job, company, user).
- Bên nhận việc: app 2P Crew trên Mac (repo `crew`).

## Flow liên quan

- `setup-wizards`: wizard xếp việc và gắn việc vào một lần cài đặt (`setupRunId`).
- `machine-status`: trang Máy và bản tin `jobsAgent` cho biết máy có app nhận việc.
- `skills`: việc `skill-sync`, `skill-remove`.
- `runtime-switches`: việc `runtimes-setup`.
- `multi-machine`: việc `ensure-project`.
- `crew-plugin`: worker chia `routeKey` tiền tố `jobs.`.

## Tests

- `packages/crew-plugin/src/__tests__/machine-jobs.db.test.ts`: tạo việc chỉ cho board, claim song song chỉ một bên
  nhận, lease hết hạn và `lease_expired`, kết quả đúng máy và đúng lần nhận, việc `check` lỗi giữ mục kiểm, khóa
  project của lần cài đặt.
- `packages/crew-plugin/src/__tests__/machine-jobs-validate.test.ts`: payload hợp lệ, kết quả chỉ giữ trường của hợp
  đồng và che user:pass; `ensure-project`: bảng ca payload (chép sang app), result giữ trường đã biết.
- `packages/crew-plugin/src/__tests__/machine-jobs-sanitize.test.ts`: bỏ mã điều khiển, che token và userinfo URL, cắt
  độ dài không làm vỡ ký tự.
- Hàng đợi trên web được kiểm trong `packages/crew-web/test/features/machines/machines-page.test.tsx` (flow
  `machine-status`).

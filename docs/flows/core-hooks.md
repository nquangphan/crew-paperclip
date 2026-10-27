# Móc Crew vào lõi Paperclip và nâng bản upstream

> Flow `core-hooks`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow core-hooks` in ra đúng danh sách đó.

## Mục đích

Crew chạy trên bản fork Paperclip và phải nâng lên bản upstream mới mà không đánh mất phần đã vá. Vì vậy mọi chỗ Crew
chạm vào code lõi đều được khai trong một sổ đăng ký (`crew/release/core-hooks.json`) và kiểm tự động:

- `hook`: một dòng gọi `crewCoreHooks.<tên>(...)` đặt ở lệnh đầu tiên của hàm lõi. Ngân sách tối đa `HOOK_BUDGET` (5)
  hook, để phần sửa lõi luôn nhỏ; logic thật nằm trong `server/src/crew/`.
- `adapter-patch`, `driver-patch`: vá trong adapter (`packages/adapters/*`) và SSH driver.
- `core-patch`: sửa trực tiếp route hoặc service lõi ngoài ngân sách hook; mỗi vá bắt buộc khai ít nhất một test.

Mỗi mục ghi file, symbol, `anchor` (đoạn văn bản phải xuất hiện đúng số lần), `importLine` (nếu có, phải nằm trong khối
import cuối file để merge upstream ít conflict), mô tả lý do và `upstreamPr`. Mô tả từng vá là nguồn sự thật cho câu hỏi
"vì sao lõi bị sửa ở đây"; trang này không chép lại.

## Điểm vào

- Code lõi gọi `crewCoreHooks` từ `server/src/crew/core-hooks.ts` (H1–H5 trong sổ đăng ký).
- `crew/release/upgrade.sh <tag-hoặc-ref-upstream> [--base <nhánh>] [--worktree <thư-mục>] [--cleanup]`: merge một ref
  upstream vào nhánh tạm `sync/paperclip-<ref>` trên worktree riêng rồi chạy `verify.sh`. Không đụng nhánh base, không
  push.
- `bash crew/release/verify.sh` (từ gốc worktree): kiểm cây đã merge.
- `node crew/release/check-core-hooks.mjs`: chỉ kiểm sổ đăng ký.

## Các bước

1. `server/src/crew/core-hooks.ts` → `crewCoreHooks`: mặt tiếp xúc duy nhất lõi gọi vào. Mỗi hook chuyển tiếp sang
   implementation Crew:
   - `beforeAgentMutation` → `crewBeforeAgentMutation` (flow `agent-guards`);
   - `beforeClaim` → `crewBeforeClaim`, nếu không giữ run thì `applyBundleResumeSafely` (flow `run-claim`);
   - `beforeIssueWrite` → `crewBeforeIssueWrite` rồi `crewQcBeforeIssueWrite` (flow `issue-gate`, `qc-department`);
   - `beforeIssueCreate` → `crewBeforeIssueCreate` (flow `issue-gate`);
   - `onRunLeaseReleased` → `startRemoteStopOnRelease` (flow `ssh-run-lifecycle`). Wrapper nuốt lỗi và bỏ chờ sau
     `CREW_RUN_LEASE_RELEASE_HOOK_TIMEOUT_MS` (15 giây) để lease SSH vẫn được trả khi Mac ngủ hay mạng treo.
   - `resolveRunEnvironment` → `crewResolveRunEnvironment` (flow `multi-machine`, vá lõi C16 trong `heartbeat.ts`, ngay
     trước `resolveExecutionWorkspaceEnvironmentId`); wrapper nuốt lỗi và trả `null`.
   `overrideCrewCoreHooksForTests` cho test thay implementation rồi khôi phục.
2. `crew/release/upgrade.sh`: fetch `upstream`, tạo worktree và nhánh sync từ base (mặc định `main`), merge `--no-ff`.
   Chỉ `pnpm-lock.yaml` conflict thì lấy bản upstream (verify sẽ cài lại importer Crew và commit lại lockfile); conflict
   file khác thì in số hunk từng file và thoát 2 để người giải tay. Mã thoát: 64 sai cách dùng, 65 thiếu ref/base hoặc
   base không có `verify.sh`, 66 worktree hay nhánh đã có, 67 merge lỗi không có conflict, 70 sai worktree.
3. `crew/release/verify.sh` → `run`: chạy tuần tự, dừng ở bước đỏ đầu tiên với mã theo nhóm: 3 sổ đăng ký và test script
   Node, 4 cài đặt và build tiền đề, 5 test Crew (server, adapter, plugin, `crew/agents`), 6 typecheck và build bundle
   plugin (kèm kiểm bundle UI không có `require("react")` trần). Danh sách lệnh chính xác nằm trong file.
4. `crew/release/check-core-hooks.mjs` → `checkCoreHooks`: kiểm từng mục (trường bắt buộc, `kind` hợp lệ, id không
   trùng, test khai báo tồn tại, anchor đúng số lần và nằm trong `scope`, import nằm cuối file, hook là lệnh đầu tiên
   sau chữ ký hàm). Thiếu `upstreamPr` ở vá không phải hook chỉ là cảnh báo.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `server/src/crew/core-hooks.ts` | Mặt hook lõi gọi vào, nối sang implementation Crew | `crewCoreHooks`, `CrewCoreHooks`, `CREW_RUN_LEASE_RELEASE_HOOK_TIMEOUT_MS`, `overrideCrewCoreHooksForTests` |
| `crew/release/core-hooks.json` | Sổ đăng ký mọi hook và vá lõi, kèm mô tả lý do | `entries` (H*, P*, C*) |
| `crew/release/check-core-hooks.mjs` | Kiểm sổ đăng ký với cây code | `checkCoreHooks`, `HOOK_BUDGET` |
| `crew/release/upgrade.sh` | Merge upstream vào nhánh sync trên worktree riêng | (script) |
| `crew/release/verify.sh` | Cổng xanh/đỏ sau merge | `run`, `no_bare_react_require` |

## Dữ liệu

- Không có bảng riêng. Các hook đọc/ghi bảng của flow mà chúng gọi tới.
- Gọi ngoài: `git fetch upstream --tags` (bỏ qua khi `CREW_UPGRADE_SKIP_FETCH=1`), `corepack pnpm` trong `verify.sh`.

## Flow liên quan

- `issue-gate`, `qc-department`: implementation của H2 và H4.
- `agent-guards`: implementation của H5 và các vá route C1–C5.
- `run-claim`, `runtime-switches`, `runtime-fallback`: implementation của H1.
- `ssh-run-lifecycle`: implementation của H3, vá P1, P8, C9.
- `adapter-patches`: vá P2–P7, P9.
- `run-handoff`: vá C10–C14.
- `contributions`: vá C7 (router góp ý, route Phòng QC, router con quyền xem project và máy, bộ chờ plugin khởi động).
- `docs-snapshot`: vá C15 (parser JSON 16 MB cho webhook `docs-snapshot`).
- `multi-machine`: vá C16.
- `ops-deploy`: build image từ cây đã qua `verify.sh`.

## Tests

- `crew/release/check-core-hooks.test.mjs`: sổ đăng ký thật đạt; báo đỏ khi mất anchor, có lệnh chen trước hook, import
  không ở cuối, anchor ngoài scope, vượt ngân sách hook, test khai báo không tồn tại, vá lõi không khai test; vá thiếu PR
  upstream chỉ cảnh báo; mọi điểm sửa route và host sự kiện plugin đều có mục vá lõi.
- `crew/release/upgrade.test.mjs`: các mã thoát khi thiếu ref, ref sai, worktree đã có, base thiếu `verify.sh`;
  `verify.sh` từ chối chạy ngoài gốc worktree; conflict file nguồn thoát 2 mà không đổi base; chỉ lockfile conflict thì
  tự lấy bản upstream; lockfile được sinh lại thì tự commit trên nhánh sync.
- `server/src/__tests__/crew-core-hooks.test.ts`: mặc định không giữ run; override trong test khôi phục được; H2 gọi gate
  rồi phần ghi QC; guard agent truyền lỗi về router và board bỏ qua guard; H3 gọi với `db` của driver và vẫn trả lease
  khi implementation ném lỗi hoặc treo quá 15 giây; `resolveRunEnvironment` trả `null` khi run không có issue, trả id của
  implementation, và trả `null` khi implementation ném lỗi.
- `server/src/__tests__/crew-run-environment.test.ts` (Postgres nhúng): C16: Crew trả environment thì heartbeat dùng nó,
  `null` hay lỗi thì giữ environment mặc định; run vẫn chạy khi Crew ném lỗi.

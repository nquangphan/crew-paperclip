# Một project chạy trên nhiều máy: ghim máy theo cây yêu cầu, tự chọn máy, dựng project trên máy

> Flow `multi-machine`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow multi-machine` in ra đúng danh sách đó.

## Mục đích

Một project dựng được trên nhiều Mac và mỗi yêu cầu chạy trên máy còn tài nguyên. Đơn vị gắn máy là cả cây yêu cầu
(issue gốc và mọi con cháu), vì mọi bàn giao code (reviewer đọc sha, integrator merge sha, con `crew-stack`, retry,
fallback) dựa vào kho git dùng chung trên một máy. Owner chọn máy lúc tạo yêu cầu gốc hoặc để Crew tự chọn ngay trước run
đầu tiên của cây; từ lúc cây có run đầu tiên thì máy bị khóa. Spec: `docs/superpowers/specs/2026-10-23-multi-machine-project-design.md` (repo `crew`).

## Điểm vào

- H1 (`crewCoreHooks.beforeClaim` → `crewBeforeClaim` → `evaluateBeforeClaim`) hỏi `machineGate`
  (`server/src/crew/machine-gate.ts` → `evaluateMachineGate`) trước mọi bước của cổng tải.

## Các bước

1. `server/src/crew/machine-select.ts` → `chooseMachine`: loại máy có bản tin cũ hơn 5 phút, `load1 > maxLoad1` hay RAM
   trống dưới 10%; chọn máy `ready` ít run nhất, rồi `load1/cpu`, rồi tên máy. Mọi máy `ready` bị loại và project
   `provisionable` (có dòng repo đã biết origin và ít nhất một checkout vai trò để dựng) thì lấy máy chưa dựng có app
   2P Crew đang nhận việc (sẽ dựng); project chưa `provisionable` thì máy chưa dựng không được xét. Không máy nào đạt
   thì lấy máy `ready` điểm thấp nhất để cổng tải giữ run; không có máy `ready` online thì không ghim. `choiceReason`
   lưu các số lúc chọn.
2. `server/src/crew/machine-pin.ts`: đọc/ghi `issue_machine_pins` (`readPin`, `insertAutoPin` không đè ghim có sẵn,
   `setOwnerPin`), tìm issue gốc (`findRootIssueId`), cây đã có lease chưa (`treeStarted`), máy đã ghép theo
   `tailscale_ip` (`pairedMachines`, `machineOfHost`), environment của agent trên một máy (`agentEnvironmentOnMachine`:
   environment mặc định cùng host, không thì environment có `metadata.crewAgentId`), environment theo ghim
   (`resolvePinnedEnvironment`) và ứng viên chọn máy (`loadMachineCandidates`).
3. `server/src/crew/machine-provision.ts`: origin và repo đi kèm của project (`project_repos`; `writeProjectRepo` từ chối
   origin `https` có userinfo), bố cục project (`projectLayout`: khóa project và tên thư mục checkout của từng agent vai
   trò, đọc từ environment mặc định), `projectProvisionable` (có repo và ít nhất một checkout vai trò, cờ `provisionable`
   của bước 1), `startProvisioning` đặt `project_machines` sang `provisioning` và xếp đúng một việc `ensure-project`
   (`ensureProjectPayload`, nhánh agent `agent/<khóa>-<tên>`), `reconcileProjectMachine` đọc kết quả việc: xong thì
   `createMachineEnvironment` cho agent còn thiếu (tên `<environment mặc định>@<tên máy>`, cấu hình SSH và secret từ
   environment mẫu của dòng ghép, `metadata.crewAgentId`/`crewMachineId`, secret binding như route tạo environment) rồi
   `ready` (thiếu checkout của agent không có trong việc, tức agent thêm sau, thì xếp việc lại; thiếu checkout đã yêu cầu
   hay không tạo được environment thì `failed` nêu lý do, giữ environment đã tạo); lỗi hay bị hủy thì `failed`; việc còn chờ thì giữ
   `provisioning` (máy tắt: việc nằm trong hàng đợi). Environment cùng tên của chính agent, kể cả đã archive, được bật lại
   chứ không tạo bản mới; không bao giờ xóa environment.
4. `server/src/crew/machine-gate.ts` → `evaluateMachineGate` (cổng claim H1, xem flow `run-claim`):
   - không có issue, bảng chưa có hay project chưa có máy nào trong `project_machines`: `pass` với `null` (hành vi stock);
   - cây chưa ghim: `chooseMachine` (cờ `provisionable` từ `projectProvisionable`) rồi ghim `auto`, activity
     `crew.machine.pinned`; không chọn được máy thì `pass` với `null`;
   - cây đã ghim, agent có environment trên máy ghim: `pass` kèm id đó (cổng tải đo tải trên environment này);
   - máy ghim không còn ghép, hay agent không phải vai trò của project mà environment mặc định là SSH trên Mac khác:
     `hold` (không bao giờ rơi về environment mặc định trên máy khác); agent chạy trên server (không có environment
     SSH) thì `pass` với `null`;
   - agent vai trò thiếu environment: `reconcileProjectMachine`, dựng xong thì `pass`; `project_machines` `failed` thì
     `fail`; chưa có dòng hay dòng `ready` thì `startProvisioning` (không dựng được, ví dụ chưa có repo, thì `fail`);
     còn lại `hold`, activity `crew.machine.waiting` và comment một lần mỗi run;
   - run chờ máy dựng quá `PROVISION_TIMEOUT_MS` (60 phút, tính từ activity chờ đầu tiên của run) thì `fail`; việc dựng
     vẫn nằm trong hàng đợi, `project_machines` vẫn `provisioning`;
   - `fail`: activity `crew.machine.failed` và comment một lần mỗi run; cổng tải hủy run và chuyển issue sang `blocked`;
   - lỗi bất ngờ khi cây đã ghim hay đang ghi ghim: `hold`; lỗi trước khi biết có ghim: `pass` với `null` như stock.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `server/src/crew/machine-gate.ts` | Cổng ghim máy trong H1: ghim cây, giữ run khi máy đang dựng, hủy khi dựng hỏng | `evaluateMachineGate`, `MachineGateOutcome`, `MACHINE_PINNED_ACTION`, `MACHINE_WAITING_ACTION`, `MACHINE_FAILED_ACTION` |
| `server/src/crew/machine-select.ts` | Chọn máy (thuần) | `chooseMachine`, `choiceReason`, `isOnline`, `MACHINE_REPORT_MAX_AGE_MS`, `DEFAULT_MAX_LOAD1` |
| `server/src/crew/machine-pin.ts` | Truy vấn ghim máy, máy đã ghép, environment theo máy, ứng viên | `findRootIssueId`, `treeStarted`, `readPin`, `insertAutoPin`, `setOwnerPin`, `pairedMachines`, `machineOfHost`, `agentEnvironmentOnMachine`, `resolvePinnedEnvironment`, `crewResolveRunEnvironment`, `loadMachineCandidates` |
| `server/src/crew/machine-provision.ts` | Repo của project, xếp việc `ensure-project`, đối chiếu kết quả, tạo environment theo máy | `readProjectRepo`, `writeProjectRepo`, `projectLayout`, `projectProvisionable`, `ensureProjectPayload`, `startProvisioning`, `reconcileProjectMachine`, `listProjectMachines`, `machineEnvironmentName`, `createMachineEnvironment`, `PROVISION_TIMEOUT_MS`, `CHECKOUT_RE` |

## Dữ liệu

Bảng plugin `issue_machine_pins`, `project_machines`, `project_repos` (migration `0022`), đọc `machine_pairings`,
`machine_latest`, `crew_project_roles`, ghi hàng đợi `crew_machine_jobs` (việc `ensure-project`); bảng lõi `issues`, `environments`, `environment_leases`, `heartbeat_runs`, `agents`.
Activity `crew.machine.pinned` (entity issue gốc), `crew.machine.waiting` và `crew.machine.failed` (entity run, dấu một
lần mỗi run).

## Flow liên quan

- `run-claim`: cổng H1 gọi luật ghim máy trước cổng tải.

## Tests

- `server/src/__tests__/crew-machine-select.test.ts`: từng ngưỡng, bản tin cũ, hòa điểm, máy chưa dựng chỉ dùng khi máy
  `ready` đều bị loại và project dựng được, máy dựng hỏng, không máy nào đạt, không có máy online.
- `server/src/__tests__/crew-machine-pin.db.test.ts` (Postgres nhúng): tìm issue gốc, cây có lease thì khóa, ghim tự động
  không đè ghim có sẵn và owner đổi được, environment của agent theo host của máy (archived thì bỏ), environment theo
  ghim (máy đã gỡ thì `null`), ứng viên với số run `running` theo host, trạng thái project và `maxLoad1` của environment mẫu.
- `server/src/__tests__/crew-machine-provision.db.test.ts` (Postgres nhúng): bố cục project, từ chối khi máy chưa ghép hay
  chưa có repo, xếp đúng một việc, việc xong tạo environment đúng host/secret/checkout rồi `ready` và gọi lại không tạo
  thêm, việc lỗi thì `failed`, việc chờ lâu vẫn `provisioning`, thiếu checkout của agent thêm sau thì xếp việc lại,
  thiếu checkout đã yêu cầu thì `failed` không xếp việc, environment mẫu không active thì `failed` và gọi lại không ném,
  bật lại environment đã archive, `projectProvisionable`, từ chối origin có userinfo.
- `server/src/__tests__/crew-machine-gate.db.test.ts` (Postgres nhúng): project chưa quản lý máy thì stock, ghim auto
  máy `ready`, ghim máy chưa dựng rồi giữ run tới khi dựng xong, project chưa có repo thì không ghim máy chưa dựng và
  không chặn issue, dựng hỏng thì `fail` (qua cổng claim: hủy run, issue `blocked`), chờ quá 60 phút thì `fail` mà việc
  vẫn chờ, ghim của owner giữ nguyên, máy ghim đã gỡ hay agent ngoài vai trò trên Mac khác thì giữ run, lỗi bất ngờ khi
  cây đã ghim thì giữ run.
- `server/src/__tests__/crew-load-gate.test.ts` (`ghim máy trong cổng claim`): `pass` kèm environment, `hold`, `fail`,
  cổng ném lỗi thì giữ run, `probeKeyOf`.

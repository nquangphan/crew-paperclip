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
- Vá lõi C16 (`heartbeat.ts`, `executeRun`) gọi `crewCoreHooks.resolveRunEnvironment` → `crewResolveRunEnvironment`.
- `server/src/crew/machine-routes.ts` → `crewMachineRoutes`, gắn trong router góp ý (flow `contributions`), chỉ phiên
  trình duyệt; đọc: mọi thành viên, ghi: chỉ owner. Đường dưới `/api/crew/companies/:c`:

| Method, đường | Body | Trả |
|---|---|---|
| `GET …/machines?projectId=` | — | `{ items: [{ machineId, hostname, online, status, running, load1, cpuCount, memFreePct }] }` |
| `GET …/issues/:issueId/machine` | — | `{ rootIssueId, isRoot, locked, pin: null \| { machineId, hostname, source, reason, pinnedAt } }` |
| `PUT …/issues/:issueId/machine` | `{ machineId }` | như GET; lỗi 422 `crew_machine_not_root`, 409 `crew_machine_locked`, 422 `crew_machine_unknown`, 409 `crew_machine_no_repo`/`crew_machine_no_roles` |
| `GET …/projects/:projectId/machines` | — | `{ repo: null \| { originUrl, branch, companions }, machines: [{ machineId, hostname, online, status, error, repoPath, updatedAt }] }` |
| `POST …/projects/:projectId/machines` | `{ machineId }` | 202 `{ status: "provisioning" }` |
| `PUT …/projects/:projectId/repo` | `{ originUrl, branch, companions }` | 200 repo; sai luật thì 422 `crew_machine_invalid` |

  `status` của máy trong project: `"ready" | "provisioning" | "failed" | null` (null = chưa dựng). Bảng máy chưa có thì
  503 `crew_machine_unavailable`; body `machineId` sai thì 400 `crew_machine_invalid`.
- Ba route dọn/dựng máy khác, cùng router, chỉ owner bằng phiên trình duyệt hoặc board API key của owner (app 2P Crew gọi
  bằng board key); không phải owner thì 403 `crew_machine_forbidden`, body sai thì 400 `crew_machine_invalid`:

| Method, đường | Body | Trả |
|---|---|---|
| `GET …/projects/:projectId/machines/blockers?agentIds=a,b` | — | `{ blockers: [{ issueId, identifier, hostname, runStatus }] }`; thiếu `agentIds` = cả project |
| `POST …/projects/:projectId/machines/release` | `{ agentIds: uuid[1..20], wholeProject, primaryMachineId: uuid \| null }` | `{ archivedEnvironmentIds, jobs: [{ machineId, jobId }] }`; 409 `crew_machine_busy` kèm `blockers` |
| `POST …/projects/:projectId/machines/provision` | `{ exceptMachineId: uuid \| null, includeReady, repo: { originUrl, branch } \| null }` | `{ queued: [{ machineId, jobId }], skipped: [{ machineId, reason }] }` |

  `primaryMachineId`/`exceptMachineId` là mã máy `crew-mac status` (`machineId` trong cấu hình status), cũng là mã app
  gửi lúc ghép nên trùng `machine_pairings.machine_id`.

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
   - mọi lý do `hold` dùng chung một đồng hồ: run chờ quá `PROVISION_TIMEOUT_MS` (60 phút, tính từ activity chờ đầu tiên
     của run) thì `fail` với lý do của trường hợp đó (máy đã gỡ ghép, agent chưa có environment trên máy, máy chưa dựng
     xong project); việc dựng vẫn nằm trong hàng đợi, `project_machines` vẫn `provisioning`;
   - `fail`: activity `crew.machine.failed` và comment một lần mỗi run; cổng tải hủy run và chuyển issue sang `blocked`;
   - lỗi bất ngờ khi cây đã ghim hay đang ghi ghim: `hold`; lỗi trước khi biết có ghim: `pass` với `null` như stock.
5. `server/src/crew/machine-routes.ts` (route của owner):
   - `PUT …/issues/:issueId/machine`: chỉ owner; chỉ issue gốc (issue con: 422 `crew_machine_not_root`); cây đã có lease
     (`treeStarted`) thì 409 `crew_machine_locked`, kiểm trước khi ghi ghim; máy phải còn ghép (không thì 422
     `crew_machine_unknown`); project chưa dựng trên máy đó (không `ready`/`provisioning`) thì `startProvisioning` xếp
     `ensure-project` trước (không dựng được thì 409 `crew_machine_no_repo`/`crew_machine_no_roles`, chưa ghim); rồi
     `setOwnerPin`.
   - `POST …/projects/:projectId/machines`: chỉ owner, `startProvisioning` rồi 202.
   - `PUT …/projects/:projectId/repo`: chỉ owner; `projectRepoSchema` kiểm đúng luật của việc `ensure-project` (origin ≤ 500
     ký tự, không ký tự điều khiển, khớp mẫu origin, `https` không có userinfo; nhánh không bắt đầu `-`; 0–5 repo đi kèm, tên
     khác `repo`, không trùng nhau) và tên repo đi kèm không trùng thư mục checkout vai trò của project (`projectLayout`);
     sai thì 422 `crew_machine_invalid`, đúng thì `writeProjectRepo`.
   - `GET …/projects/:projectId/machines`: trước khi trả, `reconcileProjectMachine` mọi dòng `provisioning` để trang project
     thấy kết quả việc dựng mà không chờ run.
6. Gỡ và thêm (`server/src/crew/machine-release.ts`; phần owner duyệt thêm ngoài spec, 24/10/2026): mọi đường gỡ (wizard
   web gỡ project/agent, app 2P Crew gỡ project) hỏi `…/machines/blockers` trước khi pause và gọi `…/machines/release` sau
   khi archive environment mặc định; mọi đường thêm (wizard thêm project/agent, app thêm project) gọi
   `…/machines/provision` sau khi máy chính xong, lỗi không làm hỏng wizard. Luật:
   - Không làm gãy cây đang chạy: `machineReleaseBlockers` tìm cây của project đã ghim máy còn run `queued`/`running`
     (của agent trong phạm vi gỡ; gỡ cả project hay thiếu `agentIds` thì của mọi agent); `releaseProjectMachines` kiểm lại
     và trả 409 kèm danh sách, không archive gì.
   - Không bao giờ DELETE environment: chỉ đổi `status` sang `archived` (`environmentService.update`), và chỉ environment
     có `metadata.crewAgentId` của agent trong phạm vi; environment mặc định do đường gỡ cũ tự archive.
   - `remove-checkouts` cho máy khác: máy có environment `@máy` của agent, cộng mọi máy trong `project_machines` khi gỡ cả
     project, trừ `primaryMachineId`. `roles` là tên thư mục checkout (Trợ Lý, executor, reviewer, integrator, còn lại),
     `removeStatusRepo: false`; dùng lại việc `remove-checkouts` còn chờ của cùng project trên máy đó nên gọi lại không
     xếp trùng. Bản clone `repo` trên máy khác được giữ.
   - `project_machines`: gỡ cả project thì xóa mọi dòng của project; gỡ một agent thì giữ dòng.
   - Dựng sẵn (`provisionOtherMachines`): `repo` chỉ ghi khi project chưa có `project_repos`; máy chính
     (`exceptMachineId`) được ghi `ready` khi environment mặc định của mọi agent vai trò trỏ đúng host của máy đó; mọi
     máy đã ghép khác được `startProvisioning` (máy offline vẫn xếp việc), trừ máy `provisioning` và máy `ready` (trừ khi
     `includeReady`, khi thêm agent cần worktree mới). Lỗi từng máy (`no_repo`, `no_roles`) nằm ở `skipped`, không ném.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `server/src/crew/machine-gate.ts` | Cổng ghim máy trong H1: ghim cây, giữ run khi máy đang dựng, hủy khi dựng hỏng | `evaluateMachineGate`, `MachineGateOutcome`, `MACHINE_PINNED_ACTION`, `MACHINE_WAITING_ACTION`, `MACHINE_FAILED_ACTION` |
| `server/src/crew/machine-select.ts` | Chọn máy (thuần) | `chooseMachine`, `choiceReason`, `isOnline`, `MACHINE_REPORT_MAX_AGE_MS`, `DEFAULT_MAX_LOAD1` |
| `server/src/crew/machine-pin.ts` | Truy vấn ghim máy, máy đã ghép, environment theo máy, ứng viên | `findRootIssueId`, `treeStarted`, `readPin`, `insertAutoPin`, `setOwnerPin`, `pairedMachines`, `machineOfHost`, `agentEnvironmentOnMachine`, `resolvePinnedEnvironment`, `crewResolveRunEnvironment`, `loadMachineCandidates` |
| `server/src/crew/machine-routes.ts` | Route máy cho form yêu cầu và trang project | `crewMachineRoutes`, `MACHINE_ERRORS`, `projectRepoSchema`, `ORIGIN_RE` |
| `server/src/crew/machine-release.ts` | Dọn environment và checkout ở máy khác khi gỡ, dựng sẵn project ở máy khác khi thêm | `machineReleaseBlockers`, `releaseProjectMachines`, `provisionOtherMachines`, `ReleaseBlocker`, `ReleaseResult`, `ProvisionOthersResult` |
| `server/src/crew/machine-provision.ts` | Repo của project, xếp việc `ensure-project`, đối chiếu kết quả, tạo environment theo máy | `readProjectRepo`, `writeProjectRepo`, `projectLayout`, `projectProvisionable`, `ensureProjectPayload`, `startProvisioning`, `reconcileProjectMachine`, `listProjectMachines`, `machineEnvironmentName`, `createMachineEnvironment`, `PROVISION_TIMEOUT_MS`, `CHECKOUT_RE` |

## Dữ liệu

Bảng plugin `issue_machine_pins`, `project_machines`, `project_repos` (migration `0022`), đọc `machine_pairings`,
`machine_latest`, `crew_project_roles`, ghi hàng đợi `crew_machine_jobs` (việc `ensure-project`, `remove-checkouts`); bảng lõi `issues`, `environments`, `environment_leases`, `heartbeat_runs`, `agents`.
Activity `crew.machine.pinned` (entity issue gốc), `crew.machine.waiting` và `crew.machine.failed` (entity run, dấu một
lần mỗi run).

## Flow liên quan

- `run-claim`: cổng H1 gọi luật ghim máy trước cổng tải.
- `core-hooks`: đăng ký vá C16.
- `contributions`: router góp ý gắn router máy, dùng chung `resolveContributionActor`/`requireOwner`.

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
  vẫn chờ, ghim của owner giữ nguyên, máy ghim đã gỡ hay agent ngoài vai trò trên Mac khác thì giữ run và quá 60 phút
  thì `fail` với lý do riêng, lỗi bất ngờ khi
  cây đã ghim thì giữ run.
- `server/src/__tests__/crew-load-gate.test.ts` (`ghim máy trong cổng claim`): `pass` kèm environment, `hold`, `fail`,
  cổng ném lỗi thì giữ run, `probeKeyOf`.
- `server/src/__tests__/crew-run-environment.test.ts` (Postgres nhúng): Crew trả environment của máy ghim thì heartbeat dùng
  nó thay environment mặc định của agent; Crew trả `null` hay ném lỗi thì giữ environment mặc định và run vẫn chạy.
- `server/src/__tests__/crew-runtime-machine.db.test.ts` (Postgres nhúng): máy của agent cho công tắc runtime theo máy
  ghim của cây, rồi theo host của environment (hai Mac cùng đường checkout), host chưa ghép thì giữ luật đường dẫn cũ.
- `server/src/__tests__/crew-machine-routes.db.test.ts` (Postgres nhúng): danh sách máy cho form, ghim chỉ owner/chỉ issue
  gốc/máy phải ghép, máy chưa dựng mà project chưa có repo thì 409 không ghim, luật repo (422 `crew_machine_invalid`, tên
  repo đi kèm trùng checkout vai trò), owner chọn máy chưa dựng thì ghim và trang project thấy `provisioning`, cây có lease
  thì 409 `crew_machine_locked`, thêm máy ở trang project (403, 422 máy chưa ghép, 202).
- `server/src/__tests__/crew-machine-release.db.test.ts` (Postgres nhúng): cây ghim còn run thì từ chối gỡ và không archive,
  gỡ một agent archive environment máy khác (không xóa) và xếp `remove-checkouts` đúng tên checkout, gỡ cả project xóa dòng
  máy và gọi lại không xếp thêm, dựng sẵn máy khác (ghi repo khi chưa có, bỏ máy `provisioning`/`ready` trừ
  `includeReady`), máy chính được ghi `ready`, chưa có repo thì `skipped`; route: owner bằng board key, viewer 403,
  `blockers` thiếu `agentIds` là cả project, `release` bận 409, origin có userinfo 400.

# Công tắc runtime theo máy (Claude, Codex, OpenCode)

> Flow `runtime-switches`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow runtime-switches` in ra đúng danh sách đó.

## Mục đích

Mỗi Mac chạy agent có thể dùng ba runtime: `claude_local`, `codex_local`, `opencode_local`. Codex và OpenCode tốn quota
riêng, nên board bật hay tắt từng runtime theo từng máy. Run của agent có runtime đang tắt trên máy của nó bị giữ ở
`queued` (không hủy, không comment); plugin lo chuyển runtime (flow `runtime-fallback`).

Mặc định khi máy chưa có dòng công tắc: Claude bật, Codex và OpenCode tắt. OpenCode còn bị khóa (luôn tắt, không bật
được) khi server chưa có vá adapter chạy đúng worktree trên Mac: server đọc env `CREW_OPENCODE_IN_PLACE_PATCH`, worker
plugin (không nhận env của server) đọc key `opencodeInPlacePatch` trong cấu hình plugin của company. Hai bên phải được
đặt cùng nhau.

Máy của agent phía server (`resolveAgentMachine`) xét lần lượt:

1. Run hay issue thuộc cây yêu cầu đã ghim máy (flow `multi-machine`) → máy ghim.
2. `config.host` của environment mặc định trùng `tailscale_ip` của một máy đã ghép (`machine_pairings`, chưa gỡ) → máy
   đó. Hai Mac dùng cùng đường `~/crew-agents/...` nên đường checkout không phân biệt được máy.
3. Luật cũ (máy chưa ghép), giống plugin: `config.remoteWorkspacePath` của environment → máy có bản tin mới nhất chứa
   checkout đó; company chỉ có một máy thì lấy máy đó; còn lại không xác định (dùng mặc định).

Bảng plugin chưa có thì bỏ qua bước đó. Agent không có environment chỉ còn bước 1 hoặc dùng mặc định. Cổng `runtimeGate`
truyền `issueId` trong `contextSnapshot` của run; reviewer Codex ở H4 truyền issue cha (flow `issue-gate`).

## Điểm vào

- UI: khối "Runtime" trên thẻ máy (trang máy của crew-web), chỉ board gạt được.
- Route plugin (board): `GET /api/plugins/crew.core/api/runtime-switches?companyId=…` và
  `POST /api/plugins/crew.core/api/runtime-switches` (routeKey `runtimes.switches.get`, `runtimes.switches.set`).
- H1: `runtimeGate` được cổng claim gọi sau cổng tải (flow `run-claim`).

## Các bước

1. `packages/crew-web/src/features/machines/runtime-block.tsx`: hiện ba runtime với số liệu từ bản tin máy; bật Codex
   hay OpenCode và tắt Claude phải qua hộp xác nhận (tắt Claude giữ cả Trợ Lý, reviewer, integrator trên máy). Lỗi 403,
   409 hiện nguyên văn lời server. Nút "Cài runtime trên máy" xếp việc `runtimes-setup` (flow `machine-jobs`).
2. `packages/crew-web/src/api/crew/runtimes.ts` → `runtimesApi.get`, `runtimesApi.set`: gọi route plugin (POST, vì host
   không có PUT cho route plugin).
3. `packages/crew-plugin/src/runtimes/switches.ts` → `handleRuntimeSwitchesApi`: chỉ actor `user` (403 với agent); kiểm
   body chặt (`parseSetBody`), máy phải có bản tin trong company, bật OpenCode khi bị khóa trả 409; upsert dòng và ghi
   activity. Lỗi DB trả 500 câu chung, chi tiết chỉ ở log. `loadRuntimeSwitches` trả mọi máy có bản tin kèm trạng thái
   ba công tắc; `readRuntimeSwitch` là bản đọc phía plugin.
4. `server/src/crew/runtime-gate.ts` → `evaluateRuntimeGate`: chỉ áp cho company có cấu hình Crew hợp lệ và agent chạy
   một trong ba runtime. Trước tiên hủy run `queued` của agent mà issue đã bị fallback chuyển đi (`cancelSuperseded`).
   Công tắc tắt thì giữ run, ghi một dòng hàng chờ `crew_runtime_waits` và activity một lần mỗi run. Lỗi hạ tầng: Claude
   được chạy (fail open), Codex/OpenCode coi như tắt và giữ.
5. `server/src/crew/runtime-switch.ts` → `readRuntimeSwitch`, `resolveAgentMachine`, `readPluginRows`: máy của agent
   theo ghim, host rồi đường checkout (dùng `pinnedMachineId`, `machineOfHost` của `machine-pin.ts`); đọc bảng plugin
   trong savepoint (lỗi SQL không làm hỏng transaction của bên gọi), bảng chưa có thì dùng mặc định và cảnh báo tối đa
   một lần mỗi phút mỗi company.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `packages/crew-plugin/src/runtimes/switches.ts` | Route board đọc/ghi công tắc, đọc phía plugin | `handleRuntimeSwitchesApi`, `loadRuntimeSwitches`, `readRuntimeSwitch`, `CREW_RUNTIME_SWITCH_DEFAULTS`, `OPENCODE_PATCH_CONFIG_KEY` |
| `server/src/crew/runtime-gate.ts` | Cổng công tắc trong H1 | `evaluateRuntimeGate`, `defaultRuntimeGateDeps`, `RUNTIME_GATE_WAITING_ACTION` |
| `server/src/crew/runtime-switch.ts` | Đọc công tắc và máy của agent phía server | `readRuntimeSwitch`, `resolveAgentMachine`, `resolveMachineForWorkspace`, `readPluginRows`, `CREW_OPENCODE_IN_PLACE_PATCH_ENV` |
| `packages/crew-web/src/api/crew/runtimes.ts` | Client API | `runtimesApi` |
| `packages/crew-web/src/features/machines/runtime-block.tsx` | Khối Runtime trên thẻ máy | `RuntimeBlock` |
| `server/src/services/heartbeat.ts` | File upstream chứa H1 | `heartbeatService.claimQueuedRun` |

## Dữ liệu

- Bảng plugin (migration `packages/crew-plugin/migrations/0012_runtimes.sql`): `crew_runtime_switches` (khóa
  `company_id, machine_id, runtime`), `crew_runtime_waits` (server ghi, job fallback của plugin đọc),
  `crew_runtime_decisions` (đọc để hủy run đã bị chuyển đi). Đọc thêm `machine_latest` (bản tin máy).
- Bảng lõi: `agents`, `environments`, `issues`, `activity_log`.
- Activity: `crew.runtime_switch.set` (plugin, kèm trước/sau), `crew.runtime_gate.waiting` (server).
- Env server: `CREW_OPENCODE_IN_PLACE_PATCH`. Cấu hình plugin: `opencodeInPlacePatch`.

## Flow liên quan

- `run-claim`: gọi `runtimeGate` sau cổng tải.
- `runtime-fallback`: đọc hàng chờ và công tắc để chuyển runtime; quyết định fallback làm run cũ bị hủy.
- `issue-gate`: công tắc `codex_local` quyết định issue con có reviewer Codex.
- `machine-status`: bảng `machine_latest` và số liệu runtime trong bản tin.
- `machine-jobs`: việc `runtimes-setup`.
- `web-pages`: trang máy chứa khối Runtime.
- `multi-machine`: `heartbeat.ts` có thêm vá C16 chọn environment của run theo máy đã ghim cho cây yêu cầu; lease SSH,
  lệnh dừng và retry vì vậy luôn ở máy đó. `resolveAgentMachine` đọc máy ghim và bảng `machine_pairings` của flow đó.

## Tests

- `packages/crew-plugin/src/__tests__/runtime-switches.db.test.ts`: hai route chỉ board; mặc định và khóa OpenCode;
  ghi rồi đọc lại kèm activity; 403 với agent, 400 với input sai hay máy lạ; lỗi DB không lộ SQL; máy của agent.
- `packages/crew-web/test/api/runtimes.test.ts`: đúng method, đường dẫn và body.
- `packages/crew-web/test/features/machines/runtime-block.test.tsx`: hiển thị số liệu bản tin, trạng thái mặc định, khóa
  OpenCode, hộp xác nhận khi bật Codex/OpenCode hay tắt Claude, lỗi nguyên văn, xếp việc cài runtime.
- `server/src/__tests__/crew-runtime-gate.test.ts`: giữ khi tắt và ghi hàng chờ một lần; máy không xác định; fail open
  cho Claude, giữ cho Codex/OpenCode khi lỗi đọc; hủy run của agent đã bị chuyển đi.
- `server/src/__tests__/crew-runtime-switch.db.test.ts`: mặc định, chưa có bảng plugin, đọc theo máy, khóa OpenCode
  theo env, luật xác định máy, cổng giữ/cho claim trên DB thật.

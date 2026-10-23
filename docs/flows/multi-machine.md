# Một project chạy trên nhiều máy: ghim máy theo cây yêu cầu, tự chọn máy, dựng project trên máy

> Flow `multi-machine`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow multi-machine` in ra đúng danh sách đó.

## Mục đích

Một project dựng được trên nhiều Mac và mỗi yêu cầu chạy trên máy còn tài nguyên. Đơn vị gắn máy là cả cây yêu cầu
(issue gốc và mọi con cháu), vì mọi bàn giao code (reviewer đọc sha, integrator merge sha, con `crew-stack`, retry,
fallback) dựa vào kho git dùng chung trên một máy. Owner chọn máy lúc tạo yêu cầu gốc hoặc để Crew tự chọn ngay trước run
đầu tiên của cây; từ lúc cây có run đầu tiên thì máy bị khóa. Spec: `docs/superpowers/specs/2026-10-23-multi-machine-project-design.md` (repo `crew`).

## Điểm vào

- `server/src/crew/machine-select.ts` → `chooseMachine`: hàm thuần, nhận danh sách ứng viên, giờ hiện tại và cờ
  `provisionable`.

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

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `server/src/crew/machine-select.ts` | Chọn máy (thuần) | `chooseMachine`, `choiceReason`, `isOnline`, `MACHINE_REPORT_MAX_AGE_MS`, `DEFAULT_MAX_LOAD1` |
| `server/src/crew/machine-pin.ts` | Truy vấn ghim máy, máy đã ghép, environment theo máy, ứng viên | `findRootIssueId`, `treeStarted`, `readPin`, `insertAutoPin`, `setOwnerPin`, `pairedMachines`, `machineOfHost`, `agentEnvironmentOnMachine`, `resolvePinnedEnvironment`, `crewResolveRunEnvironment`, `loadMachineCandidates` |

## Dữ liệu

Bảng plugin `issue_machine_pins`, `project_machines`, `project_repos` (migration `0022`), đọc `machine_pairings`,
`machine_latest`, `crew_project_roles`; bảng lõi `issues`, `environments`, `environment_leases`, `heartbeat_runs`, `agents`.

## Flow liên quan

- `run-claim`: cổng H1 gọi luật ghim máy trước cổng tải.

## Tests

- `server/src/__tests__/crew-machine-select.test.ts`: từng ngưỡng, bản tin cũ, hòa điểm, máy chưa dựng chỉ dùng khi máy
  `ready` đều bị loại và project dựng được, máy dựng hỏng, không máy nào đạt, không có máy online.
- `server/src/__tests__/crew-machine-pin.db.test.ts` (Postgres nhúng): tìm issue gốc, cây có lease thì khóa, ghim tự động
  không đè ghim có sẵn và owner đổi được, environment của agent theo host của máy (archived thì bỏ), environment theo
  ghim (máy đã gỡ thì `null`), ứng viên với số run `running` theo host, trạng thái project và `maxLoad1` của environment mẫu.

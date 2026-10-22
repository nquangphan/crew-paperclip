# Chặn agent sửa cấu hình agent, project, workspace và xóa issue

> Flow `agent-guards`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow agent-guards` in ra đúng danh sách đó.

## Mục đích

Agent trong Crew chỉ làm việc trên issue được giao. Mọi thay đổi về cấu hình agent (adapter, model, quyền, skill,
hướng dẫn), project, workspace và việc xóa issue là quyền của board. Paperclip gốc cho agent có grant làm những việc
này, và agent có thể tự nâng quyền hoặc tự bỏ pause. Flow này chặn ở hai lớp:

- Lớp chặn trước (server): route lõi từ chối lệnh ghi của actor agent trong company Crew. Company Crew là company có
  trong file `CREW_POLICY_CONFIG`; cấu hình lỗi vẫn tính là Crew (fail closed). Board và company ngoài cấu hình giữ
  hành vi gốc.
- Lớp phát hiện sau (plugin): nghe sự kiện cho những đường route lõi chưa chặn (agent do hệ thống hay plugin tạo,
  agent role `ceo` của onboarding seed, project/goal do agent đổi) rồi pause agent và ghi log để board xem.

## Điểm vào

- H5: middleware của router agent trong `server/src/routes/agents.ts` gọi `crewCoreHooks.beforeAgentMutation`.
- Vá C1 (`server/src/routes/onboarding-seed.ts`, `assertBoard`), C2 (`server/src/routes/projects.ts`, middleware
  `crewBeforeProjectMutation`), C3 (`DELETE /issues/:id`), C4 (`POST /issues/:id/checkout`), C5
  (`PATCH /execution-workspaces/:id`). Mô tả từng vá: `crew/release/core-hooks.json`.
- Plugin: `registerSecurityGuards` được gọi từ `packages/crew-plugin/src/features.ts` lúc worker khởi động.

## Các bước

1. `server/src/crew/agent-config-gate.ts` → `crewBeforeAgentMutation`: với actor agent và method ghi, khớp đường dẫn:
   - tạo agent (`/companies/:id/agents`, `agent-hires`) hay chạy thử adapter (`adapters/:type/test-environment`): 422
     `crew_agent_create_forbidden`, bất kể body và quyền `canCreateAgents`;
   - `PATCH /agents/:id`, rollback config revision, và các subresource `skills/sync`, `instructions-path`,
     `instructions-bundle*`, `permissions`, `resume`: 422 `crew_agent_config_forbidden`, kèm `keys` (tên key bị chặn,
     không kèm giá trị).
   Agent đích được giải bằng resolver stock và phải thuộc cùng company (không thì 404), để key agent không dò được
   agent company khác.
2. `server/src/crew/agent-write-guard.ts` → `crewBeforeProjectMutation`, `crewAssertBoardOnly`: tạo/sửa/xóa project và
   workspace của project, xóa issue, sửa execution workspace trả 403 `crew_board_only` kèm `action`. MCP
   `create_project` gọi lại cùng route REST nên cũng bị chặn. Điều khiển runtime service của workspace không bị chặn.
3. `server/src/crew/agent-write-guard.ts` → `crewBeforeAgentCheckout`: agent chỉ checkout issue chưa giao ai hoặc đã
   giao chính mình; còn lại 409 `crew_checkout_forbidden`. Board checkout hộ agent giữ stock.
4. `packages/crew-plugin/src/security/guards.ts` → `onAgentCreated`: agent mới không do board (user) tạo trong company
   Crew bị pause.
5. `packages/crew-plugin/src/security/guards.ts` → `onRunStarted`: agent role `ceo` bắt đầu chạy thì bị pause (onboarding
   seed tạo agent `ceo` mà không phát `agent.created`; role này vượt mọi kiểm quyền).
6. `packages/crew-plugin/src/security/guards.ts` → `onProjectChanged`, `onGoalChanged`: project/workspace do agent đổi
   thì pause agent và ghi log; goal do agent đổi thì chỉ ghi log (goal không tham gia cổng Crew). Pause lỗi (agent đã
   terminated) vẫn ghi log với cờ lỗi.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `server/src/crew/agent-config-gate.ts` | H5: chặn ghi cấu hình agent | `crewBeforeAgentMutation`, `AgentMutationInput` |
| `server/src/crew/agent-write-guard.ts` | Vá C2–C5: project, workspace, xóa issue, checkout | `crewAssertBoardOnly`, `crewBeforeProjectMutation`, `crewBeforeAgentCheckout` |
| `packages/crew-plugin/src/security/index.ts` | Đăng ký listener sự kiện | `registerSecurityGuards` |
| `packages/crew-plugin/src/security/guards.ts` | Pause agent và ghi log khi phát hiện | `onAgentCreated`, `onRunStarted`, `onProjectChanged`, `onGoalChanged`, `PROJECT_EVENTS`, `GOAL_EVENTS` |
| `server/src/routes/agents.ts` | File upstream chứa H5 | middleware của `agentRoutes` |
| `server/src/routes/projects.ts` | File upstream chứa C2 | middleware của `projectRoutes` |
| `server/src/routes/issues.ts` | File upstream chứa C3, C4 | `DELETE /issues/:id`, `POST /issues/:id/checkout` |
| `server/src/routes/execution-workspaces.ts` | File upstream chứa C5 | `PATCH /execution-workspaces/:id` |
| `server/src/routes/onboarding-seed.ts` | File upstream chứa C1 | `POST /companies/:companyId/onboarding-seed` |

## Dữ liệu

- Bảng: đọc `agents` (xác định agent đích cùng company). Không ghi gì ở server; plugin pause agent qua
  `ctx.agents.pause`.
- Sự kiện plugin nghe: `agent.created`, `agent.run.started`, `project.created`, `project.updated`,
  `project.workspace_created`, `project.workspace_updated`, `project.workspace_deleted`, `goal.created`,
  `goal.updated`.
- Activity plugin ghi: `crew.security.agent_paused` (lý do `created_by_non_board` hoặc `ceo_role`),
  `crew.security.project_changed`, `crew.security.goal_changed`.
- Lỗi trả về: 422 `crew_agent_create_forbidden`, 422 `crew_agent_config_forbidden`, 403 `crew_board_only`, 409
  `crew_checkout_forbidden`.

## Flow liên quan

- `core-hooks`: đăng ký H5 và các vá C1–C5.
- `issue-gate`: cùng nguồn cấu hình `CREW_POLICY_CONFIG` để biết company nào là Crew; chặn phần ghi issue.
- `crew-plugin`: worker nạp `registerSecurityGuards`; `loadCrewCompanies` quyết company Crew phía plugin.
- `setup-wizards`: đường board tạo agent và project.

## Tests

- `server/src/__tests__/crew-agent-config.test.ts`: hook đặt đúng một lần trên router agent; agent tạo agent, chạy thử
  adapter, PATCH agent khác, đổi quyền, resume, rollback đều bị 422 dù có grant; GET vẫn được; cấu hình invalid vẫn
  chặn; lỗi chỉ trả tên key; company ngoài cấu hình giữ stock; không lộ agent company khác.
- `server/src/__tests__/crew-agent-board-only-routes.test.ts`: onboarding seed, project và workspace (cả MCP
  `create_project`), xóa issue, checkout và execution workspace chỉ board làm được; company ngoài cấu hình giữ stock.
- `packages/crew-plugin/src/__tests__/security-guards.test.ts`: đăng ký đủ sự kiện; pause agent không do board tạo và
  agent `ceo` khi chạy; bỏ qua thao tác của board và company ngoài Crew; pause lỗi vẫn ghi log.

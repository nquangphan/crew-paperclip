# Trang tổng quan, hộp thư, tìm kiếm, run, agent, project, thành viên, cài đặt

> Flow `web-pages`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow web-pages` in ra đúng danh sách đó.

## Mục đích

Các trang hằng ngày của crew-web ngoài issue: Tổng quan, Hộp thư, Tìm kiếm, trang run, danh sách và chi tiết agent,
danh sách và chi tiết project, Thành viên, Cài đặt. Phần lớn là hiển thị dữ liệu lõi Paperclip theo kiểu Crew, kèm vài
thao tác có giới hạn chặt.

Luật chính:

- Không có thao tác xóa agent, project hay environment trên các trang này. Gỡ đi qua wizard gỡ (pause, archive), và
  trang project, agent chỉ gắn nút.
- Agent: chỉ đổi tên và biểu tượng, đổi model mặc định trong bảng model của runtime agent chạy, bật tắt skill company,
  render lại AGENTS.md theo vai trò. Không sửa command, extraArgs, env, adapter, quyền hay khóa API. Đổi model chỉ gửi
  `adapterConfig.model` (PATCH merge, không `replaceAdapterConfig`); reviewer Codex chạy model cố định.
- Project: chỉ đổi tên, mô tả, màu, biểu tượng; tab Vai trò, Docs, Sẵn sàng thuộc các flow riêng.
- Hộp thư "Chờ tôi duyệt" gồm issue có stage đang chờ chính user này hoặc có câu hỏi/xác nhận chờ trả lời. Danh sách
  của server không có `executionState`, nên người tham gia stage đọc từ `reviewAttention`.
- Run: Dừng cho run đang chạy hay chờ, Chạy lại cho run `failed`/`timed_out`, Tiếp tục cho run `process_lost`, theo
  đúng body mà route wakeup của server nhận.
- Tìm kiếm và mọi danh sách chỉ hiện kết quả thuộc project người xem được cấp.
- Ngày và biểu đồ tính theo giờ `Asia/Ho_Chi_Minh`.

## Điểm vào

- crew-web route (tương đối dưới `/:companyPrefix`): `dashboard`, `inbox`, `search`, `runs/:runId` và
  `agents/:agentRef/runs/:runId`, `agents`, `agents/:agentRef`, `projects`, `projects/:projectRef`, `members`,
  `settings`. Mỗi feature khai trong `routes.tsx` của nó.

## Các bước

1. `packages/crew-web/src/features/dashboard/dashboard-page.tsx` → `DashboardPage`: thẻ số, biểu đồ 14 ngày
   (`dashboard-logic.ts` → `last14Days`, `runActivityBars`), hoạt động gần đây, thẻ góp ý chờ duyệt cho owner; dữ liệu
   qua `use-dashboard.ts`.
2. `packages/crew-web/src/features/inbox/inbox-page.tsx` → `InboxPage`: chia tab bằng `inbox/tabs.ts`
   (`INBOX_TAB_IDS`, `isMyExecutionStage`, `hasPendingUserInteraction`); số trên sidebar qua `useInboxBadge`.
3. `packages/crew-web/src/features/search/search-page.tsx` → `SearchPage`: tìm theo `q` trên URL, lọc bằng
   `resultVisible`, bấm kết quả mở popup issue.
4. `packages/crew-web/src/features/runs/run-page.tsx` → `RunPage`: agent, trạng thái, nội dung chạy, log, yêu cầu liên
   quan; thao tác từ `run-actions.ts` → `runActionsFor`, `wakeupOutcome`.
5. `packages/crew-web/src/features/agents/list/agents-page.tsx` → `AgentsPage`: vai trò theo project
   (`use-agent-roles.ts` → `useAgentHoldings`), trạng thái, sẵn sàng, lọc (`useStatusFilter`), Tạm dừng/Tiếp tục.
6. `packages/crew-web/src/features/agents/detail/agent-page.tsx` → `AgentPage`: các tab Tổng quan, Hướng dẫn
   (`InstructionsTab`), Skills (`SkillsTab`), Cấu hình chạy (`RuntimeTab`, `ModelSelect`), Run; đổi tên; nút Gỡ agent.
7. `packages/crew-web/src/features/projects/list/projects-page.tsx` → `ProjectsPage` và
   `packages/crew-web/src/features/projects/detail/project-page.tsx` → `ProjectPage`: tab Yêu cầu (`IssuesTab`), Vai
   trò, Docs, Sẵn sàng (`ReadinessTab`); "Làm tiếp" vào wizard; nút Gỡ project.
8. `packages/crew-web/src/features/members/members-page.tsx` → `MembersPage`: thành viên và phòng góp ý
   (`MembersSection`), lời mời (`InvitesSection`, link trỏ trang nhận lời mời của UI stock), yêu cầu tham gia
   (`JoinRequestsSection`); thao tác qua `use-members.ts`.
9. `packages/crew-web/src/features/settings/settings-page.tsx` → `SettingsPage`: hồ sơ (`ProfileForm`), ngôn ngữ, thông
   tin hệ thống chỉ đọc từ `GET /api/health` (`SystemInfo`).

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `packages/crew-web/src/features/dashboard/` | Trang Tổng quan | `DashboardPage`, `useDashboard`, `last14Days` |
| `packages/crew-web/src/features/inbox/` | Hộp thư | `InboxPage`, `INBOX_TAB_IDS`, `useInboxBadge`, `useInboxIssues` |
| `packages/crew-web/src/features/search/` | Tìm kiếm | `SearchPage`, `resultVisible` |
| `packages/crew-web/src/features/runs/run-page.tsx` | Trang run | `RunPage` |
| `packages/crew-web/src/features/runs/run-actions.ts` | Thao tác run, định dạng log | `runActionsFor`, `wakeupOutcome`, `formatRunLog` |
| `packages/crew-web/src/features/agents/list/` | Danh sách agent, bộ lọc | `AgentsPage`, `STATUS_FILTERS` |
| `packages/crew-web/src/features/agents/detail/agent-page.tsx` | Chi tiết agent | `AgentPage` |
| `packages/crew-web/src/features/agents/detail/instructions-tab.tsx` | AGENTS.md chỉ đọc, render lại | `InstructionsTab` |
| `packages/crew-web/src/features/agents/detail/model-select.tsx` | Đổi model mặc định | `ModelSelect` |
| `packages/crew-web/src/features/agents/detail/` (còn lại) | Tổng quan, Run, Cấu hình chạy, Skills, đổi tên, environment | `OverviewTab`, `RunsTab`, `RuntimeTab`, `SkillsTab`, `useAgentEnvironment` |
| `packages/crew-web/src/features/agents/use-agent-roles.ts` | Vai trò agent đang giữ | `useAgentHoldings`, `holdingsOf` |
| `packages/crew-web/src/features/agents/paths.ts`, `index.ts` | Đường dẫn, export | `agentRef` |
| `packages/crew-web/src/features/projects/list/projects-page.tsx` | Danh sách project | `ProjectsPage` |
| `packages/crew-web/src/features/projects/detail/project-page.tsx` | Chi tiết project | `ProjectPage` |
| `packages/crew-web/src/features/projects/detail/issues-tab.tsx`, `readiness-tab.tsx`, `rename-dialog.tsx` | Tab Yêu cầu, Sẵn sàng, đổi tên | `IssuesTab`, `ReadinessTab`, `RenameDialog` |
| `packages/crew-web/src/features/projects/detail/machines-tab.tsx` | Tab Máy: máy đã ghép kèm trạng thái dựng project (tự làm mới 10 giây khi còn máy đang dựng), owner bấm Thêm máy/Thử lại, sửa origin, nhánh, repo đi kèm (form đồng bộ lại theo dữ liệu server, hiện lời server khi 422) | `MachinesTab`, `PROJECT_MACHINES_REFRESH_MS` |
| `packages/crew-web/src/features/projects/paths.ts`, `index.ts` | Đường dẫn, export | `projectRef`, `companyHref` |
| `packages/crew-web/src/features/members/` | Thành viên, lời mời, yêu cầu tham gia | `MembersPage`, `useMembers`, `CONTRIBUTOR_DEPARTMENTS`, `inviteLink` |
| `packages/crew-web/src/features/settings/` | Cài đặt | `SettingsPage`, `ProfileForm`, `SystemInfo` |

## Dữ liệu

- Route lõi Paperclip: dashboard, issue, run (log, wakeup), agent (PATCH tên, biểu tượng, `adapterConfig.model`,
  `skills/sync`, AGENTS.md), project (PATCH), environment, thành viên, lời mời, yêu cầu tham gia, tìm kiếm, hồ sơ
  (`/api/auth/profile`), asset ảnh, `/api/health`.
- Route router Crew: phòng góp ý của thành viên (`contributors/:userId`), quyền xem project, số góp ý chờ duyệt.
- Data plugin: `crew.machines`, `crew.setupRuns`, vai trò project (`roles.get`).
- Danh sách endpoint đầy đủ: `ENDPOINTS` trong `packages/crew-web/src/api/endpoints.ts`.

## Flow liên quan

- `issues-web`: danh sách yêu cầu và popup mà các trang mở.
- `project-roles`: tab Vai trò trên trang project.
- `docs-snapshot`: tab Docs trên trang project.
- `setup-wizards`: tab Sẵn sàng, "Làm tiếp", nút gỡ project và agent.
- `agent-roles`: template AGENTS.md mà tab Hướng dẫn render lại.
- `skills`: skill company mà tab Skills bật tắt.
- `contributions`, `qc-department`, `project-access`: phòng góp ý, thẻ chờ duyệt, quyền xem project trên trang Thành
  viên và lọc kết quả.
- `multi-machine`: tab Máy của project (S25.3) và các route máy của project.
- `web-shell`, `design-system`: khung và component.

## Tests

- `packages/crew-web/test/features/dashboard/`: biểu đồ 14 ngày theo giờ Việt Nam, thẻ số, thẻ góp ý chỉ cho owner.
- `packages/crew-web/test/features/inbox/`: luật tab "Chờ tôi duyệt" và các tab khác, số đếm.
- `packages/crew-web/test/features/search/search-page.test.tsx`: ngưỡng ký tự, kết quả, mở popup giữ neo.
- `packages/crew-web/test/features/runs/`: thao tác theo trạng thái run và body gửi đi, trang run, run không có log.
- `packages/crew-web/test/features/agents/`: danh sách và lọc, tổng quan và "Làm tiếp", AGENTS.md chỉ đọc và render
  lại, đổi model chỉ gửi `model`, đổi tên, cấu hình chạy chỉ đọc, bật tắt skill.
- `packages/crew-web/test/features/projects/project-page.test.tsx`, `projects-page.test.tsx`, `rename-dialog.test.tsx`:
  tải theo `urlKey`, các tab, "Làm tiếp", đổi tên chỉ gửi trường cho phép.
- `packages/crew-web/test/features/projects/machines-tab.test.tsx`: tab Máy của project (trạng thái dựng, Thêm máy/Thử lại, repo đi kèm).
- `packages/crew-web/test/features/projects/roles-form.test.tsx`, `use-save-roles.test.ts`: tab Vai trò (xem flow
  `project-roles`).
- `packages/crew-web/test/features/members/`: link lời mời, phòng góp ý của thành viên.
- `packages/crew-web/test/features/settings/settings-page.test.tsx`: lưu tên, ảnh đại diện, viewer và người góp ý chỉ
  đổi tên.

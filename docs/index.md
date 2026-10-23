# Tổng quan phần Crew

## Mục đích

Repo này là bản fork Paperclip mà **2P Crew** (Crew v3) chạy trên đó. Phần lớn code là Paperclip upstream và
không thuộc phạm vi docs này. Docs ở đây chỉ mô tả phần Crew thêm vào: luật nghiệp vụ của Crew (vai trò agent,
cổng duyệt nhiều stage, công tắc và chuyển runtime, quyền xem project, góp ý chờ duyệt, Crew Jev), plugin
`crew.core`, UI Crew, các điểm Crew móc vào lõi Paperclip và script vận hành.

Agent chạy trên Mac của chủ dự án qua SSH environment; phần cài và kiểm Mac (`crew-mac`, app macOS) nằm ở repo
`crew`, không ở repo này.

Tài liệu Paperclip upstream (site Mintlify) nằm ở các thư mục khác trong `docs/` và ở `doc/`; chúng mô tả
Paperclip, không mô tả Crew. Phạm vi file nguồn của Crew là `source.include` trong `docs/flows.yaml`.

## Stack

- pnpm TypeScript monorepo của Paperclip (Node ≥ 24, xem `package.json` ở gốc).
- Server Paperclip (Express, Postgres qua `@paperclipai/db`). Code Crew phía server nằm ở `server/src/crew/` và
  chỉ được gọi từ vài điểm móc trong file lõi (danh sách và anchor: `crew/release/core-hooks.json`).
- Plugin `crew.core` (`packages/crew-plugin`, SDK `@paperclipai/plugin-sdk`): worker, webhook từ Mac, route API,
  bảng plugin `crew_*` (migration SQL ở `packages/crew-plugin/migrations/`), UI slot trong UI Paperclip gốc.
- UI Crew (`packages/crew-web`): React, react-router, TanStack Query, Tailwind, i18next (vi/en), build bằng Vite
  thành `server/ui-dist` của image.
- Script vận hành bash/Node/Python ở `crew/ops/` và `crew/release/`; template vai trò agent ở `crew/agents/`.

## Bản đồ module

| Thư mục | Vai trò |
|---------|---------|
| `server/src/crew` | Luật Crew trong server: cổng tạo/ghi issue, cổng nhận run, dừng run SSH, router Crew (góp ý, quyền xem project, Phòng QC, Jev) |
| `crew/release/core-hooks.json` | Danh sách điểm móc và vá lõi (hook H, vá driver/adapter P, vá lõi C), kèm test của từng mục |
| `packages/crew-plugin/src` | Plugin `crew.core`: worker, webhook bản tin máy và snapshot docs, route API (vai trò, việc trên máy, wizard, công tắc runtime, ghép máy), chuyển runtime, dữ liệu cho UI |
| `packages/crew-plugin/migrations` | Bảng plugin `crew_*` |
| `packages/crew-web/src` | UI Crew: shell, client API, design system và các trang theo `features/*` |
| `ui/` | UI Paperclip gốc; Crew chỉ vá vài file (flow `stock-ui`) |
| `packages/adapters/*-local` | Adapter runtime upstream; Crew vá vài file (flow `adapter-patches`) |
| `crew/ops` | Deploy overlay, auto-deploy, rollback, sao lưu, công cụ vận hành trên VPS |
| `crew/agents` | Template `AGENTS.md` theo vai trò và script áp vai trò cho agent |

## Danh sách flow

<!-- crew-docs:flows:start -->
| Flow | Id | Điểm vào |
|------|----|----------|
| [Vá adapter claude_local, codex_local, opencode_local](flows/adapter-patches.md) | `adapter-patches` | — |
| [Chặn agent sửa cấu hình agent, project, workspace và xóa issue](flows/agent-guards.md) | `agent-guards` | `server/src/crew/agent-config-gate.ts`, `server/src/crew/agent-write-guard.ts`, `packages/crew-plugin/src/security/index.ts` |
| [Template vai trò agent (AGENTS.md) và áp vai trò](flows/agent-roles.md) | `agent-roles` | `crew/agents/apply-roles.sh`, `packages/crew-web/src/lib/instructions/index.ts` |
| [File đính kèm: luật loại file, kiểm định kỳ, xem file](flows/attachments.md) | `attachments` | `packages/crew-plugin/src/attachments/audit.ts` |
| [Góp ý chờ owner duyệt (Phòng Marketing, Phòng QC)](flows/contributions.md) | `contributions` | `server/src/crew/contribution-routes.ts`, `packages/crew-web/src/features/contributions/routes.tsx` |
| [Móc Crew vào lõi Paperclip và nâng bản upstream](flows/core-hooks.md) | `core-hooks` | `server/src/crew/core-hooks.ts`, `crew/release/upgrade.sh` |
| [Plugin crew.core: worker, manifest, bảng plugin, cầu nối với server](flows/crew-plugin.md) | `crew-plugin` | `packages/crew-plugin/src/worker.ts`, `packages/crew-plugin/src/manifest.ts` |
| [Design system của UI Crew](flows/design-system.md) | `design-system` | `packages/crew-web/src/ds/index.ts` |
| [Docs dự án: nhận snapshot từ Mac, đọc docs, trạng thái, đồ thị](flows/docs-snapshot.md) | `docs-snapshot` | `packages/crew-plugin/src/docs/webhook.ts`, `packages/crew-plugin/src/docs/api.ts`, `packages/crew-web/src/features/docs/routes.tsx` |
| [Trang Hướng dẫn](flows/guide.md) | `guide` | `packages/crew-web/src/features/guide/routes.tsx`, `packages/crew-plugin/src/ui/guide/index.tsx` |
| [Cổng tạo và ghi issue (execution policy, vai trò, model)](flows/issue-gate.md) | `issue-gate` | `server/src/crew/issue-gate.ts`, `server/src/crew/issue-create-policy.ts` |
| [Issue trên UI Crew: danh sách, chi tiết, tạo yêu cầu, cổng duyệt, ép xong](flows/issues-web.md) | `issues-web` | `packages/crew-web/src/features/issues/routes.tsx`, `packages/crew-plugin/src/issues/force-done.ts` |
| [Crew Jev trên server: cấu hình, key, máy, log gate, so sánh với regex](flows/jev.md) | `jev` | `server/src/crew/jev-routes.ts`, `packages/crew-web/src/features/jev/routes.tsx` |
| [Hàng đợi việc trên máy (machine jobs)](flows/machine-jobs.md) | `machine-jobs` | `packages/crew-plugin/src/jobs/api.ts` |
| [Bản tin máy (machine-status) và ghép máy](flows/machine-status.md) | `machine-status` | `packages/crew-plugin/src/machines/webhook.ts`, `packages/crew-plugin/src/machines/pairing.ts`, `packages/crew-web/src/features/machines/routes.tsx` |
| [Một project chạy trên nhiều máy: ghim máy theo cây yêu cầu, tự chọn máy, dựng project trên máy](flows/multi-machine.md) | `multi-machine` | `server/src/crew/machine-select.ts` |
| [Sao lưu DB, kéo bản sao về Mac, diễn tập khôi phục, dọn log run](flows/ops-backup.md) | `ops-backup` | `crew/ops/backup.sh`, `crew/ops/pull-backup.sh` |
| [Deploy overlay lên VPS, auto-deploy và rollback](flows/ops-deploy.md) | `ops-deploy` | `crew/ops/deploy.sh`, `crew/ops/auto-deploy.mjs`, `crew/ops/overlay-source.sh` |
| [Công cụ vận hành: cấu hình policy, quyền agent, kiểm company, xem run, trạng thái plugin, company e2e](flows/ops-tools.md) | `ops-tools` | `crew/ops/policy-config.py`, `crew/ops/plugin-state.sh` |
| [Quyền xem project theo thành viên](flows/project-access.md) | `project-access` | `server/src/crew/project-access-routes.ts`, `packages/crew-web/src/features/access/access-guard.tsx` |
| [Vai trò agent theo project](flows/project-roles.md) | `project-roles` | `packages/crew-plugin/src/roles/api.ts`, `packages/crew-web/src/features/projects/detail/roles-tab.tsx` |
| [Phòng QC duyệt lại yêu cầu của mình](flows/qc-department.md) | `qc-department` | `server/src/crew/qc-verification.ts` |
| [Bản đồ yêu cầu và Roadmap](flows/roadmap-map.md) | `roadmap-map` | `packages/crew-plugin/src/handlers/map.ts`, `packages/crew-web/src/features/roadmap/routes.tsx` |
| [Giữ run khi máy quá tải, nhìn lại run trước và nối phiên trong gói](flows/run-claim.md) | `run-claim` | `server/src/crew/load-gate.ts` |
| [Bàn giao giữa vai trò, đánh thức lại và run bị hủy](flows/run-handoff.md) | `run-handoff` | `server/src/crew/handoff-rewake.ts`, `packages/crew-plugin/src/run-cancelled.ts` |
| [Chuyển runtime khi run hỏng và chờ Claude chạy lại](flows/runtime-fallback.md) | `runtime-fallback` | `packages/crew-plugin/src/runtimes/fallback.ts`, `packages/crew-plugin/src/runtimes/decisions.ts` |
| [Công tắc runtime theo máy (Claude, Codex, OpenCode)](flows/runtime-switches.md) | `runtime-switches` | `packages/crew-plugin/src/runtimes/switches.ts`, `server/src/crew/runtime-gate.ts` |
| [Wizard thêm agent, thêm project, gỡ và kiểm sẵn sàng](flows/setup-wizards.md) | `setup-wizards` | `packages/crew-plugin/src/setup/api.ts`, `packages/crew-web/src/features/wizards/routes.tsx` |
| [Skill của company và đồng bộ skill xuống máy](flows/skills.md) | `skills` | `packages/crew-web/src/features/skills/routes.tsx` |
| [Run qua SSH trên Mac: chạy tại chỗ, dừng từ xa, biên nhận dừng](flows/ssh-run-lifecycle.md) | `ssh-run-lifecycle` | `server/src/crew/remote-stop.ts` |
| [UI Paperclip gốc ở /paperclip/ và chỗ trống khi log hoặc file đã bị dọn](flows/stock-ui.md) | `stock-ui` | `crew/ops/stock-ui.sh`, `ui/src/main.tsx` |
| [Chi phí (usage) và dung lượng lưu trữ](flows/usage-storage.md) | `usage-storage` | `packages/crew-plugin/src/usage/data.ts`, `packages/crew-plugin/src/storage/data.ts` |
| [Trang tổng quan, hộp thư, tìm kiếm, run, agent, project, thành viên, cài đặt](flows/web-pages.md) | `web-pages` | `packages/crew-web/src/features/dashboard/routes.tsx`, `packages/crew-web/src/features/inbox/routes.tsx`, `packages/crew-web/src/features/agents/routes.tsx`, `packages/crew-web/src/features/projects/routes.tsx` |
| [Khung UI Crew: router, phiên đăng nhập, shell, client API, i18n](flows/web-shell.md) | `web-shell` | `packages/crew-web/src/main.tsx`, `packages/crew-web/src/app/router.tsx` |
<!-- crew-docs:flows:end -->

## Cách dùng docs

- `docs/architecture.md`: thành phần, nơi lưu dữ liệu, dịch vụ bên ngoài, cách triển khai.
- `docs/flows/<id>.md`: mỗi flow nghiệp vụ hoặc kỹ thuật có một trang.
- `docs/flows.yaml`: nguồn sự thật flow ↔ file, cho máy đọc. File upstream mà Crew vá nằm ở mục `shared`.
- `docs/files.md`: tra ngược file → flow, sinh tự động bằng `crew-docs generate`.
- Thứ tự đọc: trang này → `crew-docs where <file>` hoặc `crew-docs flow <id>` → `docs/flows/<id>.md` → các file
  được liệt kê.

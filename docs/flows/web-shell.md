# Khung UI Crew: router, phiên đăng nhập, shell, client API, i18n

> Flow `web-shell`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow web-shell` in ra đúng danh sách đó.

## Mục đích

crew-web (`packages/crew-web`) là UI riêng của Crew, thay UI stock của Paperclip cho người dùng hằng ngày. Flow này là
phần khung mà mọi trang dùng chung: khởi động app, router gom route của từng feature, đăng nhập và duyệt đăng nhập CLI,
shell trong company (sidebar, chọn company, palette, menu tài khoản), lớp gọi API duy nhất, cập nhật trực tiếp qua
WebSocket, và i18n hai ngôn ngữ.

Luật chính:

- Feature không gọi mạng trực tiếp. Mọi endpoint nằm trong bảng `ENDPOINTS` (`packages/crew-web/src/api/endpoints.ts`),
  mỗi dòng gắn mã nút BA dùng nó; client trong `api/paperclip` và `api/crew` gọi qua `call(<khóa>)`. Data plugin chỉ
  gọi được các khóa trong `CREW_DATA_KEYS`. Test chặn trùng và chặn lời gọi DELETE tới environment, project, agent.
- Router gom `features/*/routes.tsx` bằng `import.meta.glob`, nên thêm trang không phải sửa router. Sidebar chỉ hiện
  mục khi feature đã có route (không link chết).
- Chỉ company có cấu hình Crew (data `crew.companies`) được liệt kê và vào được; vào bằng URL company khác ra 404.
- 401 giữa chừng: xóa phiên trong cache rồi điều hướng về `/login?next=`; `next` chỉ nhận đường nội bộ cùng origin
  (`safeNext`).
- Cập nhật trực tiếp invalidate query theo `queryKeys`, nên feature phải dùng đúng hàm khóa ở đó.
- Giờ hiển thị theo `Asia/Ho_Chi_Minh`; ngôn ngữ lưu ở trình duyệt (`crew.lang`), không gọi API.
- Sau deploy, chunk cũ bị xóa: tải lại trang một lần thay vì hiện trang lỗi, không lặp.

## Điểm vào

- `packages/crew-web/src/main.tsx`: nạp i18n, cài `installStaleChunkReload`, tạo QueryClient và router.
- `packages/crew-web/src/app/router.tsx` → `buildAppRoutes`: `/login`, `/cli-auth/:id`, `/` (về company đầu),
  `/:companyPrefix/...` (route feature trong `CompanyShell`), `/ds` chỉ ở dev.

## Các bước

1. `packages/crew-web/src/app/router.tsx` → `collectFeatureRoutes`, `buildAppRoutes`, `bindUnauthorizedHandler`.
2. `packages/crew-web/src/app/auth/require-session.tsx` → `RequireSession`: chưa đăng nhập thì về `/login?next=`.
   `login-page.tsx` → `LoginPage`: đăng nhập email/mật khẩu, không có đăng ký. `cli-auth-page.tsx` → `CliAuthPage`:
   duyệt đăng nhập CLI để app 2P Crew lấy board key.
3. `packages/crew-web/src/app/shell/shell.tsx` → `CompanyShell`: chọn company theo `/:companyPrefix`, gắn sidebar,
   palette, cập nhật trực tiếp, popup issue; `RootRedirect`, `CompanyNotFound`.
4. `packages/crew-web/src/app/hooks.ts` → `useCompany`, `useMe`, `useSession`, `useCrewCompanies`.
5. `packages/crew-web/src/app/shell/sidebar.tsx` → `Sidebar`: nhóm như Paperclip, badge Hộp thư, project gắn sao
   (`starred-projects.ts`); `company-switcher.tsx`, `command-palette.tsx` (Cmd/Ctrl+K, gõ mã mở issue),
   `account-menu.tsx`, `language-switch.tsx`, `mobile-menu.ts`.
6. `packages/crew-web/src/api/http.ts` → `http`, `ApiError`: fetch cùng origin kèm cookie phiên; lỗi giữ nguyên câu
   server. `api/endpoints.ts` → `ENDPOINTS`, `call`; `api/index.ts` → `api` (cổng duy nhất feature import).
7. `packages/crew-web/src/app/live/live-events.ts`: WebSocket `/api/companies/:companyId/events/ws`, invalidate theo
   sự kiện, nối lại với độ trễ tăng dần (`reconnectDelay`).
8. `packages/crew-web/src/i18n/index.ts` → `initI18n`, `useT`, `setLanguage`; `i18n/format.ts` → `formatDateTime`,
   `formatRelative`, `formatUsd`.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `packages/crew-web/src/main.tsx` | Khởi động app | |
| `packages/crew-web/src/app/router.tsx` | Router, gom route feature | `buildAppRoutes`, `createAppRouter` |
| `packages/crew-web/src/app/providers.tsx` | QueryClient, provider gốc | `createQueryClient`, `AppProviders` |
| `packages/crew-web/src/app/hooks.ts` | Company, người dùng, phiên | `useCompany`, `useMe`, `useCrewCompanies` |
| `packages/crew-web/src/app/routes-util.ts` | `next` an toàn, mục sidebar, mã issue | `safeNext`, `ISSUE_REF_RE` |
| `packages/crew-web/src/app/not-found-page.tsx` | Trang 404 | `NotFoundPage` |
| `packages/crew-web/src/app/auth/` | Đăng nhập, duyệt CLI, chặn chưa đăng nhập | `LoginPage`, `CliAuthPage`, `RequireSession` |
| `packages/crew-web/src/app/shell/shell.tsx` | Shell trong company | `CompanyShell`, `RootRedirect` |
| `packages/crew-web/src/app/shell/sidebar.tsx` | Sidebar | `Sidebar` |
| `packages/crew-web/src/app/shell/` (còn lại) | Chọn company, palette, menu tài khoản, ngôn ngữ, menu màn hẹp, project gắn sao | `CompanySwitcher`, `CommandPalette`, `AccountMenu`, `starredProjects` |
| `packages/crew-web/src/app/live/live-events.ts` | Cập nhật trực tiếp | `liveSocketUrl`, `reconnectDelay` |
| `packages/crew-web/src/api/http.ts` | Lớp gọi mạng | `http`, `ApiError`, `setUnauthorizedHandler` |
| `packages/crew-web/src/api/endpoints.ts` | Bảng endpoint duy nhất | `ENDPOINTS`, `call` |
| `packages/crew-web/src/api/index.ts` | Cổng vào lớp dữ liệu | `api` |
| `packages/crew-web/src/api/queryKeys.ts` | Khóa TanStack Query | `queryKeys` |
| `packages/crew-web/src/api/crew/data.ts` | Data plugin `crew.core` | `CREW_DATA_KEYS` |
| `packages/crew-web/src/api/crew/machine-pins.ts` | Client router Crew của server cho chạy nhiều máy (ứng viên, máy ghim của yêu cầu, máy của project, chặn/gỡ/dựng máy khác) | `machinePinsApi` |
| `packages/crew-web/src/api/crew/types.ts` | Kiểu dữ liệu plugin dùng ở web | |
| `packages/crew-web/src/api/paperclip/` | Client route lõi Paperclip (issue, agent, project, environment, skill...) | |
| `packages/crew-web/src/i18n/index.ts`, `format.ts` | i18n và định dạng giờ, tiền | `useT`, `formatDateTime` |
| `packages/crew-web/src/lib/stale-chunk-reload.ts` | Tải lại khi chunk cũ mất | `installStaleChunkReload` |

## Dữ liệu

- Route lõi Paperclip và route plugin: toàn bộ liệt kê trong `ENDPOINTS` (`packages/crew-web/src/api/endpoints.ts`), kể cả các khóa chạy nhiều máy `machinePin.*` và `projectMachines.*`; khóa query tương ứng là `machineCandidates`, `issueMachine`, `projectMachines`.
  Plugin ở `/api/plugins/crew.core`, router Crew của server ở `/api/crew/companies/:companyId`.
- WebSocket `/api/companies/:companyId/events/ws`.
- Trình duyệt: `localStorage` khóa `crew.lang`; `sessionStorage` cho chống lặp tải lại.
- Kiểu dữ liệu plugin: `api/crew/types.ts` là bản chép, bản gốc ở `packages/crew-plugin/src/jobs/types.ts` và
  `packages/crew-plugin/src/setup/`; plugin đổi thì sửa cùng lúc. Logic dùng chung lấy qua subpath `shared/*` của plugin.

## Flow liên quan

- `project-access`: `AccessGuard` bọc route trong company, lọc project được cấp.
- `stock-ui`: nút mở UI Paperclip gốc trong sidebar và menu tài khoản.
- `design-system`: component dùng trong shell.
- `web-pages`, `issues-web`, `roadmap-map`, `docs-snapshot`, `machine-status`, `skills`, `setup-wizards`, `guide`:
  các feature gắn route vào router.
- `crew-plugin`: data key và route API mà client gọi.

## Tests

- `packages/crew-web/test/api/endpoints.test.ts`, `r3x-client.test.ts`, `agents-permissions.test.ts`, `labels.test.ts`:
  mỗi endpoint có mã BA, không trùng, không DELETE tới environment, project, agent; body và đường gửi đi.
- `packages/crew-web/test/api/http.test.ts`: 401 chuyển về đăng nhập, không chuyển vòng.
- `packages/crew-web/test/api/crew-shared.test.ts`: import logic dùng chung từ plugin.
- `packages/crew-web/test/app/router.test.tsx`, `routes-util.test.ts`, `login.test.tsx`, `cli-auth.test.tsx`: 404,
  chuyển hướng, `next` an toàn, duyệt CLI.
- `packages/crew-web/test/app/company-switcher.test.tsx`: chỉ company có cấu hình Crew, luôn gửi `companyId`.
- `packages/crew-web/test/app/sidebar-groups.test.tsx`, `sidebar-footer.test.tsx`, `starred-projects.test.ts`,
  `mobile-menu.test.tsx`, `command-palette.test.tsx`: sidebar, ngăn kéo màn hẹp, palette.
- `packages/crew-web/test/app/live-events.test.tsx`: URL WebSocket, invalidate theo sự kiện.
- `packages/crew-web/test/app/stock-ui-link.test.tsx`, `stock-ui.test.ts`: nút UI gốc (xem flow `stock-ui`).
- `packages/crew-web/test/i18n/format.test.ts`, `index.test.ts`, `packages/crew-web/test/lib/stale-chunk-reload.test.ts`:
  định dạng theo múi giờ, ngôn ngữ, tải lại một lần.

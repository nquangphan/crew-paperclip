# Terminal web của owner: mở khoá bằng mật khẩu, vé WebSocket, SSH tới phiên tmux của project

> Flow `web-terminal`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow web-terminal` in ra đúng danh sách đó.

## Mục đích

Owner mở terminal thật trên Mac của một project ngay từ trình duyệt (kể cả điện thoại) để chạy Claude Code hay lệnh
tay trong một worktree riêng, không đụng checkout của agent. Vì terminal chạy lệnh thật trên máy nên mọi lớp đều chỉ cho
owner: route, vé, WebSocket và trang. Mở khoá bằng mật khẩu đăng nhập, vé WebSocket dùng một lần, khoá máy kiểm chặt.

## Điểm vào

- Router `crewTerminalRoutes` (`server/src/crew/terminal/routes.ts`), gắn trong router góp ý
  (`contribution-routes.ts`, flow `contributions`) nên nằm dưới `/api/crew/companies/:companyId`. Chỉ owner bằng phiên
  trình duyệt (cần `sessionId`; board API key không dùng được):

| Method, đường | Body | Trả |
|---|---|---|
| `GET …/terminal/targets` | — | `{ items: [{ machineId, hostname, projectId, projectName, projectKey, branch }] }` |
| `GET …/terminal/unlock` | — | `{ unlocked, expiresAt }` |
| `POST …/terminal/unlock` | `{ password }` | `{ expiresAt }`; 403 `crew_terminal_bad_password`, 429 `crew_terminal_unlock_throttled` |
| `POST …/terminal/tickets` | `{ machineId, projectId }` | 201 `{ ticket, expiresAt }`; 423 `crew_terminal_locked`, 404 `crew_terminal_target_missing` |

  Body sai dạng thì 400 `crew_terminal_invalid`; không phải owner thì lỗi quyền của `requireOwner`.
- WebSocket `GET /api/crew/companies/:companyId/terminal/ws?ticket=&cols=&rows=`: `setupCrewTerminalWebSocketServer`
  (`terminal-ws.ts`), đăng ký trong `server/src/index.ts` trước handler live-events (live-events huỷ mọi upgrade chưa có
  handler nhận). Path khác thì để handler upgrade khác lo.
- UI: route `terminal/:machineId/:projectId` (`packages/crew-web/src/features/terminal/routes.tsx`), mở từ khối Terminal
  trên trang Máy. Mục và trang chỉ owner thấy (`nav-access.ts`, flow `project-access`).

## Các bước

1. Trang Máy (`terminal-targets-block.tsx` → `TerminalTargetsBlock`, chỉ render khi `useCompanyAccess().isOwner`, nên
   người khác không gọi API): `terminal.targets` rồi nhóm theo máy; mỗi project một dòng (tên, `projectKey`) với link
   "Mở terminal" tới `/<tiền tố company>/terminal/:machineId/:projectId`, `target="_blank"` để mở nhiều project cùng lúc.
   Không có project nào thì ghi "Chưa có dự án nào dựng xong trên máy."
2. `targets.ts` → `listTerminalTargets`, `resolveTerminalTarget`: project có `project_machines.status = 'ready'` trên
   máy còn ghép (`machine_pairings.revoked_at IS NULL`), kèm `project_repos.branch`. `projectKey` lấy từ đường dẫn checkout
   `…/crew-agents/<khóa>/repo`; dòng không khớp mẫu bị bỏ.
3. Mở khoá (`unlock-dialog.tsx`, `unlock-store.ts`, `unlock-throttle.ts`, `password.ts`): trang kiểm `unlockStatus`; khoá
   thì hỏi mật khẩu đăng nhập Crew (`verifyUserPassword` kiểm tài khoản `credential` của Better Auth). Đúng thì mở khoá
   12 giờ theo phiên đăng nhập; trạng thái và bộ đếm nằm trong bộ nhớ nên khởi động lại server là phải nhập lại. Sai quá 5
   lần trong 15 phút (đếm theo user, mọi phiên chung) thì 429; nhập đúng xoá bộ đếm. Không log mật khẩu.
4. Vé (`ticket-store.ts`): `POST …/tickets` cần đã mở khoá và project vẫn `ready`; vé sống 60 giây, dùng một lần
   (`consume` xoá ngay), kho chỉ giữ sha256 của vé, ràng với company, user, phiên, máy và project.
5. Nâng cấp WebSocket (`terminal-ws.ts` → `authorize`), mọi bước chạy trước khi tạo socket, hỏng thì 401/403 rồi huỷ
   socket: có phiên → tiêu thụ vé (401 nếu thiếu hay đã dùng) → vé khớp company, user, phiên → vẫn là owner đang hoạt động
   → phiên còn mở khoá → project còn `ready` trên máy → máy có thông tin SSH. `cols`/`rows` ngoài khoảng cho phép thì
   lấy 80x24. Ping 30 giây, hai nhịp không pong thì ngắt.
6. SSH (`ssh-connector.ts`): `resolveMachineSshTarget` lấy host, cổng, user và khoá riêng từ environment mẫu của máy đã
   ghép; `createSsh2CrewTerminalConnector` mở kênh PTY `xterm-256color` chạy lệnh của bước 7. Khoá máy: khi
   `strictHostKeyChecking` bật, so khoá do máy trình với `known_hosts` theo khoá (không theo tên máy), dòng `@revoked`
   khớp thì loại, dòng `@cert-authority` bỏ qua; không có dòng khớp thì từ chối ("Khoá máy không khớp known_hosts").
7. Lệnh trên Mac (`remote-command.ts` → `buildOwnerTerminalCommand`): kiểm chặt `projectKey` và tên nhánh trước khi
   nhúng, rồi quote cả script. Chạy `unset PAPERCLIP_RUN_ID`; thiếu tmux hay project chưa dựng thì in lý do và thoát. Dựng
   worktree `~/crew-agents/<khóa>/owner` trên nhánh `owner/<khóa>` nếu chưa có (fetch `origin/<nhánh>`, dùng lại nhánh
   `owner/<khóa>` nếu đã tồn tại), rồi `tmux -L crew new-session -A -s crew-owner-<khóa>` (kèm `-f ~/.crew-mac/tmux.conf`
   nếu có file đó): gắn lại phiên cũ hoặc tạo mới, nên đóng tab không giết phiên.
8. Khung WebSocket: máy chủ gửi `ready`, `output`, `closed`, `error`; trình duyệt gửi `input` và `resize`. Lỗi gửi cho
   trình duyệt là câu chung, không lộ lỗi SSH thô; log chỉ ghi user, máy, project và lý do đóng (không ghi vé, phím gõ hay
   output). Không có tự đóng khi rảnh: phiên chỉ đóng khi trình duyệt đóng, shell thoát, SSH lỗi hoặc server tắt.
9. Trang terminal (`terminal-page.tsx`, `use-terminal-socket.ts`): chỉ owner; xin vé mới ở mỗi lần nối rồi mở WebSocket,
   rớt mạng thì nối lại (tmux vẽ lại màn hình khi gắn vào); chưa mở khoá (423) thì hiện hộp mật khẩu rồi tự nối; vé trả 4xx
   khác thì báo thiếu máy/project và không nối lại. `mount-xterm.ts` gắn xterm với addon fit, unicode11, web-links, search,
   WebGL nạp sau cùng (mất context thì lùi về DOM). `xterm-options.ts`: tuỳ chọn, theo màu sáng/tối và bậc cỡ chữ (lưu
   `localStorage`). `paste.ts`: dán nhiều dòng bọc bracketed paste, chia khúc 16 KiB, tối đa 16 MiB.
   `accessory-keys.tsx`: hàng phím phụ (Esc, Tab, mũi tên, Ctrl+C...) cho màn hình cảm ứng, dựng bằng `TerminalKeyRow`.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `server/src/crew/terminal/routes.ts` | Router terminal của owner | `crewTerminalRoutes`, `TERMINAL_ERRORS` |
| `server/src/crew/terminal/terminal-ws.ts` | WebSocket: kiểm vé, mở SSH, chuyển khung | `setupCrewTerminalWebSocketServer` |
| `server/src/crew/terminal/targets.ts` | Máy và project `ready` mở được terminal | `listTerminalTargets`, `resolveTerminalTarget` |
| `server/src/crew/terminal/password.ts` | Kiểm mật khẩu đăng nhập | `verifyUserPassword` |
| `server/src/crew/terminal/unlock-store.ts` | Mở khoá 12 giờ theo phiên | `crewTerminalUnlockStore`, `createTerminalUnlockStore` |
| `server/src/crew/terminal/unlock-throttle.ts` | 5 lần sai / 15 phút theo user | `crewTerminalUnlockThrottle`, `createUnlockThrottle` |
| `server/src/crew/terminal/ticket-store.ts` | Vé WebSocket một lần, 60 giây | `crewTerminalTicketStore`, `createTerminalTicketStore` |
| `server/src/crew/terminal/ssh-connector.ts` | Thông tin SSH máy, kênh PTY, luật khoá máy | `resolveMachineSshTarget`, `createSsh2CrewTerminalConnector` |
| `server/src/crew/terminal/remote-command.ts` | Lệnh worktree owner và phiên tmux | `buildOwnerTerminalCommand` |
| `server/src/crew/contribution-routes.ts` | File chứa router cha (flow `contributions`) | `crewContributionRoutes` |
| `server/src/index.ts` | File upstream đăng ký WebSocket | `setupCrewTerminalWebSocketServer` |
| `packages/crew-web/src/api/crew/terminal.ts` | Client API | `terminalApi` |
| `packages/crew-web/src/features/machines/terminal-targets-block.tsx` | Khối Terminal trên trang Máy | `TerminalTargetsBlock` |
| `packages/crew-web/src/features/terminal/routes.tsx` | Route `terminal/:machineId/:projectId` | `routes` |
| `packages/crew-web/src/features/terminal/terminal-page.tsx` | Trang terminal | `TerminalPage` |
| `packages/crew-web/src/features/terminal/use-terminal-socket.ts` | Vé, nối, nối lại | `useTerminalSocket`, `terminalSocketUrl` |
| `packages/crew-web/src/features/terminal/unlock-dialog.tsx` | Hộp mật khẩu | `UnlockDialog` |
| `packages/crew-web/src/features/terminal/mount-xterm.ts` | Gắn xterm và addon | `mountXterm` |
| `packages/crew-web/src/features/terminal/xterm-options.ts` | Tuỳ chọn, màu, cỡ chữ | `buildTerminalOptions`, `fontSizeFor` |
| `packages/crew-web/src/features/terminal/paste.ts` | Chuẩn bị nội dung dán | `preparePaste`, `PasteTooLargeError` |
| `packages/crew-web/src/features/terminal/accessory-keys.tsx` | Phím phụ cho cảm ứng | `AccessoryKeys`, `ACCESSORY_KEYS` |
| `packages/crew-web/src/ds/widgets/terminal-shell.tsx` | Khung trang terminal và hàng phím | `TerminalShell`, `TerminalKeyRow` |

## Dữ liệu

- Không có bảng mới. Đọc `project_machines`, `machine_pairings`, `project_repos` (bảng plugin), `projects`,
  `company_memberships`, tài khoản đăng nhập Better Auth và environment mẫu của máy.
- Trạng thái mở khoá, bộ đếm sai và kho vé nằm trong bộ nhớ tiến trình server.
- Trên Mac: worktree `~/crew-agents/<khóa>/owner` (nhánh `owner/<khóa>`), phiên tmux `crew-owner-<khóa>` trên socket
  `-L crew`.
- Trình duyệt: `localStorage` khóa `crew.terminal.fontScale`.

## Flow liên quan

- `contributions`: router cha gắn `crewTerminalRoutes`; `resolveContributionActor` và `requireOwner` quyết quyền.
- `multi-machine`: `project_machines` (`ready`), `pairedMachine` và environment mẫu của máy.
- `machine-status`: trang Máy chứa khối Terminal; máy ghép và `machine_pairings`.
- `project-access`: `nav-access.ts` chỉ cho owner thấy trang terminal.
- `web-shell`: `ENDPOINTS` có `terminal.*`, `queryKeys.terminalTargets`.
- `design-system`: `TerminalShell` và `TerminalKeyRow` nằm trong `ds/widgets`.
- `run-handoff`: `server/src/index.ts` là file chung, đăng ký WebSocket terminal cạnh vá C10.

## Tests

- `server/src/__tests__/crew-terminal-stores.test.ts`: hạn mở khoá 12 giờ, 5 lần sai / 15 phút, vé một lần và hết hạn.
- `server/src/__tests__/crew-terminal-routes.db.test.ts` (Postgres nhúng): chỉ owner, danh sách máy/project `ready`,
  mở khoá đúng/sai/bị chặn, vé cần mở khoá, project không còn `ready` thì 404.
- `server/src/__tests__/crew-terminal-ws.test.ts`: từng bước chặn lúc nâng cấp (phiên, vé, khớp phiên, owner, mở khoá,
  project, SSH), chuyển khung input/output/resize, đóng sạch, không lộ lỗi thô.
- `server/src/__tests__/crew-terminal-ssh-connector.test.ts`: luật `known_hosts` (khớp khoá, `@revoked`,
  `@cert-authority`, không có dòng) và lấy thông tin SSH của máy.
- `server/src/__tests__/crew-terminal-remote-command.test.ts`: từ chối khoá và nhánh lạ, script worktree owner và tmux.
- `packages/crew-web/test/features/machines/terminal-targets-block.test.tsx`: nhóm theo máy, href và `target="_blank"`,
  trạng thái trống, người không phải owner không thấy khối và không gọi API.
- `packages/crew-web/test/features/terminal/terminal-page.test.tsx`: trang chỉ owner, khoá thì hỏi mật khẩu rồi nối.
- `packages/crew-web/test/features/terminal/xterm-options.test.ts`, `paste.test.ts`, `accessory-keys.test.tsx`: tuỳ chọn
  và cỡ chữ, bọc và chia khúc khi dán, hàng phím phụ.

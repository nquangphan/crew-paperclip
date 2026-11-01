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
- UI: không có route riêng. `TerminalDockProvider` (`packages/crew-web/src/features/terminal/terminal-dock.tsx`) bọc mọi
  trang trong company (`shell.tsx`, flow `web-shell`); owner có nút tròn ở góc dưới bên phải để ẩn hiện khung nổi
  terminal, như khung chat. Mở từ nút tròn hoặc nút Mở terminal trên trang Máy (`useTerminalDock().open(target)`).

## Các bước

1. Trang Máy (`terminal-targets-block.tsx` → `TerminalTargetsBlock`, chỉ render khi `useCompanyAccess().isOwner`, nên
   người khác không gọi API): `terminal.targets` rồi nhóm theo máy (`groupTargetsByMachine` của `target-switcher.tsx`); mỗi project một dòng (tên, `projectKey`) với nút
   "Mở terminal" mở khung nổi ở đúng project đó (nút bị khoá khi không có khung nổi, tức không phải owner).
   Không có project nào thì ghi "Chưa có dự án nào dựng xong trên máy."
2. `targets.ts` → `listTerminalTargets`, `resolveTerminalTarget`: project có `project_machines.status = 'ready'` trên
   máy còn ghép (`machine_pairings.revoked_at IS NULL`), kèm `project_repos.branch` (`null` khi project chưa ghi origin).
   `projectKey` lấy từ checkout `~/crew-agents/<khóa>/<vai>` của agent vai trò (`projectLayout`), nên đúng cả với project
   dùng bản clone sẵn của owner (`repo_path` nằm ngoài `crew-agents`); không có thì từ `repo_path` dạng
   `…/crew-agents/<khóa>/repo`; không ra khóa thì dòng bị bỏ.
3. Mở khoá (`unlock-panel.tsx`, `unlock-store.ts`, `unlock-throttle.ts`, `password.ts`): trang không đọc
   `GET …/unlock` (route này có nhưng trang không dùng); trạng thái khoá lộ ra khi xin vé bị 423
   (`use-terminal-socket.ts` đặt trạng thái `locked`) và trang hiện `UnlockPanel` giữa khung terminal hỏi mật khẩu đăng nhập Crew (`verifyUserPassword` kiểm tài khoản `credential` của Better Auth). Đúng thì mở khoá
   12 giờ theo phiên đăng nhập; trạng thái và bộ đếm nằm trong bộ nhớ nên khởi động lại server là phải nhập lại. Sau 5
   lần sai trong 15 phút (đếm theo user, mọi phiên chung), các lần nhập tiếp theo bị 429 cho tới khi cửa sổ 15 phút
   qua đi; nhập đúng xoá bộ đếm. Mỗi lần thử được ghi (`reserve`) trước khi kiểm mật khẩu, nên gửi nhiều yêu cầu cùng lúc
   cũng không vượt 5 lần kiểm. Không log mật khẩu.
4. Vé (`ticket-store.ts`): `POST …/tickets` cần đã mở khoá và project vẫn `ready`; vé sống 60 giây, dùng một lần
   (`consume` xoá ngay), kho chỉ giữ sha256 của vé, ràng với company, user, phiên, máy và project.
5. Nâng cấp WebSocket (`terminal-ws.ts` → `authorize`), mọi bước chạy trước khi tạo socket, hỏng thì 401/403 rồi huỷ
   socket: có phiên → tiêu thụ vé (401 nếu thiếu hay đã dùng) → vé khớp company, user, phiên → vẫn là owner đang hoạt động
   → phiên còn mở khoá → project còn `ready` trên máy → máy có thông tin SSH. `cols`/`rows` ngoài khoảng cho phép thì
   lấy 80x24. Ping 30 giây, hai nhịp không pong thì ngắt. Mỗi nhịp ping còn kiểm lại quyền của terminal đang mở: phiên
   còn hợp lệ (gọi lại `resolveSessionFromHeaders` bằng header lúc nâng cấp, phải ra đúng phiên và user của vé), vẫn là
   owner, phiên còn mở khoá. Mất một trong ba thì gửi `error`, đóng 1008 và log lý do `session_revoked`, `not_owner` hoặc
   `unlock_expired` (đăng xuất mọi phiên, hạ vai hay hết 12 giờ là cắt shell).
6. SSH (`ssh-connector.ts`): `resolveMachineSshTarget` lấy host, cổng, user và khoá riêng từ environment mẫu của máy đã
   ghép; `createSsh2CrewTerminalConnector` mở kênh PTY `xterm-256color` chạy lệnh của bước 7. Output giải mã UTF-8 liên tục
   (`StringDecoder`) để ký tự nhiều byte (tiếng Việt, khung kẻ của TUI) bị cắt giữa hai gói SSH không thành `�`. Khoá máy: khi
   `strictHostKeyChecking` bật, so khoá do máy trình với `known_hosts` theo khoá (không theo tên máy), dòng `@revoked`
   khớp thì loại, dòng `@cert-authority` bỏ qua; không có dòng khớp thì từ chối ("Khoá máy không khớp known_hosts").
7. Lệnh trên Mac (`remote-command.ts` → `buildOwnerTerminalCommand`): kiểm chặt `projectKey` và tên nhánh trước khi
   nhúng, rồi quote cả script. Chạy `unset PAPERCLIP_RUN_ID`; tìm tmux bằng `command -v tmux`, không thấy thì thử
   `/opt/homebrew/bin/tmux` rồi `/usr/local/bin/tmux` (như crew-mac dò) và chạy đúng đường dẫn tìm được; vẫn thiếu tmux hay
   project chưa dựng thì in lý do và thoát. Dựng worktree `~/crew-agents/<khóa>/owner` trên nhánh `owner/<khóa>` nếu chưa
   có. Repo gốc là `~/crew-agents/<khóa>/repo` nếu có, không thì repo chính của một worktree vai trong thư mục đó (dòng
   đầu `git worktree list`; bỏ qua symlink companion). Trước hết gỡ đúng đăng ký worktree `owner` cũ
   (`git worktree remove --force`; thư mục owner bị xoá tay thì dựng lại được; không prune cả repo vì repo có thể là bản
   clone riêng của owner), fetch `origin/<nhánh>` (không biết nhánh thì fetch `origin`, thiếu `origin/HEAD` thì
   `remote set-head origin -a`, rồi dựng từ `origin/HEAD`), dùng lại nhánh `owner/<khóa>` nếu đã tồn tại; rồi `tmux -L crew new-session -A -s crew-owner-<khóa>` (kèm `-f ~/.crew-mac/tmux.conf`
   nếu có file đó): gắn lại phiên cũ hoặc tạo mới, nên đóng tab không giết phiên.
8. Khung WebSocket: máy chủ gửi `ready`, `output`, `closed`, `error`; trình duyệt gửi `input` và `resize`. Lỗi gửi cho
   trình duyệt là câu chung, không lộ lỗi SSH thô, và trang chỉ hiện các lý do đóng/lỗi của server bằng câu tiếng Việt
   i18n (`use-terminal-socket.ts` trả `notice`, không hiện chuỗi thô); log chỉ ghi user, máy, project và lý do đóng (không ghi vé, phím gõ hay
   output). Không có tự đóng khi rảnh: phiên chỉ đóng khi trình duyệt đóng, shell thoát, SSH lỗi, mất quyền (bước 5) hoặc
   server tắt.
9. Khung nổi (`terminal-dock.tsx`): `TerminalDockProvider` luôn bọc cây con ở cùng chỗ (tải xong vai trò không dựng lại
   trang); chỉ owner có `TerminalLauncher` (nút tròn, chấm xanh khi đang nối mà khung ẩn) và `TerminalDockPanel` (desktop:
   khung 56rem × 36rem trên nút tròn; điện thoại: phủ cả màn hình, nút tròn ẩn). Bấm lần đầu mới tải `terminal.targets` và
   nạp lười `terminal-session.tsx` (xterm). Ẩn chỉ đặt `hidden`, không gỡ: phiên giữ nguyên khi ẩn, khi chuyển trang trong
   app; đổi company thì dựng lại (`key`). Dự án đang mở nhớ ở `localStorage` `crew.terminal.dockTarget.<companyId>`; không
   còn trong danh sách thì lấy dự án đầu. Khung đặt `--crew-dock-space` để `FloatingNotice` đứng trên nút tròn.
   Phiên (`terminal-session.tsx` → `TerminalSession`, `use-terminal-socket.ts`): luôn nền tối (token `--terminal-*` trong
   `tokens.css`, class `dark` cho component bên trong), thanh trên có nút tiêu đề (`TargetSwitcher`, vẽ bằng
   `TerminalSwitcher` của ds) liệt kê mọi dự án sẵn sàng theo máy để đổi terminal tại chỗ, chấm trạng thái, nhóm cỡ chữ
   A−/A+ và nút ẩn. Thông báo nằm giữa khung (`TerminalPanel`) thay vì đẩy khung xuống: đang nối, khoá, đã ngắt (kèm Nối
   lại và Ẩn terminal). Xin vé mới ở mỗi lần nối rồi mở WebSocket, rớt mạng thì nối lại (tmux vẽ lại
   màn hình khi gắn vào); chưa mở khoá (423) thì hiện ô mật khẩu rồi tự nối và trả tiêu điểm cho terminal; vé trả 401/403
   thì `notice` `forbidden` (hết phiên hoặc mất quyền owner, bảo tải lại trang); 4xx khác thì `targetMissing` và không
   nối lại. Có vé mà WebSocket đóng trước `ready` 5 lần liền (server từ chối, lỗi
   SSH cố định) thì thôi nối lại, đóng với `notice` `connectFailed` chờ bấm Nối lại; nhận `ready` thì đếm lại từ đầu. `mount-xterm.ts` gắn xterm với addon fit, unicode11, web-links, search,
   WebGL nạp sau cùng (mất context thì lùi về DOM). `xterm-options.ts`: `shiftEnterHandler` (gắn bằng `attachCustomKeyEventHandler` trong `mount-xterm.ts`) gửi ESC+CR khi
   bấm Shift+Enter để xuống dòng trong Claude Code, chặn xterm gửi CR (đang gõ dở bằng bộ gõ Telex/VNI thì cho qua); tuỳ chọn (chữ thường, đậm 600, giãn dòng 1,15), bảng màu tối
   cố định với 16 màu ANSI (`terminalTheme`, không theo theme trang) và bậc cỡ chữ (lưu `localStorage`). `paste.ts`: dán nhiều dòng bọc bracketed paste, chia khúc 16 KiB, tối đa 16 MiB.
   `accessory-keys.tsx`: hàng phím phụ (Esc, Tab, mũi tên, Ctrl+C...) cho màn hình cảm ứng, dựng bằng `TerminalKeyRow`
   (nút cao 40px, chừa vùng an toàn đáy màn hình), chỉ hiện khi đã kết nối. Báo dán quá lớn tự ẩn sau 5 giây.

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
| `packages/crew-web/src/features/terminal/terminal-dock.tsx` | Nút tròn và khung nổi, nhớ dự án | `TerminalDockProvider`, `useTerminalDock` |
| `packages/crew-web/src/features/terminal/terminal-session.tsx` | Một phiên terminal trong khung nổi | `TerminalSession` |
| `packages/crew-web/src/features/terminal/use-terminal-socket.ts` | Vé, nối, nối lại | `useTerminalSocket`, `terminalSocketUrl` |
| `packages/crew-web/src/features/terminal/unlock-panel.tsx` | Ô mật khẩu giữa khung terminal | `UnlockPanel` |
| `packages/crew-web/src/features/terminal/target-switcher.tsx` | Nút tiêu đề đổi dự án/máy | `TargetSwitcher`, `groupTargetsByMachine` |
| `packages/crew-web/src/features/terminal/mount-xterm.ts` | Gắn xterm và addon | `mountXterm` |
| `packages/crew-web/src/features/terminal/xterm-options.ts` | Tuỳ chọn, màu, cỡ chữ | `buildTerminalOptions`, `fontSizeFor` |
| `packages/crew-web/src/features/terminal/paste.ts` | Chuẩn bị nội dung dán | `preparePaste`, `PasteTooLargeError` |
| `packages/crew-web/src/features/terminal/accessory-keys.tsx` | Phím phụ cho cảm ứng | `AccessoryKeys`, `ACCESSORY_KEYS` |
| `packages/crew-web/src/ds/widgets/terminal-shell.tsx` | Khung terminal và mọi khối trang trí của nó (nút tròn, khung nổi, chọn dự án, cỡ chữ, trạng thái, thẻ giữa khung, dải báo, hàng phím) | `TerminalShell`, `TerminalLauncher`, `TerminalDockPanel`, `TerminalSwitcher`, `TerminalPanel`, `TerminalKeyRow` |

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
- `project-access`: không còn route terminal; khung nổi chỉ owner có (`TerminalDockProvider` kiểm `useCompanyAccess().isOwner`).
- `web-shell`: `ENDPOINTS` có `terminal.*`, `queryKeys.terminalTargets`; `CompanyShell` bỏ khung khi route có `handle.fullscreen`.
- `design-system`: các khối `Terminal*` nằm trong `ds/widgets` (trang chỉ được dùng class bố cục, guard `design-system.test.ts`); token `--terminal-*` và icon `Lock`, `SquareTerminal`.
- `run-handoff`: `server/src/index.ts` là file chung, đăng ký WebSocket terminal cạnh vá C10.

## Tests

- `server/src/__tests__/crew-terminal-stores.test.ts`: hạn mở khoá 12 giờ, 5 lần sai / 15 phút (kể cả nhiều lần thử
  cùng lúc), vé một lần và hết hạn.
- `server/src/__tests__/crew-terminal-routes.db.test.ts` (Postgres nhúng): chỉ owner, danh sách máy/project `ready`,
  mở khoá đúng/sai/bị chặn, 10 lần sai gửi cùng lúc chỉ tối đa 5 lần được kiểm, vé cần mở khoá, project không còn
  `ready` thì 404, project dùng bản clone sẵn của owner vẫn có khóa (từ checkout agent) và nhánh `null`.
- `server/src/__tests__/crew-terminal-ws.test.ts`: từng bước chặn lúc nâng cấp (phiên, vé, khớp phiên, owner, mở khoá,
  project, SSH), chuyển khung input/output/resize, đóng sạch, không lộ lỗi thô; đang mở mà phiên bị thu hồi, mất vai
  owner hay hết mở khoá thì đóng 1008.
- `server/src/__tests__/crew-terminal-ssh-connector.test.ts`: luật `known_hosts` (khớp khoá, `@revoked`,
  `@cert-authority`, không có dòng), ký tự UTF-8 bị cắt giữa hai gói, và lấy thông tin SSH của máy.
- `server/src/__tests__/crew-terminal-remote-command.test.ts`: từ chối khoá và nhánh lạ, script worktree owner và tmux,
  thứ tự dò tmux, nhánh `null` dựng từ `origin/HEAD`; chạy thật với repo git và tmux giả: dựng worktree owner, dựng lại
  sau khi thư mục owner bị xoá tay mà không gỡ đăng ký worktree khác đang mất thư mục, và tìm repo gốc là bản clone ngoài `crew-agents` qua worktree vai (bỏ qua symlink).
  Ca thiếu tmux bỏ qua khi máy chạy test có tmux ở chỗ lệnh tự dò.
- `packages/crew-web/test/features/machines/terminal-targets-block.test.tsx`: nhóm theo máy, href và `target="_blank"`,
  trạng thái trống, người không phải owner không thấy khối và không gọi API.
- `packages/crew-web/test/features/terminal/terminal-dock.test.tsx`: nút tròn chỉ owner, khoá thì hỏi mật khẩu trong khung, ẩn giữ phiên, đổi dự án và nhớ, nút trên trang Máy mở đúng dự án.
- `packages/crew-web/test/features/terminal/xterm-options.test.ts`, `paste.test.ts`, `accessory-keys.test.tsx`: tuỳ chọn
  và cỡ chữ, bọc và chia khúc khi dán, hàng phím phụ.
- `packages/crew-web/test/features/terminal/shift-enter.test.ts`: Shift+Enter gửi ESC+CR, Enter thường, tổ hợp khác và
  lúc bộ gõ đang soạn chữ thì để xterm tự xử lý.
- `packages/crew-web/test/features/terminal/use-terminal-socket.test.tsx`: 423 thành `locked`, 4xx khác báo thiếu
  máy/project không nối lại, khung `closed`/`error` của server thành `notice` chung không lộ lý do thô, 5 lần liền đóng
  trước `ready` thì dừng với `connectFailed`, `ready` đếm lại.

# Playwright UI Crew

Ca Playwright cho UI Crew (`packages/crew-web`). Mỗi ca thao tác bằng UI rồi kiểm tác dụng thật bằng `GET` API
(`support/api.ts`) hoặc `psql` chỉ đọc (`support/db.ts`). Không có secret trong thư mục này.

## Tầng

| Tầng | Lệnh | Chạy ở đâu | Ca |
|---|---|---|---|
| T1 | `bash e2e/support/run-e2e.sh --project=t1` | Stack cục bộ `~/crew-r3-t1` (server fork `3199` + Postgres nhúng, web dev `5183`) | Ca có tag `@t1` |
| T2 | `bash e2e/support/run-e2e.sh --project=t2` | Prod, company **Crew E2E**, chế độ stub (0 quota) | Mọi ca trừ `@t3`, `@t1-only` |
| T3 | `bash e2e/support/run-e2e.sh --project=t3` | Prod, Crew E2E, chạy `claude` thật (trần 20 run) | Ca có tag `@t3` |

Tham số sau `--project` chuyển thẳng cho `playwright test` (ví dụ `--grep PW-S6-7`, `--list`, `--trace on`).
Chạy từ thư mục `packages/crew-web`. `retries: 1`, `workers: 1`.

## Tài khoản và mật khẩu

- T2/T3: `run-e2e.sh` đọc `PAPERCLIP_BOARD_EMAIL` và `PAPERCLIP_BOARD_PASSWORD` từ `/opt/crew-v3-spike/.env` trên VPS
  qua `ssh` (chỉ giá trị cần dùng đi qua pipe), đưa vào biến môi trường `CREW_E2E_EMAIL`, `CREW_E2E_PASSWORD` của
  process Playwright. Không echo, không ghi file, không nằm trong tham số lệnh.
- T1: tài khoản tạm ở `~/crew-r3-t1/board.env` (quyền 600, không phải mật khẩu prod).
- Đăng nhập luôn bằng form `/login` (`support/login.ts`). `global-setup.ts` đăng nhập một lần, lưu `storageState`
  vào thư mục tạm 0700 của lượt chạy (`run-e2e.sh` xóa khi xong).
- Trace chụp DOM (cả giá trị ô mật khẩu) và body request đăng nhập. File spec nào điền mật khẩu thật phải đặt
  `test.use({ trace: 'off' })` ở đầu file (xem `specs/t1-login.spec.ts`). Sau mỗi lượt, `run-e2e.sh` giải nén mọi
  `trace.zip` và quét `test-results`; thấy mật khẩu thì xóa tệp đó và thoát mã 3.

## Biến môi trường

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `CREW_E2E_TIER` | `run-e2e.sh` đặt theo `--project` | `t1`, `t2`, `t3` |
| `CREW_E2E_BASE_URL` | T1 `http://127.0.0.1:5183`, còn lại `https://crew.2p-solutions.com` | Gốc UI |
| `CREW_E2E_COMPANY_ID` | Crew E2E `a7132a14-…` (prod); T1 lấy từ `board.env` | Company của ca. Trên prod chỉ nhận Crew E2E |
| `CREW_E2E_AGENTS_ROOT` | `~/crew-agents` | Gốc checkout agent cho `stub.ts` |
| `CREW_E2E_SSH_HOST` | `nhamoiplatform` | Host VPS cho mật khẩu và `db.ts` |
| `CREW_E2E_COVERAGE_STRICT` | — | `1` thì ca "mọi mã BA có ca" trong `test/e2e-coverage.test.ts` chạy chặt |
| `CREW_E2E_SHOTS` | — | `1` thì chạy `specs/shots.spec.ts` (ảnh cho trang Hướng dẫn, ra `e2e/shots/`) |

## Helper (`support/`)

- `fixtures.ts`: `test` dùng chung với fixture `api` (REST board), `company` (`{id, issuePrefix, path()}`); cuối ca tự
  hủy issue đã ghi bằng `trackIssue(id)`.
- `api.ts`: `boardApi()`, `bearerApi(token)`; `api.get/post/patch/put/delete`, `api.raw` (không ném, cho ca âm),
  `api.crewData(key, companyId, params)`, `api.crewRoute(method, path, body)` (tiền tố
  `/api/plugins/crew.core/api`). Trên prod từ chối mọi lời gọi ghi có id company TPS.
- `db.ts`: `db.query(sql, params)` — chỉ một câu `SELECT`/`WITH`, tham số `$n` ghép an toàn, SQL đi qua stdin của
  `ssh nhamoiplatform docker exec crew-v3-spike-db-1 psql` với `default_transaction_read_only=on`. Chỉ có ở T2/T3.
- `stub.ts`: `stub.on(projectKey, seconds, role?)`, `stub.off(projectKey, role?)` ghi/xóa tệp `crew-e2e-stub` trong
  git dir của mỗi checkout `~/crew-agents/<projectKey>/*`. Chỉ nhận khóa `e2e-*`, bỏ checkout là symlink trỏ ra ngoài.
- `agent-token.ts`: `agentToken(api, agentId)` / `withAgentToken(api, agentId, fn)` — key agent tạm của company e2e,
  luôn xóa sau ca.
- `cleanup.ts`: `trackIssue`, `cancelTrackedIssues`, `resetAgentSessions(api, agentIds)`.
- `shots.ts`: `shoot(page, name)`, `SHOT_PAGES`.

## Chế độ stub

T2 bật stub cho mọi project `e2e-*` trong `global-setup.ts` (5 giây) và tắt trong `global-teardown.ts`. Ca cần run
"đang chạy" đặt `stub.on(key, 300)` rồi tự hủy run cuối ca. Run stub lưu phiên `crew-e2e-stub`; trước T3 gọi
`resetAgentSessions` cho agent `e2e-*` để `claude` thật không `--resume` một phiên không có.

## Project nền `e2e-base`

T2 cần project `e2e-base` (folder `~/crew-e2e/repo`, 2 executor) dựng bằng wizard Thêm project. `global-setup.ts`
tìm setup run `add-project` khóa `e2e-base` đã `done`; chưa có thì dừng lượt và báo. Phần chạy wizard tự động được
nối khi ca wizard (`specs/s9-add-project.spec.ts`) có.

## Bản đồ phủ nút

`e2e/ba-ids.json` là mọi mã của BA mục 1 (đã đổi theo spec §5). `e2e/coverage.json` ánh xạ mã → file spec, tên ca,
tầng (`tier`), hoặc `skip` (chỉ F9). `test/e2e-coverage.test.ts` (Vitest) kiểm bản đồ: tên ca phải có trong file
spec; ca "mọi mã có ca" chỉ chặt khi `CREW_E2E_COVERAGE_STRICT=1` cho tới khi đủ spec.

## Stack T1

`~/crew-r3-t1/` (ngoài repo): `env.sh` (biến môi trường server), `seed.mjs` (user board, company "Crew E2E",
plugin `crew.core` + cấu hình company), `board.env`, `home/` (dữ liệu Paperclip), `logs/`.

```sh
. ~/crew-r3-t1/env.sh && cd "$FORK" && node cli/node_modules/tsx/dist/cli.mjs cli/src/index.ts run --config "$PAPERCLIP_CONFIG"
cd "$FORK/packages/crew-web" && CREW_WEB_API=http://127.0.0.1:3199 npx vite --port 5183 --strictPort --host 127.0.0.1
```

Server cần `PAPERCLIP_ALLOWED_HOSTNAMES` có `127.0.0.1:5183` để Better Auth nhận origin của web dev. Tắt bằng
`kill -TERM <pid>` (server tự dừng Postgres nhúng). Ghi PID/cổng vào `processes.md` của plan.

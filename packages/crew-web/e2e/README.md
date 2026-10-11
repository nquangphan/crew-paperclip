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
- Tài khoản khách góp ý: xem mục "Tài khoản khách góp ý" bên dưới.
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
| `CREW_E2E_CONTRIBUTOR_EMAIL`, `CREW_E2E_CONTRIBUTOR_PASSWORD` | — (tùy chọn, phải đặt cả hai) | Tài khoản khách góp ý. Không đặt thì ca dùng fixture `contributorPage`/`contributorApi` tự bỏ qua |
| `CREW_E2E_AGENTS_ROOT` | `~/crew-agents` | Gốc checkout agent cho `stub.ts` |
| `CREW_E2E_SSH_HOST` | `nhamoiplatform` | Host VPS cho mật khẩu và `db.ts` |
| `CREW_E2E_BASE_KEY` | `e2e-base` | Khóa project nền (dạng `e2e-*`). Khóa đã gỡ không dựng lại được, xem mục Project nền |
| `CREW_E2E_COVERAGE_STRICT` | — | `1` thì ca "mọi mã BA có ca" trong `test/e2e-coverage.test.ts` chạy chặt |
| `CREW_GUIDE_SHOTS` | — | `1` thì chạy `specs/guide-shots.spec.ts` (ảnh cho trang Hướng dẫn, xem mục Ảnh trang Hướng dẫn) |
| `CREW_GUIDE_SHOTS_ONLY` | — | Danh sách id ảnh cách nhau bằng dấu phẩy: chỉ chụp lại các ảnh đó |
| `CREW_GUIDE_PASSWORD` | — | Mật khẩu tạm (chỉ T1) của hai tài khoản ảnh hướng dẫn |
| `CREW_GUIDE_POLICY_FILE` | — | File `CREW_POLICY_CONFIG` của server T1; `guide-shots` thêm company mẫu vào đó |

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
- `shots.ts`: `prepareContext` (theme sáng, ngôn ngữ), `annotate`/`clearMarks` (khung đỏ có số), `saveShot` (WebP vào
  `src/features/guide/img/<lang>/`).
- `guide-company.ts`: `ensureGuideCompany`, `seedGuideCompany` (company mẫu 2P Demo cho ảnh hướng dẫn).
  `guide-users.ts`: `ensureGuideMembers`, `guideAccountApi` (tài khoản theo vai trò của company mẫu).

## Tài khoản khách góp ý

Ca S20 (`specs/s20-contributions.spec.ts`) cần một tài khoản Phòng Marketing: thành viên `viewer` `active` của company
e2e, có dấu khách góp ý (bảng `crew_contributors`).

- T1: thêm hai dòng `CREW_E2E_CONTRIBUTOR_EMAIL` và `CREW_E2E_CONTRIBUTOR_PASSWORD` vào `~/crew-r3-t1/board.env`
  (quyền 600, mật khẩu tạm của stack cục bộ). Dựng tài khoản bằng đúng luồng của owner: tạo invite
  (`humanRole: viewer`, `defaultsPayload.crew.role: contributor`), đăng ký và nhận invite bằng tài khoản mới, duyệt yêu
  cầu tham gia, rồi `PUT /api/crew/companies/<cid>/contributors/<userId>` (hoặc bấm Đặt Phòng Marketing ở trang Thành
  viên).
- T2/T3: owner tạo tài khoản qua trang Thành viên của Crew E2E rồi lưu hai biến trên vào `/opt/crew-v3-spike/.env`.
  `run-e2e.sh` đọc hai biến qua `ssh` như mật khẩu board (không echo), và bỏ qua nếu chưa có.
- `global-setup.ts` đăng nhập khách bằng form ở context riêng và lưu `storageState` thứ hai
  (`storage-state-contributor.json`, cùng thư mục tạm 0700 của lượt chạy). Fixture `contributorPage` (trang) và
  `contributorApi` (REST) dùng phiên này; `run-e2e.sh` cũng quét `test-results` tìm mật khẩu khách.
- Ca S20 chạy nối tiếp trên cùng dữ liệu, tạo mục góp ý với dấu riêng mỗi lượt và để lại ở trạng thái cuối. Issue ca
  tạo ra được hủy cuối ca (`trackIssue`). PW-S20-7 gỡ rồi đặt lại dấu của chính tài khoản khách, nên ca khác phải
  chạy lại được ngay sau đó.

## Ảnh trang Hướng dẫn

Trang Hướng dẫn (`src/features/guide/`) hiện bản theo vai trò đăng nhập, mỗi mục có ảnh chụp thật từ T1. Ảnh chụp trên
company mẫu **2P Demo** (dữ liệu tiếng Việt sạch), không phải company e2e. Dựng dữ liệu và chụp lại toàn bộ (cả `vi` và
`en`, mọi vai trò) bằng một lệnh:

```sh
CREW_E2E_T1_ENV=~/crew-ga-t1/board.env CREW_GUIDE_POLICY_FILE=~/crew-ga-t1/crew-policy.json \
  pnpm --filter @crew/paperclip-web guide:shots
```

- Stack T1 phải đang chạy (server 3199, web 5183). Ảnh khung nhìn 1280×800, theme sáng, giờ Asia/Ho_Chi_Minh, lưu WebP
  thẳng vào `src/features/guide/img/<lang>/<id>[.<vai trò>].webp`. Danh sách ảnh ở `src/features/guide/shots.ts`; mỗi id
  có một cách chụp trong `RECIPES` của spec (ca đầu của spec kiểm hai danh sách khớp nhau). Chỉ chụp lại vài ảnh:
  thêm `CREW_GUIDE_SHOTS_ONLY=machines,inbox`.
- **Dựng company mẫu** (`support/guide-company.ts`, chạy đầu mỗi lượt, tìm theo tên trước khi tạo nên chạy lại không sinh
  bản trùng):
  - company "2P Demo", secret webhook, mục `companies` trong config plugin `crew.core` của company;
  - hai project "Website bán hàng" (2 executor) và "Ứng dụng giao hàng" (1 executor) có vai trò đủ và **Sẵn sàng**:
    agent Claude đúng cấu hình Crew (bản ghim Superpowers giả định `/Users/crew/.crew/workflows/superpowers/6.4.1`,
    heartbeat tắt và `wakeOnDemand: false` nên agent không bao giờ chạy), `AGENTS.md` theo `crew/agents/*.md`,
    environment SSH `in_place` trỏ checkout `/Users/crew/crew-agents/<khóa>/<ô>`;
  - một dòng cho company trong file chính sách Crew của server (`CREW_GUIDE_POLICY_FILE`, chính là file
    `CREW_POLICY_CONFIG` của server T1; server đọc lại mỗi lần gọi). Route góp ý và luật Crew chỉ chạy cho company có ở
    đây;
  - 11 yêu cầu gốc ở nhiều trạng thái, 6 yêu cầu con, vài bình luận (của owner: agent mẫu không có run nên không ghi
    được bình luận hay duyệt bước). Một yêu cầu chờ owner duyệt (policy chỉ có bước duyệt của owner), một yêu cầu nghiên
    cứu ở bước Reviewer;
  - góp ý Phòng Marketing: một yêu cầu và một bình luận chờ duyệt, một yêu cầu bị từ chối;
  - hai máy `mac-mini-van-phong` và `macbook-pro-giang` ghép bằng route ghép máy (environment `may-<máy>`), mỗi lượt xoay
    key máy và gửi bản tin ký bằng key đó, nên máy hiện **Trực tuyến**; máy đầu báo checkout của mọi agent và gửi ảnh
    chụp docs của project Website bán hàng.
- **Tài khoản theo vai trò** (`support/guide-users.ts`): owner là tài khoản board (tên hiển thị đặt thành "Nguyễn Quang");
  Admin/Vận hành `guide-operator@crew-e2e.local` ("Trần Minh"), Chỉ xem `guide-viewer@crew-e2e.local` ("Lê Lan"), Phòng
  Marketing là tài khoản khách góp ý có sẵn. Thành viên được thêm vào 2P Demo bằng đúng luồng của owner: lời mời có
  `humanRole` (Phòng Marketing có `defaultsPayload.crew.role`), đăng ký hoặc đăng nhập, nhận lời mời, duyệt yêu cầu tham
  gia, bật dấu Phòng Marketing. Lời mời không dùng được thì bị thu hồi. Mật khẩu hai tài khoản ảnh là
  `CREW_GUIDE_PASSWORD` trong `board.env` (quyền 600, chỉ T1). Spec tắt trace vì điền mật khẩu thật.
- Spec chỉ mở hộp thoại rồi đóng, không bấm nút xác nhận nào. Ảnh app Mac không chụp được từ T1: trang dùng sơ đồ
  `img/<lang>/mac-pairing.svg` có nhãn "không phải ảnh chụp app".
- `test/features/guide/guide-content.test.ts` kiểm mọi mục việc có ảnh với từng vai trò, file có thật và dưới 150 KB.

## Chế độ stub

T2 bật stub cho mọi project `e2e-*` trong `global-setup.ts` (5 giây) và tắt trong `global-teardown.ts`. Ca cần run
"đang chạy" đặt `stub.on(key, 300)` rồi tự hủy run cuối ca. Run stub lưu phiên `crew-e2e-stub`; trước T3 gọi
`resetAgentSessions` cho agent `e2e-*` để `claude` thật không `--resume` một phiên không có.

## Project nền `e2e-base`

T2 cần project `e2e-base` (folder `~/crew-e2e/repo`, 2 executor) dựng bằng wizard Thêm project. `global-setup.ts`
tìm setup run `add-project` khóa `e2e-base` đã `done` mà project chưa archive; không còn (chưa dựng hoặc đã gỡ) thì
dựng lại bằng wizard Thêm project (`addProjectViaWizard` trong `support/r3x-project.ts`).

Khóa đã gỡ thì không dựng lại được: environment `<khóa>-<vai trò>` đã archive vẫn giữ tên, mà tên environment là duy
nhất trong instance, nên wizard dừng ở bước `environments`. Sau khi gỡ project nền, lượt sau đặt `CREW_E2E_BASE_KEY`
sang khóa mới (ví dụ `e2e-base2`).

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

Đổi worktree fork (`FORK`) thì phải build plugin ở đó (`pnpm --filter @crew/paperclip-plugin build`) và trỏ
`plugins.package_path` của `crew.core` trong DB nhúng sang `$FORK/packages/crew-plugin`, rồi khởi động lại server để
plugin kích hoạt và áp migration mới (bảng góp ý có từ migration `0013`). Dùng thư mục T1 khác (`CREW_E2E_T1_ENV=<đường
tới board.env>`) để không đụng stack cũ.

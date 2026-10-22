# Deploy overlay lên VPS, auto-deploy và rollback

> Flow `ops-deploy`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow ops-deploy` in ra đúng danh sách đó.

## Mục đích

Server Crew chạy image Paperclip upstream cộng một lớp "overlay": chỉ các file nhánh Crew đổi so với bản upstream đã
ghim, plugin `crew.core` đã build và UI Crew đã build. Cách này giữ image gần bản gốc và để `upgrade.sh` (flow
`core-hooks`) nâng upstream mà không build lại cả repo. Flow này gồm:

- Đóng gói overlay trên Mac, build image trên VPS, kiểm image trước khi đổi.
- Đổi server sang image mới có sao lưu trước, kiểm sức khỏe sau, và rollback về compose cũ.
- Auto-deploy sau khi owner duyệt: integrator xếp commit vào hàng chờ trong run stage push, một job launchd trên Mac
  deploy khi server rảnh và comment kết quả lên issue.

Bản upstream đã ghim là trường `base` của `crew/release/core-hooks.json`. Host, thư mục trên VPS, nhánh và URL công khai
của auto-deploy nằm trong `crew/release/auto-deploy.json`; đường dẫn trên VPS nằm ở đầu các script trong `crew/ops/`.

Vì sao job deploy chạy dưới launchd chứ không trong run của integrator: deploy khởi động lại chính server đang điều
phối run đó. Job launchd có PPID 1, nhóm process và session riêng, cwd ngoài mọi worktree agent và env không có
`PAPERCLIP_*`, nên bộ dọn process mồ côi trên Mac và lệnh dừng run của server không bao giờ trúng nó.

## Điểm vào

- `crew/ops/overlay-source.sh [<commit>]` (Mac): gom file, build plugin và UI, upload tarball. `OVERLAY_NO_UPLOAD=1` chỉ
  đóng gói.
- `crew/ops/overlay-job.sh <short>` (VPS): build image overlay.
- `crew/ops/deploy.sh <image-tag>` (VPS): đổi image. `crew/ops/rollback.sh <TS>`: quay lại.
- `node crew/ops/auto-deploy.mjs enqueue --issue <uuid> --sha <sha> [--pr <url>]`: integrator gọi sau comment
  `crew-merge`; `worker` (chỉ launchd gọi); `status`.
- `crew/ops/auto-deploy-vps.sh <command>`: nửa phía VPS, Mac gửi qua SSH như file tạm, không cài.

## Các bước

1. `crew/ops/overlay-source.sh`: worktree phải đứng đúng commit yêu cầu và sạch. Chỉ file trong danh sách SHIP được
   đóng gói; `docs/flows.yaml`, trang flow và `.githooks/` không bao giờ vào image; `ui/` (UI gốc ở `/paperclip/`) do
   flow `stock-ui` build riêng. File adapter ngoài `claude-local` chỉ được đóng gói khi `core-hooks.json` khai là
   `adapter-patch`. Ghi manifest kiểm adapter (`inspect-adapters.mjs --write-manifest`).
2. `crew/ops/overlay-job.sh`: build image `crew-v3/paperclip:v3-<short>` trên image upstream; watchdog RAM dừng build
   khi máy còn ít bộ nhớ.
3. `crew/ops/inspect-image.sh` và `crew/ops/inspect-adapters.mjs`: kiểm image trước deploy: file adapter trong image
   khớp manifest và anchor của từng vá (`--in-image`, chỉ cần node trong image), plugin bundle import được bằng node
   thuần, không có file AppleDouble. Kiểm với commit trên host chỉ chạy được ở Mac.
4. `crew/ops/deploy.sh`: từ chối khi còn run đang chạy (mã 2), image không đạt (4), `issues.js` không có đúng ba lần
   `crewCoreHooks` (import, H2, H4), hoặc file `CREW_POLICY_CONFIG` thiếu/lỗi (7). Sao lưu DB (`backup.sh`, flow
   `ops-backup`), lưu compose và image cũ theo `TS`, đổi image bằng `compose-set-image.py` (5), khởi động lại server.
   Sau đó kiểm `/api/health` (3), container có và đọc được file policy, log khởi động không báo cổng Crew tắt (8),
   plugin `crew.core` healthy (6). Mọi lỗi sau khi đổi in lệnh `rollback.sh <TS>`.
5. `crew/ops/rollback.sh`: khôi phục compose đã lưu và tạo lại server, giữ mount file policy.
6. `crew/ops/compose-set-image.py`: chỉ đổi image của service `server` và đảm bảo `stop_grace_period: 60s`.
7. `crew/ops/auto-deploy.mjs` → `enqueue`: đọc `crew/release/auto-deploy.json` (`parseConfig`), xếp commit vào hàng chờ
   (`mergeQueue`, `addWaiting` cho pull request chưa merge), khởi động worker launchd (`plistFor`, `jobEnv`), in thân
   comment `crew-deploy sha=… status=queued` cho integrator đăng.
8. `crew/ops/auto-deploy.mjs` → `worker`, `workerLoop`: chờ pull request merge (`gh pr view`, mỗi `PR_POLL_MS`, tối đa
   `PR_MAX_WAIT_MS`), chạy cổng kiểm (chỉ đổi crew-web hay docs thì bỏ cổng server, `needsFullGates`), đóng gói, build,
   chờ khe rảnh, deploy, kiểm sau deploy (`postCheckFailures`), rồi báo trạng thái (`queued`, `deployed`, `failed`,
   `rolled_back`, `cancelled`) lên mọi issue được phủ. `redact` bỏ mọi dòng có thể chứa credential.
9. `crew/ops/auto-deploy-vps.sh`: các lệnh phía VPS (`active-runs`, `image`, `inspect`, `build`, `deploy-when-idle`,
   `deploy-status`, `rollback`, `plugin-state`, `claims`, `comments`, `comment`). Kiểm chặt từng tham số; comment báo
   kết quả đăng bằng API key của agent integrator (comment của board user trên issue đã đóng sẽ mở lại và đánh thức
   agent, comment của agent thì không).
10. `crew/ops/nginx-crew.conf`: cấu hình nginx HTTPS phía trước server.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `crew/ops/overlay-source.sh` | Đóng gói overlay trên Mac | danh sách SHIP |
| `crew/ops/overlay-job.sh` | Build image overlay trên VPS | (script) |
| `crew/ops/inspect-image.sh` | Kiểm image trước deploy | (script) |
| `crew/ops/inspect-adapters.mjs` | Kiểm vá adapter trong image | `--write-manifest`, `--in-image` |
| `crew/ops/deploy.sh` | Đổi image có sao lưu và kiểm sau | mã thoát 2–8 |
| `crew/ops/rollback.sh` | Quay về compose cũ | (script) |
| `crew/ops/compose-set-image.py` | Sửa image trong compose | (script) |
| `crew/ops/auto-deploy.mjs` | Hàng chờ và worker auto-deploy | `enqueue`, `worker`, `workerLoop`, `parseConfig`, `mergeQueue`, `needsFullGates`, `redact`, `commentBody` |
| `crew/ops/auto-deploy-vps.sh` | Nửa phía VPS của auto-deploy | các lệnh con |
| `crew/release/auto-deploy.json` | Cấu hình auto-deploy của repo | `enabled`, `repoKey`, `branch`, `maxWaitMinutes` |
| `crew/ops/nginx-crew.conf` | Nginx HTTPS | (cấu hình) |

## Dữ liệu

- Không có bảng riêng. `deploy.sh` đọc `/api/health` và trạng thái plugin; `auto-deploy-vps.sh` đọc run đang chạy và
  comment issue qua API của server.
- Comment trên issue: dòng đầu `crew-deploy sha=<sha> status=<trạng thái>` (máy đọc được).
- Gọi ngoài: SSH và `scp` tới VPS, `docker`/`docker compose` trên VPS, `gh pr view` trên Mac, `launchctl` trên Mac.
- File trạng thái worker nằm trong thư mục state theo `repoKey` (`stateDirFor`); nhãn launchd theo `labelFor`.

## Flow liên quan

- `core-hooks`: `base` upstream, danh sách vá adapter và `verify.sh`.
- `ops-backup`: `deploy.sh` gọi `backup.sh` trước khi đổi image.
- `ops-tools`: `policy-config.py`, `plugin-state.sh`, `active-runs.sh` được dùng trong deploy.
- `issue-gate`: comment `crew-merge` ở stage push là đầu vào của `enqueue`.
- `agent-roles`: template integrator dạy agent gọi `enqueue` và đăng comment.
- `stock-ui`: UI gốc build riêng, không vào overlay.

## Tests

- `crew/ops/overlay-source.test.mjs`: từ chối file ngoài vùng được đóng gói và file adapter không khai `adapter-patch`;
  chấp nhận UI gốc, manifest docs, trang flow và hook git (không bao giờ vào image).
- `crew/ops/inspect-adapters.test.mjs`: image khớp hay lệch commit, thiếu file, mất anchor; `--write-manifest`;
  `--in-image` chỉ cần node; `inspect-image.sh` báo lỗi và bỏ kiểm host khi không có repo.
- `crew/ops/compose-set-image.test.mjs`: chỉ đổi image của `server`, thêm `stop_grace_period` một lần, lỗi thì không đổi
  file.
- `crew/ops/auto-deploy.test.mjs`: cấu hình của repo hợp lệ; hàng chờ giữ commit mới nhất và mọi issue; pull request
  chờ; đọc `gh pr view`; bỏ cổng server khi chỉ đổi web/docs; `redact`; đọc log deploy; dòng đầu comment; job launchd
  tách khỏi run; worker đi hết vòng tới `deployed`.
- `crew/ops/auto-deploy-vps.test.mjs`: tham số sai hình dạng bị từ chối; `deploy-when-idle` chạy tách và sống sót khi
  nhóm process gọi bị giết, báo `BUSY`; rollback; comment không lộ key.

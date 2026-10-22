# Bản tin máy (machine-status) và ghép máy

> Flow `machine-status`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow machine-status` in ra đúng danh sách đó.

## Mục đích

Mỗi Mac chạy agent (`crew-mac` trong repo `crew`) gửi bản tin trạng thái có ký HMAC lên plugin `crew.core`: tải máy,
Claude, app 2P Crew, Superpowers, checkout repo, cache file đính kèm, runtime, app nhận việc. Plugin lưu bản tin mới
nhất và lịch sử 24 giờ; trang Máy của crew-web và widget "Máy" của UI stock vẽ thẻ từng máy. Máy coi là mất liên lạc khi
quá 3 phút không có bản tin.

Ghép máy tự động: app trên Mac lấy public key SSH của Paperclip (`machines.pair-info`), rồi `machines.pair` trả một key
riêng cho máy. Key máy là HMAC từ secret webhook của company và một nonce (`deriveMachineKey`), server không lưu key, chỉ
lưu nonce; ghép lại đổi nonce nên key cũ chết. Owner gỡ máy thì bản tin của máy đó bị từ chối (`machine_revoked`), và
máy đã gỡ chỉ được ghép lại khi owner cho phép (`allowRepair`). Máy ghép tay từ trước (không có dòng ghép) vẫn ký bằng
secret company.

## Điểm vào

- `POST /api/plugins/crew.core/webhooks/machine-status` (route webhook stock) → `handleMachineStatus`.
- Route plugin `GET /machines/pair-info`, `POST /machines/pair`, `POST /machines/:machineId/unpair` (board) →
  `handleMachinesApi`.
- Data key `crew.machines` → `loadCrewMachines`.
- crew-web: route `machines` (`packages/crew-web/src/features/machines/routes.tsx`) → `MachinesPage`. UI stock: mục
  "Máy" trên trang Crew và widget `MachinesWidget`.

## Các bước

1. `packages/crew-plugin/src/shared/webhook.ts` → `dispatchCrewWebhook`: worker chia webhook theo `endpointKey` tới
   handler đã đăng ký bằng `registerCrewWebhook`.
2. `packages/crew-plugin/src/shared/webhook.ts` → `authenticateCrewWebhook`: kiểm kích thước, header
   `x-crew-timestamp`/`x-crew-signature` (lệch quá 300 giây là `stale_signature`), chọn company từ body, lấy secret
   (`resolveCompanyWebhookSecret`), chọn secret ký theo dòng ghép máy, rồi `verifyCrewSignature`
   (`packages/crew-plugin/src/shared/signature.ts`). Body chỉ đến handler khi HMAC đúng và `version` là 1.
3. `packages/crew-plugin/src/machines/webhook.ts` → `parseMachineReport`: kiểm schema. Trường tùy chọn sai dạng bị bỏ
   riêng (crew-mac cũ hay mới hơn không mất cả bản tin); khóa lạ hay khóa bắt buộc sai thì từ chối.
4. `packages/crew-plugin/src/machines/webhook.ts` → `handleMachineStatus`: ghi `machine_reports`, upsert
   `machine_latest` (chỉ khi mới hơn), xóa lịch sử cũ hơn 24 giờ ngay trong lượt nhận.
5. `packages/crew-plugin/src/machines/pairing.ts` → `handleMachinesApi`: chặn actor không phải board; `pair` ghi
   `machine_pairings` với nonce mới và trả `machineKey` đúng một lần (không log). Từ chối ghép máy đang ký bằng secret
   company hoặc đã gỡ (`refusePair`). `unpair` đặt `revoked_at`; máy chưa ghép thì ghi một dòng đã gỡ sẵn.
6. `packages/crew-plugin/src/machines/data.ts` → `loadCrewMachines`: bản tin mới nhất, `online`, chuỗi tải 24 giờ
   (lấy mẫu thưa), thông tin ghép công khai. Nonce không bao giờ được chọn ra.
7. `packages/crew-web/src/features/machines/machines-page.tsx` → `MachinesPage`: thẻ máy (`MachineCard`), khối ghép
   (`PairingBlock`), công tắc runtime và hàng đợi việc; tự làm mới mỗi `MACHINE_REFRESH_MS` qua `useCrewMachines`.
8. `packages/crew-web/src/features/machines/pairing-block.tsx` → `PairingBlock`: owner gỡ máy. Máy đã ghép: đối chiếu
   environment với IP Tailscale đã ghép, archive environment bằng route lõi, rồi gọi `machines.unpair`. Máy chưa ghép:
   chỉ gọi `machines.unpair`.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `packages/crew-plugin/src/machines/webhook.ts` | Nhận và kiểm bản tin máy | `handleMachineStatus`, `parseMachineReport`, `MACHINE_REPORT_MAX_BYTES` |
| `packages/crew-plugin/src/machines/pairing.ts` | Route ghép/gỡ máy, key máy | `handleMachinesApi`, `deriveMachineKey`, `isTailscaleIp` |
| `packages/crew-plugin/src/machines/data.ts` | Data key `crew.machines` | `loadCrewMachines`, `registerMachinesFeature` |
| `packages/crew-plugin/src/shared/webhook.ts` | Khung webhook chung (máy, docs) | `authenticateCrewWebhook`, `dispatchCrewWebhook`, `CrewWebhookError` |
| `packages/crew-plugin/src/shared/signature.ts` | HMAC header Crew | `verifyCrewSignature` |
| `packages/crew-plugin/src/ui/machines/model.ts` | Dòng chữ thẻ máy | `machineCardModel`, `appLine` |
| `packages/crew-plugin/src/ui/machines/index.ts` | Mục Máy và widget trong UI stock | `MachinesSection`, `MachinesWidget` |
| `packages/crew-plugin/src/shared-web/machine-card.ts` | Export model thẻ máy cho crew-web | |
| `packages/crew-web/src/features/machines/routes.tsx` | Route `machines` | `routes` |
| `packages/crew-web/src/features/machines/index.ts` | Export feature | |
| `packages/crew-web/src/features/machines/machines-page.tsx` | Trang Máy | `MachinesPage` |
| `packages/crew-web/src/features/machines/pairing-block.tsx` | Nhãn ghép, nút Gỡ máy | `PairingBlock` |
| `packages/crew-web/src/features/machines/use-machines.ts` | Query máy, hàng đợi, công tắc | `useCrewMachines`, `useMachineJobs`, `MACHINE_REFRESH_MS` |
| `packages/crew-web/src/api/crew/machines.ts` | Client `machines.unpair` | `machinesApi` |
| `packages/crew-web/src/ds/widgets/crew/machine-card.tsx` | Thẻ máy | `MachineCard`, `OFFLINE_AFTER_MS` |

## Dữ liệu

- Bảng plugin: `machine_reports` (lịch sử, `0002_machines.sql`), `machine_latest` (`0003_machine_latest.sql`),
  `machine_pairings` (`0014_machine_pairings.sql`, `0015_machine_pairings_unpaired_removal.sql`).
- Cấu hình plugin theo company: `companies[].webhookSecretRef` (secret webhook), `paperclipSshPublicKey`.
- Mã lỗi webhook: `CrewWebhookErrorCode` trong `packages/crew-plugin/src/shared/webhook.ts`.
- Route lõi crew-web gọi khi gỡ máy: đọc và archive environment (`api.environments.get`, `api.environments.archive`).

## Flow liên quan

- `crew-plugin`: worker, manifest, cấu hình secret.
- `docs-snapshot`: dùng cùng `authenticateCrewWebhook`.
- `machine-jobs`: hàng đợi việc hiện trên cùng trang Máy.
- `runtime-switches`: công tắc runtime theo máy trên thẻ máy.
- `skills`: trang Skills đọc `useCrewMachines`.
- `jev`: route máy của Jev ký theo cùng luật key máy.
- `design-system`: `MachineCard` nằm trong `ds/widgets/crew`.

## Tests

- `packages/crew-plugin/src/__tests__/webhook.test.ts`: vector HMAC cố định, chặn chữ ký thiếu/sai/cũ và body quá lớn
  trước khi đọc secret, máy đã ghép ký bằng key máy, máy chưa ghép vẫn dùng secret company.
- `packages/crew-plugin/src/__tests__/machines.test.ts`: lưu bản tin hợp lệ, tính `online` và tải 24 giờ, bỏ riêng
  trường tùy chọn sai dạng.
- `packages/crew-plugin/src/__tests__/machine-pairing.db.test.ts`: manifest khai ba route, `pair-info` thiếu key trả
  409, agent bị 403, key trả đúng một lần không log, ghép lại đổi nonce, máy đã gỡ cần `allowRepair`.
- `packages/crew-plugin/src/ui/machines/card.test.ts`: giá trị dò chưa biết không bị coi là đăng xuất, dòng app.
- `packages/crew-web/test/ds/crew/machine-card.test.tsx`: ngưỡng mất liên lạc, các dòng trên thẻ, biểu đồ tải.
- `packages/crew-web/test/features/machines/machines-page.test.tsx`: thẻ máy tự làm mới, trạng thái trống, hàng đợi.
- `packages/crew-web/test/features/machines/pairing-block.test.tsx`: nhãn ghép, chỉ owner thấy nút Gỡ máy, xác nhận
  trước khi gỡ, lỗi hiện nguyên văn.

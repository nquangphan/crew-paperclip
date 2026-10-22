# Chi phí (usage) và dung lượng lưu trữ

> Flow `usage-storage`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow usage-storage` in ra đúng danh sách đó.

## Mục đích

Owner cần biết một yêu cầu tốn bao nhiêu token và tiền, và Crew đang chiếm bao nhiêu chỗ (docs, bản tin máy, cache file
đính kèm trên Mac). Flow này tính hai báo cáo chỉ đọc trong plugin `crew.core` và hiện chúng trong UI stock: panel chi
phí trên tab Crew của issue và mục "Dung lượng" trên trang Crew.

Luật chính:

- Usage chỉ đọc `heartbeat_runs` và `cost_events` của Paperclip, không ghi sổ riêng. Chủ của một run là issue trong
  `cost_events`, nếu không có thì `context_snapshot.issueId`.
- Số liệu thiếu không bao giờ thành 0: run không có số liệu là `thieu`, USD chưa có ước tính hiện "—", tổng thiếu một
  phần ghi rõ là cận dưới. USD là ước tính của Claude Code, không phải tiền bị trừ thật.
- Mỗi con số dung lượng ghi rõ cách đo: `logic` (byte người dùng thấy), `vat_ly` (sau khi bỏ trùng blob), hoặc
  `chua_do` kèm lý do. Docs của project đã xóa không được tính.
- Không bao giờ trộn company; issue bị ẩn không lộ trong tổng.

## Điểm vào

- Data key `crew.usage.issue` (`issueId`): chi phí trực tiếp và cả cây của một issue; dùng ở panel `usage` trên tab
  Crew của issue (UI stock).
- Data key `crew.usage.summary` (`projectId`, `days` 7/30/90): tổng theo cửa sổ ngày giờ Việt Nam, run không gán được,
  các yêu cầu gốc tốn nhất. Chưa có màn hình nào trong repo gọi key này.
- Data key `crew.storage`: báo cáo dung lượng của company; mục "Dung lượng" trên trang Crew (UI stock).

## Các bước

1. `packages/crew-plugin/src/usage/data.ts` → `fetchIssueRuns`, `ownerOf`, `toRaw`: lấy run của một tập issue bằng
   một truy vấn và xác định chủ thật của từng run.
2. `packages/crew-plugin/src/usage/rollup.ts` → `toUsageRun`, `sumRuns`, `mergeModels`: tính usage một run (token và
   cent từ `cost_events`, USD ước tính từ `usage_json`/`result_json.modelUsage`), mức đầy đủ (`Completeness`), cộng
   nhiều run, gộp theo model. Thuần, không đọc DB.
3. `packages/crew-plugin/src/usage/data.ts` → `loadIssueUsage`: chia chi phí trực tiếp và cả cây, không đếm trùng; theo
   vai trò Crew của agent.
4. `packages/crew-plugin/src/usage/data.ts` → `loadUsageSummary`: cửa sổ ngày theo `vnWindowStart`.
5. `packages/crew-plugin/src/storage/data.ts` → `loadStorageReport`: docs theo project (logic và vật lý), cache file
   đính kèm của từng máy (từ bản tin máy), cỡ bảng plugin hoặc lý do chưa đo.
6. `packages/crew-plugin/src/ui/usage/index.ts` → `UsagePanel` và `packages/crew-plugin/src/ui/storage/index.ts` →
   `StorageSection`: hiện báo cáo, định dạng ở `format.ts` tương ứng.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `packages/crew-plugin/src/usage/data.ts` | Truy vấn usage, data key | `loadIssueUsage`, `loadUsageSummary`, `registerUsageData` |
| `packages/crew-plugin/src/usage/rollup.ts` | Phép tính usage thuần | `toUsageRun`, `sumRuns`, `USAGE_NOTES`, `Completeness` |
| `packages/crew-plugin/src/storage/data.ts` | Báo cáo dung lượng | `loadStorageReport`, `registerStorageData`, `Measured` |
| `packages/crew-plugin/src/ui/usage/index.ts` | Panel chi phí trên issue | `UsagePanel` |
| `packages/crew-plugin/src/ui/usage/format.ts` | Định dạng token, USD, nhãn | `formatUsd`, `formatUsdTotal`, `COMPLETENESS_LABEL` |
| `packages/crew-plugin/src/ui/storage/index.ts` | Mục Dung lượng | `StorageSection` |
| `packages/crew-plugin/src/ui/storage/format.ts` | Định dạng byte và cách đo | `formatBytes`, `formatMeasured`, `formatCacheUsage` |

## Dữ liệu

- Bảng lõi đọc: `heartbeat_runs` (`usage_json`, `result_json`, `context_snapshot`), `cost_events`, `issues`,
  `projects`, `agents`.
- Bảng plugin đọc: `crew_project_roles` (vai trò của agent); các bảng docs (`docs_snapshots`, `docs_snapshot_pages`,
  `docs_blobs`...) và `machine_latest` (khối `attachmentCache` của bản tin máy) cho báo cáo dung lượng.
- Không ghi bảng nào.

## Flow liên quan

- `docs-snapshot`: bảng docs được đo.
- `machine-status`: bản tin máy mang cỡ cache file đính kèm.
- `roadmap-map`: tiền run trên thẻ bản đồ đọc cùng nguồn (`crew.runs`).
- `crew-plugin`: trang Crew và tab issue chứa các mục này.

## Tests

- `packages/crew-plugin/src/__tests__/usage-rollup.test.ts`: lấy token từ `cost_events` và USD ước tính, mức đầy đủ,
  run bị ngắt tính là đã xong, bỏ ước tính âm hay NaN, tổng không biến null thành 0.
- `packages/crew-plugin/src/__tests__/usage.db.test.ts`: chia trực tiếp và cả cây không đếm trùng, không lộ sang company
  khác hay issue ẩn, tổng theo project và cửa sổ.
- `packages/crew-plugin/src/__tests__/storage.db.test.ts`: đo từng project và company không đếm trùng blob, bỏ docs của
  project đã xóa, cache theo máy, cỡ bảng hoặc lý do chưa đo, không trộn company.
- `packages/crew-plugin/src/ui/usage/format.test.ts`, `packages/crew-plugin/src/ui/storage/format.test.ts`: định dạng và
  nhãn cận dưới, số chưa đo không hiện 0.

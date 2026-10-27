# Plugin crew.core: worker, manifest, bảng plugin, cầu nối với server

> Flow `crew-plugin`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow crew-plugin` in ra đúng danh sách đó.

## Mục đích

Phần lớn tính năng Crew chạy trong plugin `crew.core` của Paperclip (package `packages/crew-plugin`) thay vì vá lõi:
plugin có namespace DB riêng, có webhook, route API, data key, job định kỳ và slot UI riêng, nên khi kéo upstream chỉ
còn vài điểm vá nhỏ ở server. Flow này giữ phần khung: manifest khai báo quyền và điểm vào, worker chia việc cho từng
tính năng, chuỗi migration tạo mọi bảng plugin, các helper dùng chung, và ba cầu nối phía server để lõi đọc được bảng
plugin và để UI Crew dùng được với viewer và ngay sau khi khởi động lại.

Luật chính:

- Worker không giữ cấu hình toàn cục: mọi lần đọc đều theo company (`multiCompanyConfig: true`). Một company là
  "company Crew" khi cấu hình plugin của chính nó có mục `companies` (secret webhook theo company).
- Job và data call không có company không được gọi `companies.list` bừa: host từ chối (-32005,
  `INVOCATION_SCOPE_DENIED`) khi còn invocation của sự kiện. Job chỉ quét danh sách company Crew đã lưu.
- Mọi tính năng chỉ ghi vào bảng plugin; server lõi đọc bảng plugin qua `to_regclass` để chạy được cả khi plugin chưa
  áp migration.

## Điểm vào

- `packages/crew-plugin/src/manifest.ts`: manifest `crew.core` (capabilities, `instanceConfigSchema`, `jobs`,
  `webhooks`, `apiRoutes`, `database.coreReadTables`, slot UI). Host đọc nó khi cài plugin.
- `packages/crew-plugin/src/worker.ts`: worker do host chạy (`runWorker`). `setup` đăng ký handler sự kiện, data key,
  job; `onWebhook` và `onApiRequest` chia theo `endpointKey`/`routeKey`.
- UI plugin: `packages/crew-plugin/src/ui/index.tsx` xuất các component mà slot trong manifest trỏ tới (`CrewPage` ở
  route `crew`, tab và tóm tắt `crew-issue` trên issue, widget `MachinesWidget`, trang `huong-dan`).
- Server: mọi request `/api/plugins/...` qua `crewPluginStartupWait`; `POST /plugins/:pluginId/data/:key` qua
  `crewViewerPluginDataScope`; gate issue gọi `loadCrewRoles`.

## Các bước

1. `packages/crew-plugin/src/worker.ts` → `setup`: lưu `ctx` (vì `onApiRequest` không nhận context), gọi
   `registerRunCancelledHandler`, `registerFeatures`, `registerAttachmentsAudit`, `registerRuntimeDecisions`,
   `registerRuntimeFallback`.
2. `packages/crew-plugin/src/features.ts` → `registerFeatures`: đăng ký data key và handler của từng tính năng (map,
   roots, runs, docs, máy, job máy, wizard, skill sync, companies, dung lượng, chi phí, security guard).
3. `packages/crew-plugin/src/worker.ts` → `onApiRequest`: chia theo tiền tố `routeKey` (`jobs.`, `roles.`, `setup.`,
   `issues.`, `runtimes.`, `machines.`), còn lại là route docs; không khớp trả 404.
4. `packages/crew-plugin/src/companies/data.ts` → `allCrewCompanies`, `storedVerifiedCrewCompanies`,
   `registerCompaniesData`: tìm company Crew (kiểm từng company theo cấu hình của chính nó), đồng bộ bảng
   `crew_companies`, dùng danh sách đã lưu khi host từ chối (`isScopeDenied`). Data key `crew.companies`.
5. `packages/crew-plugin/src/shared/db.ts` → `pluginNamespace`, `checkedId`, `uuidArray`: kiểm namespace và uuid trước
   khi ghép vào SQL.
6. `packages/crew-plugin/src/ui/page.tsx` → `CrewPage`: trang Crew trong UI stock, mục "Yêu cầu" (data `crew.roots`)
   rồi các mục đăng ký qua `registerPageSection` (`packages/crew-plugin/src/ui/registry.ts`).
7. `packages/crew-plugin/src/ui/tab.tsx` → `CrewIssueTab` và `packages/crew-plugin/src/ui/summary.tsx` →
   `CrewIssueSummary`: tab Crew và dòng tóm tắt trên issue (map và kết quả docs-check), panel con qua
   `registerIssuePanel`.
8. `server/src/crew/plugin-startup-wait.ts` → `crewPluginStartupWait`: giữ request `/plugins/...` tới khi lượt nạp
   plugin lúc khởi động xong (tối đa `CREW_PLUGIN_STARTUP_WAIT_MS`), tránh 502/503 trong vài giây đầu sau deploy. Gắn
   trong `server/src/crew/contribution-routes.ts` (router mount trước route plugin stock).
9. `server/src/crew/plugin-data-scope.ts` → `crewViewerPluginDataScope`: cho viewer của company Crew đọc các data key
   trong `CREW_VIEWER_DATA_KEYS`; mọi trường hợp khác trả `undefined` để route stock kiểm như cũ (đóng khi lỗi).

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `packages/crew-plugin/src/manifest.ts` | Manifest plugin | `manifest` |
| `packages/crew-plugin/src/worker.ts` | Worker, chia webhook và route API | `plugin`, `onApiRequest` |
| `packages/crew-plugin/src/features.ts` | Đăng ký data key của các tính năng | `registerFeatures` |
| `packages/crew-plugin/src/companies/data.ts` | Danh sách company Crew | `allCrewCompanies`, `storedVerifiedCrewCompanies`, `isScopeDenied` |
| `packages/crew-plugin/src/shared/db.ts` | Helper SQL an toàn | `pluginNamespace`, `checkedId`, `uuidArray`, `jsonObject` |
| `packages/crew-plugin/src/shared/markers.ts` | Đọc marker Crew trong mô tả và comment | `parseCrewBundle`, `parseCrewDocsCheck`, `isCrewResearch` |
| `packages/crew-plugin/src/shared/policy.ts` | Đọc policy Crew của issue | `crewPolicyKind`, `docsStageAgents` |
| `packages/crew-plugin/src/shared/css.d.ts` | Khai báo kiểu cho import CSS | |
| `packages/crew-plugin/src/ui/index.tsx` | Export cho slot UI | |
| `packages/crew-plugin/src/ui/registry.ts` | Đăng ký mục trang Crew và panel issue | `registerPageSection`, `registerIssuePanel` |
| `packages/crew-plugin/src/ui/page.tsx` | Trang Crew | `CrewPage` |
| `packages/crew-plugin/src/ui/tab.tsx` | Tab Crew trên issue | `CrewIssueTab` |
| `packages/crew-plugin/src/ui/summary.tsx` | Tóm tắt Crew trên issue | `CrewIssueSummary`, `crewSummaryLine` |
| `packages/crew-plugin/migrations/` | Chuỗi migration bảng plugin (`0001_docs.sql` … `0022_multi_machine.sql`) | |
| `server/src/crew/plugin-startup-wait.ts` | Chờ plugin nạp xong lúc khởi động | `crewPluginStartupWait` |
| `server/src/crew/plugin-data-scope.ts` | Viewer đọc data `crew.core` | `crewViewerPluginDataScope`, `CREW_VIEWER_DATA_KEYS` |

File upstream có vá (mục `shared`, mô tả ở `crew/release/core-hooks.json`): `server/src/app.ts` (mount router Crew; C15 gắn parser JSON 16 MB cho webhook `docs-snapshot`, flow `docs-snapshot`),
`server/src/routes/plugins.ts` (gọi `crewViewerPluginDataScope`), `server/src/services/plugin-worker-manager.ts` (giao
sự kiện plugin dạng call để xóa invocation scope khi handler xong).

## Dữ liệu

- Bảng plugin (namespace `plugin_crew_core_*`, tạo bởi `packages/crew-plugin/migrations/`). Mỗi tính năng sở hữu bảng
  của mình, xem flow tương ứng:
  - docs: `docs_snapshots`, `docs_current`, `docs_pages`, `docs_links` (`0001`), `docs_blobs`, `docs_commits`,
    `docs_commit_files`, `docs_snapshot_pages` (`0008`);
  - máy: `machine_reports` (`0002`), `machine_latest` (`0003`), `machine_pairings` (`0014`, `0015`);
  - `crew_project_roles` (`0004`, thêm cột ô runtime ở `0012`);
  - `crew_attachment_audit` (`0005`);
  - `crew_machine_jobs` (`0006`, `0011`, `0012`), `crew_setup_runs` (`0007`, `0009`, `0011`);
  - `crew_companies` (`0010`);
  - runtime: `crew_runtime_switches`, `crew_runtime_decisions`, `crew_runtime_waits` (`0012`), `crew_runtime_retries`
    (`0017`);
  - góp ý và QC: `crew_contributors`, `crew_contributions` (`0013`, `0018`, `0019`), `crew_qc_rounds` (`0019`);
  - `crew_project_access` (`0016`);
  - `0020`, `0021`: bảng `crew_jev_*` của tính năng Jev đã gỡ; không code nào đọc/ghi. Giữ hai file vì đã áp trên prod
    (runner đối chiếu checksum) và runner plugin cấm migration `DROP`; bảng trên prod xóa tay.
  - `0022_multi_machine.sql`: `project_machines` (trạng thái dựng project trên từng máy), `project_repos` (origin, nhánh,
    repo đi kèm của project), `issue_machine_pins` (máy ghim theo issue gốc) và kind `ensure-project`. Server Crew ghi ba
    bảng này (flow `multi-machine`).
- Bảng lõi plugin được đọc: `database.coreReadTables` trong manifest.
- Cấu hình instance: `companies[].webhookSecretRef`, `paperclipSshPublicKey`, `opencodeInPlacePatch`.
- Job định kỳ: `attachments-audit`, `runtime-fallback` (mỗi phút). Webhook: `machine-status`, `docs-snapshot`.
- Route API plugin: khai trong `apiRoutes` của manifest, mỗi tiền tố thuộc một flow (bên dưới).

## Flow liên quan

- `core-hooks`: cách các vá lõi trong mục `shared` được giữ khi kéo upstream.
- `project-roles`: bảng `crew_project_roles` và `loadCrewRoles` phía server; `server/src/crew/project-roles.ts` cũng
  giữ `CREW_PLUGIN_KEY` và `rowsOf` mà các module server Crew khác dùng để đọc bảng plugin.
- `machine-status`, `docs-snapshot`, `machine-jobs`, `setup-wizards`, `usage-storage`, `attachments`, `skills`,
  `roadmap-map`, `runtime-switches`, `runtime-fallback`, `contributions`, `qc-department`, `project-access`:
  các tính năng worker đăng ký.
- `guide`: trang `huong-dan` của plugin.
- `web-shell`: crew-web gọi data key và route API của plugin.

## Tests

- `packages/crew-plugin/src/__tests__/worker-definition.test.ts`, `server/src/__tests__/crew-plugin-manifest.test.ts`:
  worker khai `multiCompanyConfig`, manifest hợp lệ theo schema của host, bundle `dist` tự đủ.
- `packages/crew-plugin/src/__tests__/companies.test.ts`, `companies.db.test.ts`: chỉ trả company có cấu hình Crew của
  chính nó, đồng bộ danh sách đã lưu, dùng danh sách lưu khi host từ chối, job chỉ quét company đã lưu.
- `packages/crew-plugin/src/__tests__/migration-0012.db.test.ts` … `migration-0019.db.test.ts`: migration chạy trên DB
  đã có dữ liệu, giữ dữ liệu cũ và thêm đúng ràng buộc.
- `packages/crew-plugin/src/__tests__/registry.test.ts`, `packages/crew-plugin/src/ui/page-headings.test.ts`: thứ tự mục
  và panel, mỗi mục trang Crew chỉ một tiêu đề.
- `packages/crew-plugin/src/__tests__/shared-exports.test.ts`: subpath `./shared/*` cho crew-web trỏ vào
  `src/shared-web`, không kéo React.
- `packages/crew-plugin/src/__tests__/ui-bundle.test.ts`: bundle UI nạp được qua shim của host.
- `packages/crew-plugin/src/ui/summary.test.ts`: tóm tắt Crew trên issue.
- `server/src/__tests__/crew-plugin-data-viewer.test.ts`: viewer chỉ đọc được các data key cho phép, đúng company,
  membership xác nhận từ DB; cấu hình hỏng thì 403.
- `server/src/__tests__/crew-plugin-event-invocation-scope.test.ts`: sau khi handler sự kiện xong, call không scope
  chạy lại được ngay.
- `server/src/__tests__/crew-plugin-startup-wait.test.ts`: request plugin lúc khởi động chờ worker; quá hạn hoặc không
  có promise thì đi tiếp.
- `server/src/__tests__/crew-viewer-write-matrix.test.ts`: viewer bị 403 ở các route ghi và dữ liệu không đổi; operator
  ghi được qua cùng route.

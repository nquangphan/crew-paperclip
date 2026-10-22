# Skill của company và đồng bộ skill xuống máy

> Flow `skills`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow skills` in ra đúng danh sách đó.

## Mục đích

Owner quản lý skill của company trên crew-web: thêm từ repo GitHub, xem và sửa nội dung, bật tắt cho agent, cập nhật
từ nguồn, tạo bản sửa được, xóa. Skill lưu ở Paperclip (route stock), còn bản chép trên từng Mac do app 2P Crew làm qua
việc `skill-sync` và `skill-remove` của hàng đợi machine jobs. Trang cho thấy máy nào đang giữ bản nào (theo sha256).

Luật chính:

- Skill company không được trùng tên skill Superpowers đã ghim trên máy (agent nạp Superpowers bằng `--plugin-dir`, nên
  tên trùng sẽ che hoặc bị che). Danh sách lấy từ bản tin của mọi máy; chưa có dữ liệu thì cảnh báo nhưng vẫn cho thêm.
  Đổi `name:` trong SKILL.md thành tên trùng cũng bị chặn.
- Không đổi slug: slug là khóa trong `desiredSkills` của agent và tên thư mục trên máy.
- Thêm, lưu nội dung hay cập nhật skill thì xếp một việc `skill-sync` cho mỗi máy có app nhận việc; máy chưa có app thì
  báo chờ.
- Xóa skill chạy trong trình duyệt bằng phiên owner theo thứ tự cố định (gỡ khỏi agent, bỏ chọn ở nguồn, DELETE, xếp
  `skill-remove` cho máy có bản chép); lỗi giữa chừng thì "Chạy tiếp" bỏ qua bước đã xong.
- Lưu nội dung bị 409 thì báo có người vừa sửa, không ghi đè.
- Skill ghim của Superpowers chỉ hiện để đọc; web không sửa hay xóa được.

## Điểm vào

- crew-web route `skills` và `skills/:skillId` (`packages/crew-web/src/features/skills/routes.tsx`) → `SkillsPage`,
  `SkillDetail`.
- Data key `crew.skillSync` → `loadSkillSync`.

## Các bước

1. `packages/crew-web/src/features/skills/skills-page.tsx` → `SkillsPage`: danh sách skill, số agent dùng, số máy đã
   đồng bộ; bản chép của skill đã xóa còn trên máy (`LeftoverCopies`) và skill ghim (`PinnedSkills`).
2. `packages/crew-web/src/features/skills/add-skill-dialog.tsx` → `AddSkillDialog`: quét repo, xem trước, chọn skill,
   tạo nguồn, kiểm tên (`superpowersNameClash` trong `name-guard.ts`), rồi xếp `skill-sync`.
3. `packages/crew-web/src/features/skills/skill-detail.tsx` → `SkillDetail`: SKILL.md, trạng thái đồng bộ theo máy,
   bật tắt cho agent (POST `skills/sync` của agent), sửa thông tin (`EditSkillInfoDialog`), sửa file
   (`SkillFilesEditor`, kiểm `skillMarkdownClash`), thao tác cho skill chỉ đọc (`ReadOnlySkillActions`,
   `ForkSkillDialog`), xóa.
4. `packages/crew-web/src/features/skills/use-skill-sync.ts` → `queueSkillSync`, `useSkillSyncStates`: xếp việc và đọc
   trạng thái.
5. `packages/crew-plugin/src/skills/sync-data.ts` → `loadSkillSync`: với mỗi cặp skill/máy lấy việc `skill-sync` hoặc
   `skill-remove` mới nhất và sha256 của lần sync xong gần nhất; cặp có `skill-remove` xong thì bỏ.
6. `packages/crew-web/src/features/skills/sync-status.tsx` → `SyncStatus`: "đã có trên máy, hash", đang chờ, lỗi đã làm
   sạch kèm Thử lại (`jobs.retry`), nút Đồng bộ cho máy chưa có.
7. `packages/crew-web/src/features/skills/delete-skill.ts` → `runDeleteSkill` và `delete-skill-dialog.tsx` →
   `DeleteSkillDialog`: xác nhận gõ đúng slug, chạy các bước xóa và ghi tiến độ.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `packages/crew-plugin/src/skills/sync-data.ts` | Data key trạng thái đồng bộ | `loadSkillSync`, `registerSkillSyncData`, `SkillSyncState` |
| `packages/crew-web/src/features/skills/routes.tsx`, `index.ts` | Route `skills` | `routes` |
| `packages/crew-web/src/features/skills/skills-page.tsx` | Danh sách skill | `SkillsPage` |
| `packages/crew-web/src/features/skills/skill-detail.tsx` | Chi tiết skill | `SkillDetail` |
| `packages/crew-web/src/features/skills/add-skill-dialog.tsx` | Thêm từ GitHub | `AddSkillDialog` |
| `packages/crew-web/src/features/skills/edit-skill.tsx` | Sửa thông tin | `EditSkillInfoDialog` |
| `packages/crew-web/src/features/skills/skill-files-editor.tsx` | Sửa file của skill sửa được | `SkillFilesEditor` |
| `packages/crew-web/src/features/skills/update-from-source.tsx` | Cập nhật, đổi nguồn skill chỉ đọc | `ReadOnlySkillActions` |
| `packages/crew-web/src/features/skills/fork-skill-dialog.tsx` | Tạo bản sửa được | `ForkSkillDialog` |
| `packages/crew-web/src/features/skills/delete-skill.ts` | Các bước xóa skill | `runDeleteSkill`, `newDeleteProgress` |
| `packages/crew-web/src/features/skills/delete-skill-dialog.tsx` | Hộp xóa và tiến độ | `DeleteSkillDialog`, `useDeleteSkill`, `DeleteSkillStatus` |
| `packages/crew-web/src/features/skills/name-guard.ts` | Chặn tên trùng Superpowers | `superpowersNameClash`, `hasSuperpowersData` |
| `packages/crew-web/src/features/skills/frontmatter.ts` | Đọc `name:` của SKILL.md | `frontmatterName`, `skillMarkdownClash` |
| `packages/crew-web/src/features/skills/sync-status.tsx` | Trạng thái đồng bộ theo máy | `SyncStatus`, `LeftoverCopies` |
| `packages/crew-web/src/features/skills/use-skill-sync.ts` | Xếp việc và đọc trạng thái | `queueSkillSync`, `useSkillSyncStates`, `hasJobsAgent` |
| `packages/crew-web/src/features/skills/pinned-skills.tsx` | Skill ghim chỉ đọc | `PinnedSkills` |

## Dữ liệu

- Bảng plugin đọc: `crew_machine_jobs` (việc `skill-sync`, `skill-remove`).
- Route lõi Paperclip: skill company (danh sách, chi tiết, tạo nguồn, quét, xem trước, PATCH, file, DELETE), nguồn skill,
  `skills/sync` của agent.
- Bản tin máy: khối `superpowers` (danh sách skill ghim), `jobsAgent`.
- Trên Mac, app xóa bản chép ở `~/.crew/skills/<companyId>/<slug>` khi nhận `skill-remove`.

## Flow liên quan

- `machine-jobs`: hàng đợi việc `skill-sync` và `skill-remove`.
- `machine-status`: bản tin máy cho danh sách Superpowers và app nhận việc (`useCrewMachines`).
- `web-shell`: shell và phiên owner.

## Tests

- `packages/crew-plugin/src/__tests__/skill-sync.db.test.ts`: việc mới nhất theo cặp skill/máy, giữ sha256 của lần xong
  trước, lỗi đã làm sạch, bỏ cặp khi `skill-remove` xong, tách theo company.
- `packages/crew-web/test/features/skills/add-skill-dialog.test.tsx`: tạo rồi xếp việc cho máy có app, chặn tên trùng,
  cảnh báo khi chưa có dữ liệu Superpowers, lỗi nguyên văn.
- `packages/crew-web/test/features/skills/delete-skill.test.ts`: thứ tự bước xóa, xử lý 404, 409 và 422.
- `packages/crew-web/test/features/skills/name-guard.test.ts`, `frontmatter.test.ts`: phát hiện tên trùng.
- `packages/crew-web/test/features/skills/skill-edit.test.tsx`: sửa thông tin và file, chặn đổi tên trùng, 409 không ghi
  đè.
- `packages/crew-web/test/features/skills/skills-page.test.tsx`, `sync-status.test.tsx`: danh sách, bật tắt cho agent,
  trạng thái đồng bộ và Thử lại.

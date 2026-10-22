# Trang Hướng dẫn

> Flow `guide`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow guide` in ra đúng danh sách đó.

## Mục đích

Người dùng Crew (owner, admin/operator, viewer, Phòng Marketing và Phòng QC) cần một trang giải thích cách dùng đúng
với quyền của mình, kèm ảnh chụp màn hình thật và danh sách tính năng Paperclip gốc không có trong Crew (và vì sao). Có
hai bản: trang `guide` của crew-web (chính, theo vai trò và ngôn ngữ) và trang `huong-dan` của plugin trong UI stock.

Luật chính:

- Mỗi vai trò chỉ thấy phần của mình (`GUIDE_ROLES`). Admin và operator dùng chung bản việc hằng ngày; Phòng Marketing
  và Phòng QC dùng chung bản người góp ý. Lỗi tải vai trò thì hiện bản việc hằng ngày (server vẫn là cổng thật). Chỉ
  owner xem thử bản của vai trò khác bằng `?role=`.
- Nội dung là markdown có cú pháp riêng (`{#id roles=...}`, `{{shot:<id>}}`, `{{diagram:<id>}}`, `{{missing}}`,
  `{{roles:...}}`); cú pháp sai thì báo lỗi thay vì hiện sai.
- Ảnh là ảnh chụp thật theo ngôn ngữ và vai trò; sơ đồ vẽ tay có nhãn "không phải ảnh chụp". Thiếu file thì hiện khung
  chỗ, không có thẻ `img` hỏng.
- Bảng "Vì sao không có nút X" (`MISSING_FEATURES`) phải bỏ dòng khi tính năng đã được làm; test chặn câu chữ còn khẳng
  định thiếu.

## Điểm vào

- crew-web route `guide` (`packages/crew-web/src/features/guide/routes.tsx`) → `GuidePage`.
- Plugin: slot page `crew-guide` (route `huong-dan`) → `CrewGuidePage`; slot sidebar `CrewGuideSidebarLink`,
  `CrewSidebarLink`.

## Các bước

1. `packages/crew-web/src/features/guide/guide-page.tsx` → `GuidePage`: chọn file nội dung theo ngôn ngữ, chọn vai trò
   (`guideRoleFor`, `previewRole`), dựng mục lục theo nhóm có neo `#id`.
2. `packages/crew-web/src/features/guide/guide-parse.ts` → `parseGuide`, `filterGuide`: tách nhóm (`##`), mục (`###`)
   và khối đặc biệt, lọc theo vai trò; `prefixInternalLinks` gắn tiền tố company cho link nội bộ.
3. `packages/crew-web/src/features/guide/guide-shot.tsx` → `GuideShot`: chọn file ảnh qua `shotUrl` và `shotFiles`
   (`shots.ts`, danh sách `GUIDE_SHOTS`).
4. `packages/crew-web/src/features/guide/missing-features-section.tsx` → `MissingFeaturesSection`: dựng bảng từ
   `MISSING_FEATURES` (`missing-features.ts`), chữ ở locale `guide`.
5. `packages/crew-plugin/src/ui/guide/index.tsx` → `CrewGuidePage`: hiện `huong-dan.md` với mục lục `guideHeadings`;
   ảnh trỏ về đường tĩnh của plugin (`guideBaseFrom`, `resolveGuideImages`) vì bundle UI nạp từ blob URL.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `packages/crew-web/src/features/guide/routes.tsx`, `index.ts` | Route `guide`, export | `routes`, `MISSING_FEATURES` |
| `packages/crew-web/src/features/guide/guide-page.tsx` | Trang Hướng dẫn | `GuidePage` |
| `packages/crew-web/src/features/guide/guide-parse.ts` | Tách và lọc nội dung | `parseGuide`, `filterGuide`, `prefixInternalLinks` |
| `packages/crew-web/src/features/guide/guide-roles.ts` | Vai trò người đọc | `GUIDE_ROLES`, `guideRoleFor`, `previewRole` |
| `packages/crew-web/src/features/guide/guide-shot.tsx` | Một hình | `GuideShot`, `shotUrl` |
| `packages/crew-web/src/features/guide/shots.ts` | Danh sách hình | `GUIDE_SHOTS`, `shotFiles` |
| `packages/crew-web/src/features/guide/missing-features.ts` | Tính năng không có trong Crew | `MISSING_FEATURES`, `MISSING_REASONS` |
| `packages/crew-web/src/features/guide/missing-features-section.tsx` | Bảng tính năng không có | `MissingFeaturesSection` |
| `packages/crew-plugin/src/ui/guide/index.tsx` | Trang và link sidebar của plugin | `CrewGuidePage`, `CrewGuideSidebarLink`, `guideHeadings` |
| `packages/crew-plugin/src/ui/guide/guide.d.ts` | Khai báo kiểu cho import `.md` | |

## Dữ liệu

- Nội dung crew-web: `packages/crew-web/src/features/guide/content/huong-dan.vi.md`, `guide.en.md`; ảnh ở
  `packages/crew-web/src/features/guide/img/<lang>/`, chụp bằng `packages/crew-web/e2e/specs/guide-shots.spec.ts`
  (script `guide:shots` trong `packages/crew-web/package.json`).
- Nội dung plugin: `packages/crew-plugin/src/ui/guide/huong-dan.md` và ảnh trong `packages/crew-plugin/src/ui/guide/img/`.
- Không đọc hay ghi DB ngoài vai trò người dùng (qua quyền company của shell).

## Flow liên quan

- `web-shell`: quyền và vai trò của người đang đăng nhập, ngôn ngữ.
- `contributions`, `qc-department`: vai trò người góp ý mà bản hướng dẫn riêng phục vụ.
- `crew-plugin`: slot page và sidebar của plugin.

## Tests

- `packages/crew-web/test/features/guide/guide-content.test.ts`: cú pháp nội dung, bỏ qua khối code, báo lỗi cú pháp,
  lọc theo vai trò.
- `packages/crew-web/test/features/guide/guide-page.test.tsx`: phần hiện cho từng vai trò, mọi mục có ảnh thật, owner
  xem thử bằng `?role=`, đổi sang tiếng Anh.
- `packages/crew-web/test/features/guide/guide-roles.test.ts`: chọn bản theo vai trò, khi đang tải hay lỗi.
- `packages/crew-web/test/features/guide/missing-features.test.ts`: bảng tính năng không có đủ dòng, đủ chữ hai ngôn
  ngữ, không còn khẳng định thiếu tính năng đã làm.
- `packages/crew-plugin/src/ui/guide/guide.test.ts`: mục lục, link sidebar, đường ảnh, mọi ảnh tham chiếu đều có và có
  trong bản build.

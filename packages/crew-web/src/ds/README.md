# Design system `@/ds`

Bản đầu dùng token và component của Paperclip `v2026.1005.0`, chép vào package này (không import `ui/src/**`).
Câu hỏi thiết kế 8 của spec tạm theo khuyên; đổi giao diện sau chỉ sửa `tokens.css` và `components/`.

## Cấu trúc

- `tokens.css`: biến màu, bán kính, chuyển động; theme sáng (`:root`) và tối (`.dark`). Chép từ `ui/src/index.css` và `ui/src/motion-tokens.css`, bỏ selector riêng của trang stock.
- `components/`: 23 component chép từ `ui/src/components/ui/*` (dòng 1 ghi nguồn) và component tự dựng (`table`, `field`, `empty-state`, `error-state`, `spinner`, `theme-scope`, `app-frame`; dòng 1 ghi `crew: tự dựng`). `app-frame` gồm khung trang (`AppFrame`, `SidebarHeader/Body/Footer/Item`, `CenteredPage`, `Kbd`) cho shell ở `src/app`.
- `brand/`: logo chữ "2P Crew" (một màu `currentColor`).
- `cn.ts`: `cn(...classes)`. `icons.ts`: icon lucide được phép dùng ngoài ds.
- `index.ts`: cổng export duy nhất.

## Luật (kiểm bằng `test/guards/design-system.test.ts`)

1. Không `style=` trong `src/{features,app}/**/*.tsx`.
2. `className` ngoài `src/ds/**` chỉ chứa class bố cục (`LAYOUT_CLASSES`: flex, grid, gap-0..6/8, items-*, justify-*, w-full, min-w-0, truncate...). Không có `className` động ngoài `cn(...)`.
3. Không import `radix-ui`, `@base-ui/react`, `class-variance-authority`, `lucide-react` ngoài `src/ds/**`; icon lấy qua `@/ds/icons`.
4. Mỗi file trong `components/` có dòng 1 `// clone: ui/src/components/ui/<tên>.tsx @ v2026.1005.0` hoặc `// crew: tự dựng`.

## Xem thử

`pnpm --filter @crew/paperclip-web dev` rồi mở `/ds` (chỉ có khi dev, bản production không chứa trang này): mọi component và widget ở theme sáng và tối.

// crew: tự dựng
import type * as React from 'react';
import { cn } from '../cn';

/** Ảnh xếp theo hàng, hết chỗ mới xuống dòng. Con là các {@link ImageTile}. */
function ImageGallery({ children }: { children: React.ReactNode }) {
  return <ul className="flex flex-wrap gap-2">{children}</ul>;
}

interface ImageTileProps {
  src: string;
  alt: string;
  /** Có thì bấm ảnh mở link này ở tab mới (ảnh cỡ thật). */
  href?: string;
  /** `md` cho ảnh đã đính kèm, `sm` cho ảnh xem trước lúc soạn. */
  size?: 'sm' | 'md';
  /** Nút thao tác (xóa, bỏ) đè ở góc trên phải ảnh. */
  action?: React.ReactNode;
}

/** Một ảnh trong {@link ImageGallery}: chiều cao cố định, giữ tỉ lệ; tên file chỉ còn ở `alt`. */
function ImageTile({ src, alt, href, size = 'md', action }: ImageTileProps) {
  const img = (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      className={cn(size === 'md' ? 'h-40' : 'h-28', 'w-auto max-w-full rounded-md border object-contain')}
    />
  );
  return (
    <li className="relative">
      {href ? (
        <a href={href} target="_blank" rel="noreferrer noopener">
          {img}
        </a>
      ) : (
        img
      )}
      {action ? <span className="absolute top-1 right-1 rounded-md bg-background/80">{action}</span> : null}
    </li>
  );
}

export type { ImageTileProps };
export { ImageGallery, ImageTile };

// crew: tự dựng
import type * as React from 'react';
import { cn } from '../cn';
import { isPlainClick } from './attachment-link-context';

/** Ảnh xếp theo hàng, hết chỗ mới xuống dòng. Con là các {@link ImageTile}. */
function ImageGallery({ children }: { children: React.ReactNode }) {
  return <ul className="flex flex-wrap gap-2">{children}</ul>;
}

interface ImageTileProps {
  src: string;
  alt: string;
  /** Link ảnh cỡ thật. Có `onOpen` thì bấm thường gọi `onOpen` (xem trong trang), không thì mở tab mới. */
  href?: string;
  /** Mở ảnh trong hộp xem tại chỗ; Cmd/Ctrl+click vẫn theo `href`. */
  onOpen?: () => void;
  /** `md` cho ảnh đã đính kèm, `sm` cho ảnh xem trước lúc soạn. */
  size?: 'sm' | 'md';
  /** Nút thao tác (xóa, bỏ) đè ở góc trên phải ảnh. */
  action?: React.ReactNode;
}

/** Một ảnh trong {@link ImageGallery}: chiều cao cố định, giữ tỉ lệ; tên file chỉ còn ở `alt`. */
function ImageTile({ src, alt, href, onOpen, size = 'md', action }: ImageTileProps) {
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
      {href && onOpen ? (
        <a
          href={href}
          className="block cursor-zoom-in"
          onClick={(e) => {
            if (!isPlainClick(e)) return;
            e.preventDefault();
            onOpen();
          }}
        >
          {img}
        </a>
      ) : href ? (
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

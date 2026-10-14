// crew: tự dựng
import { ImageOff } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useT } from '@/i18n';
import { cn } from '../cn';
import { isPlainClick } from './attachment-link-context';

/** Ảnh xếp theo hàng, hết chỗ mới xuống dòng. Con là các {@link ImageTile}. */
function ImageGallery({ children }: { children: ReactNode }) {
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
  action?: ReactNode;
}

/**
 * Một ảnh trong {@link ImageGallery}: chiều cao cố định, giữ tỉ lệ; tên file chỉ còn ở `alt`. Ảnh lỗi tải (file đã bị
 * dọn khỏi lưu trữ) thành ô cùng cỡ ghi "File không còn" thay cho biểu tượng ảnh vỡ.
 */
function ImageTile({ src, alt, href, onOpen, size = 'md', action }: ImageTileProps) {
  const { t } = useT();
  // Ghi theo src: đổi sang ảnh khác thì thử tải lại từ đầu.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const height = size === 'md' ? 'h-40' : 'h-28';
  const img =
    failedSrc === src ? (
      <span
        data-slot="image-tile-missing"
        role="img"
        aria-label={`${alt}: ${t('attachment.missing')}`}
        title={alt}
        className={cn(
          height,
          'flex w-32 flex-col items-center justify-center gap-1 rounded-md border border-dashed p-2 text-center text-xs text-muted-foreground',
        )}
      >
        <ImageOff aria-hidden className="size-4 shrink-0" />
        <span>{t('attachment.missing')}</span>
      </span>
    ) : (
      <img
        src={src}
        alt={alt}
        loading="lazy"
        onError={() => setFailedSrc(src)}
        className={cn(height, 'w-auto max-w-full rounded-md border object-contain')}
      />
    );
  // File đã mất thì không còn gì để mở: bỏ link, chỉ giữ ô ghi chú và nút thao tác (xóa đính kèm hỏng vẫn được).
  if (failedSrc === src) {
    return (
      <li className="relative">
        {img}
        {action ? <span className="absolute top-1 right-1 rounded-md bg-background/80">{action}</span> : null}
      </li>
    );
  }
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

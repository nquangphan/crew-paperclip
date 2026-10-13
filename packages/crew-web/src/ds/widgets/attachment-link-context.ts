// crew: tự dựng
// Cầu nối để markdown (mô tả, bình luận, tài liệu) mở link/ảnh file đính kèm bằng hộp xem trong trang thay vì rời
// trang. Không có provider thì markdown giữ cách cũ (link thường).
import { createContext, type MouseEvent, useContext } from 'react';

interface AttachmentLinkHandler {
  /** Id file nếu `href` là link nội dung file đính kèm; null với link khác. */
  match: (href: string) => string | null;
  /** Mở hộp xem file; `name` là chữ của link hoặc alt của ảnh (dùng khi file không có trong danh sách). */
  open: (id: string, opts: { name?: string; image?: boolean }) => void;
}

const AttachmentLinkContext = createContext<AttachmentLinkHandler | null>(null);

const useAttachmentLinks = () => useContext(AttachmentLinkContext);

/** Click thường (chuột trái, không phím bổ trợ) mới mở hộp xem; Cmd/Ctrl/Shift/chuột giữa giữ hành vi link gốc. */
const isPlainClick = (e: MouseEvent): boolean => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

export type { AttachmentLinkHandler };
export { AttachmentLinkContext, isPlainClick, useAttachmentLinks };

// Ngăn kéo menu ở màn hẹp: đóng mỗi khi đổi route (kể cả bấm lại link của trang đang mở, vì location.key luôn mới).
import { useState } from 'react';
import { useLocation } from 'react-router-dom';

export function useMobileMenu() {
  const { key } = useLocation();
  const [open, setOpen] = useState(false);
  const [seenKey, setSeenKey] = useState(key);
  // Chỉnh state ngay lúc render khi route đổi (không qua effect) để không vẽ một khung hình còn ngăn kéo.
  if (seenKey !== key) {
    setSeenKey(key);
    if (open) setOpen(false);
  }
  return { open, setOpen };
}

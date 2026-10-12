// crew: tự dựng
const KEY = 'crew.staleChunkReloadAt';
/** Hai lần tải lại cách nhau ít hơn khoảng này thì thôi, để lỗi thật (mạng, file hỏng) không thành vòng lặp. */
const MIN_INTERVAL_MS = 30_000;

interface ReloadTarget {
  addEventListener(type: 'vite:preloadError', listener: (event: Event) => void): void;
  location: { reload(): void };
  sessionStorage: Pick<Storage, 'getItem' | 'setItem'>;
}

/**
 * Sau mỗi lần deploy, tên các chunk JS đổi theo hash và chunk cũ bị xóa. Tab mở từ trước còn giữ bản cũ nên khi
 * chuyển trang thì nạp chunk không còn tồn tại ("Failed to fetch dynamically imported module"). Vite phát
 * `vite:preloadError` lúc đó: tải lại trang một lần để lấy bản mới thay vì hiện trang lỗi.
 */
export function installStaleChunkReload(target: ReloadTarget, now: () => number = Date.now): void {
  target.addEventListener('vite:preloadError', (event) => {
    let last = 0;
    try {
      last = Number(target.sessionStorage.getItem(KEY)) || 0;
    } catch {
      // Không đọc được sessionStorage (chế độ riêng tư): vẫn tải lại, mất chốt chống lặp.
    }
    if (now() - last < MIN_INTERVAL_MS) return;
    try {
      target.sessionStorage.setItem(KEY, String(now()));
    } catch {
      return;
    }
    event.preventDefault();
    target.location.reload();
  });
}

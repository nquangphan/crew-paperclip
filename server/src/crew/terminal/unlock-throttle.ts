const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60_000;

export interface UnlockThrottle {
  /** Giữ chỗ một lần thử, tính như một lần sai cho tới khi `clear`. Trả `false` khi đã đủ 5 lần trong cửa sổ. */
  reserve(userId: string): boolean;
  clear(userId: string): void;
}

/**
 * Đếm lần nhập sai mật khẩu mở khoá theo user (mọi phiên chung bộ đếm), trong bộ nhớ: 5 lần sai / 15 phút.
 * Ghi lần thử trước khi kiểm mật khẩu (đồng bộ, không có `await` xen giữa) để nhiều yêu cầu gửi cùng lúc không
 * cùng lọt qua; đúng mật khẩu thì `clear`.
 */
export function createUnlockThrottle(opts: { maxFailures?: number; windowMs?: number; now?: () => number } = {}): UnlockThrottle {
  const max = opts.maxFailures ?? MAX_FAILURES;
  const windowMs = opts.windowMs ?? WINDOW_MS;
  const now = opts.now ?? Date.now;
  const failures = new Map<string, number[]>();

  const recent = (userId: string) => {
    const t = now();
    const live = (failures.get(userId) ?? []).filter((at) => at + windowMs >= t);
    if (live.length) failures.set(userId, live);
    else failures.delete(userId);
    return live;
  };

  return {
    reserve(userId) {
      const live = recent(userId);
      if (live.length >= max) return false;
      failures.set(userId, [...live, now()]);
      return true;
    },
    clear: (userId) => void failures.delete(userId),
  };
}

export const crewTerminalUnlockThrottle = createUnlockThrottle();

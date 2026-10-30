const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60_000;

export interface UnlockThrottle {
  blocked(userId: string): boolean;
  fail(userId: string): void;
  clear(userId: string): void;
}

/** Đếm lần nhập sai mật khẩu mở khoá theo user (mọi phiên chung bộ đếm), trong bộ nhớ: 5 lần sai / 15 phút. */
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
    blocked: (userId) => recent(userId).length >= max,
    fail(userId) {
      failures.set(userId, [...recent(userId), now()]);
    },
    clear: (userId) => void failures.delete(userId),
  };
}

export const crewTerminalUnlockThrottle = createUnlockThrottle();

/** Hạn mở khoá terminal: 12 giờ kể từ lúc nhập đúng mật khẩu. */
const UNLOCK_TTL_MS = 12 * 60 * 60_000;

export interface TerminalUnlockStore {
  unlock(sessionId: string): { expiresAt: Date };
  status(sessionId: string): { unlocked: boolean; expiresAt: Date | null };
}

/** Trạng thái mở khoá theo phiên đăng nhập, giữ trong bộ nhớ: khởi động lại server thì phải nhập lại mật khẩu. */
export function createTerminalUnlockStore(opts: { ttlMs?: number; now?: () => number } = {}): TerminalUnlockStore {
  const ttlMs = opts.ttlMs ?? UNLOCK_TTL_MS;
  const now = opts.now ?? Date.now;
  const expiry = new Map<string, number>();

  const sweep = () => {
    const t = now();
    for (const [id, at] of expiry) if (at < t) expiry.delete(id);
  };

  return {
    unlock(sessionId) {
      sweep();
      const at = now() + ttlMs;
      expiry.set(sessionId, at);
      return { expiresAt: new Date(at) };
    },
    status(sessionId) {
      const at = expiry.get(sessionId);
      if (at === undefined || at < now()) {
        expiry.delete(sessionId);
        return { unlocked: false, expiresAt: null };
      }
      return { unlocked: true, expiresAt: new Date(at) };
    },
  };
}

export const crewTerminalUnlockStore = createTerminalUnlockStore();

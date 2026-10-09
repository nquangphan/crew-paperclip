// Đăng nhập, đăng xuất, phiên. better-auth: server/src/auth (route /api/auth/*).
import type { AuthSession } from '@paperclipai/shared';
import { call } from '../endpoints';

export const authApi = {
  signIn: (input: { email: string; password: string }): Promise<unknown> => call('auth.signIn', {}, { body: input }),
  signOut: (): Promise<unknown> => call('auth.signOut', {}, { body: {} }),
  /** Phiên hiện tại; null khi chưa đăng nhập (server trả 401 hoặc body rỗng). */
  session: async (): Promise<AuthSession | null> => {
    try {
      const data: AuthSession | { data?: AuthSession } | null = await call('auth.session', {});
      if (!data) return null;
      if ('session' in data && data.session) return data as AuthSession;
      const nested = (data as { data?: AuthSession }).data;
      return nested?.session ? nested : null;
    } catch (err) {
      if ((err as { status?: number }).status === 401) return null;
      throw err;
    }
  },
};

export const __endpoints = ['auth.session', 'auth.signIn', 'auth.signOut'];

// Route của feature Jev (S24). Trang nạp lazy; chỉ owner dùng được (trang tự báo "chỉ owner" với người khác).
import type { RouteObject } from 'react-router-dom';

export const routes: RouteObject[] = [
  {
    path: 'jev',
    lazy: async () => ({ Component: (await import('./jev-page')).JevPage }),
  },
];

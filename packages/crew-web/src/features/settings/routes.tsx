// Route của feature cài đặt (S18). Trang nạp lazy.
import type { RouteObject } from 'react-router-dom';

export const routes: RouteObject[] = [
  {
    path: 'settings',
    lazy: async () => ({ Component: (await import('./settings-page')).SettingsPage }),
  },
];

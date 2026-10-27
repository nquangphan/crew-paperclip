// Route của feature cài đặt (S18): Cài đặt và Cài đặt model (chỉ owner). Trang nạp lazy.
import type { RouteObject } from 'react-router-dom';

export const routes: RouteObject[] = [
  {
    path: 'settings',
    lazy: async () => ({ Component: (await import('./settings-page')).SettingsPage }),
  },
  {
    path: 'settings/models',
    lazy: async () => ({ Component: (await import('./models/model-settings-page')).ModelSettingsPage }),
  },
];

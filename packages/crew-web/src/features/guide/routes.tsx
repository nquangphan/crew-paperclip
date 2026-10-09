// Route của feature hướng dẫn (S17). Trang nạp lazy.
import type { RouteObject } from 'react-router-dom';

export const routes: RouteObject[] = [
  {
    path: 'guide',
    lazy: async () => ({ Component: (await import('./guide-page')).GuidePage }),
  },
];

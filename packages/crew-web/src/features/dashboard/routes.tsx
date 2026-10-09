import type { RouteObject } from 'react-router-dom';

export const routes: RouteObject[] = [
  {
    path: 'dashboard',
    lazy: async () => ({ Component: (await import('./dashboard-page')).DashboardPage }),
  },
];

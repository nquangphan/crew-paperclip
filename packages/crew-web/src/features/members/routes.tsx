import type { RouteObject } from 'react-router-dom';

export const routes: RouteObject[] = [
  {
    path: 'members',
    lazy: async () => ({ Component: (await import('./members-page')).MembersPage }),
  },
];

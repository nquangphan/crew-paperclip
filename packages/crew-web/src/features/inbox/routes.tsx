import type { RouteObject } from 'react-router-dom';

export const routes: RouteObject[] = [
  {
    path: 'inbox',
    lazy: async () => ({ Component: (await import('./inbox-page')).InboxPage }),
  },
];

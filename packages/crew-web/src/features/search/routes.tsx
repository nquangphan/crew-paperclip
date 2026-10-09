import type { RouteObject } from 'react-router-dom';

export const routes: RouteObject[] = [
  {
    path: 'search',
    lazy: async () => ({ Component: (await import('./search-page')).SearchPage }),
  },
];

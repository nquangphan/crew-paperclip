import type { RouteObject } from 'react-router-dom';

export const routes: RouteObject[] = [
  {
    path: 'contributions',
    lazy: async () => ({ Component: (await import('./contributions-page')).ContributionsPage }),
  },
];

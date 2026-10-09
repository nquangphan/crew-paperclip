// Route của feature docs (S16). Trang nạp lazy.
import type { RouteObject } from 'react-router-dom';

export const routes: RouteObject[] = [
  {
    path: 'docs',
    lazy: async () => ({ Component: (await import('./docs-page')).DocsPage }),
  },
];

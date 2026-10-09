// Route của feature máy (S15). Trang nạp lazy.
import type { RouteObject } from 'react-router-dom';

export const routes: RouteObject[] = [
  {
    path: 'machines',
    lazy: async () => ({ Component: (await import('./machines-page')).MachinesPage }),
  },
];

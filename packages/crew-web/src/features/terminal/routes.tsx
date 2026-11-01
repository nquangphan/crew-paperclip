import type { RouteObject } from 'react-router-dom';

export const routes: RouteObject[] = [
  {
    path: 'terminal/:machineId/:projectId',
    // Toàn màn hình: khung company không vẽ sidebar để terminal có đủ chỗ.
    handle: { fullscreen: true },
    lazy: async () => ({ Component: (await import('./terminal-page')).TerminalPage }),
  },
];

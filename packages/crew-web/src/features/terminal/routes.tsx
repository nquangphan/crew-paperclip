import type { RouteObject } from 'react-router-dom';

export const routes: RouteObject[] = [
  {
    path: 'terminal/:machineId/:projectId',
    lazy: async () => ({ Component: (await import('./terminal-page')).TerminalPage }),
  },
];

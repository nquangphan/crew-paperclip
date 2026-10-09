// Route của feature skills (S14). Trang nạp lazy.
import type { RouteObject } from 'react-router-dom';

export const routes: RouteObject[] = [
  {
    path: 'skills',
    lazy: async () => ({ Component: (await import('./skills-page')).SkillsPage }),
  },
  {
    path: 'skills/:skillId',
    lazy: async () => ({ Component: (await import('./skill-detail')).SkillDetail }),
  },
];

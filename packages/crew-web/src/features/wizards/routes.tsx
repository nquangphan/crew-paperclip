// Route của wizard. `projects/new` là route tĩnh nên được ưu tiên hơn `projects/:projectRef` của feature project.
import type { RouteObject } from 'react-router-dom';

export const routes: RouteObject[] = [
  {
    path: 'projects/new',
    lazy: async () => ({ Component: (await import('./add-project/add-project-page')).AddProjectPage }),
  },
];

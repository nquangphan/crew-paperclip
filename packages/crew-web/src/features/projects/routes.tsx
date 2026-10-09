// Route của feature project. Mỗi trang nạp lazy. `projects/new` (wizard) do feature wizards đăng ký; route tĩnh
// được ưu tiên hơn `projects/:projectRef` nên không va nhau.
import type { RouteObject } from 'react-router-dom';

export const routes: RouteObject[] = [
  {
    path: 'projects',
    lazy: async () => ({ Component: (await import('./list/projects-page')).ProjectsPage }),
  },
  {
    path: 'projects/:projectRef',
    lazy: async () => ({ Component: (await import('./detail/project-page')).ProjectPage }),
  },
];

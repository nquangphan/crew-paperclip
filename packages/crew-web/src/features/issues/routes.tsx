import type { RouteObject } from 'react-router-dom';

// Mỗi trang nạp lazy để bundle chính không phình theo số màn hình.
export const routes: RouteObject[] = [
  {
    path: 'issues',
    lazy: async () => ({ Component: (await import('./list/issues-page')).IssuesPage }),
  },
  {
    path: 'issues/:ref',
    lazy: async () => ({ Component: (await import('./detail/issue-page')).IssuePage }),
  },
];

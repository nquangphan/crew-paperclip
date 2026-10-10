// Route của wizard. `projects/new`, `agents/new`, `projects/remove`, `agents/remove` là route tĩnh nên được ưu tiên hơn
// `projects/:projectRef`, `agents/:agentRef` của feature project/agent.
import type { RouteObject } from 'react-router-dom';

export const routes: RouteObject[] = [
  {
    path: 'projects/new',
    lazy: async () => ({ Component: (await import('./add-project/add-project-page')).AddProjectPage }),
  },
  {
    path: 'agents/new',
    lazy: async () => ({ Component: (await import('./add-agent/add-agent-page')).AddAgentPage }),
  },
  {
    path: 'projects/remove',
    lazy: async () => ({ Component: (await import('./remove/remove-pages')).RemoveProjectPage }),
  },
  {
    path: 'agents/remove',
    lazy: async () => ({ Component: (await import('./remove/remove-pages')).RemoveAgentPage }),
  },
];

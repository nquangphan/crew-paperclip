// Route của feature agent. Mỗi trang nạp lazy. `agents/new` (wizard) do feature wizards đăng ký; route tĩnh được ưu tiên
// hơn `agents/:agentRef` nên không va nhau. `agents/:agentRef/runs/:runId` do feature runs đăng ký.
import type { RouteObject } from 'react-router-dom';

export const routes: RouteObject[] = [
  {
    path: 'agents',
    lazy: async () => ({ Component: (await import('./list/agents-page')).AgentsPage }),
  },
  {
    path: 'agents/:agentRef',
    lazy: async () => ({ Component: (await import('./detail/agent-page')).AgentPage }),
  },
];

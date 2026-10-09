import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { CompanyContext } from '@/app/hooks';

export const COMPANY = { id: 'c-tps', name: '2P Solutions', issuePrefix: 'TPS' };

export const ID = {
  assistant: 'a1111111-1111-4111-8111-111111111111',
  executor: 'e2222222-2222-4222-8222-222222222222',
  reviewer: 'b4444444-4444-4444-8444-444444444444',
  integrator: 'c5555555-5555-4555-8555-555555555555',
  spare: 'd6666666-6666-4666-8666-666666666666',
};

export const ROLES = {
  assistantAgentId: ID.assistant,
  executorAgentIds: [ID.executor],
  reviewerAgentId: ID.reviewer,
  integratorAgentId: ID.integrator,
};

export const PIN_DIR = '/Users/q/.crew/workflows/superpowers/5.0.7';

export const agent = (over: Record<string, unknown> = {}) => ({
  id: ID.executor,
  companyId: COMPANY.id,
  name: 'Executor Một',
  urlKey: 'executor-mot',
  icon: null,
  status: 'idle',
  adapterType: 'claude_local',
  adapterConfig: {
    engine: 'cli',
    command: '/Users/q/.crew/bin/crew-claude-run',
    extraArgs: ['--setting-sources', 'project,local', '--plugin-dir', PIN_DIR],
    model: 'claude-sonnet-5',
    env: {},
  },
  runtimeConfig: { heartbeat: { enabled: false, maxConcurrentRuns: 1 } },
  defaultEnvironmentId: 'env1',
  lastHeartbeatAt: null,
  permissions: { canCreateAgents: false, canCreateSkills: false },
  ...over,
});

export const project = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  companyId: COMPANY.id,
  urlKey: 'alpha',
  name: 'Alpha',
  archivedAt: null,
  ...over,
});

export const environment = (over: Record<string, unknown> = {}) => ({
  id: 'env1',
  name: 'mac-mini',
  driver: 'ssh',
  status: 'active',
  config: { host: '192.168.1.5', username: 'q', remoteWorkspacePath: '/Users/q/crew-agents/alpha/executor' },
  metadata: null,
  ...over,
});

/** Render một trang trong shell company giả: route mẫu `/:companyPrefix/<route>`. */
export function renderPage(element: ReactElement, opts: { route: string; at: string }) {
  const router = createMemoryRouter(
    [
      { path: `/:companyPrefix/${opts.route}`, element },
      { path: '/:companyPrefix/*', element: <div>đích</div> },
    ],
    { initialEntries: [opts.at] },
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CompanyContext.Provider value={{ company: COMPANY, companies: [COMPANY] }}>
        <RouterProvider router={router} />
      </CompanyContext.Provider>
    </QueryClientProvider>,
  );
  return router;
}

/** Bọc component rời (dialog, tab) trong QueryClient + company. */
export function renderWith(element: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([{ path: '/', element }]);
  render(
    <QueryClientProvider client={client}>
      <CompanyContext.Provider value={{ company: COMPANY, companies: [COMPANY] }}>
        <RouterProvider router={router} />
      </CompanyContext.Provider>
    </QueryClientProvider>,
  );
  return client;
}

export const data = (key: string, value: unknown) => ({
  [`POST /api/plugins/crew.core/data/${key}`]: { body: { data: value } },
});

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { CompanyContext } from '@/app/hooks';

export const COMPANY = { id: 'c-tps', name: '2P Solutions', issuePrefix: 'TPS' };

export const ID = {
  assistant: 'a1111111-1111-4111-8111-111111111111',
  executor: 'e2222222-2222-4222-8222-222222222222',
  executor2: 'e3333333-3333-4333-8333-333333333333',
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

export const project = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  companyId: COMPANY.id,
  urlKey: 'alpha',
  name: 'Alpha',
  description: 'Mô tả alpha',
  color: null,
  icon: null,
  archivedAt: null,
  taskCount: 3,
  ...over,
});

/** Render một trang trong shell company giả: route mẫu `/:companyPrefix/<route>`. */
export function renderPage(element: ReactElement, opts: { route: string; at: string }) {
  const router = createMemoryRouter([{ path: `/:companyPrefix/${opts.route}`, element }], {
    initialEntries: [opts.at],
  });
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

export const data = (key: string, value: unknown) => ({
  [`POST /api/plugins/crew.core/data/${key}`]: { body: { data: value } },
});

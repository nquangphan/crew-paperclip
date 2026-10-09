// Dùng chung cho test chi tiết yêu cầu. Hình dữ liệu theo @paperclipai/shared (Issue, IssueComment, IssueAttachment).
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { CompanyContext, MeContext } from '@/app/hooks';

export const COMPANY = { id: 'c1', name: '2P', issuePrefix: 'TPS' };
export const ME = { id: 'u1', name: 'Owner', email: 'owner@example.com', image: null };

/** GET /api/issues/:id. */
export const ISSUE = {
  id: 'i1',
  companyId: 'c1',
  projectId: 'p1',
  parentId: 'i0',
  ancestors: [{ id: 'i0', identifier: 'TPS-1', title: 'Yêu cầu gốc', status: 'in_progress' }],
  identifier: 'TPS-2',
  title: 'Sửa trang đăng nhập',
  description: 'Mô tả ban đầu\n\ncrew-model complexity=small model=claude-sonnet-5 effort=medium reason=việc nhỏ',
  status: 'in_review',
  assigneeAgentId: 'a1',
  assigneeUserId: null,
  labels: [],
  blockedBy: [{ id: 'i9', identifier: 'TPS-9', title: 'Việc chặn', status: 'todo' }],
  executionPolicy: {
    mode: 'normal',
    commentRequired: true,
    maxReviewRounds: 5,
    stages: [
      { id: 's1', type: 'review', approvalsNeeded: 1, participants: [{ id: 'x1', type: 'agent', agentId: 'a2' }] },
      { id: 's2', type: 'approval', approvalsNeeded: 1, participants: [{ id: 'x2', type: 'user', userId: 'u1' }] },
    ],
  },
  executionState: {
    status: 'pending',
    currentStageId: 's2',
    currentStageIndex: 1,
    currentStageType: 'approval',
    currentParticipant: { type: 'user', userId: 'u1' },
    returnAssignee: null,
    reviewRequest: null,
    completedStageIds: ['s1'],
    lastDecisionId: null,
    lastDecisionOutcome: null,
    changesRequestedCount: 2,
  },
  createdAt: '2026-10-09T01:00:00.000Z',
  updatedAt: '2026-10-10T01:00:00.000Z',
  startedAt: '2026-10-09T02:00:00.000Z',
  completedAt: null,
};

export const AGENTS = [
  { id: 'a1', name: 'Executor Alpha' },
  { id: 'a2', name: 'Reviewer Alpha' },
];
export const PROJECTS = [{ id: 'p1', name: 'Alpha', archivedAt: null }];

export const wrap = (children: ReactElement) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <CompanyContext.Provider value={{ company: COMPANY, companies: [COMPANY] }}>
      <MeContext.Provider value={ME}>{children}</MeContext.Provider>
    </CompanyContext.Provider>
  </QueryClientProvider>
);

/** Gắn `element` tại /TPS/issues/TPS-2 trong router bộ nhớ. */
export function mount(element: ReactElement, path = '/TPS/issues/TPS-2') {
  const router = createMemoryRouter([{ path: '/:companyPrefix/issues/:ref', element: wrap(element) }], {
    initialEntries: [path],
  });
  return render(<RouterProvider router={router} />);
}

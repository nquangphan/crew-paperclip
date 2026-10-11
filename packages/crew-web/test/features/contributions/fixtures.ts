import type { Contribution } from '@/api';

export const GUEST_ACCESS = { userId: 'u2', membershipRole: 'viewer', contributor: true, canApprove: false };

/** Dựng một mục góp ý đủ trường theo hợp đồng router Crew. */
export const contribution = (over: Partial<Contribution>): Contribution => ({
  id: 'k1',
  kind: 'comment',
  status: 'pending',
  authorUserId: 'u2',
  projectId: null,
  targetIssueId: 'i1',
  title: null,
  body: 'Góp ý chờ',
  createdAt: '2026-10-10T01:30:00.000Z',
  decidedAt: null,
  decidedByUserId: null,
  resultIssueId: null,
  resultCommentId: null,
  ...over,
});

export const DIRECTORY = {
  users: [
    { principalId: 'u1', status: 'active', user: { id: 'u1', name: 'Owner', email: 'o@example.com' } },
    { principalId: 'u2', status: 'active', user: { id: 'u2', name: 'Lan Marketing', email: 'lan@example.com' } },
  ],
};

/**
 * Giữ treo mọi POST tới `url` (bọc `fetch` giả đang dùng) cho tới khi gọi hàm trả về. Dùng để kiểm UI trong lúc một
 * bước duyệt còn đang chạy.
 */
export function holdPost(url: string): () => void {
  const inner = globalThis.fetch;
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === url && init?.method === 'POST') await gate;
    return inner(input, init);
  }) as typeof fetch;
  return release;
}

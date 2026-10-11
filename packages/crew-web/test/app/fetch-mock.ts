// Giả server cho test app: khớp "METHOD /đường?query" (query bỏ qua nếu khóa không có `?`).
import { vi } from 'vitest';

type Reply =
  | { status?: number; body?: unknown }
  | ((init: RequestInit | undefined) => { status?: number; body?: unknown });

const isAccessRoute = (method: string, path: string) =>
  method === 'GET' && /^\/api\/crew\/companies\/[^/]+\/access$/.test(path);
const ownerAccess = { body: { userId: 'u1', membershipRole: 'owner', contributor: false, canApprove: true } };

/** Route `GET …/access` không khai thì mặc định là owner (UI không ở chế độ chỉ đọc); test vai trò khác khai `accessRoute`. */
export function mockServer(routes: Record<string, Reply>) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const url = String(input);
    const path = url.split('?')[0];
    calls.push({ method, url, body: typeof init?.body === 'string' ? JSON.parse(init.body) : (init?.body ?? null) });
    const reply =
      routes[`${method} ${url}`] ??
      routes[`${method} ${path}`] ??
      (isAccessRoute(method, path) ? ownerAccess : undefined);
    if (!reply) return new Response(JSON.stringify({ error: `no mock ${method} ${url}` }), { status: 404 });
    const r = typeof reply === 'function' ? reply(init) : reply;
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status ?? 200 });
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return { calls, fetchMock };
}

export const SESSION = {
  session: { id: 's1', userId: 'u1' },
  user: { id: 'u1', email: 'owner@example.com', name: 'Owner', image: null },
  sentryDsn: null,
};

/** Dòng giả server cho `GET /api/crew/companies/:id/access` với vai trò chỉ định. */
export const accessRoute = (companyId: string, body: Record<string, unknown>) => ({
  [`GET /api/crew/companies/${companyId}/access`]: { body },
});

export const COMPANY_TPS = { id: 'c-tps', name: '2P Solutions', issuePrefix: 'TPS' };
export const COMPANY_CREA = { id: 'c-crea', name: 'Crew Spike Policy', issuePrefix: 'CREA' };
